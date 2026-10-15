// Technically Not desktop · process-starter.js — Starts short-lived processes (execFile) from a
// worker thread, so the main process (and with it the window) is never held while Windows creates
// a process. Used by agent-registry.js (the CLI checks) and git-service.js (every git command).
//
// Why: starting a process holds the thread that starts it until Windows has created it, also
// through async execFile: usually 5 to 25 ms, now and then 150 to 800 ms on a busy PC (antivirus,
// many agents). The stall log named it again and again: the CLI update check (2026-10-10 to
// 2026-10-14), then `ipc context:state` (the commit scan's git runs) and `ipc git:status`, 100 to
// 740 ms each with almost no CPU of our own.
//
// The worker only starts the process and posts the answer back; the processes still run side by
// side and the results are the same as execFile's. Without a worker (it failed to start) the start
// runs on this thread, one per loop turn, so even the fallback never starts several in one block.
'use strict';
const { execFile, spawn } = require('child_process');

const STARTER_CODE = `
const { parentPort } = require('worker_threads');
const { execFile, spawn } = require('child_process');

// Only the fields callers read survive the trip back: an Error loses its own properties.
const plainError = error =>
  error && {
    message: String(error.message || error),
    code: error.code,
    killed: !!error.killed,
    signal: error.signal || null,
  };

// Long-running processes started by watch(), by job id, so a later "kill" message finds them.
const watched = new Map();

// A watch: the process keeps running, each piece of its standard output is posted back as it
// comes, and its end is posted once.
function startWatch(job) {
  try {
    const child = spawn(job.file, job.args, { ...job.options, stdio: ['ignore', 'pipe', 'ignore'] });
    watched.set(job.id, child);
    child.stdout.on('data', data => parentPort.postMessage({ id: job.id, data: String(data) }));
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      watched.delete(job.id);
      parentPort.postMessage({ id: job.id, exit: true });
    };
    child.on('error', end);
    child.on('exit', end);
  } catch (error) {
    parentPort.postMessage({ id: job.id, exit: true, thrown: String((error && error.message) || error) });
  }
}

parentPort.on('message', job => {
  if (job.kill) {
    try {
      watched.get(job.id)?.kill();
    } catch {}
    return;
  }
  if (job.watch) {
    startWatch(job);
    return;
  }
  try {
    const child = execFile(job.file, job.args, job.options, (error, stdout, stderr) =>
      parentPort.postMessage({
        id: job.id,
        error: plainError(error),
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
      })
    );

    // text for the process's standard input; a process gone before it read it answers above
    if (typeof job.input === 'string') {
      child.stdin.on('error', () => {});
      child.stdin.end(job.input);
    }
  } catch (error) {
    parentPort.postMessage({ id: job.id, thrown: String((error && error.message) || error) });
  }
});
`;

// The worker (null until the first run, false once it failed), and its jobs waiting for an answer.
let starter = null;
const starterJobs = new Map();
let starterNextId = 1;

// The worker, started on first use; false when worker threads are not available here.
function startStarter() {
  if (starter !== null) return starter;
  try {
    starter = new (require('worker_threads').Worker)(STARTER_CODE, { eval: true });
  } catch {
    starter = false;
    return starter;
  }
  starter.on('message', answer => {
    const job = starterJobs.get(answer.id);
    if (!job) return;

    // a watch's output as it comes, then its end
    if (job.watch) {
      if (typeof answer.data === 'string') job.onData(answer.data);
      if (!answer.exit) return;
      starterJobs.delete(answer.id);
      if (!starterJobs.size) starter.unref?.();
      job.onExit();
      return;
    }
    starterJobs.delete(answer.id);
    if (!starterJobs.size) starter.unref?.();
    if (answer.thrown) job.reject(new Error(answer.thrown));
    else job.resolve({ error: answer.error, stdout: answer.stdout, stderr: answer.stderr });
  });

  // A worker that fails or ends is not used again. Its open jobs that only read (`rerun`) start
  // again on this thread; the others (a git commit, a merge) are not run twice: they answer with an
  // error, because the worker may already have started them.
  const giveUp = () => {
    if (starter === false) return;
    starter = false;
    const open = [...starterJobs.values()];
    starterJobs.clear();
    for (const job of open) {
      // a watch the worker took with it has ended for the caller
      if (job.watch) {
        job.onExit();
        continue;
      }
      if (job.rerun) {
        startInTurn(() => runHere(job));
        continue;
      }
      job.resolve({
        error: { message: 'The process starter ended before the command answered.', code: 1 },
        stdout: '',
        stderr: '',
      });
    }
  };
  starter.on('error', giveUp);
  starter.on('exit', giveUp);
  starter.unref?.();
  return starter;
}

// Process starts waiting for their turn on this thread, and whether a drain is already planned.
const startQueue = [];
let startPlanned = false;

// One start per loop turn, so other work (IPC, timers, terminal output) gets in between.
function startInTurn(start) {
  startQueue.push(start);
  if (startPlanned) return;
  startPlanned = true;
  setImmediate(function startNext() {
    const next = startQueue.shift();
    next();
    if (startQueue.length) setImmediate(startNext);
    else startPlanned = false;
  });
}

// A start on this thread (no worker); a start that throws rejects, and never stops the starts
// queued after it.
function runHere(job) {
  try {
    const child = execFile(job.file, job.args, job.options, (error, stdout, stderr) =>
      job.resolve({
        error: error || null,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
      })
    );
    if (typeof job.input === 'string') {
      child.stdin.on('error', () => {});
      child.stdin.end(job.input);
    }
  } catch (error) {
    job.reject(error);
  }
}

// execFile(file, args, options) without holding this thread. Resolves to { error, stdout, stderr }
// with error null or { message, code, killed, signal } (what execFile's callback gives); rejects
// only when the start itself throws. options must be plain data (it is copied to the worker).
// rerun: true when the command only reads, so it may run again if the worker ends meanwhile.
// input: text written to the process's standard input, which is then closed.
function start(file, args, options = {}, { rerun = false, input = null } = {}) {
  return new Promise((resolve, reject) => {
    const job = { file, args, options, rerun, input, resolve, reject };
    const worker = startStarter();
    if (!worker) {
      startInTurn(() => runHere(job));
      return;
    }
    const id = starterNextId++;
    starterJobs.set(id, job);

    // kept referenced while a job is open, so a plain Node tool waits for its answer
    worker.ref?.();
    worker.postMessage({ id, file, args, options, input });
  });
}

// A long-running process (stdin and stderr ignored) started without holding this thread: onData
// gets each piece of its standard output as text, onExit is called once when it ends or could not
// start. Returns { kill() }; a kill before the process has started stops it as soon as it does.
// Used by voice-hold.js for the PowerShell key watcher, which runs while a voice key is held.
function watch(file, args, options = {}, { onData = () => {}, onExit = () => {} } = {}) {
  let ended = false;
  const job = {
    watch: true,
    onData: data => {
      if (!ended) onData(data);
    },
    onExit: () => {
      if (ended) return;
      ended = true;
      onExit();
    },
  };
  const worker = startStarter();

  // No worker: the start runs on this thread, in its own loop turn.
  if (!worker) {
    let child = null;
    let killed = false;
    startInTurn(() => {
      if (killed) {
        job.onExit();
        return;
      }
      try {
        child = spawn(file, args, {
          ...options,
          stdio: ['ignore', 'pipe', 'ignore'],
        });
      } catch {
        job.onExit();
        return;
      }
      child.stdout.on('data', data => job.onData(String(data)));
      child.on('error', job.onExit);
      child.on('exit', job.onExit);
    });
    return {
      kill: () => {
        killed = true;
        try {
          child?.kill();
        } catch {}
      },
    };
  }
  const id = starterNextId++;
  starterJobs.set(id, job);
  worker.ref?.();
  worker.postMessage({ id, watch: true, file, args, options });
  return {
    kill: () => {
      try {
        worker.postMessage({ id, kill: true });
      } catch {}
    },
  };
}

module.exports = { start, watch };
