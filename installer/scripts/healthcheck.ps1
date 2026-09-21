# healthcheck.ps1 — verifica /health e, com -Mcp, faz o handshake MCP (initialize).
param(
  [int]$Port = 8787,
  [string]$DataDir = "",
  [ValidateRange(0,120)][int]$WaitSeconds = 0,
  [switch]$Mcp
)
$ErrorActionPreference = "Stop"
if($DataDir -and -not $PSBoundParameters.ContainsKey('Port')) {
  $config=Join-Path $DataDir '.env'
  $line=Select-String -LiteralPath $config -Pattern '^BRIDGE_PORT=(\d+)$' | Select-Object -First 1
  if($line){$Port=[int]$line.Matches[0].Groups[1].Value}
}
$base = "http://127.0.0.1:$Port"

# Installation is ready only after the launcher commits its process identity.
if($DataDir){. (Join-Path $PSScriptRoot 'private-state.ps1')}
# /health
$deadline=[DateTime]::UtcNow.AddSeconds($WaitSeconds)
do {
  try {
    $health = Invoke-RestMethod -Uri "$base/health" -TimeoutSec 2 -UseBasicParsing
    if (-not $health.ok) { throw "/health nao retornou ok." }
    if($DataDir) {
      $state=Get-Content -LiteralPath (Join-Path $DataDir 'state.json') -Raw | ConvertFrom-Json
      if($state.port -ne $Port -or -not (Test-BridgeIdentity $state.nodeIdentity)){
        throw 'Launcher ainda nao confirmou a identidade do processo.'
      }
    }
    break
  } catch {
    if([DateTime]::UtcNow -ge $deadline){throw 'Bridge nao ficou saudavel no prazo de inicializacao.'}
    Start-Sleep -Milliseconds 250
  }
} while($true)
Write-Output "OK: /health respondeu { ok: true }"

if ($Mcp) {
  $token = ""
  if ($DataDir -and (Test-Path (Join-Path $DataDir ".env"))) {
    $m = Select-String -Path (Join-Path $DataDir ".env") -Pattern '^BRIDGE_TOKEN=(.+)$' | Select-Object -First 1
    if ($m) { $token = $m.Matches[0].Groups[1].Value.Trim() }
  }
  $body = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"healthcheck","version":"1"}}}'
  $headers = @{
    "Content-Type"  = "application/json"
    "Accept"        = "application/json, text/event-stream"
    "Authorization" = "Bearer $token"
  }
  $resp = Invoke-WebRequest -Uri "$base/mcp" -Method Post -Headers $headers -Body $body -TimeoutSec 8 -UseBasicParsing
  $sid=$resp.Headers['mcp-session-id']
  try {
  if ($resp.StatusCode -ne 200) { throw "MCP initialize falhou (HTTP $($resp.StatusCode))." }
  if ($resp.Content -notmatch "serverInfo") { throw "MCP initialize sem serverInfo." }
  } finally {
  if($sid) {
    $headers['mcp-session-id']=[string]$sid
    Invoke-WebRequest -Uri "$base/mcp" -Method Delete -Headers $headers -TimeoutSec 5 -UseBasicParsing | Out-Null
  }
  }
  Write-Output "OK: handshake MCP (initialize) respondeu serverInfo."
}
