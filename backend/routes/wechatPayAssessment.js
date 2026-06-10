/**
 * 微信测评报名费：JSAPI（微信内）+ Native（固定金额扫码，无需手输）
 * 路由注册见 server.js（notify 使用 raw body）
 * 网页授权换 openid 需环境变量 WECHAT_MP_SECRET（公众号 AppSecret，与 WECHAT_PAY_APPID 同一公众号）
 * 可选 WECHAT_MP_OAUTH_REDIRECT_URI（须与微信「网页授权」回调 URL 完全一致，如 https://域名/api/v1/pay/wechat/assessment/oauth-callback）
 * 可选 PUBLIC_SITE_ORIGIN（oauth 回跳站点根，如 https://域名）
 */
const fs = require('fs');
const https = require('https');
const QRCode = require('qrcode');
const { pool } = require('../config/database');
const {
  loadConfig,
  jsapiCreateOrder,
  nativeCreateOrder,
  buildJsapiPayParams,
  decryptNotifyResource,
  verifyNotifySignature
} = require('../services/wechatPayV3Assessment');

let ordersTableReady = false;
async function ensureWxPayOrdersTable() {
  if (ordersTableReady) return;
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS compat_wx_pay_orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      out_trade_no VARCHAR(64) NOT NULL,
      cooperation_application_id INT NOT NULL,
      user_id INT NOT NULL,
      amount_fen INT NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
      prepay_id VARCHAR(128) NULL,
      transaction_id VARCHAR(64) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_out (out_trade_no),
      KEY idx_coop (cooperation_application_id),
      KEY idx_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='微信 JSAPI 测评缴费订单'
  `);
  ordersTableReady = true;
}

/** 为前端展示补充微信请求类错误的常见排查说明 */
function enrichWechatHttpErrorMessage(msg, wxDetail, errCode) {
  let m = msg || '下单失败';
  const code = (wxDetail && wxDetail.code && String(wxDetail.code)) || (errCode && String(errCode)) || '';
  if (code === 'NO_AUTH' || m.indexOf('NO_AUTH') !== -1) {
    m +=
      '。请确认：商户平台已开通「Native 扫码支付」、公众号/小程序 AppID 已与该商户号绑定、且下单 AppID 与 WECHAT_PAY_APPID 一致。';
  }
  if (m.indexOf('签名') !== -1 || code === 'SIGN_ERROR' || m.indexOf('SIGN_ERROR') !== -1) {
    m +=
      ' 排查：① WECHAT_PAY_MERCHANT_SERIAL_NO 须为商户平台「账户中心 → API安全 → 管理证书」中当前在用证书的序列号；② WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH 须指向与该证书配套的 apiclient_key.pem（勿混用其他商户或旧证书私钥）；③ WECHAT_PAY_MCHID 须为该商户号；④ 若近期在平台「重置」过证书，须重新下载私钥并更新序列号。';
  }
  if (
    m.indexOf('OSSL_') !== -1 ||
    m.indexOf('DECODER') !== -1 ||
    m.indexOf('unsupported') !== -1 ||
    m.indexOf('商户私钥') !== -1
  ) {
    m +=
      ' 说明：ERR_OSSL_UNSUPPORTED / DECODER 多为服务器无法解析 apiclient_key.pem（错用证书文件、PEM 损坏、或 OpenSSL3 与密钥格式不兼容）。请在服务器执行 `openssl pkcs8 -topk8 -nocrypt -in apiclient_key.pem -out apiclient_key_pkcs8.pem`，将 WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH 改为 apiclient_key_pkcs8.pem 后重启 Node。';
  }
  return m;
}

async function ensureFeeSettingsTable() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS compat_enterprise_assessment_fee_settings (
      enterprise_id INT PRIMARY KEY,
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      amount_yuan DECIMAL(10,2) NOT NULL DEFAULT 0,
      pay_start_at DATETIME NULL,
      pay_end_at DATETIME NULL,
      wechat_qrcode_url LONGTEXT NULL,
      alipay_qrcode_url LONGTEXT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

function isInPayWindow(payStartAt, payEndAt) {
  const now = Date.now();
  if (payStartAt != null && payStartAt !== '') {
    const t = new Date(payStartAt).getTime();
    if (Number.isFinite(t) && now < t) return false;
  }
  if (payEndAt != null && payEndAt !== '') {
    const t = new Date(payEndAt).getTime();
    if (Number.isFinite(t) && now > t) return false;
  }
  return true;
}

function outTradeNoFor(coopId) {
  const t = Date.now().toString(36).toUpperCase();
  const id = String(coopId).replace(/\D/g, '').slice(0, 8) || '0';
  const s = `AF${id}${t}`;
  return s.length > 32 ? s.slice(0, 32) : s;
}

/**
 * JSAPI / Native 共用：校验报名、缴费开关、金额
 * @returns {Promise<{err:{status:number,body:object}}|{alreadyPaid:true}|{amountFen:number,amountYuan:number}>}
 */
async function loadAssessmentPayContext(req, coopId) {
  const role = String(req.user && req.user.role ? req.user.role : '').toLowerCase();
  if (!['candidate', 'jobseeker', 'user'].includes(role)) {
    return { err: { status: 403, body: { success: false, message: '仅求职者账号可发起支付' } } };
  }
  if (!Number.isFinite(coopId) || coopId <= 0) {
    return { err: { status: 400, body: { success: false, message: '无效 cooperationApplicationId' } } };
  }

  await ensureFeeSettingsTable();
  await ensureWxPayOrdersTable();

  const [rows] = await pool.execute(
    `SELECT a.*,
      COALESCE(a.enterprise_id, p.enterprise_id, an.enterprise_id) AS resolved_enterprise_id
     FROM compat_cooperation_applications a
     LEFT JOIN compat_enterprise_projects p ON p.id = a.project_id
     LEFT JOIN compat_announcements an ON an.id = a.announcement_id
     WHERE a.id = ? LIMIT 1`,
    [coopId]
  );
  if (!rows || !rows.length) {
    return { err: { status: 404, body: { success: false, message: '报名记录不存在' } } };
  }
  const row = rows[0];
  if (Number(row.user_id) !== Number(req.user.id)) {
    return { err: { status: 403, body: { success: false, message: '无权限' } } };
  }
  const st = String(row.status || '').toLowerCase();
  if (st !== 'approved') {
    return { err: { status: 400, body: { success: false, message: '仅审核通过后可缴费' } } };
  }

  const eid =
    row.resolved_enterprise_id != null && row.resolved_enterprise_id !== ''
      ? Number(row.resolved_enterprise_id)
      : null;
  if (!eid) {
    return { err: { status: 400, body: { success: false, message: '无法解析企业，暂不能缴费' } } };
  }

  const [feeRows] = await pool.execute(
    'SELECT * FROM compat_enterprise_assessment_fee_settings WHERE enterprise_id = ? LIMIT 1',
    [eid]
  );
  const fee = feeRows && feeRows[0];
  if (!fee || Number(fee.enabled) !== 1) {
    return { err: { status: 400, body: { success: false, message: '当前未开启测评缴费' } } };
  }
  if (!isInPayWindow(fee.pay_start_at, fee.pay_end_at)) {
    return { err: { status: 400, body: { success: false, message: '不在缴费开放时间内' } } };
  }

  let extra = {};
  try {
    extra = row.extra_json ? JSON.parse(row.extra_json) : {};
  } catch (_) {
    extra = {};
  }
  if (extra.assessmentFee && extra.assessmentFee.paid) {
    return { alreadyPaid: true };
  }

  const amountYuan = fee.amount_yuan != null ? Number(fee.amount_yuan) : 0;
  const amountFen = Math.round(amountYuan * 100);
  if (!Number.isFinite(amountFen) || amountFen < 1) {
    return { err: { status: 400, body: { success: false, message: '缴费金额未正确设置' } } };
  }

  return { amountFen, amountYuan };
}

/**
 * POST /api/v1/pay/wechat/assessment/jsapi-prepay
 * body: { cooperationApplicationId, openid }
 * openid 须由前端在微信内通过网页授权 snsapi_base 获取
 */
async function createJsapiPrepay(req, res) {
  const cfg = loadConfig();
  if (!cfg.isReady()) {
    return res.status(503).json({
      success: false,
      message: '微信支付未配置：' + cfg.missingHint()
    });
  }

  const coopId = parseInt(req.body && req.body.cooperationApplicationId, 10);
  const openid = (req.body && req.body.openid && String(req.body.openid).trim()) || '';
  if (!openid || openid.length < 10) {
    return res.status(400).json({ success: false, message: '缺少有效 openid，请在微信内完成网页授权后重试' });
  }

  try {
    const ctx = await loadAssessmentPayContext(req, coopId);
    if (ctx.alreadyPaid) {
      return res.json({ success: true, message: '已缴费', alreadyPaid: true });
    }
    if (ctx.err) {
      return res.status(ctx.err.status).json(ctx.err.body);
    }

    const outTradeNo = outTradeNoFor(coopId);
    await pool.execute(
      `INSERT INTO compat_wx_pay_orders (out_trade_no, cooperation_application_id, user_id, amount_fen, status)
       VALUES (?, ?, ?, ?, 'PENDING')`,
      [outTradeNo, coopId, Number(req.user.id), ctx.amountFen]
    );

    const wxRes = await jsapiCreateOrder({
      outTradeNo,
      description: '测评报名费',
      amountFen: ctx.amountFen,
      openid,
      cfg
    });

    const prepayId = wxRes && wxRes.prepay_id;
    if (!prepayId) {
      await pool.execute('UPDATE compat_wx_pay_orders SET status = ? WHERE out_trade_no = ?', ['FAILED', outTradeNo]);
      return res.status(502).json({ success: false, message: '微信下单失败', detail: wxRes });
    }

    await pool.execute('UPDATE compat_wx_pay_orders SET prepay_id = ? WHERE out_trade_no = ?', [prepayId, outTradeNo]);

    const payParams = buildJsapiPayParams(prepayId, cfg);
    return res.json({
      success: true,
      data: {
        payParams,
        outTradeNo
      }
    });
  } catch (e) {
    console.warn('[wechatPayAssessment] jsapi-prepay:', e.message, e.detail || '');
    const wxDetail = e.detail && typeof e.detail === 'object' ? e.detail : null;
    const msg = enrichWechatHttpErrorMessage(e.message || '下单失败', wxDetail, e.code);
    const payload = { success: false, message: msg };
    if (wxDetail) payload.detail = wxDetail;
    else if (e.code) payload.detail = { code: e.code };
    return res.status(500).json(payload);
  }
}

/**
 * POST /api/v1/pay/wechat/assessment/native-prepay
 * 返回固定金额的 Native 扫码二维码（code_url），考生用微信扫一扫即可，无需手输金额
 * body: { cooperationApplicationId }
 */
async function createNativePrepay(req, res) {
  const cfg = loadConfig();
  if (!cfg.isReady()) {
    return res.status(503).json({
      success: false,
      message: '微信支付未配置：' + cfg.missingHint()
    });
  }

  const coopId = parseInt(req.body && req.body.cooperationApplicationId, 10);

  try {
    const ctx = await loadAssessmentPayContext(req, coopId);
    if (ctx.alreadyPaid) {
      return res.json({ success: true, message: '已缴费', alreadyPaid: true });
    }
    if (ctx.err) {
      return res.status(ctx.err.status).json(ctx.err.body);
    }

    const outTradeNo = outTradeNoFor(coopId);
    await pool.execute(
      `INSERT INTO compat_wx_pay_orders (out_trade_no, cooperation_application_id, user_id, amount_fen, status)
       VALUES (?, ?, ?, ?, 'PENDING')`,
      [outTradeNo, coopId, Number(req.user.id), ctx.amountFen]
    );

    const wxRes = await nativeCreateOrder({
      outTradeNo,
      description: '测评报名费',
      amountFen: ctx.amountFen,
      cfg
    });

    const codeUrl = wxRes && wxRes.code_url;
    if (!codeUrl || typeof codeUrl !== 'string') {
      await pool.execute('UPDATE compat_wx_pay_orders SET status = ? WHERE out_trade_no = ?', ['FAILED', outTradeNo]);
      return res.status(502).json({ success: false, message: '微信下单失败', detail: wxRes });
    }

    const qrDataUrl = await QRCode.toDataURL(codeUrl, { width: 280, margin: 2, errorCorrectionLevel: 'M' });

    return res.json({
      success: true,
      data: {
        qrDataUrl,
        outTradeNo,
        amountYuan: ctx.amountYuan
      }
    });
  } catch (e) {
    console.warn('[wechatPayAssessment] native-prepay:', e.message, e.detail || '');
    const wxDetail = e.detail && typeof e.detail === 'object' ? e.detail : null;
    const code = wxDetail && wxDetail.code ? String(wxDetail.code) : e.code ? String(e.code) : '';
    let msg = enrichWechatHttpErrorMessage(e.message || '下单失败', wxDetail, code);
    const payload = { success: false, message: msg };
    if (wxDetail) payload.detail = wxDetail;
    else if (code) payload.detail = { code };
    return res.status(500).json(payload);
  }
}

/**
 * 微信异步通知（原始 JSON body）
 */
async function handleNotify(req, res) {
  const cfg = loadConfig();
  const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : String(req.body || '');
  const h = req.headers || {};
  const serial = h['wechatpay-serial'] || h['Wechatpay-Serial'] || null;
  const timestamp = h['wechatpay-timestamp'] || h['Wechatpay-Timestamp'] || null;
  const nonce = h['wechatpay-nonce'] || h['Wechatpay-Nonce'] || null;
  const signature = h['wechatpay-signature'] || h['Wechatpay-Signature'] || null;
  const sigType = h['wechatpay-signature-type'] || h['Wechatpay-Signature-Type'] || null;
  const bodyLen = Buffer.byteLength(rawBody || '', 'utf8');

  const replyFail = (msg) => {
    res.status(500);
    return res.json({ code: 'FAIL', message: msg || '失败' });
  };
  const replyOk = () => res.json({ code: 'SUCCESS', message: '成功' });

  if (!cfg.isReady() || !cfg.apiV3Key) {
    return replyFail('未配置');
  }

  if (!cfg.platformCertPath || !fs.existsSync(cfg.platformCertPath)) {
    console.warn('[wechatPayAssessment] notify: 缺少 WECHAT_PAY_PLATFORM_CERT_PATH，无法验签', {
      platformCertPath: cfg.platformCertPath || null,
      serial,
      sigType,
      timestamp,
      nonce: nonce ? String(nonce).slice(0, 8) + '...' : null,
      signaturePrefix: signature ? String(signature).slice(0, 16) + '...' : null,
      bodyLen
    });
    return replyFail('平台证书未配置');
  }

  let platformPem;
  try {
    platformPem = fs.readFileSync(cfg.platformCertPath, 'utf8');
  } catch (e) {
    console.warn('[wechatPayAssessment] notify: 平台证书读取失败', {
      platformCertPath: cfg.platformCertPath || null,
      message: e && e.message ? e.message : String(e)
    });
    return replyFail('证书读取失败');
  }

  if (!verifyNotifySignature(req.headers, rawBody, platformPem)) {
    console.warn('[wechatPayAssessment] notify: 验签失败', {
      platformCertPath: cfg.platformCertPath || null,
      serial,
      sigType,
      timestamp,
      nonce: nonce ? String(nonce).slice(0, 8) + '...' : null,
      signaturePrefix: signature ? String(signature).slice(0, 16) + '...' : null,
      bodyLen
    });
    return replyFail('验签失败');
  }

  let bodyJson;
  try {
    bodyJson = JSON.parse(rawBody);
  } catch (e) {
    return replyFail('body 非法');
  }

  if (!bodyJson.resource) {
    return replyOk();
  }

  let decrypted;
  try {
    decrypted = decryptNotifyResource(bodyJson.resource, cfg.apiV3Key);
  } catch (e) {
    console.warn('[wechatPayAssessment] notify decrypt:', e.message);
    return replyFail('解密失败');
  }

  const outTradeNo = decrypted.out_trade_no;
  const tradeState = decrypted.trade_state;
  const transactionId = decrypted.transaction_id;

  if (!outTradeNo || tradeState !== 'SUCCESS') {
    return replyOk();
  }

  try {
    await ensureWxPayOrdersTable();
    const [ords] = await pool.execute(
      'SELECT * FROM compat_wx_pay_orders WHERE out_trade_no = ? LIMIT 1',
      [outTradeNo]
    );
    const ord = ords && ords[0];
    if (!ord) {
      return replyOk();
    }
    if (ord.status === 'SUCCESS') {
      return replyOk();
    }

    const amountTotal = decrypted.amount && decrypted.amount.total != null ? Number(decrypted.amount.total) : null;
    if (amountTotal != null && amountTotal !== Number(ord.amount_fen)) {
      console.warn('[wechatPayAssessment] notify: 金额不一致', amountTotal, ord.amount_fen);
      return replyFail('金额不一致');
    }

    await pool.execute(
      'UPDATE compat_wx_pay_orders SET status = ?, transaction_id = ? WHERE out_trade_no = ?',
      ['SUCCESS', transactionId || null, outTradeNo]
    );

    const coopId = Number(ord.cooperation_application_id);
    const [crows] = await pool.execute(
      'SELECT id, extra_json FROM compat_cooperation_applications WHERE id = ? LIMIT 1',
      [coopId]
    );
    const crow = crows && crows[0];
    if (crow) {
      let ex = {};
      try {
        ex = crow.extra_json ? JSON.parse(crow.extra_json) : {};
      } catch (_) {
        ex = {};
      }
      ex.assessmentFee = ex.assessmentFee || {};
      ex.assessmentFee.paid = true;
      ex.assessmentFee.paidAt = new Date().toISOString();
      ex.assessmentFee.confirmedBy = 'wechat_jsapi';
      ex.assessmentFee.wechatTransactionId = transactionId || null;
      ex.assessmentFee.wechatOutTradeNo = outTradeNo;
      await pool.execute(
        'UPDATE compat_cooperation_applications SET extra_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [JSON.stringify(ex), coopId]
      );
    }

    return replyOk();
  } catch (e) {
    console.warn('[wechatPayAssessment] notify handler:', e.message);
    return replyFail(e.message);
  }
}

function getPublicConfig(req, res) {
  const cfg = loadConfig();
  const mpSecret = (process.env.WECHAT_MP_SECRET || '').trim();
  return res.json({
    success: true,
    data: {
      jsapiEnabled: cfg.isReady(),
      appId: cfg.isReady() ? cfg.appid : null,
      oauthForOpenId: !!(mpSecret && cfg.appid)
    }
  });
}

function sanitizeNextPath(p) {
  let s = String(p || '/user/profile.html').trim();
  if (!s.startsWith('/')) s = `/${s}`;
  if (s.includes('..') || s.includes('\0')) return '/user/profile.html';
  const pathOnly = s.split('?')[0];
  if (!pathOnly.startsWith('/user/')) return '/user/profile.html';
  return pathOnly || '/user/profile.html';
}

function siteOriginFromReq(req) {
  const env = (process.env.PUBLIC_SITE_ORIGIN || '').trim().replace(/\/$/, '');
  if (env) return env;
  let proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  if (proto !== 'http' && proto !== 'https') proto = 'https';
  const host = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  if (!host) return 'https://localhost';
  return `${proto}://${host}`;
}

function oauthRedirectUri(req) {
  const fixed = (process.env.WECHAT_MP_OAUTH_REDIRECT_URI || '').trim();
  if (fixed) return fixed;
  return `${siteOriginFromReq(req)}/api/v1/pay/wechat/assessment/oauth-callback`;
}

function httpsGetJson(urlStr) {
  return new Promise((resolve, reject) => {
    https
      .get(urlStr, (r) => {
        let raw = '';
        r.on('data', (c) => {
          raw += c;
        });
        r.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(new Error('JSON 解析失败'));
          }
        });
      })
      .on('error', reject);
  });
}

/**
 * GET /api/v1/pay/wechat/assessment/oauth-url?next=/user/profile.html&coopId=1
 * Header: Authorization Bearer（须已登录求职者）
 */
async function getMpOAuthUrl(req, res) {
  const cfg = loadConfig();
  const secret = (process.env.WECHAT_MP_SECRET || '').trim();
  if (!cfg.appid || !secret) {
    return res.status(503).json({
      success: false,
      message: '未配置公众号网页授权：请在环境变量中设置 WECHAT_MP_SECRET，并保证 WECHAT_PAY_APPID 为同一公众号 AppID'
    });
  }
  const role = String(req.user && req.user.role ? req.user.role : '').toLowerCase();
  if (!['candidate', 'jobseeker', 'user'].includes(role)) {
    return res.status(403).json({ success: false, message: '仅求职者可发起授权' });
  }
  const next = sanitizeNextPath(req.query.next);
  const coopRaw = req.query.coopId != null ? String(req.query.coopId).replace(/\D/g, '') : '';
  const stateObj = { next, coop: coopRaw || '', ts: Date.now() };
  const state = Buffer.from(JSON.stringify(stateObj), 'utf8').toString('base64url');
  const redirectUri = oauthRedirectUri(req);
  const wxUrl =
    'https://open.weixin.qq.com/connect/oauth2/authorize?appid=' +
    encodeURIComponent(cfg.appid) +
    '&redirect_uri=' +
    encodeURIComponent(redirectUri) +
    '&response_type=code&scope=snsapi_base&state=' +
    encodeURIComponent(state) +
    '#wechat_redirect';
  return res.json({ success: true, data: { url: wxUrl } });
}

/**
 * 微信授权回调（公网 GET，无登录态）
 */
async function mpOAuthCallback(req, res) {
  const code = req.query.code ? String(req.query.code) : '';
  const stateRaw = req.query.state ? String(req.query.state) : '';
  if (!code) {
    return res.status(400).send('缺少 code');
  }
  let next = '/user/profile.html';
  let coop = '';
  try {
    const stateObj = JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf8'));
    if (stateObj && typeof stateObj.next === 'string') next = sanitizeNextPath(stateObj.next);
    if (stateObj && stateObj.coop != null) coop = String(stateObj.coop).replace(/\D/g, '');
  } catch (_) {
    next = '/user/profile.html';
  }
  const cfg = loadConfig();
  const secret = (process.env.WECHAT_MP_SECRET || '').trim();
  if (!cfg.appid || !secret) {
    return res.status(503).send('服务器未配置 WECHAT_MP_SECRET');
  }
  const tokenUrl =
    'https://api.weixin.qq.com/sns/oauth2/access_token?appid=' +
    encodeURIComponent(cfg.appid) +
    '&secret=' +
    encodeURIComponent(secret) +
    '&code=' +
    encodeURIComponent(code) +
    '&grant_type=authorization_code';
  let j;
  try {
    j = await httpsGetJson(tokenUrl);
  } catch (e) {
    return res.status(502).send('请求微信失败');
  }
  if (!j || j.errcode || !j.openid) {
    return res.status(400).send((j && j.errmsg) || '换取 openid 失败');
  }
  const openid = String(j.openid);
  const origin = siteOriginFromReq(req);
  let hash = 'wx_oid=' + encodeURIComponent(openid);
  if (coop) hash += '&fee_coop=' + encodeURIComponent(coop);
  const target = `${origin}${next}#${hash}`;
  return res.redirect(302, target);
}

module.exports = {
  createJsapiPrepay,
  createNativePrepay,
  handleNotify,
  getPublicConfig,
  getMpOAuthUrl,
  mpOAuthCallback
};
