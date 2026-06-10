#!/usr/bin/env bash
# 在 Linux 服务器上安装依赖：跳过 Puppeteer 下载 Chromium（网络/镜像易失败）
# 用法：chmod +x install-on-server.sh && ./install-on-server.sh
set -euo pipefail
cd "$(dirname "$0")"
export PUPPETEER_SKIP_DOWNLOAD=true
npm install --omit=dev
echo "依赖安装完成。若 canvas 报错，请先: dnf install -y cairo-devel pango-devel libjpeg-turbo-devel giflib-devel pixman-devel gcc-c++ make"
