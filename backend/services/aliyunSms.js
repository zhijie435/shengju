/**
 * 阿里云短信服务 SendSms（验证码、业务通知共用）
 *
 * 环境变量：
 *   ALIYUN_SMS_ACCESS_KEY_ID      RAM 子账号 AccessKey（勿用主账号）
 *   ALIYUN_SMS_ACCESS_KEY_SECRET
 *   ALIYUN_SMS_SIGN_NAME          已审核通过的短信签名
 *   ALIYUN_SMS_TEMPLATE_CODE      验证码模板 CODE（登录、企业短信登录、注册默认共用），模板正文需含变量 ${code}
 *   ALIYUN_SMS_TEMPLATE_CODE_REGISTER 可选：仅「注册」场景发码时使用；不配置则注册与登录共用 ALIYUN_SMS_TEMPLATE_CODE
 *   ALIYUN_SMS_TEMPLATE_NOTIFY    可选：通知类模板 CODE，变量名与控制台一致，如 ${name}、${content}
 *
 * 可选：ALIYUN_SMS_ENABLED=1 时强制要求上述必填项齐全，否则 isConfigured() 为 false
 * 可选：ALIYUN_SMS_REGION_ID 默认 cn-hangzhou（国内短信 POP 接口常需与地域一致）
 */
const Core = require('@alicloud/pop-core');

/** 去掉首尾空白、BOM、零宽字符（避免 .env 或复制签名时肉眼看不出来导致阿里云报「找不到签名」） */
function cleanEnvStr(s) {
  return String(s || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '');
}

function smsRegionId() {
  return cleanEnvStr(process.env.ALIYUN_SMS_REGION_ID) || 'cn-hangzhou';
}

function formatSendSmsError(res) {
  if (!res || typeof res !== 'object') return String(res);
  const parts = [res.Message || res.message || 'SendSms 失败'];
  if (res.Code && res.Code !== 'OK') parts.push('Code=' + res.Code);
  if (res.RequestId) parts.push('RequestId=' + res.RequestId);
  return parts.join(' | ');
}

/**
 * 将阿里云返回的英文/技术文案转为用户可读说明（仍把原始信息记在服务端日志）
 */
function humanizeAliyunSmsSendError(raw) {
  const m = String(raw || '');
  if (!m) return '短信发送失败，请稍后重试';
  if (m.includes('BUSINESS_LIMIT_CONTROL') || m.includes('触发小时级流控') || m.includes('触发天级流控')) {
    return (
      '短信发送过于频繁，已触发阿里云频控（同一号码在约 1 小时内可接收的验证码条数有限，常见为 5 条）。' +
      '请间隔一段时间后再试，或换其他手机号测试；企业用户可在阿里云短信服务控制台查看/申请提升发送额度。'
    );
  }
  if (m.includes('MOBILE_NUMBER_ILLEGAL') || m.includes('手机号格式')) {
    return '手机号格式不符合阿里云短信要求，请检查号码是否正确。';
  }
  if (m.includes('SMS_SIGNATURE_ILLEGAL') || m.includes('isv.SMS_SIGNATURE')) {
    return '短信签名未通过审核或与控制台不一致，请联系管理员检查环境变量 ALIYUN_SMS_SIGN_NAME。';
  }
  if (m.includes('SMS_TEMPLATE_ILLEGAL') || m.includes('isv.SMS_TEMPLATE')) {
    return '短信模板未通过审核或模板 CODE 配置错误，请联系管理员检查 ALIYUN_SMS_TEMPLATE_CODE 等环境变量。';
  }
  if (m.includes('Throttling.User') || m.includes('QPS')) {
    return '短信接口请求过于频繁，请稍后再试。';
  }
  return m;
}

/**
 * pop-core：业务失败时 json.Code 不在 OK 集合里会直接 throw，错误体在 err.data
 */
async function sendSmsPop(client, params) {
  try {
    const res = await client.request('SendSms', params, { method: 'POST' });
    if (res.Code !== 'OK') {
      throw new Error(formatSendSmsError(res));
    }
    return res;
  } catch (e) {
    if (e && e.data && typeof e.data === 'object') {
      throw new Error(formatSendSmsError(e.data));
    }
    throw e;
  }
}

function getClient() {
  const accessKeyId = cleanEnvStr(process.env.ALIYUN_SMS_ACCESS_KEY_ID);
  const accessKeySecret = cleanEnvStr(process.env.ALIYUN_SMS_ACCESS_KEY_SECRET);
  if (!accessKeyId || !accessKeySecret) return null;
  return new Core({
    accessKeyId,
    accessKeySecret,
    endpoint: 'https://dysmsapi.aliyuncs.com',
    apiVersion: '2017-05-25'
  });
}

function isConfigured() {
  const forced = String(process.env.ALIYUN_SMS_ENABLED || '').toLowerCase();
  if (forced === '0' || forced === 'false') return false;
  const sign = cleanEnvStr(process.env.ALIYUN_SMS_SIGN_NAME);
  const main = cleanEnvStr(process.env.ALIYUN_SMS_TEMPLATE_CODE);
  const reg = cleanEnvStr(process.env.ALIYUN_SMS_TEMPLATE_CODE_REGISTER);
  return !!(getClient() && sign && (main || reg));
}

/** 注册场景可单独模板；未配置则回落到通用验证码模板 */
function resolveVerificationTemplateCode(purpose) {
  const main = cleanEnvStr(process.env.ALIYUN_SMS_TEMPLATE_CODE);
  const reg = cleanEnvStr(process.env.ALIYUN_SMS_TEMPLATE_CODE_REGISTER);
  if (purpose === 'register' && reg) return reg;
  return main || reg || '';
}

function normalizePhoneCn(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) return d;
  if (d.length === 13 && d.startsWith('86')) return d.slice(2);
  return d;
}

/**
 * 登录/注册验证码：模板变量一般为 { "code": "123456" }
 * @param {{ purpose?: 'register'|'general' }} [opts]
 */
async function sendVerificationCode(phone, code, opts) {
  const purpose =
    opts && String(opts.purpose || '').toLowerCase() === 'register' ? 'register' : 'general';
  const client = getClient();
  const signName = cleanEnvStr(process.env.ALIYUN_SMS_SIGN_NAME);
  const templateCode = resolveVerificationTemplateCode(purpose);
  if (!client || !signName || !templateCode) {
    throw new Error(
      '短信未配置完整（AccessKey、ALIYUN_SMS_SIGN_NAME、验证码模板 ALIYUN_SMS_TEMPLATE_CODE 或注册模板 ALIYUN_SMS_TEMPLATE_CODE_REGISTER）'
    );
  }
  const phoneNumbers = normalizePhoneCn(phone);
  if (phoneNumbers.length !== 11 || !phoneNumbers.startsWith('1')) {
    throw new Error('手机号格式不正确');
  }
  return sendSmsPop(client, {
    RegionId: smsRegionId(),
    PhoneNumbers: phoneNumbers,
    SignName: signName,
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify({ code: String(code) })
  });
}

/**
 * 业务通知：templateParam 的 key 必须与阿里云模板中变量名一致（不含 ${}）
 * 例：模板「尊敬的${name}，${content}」→ { name: '张三', content: '您的报名已审核通过' }
 */
async function sendTemplateSms(phone, templateCode, templateParam) {
  const client = getClient();
  const signName = cleanEnvStr(process.env.ALIYUN_SMS_SIGN_NAME);
  const tpl = cleanEnvStr(templateCode);
  if (!client || !signName || !tpl) {
    throw new Error('短信未配置完整或缺少模板 CODE');
  }
  const phoneNumbers = normalizePhoneCn(phone);
  if (phoneNumbers.length !== 11 || !phoneNumbers.startsWith('1')) {
    throw new Error('手机号格式不正确');
  }
  const param =
    templateParam && typeof templateParam === 'object' ? templateParam : JSON.parse(String(templateParam || '{}'));
  return sendSmsPop(client, {
    RegionId: smsRegionId(),
    PhoneNumbers: phoneNumbers,
    SignName: signName,
    TemplateCode: tpl,
    TemplateParam: JSON.stringify(param)
  });
}

/** 使用环境变量中的通知模板（ALIYUN_SMS_TEMPLATE_NOTIFY）发一条短信 */
async function sendNotifyWithDefaultTemplate(phone, templateParam) {
  const tpl = cleanEnvStr(process.env.ALIYUN_SMS_TEMPLATE_NOTIFY);
  if (!tpl) {
    throw new Error('未配置 ALIYUN_SMS_TEMPLATE_NOTIFY');
  }
  return sendTemplateSms(phone, tpl, templateParam);
}

module.exports = {
  isConfigured,
  sendVerificationCode,
  sendTemplateSms,
  sendNotifyWithDefaultTemplate,
  normalizePhoneCn,
  humanizeAliyunSmsSendError
};
