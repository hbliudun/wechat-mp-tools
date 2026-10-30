; ============================================================================
; WeChat MP Tools — Windows 安装包脚本（Inno Setup 6）
;
; 前置：先跑 PyInstaller 生成绿色目录
;   pyinstaller --clean --noconfirm wechat_mp_tools.spec
;   产物：dist\WeChat MP Tools\WeChat MP Tools.exe
;
; 打包：
;   iscc /DMyAppVersion=2.3.4 /DMyAppEdition=Full installer\wechat_mp_tools.iss
;   产物：dist-installer\WeChat-MP-Tools-2.3.4-Full-Setup.exe
;
; 说明：本项目没有 .ico 图标，如需安装包图标，放一个 app.ico 到 installer\
;       并取消下面 SetupIconFile 的注释。
; ============================================================================

#define MyAppName "WeChat MP Tools"
#define MyAppPublisher "wechat-mp-tools"
#define MyAppURL "https://github.com/x554960766/wechat-mp-tools"
#define MyAppExeName "WeChat MP Tools.exe"

; 版本号与 backend/config.py 的 APP_VERSION 保持一致，可用 /DMyAppVersion= 覆盖
#ifndef MyAppVersion
  #define MyAppVersion "2.3.4"
#endif

; Full = 内置 Chromium（不依赖系统浏览器）；Lite = 用系统 Chrome/Edge
#ifndef MyAppEdition
  #define MyAppEdition "Full"
#endif

; Setup.exe 自身的文件版本（Windows 属性页显示的就是这个）。
; 必须是四段 x.x.x.x，CI 会把 APP_VERSION 补齐成四段传进来。
#ifndef MyAppVersion4
  #define MyAppVersion4 "0.0.0.0"
#endif

[Setup]
; AppId 必须固定不变，否则升级会变成"并存安装"而不是覆盖升级
AppId={{8F3C2B1A-5D64-4E2F-9A7B-1C2D3E4F5A6B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion} ({#MyAppEdition})
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}/releases
VersionInfoVersion={#MyAppVersion4}

; ── 安装位置：每用户，装到 %LOCALAPPDATA%\Programs ──────────────────────
; 关键：程序冻结后把 data/（配置、下载的文章、RSS 缓存）写在 exe 同级目录
; （见 backend/runtime.py::app_dir()，frozen 时返回 sys.executable 的父目录）。
; 如果装到 C:\Program Files，普通用户对该目录没有写权限，会出现
; "配置保存失败 / 下载失败 / 无法建立文章目录" 一类问题。
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

OutputDir=..\dist-installer
OutputBaseFilename=WeChat-MP-Tools-{#MyAppVersion}-{#MyAppEdition}-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; 仅 64 位。x64compatible 在 Inno 6.3 及以上（含 7.x）都支持；
; 更老的 6.2 及以下会报未知架构，那时把这两行换成 x64 即可。
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName={#MyAppName}
; SetupIconFile=app.ico
; LicenseFile=..\LICENSE

[Languages]
; Inno Setup 默认只带英文。中文界面需要把官方非官方翻译 ChineseSimplified.isl
; 放到 Inno Setup 安装目录的 Languages\ 下，然后取消下面这行注释。
; Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; 整个绿色目录原样铺进去（含 frontend/、injection_scripts/、ms-playwright/ 等）
Source: "..\dist\WeChat MP Tools\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent

; ── 卸载时保留用户数据 ──────────────────────────────────────────────────
; 默认不删除 {app}\data（下载的文章、账号池、阅读书签都在这里）。
; 如果你希望"卸载即清空"，取消下面的注释。
; [UninstallDelete]
; Type: filesandordirs; Name: "{app}\data"
; Type: filesandordirs; Name: "{app}\ffmpeg"
