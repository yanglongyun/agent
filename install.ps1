$ErrorActionPreference = "Stop"

$Repo = "yanglongyun/AGENT"
if ($env:AGENT_REPO) {
    $Repo = $env:AGENT_REPO
}

$Version = "latest"
if ($env:AGENT_VERSION) {
    $Version = $env:AGENT_VERSION.TrimStart("v")
}

$BinDir = Join-Path $env:LOCALAPPDATA "agentic\bin"
if ($env:AGENT_BIN_DIR) {
    $BinDir = $env:AGENT_BIN_DIR
}

$InstallDir = Join-Path $env:LOCALAPPDATA "agentic\program"
if ($env:AGENT_INSTALL_DIR) {
    $InstallDir = $env:AGENT_INSTALL_DIR
}

switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture) {
    "X64" {
        $Arch = "amd64"
    }
    "Arm64" {
        $Arch = "arm64"
    }
    default {
        throw "不支持的 CPU 架构：$_"
    }
}

if ($Version -eq "latest") {
    $Base = "https://github.com/$Repo/releases/latest/download"
} else {
    $Base = "https://github.com/$Repo/releases/download/v$Version"
}
if ($env:AGENT_RELEASE_BASE_URL) {
    $Base = $env:AGENT_RELEASE_BASE_URL
}

$Archive = "agent_windows_$Arch.zip"
$Temp = Join-Path ([IO.Path]::GetTempPath()) ("agentic-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $Temp | Out-Null

try {
    $Zip = Join-Path $Temp $Archive
    $ChecksumPath = Join-Path $Temp "checksum.txt"
    Invoke-WebRequest -UseBasicParsing -Uri "$Base/$Archive" -OutFile $Zip
    Invoke-WebRequest -UseBasicParsing -Uri "$Base/$Archive.sha256" -OutFile $ChecksumPath

    $Checksum = Get-Content -LiteralPath $ChecksumPath -Raw
    $Expected = ($Checksum.Trim() -split '\s+')[0].ToLowerInvariant()
    $Actual = (Get-FileHash $Zip -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($Expected -notmatch '^[a-f0-9]{64}$' -or $Actual -ne $Expected) {
        throw "发布包校验失败"
    }

    Expand-Archive -Path $Zip -DestinationPath $Temp -Force
    $Source = Join-Path $Temp "agentic"
    $Node = Join-Path $Source "runtime\node.exe"
    $Cli = Join-Path $Source "server\scripts\cli.js"
    & $Node $Cli version
    if ($LASTEXITCODE -ne 0) {
        throw "Node.js 运行环境验证失败"
    }

    $Release = Join-Path $InstallDir "releases\$Actual"
    New-Item -ItemType Directory -Force -Path (Split-Path $Release), $BinDir | Out-Null
    if (-not (Test-Path $Release)) {
        Move-Item $Source $Release
    }

    $Launcher = "@echo off`r`nchcp 65001 >nul`r`ncall `"$Release\agent.cmd`" %*`r`n"
    $LauncherPath = Join-Path $BinDir "agent.cmd"
    $Encoding = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($LauncherPath, $Launcher, $Encoding)
} finally {
    Remove-Item $Temp -Recurse -Force -ErrorAction SilentlyContinue
}

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not $env:AGENT_NO_PATH -and ($UserPath -split ";") -notcontains $BinDir) {
    $UpdatedPath = $BinDir
    if ($UserPath) {
        $UpdatedPath = "$UserPath;$BinDir"
    }
    [Environment]::SetEnvironmentVariable("Path", $UpdatedPath, "User")
    $env:Path = "$env:Path;$BinDir"
}

Write-Host "已安装：$(Join-Path $BinDir 'agent.cmd')（自带 Node.js）"
Write-Host "下一步：运行 agent serve，然后打开输出的访问地址。"
