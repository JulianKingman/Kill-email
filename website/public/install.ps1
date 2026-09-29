# Install (or update) Kill All Email on Windows and start it.
#
#   irm https://killall.email/install.ps1 | iex
#
# Puts kill-email.exe in %LOCALAPPDATA%\kill-email and adds that folder to your PATH.
$ErrorActionPreference = 'Stop'

$repo = 'JulianKingman/Kill-email'
$channel = if ($env:KILL_EMAIL_CHANNEL) { $env:KILL_EMAIL_CHANNEL } else { 'nightly' }
$dir = Join-Path $env:LOCALAPPDATA 'kill-email'
$url = "https://github.com/$repo/releases/download/$channel/kill-email-windows-x86_64.zip"
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("kill-email-" + [guid]::NewGuid())

Write-Host "Downloading kill-email for Windows"
New-Item -ItemType Directory -Force $tmp, $dir | Out-Null
Invoke-WebRequest $url -OutFile (Join-Path $tmp 'k.zip') -UseBasicParsing
Expand-Archive (Join-Path $tmp 'k.zip') -DestinationPath $tmp -Force
Copy-Item (Join-Path $tmp 'kill-email.exe') $dir -Force
Remove-Item $tmp -Recurse -Force
Write-Host "Installed $dir\kill-email.exe"

$path = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($path -split ';') -notcontains $dir) {
    [Environment]::SetEnvironmentVariable('Path', "$path;$dir", 'User')
    Write-Host "Added $dir to your PATH (new terminals will see it)"
}

if ($env:KILL_EMAIL_NO_RUN -ne '1') {
    & (Join-Path $dir 'kill-email.exe')
}
