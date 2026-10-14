// Technically Not desktop · snapshot-clip-preload.js — The only bridge of the two clip windows
// (snapshot-clip.js): the recorder (snapshot-recorder.html) gets its job and hands back the video
// and frames; the frame (snapshot-frame.html) gets its place, learns when recording began, and
// reports its Stop button.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tnaiClip', {
  // Recorder
  onRecord: callback => ipcRenderer.on('clip:record', (_event, job) => callback(job)),
  onFinish: callback => ipcRenderer.on('clip:finish', () => callback()),
  started: () => ipcRenderer.send('clip:started'),
  done: out => ipcRenderer.send('clip:done', out),
  // Frame
  onFrame: callback => ipcRenderer.on('clip:frame', (_event, place) => callback(place)),
  onRecording: callback => ipcRenderer.on('clip:recording', () => callback()),
  hover: over => ipcRenderer.send('clip:hover', !!over),
  stop: () => ipcRenderer.send('clip:stop'),
});
