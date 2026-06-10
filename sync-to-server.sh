#!/bin/bash
# ============================================================
# 增量同步脚本：将本地改动同步到新服务器 182.92.3.126
# 用法：./sync-to-server.sh           增量同步
#       ./sync-to-server.sh --full    全量强制同步
#       ./sync-to-server.sh --status  查看上次同步时间
# ============================================================
set -euo pipefail

REMOTE_HOST="182.92.3.126"
REMOTE_USER="root"
REMOTE_PASS="Beijing@2026"
REMOTE_PROJECT="/data/apps/sjrcw"
LOCAL_PROJECT="$(cd "$(dirname "$0")" && pwd)"
TIMESTAMP_FILE="$LOCAL_PROJECT/.sync-timestamp"
SSH_CMD="sshpass -p '$REMOTE_PASS' ssh -o StrictHostKeyChecking=no -o LogLevel=ERROR $REMOTE_USER@$REMOTE_HOST"
SCP_CMD="sshpass -p '$REMOTE_PASS' scp -o StrictHostKeyChecking=no -o LogLevel=ERROR"

# 排除的目录/文件模式
EXCLUDES=(
  'node_modules'
  '.git'
  '*.log'
  'npm-debug.log*'
  '.DS_Store'
  '.sync-timestamp'
  'release-*'
  'src-tauri/target'
  '.cursor'
  'test-*.js'
  '*.bat'
  '*.exe'
  '.vscode'
  '.idea'
  '*.swp'
  '*.swo'
  'uploads'
)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ──── 显示状态 ────
if [ "${1:-}" = "--status" ]; then
  if [ -f "$TIMESTAMP_FILE" ]; then
    last_ts=$(cat "$TIMESTAMP_FILE")
    echo "上次同步时间: $(date -r "$TIMESTAMP_FILE" '+%Y-%m-%d %H:%M:%S')"
    echo "时间戳: $last_ts"
    # 显示自那以后改动的文件数
    count=$(find "$LOCAL_PROJECT" \
      $(printf "! -path '*/%s/*' " "${EXCLUDES[@]}") \
      -newer "$TIMESTAMP_FILE" -type f 2>/dev/null | wc -l | tr -d ' ')
    echo "待同步文件: $count 个"
  else
    echo "尚未执行过同步"
  fi
  exit 0
fi

# ──── 全量模式 ────
if [ "${1:-}" = "--full" ]; then
  echo -e "${YELLOW}[全量模式] 将同步全部文件${NC}"
  FIND_OPTS=""
else
  if [ -f "$TIMESTAMP_FILE" ]; then
    last_ts=$(cat "$TIMESTAMP_FILE")
    echo -e "${GREEN}[增量模式] 上次同步: $(date -r "$TIMESTAMP_FILE" '+%Y-%m-%d %H:%M:%S')${NC}"
    FIND_OPTS="-newer $TIMESTAMP_FILE"
  else
    echo -e "${YELLOW}[首次同步] 将同步全部文件${NC}"
    FIND_OPTS=""
  fi
fi

# ──── 构建排除参数 ────
FIND_EXCLUDE=""
for pattern in "${EXCLUDES[@]}"; do
  FIND_EXCLUDE="$FIND_EXCLUDE ! -path '*/$pattern' ! -path '*/$pattern/*'"
done

# ──── 查找增量文件 ────
NEW_TIMESTAMP=$(date +%s)
TMP_FILE="/tmp/sync-files-$$.txt"

eval "find \"$LOCAL_PROJECT\" $FIND_EXCLUDE $FIND_OPTS -type f 2>/dev/null" > "$TMP_FILE"
FILE_COUNT=$(wc -l < "$TMP_FILE" | tr -d ' ')

if [ "$FILE_COUNT" -eq 0 ]; then
  echo -e "${GREEN}没有需要同步的文件${NC}"
  # 仍更新时间戳
  echo "$NEW_TIMESTAMP" > "$TIMESTAMP_FILE"
  rm -f "$TMP_FILE"
  exit 0
fi

echo "发现 $FILE_COUNT 个文件需要同步"

# ──── 转换为远程路径并上传 ────
SYNC_COUNT=0
FAIL_COUNT=0

while IFS= read -r local_file; do
  # 计算相对路径
  rel_path="${local_file#$LOCAL_PROJECT/}"
  remote_path="$REMOTE_PROJECT/$rel_path"
  remote_dir=$(dirname "$remote_path")

  # 确保远程目录存在
  $SSH_CMD "mkdir -p '$remote_dir'" 2>/dev/null

  # 上传文件
  if $SCP_CMD "$local_file" "$REMOTE_USER@$REMOTE_HOST:$remote_path" 2>/dev/null; then
    ((SYNC_COUNT++))
  else
    echo -e "${RED}  失败: $rel_path${NC}"
    ((FAIL_COUNT++))
  fi
done < "$TMP_FILE"

# ──── 更新时间戳 ────
echo "$NEW_TIMESTAMP" > "$TIMESTAMP_FILE"

# ──── 重启服务 ────
echo ""
echo -e "${YELLOW}重启远程服务...${NC}"
RESTART_RESULT=$($SSH_CMD "pm2 restart sjrcw-api 2>&1" || echo "FAIL")
if echo "$RESTART_RESULT" | grep -q "online"; then
  echo -e "${GREEN}✓ 服务重启成功${NC}"
else
  echo -e "${RED}✗ 服务重启失败，请手动检查${NC}"
fi

# ──── 输出结果 ────
echo ""
echo "========================================"
echo -e "  同步: ${GREEN}$SYNC_COUNT${NC} 成功, ${RED}$FAIL_COUNT${NC} 失败"
echo "  时间戳已记录: $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"

rm -f "$TMP_FILE"
