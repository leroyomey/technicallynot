#!/usr/bin/env bash
# Linux twin of check.ps1, for Claude Code cloud sessions: loads Technically Not's browser build in
# headless Chromium with one test script, prints the test log (JS errors included) and saves a screenshot per phase.
#   bash tools/browser-check/check.sh [test] [phases...]     e.g.  bash tools/browser-check/check.sh smoke 1
# Browser build only: agent features, terminals and the desktop bridge are off, exactly as in a plain browser on the PC.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
test="${1:-smoke}"; shift || true
phases=("${@:-1}")
port="${TNAI_CHECK_PORT:-8766}"
chrome="${TNAI_CHROME:-/opt/pw-browsers/chromium}"
[ -x "$chrome" ] || chrome="$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)"
[ -n "$chrome" ] || { echo 'No Chromium found (set TNAI_CHROME).'; exit 2; }
mkdir -p "$here/out"
python3 "$here/server.py" "$port" >"$here/out/server.log" 2>&1 &
server=$!
trap 'kill $server 2>/dev/null' EXIT
sleep 1
for phase in "${phases[@]}"; do
  log="$here/out/$test-$phase.log"; shot="$here/out/$test-$phase.png"; profile="$(mktemp -d)"
  rm -f "$log"
  timeout 120 "$chrome" --headless=new --no-sandbox --disable-gpu --no-first-run --user-data-dir="$profile" --window-size=1440,900 \
    --timeout=90000 --screenshot="$shot" "http://127.0.0.1:$port/__check?test=$test&phase=$phase" >/dev/null 2>&1
  rm -rf "$profile"
  echo "== $test phase $phase (screenshot: tools/browser-check/out/$test-$phase.png)"
  if [ -f "$log" ]; then cat "$log"; else echo 'NO LOG: the page did not report back. Check the screenshot.'; fi
done
