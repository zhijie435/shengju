# 指导语/结束语/测评要素未同步 — 排查说明

## 1. 已做的代码修复

- **更新试卷时始终写入 project_info**：之前若后端检测不到 `project_info` 列会走“不写 project_info”的分支，已改为更新试卷时**一律写入** `project_info`，避免漏写。
- **诊断接口**：可用下面步骤查看数据库里该试卷是否已有内容。

## 2. 用诊断接口查具体原因

1. 确认**本场面试考试关联的试卷 ID**（在考试编辑页或接口里看 `paper_id`，例如 `123`）。
2. 在浏览器或 Postman 访问（把 `123` 换成实际试卷 ID）：
   ```
   GET http://localhost:3000/api/exam-papers/123/project-info-debug
   ```
3. 看返回的 `data`：
   - `hasContent: true`：库里已有指导语/结束语/测评要素；若前端仍不显示，多半是**前端没用到这张试卷**（例如用了别的 paper_id）或缓存。
   - `hasContent: false` 且 `project_info` 为 null 或空：**数据库里从没写入过**，需要从试题编辑里对**这张试卷**保存一次（见下）。

## 3. 正确写入的步骤（必须针对“本场考试用的试卷”）

1. 在**考试系统**打开该面试考试 → **面试设置** 或 **答题预览**。
2. 点击 **「在试题编辑中打开本试卷」**（会带上本场考试的 `paper_id`）。
3. 在试题编辑里打开 **考试项目设置**，填写 **指导语、结束指导语、测评要素**。
4. 点击 **「保存试题」** 或 **「从预览保存」**（此时请求会带 `paperId`，后端会**更新**这张试卷而不是新建）。
5. 再点 **「从试卷同步」** 或刷新答题预览查看。

## 4. 看后端日志确认是否带上了 projectInfo 和 paperId

保存试卷时，后端会打印类似：

```
📋 [后端] 请求数据: {
  paperId: 123,           // 有值表示更新该试卷；未传会新建
  hasProjectInfo: true,   // 为 true 表示带了指导语/测评要素等
  projectInfoKeys: ['guidingWords', 'closingWords', 'evaluationElements', ...],
  ...
}
```

若 `paperId` 为 `(未传，将新建试卷)`，说明前端没传试卷 ID，会一直新建试卷，考试关联的试卷就不会被更新。  
若 `hasProjectInfo: false`，说明前端没传考试项目设置，需要检查试题编辑里是否填了并随保存请求发出。

## 5. 迁移

若在**其他环境**或**其他库**使用，需在该环境的 `backend` 目录执行：

```bash
npm run migrate:project-info
```

或：

```bash
node scripts/run_project_info_migration.js
```

当前环境已执行过且验证 `project_info` 列存在。
