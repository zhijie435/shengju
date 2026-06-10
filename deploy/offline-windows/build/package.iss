; ================================================================
; 圣举考试系统 - Inno Setup 打包脚本
; 工具: Inno Setup 6.x (https://jrsoftware.org/isdl.php)
; 执行: ISCC.exe package.iss
; 输出: dist\圣举考试系统_安装包_v1.0.0.exe
; ================================================================

#define AppName "圣举考试系统"
; 版本号可从命令行传入：ISCC.exe /DAppVersion=1.2.0 package.iss
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#define AppPublisher "圣举人才网"
#define AppId "{{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}"

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
; 64位 Windows 10 及以上（对应 NT 10.0）
MinVersion=10.0
ArchitecturesInstallIn64BitMode=x64compatible
; 无管理员权限时允许安装到用户目录（自动降级）
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
; 默认目录（有管理员装 ProgramFiles，否则装用户目录）
DefaultDirName={autopf}\ShengjuExam
DefaultGroupName={#AppName}
AllowNoIcons=no
; 输出设置
OutputDir=..\dist
OutputBaseFilename=圣举考试系统_安装包_v{#AppVersion}
; 高压缩比
Compression=lzma2/ultra64
SolidCompression=yes
LZMANumBlockThreads=4
; 外观
WizardStyle=modern
WizardSizePercent=130
ShowLanguageDialog=no
LanguageDetectionMethod=locale
; 卸载
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\启动考试系统.bat
CreateUninstallRegKey=yes

[Languages]
; 使用随仓库附带的语言文件（相对于 .iss 文件路径），不依赖编译器安装目录
Name: "chs"; MessagesFile: "Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "在桌面创建快捷方式"; GroupDescription: "附加任务:"; Flags: checked
Name: "startmenuicon"; Description: "在开始菜单创建快捷方式"; GroupDescription: "附加任务:"; Flags: checked

[Files]
; 整个 packaging 目录（不含 build 目录本身）
Source: "..\packaging\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; 确保 data 和 logs 目录存在（空目录 Inno 不会自动创建）
Source: "..\packaging\placeholder.txt"; DestDir: "{app}\data"; Flags: ignoreversion
Source: "..\packaging\placeholder.txt"; DestDir: "{app}\logs"; Flags: ignoreversion

[Icons]
Name: "{group}\启动考试系统"; Filename: "{cmd}"; Parameters: "/c ""{app}\启动考试系统.bat"""; WorkingDir: "{app}"; Comment: "启动圣举考试系统后端与数据库"
Name: "{group}\停止考试系统"; Filename: "{cmd}"; Parameters: "/c ""{app}\停止考试系统.bat"""; WorkingDir: "{app}"
Name: "{group}\卸载 {#AppName}"; Filename: "{uninstallexe}"
Name: "{commondesktop}\圣举考试系统"; Filename: "{cmd}"; Parameters: "/c ""{app}\启动考试系统.bat"""; WorkingDir: "{app}"; Tasks: desktopicon; Comment: "启动圣举考试系统"

[Run]
; 安装完成后自动启动（不需要用户勾选）：
;   nowait = 不阻塞安装向导，Inno Setup 的完成页可直接关闭
;   unchecked 去掉即可实现"无需用户确认直接启动"
Filename: "{cmd}"; Parameters: "/c ""{app}\启动考试系统.bat"""; WorkingDir: "{app}"; Description: "启动考试系统并打开浏览器"; Flags: postinstall nowait

[UninstallRun]
; 卸载前先停止所有服务
Filename: "{cmd}"; Parameters: "/c ""{app}\停止考试系统.bat"""; WorkingDir: "{app}"; Flags: runhidden waituntilterminated; RunOnceId: "StopServices"

[UninstallDelete]
; 卸载时删除运行时产生的文件（data\ 保留，防止误删数据）
Type: filesandordirs; Name: "{app}\logs"
Type: filesandordirs; Name: "{app}\config\my_runtime.ini"
Type: filesandordirs; Name: "{app}\app\backend\.env"

[Code]
// 安装前检查：系统版本与磁盘空间
function InitializeSetup(): Boolean;
var
  FreeSpace: Int64;
  TargetDrive: String;
begin
  Result := True;

  // 检查磁盘空间（需约 2GB）
  TargetDrive := ExtractFileDrive(ExpandConstant('{autopf}'));
  if TargetDrive = '' then TargetDrive := 'C:';
  GetSpaceFreeEx(TargetDrive + '\', FreeSpace, nil);
  if FreeSpace < Int64(2) * 1024 * 1024 * 1024 then begin
    MsgBox('磁盘空间不足！安装需要至少 2GB 可用空间。' + #13#10 +
           '当前可用：' + IntToStr(FreeSpace div (1024*1024)) + ' MB',
           mbError, MB_OK);
    Result := False;
    Exit;
  end;
end;

// 卸载时询问是否同时删除数据
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
  Answer: Integer;
begin
  if CurUninstallStep = usPostUninstall then begin
    DataDir := ExpandConstant('{app}\data');
    if DirExists(DataDir) then begin
      Answer := MsgBox(
        '是否同时删除考试数据（题库、试卷、考生记录等）？' + #13#10 +
        '选择"是"将永久删除所有数据，无法恢复。' + #13#10 +
        '选择"否"将保留数据目录：' + DataDir,
        mbConfirmation, MB_YESNO
      );
      if Answer = IDYES then
        DelTree(DataDir, True, True, True);
    end;
  end;
end;
