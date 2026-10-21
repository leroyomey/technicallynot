/*
 * Technically Not desktop · dev-servers.js — `tnai server list | claim URL | release [URL]`
 * (agent-mesh.js): which localhost dev servers run in a project and which agent owns each, so
 * agents reuse a running server instead of starting a second copy. In memory only (servers do not
 * outlive the app's panels); a successful `tnai preview` records its address for the agent too.
 * Liveness is checked on each list/claim, never polled.
 */
'use strict';

const byProject = new Map(); // project -> Map(origin -> { url, paneId, name, since })

const originOf = url => {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
};
const mins = t => Math.max(0, Math.floor((Date.now() - t) / 60000));
const table = project => {
  if (!byProject.has(project)) byProject.set(project, new Map());
  return byProject.get(project);
};

// answers(url) -> Promise<bool> (agent-mesh.js), alive(paneId) -> bool: its panel is still an agent
// here.
async function claim(project, paneId, name, url, { answers, alive }) {
  const origin = originOf(url),
    servers = table(project),
    had = servers.get(origin);
  if (had && had.paneId !== paneId && alive(had.paneId) && (await answers(url)))
    return {
      ok: false,
      code: 'busy',
      hint: 'tnai preview ' + had.url,
      error:
        had.name +
        ' owns the dev server at ' +
        had.url +
        ' and it is running: reuse it (`tnai preview ' +
        had.url +
        '`) instead of starting another copy; ask ' +
        had.name +
        ' before restarting or stopping it.',
    };
  servers.set(origin, {
    url,
    paneId,
    name,
    since: had?.paneId === paneId ? had.since : Date.now(),
  });
  return {
    ok: true,
    text:
      'You own the dev server at ' +
      url +
      ((await answers(url)) ? '' : ' (nothing answers there yet; start it)') +
      '. `tnai server release` when you stop it.',
  };
}

// A successful `tnai preview` of an address nobody live owns: record it for that agent (never takes
// one from another live owner).
function seen(project, paneId, name, url, alive) {
  const origin = originOf(url),
    servers = table(project),
    had = servers.get(origin);
  if (!origin || (had && had.paneId !== paneId && alive(had.paneId))) return;
  servers.set(origin, {
    url,
    paneId,
    name,
    since: had?.paneId === paneId ? had.since : Date.now(),
  });
}

function release(project, paneId, url) {
  const servers = table(project),
    origin = url ? originOf(url) : '',
    gone = [];
  for (const [key, s] of servers)
    if (s.paneId === paneId && (!origin || key === origin)) {
      servers.delete(key);
      gone.push(s.url);
    }
  return gone.length
    ? { ok: true, text: 'Released: ' + gone.join(', ') + '.' }
    : {
        ok: false,
        code: 'not_found',
        hint: 'tnai server list',
        error: url ? 'You own no dev server at ' + url + '.' : 'You own no dev servers.',
      };
}

// One line per server; a server that stopped answering and whose owner is gone is dropped.
async function list(project, { answers, alive }) {
  const servers = table(project),
    lines = [];
  for (const [key, s] of [...servers]) {
    const up = await answers(s.url),
      live = alive(s.paneId);
    if (!up && !live) {
      servers.delete(key);
      continue;
    }
    lines.push(
      '  ' +
        [
          s.url,
          s.name + (live ? '' : ' (panel closed)'),
          up ? 'running' : 'not answering',
          'since ' + mins(s.since) + ' min',
        ].join('  ·  ')
    );
  }
  return {
    ok: true,
    text: lines.length
      ? 'Dev servers in this project (' + lines.length + '):\n' + lines.join('\n')
      : 'No dev servers recorded in this project. Before starting one, try its usual localhost port; after starting it, run `tnai server claim URL`.',
  };
}

// A closed panel's servers stay listed, marked "panel closed", while they still answer (another
// agent may reuse them).
module.exports = { claim, seen, release, list };
