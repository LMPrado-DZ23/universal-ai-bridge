; Universal AI Bridge — instalador Windows (Inno Setup 6)
; Compila para: Output\UniversalAI-Bridge-Setup.exe
; Requer os arquivos do app já buildados em ..\dist e ..\node_modules (prod).

#define AppName "Universal AI Bridge"
#define AppVersion "0.7.0"
#define Publisher "Universal AI Bridge"
#define ExpectedPhrase "I_UNDERSTAND_FULL_PC_ACCESS"

[Setup]
AppId={{7B2F9E14-3C4A-4E9B-9E2D-UAB0BRIDGE01}}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#Publisher}
DefaultDirName={autopf}\Universal AI Bridge
DefaultGroupName=Universal AI Bridge
DisableProgramGroupPage=yes
OutputDir=Output
OutputBaseFilename=UniversalAI-Bridge-Setup
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
WizardStyle=modern
UninstallDisplayName={#AppName}

[Languages]
Name: "pt"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "..\dist\*"; DestDir: "{app}\app\dist"; Flags: recursesubdirs createallsubdirs
Source: "..\node_modules\*"; DestDir: "{app}\app\node_modules"; Flags: recursesubdirs createallsubdirs
Source: "..\config\*"; DestDir: "{app}\app\config"; Flags: recursesubdirs createallsubdirs
Source: "..\package.json"; DestDir: "{app}\app"
Source: "..\SKILL.md"; DestDir: "{app}\app"
Source: "..\LICENSE"; DestDir: "{app}"
Source: "scripts\*"; DestDir: "{app}\scripts"; Flags: recursesubdirs createallsubdirs
Source: "control\*"; DestDir: "{app}\control"; Flags: recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Painel do Universal AI Bridge"; Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\control\control.ps1"" -InstallDir ""{app}"" -DataDir ""{localappdata}\UniversalAIBridge"""
Name: "{group}\Parar acesso (emergencia)"; Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\scripts\stop-access.ps1"" -DataDir ""{localappdata}\UniversalAIBridge"""
Name: "{group}\Desinstalar {#AppName}"; Filename: "{uninstallexe}"

[Run]
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\control\control.ps1"" -InstallDir ""{app}"" -DataDir ""{localappdata}\UniversalAIBridge"""; Description: "Abrir o painel de controle"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\scripts\uninstall-cleanup.ps1"" -DataDir ""{localappdata}\UniversalAIBridge"""; Flags: runhidden; RunOnceId: "UABCleanup"

[Code]
var
  ModePage: TInputOptionWizardPage;
  AckPage: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  ModePage := CreateInputOptionPage(wpSelectDir,
    'Modo de operação',
    'Escolha quanto acesso a IA terá ao seu computador.',
    'O modo seguro é recomendado. Você pode mudar depois editando o arquivo .env.',
    True, False);
  ModePage.Add('Modo seguro (recomendado): arquivos em uma pasta isolada; terminal e Docker desligados.');
  ModePage.Add('Modo administrador: acesso amplo (terminal ligado, Docker liberável). Requer confirmação.');
  ModePage.SelectedValueIndex := 0;

  AckPage := CreateInputQueryPage(ModePage.ID,
    'Confirmação do modo administrador',
    'Este modo dá à IA acesso amplo ao computador.',
    'ATENÇÃO: no modo administrador, qualquer pessoa que obtenha os tokens necessários poderá ' +
    'executar ações com os privilégios do processo no seu computador (ler/alterar arquivos, ' +
    'rodar comandos e Docker). Para confirmar, digite exatamente a frase abaixo:' + #13#10 + #13#10 +
    '{#ExpectedPhrase}');
  AckPage.Add('Digite a frase de confirmação:', False);
end;

function IsAdminMode(): Boolean;
begin
  Result := ModePage.SelectedValueIndex = 1;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if PageID = AckPage.ID then
    Result := not IsAdminMode();
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = AckPage.ID then
  begin
    if Trim(AckPage.Values[0]) <> '{#ExpectedPhrase}' then
    begin
      MsgBox('A frase não confere. Digite exatamente: {#ExpectedPhrase} — ou volte e escolha o modo seguro.',
        mbError, MB_OK);
      Result := False;
    end;
  end;
end;

function GetMode(): String;
begin
  if IsAdminMode() then Result := 'admin' else Result := 'safe';
end;

function GetAck(): String;
begin
  if IsAdminMode() then Result := '{#ExpectedPhrase}' else Result := '';
end;

procedure RunPS(ScriptFile, ExtraArgs: String; Wait: Boolean);
var
  ResultCode: Integer;
  Params: String;
begin
  Params := '-ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File "' +
    ExpandConstant('{app}\scripts\') + ScriptFile + '" ' + ExtraArgs;
  if Wait then
    Exec('powershell.exe', Params, '', SW_HIDE, ewWaitUntilTerminated, ResultCode)
  else
    Exec('powershell.exe', Params, '', SW_HIDE, ewNoWait, ResultCode);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  DataDir, App: String;
  RC: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    DataDir := ExpandConstant('{localappdata}\UniversalAIBridge');
    App := ExpandConstant('{app}');

    // 1) Runtime.
    RunPS('ensure-node.ps1', '', True);
    RunPS('ensure-cloudflared.ps1', '-InstallDir "' + App + '"', True);

    // 2) Configuração (token + modo).
    RunPS('configure.ps1', '-DataDir "' + DataDir + '" -Mode ' + GetMode() +
      ' -Ack "' + GetAck() + '" -Port 8787', True);

    // 3) Início automático + iniciar agora (roda como usuário).
    RunPS('install-task.ps1', '-InstallDir "' + App + '" -DataDir "' + DataDir + '" -RunNow', True);

    // 4) Teste de saúde (best-effort; não interrompe a instalação).
    RunPS('healthcheck.ps1', '-Port 8787 -DataDir "' + DataDir + '" -Mcp', True);

    // 5) Copia o endpoint atual para a área de transferência (se já houver túnel).
    Exec('powershell.exe',
      '-ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -Command "try { $s = Get-Content ''' +
      DataDir + '\state.json'' -Raw | ConvertFrom-Json; if ($s.endpoint) { Set-Clipboard $s.endpoint } } catch {}"',
      '', SW_HIDE, ewWaitUntilTerminated, RC);

    // 6) Abre a página de conectores do ChatGPT.
    ShellExec('open', 'https://chatgpt.com/#settings/Connectors', '', '', SW_SHOWNORMAL, ewNoWait, RC);
  end;
end;
