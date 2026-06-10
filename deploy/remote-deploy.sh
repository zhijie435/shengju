#!/usr/bin/env bash
set -euo pipefail

# ===== 可按需修改 =====
APP_DIR="/var/www/exam"
SERVICE_TYPE="node"   # node|httpd|both|none
NODE_SERVICE="exam-backend"
KEEP_BACKUPS=5

# 需要同步的相对路径（相对于 APP_DIR）
SYNC_FILES=(
  "src/assets/deepseek_html_20251230_e6f8db.html"
  "backend/server.js"
)

# 上传临时目录（先传到这里，再覆盖到 APP_DIR）
STAGE_DIR="/root/deploy-temp"

timestamp="$(date +%F-%H%M%S)"
backup_dir="${APP_DIR}/.deploy_backups/${timestamp}"

echo "[1/5] 校验目录..."
mkdir -p "${backup_dir}"
mkdir -p "${STAGE_DIR}"

echo "[2/5] 备份当前线上文件..."
for rel in "${SYNC_FILES[@]}"; do
  src="${APP_DIR}/${rel}"
  if [[ -f "${src}" ]]; then
    mkdir -p "${backup_dir}/$(dirname "${rel}")"
    cp -a "${src}" "${backup_dir}/${rel}"
  fi
done

echo "[3/5] 用临时目录文件覆盖线上..."
for rel in "${SYNC_FILES[@]}"; do
  staged="${STAGE_DIR}/${rel}"
  target="${APP_DIR}/${rel}"
  if [[ -f "${staged}" ]]; then
    mkdir -p "$(dirname "${target}")"
    cp -a "${staged}" "${target}"
  else
    echo "WARN: 未找到待发布文件 ${staged}，跳过"
  fi
done

echo "[4/5] 重启服务..."
case "${SERVICE_TYPE}" in
  node)
    systemctl restart "${NODE_SERVICE}"
    ;;
  httpd)
    systemctl restart httpd
    ;;
  both)
    systemctl restart "${NODE_SERVICE}"
    systemctl restart httpd
    ;;
  none)
    echo "跳过服务重启"
    ;;
  *)
    echo "未知 SERVICE_TYPE=${SERVICE_TYPE}" >&2
    exit 1
    ;;
esac

echo "[5/5] 清理旧备份..."
if [[ -d "${APP_DIR}/.deploy_backups" ]]; then
  ls -1dt "${APP_DIR}/.deploy_backups"/* 2>/dev/null | tail -n +"$((KEEP_BACKUPS + 1))" | xargs -r rm -rf
fi

echo "发布完成。备份目录: ${backup_dir}"
echo "可执行验证: curl -sS http://127.0.0.1:3001/exam/src/app.html >/dev/null && echo OK"
