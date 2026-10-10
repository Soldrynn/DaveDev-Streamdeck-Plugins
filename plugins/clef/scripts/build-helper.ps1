$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$localDotnet = Join-Path $projectRoot '.tools\dotnet.exe'
$configuredDotnet = $env:CLEF_DOTNET
if (-not [string]::IsNullOrWhiteSpace($configuredDotnet) -and -not (Test-Path -LiteralPath $configuredDotnet)) {
    throw "CLEF_DOTNET does not point to a dotnet executable: $configuredDotnet"
}
$dotnet = if (-not [string]::IsNullOrWhiteSpace($configuredDotnet)) {
    $configuredDotnet
} elseif (Test-Path -LiteralPath $localDotnet) {
    $localDotnet
} else {
    'dotnet'
}
$project = Join-Path $projectRoot 'helper\ClefBridge\ClefBridge.csproj'
$output = Join-Path $projectRoot 'com.davedev.clef.sdPlugin\helper'

# SDK resolution starts at the working directory, where global.json selects .NET 10.
Push-Location $projectRoot
try {
    & $dotnet publish $project -c Release -r win-x64 --self-contained true -o $output
    if ($LASTEXITCODE -ne 0) { throw "Helper publish failed with exit code $LASTEXITCODE." }
} finally {
    Pop-Location
}

$helper = Join-Path $output 'ClefBridge.exe'
& $helper --self-test
if ($LASTEXITCODE -ne 0) { throw "Helper self-tests failed with exit code $LASTEXITCODE." }

$pdb = Join-Path $output 'ClefBridge.pdb'
if (Test-Path -LiteralPath $pdb) { Remove-Item -LiteralPath $pdb -Force }
