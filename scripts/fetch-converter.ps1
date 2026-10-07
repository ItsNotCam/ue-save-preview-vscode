<#
.SYNOPSIS
    Downloads the latest UeSaveConverter release into bin/UeSaveConverter so it gets bundled into the .vsix.
.PARAMETER Tag
    Release tag to fetch (default: latest).
.PARAMETER NoPause
    Skip the "Press Enter" prompt at the end (used when called from npm scripts).
#>
param(
    [string]$Tag = "latest",
    [switch]$NoPause
)

$ErrorActionPreference = "Stop"
$repo = "CrystalFerrai/UeSaveConverter"
$dest = Join-Path $PSScriptRoot "..\bin\UeSaveConverter"

try {
    $api = if ($Tag -eq "latest") { "https://api.github.com/repos/$repo/releases/latest" }
           else { "https://api.github.com/repos/$repo/releases/tags/$Tag" }
    $release = Invoke-RestMethod $api -Headers @{ "User-Agent" = "ue-save-preview-vscode" }
    $asset = $release.assets | Where-Object { $_.name -like "*.zip" } | Select-Object -First 1
    if (-not $asset) { throw "Release $($release.tag_name) has no .zip asset." }

    $tmp = Join-Path ([IO.Path]::GetTempPath()) ("uesaveconv-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $tmp | Out-Null
    $zip = Join-Path $tmp $asset.name
    Write-Host "Downloading $($asset.name) ($($release.tag_name))..."
    Invoke-WebRequest $asset.browser_download_url -OutFile $zip -Headers @{ "User-Agent" = "ue-save-preview-vscode" }

    $extract = Join-Path $tmp "x"
    Expand-Archive $zip -DestinationPath $extract
    $exe = Get-ChildItem $extract -Recurse -Filter "UeSaveConverter.dll" | Select-Object -First 1
    if (-not $exe) { throw "UeSaveConverter.dll not found in $($asset.name)." }

    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
    Copy-Item (Join-Path $exe.DirectoryName "*") $dest -Recurse -Force
    Set-Content (Join-Path $dest "VERSION.txt") $release.tag_name
    Remove-Item $tmp -Recurse -Force

    Write-Host "UeSaveConverter $($release.tag_name) installed to $((Resolve-Path $dest).Path)" -ForegroundColor Green
}
catch {
    Write-Host "ERROR: $_" -ForegroundColor Red
    $failed = $true
}
finally {
    if (-not $NoPause) { Read-Host "`nPress Enter to close" }
}
if ($failed) { exit 1 }
