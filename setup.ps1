# setup.ps1 — instala, compila e prepara o .env do Universal AI Bridge (Windows)
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> Instalando dependencias..." -ForegroundColor Cyan
npm install

Write-Host "==> Compilando (TypeScript)..." -ForegroundColor Cyan
npm run build

$envPath = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envPath)) {
  Write-Host "==> Gerando .env com token aleatorio..." -ForegroundColor Cyan
  $token = -join ((1..64) | ForEach-Object { "{0:x}" -f (Get-Random -Max 16) })
  $ws = Join-Path $PSScriptRoot "workspace"
  @"
BRIDGE_WORKSPACE=$ws
BRIDGE_TOKEN=$token
BRIDGE_PORT=8787
BRIDGE_ALLOWED_ORIGINS=https://chatgpt.com,https://chat.openai.com,https://claude.ai
BRIDGE_APPROVAL=confirm
BRIDGE_ALLOW_SHELL=true
"@ | Set-Content -Path $envPath -Encoding UTF8
  Write-Host "    .env criado. Token: $token" -ForegroundColor Green
} else {
  Write-Host "==> .env ja existe, mantido." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Pronto!" -ForegroundColor Green
Write-Host "  Local (Claude Desktop/Cursor/Gemini CLI): use --transport stdio (veja README secao 2)"
Write-Host "  Navegador (ChatGPT/Claude.ai):"
Write-Host "    1) npm run start:http"
Write-Host "    2) cloudflared tunnel --url http://127.0.0.1:8787"
Write-Host "    3) registre a URL .../mcp como conector (header Authorization: Bearer <token>)"
