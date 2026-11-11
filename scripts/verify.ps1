param()
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
  foreach ($taskArgs in @(
    @('install', '--frozen-lockfile'),
    @('verify:workspace'),
    @('build'),
    @('typecheck'),
    @('test'),
    @('test:browser'),
    @('build:services')
  )) {
    & (Join-Path $PSScriptRoot 'pnpm.ps1') @taskArgs
    if ($LASTEXITCODE -ne 0) { throw "Verification failed: pnpm $($taskArgs -join ' ')" }
  }
  Write-Host 'Bootstrap verification passed (not full T01 acceptance).'
} finally { Pop-Location }
