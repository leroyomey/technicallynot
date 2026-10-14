#!/usr/bin/env bash
# Builds the whisper.cpp speech engine (whisper-cli + whisper-server) for the voice prompt on macOS and Linux, from the same pinned tag the
# Windows download uses (desktop/voice-service.js ENGINE). Output: build-resources/whisper/<mac|linux>-<arch>/, which electron-builder ships
# as <resources>/whisper (extraResources in build.mac / build.linux). Run on the target OS and arch (CI: macos-14, macos-13, ubuntu-22.04,
# ubuntu-22.04-arm). Needs git, cmake, a C/C++ compiler, and on Linux patchelf.
#   tools/build-whisper.sh            # host arch
set -euo pipefail

REF="${WHISPER_REF:-b5130}"   # keep equal to the Windows ENGINE tag in desktop/voice-service.js
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
case "$(uname -s)" in Darwin) OS=mac ;; Linux) OS=linux ;; *) echo "macOS or Linux only" >&2; exit 1 ;; esac
case "$(uname -m)" in x86_64|amd64) ARCH=x64 ;; arm64|aarch64) ARCH=arm64 ;; *) echo "Unsupported arch $(uname -m)" >&2; exit 1 ;; esac
OUT="$ROOT/build-resources/whisper/$OS-$ARCH"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

git clone --depth 1 --branch "$REF" https://github.com/ggml-org/whisper.cpp.git "$WORK/src"

FLAGS=(-DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_EXAMPLES=ON -DWHISPER_BUILD_SERVER=ON -DWHISPER_BUILD_TESTS=OFF -DWHISPER_SDL2=OFF -DWHISPER_CURL=OFF -DGGML_NATIVE=OFF)
if [ "$OS" = mac ]; then
  # Static, one self-contained binary each. Apple Silicon: Metal with the shader embedded (no .metal file to find at run time).
  # Intel Macs: CPU only (every Mac that runs macOS 12+ has AVX2/FMA/F16C).
  FLAGS+=(-DBUILD_SHARED_LIBS=OFF -DCMAKE_OSX_DEPLOYMENT_TARGET=12.0)
  if [ "$ARCH" = arm64 ]; then FLAGS+=(-DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON)
  else FLAGS+=(-DGGML_METAL=OFF -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON); fi
elif [ "$ARCH" = x64 ]; then
  # Like the Windows zip: one libggml-cpu-*.so per CPU generation, the fastest one picked at run time, so old and new PCs both work.
  FLAGS+=(-DBUILD_SHARED_LIBS=ON -DGGML_BACKEND_DL=ON -DGGML_CPU_ALL_VARIANTS=ON)
else
  FLAGS+=(-DBUILD_SHARED_LIBS=OFF)   # arm64 baseline (NEON) in one static binary each
fi

cmake -S "$WORK/src" -B "$WORK/build" "${FLAGS[@]}"
cmake --build "$WORK/build" --config Release -j "$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)" --target whisper-cli whisper-server

rm -rf "$OUT"; mkdir -p "$OUT"
cp "$WORK/build/bin/whisper-cli" "$WORK/build/bin/whisper-server" "$OUT/"
if [ "$OS" = linux ] && [ "$ARCH" = x64 ]; then
  find "$WORK/build" -name '*.so*' \( -type f -o -type l \) -exec cp -P {} "$OUT/" \;
  # Every file finds its libraries next to itself, wherever the app is installed (deb, AppImage mount).
  for f in "$OUT"/*; do [ -L "$f" ] || patchelf --set-rpath '$ORIGIN' "$f"; done
fi
chmod 0755 "$OUT"/whisper-cli "$OUT"/whisper-server
cp "$WORK/src/LICENSE" "$OUT/LICENSE-whisper.cpp"

HELP="$("$OUT/whisper-cli" --help 2>&1 || true)"
case "$HELP" in *[Uu]sage:*) ;; *) echo "whisper-cli does not start: $HELP" >&2; exit 1 ;; esac
echo "Built whisper.cpp $REF into $OUT"; ls -l "$OUT"
