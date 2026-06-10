# 考试汇总数据和评估报告功能说明

## 功能概述

本功能为阅卷系统增加了两个重要模块：

1. **考试汇总数据模块**：自动统计考生的考试数据，包括总分、各题型得分、各难度得分、各考察目的得分等
2. **AI评估报告模块**：基于每道小题的考察目的，使用AI自动生成详细的评估报告

## 数据库迁移

### 执行迁移

运行以下命令执行数据库迁移：

```bash
node backend/scripts/run_exam_summaries_migration.js
```

或者在Windows上：

```bash
cd backend
node scripts\run_exam_summaries_migration.js
```

### 迁移内容

迁移脚本会执行以下操作：

1. 创建 `exam_summaries` 表（考试汇总数据表）
2. 创建 `exam_evaluation_reports` 表（评估报告表）
3. 为 `exam_paper_sub_questions` 表添加 `exam_purpose` 字段（考察目的）

## 环境配置

在 `backend/.env` 文件中添加以下配置：

```env
# DeepSeek AI配置（用于生成评估报告）
DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_API_URL=https://api.deepseek.com/v1/chat/completions
```

**注意**：如果没有配置DeepSeek API密钥，评估报告生成功能将不可用，但汇总数据功能仍然可以正常使用。

## 功能说明

### 1. 考试汇总数据

#### 自动生成

当所有题目阅卷完成后，系统会自动生成汇总数据。汇总数据包括：

- **基础统计**：总分、满分、得分率、答题时长
- **题型统计**：各题型的得分情况、正确率
- **难度统计**：各难度的得分情况、正确率
- **考察目的统计**：各考察目的的得分情况、正确率
- **知识点掌握情况**：基于考察目的的知识点掌握程度分析

#### API接口

- `GET /api/exam-summaries/:sessionId` - 获取单个考生的汇总数据
- `GET /api/exam-summaries/exam/:examId` - 获取考试的所有考生汇总数据（支持分页）
- `POST /api/exam-summaries/generate/:sessionId` - 手动生成汇总数据
- `GET /api/exam-summaries/exam/:examId/statistics` - 获取考试整体统计信息

### 2. AI评估报告

#### 自动生成

当所有题目阅卷完成后，系统会自动调用AI服务生成评估报告。报告内容包括：

- **总体评价**：对考生的整体表现进行评价
- **各考察目的的表现分析**：详细分析每个考察目的的表现
- **优势与不足**：指出考生的优势和需要改进的地方
- **改进建议**：提供针对性的学习建议

#### API接口

- `GET /api/evaluation-reports/:sessionId` - 获取单个考生的评估报告
- `POST /api/evaluation-reports/generate/:sessionId` - 手动生成评估报告
- `GET /api/evaluation-reports/exam/:examId` - 获取考试的所有评估报告
- `GET /api/evaluation-reports/:sessionId/download` - 下载评估报告（HTML格式）

## 使用流程

### 1. 设置考察目的

在创建试卷时，为每道小题设置"考察目的"字段。这个字段将用于：

- 统计各考察目的的得分情况
- 分析知识点掌握情况
- 生成针对性的评估报告

### 2. 阅卷

阅卷员完成阅卷后，系统会自动：

1. 检查是否所有题目都已阅卷完成
2. 如果完成，自动生成汇总数据
3. 如果完成且配置了AI服务，自动生成评估报告

### 3. 查看结果

- 在考试管理页面可以查看所有考生的汇总数据
- 点击考生详情可以查看详细的评估报告
- 支持导出汇总数据和评估报告

## 注意事项

1. **考察目的字段**：建议在创建试卷时设置每道题的考察目的，这样生成的报告会更加详细和准确
2. **AI服务配置**：评估报告功能需要配置DeepSeek API密钥，如果没有配置，汇总数据功能仍然可用
3. **异步生成**：评估报告生成是异步的，可能需要一些时间，请耐心等待
4. **权限控制**：只有管理员和企业用户可以查看和生成汇总数据和评估报告

## 故障排除

### 汇总数据未生成

- 检查是否所有题目都已阅卷完成
- 检查数据库表是否正确创建
- 查看服务器日志了解详细错误信息

### 评估报告未生成

- 检查是否配置了DeepSeek API密钥
- 检查网络连接是否正常
- 查看服务器日志了解详细错误信息
- 如果AI服务调用失败，可以手动重新生成

### 数据库迁移失败

- 检查数据库连接配置是否正确
- 检查数据库用户是否有足够的权限
- 确保主数据库（question_management_shared）已创建

## 技术支持

如有问题，请查看：
- 服务器日志文件
- 数据库错误日志
- API响应中的错误信息
