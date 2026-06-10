$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "已创建 .env（由 .env.example 复制），请按需编辑 JWT_SECRET 等项后重新运行。" -ForegroundColor Yellow
}
docker compose up --build
