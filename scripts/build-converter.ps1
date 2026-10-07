<#
.SYNOPSIS
    Builds the vendored (patched) UeSaveConverter in converter/ into bin/UeSaveConverter, which is bundled into the .vsix.
.PARAMETER NoPause
    Skip the "Press Enter" prompt at the end (used when called from npm scripts).
#>
param([switch]$NoPause)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$project = Join-Path $root "converter\UeSaveConverter\UeSaveConverter.csproj"
$dest = Join-Path $root "bin\UeSaveConverter"

try {
    if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { throw "The .NET SDK (8 or newer) is required: https://dotnet.microsoft.com/download" }
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }

    dotnet publish $project -c Release -o $dest --nologo -v quiet
    if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed (exit $LASTEXITCODE)." }
    Remove-Item (Join-Path $dest "*.pdb") -ErrorAction SilentlyContinue
    Copy-Item (Join-Path $root "converter\license.txt") $dest
    Copy-Item (Join-Path $root "converter\README-VENDORED.md") $dest

    Write-Host "UeSaveConverter built to $dest" -ForegroundColor Green
}
catch {
    Write-Host "ERROR: $_" -ForegroundColor Red
    $failed = $true
}
finally {
    if (-not $NoPause) { Read-Host "`nPress Enter to close" }
}
if ($failed) { exit 1 }
