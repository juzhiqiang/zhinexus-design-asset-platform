param()
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$previousSiteUrl = $env:NEXT_PUBLIC_SITE_URL
Push-Location $repoRoot
try {
  # Exercise a non-empty sitemap by default, while preserving a caller's configured origin.
  if (-not $env:NEXT_PUBLIC_SITE_URL) { $env:NEXT_PUBLIC_SITE_URL = 'https://gallery.test' }
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
} finally {
  $env:NEXT_PUBLIC_SITE_URL = $previousSiteUrl
  Pop-Location
}
