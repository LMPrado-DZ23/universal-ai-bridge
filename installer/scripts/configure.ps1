# configure.ps1 — cria a pasta de dados, gera token seguro e escreve o .env.
# Idempotente: preserva um token existente para não quebrar conectores já configurados.
param(
  [Parameter(Mandatory = $true)][string]$DataDir,
  [ValidateSet("safe", "admin")][string]$Mode = "safe",
  [string]$Ack = "",
  [int]$Port = 8787
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "private-state.ps1")

if($Port -lt 1 -or $Port -gt 65534){throw 'Porta invalida.'}
if($Mode -eq 'admin' -and $Ack -cne 'I_UNDERSTAND_FULL_PC_ACCESS'){throw 'Admin exige reconhecimento explicito.'}
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$ws = Join-Path $DataDir "workspace"
New-Item -ItemType Directory -Force -Path $ws | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $DataDir "audit") | Out-Null

$envFile = Join-Path $DataDir ".env"

# Preserva token existente, se houver.
$token = $null
if (Test-Path $envFile) {
  $line = Select-String -Path $envFile -Pattern '^BRIDGE_TOKEN=(.+)$' | Select-Object -First 1
  if ($line) { $token = $line.Matches[0].Groups[1].Value.Trim() }
}
if ([string]::IsNullOrWhiteSpace($token)) {
  $bytes = New-Object 'System.Byte[]' 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $token = -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

$allowShell = if ($Mode -eq "admin") { "true" } else { "false" }

# Preserva config de túnel nomeado, se já existir.
function Get-Existing([string]$key) {
  if (Test-Path $envFile) {
    $l = Select-String -Path $envFile -Pattern "^$key=(.*)$" | Select-Object -First 1
    if ($l) { return $l.Matches[0].Groups[1].Value.Trim() }
  }
  return ""
}
$tunnelToken = Get-Existing "CLOUDFLARE_TUNNEL_TOKEN"
$tunnelHost = Get-Existing "TUNNEL_HOSTNAME"

# Segredo do plano de controle local (porta separada). Preserva se já existir.
$adminSecret = Get-Existing "BRIDGE_ADMIN_SECRET"
if ([string]::IsNullOrWhiteSpace($adminSecret)) {
  $ab = New-Object 'System.Byte[]' 24
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($ab)
  $adminSecret = -join ($ab | ForEach-Object { $_.ToString('x2') })
}

$content = @"
BRIDGE_MODE=$Mode
BRIDGE_ADMIN_ACK=$Ack
BRIDGE_TOKEN=$token
BRIDGE_PORT=$Port
BRIDGE_ALLOWED_ORIGINS=https://chatgpt.com,https://chat.openai.com,https://claude.ai
BRIDGE_WORKSPACE=$ws
BRIDGE_APPROVAL=confirm
BRIDGE_ALLOW_SHELL=$allowShell
BRIDGE_ALLOW_DOCKER=false
BRIDGE_ADMIN_SECRET=$adminSecret
BRIDGE_MAX_SESSIONS=20
CLOUDFLARE_TUNNEL_TOKEN=$tunnelToken
TUNNEL_HOSTNAME=$tunnelHost
"@
# Preserve all existing settings on upgrade. Explicit mode/port choices update
# only their own keys; an empty persisted token remains revoked.
if (Test-Path $envFile) {
  $content=[System.IO.File]::ReadAllText($envFile)
  $updates=@{}
  if($PSBoundParameters.ContainsKey('Mode')) {
    $updates.BRIDGE_MODE=$Mode; $updates.BRIDGE_ADMIN_ACK=$Ack; $updates.BRIDGE_ALLOW_SHELL=$allowShell
  }
  if($PSBoundParameters.ContainsKey('Port')){$updates.BRIDGE_PORT=[string]$Port}
  foreach($key in $updates.Keys) {
    $content=[regex]::Replace($content,"(?m)^$key=.*(?:\r?\n|$)",'')
    $content=$content.TrimEnd()+"`n$key=$($updates[$key])`n"
  }
}
Write-BridgePrivateAtomic $envFile $content
Write-Output "Configuracao gravada com ACL privada."
