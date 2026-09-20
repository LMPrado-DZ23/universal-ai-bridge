# launcher.ps1 — inicia o bridge (HTTP loopback) e o túnel cloudflared,
# e grava o endpoint atual em {DataDir}\state.json. Rodado pela Tarefa Agendada
# no logon e também logo após a instalação.
param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [Parameter(Mandatory = $true)][string]$DataDir,
  [switch]$NoTunnel
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "private-state.ps1")

$envFile = Join-Path $DataDir ".env"
if (-not (Test-Path $envFile)) { throw "Config nao encontrada: $envFile (rode configure.ps1)." }

function Get-EnvValue([string]$key) {
  $m = Select-String -Path $envFile -Pattern "^$key=(.*)$" | Select-Object -First 1
  if ($m) { return $m.Matches[0].Groups[1].Value.Trim() }
  return ""
}
$port = Get-EnvValue "BRIDGE_PORT"; if (-not $port) { $port = "8787" }
$mode = Get-EnvValue "BRIDGE_MODE"; if (-not $mode) { $mode = "safe" }
$tunnelToken = Get-EnvValue "CLOUDFLARE_TUNNEL_TOKEN"
$tunnelHostname = Get-EnvValue "TUNNEL_HOSTNAME"

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "Node.js nao encontrado no PATH." }
$entry = Join-Path $InstallDir "app\dist\index.js"

# Evita instância duplicada: se /health ja responde, nao sobe outro bridge.
$bridgeUp = $false
try {
  $h = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2
  if ($h.ok) { $bridgeUp = $true }
} catch {}

if ($bridgeUp) {
  $saved=Join-Path $DataDir 'state.json'
  if (Test-Path $saved) {
    $previous=Get-Content $saved -Raw | ConvertFrom-Json
    if(Test-BridgeIdentity $previous.nodeIdentity) { Write-Output 'Bridge ja ativo; estado e processos preservados.'; exit 0 }
  }
  throw 'Porta ocupada por processo nao identificado. Nenhum processo iniciado.'
}
$nodePid = $null
if (-not $bridgeUp) {
  $env:BRIDGE_ENV_FILE = $envFile
  $env:BRIDGE_DATA_DIR = $DataDir
  $p = Start-Process -FilePath $node -ArgumentList @("`"$entry`"", "--transport", "http") `
    -WindowStyle Hidden -PassThru
  $nodePid = $p.Id
  $ready=$false
  for($attempt=0;$attempt -lt 30;$attempt++) {
    if($p.HasExited){throw 'Bridge encerrou durante inicializacao.'}
    try {if((Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 1).ok){$ready=$true;break}}catch{}
    Start-Sleep -Milliseconds 200
  }
  if(-not $ready){throw 'Bridge nao passou no healthcheck.'}
}

$endpoint = ""
$tunnelHost = ""
$tunnelPid = $null
if (-not $NoTunnel) {
  $cf = Join-Path $InstallDir "bin\cloudflared.exe"
  if (Test-Path $cf) {
    if ($tunnelToken) {
      # Túnel NOMEADO: URL fixa configurada na sua conta Cloudflare.
      $tokenFile=Join-Path $DataDir 'tunnel.token'
      if(-not (Test-Path $tokenFile)){New-Item -ItemType File -Path $tokenFile | Out-Null}
      Set-BridgePrivate $tokenFile
      [System.IO.File]::WriteAllText($tokenFile,$tunnelToken,(New-Object System.Text.UTF8Encoding($false)))
      $tp = Start-Process -FilePath $cf `
        -ArgumentList @("tunnel", "--no-autoupdate", "run", "--token-file", "`"$tokenFile`"") `
        -WindowStyle Hidden -PassThru
      $tunnelPid = $tp.Id
      if ($tunnelHostname) {
        $tunnelHost = "https://$tunnelHostname"
        $endpoint = "$tunnelHost/mcp"
      }
    } else {
      # Túnel RÁPIDO: URL efêmera (muda a cada reinício).
      $log = Join-Path $DataDir "tunnel.log"
      if (Test-Path $log) { Remove-Item $log -Force }
      $tp = Start-Process -FilePath $cf `
        -ArgumentList @("tunnel", "--url", "http://127.0.0.1:$port", "--no-autoupdate") `
        -WindowStyle Hidden -PassThru -RedirectStandardError $log -RedirectStandardOutput (Join-Path $DataDir "tunnel.out.log")
      $tunnelPid = $tp.Id
      for ($i = 0; $i -lt 50; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-Path $log) {
          $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
          if ($m) { $tunnelHost = $m.Matches[0].Value; break }
        }
      }
      if ($tunnelHost) { $endpoint = "$tunnelHost/mcp" }
    }
  }
}

$state = [ordered]@{
  mode       = $mode
  port       = [int]$port
  bridgeUp   = $true
  endpoint   = $endpoint
  tunnelHost = $tunnelHost
  nodeIdentity = if($nodePid){Get-BridgeIdentity $nodePid}else{$null}
  tunnelIdentity = if($tunnelPid){Get-BridgeIdentity $tunnelPid}else{$null}
  nodePid    = $nodePid
  tunnelPid  = $tunnelPid
  updatedAt  = (Get-Date).ToString("o")
}
$stateFile=Join-Path $DataDir 'state.json'
if(-not (Test-Path $stateFile)){New-Item -ItemType File -Path $stateFile | Out-Null}
Set-BridgePrivate $stateFile
$state | ConvertTo-Json -Depth 5 | Set-Content -Path $stateFile -Encoding UTF8
Write-Output "Bridge na porta $port. Endpoint: $(if($endpoint){$endpoint}else{'(sem tunel)'})"
