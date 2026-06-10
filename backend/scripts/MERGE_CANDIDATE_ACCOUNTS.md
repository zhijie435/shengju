# 合并重复考生账号与防重复建号

## 〇、按手机号全自动合并（主号规则与 `findByPhone` 一致）

库内同一规范化手机号对应多行 `qms_users` 时，脚本会**自动选主号**（优先 `role=user`，其次 `candidate`/`jobseeker`，同序取 `id` 最小），把各副号的报名/会话等迁到主号，并给副号 `phone=NULL`，并依次尝试 `status=inactive` / `suspended` / `disabled`（以库 ENUM 为准），避免副号再用手机登录。

```bash
cd backend
node scripts/merge_qms_users_by_phone.js              # 仅预览
node scripts/merge_qms_users_by_phone.js --execute  # 正式执行
node scripts/merge_qms_users_by_phone.js --phone=18092263819 --execute   # 只处理一个号
```

说明见 `merge_qms_users_by_phone.js` 文件头；**执行前请备份库**。

## 一、先合并（历史数据）

1. **定主号 `to`**：求职者个人中心长期使用的号，建议 `role=user` 且已绑定手机（例：`id=33`，`username=gaoyajun`）。在 MariaDB 中确认：

   ```sql
   USE shengju;
   SELECT id, username, phone, real_name, role FROM qms_users WHERE id = 你的主号;
   ```

2. **试跑（不落库）**：在 `backend` 目录、已配置 `.env` 数据库时：

   ```bash
   node scripts/reassign_exam_data_from_cand_to_main_user.js --to=主号id --from-all-phone=11位手机 --dry-run
   ```

3. **正式执行**（确认输出无误后，去掉 `--dry-run`）：

   ```bash
   node scripts/reassign_exam_data_from_cand_to_main_user.js --to=主号id --from-all-phone=11位手机
   ```

4. **仅某一场考试**（可选）：

   ```bash
   node scripts/reassign_exam_data_from_cand_to_main_user.js --to=33 --from-all-phone=18000000000 --exam-id=55 --dry-run
   ```

5. 合并后 `qms_users` 里旧 `cand_` 行**不会自动删除**（避免外键/误删）；考试数据已归到主号。主号需**重新登录**后看「专业测评 / 消息」。

6. 单个从副到主：`--from=副id --to=主id`（参数见 `reassign_exam_data_from_cand_to_main_user.js` 文件头注释）。

## 二、长期：禁止「只有姓名就新建」

已在 `UserModel.createCandidateOrFind` 中约定：**新建**考生前须至少有 **手机号（≥10 位数字）**、**身份证（≥15 位）** 或 **准考证号（非空）** 之一，否则返回错误，不再生成无手机无证的 `cand_` 号。

- 若需临时恢复旧行为（仅运维/测试）：在 `.env` 中设置 `ALLOW_CANDIDATE_NO_PHONE_ID=1` 后重启 Node。

## 三、业务侧建议

- Excel/企业导入模板：**姓名 + 手机 + 身份证/准考证** 至少填到可匹配。
- 圣举批次 `matchByExamNumberOnly`：仍要求行内有**准考证号**，否则也会命中「三无一」而失败（符合防刷号目标）。
