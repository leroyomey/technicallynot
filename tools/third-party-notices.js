/*
 * Technically Not tools · third-party-notices.js — Runs before every build (the pre-build step
 * calls it; tools/prebuild.js is that step with nothing else in it): writes
 * build-resources/THIRD-PARTY-NOTICES.txt from the production dependencies actually installed (the
 * same set electron-builder packs), each with its name, version, license and full license text.
 * electron-builder ships it as resources/THIRD-PARTY-NOTICES.txt; Settings → Updates opens it.
 * Technically Not's own code is under the MIT licence (the LICENSE file of its repository) and is
 * not listed here.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'build-resources', 'THIRD-PARTY-NOTICES.txt');
const pkg = require(path.join(root, 'package.json'));

// Node's lookup: the package's own node_modules, then each parent's.
function findDir(name, from) {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    if (dir === root || path.dirname(dir) === dir) return null;
  }
}

const found = new Map(); // dir → package info
(function walk(deps, from) {
  for (const name of Object.keys(deps || {})) {
    const dir = findDir(name, from);
    if (!dir || found.has(dir)) continue;
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    found.set(dir, meta);
    walk({ ...meta.dependencies, ...meta.optionalDependencies }, dir);
  }
})({ ...pkg.dependencies, ...pkg.optionalDependencies }, root);

const licenseText = dir => {
  const file = fs.readdirSync(dir).find(f => /^(licen[sc]e|copying)(\.|-|$)/i.test(f));
  return file ? fs.readFileSync(path.join(dir, file), 'utf8').trim() : '';
};
const licenseOf = meta =>
  typeof meta.license === 'string'
    ? meta.license
    : meta.license?.type ||
      (meta.licenses || []).map(l => l.type || l).join(' OR ') ||
      'see license text';
const repoOf = meta =>
  String(
    typeof meta.repository === 'string'
      ? meta.repository
      : meta.repository?.url || meta.homepage || ''
  )
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/^(github:)?([\w.-]+\/[\w.-]+)$/, 'https://github.com/$2');

const packages = [...found]
  .map(([dir, meta]) => ({ dir, meta }))
  .sort((a, b) => a.meta.name.localeCompare(b.meta.name));
const rule = '='.repeat(78);
const parts = [
  'Technically Not ' +
    pkg.version +
    ' (build ' +
    (pkg.tnaiBuild || 0) +
    ') — Third-party open-source notices',
  '',
  'Technically Not itself is open source, under the MIT licence: the LICENSE file of its',
  'repository. It uses the open-source software below, made by other people. Each package keeps',
  'its own license; the full texts follow.',
  '',
  'Electron, Chromium and Node.js: Technically Not runs on Electron ' +
    String(pkg.devDependencies?.electron || '').replace(/^[^\d]*/, '') +
    '. Their notices ship',
  'next to the app: LICENSES.chromium.html (Chromium, Node.js and their components) and LICENSE.electron.txt.',
  '',
  'node-pty also bundles winpty (MIT, license below) and, on Windows, Microsoft ConPTY',
  '(conpty.dll, OpenConsole.exe).',
  '',
  'A build may also ship its own copy of Node.js in the folder "node" beside this file; the',
  'license of Node.js and of its parts is the file LICENSE in that folder.',
  '',
  'Packages:',
  ...packages.map(({ meta }) => '  ' + meta.name + ' ' + meta.version + ' — ' + licenseOf(meta)),
];
for (const { dir, meta } of packages) {
  parts.push(
    '',
    rule,
    meta.name +
      ' ' +
      meta.version +
      ' — ' +
      licenseOf(meta) +
      (repoOf(meta) ? '\n' + repoOf(meta) : ''),
    rule,
    '',
    licenseText(dir) || '(No license file in the package; license: ' + licenseOf(meta) + '.)'
  );
}
const winpty = path.join(root, 'node_modules', 'node-pty', 'deps', 'winpty', 'LICENSE');
if (fs.existsSync(winpty))
  parts.push(
    '',
    rule,
    'winpty (bundled by node-pty) — MIT',
    rule,
    '',
    fs.readFileSync(winpty, 'utf8').trim()
  );

// Voice prompts (desktop/voice-service.js): whisper.cpp is bundled on Mac and Linux and downloaded
// once on Windows; the Whisper model is downloaded once.
const MIT =
  'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.';
parts.push(
  '',
  rule,
  'whisper.cpp (voice prompts) — MIT\nhttps://github.com/ggml-org/whisper.cpp',
  rule,
  '',
  'MIT License\n\nCopyright (c) 2023-2024 The ggml authors\n\n' + MIT
);
parts.push(
  '',
  rule,
  'Whisper speech models (ggml base, small, large-v3-turbo; voice prompts) — MIT\nhttps://github.com/openai/whisper',
  rule,
  '',
  'MIT License\n\nCopyright (c) 2022 OpenAI\n\n' + MIT
);

// Parakeet voice model option: sherpa-onnx (with onnxruntime) and the model are downloaded once
// from their official sources when the user picks it, not bundled.
parts.push(
  '',
  rule,
  'sherpa-onnx (Parakeet voice model option) — Apache-2.0\nhttps://github.com/k2-fsa/sherpa-onnx',
  rule,
  '',
  'Copyright (c) Xiaomi Corporation and the k2-fsa authors. Licensed under the Apache License, Version 2.0:\nhttps://www.apache.org/licenses/LICENSE-2.0'
);
parts.push(
  '',
  rule,
  'ONNX Runtime (used by sherpa-onnx) — MIT\nhttps://github.com/microsoft/onnxruntime',
  rule,
  '',
  'MIT License\n\nCopyright (c) Microsoft Corporation\n\n' + MIT
);
parts.push(
  '',
  rule,
  'NVIDIA Parakeet TDT 0.6B v3 speech model (int8 export by the sherpa-onnx project) — CC-BY-4.0\nhttps://huggingface.co/nvidia/parakeet-tdt-0.6b-v3',
  rule,
  '',
  'Model by NVIDIA, licensed under Creative Commons Attribution 4.0 International:\nhttps://creativecommons.org/licenses/by/4.0/\nConverted to ONNX int8 by the sherpa-onnx project; no other changes.'
);

// Bundled UI fonts (src/assets/fonts): the OFL text ships next to the font files.
for (const [name, file, url] of [
  ['Outfit font — OFL-1.1', 'OFL-Outfit.txt', 'https://github.com/Outfitio/Outfit-Fonts'],
  [
    'JetBrains Mono font — OFL-1.1',
    'OFL-JetBrainsMono.txt',
    'https://github.com/JetBrains/JetBrainsMono',
  ],
]) {
  const ofl = path.join(root, 'src', 'assets', 'fonts', file);
  if (fs.existsSync(ofl))
    parts.push('', rule, name + '\n' + url, rule, '', fs.readFileSync(ofl, 'utf8').trim());
}

// Vendored UI libraries (src/vendor): Floating UI (popover placement) and the Lucide icons the app
// uses; license texts ship next to them.
for (const [name, file, url] of [
  [
    'Floating UI (@floating-ui/core + @floating-ui/dom 1.8.0) — MIT',
    'floating-ui/LICENSE.txt',
    'https://github.com/floating-ui/floating-ui',
  ],
  [
    'Lucide icons (lucide-static 1.49.0, selected icons) — ISC',
    'lucide/LICENSE.txt',
    'https://github.com/lucide-icons/lucide',
  ],

  // the colors of code in the Files column's reader (134)
  [
    'highlight.js 11.12.0 (common languages, PowerShell, Dockerfile, Batch) — BSD-3-Clause',
    'highlight/LICENSE.txt',
    'https://github.com/highlightjs/highlight.js',
  ],
]) {
  const lic = path.join(root, 'src', 'vendor', file);
  if (fs.existsSync(lic))
    parts.push('', rule, name + '\n' + url, rule, '', fs.readFileSync(lic, 'utf8').trim());
}

// Vendored chart libraries (src/vendor, Settings › Usage in 59): uPlot and a d3 subset
// (d3/d3-charts.min.js, the packages' UMD builds concatenated).
for (const [name, file, url] of [
  ['uPlot 1.6.32 — MIT', 'uplot/LICENSE', 'https://github.com/leeoniya/uPlot'],
  ...[
    'd3-scale 4.0.2',
    'd3-shape 3.2.0',
    'd3-path 3.1.0',
    'd3-array 3.2.4',
    'd3-interpolate 3.0.1',
    'd3-color 3.1.0',
    'd3-format 3.1.2',
    'd3-time 3.1.0',
    'd3-time-format 4.1.0',
    'internmap 2.0.3',
  ].map(nv => {
    const n = nv.split(' ')[0];
    return [
      nv + ' — ISC',
      'd3/LICENSE-' + n + '.txt',
      'https://github.com/' + (n === 'internmap' ? 'mbostock' : 'd3') + '/' + n,
    ];
  }),
]) {
  const lic = path.join(root, 'src', 'vendor', file);
  if (fs.existsSync(lic))
    parts.push('', rule, name + '\n' + url, rule, '', fs.readFileSync(lic, 'utf8').trim());
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, parts.join('\n').replace(/\r\n/g, '\n') + '\n');
console.log(
  'third-party-notices: ' + packages.length + ' packages → build-resources/THIRD-PARTY-NOTICES.txt'
);
