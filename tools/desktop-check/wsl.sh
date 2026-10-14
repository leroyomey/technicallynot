#!/bin/bash
# Technically Not tools · desktop-check/wsl.sh — Runs desktop self-tests on Linux inside WSL2 (Ubuntu + WSLg), against a clone in ~/tnai.
# From Windows:  wsl -d Ubuntu-24.04 -- bash "/mnt/c/.../Project TN.ai/tools/desktop-check/wsl.sh" [test ...]   (default: core)
# Copies the Windows working tree's uncommitted desktop/, src/, tools/ and index.html changes into the clone first, so the run matches it.
# KEYRING=1 starts a throwaway, unlocked GNOME Keyring (safeStorage needs one; plan-lock refuses sign-in without it).
set -o pipefail
SRC=$(cd "$(dirname "$0")/../.." && pwd)
CLONE=~/tnai
[ -d "$CLONE/.git" ] || git clone -q "$SRC" "$CLONE"
cd "$CLONE" || exit 1
(cd "$SRC" && git diff --name-only HEAD; git -C "$SRC" ls-files --others --exclude-standard) | grep -E '^(desktop|src|tools|index\.html)' |
  while read -r f; do [ -f "$SRC/$f" ] && install -D "$SRC/$f" "$f"; done
[ -x node_modules/electron/dist/electron ] || { npm ci --no-audit --no-fund >/dev/null && node node_modules/electron/install.js; }
# systemd gives /tmp a fresh tmpfs, which hides WSLg's X11 socket.
[ -e /tmp/.X11-unix/X0 ] || { sudo rm -rf /tmp/.X11-unix; sudo ln -sfn /mnt/wslg/.X11-unix /tmp/.X11-unix; }
export PATH="$HOME/.local/bin:$PATH"
if [ -n "$KEYRING" ]; then
  command -v gnome-keyring-daemon >/dev/null || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q gnome-keyring libsecret-tools >/dev/null
  export DBUS_SESSION_BUS_ADDRESS=${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus} XDG_CURRENT_DESKTOP=GNOME
  K=~/.local/share/keyrings; mkdir -p $K
  [ -f $K/login.keyring ] || printf '[keyring]\ndisplay-name=login\nctime=0\nmtime=0\nlock-on-idle=false\nlock-after=false\n' > $K/login.keyring
  echo -n login > $K/default
  gnome-keyring-daemon --replace --components=secrets --daemonize >/dev/null 2>&1; sleep 1
fi
timeout -s KILL "${TIMEOUT:-1800}" node tools/desktop-check/check.js "$@" < /dev/null 2>&1 | grep -v -iE 'dbus|gbm_support|vaapi|sandbox_linux|audio_manager'
code=$?
mkdir -p "$SRC/tools/browser-check/out/linux" && cp tools/browser-check/out/desktop-*.png "$SRC/tools/browser-check/out/linux/" 2>/dev/null
exit $code
