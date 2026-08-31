[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 999999999)]
    [int]$PullRequest,
    [switch]$Launch,
    [switch]$Install,
    [switch]$Remove
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$repoParent = Split-Path $repoRoot -Parent
$reviewRoot = Join-Path $repoParent "BloomClient-PR-Reviews"
$reviewPath = Join-Path $reviewRoot "PR-$PullRequest"
$remoteRef = "refs/remotes/origin/review/pr-$PullRequest"

function Invoke-Checked {
    param([string]$File, [string[]]$Arguments, [string]$WorkingDirectory = $repoRoot)
    Push-Location $WorkingDirectory
    try {
        & $File @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "$File stopped with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}

if ($Remove) {
    if (-not (Test-Path -LiteralPath $reviewPath)) {
        Write-Host "PR $PullRequest has no review worktree."
        exit 0
    }

    $changes = (& git -C $reviewPath status --porcelain)
    if ($LASTEXITCODE -ne 0) { throw "Could not inspect the PR review worktree." }
    if ($changes) { throw "The PR review worktree has local changes. Preserve or discard them explicitly before removing it." }

    Invoke-Checked git @("worktree", "remove", $reviewPath)
    Write-Host "Removed the isolated PR $PullRequest review folder."
    exit 0
}

Invoke-Checked gh @("pr", "view", $PullRequest, "--repo", "Parksdotjar/BloomClient-V2", "--json", "number,state,title,url")
Invoke-Checked git @("fetch", "origin", "pull/$PullRequest/head:$remoteRef")

if (Test-Path -LiteralPath $reviewPath) {
    $changes = (& git -C $reviewPath status --porcelain)
    if ($LASTEXITCODE -ne 0) { throw "Could not inspect the existing PR review worktree." }
    if ($changes) { throw "The existing PR review worktree has local changes, so it was not refreshed." }
    Invoke-Checked git @("switch", "--detach", $remoteRef) $reviewPath
}
else {
    New-Item -ItemType Directory -Force -Path $reviewRoot | Out-Null
    Invoke-Checked git @("worktree", "add", "--detach", $reviewPath, $remoteRef)
}

if ($Install -or -not (Test-Path -LiteralPath (Join-Path $reviewPath "node_modules"))) {
    Invoke-Checked npm.cmd @("ci") $reviewPath
}

Write-Host ""
Write-Host "PR $PullRequest is isolated at: $reviewPath" -ForegroundColor Green
Write-Host "Your primary Bloom workspace was not switched or modified."

if ($Launch) {
    Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "npm run tauri dev" -WorkingDirectory $reviewPath
    Write-Host "Opened the PR in its own Tauri development terminal."
}
else {
    Write-Host "Run with -Launch when you are ready to test this PR in Tauri."
}
