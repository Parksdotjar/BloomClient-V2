$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$project = Join-Path $PSScriptRoot "BloomReleaseManager.csproj"
$publish = Join-Path $PSScriptRoot "publish"
$exe = Join-Path $publish "BloomReleaseManager.exe"
$source = Join-Path $PSScriptRoot "Program.cs"

$needsBuild = -not (Test-Path $exe)
if (-not $needsBuild) {
    $needsBuild = (Get-Item $source).LastWriteTimeUtc -gt (Get-Item $exe).LastWriteTimeUtc -or
        (Get-Item $project).LastWriteTimeUtc -gt (Get-Item $exe).LastWriteTimeUtc
}

if ($needsBuild) {
    dotnet publish $project -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -o $publish
    if ($LASTEXITCODE -ne 0) { throw "Bloom Release Manager could not be built." }
}

Start-Process -FilePath $exe -ArgumentList @("--repo", ('"' + $repo + '"')) -WorkingDirectory $repo -WindowStyle Hidden
