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
$connection=Get-EnvValue 'BRIDGE_CONNECTION'
if($connection -and $connection -notin @('local','remote')){throw 'Modo de conexao invalido.'}
if($connection -eq 'local'){$NoTunnel=$true}
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
$adminPort = Get-EnvValue 'BRIDGE_ADMIN_PORT'
if(-not $adminPort){$adminPort=[int]$port+1}
Assert-BridgePortsAvailable @([int]$port,[int]$adminPort)
$nodeIdentity=$null; $tunnelIdentity=$null
try {
$nodePid = $null
if (-not $bridgeUp) {
  # Installer configuration is authoritative; do not inherit stale service flags.
  Get-ChildItem Env: | Where-Object {$_.Name -like 'BRIDGE_*'} | ForEach-Object { Remove-Item -LiteralPath ("Env:"+$_.Name) }
  $env:BRIDGE_ENV_FILE = $envFile
  $env:BRIDGE_DATA_DIR = $DataDir
  $p = Start-Process -FilePath $node -ArgumentList @("`"$entry`"", "--transport", "http") `
    -WindowStyle Hidden -PassThru
  $nodePid = $p.Id
  $nodeIdentity=Get-BridgeIdentity $nodePid
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
  if (-not (Test-Path $cf)) { throw "cloudflared ausente." }
  & (Join-Path $PSScriptRoot "ensure-cloudflared.ps1") -InstallDir $InstallDir
  if (Test-Path $cf) {
    if ($tunnelToken) {
      # Túnel NOMEADO: URL fixa configurada na sua conta Cloudflare.
      $tokenFile=Join-Path $DataDir 'tunnel.token'
      Write-BridgePrivateAtomic $tokenFile $tunnelToken
      $tp = Start-Process -FilePath $cf `
        -ArgumentList @("tunnel", "--no-autoupdate", "run", "--token-file", "`"$tokenFile`"") `
        -WindowStyle Hidden -PassThru
      $tunnelPid = $tp.Id
      $tunnelIdentity=Get-BridgeIdentity $tunnelPid
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
      $tunnelIdentity=Get-BridgeIdentity $tunnelPid
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
  nodeIdentity = $nodeIdentity
  tunnelIdentity = $tunnelIdentity
  nodePid    = $nodePid
  tunnelPid  = $tunnelPid
  updatedAt  = (Get-Date).ToString("o")
}
$stateFile=Join-Path $DataDir 'state.json'
Write-BridgePrivateAtomic $stateFile ($state | ConvertTo-Json -Depth 5)
Write-Output "Bridge na porta $port. Endpoint: $(if($endpoint){$endpoint}else{'(sem tunel)'})"

} catch {
  foreach($identity in @($tunnelIdentity,$nodeIdentity)) {
    if($identity -and (Test-BridgeIdentity $identity)) { & taskkill /PID $identity.pid /T /F 2>$null | Out-Null }
  }
  throw 'Falha ao iniciar bridge/tunel; processos desta tentativa foram encerrados quando identificados.'
}
