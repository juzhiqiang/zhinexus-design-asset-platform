param([Parameter(ValueFromRemainingArguments = $true)][string[]]$PnpmArgs)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$nodeVersion = (Get-Content -LiteralPath (Join-Path $repoRoot '.node-version') -Raw).Trim()
$manifest = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
$pnpmVersion = $manifest.packageManager -replace '^pnpm@', ''
$nodeDir = Join-Path $repoRoot ".tools/node-v$nodeVersion-win-x64"
$pnpmEntry = Join-Path $repoRoot ".tools/pnpm-native-$pnpmVersion/package/pnpm.exe"
if (-not (Test-Path -LiteralPath (Join-Path $nodeDir 'node.exe')) -or -not (Test-Path -LiteralPath $pnpmEntry)) {
  & (Join-Path $PSScriptRoot 'bootstrap.ps1')
}
$previousPath = $env:PATH
$previousBrowsersPath = $env:PLAYWRIGHT_BROWSERS_PATH
try {
  $env:PATH = (Join-Path $repoRoot '.tools/bin') + ';' + $nodeDir + ';' + $previousPath
  $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $repoRoot '.tools/playwright'
  & $pnpmEntry @PnpmArgs
  $resultCode = $LASTEXITCODE
} finally {
  $env:PATH = $previousPath
  $env:PLAYWRIGHT_BROWSERS_PATH = $previousBrowsersPath
}
exit $resultCode
