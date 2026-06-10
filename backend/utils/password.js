'use strict';
const crypto = require('crypto');
const bcrypt = require('bcrypt');

const PBKDF2_ITERATIONS = 200000;
const PBKDF2_KEYLEN = 64;
const PBKDF2_DIGEST = 'sha256';
const PBKDF2_PREFIX = 'pbkdf2:';

/**
 * 使用 PBKDF2-SHA256 哈希密码（原生异步，不占 libuv 线程池）
 */
function hashPbkdf2(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.pbkdf2(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST, (err, key) => {
      if (err) return reject(err);
      resolve(`${PBKDF2_PREFIX}${PBKDF2_ITERATIONS}:${salt}:${key.toString('hex')}`);
    });
  });
}

/**
 * 验证 PBKDF2 密码
 */
function verifyPbkdf2(password, stored) {
  return new Promise((resolve, reject) => {
    const parts = stored.split(':');
    // 格式: pbkdf2:iterations:salt:hash
    const iterations = parseInt(parts[1], 10);
    const salt = parts[2];
    const hash = parts[3];
    crypto.pbkdf2(password, salt, iterations, PBKDF2_KEYLEN, PBKDF2_DIGEST, (err, key) => {
      if (err) return reject(err);
      resolve(key.toString('hex') === hash);
    });
  });
}

/**
 * 统一密码验证入口（自动识别新旧格式，登录时懒迁移）
 * @param {string} plainPassword - 明文密码
 * @param {string} storedHash - 存储的哈希（bcrypt 或 pbkdf2: 前缀）
 * @returns {Promise<{match: boolean, newHash: string|null}>}
 *   newHash 非 null 表示应更新存储的哈希（懒迁移）
 */
async function verifyPassword(plainPassword, storedHash) {
  if (!storedHash) return { match: false, newHash: null };

  if (storedHash.startsWith(PBKDF2_PREFIX)) {
    // 新格式：PBKDF2
    const match = await verifyPbkdf2(plainPassword, storedHash);
    return { match, newHash: null };
  } else {
    // 旧格式：bcrypt — 验证通过后自动升级
    const match = await bcrypt.compare(plainPassword, storedHash);
    if (match) {
      const newHash = await hashPbkdf2(plainPassword);
      return { match: true, newHash };
    }
    return { match: false, newHash: null };
  }
}

/**
 * 哈希新密码（统一使用 PBKDF2）
 */
function hashPassword(password) {
  return hashPbkdf2(password);
}

module.exports = { hashPassword, verifyPassword, hashPbkdf2, verifyPbkdf2 };
