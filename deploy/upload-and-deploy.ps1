$ErrorActionPreference = "Stop"

# ===== 需要按你的服务器改这里 =====
$ServerHost = "39.105.98.161"
$ServerUser = "root"
$ServerPort = 22
$ProjectRoot = "d:\高亚军工作资料\圣举人才网\新的"
$RemoteStageDir = "/root/deploy-temp"
$RemoteScriptPath = "/root/deploy-temp/deploy/remote-deploy.sh"

# 本次要发布的文件（相对 ProjectRoot）
$SyncFiles = @(
  "src/assets/deepseek_html_20251230_e6f8db.html",
  "backend/server.js",
  "deploy/remote-deploy.sh"
)

function Join-UnixPath([string]$base, [string]$rel) {
  $r = $rel.Replace("\", "/")
  if ($base.EndsWith("/")) { return "$base$r" }
  return "$base/$r"
}

Write-Host "[1/4] 检查本地文件..."
foreach ($f in $SyncFiles) {
  $localPath = Join-Path $ProjectRoot $f
  if (-not (Test-Path -LiteralPath $localPath)) {
    throw "本地文件不存在: $localPath"
  }
}

Write-Host "[2/4] 创建服务器临时目录..."
ssh -p $ServerPort "$ServerUser@$ServerHost" "mkdir -p '$RemoteStageDir/src/assets' '$RemoteStageDir/backend' '$RemoteStageDir/deploy'"

Write-Host "[3/4] 上传文件..."
foreach ($f in $SyncFiles) {
  $localPath = Join-Path $ProjectRoot $f
  $remotePath = Join-UnixPath $RemoteStageDir $f
  scp -P $ServerPort "$localPath" "${ServerUser}@${ServerHost}:$remotePath" | Out-Null
  Write-Host "  - 已上传 $f"
}

Write-Host "[4/4] 执行服务器发布脚本..."
ssh -p $ServerPort "$ServerUser@$ServerHost" "chmod +x '$RemoteScriptPath' && bash '$RemoteScriptPath'"

Write-Host "完成。请浏览器 Ctrl+F5 强刷验证页面。"
