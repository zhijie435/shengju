/**
 * 判断考试会话是否属于当前登录用户。
 * mysql2 对 BIGINT 等字段可能返回 string，若用 session.user_id !== req.user.id 会与 number 型 JWT 误判不一致（403）。
 */
function sessionOwnedByUser(session, reqUserId) {
  if (!session || reqUserId == null) return false;
  return Number(session.user_id) === Number(reqUserId);
}

module.exports = { sessionOwnedByUser };
