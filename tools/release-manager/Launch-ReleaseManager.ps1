$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$project = Join-Path $PSScriptRoot "BloomReleaseManager.csproj"
$publish = Join-Path $PSScriptRoot "publish"
$exe = Join-Path $publish "BloomReleaseManager.exe"
$source = Join-Path $PSScriptRoot "Program.cs"
$uiFiles = Get-ChildItem (Join-Path $PSScriptRoot "ui") -File -Recurse

$running = Get-Process -Name "BloomReleaseManager" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($running) {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class BloomWindow {
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
}
"@
    if ($running.MainWindowHandle -ne [IntPtr]::Zero) {
        [BloomWindow]::ShowWindow($running.MainWindowHandle, 9) | Out-Null
        [BloomWindow]::SetForegroundWindow($running.MainWindowHandle) | Out-Null
    }
    exit 0
}

$needsBuild = -not (Test-Path $exe)
if (-not $needsBuild) {
    $needsBuild = (Get-Item $source).LastWriteTimeUtc -gt (Get-Item $exe).LastWriteTimeUtc -or
        (Get-Item $project).LastWriteTimeUtc -gt (Get-Item $exe).LastWriteTimeUtc -or
        ($uiFiles | Where-Object { $_.LastWriteTimeUtc -gt (Get-Item $exe).LastWriteTimeUtc } | Select-Object -First 1)
}

if ($needsBuild) {
    dotnet publish $project -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -o $publish
    if ($LASTEXITCODE -ne 0) { throw "Bloom Release Manager could not be built." }
}

Start-Process -FilePath $exe -ArgumentList @("--repo", ('"' + $repo + '"')) -WorkingDirectory $repo
