/**
 * 微信支付 APIv3 — 公众号 JSAPI 测评缴费
 * 依赖环境变量见 backend/docs/wechat-pay-jsapi-env.md
 */
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');

/** 提取商户私钥 PEM（去 BOM），优先 RSA/PKCS#8 私钥块，避免误取文件中靠前的 CERTIFICATE */
function extractFirstPemBlock(pemOrText) {
  if (!pemOrText || typeof pemOrText !== 'string') return '';
  const s = pemOrText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const priv = s.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----/);
  if (priv) return priv[0].trim();
  const m = s.match(/-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/);
  return (m ? m[0] : s).trim();
}

let _wxMerchantKeyPemNorm = '';
let _wxMerchantKeyObj = null;

function getMerchantPrivateKeyObject(privateKeyPem) {
  const norm = extractFirstPemBlock(privateKeyPem);
  if (!norm) {
    throw new Error('商户私钥 PEM 为空，请检查 WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH 是否可读');
  }
  if (norm.includes('BEGIN CERTIFICATE')) {
    throw new Error(
      'WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH 指向了证书 apiclient_cert.pem，应改为商户私钥 apiclient_key.pem（以 BEGIN PRIVATE KEY 或 BEGIN RSA PRIVATE KEY 开头）'
    );
  }
  if (!/BEGIN (RSA )?PRIVATE KEY/.test(norm)) {
    throw new Error('商户私钥不是可识别的 PEM 私钥格式，请使用微信商户平台「API 安全」中下载的 apiclient_key.pem');
  }
  if (norm.includes('BEGIN ENCRYPTED PRIVATE KEY')) {
    throw new Error(
      '商户私钥为加密 PKCS#8，请先在服务器执行：openssl pkcs8 -topk8 -nocrypt -in apiclient_key.pem -out apiclient_key_plain.pem，再将 WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH 指向 apiclient_key_plain.pem'
    );
  }
  if (_wxMerchantKeyPemNorm === norm && _wxMerchantKeyObj) return _wxMerchantKeyObj;
  let keyObj;
  try {
    keyObj = crypto.createPrivateKey({ key: norm, format: 'pem' });
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e);
    const err = new Error(
      '无法解析商户私钥（' +
        msg +
        '）。请确认：① 路径为 apiclient_key.pem 且与当前商户证书序列号配套；② 若含 unsupported/DECODER，可在服务器执行：openssl pkcs8 -topk8 -nocrypt -in apiclient_key.pem -out apiclient_key_pkcs8.pem，并将环境变量改为指向 apiclient_key_pkcs8.pem；③ 勿将站点 SSL 证书或微信平台公钥误当作私钥。'
    );
    err.code = 'WECHAT_MERCHANT_KEY_PARSE';
    throw err;
  }
  if (keyObj.asymmetricKeyType !== 'rsa') {
    throw new Error(
      '微信支付 APIv3 需要 RSA 商户私钥，当前密钥类型为：' + (keyObj.asymmetricKeyType || 'unknown')
    );
  }
  _wxMerchantKeyPemNorm = norm;
  _wxMerchantKeyObj = keyObj;
  return _wxMerchantKeyObj;
}

/** 与微信 v3 Authorization / JSAPI paySign 一致：RSA-SHA256 + Base64 */
function signRSA_SHA256Base64(message, privateKeyPem) {
  const keyObj = getMerchantPrivateKeyObject(privateKeyPem);
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(message);
  sign.end();
  try {
    return sign.sign(keyObj, 'base64');
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e);
    const err = new Error(
      '商户私钥签名失败（' +
        msg +
        '）。可尝试将私钥转为 PKCS#8（openssl pkcs8 -topk8 -nocrypt）或升级 Node 至当前 LTS；仍失败请核对私钥与 WECHAT_PAY_MERCHANT_SERIAL_NO 是否为同一套证书。'
    );
    err.code = 'WECHAT_MERCHANT_KEY_SIGN';
    throw err;
  }
}

function loadConfig() {
  const enabled = String(process.env.WECHAT_PAY_ENABLED || '').toLowerCase() === '1' || String(process.env.WECHAT_PAY_ENABLED || '').toLowerCase() === 'true';
  const appid = (process.env.WECHAT_PAY_APPID || '').trim();
  const mchid = (process.env.WECHAT_PAY_MCHID || '').trim();
  const apiV3Key = (process.env.WECHAT_PAY_API_V3_KEY || '').trim();
  const serialNo = (process.env.WECHAT_PAY_MERCHANT_SERIAL_NO || '').trim();
  const keyPath = (process.env.WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH || '').trim();
  const platformCertPath = (process.env.WECHAT_PAY_PLATFORM_CERT_PATH || '').trim();
  const notifyUrl = (process.env.WECHAT_PAY_NOTIFY_URL || '').trim();

  let privateKeyPem = '';
  if (keyPath && fs.existsSync(keyPath)) {
    privateKeyPem = extractFirstPemBlock(fs.readFileSync(keyPath, 'utf8'));
  }

  return {
    enabled,
    appid,
    mchid,
    apiV3Key,
    serialNo,
    privateKeyPem,
    platformCertPath,
    notifyUrl,
    isReady() {
      return (
        enabled &&
        appid &&
        mchid &&
        apiV3Key.length === 32 &&
        serialNo &&
        privateKeyPem &&
        notifyUrl.startsWith('https://')
      );
    },
    missingHint() {
      const miss = [];
      if (!enabled) miss.push('WECHAT_PAY_ENABLED=1');
      if (!appid) miss.push('WECHAT_PAY_APPID');
      if (!mchid) miss.push('WECHAT_PAY_MCHID');
      if (apiV3Key.length !== 32) miss.push('WECHAT_PAY_API_V3_KEY(32位)');
      if (!serialNo) miss.push('WECHAT_PAY_MERCHANT_SERIAL_NO');
      if (!privateKeyPem) miss.push('WECHAT_PAY_MERCHANT_PRIVATE_KEY_PATH(可读 apiclient_key.pem)');
      if (!notifyUrl.startsWith('https://')) miss.push('WECHAT_PAY_NOTIFY_URL(https 公网可访问)');
      return miss.join('、');
    }
  };
}

function randomNonce(len) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
}

function buildAuthorization(method, urlPath, bodyStr, cfg) {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomNonce(32);
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${bodyStr}\n`;
  const signature = signRSA_SHA256Base64(message, cfg.privateKeyPem);
  const token = [
    `mchid="${cfg.mchid}"`,
    `nonce_str="${nonce}"`,
    `timestamp="${timestamp}"`,
    `serial_no="${cfg.serialNo}"`,
    `signature="${signature}"`
  ].join(',');
  return `WECHATPAY2-SHA256-RSA2048 ${token}`;
}

function httpsJson(method, pathWithQuery, bodyObj, cfg) {
  const bodyStr = bodyObj ? JSON.stringify(bodyObj) : '';
  const auth = buildAuthorization(method, pathWithQuery, bodyStr, cfg);
  const options = {
    hostname: 'api.mch.weixin.qq.com',
    port: 443,
    path: pathWithQuery,
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: auth,
      'User-Agent': 'shengju-talent-backend/1.0'
    }
  };
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (c) => {
        raw += c;
      });
      res.on('end', () => {
        let json = null;
        try {
          json = raw ? JSON.parse(raw) : {};
        } catch (e) {
          return reject(new Error('微信响应非 JSON: ' + raw.slice(0, 200)));
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          return resolve(json);
        }
        const err = new Error((json && json.message) || `HTTP ${res.statusCode}`);
        err.code = json && json.code;
        err.detail = json;
        reject(err);
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/**
 * JSAPI 下单，返回 prepay_id
 */
async function jsapiCreateOrder({ outTradeNo, description, amountFen, openid, cfg }) {
  const path = '/v3/pay/transactions/jsapi';
  const payload = {
    appid: cfg.appid,
    mchid: cfg.mchid,
    description: (description || '测评报名费').slice(0, 127),
    out_trade_no: outTradeNo,
    notify_url: cfg.notifyUrl,
    amount: { total: amountFen, currency: 'CNY' },
    payer: { openid }
  };
  return httpsJson('POST', path, payload, cfg);
}

/**
 * Native 下单（扫码支付），返回 code_url，扫码后金额已锁定无需手输
 */
async function nativeCreateOrder({ outTradeNo, description, amountFen, cfg }) {
  const path = '/v3/pay/transactions/native';
  const payload = {
    appid: cfg.appid,
    mchid: cfg.mchid,
    description: (description || '测评报名费').slice(0, 127),
    out_trade_no: outTradeNo,
    notify_url: cfg.notifyUrl,
    amount: { total: amountFen, currency: 'CNY' }
  };
  return httpsJson('POST', path, payload, cfg);
}

/**
 * 为前端 WeixinJSBridge 生成调起支付参数（signType: RSA）
 */
function buildJsapiPayParams(prepayId, cfg) {
  const timeStamp = String(Math.floor(Date.now() / 1000));
  const nonceStr = randomNonce(32);
  const pkg = `prepay_id=${prepayId}`;
  const signMessage = `${cfg.appid}\n${timeStamp}\n${nonceStr}\n${pkg}\n`;
  const paySign = signRSA_SHA256Base64(signMessage, cfg.privateKeyPem);
  return {
    appId: cfg.appid,
    timeStamp,
    nonceStr,
    package: pkg,
    signType: 'RSA',
    paySign
  };
}

function decryptNotifyResource(resource, apiV3Key) {
  const { ciphertext, associated_data, nonce } = resource;
  const key = Buffer.from(apiV3Key, 'utf8');
  const buf = Buffer.from(ciphertext, 'base64');
  const authTag = buf.subarray(buf.length - 16);
  const data = buf.subarray(0, buf.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'utf8'));
  decipher.setAuthTag(authTag);
  if (associated_data) decipher.setAAD(Buffer.from(associated_data, 'utf8'));
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return JSON.parse(decrypted);
}

function verifyNotifySignature(headers, rawBody, platformCertPem) {
  const signature = headers['wechatpay-signature'];
  const timestamp = headers['wechatpay-timestamp'];
  const nonce = headers['wechatpay-nonce'];
  if (!signature || !timestamp || !nonce) return false;
  const message = `${timestamp}\n${nonce}\n${rawBody}\n`;
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(message);
  verifier.end();
  return verifier.verify(platformCertPem, signature, 'base64');
}

module.exports = {
  loadConfig,
  jsapiCreateOrder,
  nativeCreateOrder,
  buildJsapiPayParams,
  decryptNotifyResource,
  verifyNotifySignature
};
