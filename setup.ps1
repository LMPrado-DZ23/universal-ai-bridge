# setup.ps1 — instala, compila e prepara o .env do Universal AI Bridge (Windows)
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "==> Instalando dependencias..." -ForegroundColor Cyan
npm install

Write-Host "==> Compilando (TypeScript)..." -ForegroundColor Cyan
npm run build

$envPath = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envPath)) {
  Write-Host "==> Gerando .env com token CRIPTOGRAFICO..." -ForegroundColor Cyan
  # Fonte segura de aleatoriedade (NAO usar Get-Random para segredos).
  $bytes = New-Object 'System.Byte[]' 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $token = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  $ws = Join-Path $PSScriptRoot "workspace"
  $envContent = @"
BRIDGE_MODE=safe
BRIDGE_ADMIN_ACK=
BRIDGE_TOKEN=$token
BRIDGE_PORT=8787
BRIDGE_ALLOWED_ORIGINS=https://chatgpt.com,https://chat.openai.com,https://claude.ai
BRIDGE_WORKSPACE=$ws
BRIDGE_APPROVAL=confirm
BRIDGE_ALLOW_SHELL=false
BRIDGE_ALLOW_DOCKER=false
"@
  # UTF-8 SEM BOM (um BOM na 1a linha corromperia BRIDGE_MODE).
  [System.IO.File]::WriteAllText($envPath, $envContent, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "    .env criado (modo SAFE). Token gerado com sucesso." -ForegroundColor Green
} else {
  Write-Host "==> .env ja existe, mantido." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Pronto! (modo padrao = SAFE)" -ForegroundColor Green
Write-Host "  Local (Claude Desktop/Cursor/Gemini CLI): --transport stdio (README secao 4)"
Write-Host "  Navegador (ChatGPT/Claude.ai):"
Write-Host "    1) npm run start:http"
Write-Host "    2) cloudflared tunnel --url http://127.0.0.1:8787"
Write-Host "    3) registre a URL .../mcp como conector (header Authorization: Bearer <token>)"
Write-Host ""
Write-Host "  Para habilitar terminal no modo safe: BRIDGE_ALLOW_SHELL=true no .env"
Write-Host "  Para modo admin (shell+docker): leia a secao 'Modo administrador' do README."
