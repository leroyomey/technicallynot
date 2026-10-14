<#
.SYNOPSIS
  Loads Technically Not in headless Chrome with one test script and prints the test log, including any JS errors.
.EXAMPLE
  .\tools\browser-check\check.ps1                                   # smoke test: every page, JS errors
  .\tools\browser-check\check.ps1 -Test project-folder -Phases 1,2  # phase 2 = reload in the same profile
#>
param([string]$Test = 'smoke', [int[]]$Phases = @(1), [int]$Port = 8766)
$here = $PSScriptRoot; $out = Join-Path $here 'out'
New-Item -ItemType Directory -Force $out | Out-Null
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw 'Google Chrome was not found. Do not substitute headless Edge; it crashed in earlier attempts.' }
$profileDir = Join-Path $env:TEMP "tnai-browser-check-$Test"  # outside the OneDrive-synced project
if (Test-Path $profileDir) { Remove-Item -Recurse -Force $profileDir }
$server = Start-Process python -ArgumentList "`"$here\server.py`" $Port" -PassThru -WindowStyle Hidden
try {
  Start-Sleep -Milliseconds 800
  foreach ($phase in $Phases) {
    $log = Join-Path $out "$Test-$phase.log"
    if (Test-Path $log) { Remove-Item -Force $log }
    $shot = Join-Path $out "$Test-$phase.png"
    Start-Process -FilePath $chrome -Wait -NoNewWindow -ArgumentList @('--headless=new', '--disable-gpu', '--no-first-run', "--user-data-dir=`"$profileDir`"", '--window-size=1440,900', '--timeout=90000', "--screenshot=`"$shot`"", "http://127.0.0.1:$Port/__check?test=$Test&phase=$phase")
    "== $Test phase $phase  (screenshot: $shot)"
    if (Test-Path $log) { Get-Content $log } else { 'NO LOG: the page did not report back. Check the screenshot.' }
  }
} finally { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
