// Technically Not desktop · snapshot-preload.js — The snapshot overlay's only bridge
// (snapshot-service.js): receive the frozen frame, report the selection (fractions of the screen)
// or a cancel, or ask for a clip of it; for markup, fetch the selection's own pixels (crop) and
// hand back the marked-up PNG (compose).
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const fractions = rect => ({ x: +rect.x, y: +rect.y, w: +rect.w, h: +rect.h });
contextBridge.exposeInMainWorld('tnaiSnapshot', {
  onImage: callback => ipcRenderer.on('snapshot:image', (_event, url) => callback(String(url))),
  ready: () => ipcRenderer.send('snapshot:ready'),
  select: rect => ipcRenderer.send('snapshot:select', fractions(rect)),
  cancel: () => ipcRenderer.send('snapshot:cancel'),
  // record this area instead of copying it
  clip: rect => ipcRenderer.send('snapshot:clip', fractions(rect)),
  large: on => ipcRenderer.send('snapshot:large', on === true), // copy a small picture enlarged

  // Markup: { png, width, height } of the selection at full quality (null when it is too small),
  // then the PNG drawn from it.
  crop: rect => ipcRenderer.invoke('snapshot:crop', fractions(rect)),
  compose: png => ipcRenderer.send('snapshot:compose', new Uint8Array(png)),
});
