# Third-party notices

Technically Not's own code is under the [MIT licence](LICENSE). It also uses software, fonts and icons made by other people. Each of those keeps its own licence. This file lists them and says where each licence text is.

An installed copy of the app carries the full texts in `resources/THIRD-PARTY-NOTICES.txt` (written at build time by `tools/third-party-notices.js`), with Electron's own `LICENSE.electron.txt` and `LICENSES.chromium.html` beside the program.

## Licences that ask for more than MIT does

Most of the list below is MIT, ISC, BSD or Apache-2.0: keep the copyright line and the licence text, and that is all. These are the ones to know about:

| What | Licence | What it asks |
| --- | --- | --- |
| Outfit and JetBrains Mono fonts | SIL Open Font License 1.1 | The fonts may be shipped with software but not sold by themselves, and the licence text travels with them. It is in `src/assets/fonts/`. |
| Chromium, inside Electron | BSD-3-Clause, with parts under other licences, among them LGPL-2.1 (FFmpeg) | Electron ships the notices as `LICENSES.chromium.html` next to the program, and FFmpeg as a separate library file. Do not remove either from a build. |
| NVIDIA Parakeet speech model | CC-BY-4.0 | Credit to NVIDIA. The model is not in the installer or this repository: the app downloads it only when you pick that voice model. |
| jsQR (the phone page reads a QR code with it) | Apache-2.0 | The licence text travels with it: `phone/app/vendor/jsqr-LICENSE.txt`. |
| argparse (comes with js-yaml) | Python-2.0 | Keep its copyright and licence text; they are in the installer's notices file. |
| QR Code Generator for JavaScript (used by one test) | MIT | Its header also notes that "QR Code" is a registered trademark of DENSO WAVE INCORPORATED. The header stays in `tools/phone-pair-try/vendor/qrcode.js`. |

Nothing in the app is under the GPL or AGPL.

## Packages from npm

<!-- npm list: start (this list is written by a script; do not edit it by hand) -->

Packed into the installer (21 packages):

- @xterm/addon-fit 0.11.0: MIT
- @xterm/addon-webgl 0.19.0: MIT
- @xterm/xterm 6.0.0: MIT
- argparse 2.0.1: Python-2.0
- builder-util-runtime 9.7.0: MIT
- debug 4.4.3: MIT
- electron-updater 6.8.9: MIT
- fs-extra 10.1.0: MIT
- graceful-fs 4.2.11: ISC
- js-yaml 4.3.2: MIT
- jsonfile 6.2.1: MIT
- lazy-val 1.0.5: MIT
- lodash.escaperegexp 4.1.2: MIT
- lodash.isequal 4.5.0: MIT
- ms 2.1.3: MIT
- node-addon-api 7.1.1: MIT
- node-pty 1.1.0: MIT
- sax 1.6.1: BlueOak-1.0.0
- semver 7.7.4: ISC
- tiny-typed-emitter 2.1.0: MIT
- universalify 2.0.1: MIT

Used only to build, format and test (274 packages, none of them inside the installer), by licence:

- MIT: 206
- ISC: 35
- BSD-3-Clause: 9
- BlueOak-1.0.0: 7
- BSD-2-Clause: 6
- Apache-2.0: 6
- WTFPL OR ISC: 1
- WTFPL: 1
- 0BSD: 1
- (MIT OR CC0-1.0): 1
- (WTFPL OR MIT): 1

<!-- npm list: end -->

## What a build ships besides npm packages

| What | Version | Licence | Where the text is |
| --- | --- | --- | --- |
| Electron | 44 | MIT | `LICENSE.electron.txt` next to the program |
| Chromium and the Node.js inside Electron | as in Electron 44 | BSD-3-Clause and others | `LICENSES.chromium.html` next to the program |
| Node.js, a second copy the app runs its small scripts with (`resources/node`) | 24 | MIT, with parts under their own licences (V8 and others BSD-3-Clause, OpenSSL Apache-2.0, ICU Unicode-3.0, zlib) | `resources/node/LICENSE`, beside that program. `tools/fetch-node-runtime.js` places it and a build is refused without it. |
| winpty, inside node-pty | as in node-pty | MIT | the installer's notices file |
| Microsoft ConPTY (`conpty.dll`, `OpenConsole.exe`), inside node-pty on Windows | as in node-pty | MIT | <https://github.com/microsoft/terminal/blob/main/LICENSE> |
| The Windows installer itself (NSIS, by way of electron-builder) | as in electron-builder | zlib/libpng | <https://nsis.sourceforge.io/License> |
| whisper.cpp, the speech engine (in the Mac and Linux builds; downloaded once on Windows) | set in `desktop/voice-service.js` | MIT | the installer's notices file |

## Copied into this repository

| What | Where | Licence | Where the text is |
| --- | --- | --- | --- |
| Outfit font | `src/assets/fonts/` | OFL-1.1 | `src/assets/fonts/OFL-Outfit.txt` |
| JetBrains Mono font | `src/assets/fonts/` | OFL-1.1 | `src/assets/fonts/OFL-JetBrainsMono.txt` |
| Lucide icons (the ones the app and the phone page use) | `src/vendor/lucide/`, `phone/app/icons.mjs` | ISC | `src/vendor/lucide/LICENSE.txt` |
| Floating UI | `src/vendor/floating-ui/` | MIT | `src/vendor/floating-ui/LICENSE.txt` |
| uPlot | `src/vendor/uplot/` | MIT | `src/vendor/uplot/LICENSE` |
| Parts of D3 (scale, shape, path, array, interpolate, color, format, time, time-format) and internmap | `src/vendor/d3/` | ISC | `src/vendor/d3/LICENSE-*.txt` |
| jsQR | `phone/app/vendor/` | Apache-2.0 | `phone/app/vendor/jsqr-LICENSE.txt` |
| QR Code Generator for JavaScript | `tools/phone-pair-try/vendor/qrcode.js` | MIT | the header of that file |

The relay in `relay/` and the phone page in `phone/` use no npm packages.

## Downloaded by the app, never shipped

Each is fetched from its maker only when you turn on the feature that needs it.

| What | Licence |
| --- | --- |
| Whisper speech models (base, small, large-v3-turbo) | MIT |
| sherpa-onnx, with ONNX Runtime | Apache-2.0, MIT |
| NVIDIA Parakeet TDT 0.6B v3 speech model | CC-BY-4.0 |

## Sounds, pictures and the logo

The app's sounds are made by code while it runs; no sound file is shipped. The app icon, the logo, the device pictures and the mascot are Technically Not's own and are not part of the MIT licence: see [TRADEMARKS.md](TRADEMARKS.md).
