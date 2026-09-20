# Local human approval. The secret stays on this computer, never copied to AI.
param([Parameter(Mandatory=$true)][string]$DataDir)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$secret = $null
$lines = Get-Content (Join-Path $DataDir '.env')
$port = 8787; $adminPort = $null
foreach ($line in $lines) {
  if ($line -match '^BRIDGE_ADMIN_SECRET=(.+)$') { $secret=$Matches[1].Trim() }
  if ($line -match '^BRIDGE_PORT=(\d+)$') { $port = [int]$Matches[1] }
  if ($line -match '^BRIDGE_ADMIN_PORT=(\d+)$') { $adminPort = [int]$Matches[1] }
}
if (-not $secret) { $secret=(Get-Content (Join-Path $DataDir 'admin.secret') -Raw).Trim() }
if (-not $adminPort) { $adminPort = $port + 1 }
$base = "http://127.0.0.1:$adminPort/admin/approvals"
$headers = @{ 'x-admin-secret' = $secret }
$pending = Invoke-RestMethod -Uri $base -Headers $headers
foreach ($request in $pending) {
  if ($request.approved) { continue }
  $preview = $request.args | ConvertTo-Json -Depth 20
  if ($preview.Length -gt 20000) {
    [System.Windows.Forms.MessageBox]::Show('Ação excede o preview local. Recusada; divida a operação.', 'Universal AI Bridge') | Out-Null
    $approved = $false
  } else {
    $choice = [System.Windows.Forms.MessageBox]::Show("Ferramenta: $($request.tool)`n`n$preview`n`nAprovar exatamente esta ação?", 'Universal AI Bridge — aprovação humana', 'YesNo', 'Warning', 'Button2')
    $approved = $choice -eq 'Yes'
  }
  Invoke-RestMethod -Uri "$base/$($request.id)" -Method Post -Headers $headers -ContentType 'application/json' -Body (@{approve=$approved} | ConvertTo-Json) | Out-Null
}
if (-not $pending) { [System.Windows.Forms.MessageBox]::Show('Nenhuma aprovação pendente.', 'Universal AI Bridge') | Out-Null }
