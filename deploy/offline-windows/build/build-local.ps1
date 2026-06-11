# ================================================================
#  Shengju Exam System - Local Windows Offline Installer Build
#  OS: Windows 10/11 x64, PowerShell 5.1+
#  Usage:
#    .\build-local.ps1                   # full build, version 1.0.0
#    .\build-local.ps1 -Version 1.2.0   # custom version
#    .\build-local.ps1 -SkipFrontend    # skip frontend build (dist already exists)
#    .\build-local.ps1 -SkipRuntime     # skip Node.js/MariaDB download
# ================================================================
param(
    [string]$Version      = "1.0.0",
    [switch]$SkipFrontend,
    [switch]$SkipRuntime
)

# Use Continue so native command stderr does not throw terminating errors.
# We check $LASTEXITCODE manually for all build steps.
$ErrorActionPreference = "Continue"

# ── Path setup ───────────────────────────────────────────────────────────────
$BUILD_DIR = $PSScriptRoot
$ROOT      = Split-Path $BUILD_DIR -Parent
$PROJ      = (Resolve-Path "$BUILD_DIR\..\..\..").Path
$PACKAGING = "$ROOT\packaging"
$DIST_OUT  = "$ROOT\dist"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Shengju Exam System - Build Offline Installer  v$Version" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Project root : $PROJ"
Write-Host "  Packaging    : $PACKAGING"
Write-Host "  Output       : $DIST_OUT"
Write-Host ""

# ── Helpers ──────────────────────────────────────────────────────────────────
function Step($n, $total, $msg) {
    Write-Host "[Step $n/$total] $msg" -ForegroundColor Yellow
}
function OK($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function WARN($msg) { Write-Host "  [WARN] $msg" -ForegroundColor DarkYellow }
function FAIL($msg) {
    Write-Host ""
    Write-Host "  [ERROR] $msg" -ForegroundColor Red
    exit 1
}

# ── Step 0: Prerequisite check ───────────────────────────────────────────────
Step 0 9 "Checking prerequisites..."

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { FAIL "node.exe not found. Please install Node.js from https://nodejs.org" }
$nodeVer = (cmd /c "node --version 2>nul")
OK "Node.js $nodeVer is available"

$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCmd) { FAIL "npm not found. Please reinstall Node.js." }
$npmVer = (cmd /c "npm --version 2>nul" | Where-Object { $_ -match '^\d' } | Select-Object -First 1)
OK "npm $npmVer is available"

function Find-ISCC {
    $candidates = @(
        "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        "C:\Program Files\Inno Setup 6\ISCC.exe",
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
        "$env:PROGRAMFILES\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
    )
    foreach ($p in $candidates) {
        if (Test-Path $p) { return $p }
    }
    # Broad search in AppData
    $found = Get-ChildItem "$env:LOCALAPPDATA" -Filter "ISCC.exe" -Recurse -ErrorAction SilentlyContinue -Depth 4 | Select-Object -First 1
    if ($found) { return $found.FullName }
    return $null
}

$ISCC = Find-ISCC
if (-not $ISCC) {
    Write-Host "  Inno Setup 6 not found. Trying to install via winget..." -ForegroundColor Yellow
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Host "  Running: winget install JRSoftware.InnoSetup ..."
        & winget install JRSoftware.InnoSetup --silent --accept-package-agreements --accept-source-agreements
        Start-Sleep -Seconds 3
        $ISCC = Find-ISCC
    }
    if (-not $ISCC) {
        $choco = Get-Command choco -ErrorAction SilentlyContinue
        if ($choco) {
            Write-Host "  Running: choco install innosetup -y"
            & choco install innosetup --yes --no-progress
            Start-Sleep -Seconds 3
            $ISCC = Find-ISCC
        }
    }
    if (-not $ISCC) {
        Write-Host "  Auto-install failed. Please manually download from https://jrsoftware.org/isdl.php" -ForegroundColor Red
        Start-Process "https://jrsoftware.org/isdl.php"
        FAIL "Inno Setup 6 not found. Install it then re-run this script."
    }
}
OK "Inno Setup 6: $ISCC"

# ── Step 1: Build 4 frontend apps ────────────────────────────────────────────
Step 1 9 "Building frontend apps..."

$frontends = @("exam-admin","exam-student","exam-grader","exam-super-admin")

if ($SkipFrontend) {
    WARN "Skipping frontend build (-SkipFrontend)"
    foreach ($app in $frontends) {
        if (-not (Test-Path "$PROJ\frontend\$app\dist")) {
            FAIL "dist for $app not found. Remove -SkipFrontend and rebuild."
        }
    }
} else {
    foreach ($app in $frontends) {
        Write-Host "  Building $app ..."
        Push-Location "$PROJ\frontend\$app"
        try {
            & npm install
            if ($LASTEXITCODE -ne 0) { FAIL "${app}: npm install failed" }
            & npm run build
            if ($LASTEXITCODE -ne 0) { FAIL "${app}: npm run build failed" }
            OK "$app build complete"
        } finally {
            Pop-Location
        }
    }
}

# ── Step 2: Download Node.js v20 LTS portable (needed for backend install) ───
Step 2 9 "Preparing Node.js v20 LTS portable..."

$nodePortableDir = "$PACKAGING\runtime\node"
$nodeExe         = "$nodePortableDir\node.exe"
$nodeNpmCmd      = "$nodePortableDir\npm.cmd"

if ($SkipRuntime -and (Test-Path $nodeExe)) {
    OK "Skipped Node.js download (-SkipRuntime)"
} elseif (Test-Path $nodeExe) {
    $v = (& "$nodeExe" --version 2>&1).ToString().Trim()
    OK "Node.js portable already exists ($v), skipping download"
} else {
    $nodeVersion = "v20.19.2"
    $zipName     = "node-$nodeVersion-win-x64.zip"
    $url         = "https://nodejs.org/dist/$nodeVersion/$zipName"
    $tmpZip      = "$env:TEMP\shengju-node-win-x64.zip"
    $tmpDir      = "$env:TEMP\shengju-node-tmp"

    Write-Host "  Downloading Node.js $nodeVersion ..."
    Write-Host "  URL: $url"

    if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }

    & curl.exe -L -f --retry 3 --max-time 300 -o $tmpZip $url
    if ($LASTEXITCODE -ne 0) { FAIL "Node.js download failed. Check network." }

    Write-Host "  Extracting Node.js..."
    Expand-Archive -Path $tmpZip -DestinationPath $tmpDir -Force
    $extractedDir = Get-ChildItem $tmpDir -Directory | Select-Object -First 1
    if (-not $extractedDir) { FAIL "Node.js extraction failed - no subdirectory found" }

    New-Item -ItemType Directory -Force -Path $nodePortableDir | Out-Null
    Copy-Item -Path "$($extractedDir.FullName)\*" -Destination $nodePortableDir -Recurse -Force

    Remove-Item $tmpZip -Force -ErrorAction SilentlyContinue
    Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue

    $v = (& "$nodeExe" --version 2>&1).ToString().Trim()
    OK "Node.js $v portable ready"
}

# Verify npm.cmd exists in the portable dir
if (-not (Test-Path $nodeNpmCmd)) {
    FAIL "npm.cmd not found in portable Node.js directory ($nodePortableDir). Download may be corrupt."
}
$portableNpmVer = (& "$nodeExe" "$nodePortableDir\node_modules\npm\bin\npm-cli.js" --version 2>&1).ToString().Trim()
OK "Portable npm version: $portableNpmVer"

# ── Step 3: Install backend dependencies using portable Node.js v20 ──────────
Step 3 9 "Installing backend dependencies (using portable Node.js v20)..."

New-Item -ItemType Directory -Force -Path "$PACKAGING\runtime\chromium" | Out-Null

Push-Location "$PROJ\backend"
$origPath = $env:PATH
try {
    # Prepend portable Node.js v20 to PATH so any subprocess (e.g. node-gyp) uses v20
    $env:PATH = "$nodePortableDir;$env:PATH"
    $env:PUPPETEER_CACHE_DIR     = "$PACKAGING\runtime\chromium"
    $env:PUPPETEER_SKIP_DOWNLOAD = "false"

    Write-Host "  Using portable Node.js: $nodeExe"
    Write-Host "  Using portable npm: $nodeNpmCmd"

    # Phase A: Install all packages WITHOUT running any native-build scripts.
    # This avoids the canvas/node-gyp VS-build-tools dependency.
    Write-Host "  Phase A: npm install --omit=dev --ignore-scripts ..."
    & "$nodeNpmCmd" install --omit=dev --ignore-scripts
    if ($LASTEXITCODE -ne 0) { FAIL "Backend npm install (--ignore-scripts) failed (exit $LASTEXITCODE)" }
    OK "Backend packages installed (scripts skipped)"

    # Phase B: Rebuild packages that have pre-built NAPI binaries (no VS tools needed).
    # bcrypt v5 and sharp 0.32+ both provide pre-built NAPI binaries that download automatically.
    # canvas is intentionally SKIPPED (requires VS build tools; Word formula rendering unavailable offline).
    Write-Host "  Phase B: Rebuilding native packages with pre-built NAPI binaries..."
    foreach ($pkg in @("bcrypt", "sharp")) {
        $pkgDir = "$PROJ\backend\node_modules\$pkg"
        if (Test-Path $pkgDir) {
            Write-Host "    Rebuilding $pkg (downloading pre-built NAPI binary)..."
            & "$nodeNpmCmd" rebuild $pkg
            if ($LASTEXITCODE -ne 0) {
                WARN "$pkg rebuild failed - some features may be degraded (non-fatal)"
            } else {
                OK "$pkg ready"
            }
        }
    }
    WARN "canvas native binary skipped (no VS build tools). Word formula/canvas PDF features unavailable offline."

    # Phase C: Run puppeteer install to download Chromium (needed for PDF export).
    Write-Host "  Phase C: Running puppeteer install (downloading Chromium)..."
    $puppeteerDir = "$PROJ\backend\node_modules\puppeteer"
    $puppeteerInstall = $null
    foreach ($f in @("install.mjs", "install.js")) {
        if (Test-Path "$puppeteerDir\$f") { $puppeteerInstall = "$puppeteerDir\$f"; break }
    }
    if ($puppeteerInstall) {
        & "$nodeExe" $puppeteerInstall
        if ($LASTEXITCODE -ne 0) {
            WARN "Puppeteer Chromium download failed - PDF export will be unavailable offline (non-fatal)"
        } else {
            OK "Puppeteer Chromium ready"
        }
    } else {
        WARN "puppeteer install script not found - Chromium may not be downloaded"
    }

    OK "Backend dependencies ready"
} finally {
    Pop-Location
    $env:PATH = $origPath
    Remove-Item Env:\PUPPETEER_CACHE_DIR     -ErrorAction SilentlyContinue
    Remove-Item Env:\PUPPETEER_SKIP_DOWNLOAD -ErrorAction SilentlyContinue
}

# ── Step 4: Prepare packaging directory ──────────────────────────────────────
Step 4 9 "Preparing packaging directory..."

foreach ($d in @(
    "$PACKAGING\app\backend",
    "$PACKAGING\app\frontend",
    "$PACKAGING\data",
    "$PACKAGING\logs",
    "$DIST_OUT"
)) {
    New-Item -ItemType Directory -Force -Path $d | Out-Null
}

# Copy backend (exclude .env / uploads / .git / node_modules cache)
Write-Host "  Copying backend (robocopy)..."
& robocopy "$PROJ\backend" "$PACKAGING\app\backend" /E /XD ".git" "uploads" /XF ".env" /R:2 /W:2 /NP /NFL /NDL /NJH /NJS 2>&1 | Out-Null
# robocopy exit codes: 0-7 = success (bit flags for copied/extras/mismatches)
if ($LASTEXITCODE -ge 8) { FAIL "robocopy backend failed (exit $LASTEXITCODE)" }

# Remove macOS AppleDouble files
Get-ChildItem "$PACKAGING\app\backend" -Recurse -Filter "._*" -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue

# Copy frontend dist folders
foreach ($app in $frontends) {
    $src = "$PROJ\frontend\$app\dist"
    $dst = "$PACKAGING\app\frontend\$app\dist"
    if (Test-Path $src) {
        New-Item -ItemType Directory -Force -Path $dst | Out-Null
        Copy-Item -Path "$src\*" -Destination $dst -Recurse -Force
        OK "Copied $app dist"
    } else {
        WARN "$src not found - frontend build may have failed"
    }
}
OK "Packaging directory ready"

# ── Step 5: Clean node_modules (reduce size to avoid Inno Setup OOM) ─────────
Step 5 9 "Cleaning node_modules redundant files..."

$nm = "$PACKAGING\app\backend\node_modules"
if (Test-Path $nm) {
    $before = (Get-ChildItem $nm -Recurse -File -ErrorAction SilentlyContinue).Count
    Write-Host "  Files before cleanup: $before"

    Get-ChildItem $nm -Recurse -Include @("*.test.js","*.test.ts","*.test.mjs","*.spec.js","*.spec.ts","*.spec.mjs") -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    Get-ChildItem $nm -Recurse -Include @("*.ts","*.tsx") -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    Get-ChildItem $nm -Recurse -Filter "*.map" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    Get-ChildItem $nm -Recurse -Include @("*.md","*.markdown","LICENSE","LICENSE.*","LICENCE","LICENCE.*","CHANGELOG","CHANGELOG.*","NOTICE","AUTHORS","CONTRIBUTORS") -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

    do {
        $empty = Get-ChildItem $nm -Recurse -Directory -ErrorAction SilentlyContinue |
            Where-Object { (Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue).Count -eq 0 }
        $empty | Remove-Item -Force -Recurse -ErrorAction SilentlyContinue
    } while ($empty.Count -gt 0)

    $after = (Get-ChildItem $nm -Recurse -File -ErrorAction SilentlyContinue).Count
    OK "Cleanup done ($before -> $after files)"
} else {
    WARN "node_modules not found, skipping cleanup"
}

# ── Step 6: Download MariaDB 10.11 portable ───────────────────────────────────
Step 6 9 "Preparing MariaDB 10.11 portable..."

$mariadbDir = "$PACKAGING\runtime\mariadb"
$mysqldExe  = "$mariadbDir\bin\mysqld.exe"

if ($SkipRuntime -and (Test-Path $mysqldExe)) {
    OK "Skipped MariaDB download (-SkipRuntime)"
} elseif (Test-Path $mysqldExe) {
    OK "MariaDB portable already exists, skipping download"
} else {
    $mariaVersion = "10.11.10"
    $zipName      = "mariadb-$mariaVersion-winx64.zip"
    # Multiple mirrors; archive.mariadb.org supports resume (-C -)
    $urls = @(
        "https://archive.mariadb.org/mariadb-$mariaVersion/winx64-packages/$zipName",
        "https://archive.mariadb.org/mariadb-$mariaVersion/winx64-packages/$zipName",
        "https://mirror.mariadb.org/mariadb-$mariaVersion/winx64-packages/$zipName"
    )
    $tmpZip = "$env:TEMP\shengju-mariadb.zip"
    $tmpDir = "$env:TEMP\shengju-mariadb-tmp"

    $downloaded = $false
    # archive.mariadb.org is the only confirmed working source (HTTP 200).
    # Use -C - (resume) + --retry-all-errors so curl resumes on any error (including
    # exit 18 partial transfer). At 10KB/s, 85.7MB takes ~2.4hrs with this method.
    $primaryUrl = "https://archive.mariadb.org/mariadb-$mariaVersion/winx64-packages/$zipName"
    Write-Host "  Downloading from: $primaryUrl"
    Write-Host "  (Using resume mode - connection drops will auto-retry from last position)"

    & curl.exe -L -f -C - --retry 100 --retry-delay 5 --retry-all-errors `
               --connect-timeout 30 --max-time 0 `
               -o $tmpZip $primaryUrl
    $curlExit = $LASTEXITCODE

    # Exit 33 = server doesn't support range requests, retry without resume
    if ($curlExit -eq 33) {
        WARN "Server does not support resume; retrying from scratch..."
        Remove-Item $tmpZip -Force -ErrorAction SilentlyContinue
        & curl.exe -L -f --retry 10 --retry-delay 5 --retry-all-errors `
                   --connect-timeout 30 --max-time 0 `
                   -o $tmpZip $primaryUrl
        $curlExit = $LASTEXITCODE
    }

    if ($curlExit -eq 0 -and (Test-Path $tmpZip)) {
        $hdr = [System.IO.File]::ReadAllBytes($tmpZip)
        if ($hdr.Length -gt 3 -and $hdr[0] -eq 0x50 -and $hdr[1] -eq 0x4B) {
            OK "MariaDB download verified (valid ZIP)"
            $downloaded = $true
        } else {
            WARN "Downloaded file is not a valid ZIP - removing"
            Remove-Item $tmpZip -Force -ErrorAction SilentlyContinue
        }
    } else {
        WARN "Download failed with exit code $curlExit"
        if (Test-Path $tmpZip) { Remove-Item $tmpZip -Force }
    }

    if (-not $downloaded) { FAIL "MariaDB download failed after all retries. Manually download mariadb-10.11.10-winx64.zip and extract to: $mariadbDir" }

    if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
    Write-Host "  Extracting MariaDB..."
    Expand-Archive -Path $tmpZip -DestinationPath $tmpDir -Force

    $extractedDir = Get-ChildItem $tmpDir -Directory | Select-Object -First 1
    if (-not $extractedDir) { FAIL "MariaDB extraction failed - no subdirectory found" }

    New-Item -ItemType Directory -Force -Path $mariadbDir | Out-Null
    Copy-Item -Path "$($extractedDir.FullName)\*" -Destination $mariadbDir -Recurse -Force

    Remove-Item $tmpZip -Force -ErrorAction SilentlyContinue
    Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue

    OK "MariaDB $mariaVersion portable ready"
}

# ── Step 7: Confirm Chromium ──────────────────────────────────────────────────
Step 7 9 "Checking Chromium..."

$chrome = Get-ChildItem "$PACKAGING\runtime\chromium" -Recurse -Filter "chrome.exe" -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($chrome) {
    OK "Chromium: $($chrome.FullName)"
} else {
    WARN "chrome.exe not found - Word/formula/PDF features will be unavailable offline (non-fatal, continuing)"
}

# ── Step 8a: Convert bat files from UTF-8 to GBK ─────────────────────────────
Step 8 9 "Fixing bat encoding + icon + BOM..."

Write-Host "  Converting bat files to GBK (Windows cmd.exe compatible)..."
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$gbk       = [System.Text.Encoding]::GetEncoding(936)

Get-ChildItem $PACKAGING -Recurse -Filter "*.bat" | ForEach-Object {
    $content = [System.IO.File]::ReadAllText($_.FullName, $utf8NoBom)
    [System.IO.File]::WriteAllText($_.FullName, $content, $gbk)
    Write-Host "    GBK: $($_.Name)"
}
OK "bat encoding conversion done"

# ── Step 8b: PNG -> ICO ───────────────────────────────────────────────────────
$pngPath = "$BUILD_DIR\app-icon.png"
$icoPath = "$BUILD_DIR\app-icon.ico"

if (Test-Path $pngPath) {
    Write-Host "  Generating app-icon.ico from PNG..."
    Add-Type -AssemblyName System.Drawing

    $sizes   = @(256, 128, 64, 48, 32, 16)
    $src     = [System.Drawing.Bitmap]::new((Resolve-Path $pngPath).Path)
    $streams = @()

    foreach ($sz in $sizes) {
        $bmp = New-Object System.Drawing.Bitmap($src, $sz, $sz)
        $ms  = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $streams += @{ Size = $sz; Data = $ms.ToArray() }
        $bmp.Dispose(); $ms.Dispose()
    }
    $src.Dispose()

    $count      = $streams.Count
    $headerSize = 6 + 16 * $count
    $off        = $headerSize

    $fs = [System.IO.FileStream]::new($icoPath, [System.IO.FileMode]::Create)
    $w  = New-Object System.IO.BinaryWriter($fs)
    $w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$count)

    foreach ($item in $streams) {
        $s = $item.Size
        $w.Write([byte]$(if ($s -ge 256) { 0 } else { $s }))
        $w.Write([byte]$(if ($s -ge 256) { 0 } else { $s }))
        $w.Write([byte]0); $w.Write([byte]0)
        $w.Write([uint16]1); $w.Write([uint16]32)
        $w.Write([uint32]$item.Data.Length)
        $w.Write([uint32]$off)
        $off += $item.Data.Length
    }
    foreach ($item in $streams) { $w.Write($item.Data) }
    $w.Flush(); $fs.Close()

    Copy-Item $icoPath "$PACKAGING\app-icon.ico" -Force
    OK "app-icon.ico generated ($((Get-Item $icoPath).Length) bytes)"

} elseif (Test-Path $icoPath) {
    Copy-Item $icoPath "$PACKAGING\app-icon.ico" -Force
    OK "app-icon.ico exists, copied to packaging"
} else {
    WARN "app-icon.png/ico not found - temporarily removing SetupIconFile from package.iss"
    $issPath   = "$BUILD_DIR\package.iss"
    $issBackup = "$BUILD_DIR\package.iss.bak"
    Copy-Item $issPath $issBackup -Force
    $issContent = Get-Content $issPath -Raw -Encoding UTF8
    $issContent = $issContent -replace "(?m)^SetupIconFile=.*\r?\n", ""
    Set-Content $issPath $issContent -Encoding UTF8
    Write-Host "  SetupIconFile removed (backup: package.iss.bak)"
}

# ── Step 8c: Inject UTF-8 BOM into package.iss ───────────────────────────────
Write-Host "  Injecting UTF-8 BOM into package.iss..."
$issPath  = "$BUILD_DIR\package.iss"
$issBytes = [System.IO.File]::ReadAllBytes($issPath)
if ($issBytes.Length -lt 3 -or $issBytes[0] -ne 0xEF -or $issBytes[1] -ne 0xBB -or $issBytes[2] -ne 0xBF) {
    $bom = [byte[]](0xEF, 0xBB, 0xBF)
    [System.IO.File]::WriteAllBytes($issPath, $bom + $issBytes)
    OK "UTF-8 BOM injected"
} else {
    OK "UTF-8 BOM already present"
}

# ── Step 9 prep: Clean runtime-generated files before packaging ──────────────
# These must NOT be bundled in the installer:
# - data\* : MariaDB data dir (freshly initialized on target by start.bat)
# - logs\* : runtime log files (and node.log can be locked causing ISCC to fail)
# - config\my_runtime.ini : generated from template at runtime
# - app\backend\.env : generated from template at runtime
# - data\.seed_done : seed flag must not be pre-set on target
Write-Host "  Pre-packaging cleanup..."
Get-Process | Where-Object { $_.Name -match 'mysqld|mariadbd|^node$' } |
    Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 2
Get-ChildItem "$PACKAGING\logs" -File -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue
Remove-Item "$PACKAGING\config\my_runtime.ini" -Force -ErrorAction SilentlyContinue
Remove-Item "$PACKAGING\app\backend\.env" -Force -ErrorAction SilentlyContinue
Remove-Item "$PACKAGING\data\.seed_done" -Force -ErrorAction SilentlyContinue
OK "Runtime files cleaned (data/logs excluded via package.iss Excludes)"

# ── Step 9: Run Inno Setup ────────────────────────────────────────────────────
Step 9 9 "Running Inno Setup to create installer..."

Write-Host "  Version  : $Version"
Write-Host "  ISCC     : $ISCC"
Write-Host "  Script   : $BUILD_DIR\package.iss"
Write-Host ""

& "$ISCC" /DAppVersion=$Version "$BUILD_DIR\package.iss"
$isccExit = $LASTEXITCODE

# Restore package.iss backup if it was modified
$issBackup = "$BUILD_DIR\package.iss.bak"
if (Test-Path $issBackup) {
    Copy-Item $issBackup "$BUILD_DIR\package.iss" -Force
    Remove-Item $issBackup -Force
}

if ($isccExit -ne 0) { FAIL "Inno Setup failed (exit $isccExit). See output above." }

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Build SUCCESS!" -ForegroundColor Green
Write-Host ""

$exes = Get-ChildItem "$DIST_OUT\*.exe" -ErrorAction SilentlyContinue
if ($exes) {
    foreach ($exe in $exes) {
        $sizeMB = [math]::Round($exe.Length / 1MB, 1)
        Write-Host "  Output: $($exe.FullName)  ($sizeMB MB)" -ForegroundColor Green
    }
} else {
    WARN "No .exe found in $DIST_OUT"
}

Write-Host ""
Write-Host "  Copy the .exe to the target Windows machine and run to install."
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
