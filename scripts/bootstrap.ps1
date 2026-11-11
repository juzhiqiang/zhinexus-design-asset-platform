param()
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$nodeVersion = (Get-Content -LiteralPath (Join-Path $repoRoot '.node-version') -Raw).Trim()
$manifest = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
$pnpmVersion = $manifest.packageManager -replace '^pnpm@', ''
$toolsDir = Join-Path $repoRoot '.tools'
$nodeFolder = "node-v$nodeVersion-win-x64"
$nodeDir = Join-Path $toolsDir $nodeFolder
$pnpmDir = Join-Path $toolsDir "pnpm-native-$pnpmVersion"
if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { throw 'This bootstrap supports Windows x64. Use the pinned Node/pnpm versions manually on other platforms.' }
New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $nodeDir 'node.exe'))) {
  $archiveName = "$nodeFolder.zip"
  $archivePath = Join-Path $toolsDir $archiveName
  $baseUri = "https://nodejs.org/dist/v$nodeVersion"
  Write-Host "Downloading Node $nodeVersion to project-local .tools"
  $sums = (Invoke-WebRequest -Uri "$baseUri/SHASUMS256.txt").Content
  $line = ($sums -split '\r?\n' | Where-Object { $_ -match ("\s+" + [regex]::Escape($archiveName) + '$') })
  if (@($line).Count -ne 1) { throw 'Node checksum entry not found or ambiguous' }
  $expected = ($line -split '\s+')[0]
  Invoke-WebRequest -Uri "$baseUri/$archiveName" -OutFile $archivePath
  if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Node checksum mismatch' }
  Expand-Archive -LiteralPath $archivePath -DestinationPath $toolsDir -Force
}
if (-not (Test-Path -LiteralPath (Join-Path $pnpmDir 'package/pnpm.exe'))) {
  Write-Host "Downloading pnpm $pnpmVersion to project-local .tools"
  $metadata = Invoke-RestMethod -Uri "https://registry.npmjs.org/@pnpm%2fexe.win32-x64/$pnpmVersion"
  $archivePath = Join-Path $toolsDir "pnpm-native-$pnpmVersion.tgz"
  Invoke-WebRequest -Uri $metadata.dist.tarball -OutFile $archivePath
  $digest = [Security.Cryptography.SHA512]::Create()
  try { $actual = 'sha512-' + [Convert]::ToBase64String($digest.ComputeHash([IO.File]::ReadAllBytes($archivePath))) } finally { $digest.Dispose() }
  if ($actual -ne $metadata.dist.integrity) { throw 'pnpm integrity mismatch' }
  New-Item -ItemType Directory -Force -Path $pnpmDir | Out-Null
  & tar -xzf $archivePath -C $pnpmDir
  if ($LASTEXITCODE -ne 0) { throw 'pnpm extraction failed' }
}
$binDir = Join-Path $toolsDir 'bin'
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
$shim = "@echo off`r`n`"%~dp0..\pnpm-native-$pnpmVersion\package\pnpm.exe`" %*`r`n"
[IO.File]::WriteAllText((Join-Path $binDir 'pnpm.cmd'), $shim, [Text.Encoding]::ASCII)
if ((& (Join-Path $nodeDir 'node.exe') --version) -ne "v$nodeVersion") { throw 'Node version verification failed' }
if ((& (Join-Path $pnpmDir 'package/pnpm.exe') --version) -ne $pnpmVersion) { throw 'pnpm version verification failed' }
Write-Host "Project toolchain ready: Node $nodeVersion / pnpm $pnpmVersion"
