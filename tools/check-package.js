// Technically Not tools · check-package.js — Audits a packaged build before it is published: only
// runtime files are inside app.asar (no source maps, tests, tools, docs, skills, server code, env
// files or keys), and no shipped text file holds anything that looks like a private key or token.
// Usage: node tools/check-package.js [dist/win-unpacked | dist/linux-unpacked | dist/mac-arm64 (the
// folder holding the .app) | …/TechnicallyNot.ai.app]. Exits 1 on a problem.
// It also reports the runAsNode fuse and the Node runtime in resources/node
// (tools/packaged-node.js). The fuse being on fails the check only when the build is expected to
// have it off: with --expect-run-as-node-off, with TNAI_EXPECT_RUN_AS_NODE_OFF=1, or once
// package.json says so.
'use strict';
const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar'); // comes with electron-builder
const packagedNode = require('./packaged-node');

// the folder is the first word that is not an option
const words = process.argv.slice(2);
const dir = path.resolve(words.find(word => !word.startsWith('--')) || 'dist/win-unpacked');

// Windows/Linux keep app.asar in <dir>/resources; a Mac app keeps it in
// <name>.app/Contents/Resources.
const app = dir.endsWith('.app')
  ? dir
  : fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter(f => f.endsWith('.app'))
        .map(f => path.join(dir, f))[0]
    : null;
const resources =
  fs.existsSync(path.join(dir, 'resources', 'app.asar')) || !app
    ? path.join(dir, 'resources')
    : path.join(app, 'Contents', 'Resources');
const archive = path.join(resources, 'app.asar');
if (!fs.existsSync(archive)) {
  console.error('No packaged app at ' + archive + ' (run electron-builder first).');
  process.exit(1);
}

// Files that must never ship.
const BANNED = [
  [/\.map$/i, 'source map'],
  [
    /(^|\/)(tools|tests?|docs|server|reference-images|\.claude|\.github|\.git)\//i,
    'development folder',
  ],
  [/(^|\/)\.env(\.|$)/i, 'env file'],
  [/\.(pem|pfx|p12|key|p8|cer|crt)$/i, 'key or certificate'],
  [/(^|\/)auth-config\.json$/i, 'sign-in config'],
  [/(^|\/)(CLAUDE|AGENTS)\.md$/i, 'agent notes'],
  [/\.(test|spec)\.[cm]?js$/i, 'test file'],
];

// Contents that look like credentials (checked in Technically Not's own files; third-party packages
// are skipped).
const SECRET = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic key'],
  [/\bsk-(proj-)?[A-Za-z0-9]{32,}/, 'OpenAI key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS key'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/, 'Slack token'],
];

const problems = [];
const files = asar.listPackage(archive).map(f => f.replace(/\\/g, '/').replace(/^\//, ''));
for (const file of files) {
  for (const [re, what] of BANNED)
    if (re.test(file) && !file.startsWith('node_modules/')) problems.push(what + ': ' + file);
  if (file.startsWith('node_modules/') || !/\.(js|json|html|css|yml|yaml|txt|md)$/i.test(file))
    continue;
  let text = '';
  try {
    text = asar.extractFile(archive, file).toString('utf8');
  } catch {
    continue;
  } // a folder entry
  for (const [re, what] of SECRET) if (re.test(text)) problems.push(what + ' in ' + file);
}

// Loose files next to the archive (extraResources) get the same file-name rules.
// Exception: resources/auth-config.json ships the public sign-in
// client settings, and must hold only those keys.
const AUTH_KEYS = new Set(['googleClientId', 'googleClientSecret', 'githubClientId']);
for (const file of fs.readdirSync(resources)) {
  if (file === 'auth-config.json') {
    let c;
    try {
      c = JSON.parse(fs.readFileSync(path.join(resources, file), 'utf8'));
    } catch {
      problems.push('unreadable resources/auth-config.json');
      continue;
    }
    const extra = Object.keys(c).filter(k => !AUTH_KEYS.has(k));
    if (extra.length)
      problems.push(
        'resources/auth-config.json holds more than sign-in settings: ' + extra.join(', ')
      );
    console.log(
      'resources/auth-config.json: Google sign-in ' +
        (c.googleClientId && c.googleClientSecret ? 'configured' : 'NOT configured') +
        ', GitHub sign-in ' +
        (c.githubClientId ? 'configured' : 'NOT configured')
    );
    continue;
  }
  for (const [re, what] of BANNED)
    if (re.test(file)) problems.push(what + ' in resources: ' + file);
}

// Run as Node: what the built program's fuse says, and whether the Node runtime that replaces it is
// in the build.
const runAsNode = {
  found: packagedNode.findFuses(dir, resources.endsWith('Resources') ? app : null),
  runtime: packagedNode.shippedRuntime(resources),
  expectOff: packagedNode.expectsFuseOff({
    argv: words,
    env: process.env,
    packageJson: require('../package.json'),
  }),
};
console.log(packagedNode.runAsNodeSummary(runAsNode));
problems.push(...packagedNode.runAsNodeProblems(runAsNode));

const ours = files.filter(f => f !== 'node_modules' && !f.startsWith('node_modules/'));
console.log(
  'app.asar: ' +
    files.length +
    ' entries, ' +
    ours.length +
    ' of them Technically Not’s own (' +
    [...new Set(ours.map(f => f.split('/')[0]))].join(', ') +
    ')'
);
if (problems.length) {
  console.error(problems.map(p => 'FAIL ' + p).join('\n'));
  process.exit(1);
}
console.log('OK: no development files or credentials in the package');
