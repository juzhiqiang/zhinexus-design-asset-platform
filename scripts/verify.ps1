param([switch]$Bootstrap)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

# Toolchain verification is opt-in: it downloads fresh copies and skips daily checks.
if ($Bootstrap) {
  $toolsRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot '.tools'))
  $testRoot = Join-Path $toolsRoot ('bootstrap-check-' + [Guid]::NewGuid().ToString('N'))
  $windowsPowerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
  New-Item -ItemType Directory -Path (Join-Path $testRoot 'scripts') -Force | Out-Null
  try {
    Copy-Item -LiteralPath (Join-Path $repoRoot '.node-version') -Destination $testRoot
    Copy-Item -LiteralPath (Join-Path $repoRoot 'package.json') -Destination $testRoot
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'bootstrap.ps1') -Destination (Join-Path $testRoot 'scripts')
    $bootstrapPath = Join-Path $testRoot 'scripts/bootstrap.ps1'
    foreach ($phase in @('fresh download', 'cached rerun')) {
      Write-Host "Checking Windows PowerShell 5.1 bootstrap: $phase"
      & $windowsPowerShell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $bootstrapPath
      if ($LASTEXITCODE -ne 0) { throw "Windows PowerShell bootstrap failed: $phase (exit $LASTEXITCODE)" }
    }
    Write-Host 'Windows PowerShell bootstrap passed: clean download, checksums, pinned executable versions, cached rerun.'
  } finally {
    $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
    $expectedParent = $toolsRoot + [IO.Path]::DirectorySeparatorChar
    if (-not $resolvedTestRoot.StartsWith($expectedParent, [StringComparison]::OrdinalIgnoreCase) -or
        (Split-Path -Leaf $resolvedTestRoot) -notmatch '^bootstrap-check-[a-f0-9]{32}$') {
      throw "Refusing cleanup outside the isolated bootstrap test directory: $resolvedTestRoot"
    }
    if (Test-Path -LiteralPath $resolvedTestRoot) { Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force }
  }
  return
}

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
    @('test:browser')
  )) {
    & (Join-Path $PSScriptRoot 'pnpm.ps1') @taskArgs
    if ($LASTEXITCODE -ne 0) { throw "Verification failed: pnpm $($taskArgs -join ' ')" }
  }
  Write-Host 'Bootstrap verification passed (not full T01 acceptance).'
} finally {
  $env:NEXT_PUBLIC_SITE_URL = $previousSiteUrl
  Pop-Location
}
