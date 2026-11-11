param()
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
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
