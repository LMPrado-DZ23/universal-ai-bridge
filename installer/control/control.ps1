# control.ps1 — Painel de controle (WinForms) do Universal AI Bridge.
# Mostra status do bridge/túnel e os botões: Abrir ChatGPT, Copiar endpoint,
# Parar acesso imediatamente, Desinstalar. Atualiza sozinho.
param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [Parameter(Mandatory = $true)][string]$DataDir
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$statePath = Join-Path $DataDir "state.json"
$envPath = Join-Path $DataDir ".env"
$scripts = Join-Path $InstallDir "scripts"

function Get-EnvVal([string]$key) {
  if (Test-Path $envPath) {
    $m = Select-String -Path $envPath -Pattern "^$key=(.*)$" | Select-Object -First 1
    if ($m) { return $m.Matches[0].Groups[1].Value.Trim() }
  }
  return ""
}
function Get-AdminPort {
  $p = Get-EnvVal "BRIDGE_PORT"; if (-not $p) { $p = "8787" }
  return ([int]$p + 1)
}
function Invoke-Admin([string]$path) {
  $secret = Get-EnvVal "BRIDGE_ADMIN_SECRET"
  if (-not $secret) { throw "BRIDGE_ADMIN_SECRET nao encontrado no .env" }
  return Invoke-RestMethod -Uri "http://127.0.0.1:$(Get-AdminPort)$path" -Method Post -Headers @{ "x-admin-secret" = $secret } -TimeoutSec 5
}

function Read-State {
  if (Test-Path $statePath) {
    try { return Get-Content $statePath -Raw | ConvertFrom-Json } catch { return $null }
  }
  return $null
}
function Test-Bridge([int]$port) {
  try { $h = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2; return [bool]$h.ok }
  catch { return $false }
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "Universal AI Bridge"
$form.Size = New-Object System.Drawing.Size(520, 400)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedSingle"
$form.MaximizeBox = $false

$lblBridge = New-Object System.Windows.Forms.Label
$lblBridge.Location = New-Object System.Drawing.Point(20, 20)
$lblBridge.Size = New-Object System.Drawing.Size(470, 24)
$lblBridge.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$form.Controls.Add($lblBridge)

$lblTunnel = New-Object System.Windows.Forms.Label
$lblTunnel.Location = New-Object System.Drawing.Point(20, 50)
$lblTunnel.Size = New-Object System.Drawing.Size(470, 24)
$lblTunnel.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$form.Controls.Add($lblTunnel)

$txtEndpoint = New-Object System.Windows.Forms.TextBox
$txtEndpoint.Location = New-Object System.Drawing.Point(20, 82)
$txtEndpoint.Size = New-Object System.Drawing.Size(470, 24)
$txtEndpoint.ReadOnly = $true
$form.Controls.Add($txtEndpoint)

$lblMode = New-Object System.Windows.Forms.Label
$lblMode.Location = New-Object System.Drawing.Point(20, 112)
$lblMode.Size = New-Object System.Drawing.Size(470, 22)
$lblMode.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$form.Controls.Add($lblMode)

function New-Button($text, $x, $y, $w) {
  $b = New-Object System.Windows.Forms.Button
  $b.Text = $text
  $b.Location = New-Object System.Drawing.Point($x, $y)
  $b.Size = New-Object System.Drawing.Size($w, 40)
  $b.Font = New-Object System.Drawing.Font("Segoe UI", 9)
  $form.Controls.Add($b)
  return $b
}

$btnChatGPT = New-Button "Abrir ChatGPT" 20 150 150
$btnCopy = New-Button "Copiar endpoint" 180 150 150
$btnStart = New-Button "Religar acesso" 340 150 150
$btnRotate = New-Button "Rotacionar token" 20 200 235
$btnRevoke = New-Button "Revogar acesso remoto" 265 200 225
$btnStop = New-Button "Parar acesso imediatamente" 20 250 310
$btnStop.BackColor = [System.Drawing.Color]::MistyRose
$btnUninstall = New-Button "Desinstalar" 340 250 150

$btnRotate.Add_Click({
    try {
      $r = Invoke-Admin "/admin/rotate"
      Set-Clipboard -Value $r.token
      [System.Windows.Forms.MessageBox]::Show("Novo token gerado e copiado. Atualize o conector no ChatGPT/Claude com este token.", "Token rotacionado") | Out-Null
    } catch { [System.Windows.Forms.MessageBox]::Show("Falha ao rotacionar: $_", "Erro") | Out-Null }
  })

$btnRevoke.Add_Click({
    $r = [System.Windows.Forms.MessageBox]::Show("Revogar o token e fechar as sessões remotas agora? (o bridge continua rodando)", "Revogar", "YesNo", "Warning")
    if ($r -eq "Yes") {
      try { Invoke-Admin "/admin/revoke" | Out-Null; [System.Windows.Forms.MessageBox]::Show("Acesso remoto revogado. Rotacione o token para reconectar.", "Revogado") | Out-Null }
      catch { [System.Windows.Forms.MessageBox]::Show("Falha ao revogar: $_", "Erro") | Out-Null }
    }
  })

$btnChatGPT.Add_Click({ Start-Process "https://chatgpt.com/#settings/Connectors" })

$btnCopy.Add_Click({
    if ($txtEndpoint.Text) { Set-Clipboard -Value $txtEndpoint.Text }
    [System.Windows.Forms.MessageBox]::Show("Endpoint copiado:`n$($txtEndpoint.Text)", "Universal AI Bridge") | Out-Null
  })

$btnStart.Add_Click({
    Start-Process powershell.exe -ArgumentList @(
      "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
      "-File", "`"$scripts\launcher.ps1`"", "-InstallDir", "`"$InstallDir`"", "-DataDir", "`"$DataDir`""
    )
    Start-Sleep -Seconds 3
  })

$btnStop.Add_Click({
    $r = [System.Windows.Forms.MessageBox]::Show(
      "Encerrar o bridge e o túnel agora? O acesso remoto cai imediatamente.",
      "Parar acesso", "YesNo", "Warning")
    if ($r -eq "Yes") {
      try { Invoke-Admin "/admin/panic" | Out-Null } catch {} # revoga token + fecha sessões na hora
      Start-Process powershell.exe -Wait -ArgumentList @(
        "-ExecutionPolicy", "Bypass", "-File", "`"$scripts\stop-access.ps1`"", "-DataDir", "`"$DataDir`""
      )
    }
  })

$btnUninstall.Add_Click({
    $unins = Get-ChildItem -Path $InstallDir -Filter "unins*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($unins) { Start-Process $unins.FullName }
    else { [System.Windows.Forms.MessageBox]::Show("Use Configurações > Apps para desinstalar.", "Universal AI Bridge") | Out-Null }
  })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 3000
$timer.Add_Tick({
    $state = Read-State
    $port = if ($state) { [int]$state.port } else { 8787 }
    $up = Test-Bridge $port
    $lblBridge.Text = if ($up) { "● Bridge: ATIVO (porta $port)" } else { "○ Bridge: parado" }
    $lblBridge.ForeColor = if ($up) { [System.Drawing.Color]::ForestGreen } else { [System.Drawing.Color]::Gray }
    if ($state -and $state.endpoint) {
      $lblTunnel.Text = "● Túnel: ativo"
      $lblTunnel.ForeColor = [System.Drawing.Color]::ForestGreen
      $txtEndpoint.Text = $state.endpoint
    } else {
      $lblTunnel.Text = "○ Túnel: sem endpoint (rode 'Religar acesso')"
      $lblTunnel.ForeColor = [System.Drawing.Color]::Gray
    }
    $lblMode.Text = "Modo: $(if($state){$state.mode}else{'?'})   |   Header do conector: Authorization: Bearer <seu token do .env>"
  })
$timer.Start()
$form.Add_Shown({ $form.Activate() })
[void]$form.ShowDialog()
