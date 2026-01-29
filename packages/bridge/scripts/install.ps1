# ──────────────────────────────────────────────
# Broski Bridge — Installer for Windows
# ──────────────────────────────────────────────
# Usage:
#   irm https://broskiapp.com/install.ps1 | iex

$ErrorActionPreference = "Stop"

$Version = "0.1.0"
$BaseUrl = "https://broskiapp.com/download"
$AnalyticsUrl = "https://neat-gerbil-813.convex.site/hooks/bridge-install"

Write-Host ""
Write-Host "  ____                _    _ "
Write-Host " | __ ) _ __ ___  ___| | _(_)"
Write-Host " |  _ \| '__/ _ \/ __| |/ / |"
Write-Host " | |_) | | | (_) \__ \   <| |"
Write-Host " |____/|_|  \___/|___/_|\_\_|"
Write-Host ""
Write-Host "  Installing Broski v$Version..."
Write-Host ""

# ── Detect Architecture ─────────────────────
$Arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
switch ($Arch) {
    "X64" { $Target = "windows-x64" }
    default {
        Write-Host "  Error: Unsupported architecture '$Arch'."
        Write-Host "  Broski currently supports x64 on Windows."
        exit 1
    }
}

$BinaryName = "broski-$Target.exe"
$InstallDir = "$env:USERPROFILE\.broski\bin"

Write-Host "  Platform: $Target"
Write-Host ""

# ── Create install directory ─────────────────
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

# ── Download binary ──────────────────────────
$DownloadUrl = "$BaseUrl/$BinaryName"
$OutputPath = "$InstallDir\broski.exe"

Write-Host "  Downloading $BinaryName..."
try {
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $OutputPath -UseBasicParsing
} catch {
    Write-Host "  Error: Failed to download from $DownloadUrl"
    Write-Host "  $($_.Exception.Message)"
    exit 1
}
Write-Host "  Downloaded to $OutputPath"
Write-Host ""

# ── Add to PATH ──────────────────────────────
$CurrentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($CurrentPath -notlike "*$InstallDir*") {
    $NewPath = "$InstallDir;$CurrentPath"
    [Environment]::SetEnvironmentVariable("PATH", $NewPath, "User")
    Write-Host "  Added $InstallDir to user PATH."
    Write-Host "  (Restart your terminal for PATH changes to take effect.)"
} else {
    Write-Host "  Already in PATH."
}

# ── Track install (non-blocking background job) ──
Start-Job -ScriptBlock {
    param($Url, $Target, $Version)
    try {
        $Body = @{
            platform = $Target
            version  = $Version
            method   = "powershell-installer"
        } | ConvertTo-Json

        Invoke-WebRequest -Uri $Url -Method POST -Body $Body `
            -ContentType "application/json" -UseBasicParsing | Out-Null
    } catch {
        # Silently ignore analytics errors
    }
} -ArgumentList $AnalyticsUrl, $Target, $Version | Out-Null

# ── Done ─────────────────────────────────────
Write-Host ""
Write-Host "  Broski v$Version installed successfully!"
Write-Host ""
Write-Host "  Next steps:"
Write-Host "    1. Restart your terminal."
Write-Host "    2. Run 'broski setup' to get started."
Write-Host ""
