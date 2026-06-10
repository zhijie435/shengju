#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "已创建 .env，请按需编辑 JWT_SECRET 等后重新运行本脚本。"
fi
docker compose up --build
