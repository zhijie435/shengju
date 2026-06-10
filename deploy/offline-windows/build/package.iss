; ================================================================
; Shengju Exam System - Inno Setup packaging script
; Tool: Inno Setup 6.x  https://jrsoftware.org/isdl.php
; Run:  ISCC.exe /DAppVersion=1.0.0 package.iss
; Output: dist\sjrcw-installer-v1.0.0.exe
; ================================================================

; ---------- defines (preprocessed BEFORE any ISL is loaded) ----------
#define AppName     "ShengjuExam"
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#define AppPublisher "Shengju"
#define AppId        "{{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}"

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
MinVersion=10.0
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
DefaultDirName={autopf}\ShengjuExam
DefaultGroupName={#AppName}
AllowNoIcons=no
OutputDir=..\dist
OutputBaseFilename=sjrcw-installer-v{#AppVersion}
SetupIconFile=..\build\app-icon.ico
; Use separate LZMA process to access all available RAM (avoids Out of Memory
; when packaging node_modules + Chromium runtime, 30k+ files / ~500MB).
Compression=lzma2/max
SolidCompression=no
LZMAUseSeparateProcess=yes
WizardStyle=modern
WizardSizePercent=130
ShowLanguageDialog=no
LanguageDetectionMethod=locale
UninstallDisplayName={#AppName}
CreateUninstallRegKey=yes

; ---------- sections below are parsed AFTER ISL is loaded ----------
; ALL strings here are pure ASCII to avoid encoding issues with
; ChineseSimplified.isl (LanguageCodePage may affect the parser).

[Languages]
Name: "chs"; MessagesFile: "Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon";   Description: "Create desktop shortcut"
Name: "startmenuicon"; Description: "Create start menu shortcuts"

[Files]
Source: "..\packaging\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\packaging\placeholder.txt"; DestDir: "{app}\data"; Flags: ignoreversion
Source: "..\packaging\placeholder.txt"; DestDir: "{app}\logs"; Flags: ignoreversion

[Icons]
Name: "{group}\Start ShengjuExam";      Filename: "{cmd}"; Parameters: "/c ""{app}\start.bat"""; WorkingDir: "{app}"; IconFilename: "{app}\app-icon.ico"
Name: "{group}\Stop ShengjuExam";       Filename: "{cmd}"; Parameters: "/c ""{app}\stop.bat""";  WorkingDir: "{app}"; IconFilename: "{app}\app-icon.ico"
Name: "{group}\Uninstall {#AppName}";   Filename: "{uninstallexe}"
Name: "{commondesktop}\ShengjuExam";    Filename: "{cmd}"; Parameters: "/c ""{app}\start.bat"""; WorkingDir: "{app}"; IconFilename: "{app}\app-icon.ico"; Tasks: desktopicon

[Run]
Filename: "{cmd}"; Parameters: "/c ""{app}\start.bat"""; WorkingDir: "{app}"; Description: "Start exam system"; Flags: postinstall nowait

[UninstallRun]
Filename: "{cmd}"; Parameters: "/c ""{app}\stop.bat"""; WorkingDir: "{app}"; Flags: runhidden waituntilterminated; RunOnceId: "StopServices"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\logs"
Type: filesandordirs; Name: "{app}\config\my_runtime.ini"
Type: filesandordirs; Name: "{app}\app\backend\.env"

[Code]

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
  Answer: Integer;
begin
  if CurUninstallStep = usPostUninstall then begin
    DataDir := ExpandConstant('{app}\data');
    if DirExists(DataDir) then begin
      Answer := MsgBox(
        'Delete all exam data (questions, papers, records)?' + #13#10 +
        'Yes = permanent delete.  No = keep data at: ' + DataDir,
        mbConfirmation, MB_YESNO
      );
      if Answer = IDYES then
        DelTree(DataDir, True, True, True);
    end;
  end;
end;
