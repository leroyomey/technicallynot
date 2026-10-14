<#
.SYNOPSIS
  Launches the built <Dist>\win-unpacked\TechnicallyNot.ai.exe with a DevTools port and runs packaged-check.mjs against it. Run after `npm run dist`.
  -Dist picks another output folder (e.g. dist\build-5). Only the Technically Not processes started from that exe are stopped afterwards, so a Technically Not the user has open keeps running.
#>
param([string]$Dist = 'dist')
$root = Split-Path (Split-Path $PSScriptRoot)
$exe = Join-Path $root (Join-Path $Dist 'win-unpacked\TechnicallyNot.ai.exe')
# A throwaway profile, so the check never touches the user's real data in AppData\Roaming\TechnicallyNot.ai (workspaces, accounts, sessions).
$profile = Join-Path $env:TEMP ('tnai-packaged-check-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
# A free DevTools port picked now (bind port 0, read it, release it), so a stray Chrome/Electron on a fixed port can't block the check.
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0); $listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
$p = Start-Process -FilePath $exe -ArgumentList "--remote-debugging-port=$port", "--user-data-dir=`"$profile`"" -PassThru
try { node (Join-Path $PSScriptRoot 'packaged-check.mjs') $port }
finally {
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; Get-Process 'TechnicallyNot.ai' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | Stop-Process -Force
  Start-Sleep -Milliseconds 500; Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue
}
