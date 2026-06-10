const { pool } = require('../config/database');

async function tableExists(name) {
  try {
    const [[r]] = await pool.execute(
      `SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`,
      [name]
    );
    return r && Number(r.c) > 0;
  } catch (e) {
    return false;
  }
}

/** 仅允许白名单内的列名，防 SQL 注入 */
function sqlIdent(col) {
  if (!col || !/^[a-zA-Z0-9_]+$/.test(String(col))) {
    throw new Error('非法列名');
  }
  return '`' + col + '`';
}

let _enterpriseColCache = null;

/**
 * 线上 enterprises 表结构不一致：有的库无 name 列而用 company_name 等。
 * information_schema 失败时不得默认假定存在 name 列。
 */
async function getEnterpriseColumnMap() {
  if (_enterpriseColCache) return _enterpriseColCache;
  const buildFromFields = (fieldNames) => {
    const lowerToActual = new Map();
    for (const raw of fieldNames || []) {
      const actual = String(raw);
      lowerToActual.set(actual.toLowerCase(), actual);
    }
    const pick = (candidates) => {
      for (const col of candidates) {
        const a = lowerToActual.get(String(col).toLowerCase());
        if (a) return a;
      }
      return null;
    };
    return {
      name: pick([
        'name',
        'company_name',
        'enterprise_name',
        'org_name',
        'title',
        'firm_name',
        'ent_name',
        'corp_name',
        'unit_name',
        'qymc',
        'companyname'
      ]),
      phone: pick(['contact_phone', 'phone', 'mobile', 'tel', 'contact_mobile', 'contact_tel']),
      email: pick(['contact_email', 'email', 'contact_mail']),
      industry: pick(['industry', 'sector', 'business_scope', 'business_type']),
      city: pick(['city', 'region', 'district', 'address', 'area']),
      contact: pick(['contact_name', 'contact', 'legal_person', 'legal_representative', 'liaison']),
      created: pick(['created_at', 'create_time', 'gmt_create']),
      updated: pick(['updated_at', 'update_time', 'gmt_modified', 'modified_at']),
      status: pick(['status', 'state', 'audit_status']),
      /** 与账号 status 分离的「资质认证」状态（企业端提交材料后常用） */
      verificationStatus: pick(['verification_status', 'verify_status', 'cert_status', 'auth_status'])
    };
  };

  try {
    let fieldNames = [];
    const [rows] = await pool.execute(
      `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'enterprises'`
    );
    fieldNames = (rows || []).map((r) => String(r.c));
    if (fieldNames.length === 0 && (await tableExists('enterprises'))) {
      try {
        const [showRows] = await pool.query('SHOW COLUMNS FROM enterprises');
        fieldNames = (showRows || []).map((r) => r.Field);
      } catch (e2) {
        console.warn('[enterpriseSchema] SHOW COLUMNS enterprises:', e2.message);
      }
    }
    _enterpriseColCache = buildFromFields(fieldNames);
    return _enterpriseColCache;
  } catch (e) {
    console.warn('[enterpriseSchema] getEnterpriseColumnMap:', e.message);
    try {
      if (await tableExists('enterprises')) {
        const [showRows] = await pool.query('SHOW COLUMNS FROM enterprises');
        _enterpriseColCache = buildFromFields((showRows || []).map((r) => r.Field));
        return _enterpriseColCache;
      }
    } catch (e2) {
      console.warn('[enterpriseSchema] getEnterpriseColumnMap fallback:', e2.message);
    }
    _enterpriseColCache = {
      name: null,
      phone: null,
      email: null,
      industry: null,
      city: null,
      contact: null,
      created: null,
      updated: null,
      status: null,
      verificationStatus: null
    };
    return _enterpriseColCache;
  }
}

module.exports = { tableExists, sqlIdent, getEnterpriseColumnMap };
