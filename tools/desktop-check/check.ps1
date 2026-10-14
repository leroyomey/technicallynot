<#
.SYNOPSIS
  Runs Technically Not in Electron with an isolated profile and one renderer test, then prints the log. Screenshot: tools/browser-check/out/desktop-<Test>.png
.EXAMPLE
  .\tools\desktop-check\check.ps1            # core: bridge, agent detection, shell + Claude Code panes, project folder save
  .\tools\desktop-check\check.ps1 -Test real-agent-lag -RealProject   # the project is a throwaway copy of this repo instead of the 2-file sample
#>
param([string]$Test = 'core', [switch]$RealProject)
$root = Split-Path (Split-Path $PSScriptRoot)
$env:TNAI_SELFTEST = $Test
if ($RealProject) { $env:TNAI_CHECK_PROJECT = 'repo' }
# voice-prompt: fake mic + fake speech engine; main.js reads this before the app starts (Chromium switches), so it can't come from a .main.js.
$fakeVoice = ($Test -eq 'voice-prompt' -or $Test -eq 'perf-latency') -and -not $env:TN_VOICE_FAKE
if ($fakeVoice) { $env:TN_VOICE_FAKE = 'hello from the fake mic' }
try { & (Join-Path $root 'node_modules\electron\dist\electron.exe') $root 2>&1 | Where-Object { $_ -notmatch 'DevTools|GPU|gpu_' } }
finally {
  Remove-Item Env:TNAI_SELFTEST
  Remove-Item Env:TNAI_CHECK_PROJECT -ErrorAction SilentlyContinue
  if ($fakeVoice) { Remove-Item Env:TN_VOICE_FAKE }
  # run.js can't delete its own profile while Electron still has it open, so sweep finished ones here (older than 15 min, so parallel runs are safe).
  Get-ChildItem $env:TEMP -Directory -Filter 'tnai-desktop-check-*' -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddMinutes(-15) } |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}
