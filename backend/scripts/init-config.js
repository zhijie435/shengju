#!/usr/bin/env node

/**
 * 初始化环境配置文件
 * 从 .env.example 创建 .env 文件（如果不存在）
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const envExamplePath = path.join(__dirname, '..', '.env.example');
const envPath = path.join(__dirname, '..', '.env');

// 创建 readline 接口
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// 询问用户输入
function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

async function initConfig() {
  console.log('=== 初始化环境配置 ===\n');

  // 检查 .env.example 是否存在
  if (!fs.existsSync(envExamplePath)) {
    console.error('错误: .env.example 文件不存在！');
    process.exit(1);
  }

  // 如果 .env 已存在，询问是否覆盖
  if (fs.existsSync(envPath)) {
    const overwrite = await question('.env 文件已存在，是否覆盖？(y/N): ');
    if (overwrite.toLowerCase() !== 'y') {
      console.log('已取消操作。');
      rl.close();
      return;
    }
  }

  // 读取 .env.example
  const exampleContent = fs.readFileSync(envExamplePath, 'utf8');

  // 询问用户配置项
  console.log('\n请输入配置信息（直接回车使用默认值）：\n');

  const config = {};

  // 数据库配置
  config.DB_HOST = await question(`数据库主机 [localhost]: `) || 'localhost';
  config.DB_PORT = await question(`数据库端口 [3306]: `) || '3306';
  config.DB_USER = await question(`数据库用户名 [root]: `) || 'root';
  config.DB_PASSWORD = await question(`数据库密码 []: `) || '';
  config.MAIN_DB_NAME = await question(`主数据库名称 [question_management_shared]: `) || 'question_management_shared';

  // JWT密钥
  config.JWT_SECRET = await question(`JWT密钥 [your-secret-key-change-in-production]: `) || 'your-secret-key-change-in-production';

  // 服务器配置
  config.PORT = await question(`服务器端口 [3000]: `) || '3000';
  config.NODE_ENV = await question(`运行环境 [development]: `) || 'development';

  // 文件上传配置
  config.UPLOAD_DIR = await question(`上传目录 [./uploads]: `) || './uploads';
  config.MAX_FILE_SIZE = await question(`最大文件大小 [50mb]: `) || '50mb';

  // 生成 .env 文件内容
  let envContent = `# 数据库配置
DB_HOST=${config.DB_HOST}
DB_PORT=${config.DB_PORT}
DB_USER=${config.DB_USER}
DB_PASSWORD=${config.DB_PASSWORD}
MAIN_DB_NAME=${config.MAIN_DB_NAME}

# JWT密钥（生产环境请务必修改为强密码）
JWT_SECRET=${config.JWT_SECRET}

# 服务器配置
PORT=${config.PORT}
NODE_ENV=${config.NODE_ENV}

# 文件上传配置
UPLOAD_DIR=${config.UPLOAD_DIR}
MAX_FILE_SIZE=${config.MAX_FILE_SIZE}
`;

  // 写入 .env 文件
  fs.writeFileSync(envPath, envContent, 'utf8');

  console.log('\n✓ 环境配置文件已创建: backend/.env');
  console.log('\n请检查配置是否正确，然后启动服务器。\n');

  rl.close();
}

// 运行初始化
initConfig().catch((error) => {
  console.error('初始化失败:', error);
  rl.close();
  process.exit(1);
});
