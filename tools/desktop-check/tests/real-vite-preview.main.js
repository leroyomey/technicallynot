/*
 * Technically Not tools · desktop-check/tests/real-vite-preview.main.js — Main-process side of
 * real-vite-preview: copies a Vite app (made beforehand with `npm create vite` + `npm install`,
 * path from TNAI_VITE_APP) into the test's project folder, node_modules included.
 */
'use strict';
const fs = require('fs'),
  path = require('path');

module.exports = (win, profile) => ({
  setup: () => {
    const src = process.env.TNAI_VITE_APP,
      dest = path.join(profile, 'sample-project');
    if (!src || !fs.existsSync(path.join(src, 'package.json')))
      throw new Error('set TNAI_VITE_APP to a Vite app folder with its packages installed');

    // Copied, node_modules too (a small React app): a link would let the test's cleanup delete the
    // source app's packages through it.
    for (const name of fs.readdirSync(src))
      fs.cpSync(path.join(src, name), path.join(dest, name), { recursive: true });
    return true;
  },
  read: rel => fs.readFileSync(path.join(profile, 'sample-project', String(rel)), 'utf8'),
});
