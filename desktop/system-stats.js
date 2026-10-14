/*
 * Technically Not desktop · system-stats.js — This PC's load for the top bar chip
 * (81-system-stats.js): CPU %, memory, GPU % + video memory, and Technically Not's own memory. Runs
 * only while the window watches (visible and not minimized): every 3 s it reads CPU from os.cpus()
 * time deltas, memory from os.totalmem/freemem and the app's own processes from app.getAppMetrics()
 * (all in-process, no child process). GPU: one long-running `nvidia-smi -l 3` (NVIDIA cards,
 * Windows and Linux) streaming a CSV line per GPU per sample, stopped with the watch. Other GPUs
 * report nothing: Windows' GPU counters (WMI GPUEngine) cost ~350 ms of CPU per read with ~900
 * engines, too heavy to poll (never load the PC).
 */
'use strict';
const os = require('os');
const { spawn, execFile } = require('child_process');

const EVERY_MS = 3000;
let send = () => {},
  app = null,
  timer = null,
  last = null,
  gpu = null,
  gpuChild = null,
  nvidia; // nvidia: undefined = not checked, false = none

function cpuTimes() {
  let idle = 0,
    total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

function sample() {
  const now = cpuTimes();
  const cpu =
    last && now.total > last.total
      ? Math.round(100 * (1 - (now.idle - last.idle) / (now.total - last.total)))
      : null;
  last = now;
  let appMem = 0;
  try {
    for (const m of app.getAppMetrics()) appMem += (m.memory?.workingSetSize || 0) * 1024;
  } catch {}
  const cores = os.cpus();
  send({
    cpu,
    cores: cores.length,
    cpuModel: String(cores[0]?.model || '')
      .replace(/\s+/g, ' ')
      .trim(),
    memUsed: os.totalmem() - os.freemem(),
    memTotal: os.totalmem(),
    appMem,
    gpu: gpu && Date.now() - gpu.at < 10e3 ? gpu : null,
    at: Date.now(),
  });
}

// nvidia-smi in loop mode: one line per GPU per sample ("index, name, util %, used MiB, total
// MiB"). The busiest GPU is the one shown.
function startGpu() {
  if (gpuChild || nvidia === false || !['win32', 'linux'].includes(process.platform)) return;
  const run = () => {
    const seen = new Map();
    let child;
    try {
      child = spawn(
        'nvidia-smi',
        [
          '--query-gpu=index,name,utilization.gpu,memory.used,memory.total',
          '--format=csv,noheader,nounits',
          '-l',
          String(EVERY_MS / 1000),
        ],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
      );
    } catch {
      nvidia = false;
      return;
    }
    gpuChild = child;
    let buf = '';
    child.stdout.on('data', chunk => {
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) {
        const [index, name, util, used, total] = line.split(',').map(s => s.trim());
        if (!name || !Number.isFinite(+util)) continue;
        seen.set(index, {
          name,
          util: +util,
          vramUsed: +used * 2 ** 20,
          vramTotal: +total * 2 ** 20,
        });
        const busiest = [...seen.values()].sort((a, b) => b.util - a.util)[0];
        gpu = { ...busiest, count: seen.size, at: Date.now() };
      }
    });
    child.on('error', () => {
      nvidia = false;
      gpu = null;
      if (gpuChild === child) gpuChild = null;
    });
    child.on('exit', () => {
      if (gpuChild === child) gpuChild = null;
    });
  };
  if (nvidia) return run();

  // First watch: is nvidia-smi there at all? (A missing command must not leave a stray process or
  // throw.)
  execFile('nvidia-smi', ['-L'], { windowsHide: true, timeout: 5000 }, err => {
    nvidia = !err;
    if (nvidia && timer) run();
  });
}

function stopGpu() {
  const child = gpuChild;
  gpuChild = null;
  gpu = null;
  if (child && child.exitCode === null) {
    try {
      child.kill();
    } catch {}
  }
}

function watch(on) {
  if (on && !timer) {
    last = cpuTimes();
    timer = setInterval(sample, EVERY_MS);
    timer.unref?.();
    startGpu();
    setTimeout(sample, 400);
  } else if (!on && timer) {
    clearInterval(timer);
    timer = null;
    stopGpu();
  }
  return !!timer;
}

module.exports = {
  init(sender, electronApp) {
    send = sender;
    app = electronApp;
  },
  watch,
  stop() {
    watch(false);
  },
};
