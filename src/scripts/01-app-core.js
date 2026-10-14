/* Technically Not · 01-app-core.js — toast(), sidebar, saved agent names (tnai.agentNames.v1) */
// Platform (first, so a later error in this file cannot drop it): shortcut labels and the plain
// shell's name follow the OS. On a Mac, app shortcuts use Cmd (labels say Cmd+ instead of Ctrl+);
// inside a terminal panel real Ctrl still goes to the program (Ctrl+C interrupts). Windows and
// Linux are unchanged: Ctrl, and PowerShell on Windows. tnaiPlatform.keys(text) relabels Ctrl for
// the OS; mod(e) is the app's shortcut modifier; shell is the plain terminal panel's shell name
// (tnaiNative.info().shell when the desktop side reports it, else zsh on a Mac and bash on Linux).
window.tnaiPlatform = (() => {
  const p = String(navigator.userAgentData?.platform || navigator.platform || ''),
    os = /mac/i.test(p) ? 'mac' : /win/i.test(p) ? 'win' : 'linux',
    mac = os === 'mac';
  const api = {
    os,
    mac,
    win: os === 'win',
    modName: mac ? 'Cmd' : 'Ctrl',
    shell: os === 'win' ? 'PowerShell' : mac ? 'zsh' : 'bash',
    keys: text =>
      mac ? String(text ?? '').replace(/\bCtrl(?=\s*[+↵])/g, 'Cmd') : String(text ?? ''),
    mod: e => !!(mac ? e.metaKey : e.ctrlKey),
    otherMod: e => !!(mac ? e.ctrlKey : e.metaKey),
  };
  if (!api.win)
    window.tnaiNative
      ?.info?.()
      .then(i => {
        const s = String(i?.shell || '')
          .split(/[\\/]/)
          .pop();
        if (s) api.shell = s;
      })
      .catch(() => {});
  if (mac)
    document.querySelectorAll('.side-shortcut,.composer .hint').forEach(el => {
      for (const n of el.childNodes)
        if (n.nodeType === 3 && /Ctrl/.test(n.data)) n.data = api.keys(n.data);
    });
  return api;
})();
window.tnaiKeys = window.tnaiPlatform.keys; // tnaiKeys('Ctrl+K') → 'Cmd+K' on a Mac

// 'PowerShell' on Windows, the login shell (zsh / bash) elsewhere
window.tnaiShell = () => window.tnaiPlatform.shell;

const toastEl = document.getElementById('toast');
let timer;

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

document.getElementById('send').onclick = () => {
  const input = document.getElementById('prompt');
  if (input.value.trim()) {
    toast('AI is working on your change');
    input.value = '';
  }
};
document.getElementById('prompt').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    document.getElementById('send').click();
  }
});
document.querySelectorAll('.side-item').forEach(
  item =>
    (item.onclick = () => {
      document.querySelectorAll('.side-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      toast(item.innerText.trim() + ' workspace');
    })
);
const layout = document.querySelector('.layout'),
  terminalView = document.getElementById('terminalView');
if (terminalView) {
  document.querySelectorAll('.side-item').forEach(
    item =>
      (item.onclick = () => {
        document.querySelectorAll('.side-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        const isTerminal = item.dataset.workspace === 'terminal',
          isFiles = item.innerText.trim() === 'Files';
        layout.classList.toggle('terminal-mode', isTerminal);
        layout.classList.toggle('code-mode', isTerminal || isFiles);
        toast(isTerminal ? 'Terminal workspace' : isFiles ? 'Code workspace' : 'Preview workspace');
      })
  );
  document.getElementById('terminalCommand').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('runCommand').click();
  });
}
window.TnaiAgentIdentity = (() => {
  const vocabulary = {
    analysis: { name: 'Project Analyzer', role: 'analysis' },
    dependency: { name: 'Dependency Analyst', role: 'analysis' },
    investigation: { name: 'Code Investigator', role: 'analysis' },
    bug: { name: 'Bug Investigator', role: 'analysis' },
    planning: { name: 'Architecture Planner', role: 'planning' },
    featurePlan: { name: 'Feature Planner', role: 'planning' },
    visual: { name: 'Visual QA', role: 'quality' },
    accessibility: { name: 'Accessibility Auditor', role: 'quality' },
    performance: { name: 'Performance Auditor', role: 'quality' },
    security: { name: 'Security Auditor', role: 'quality' },
    tests: { name: 'Test Engineer', role: 'quality' },
    testFix: { name: 'Test Fixer', role: 'quality' },
    review: { name: 'Code Reviewer', role: 'quality' },
    buildFix: { name: 'Build Fixer', role: 'operations' },
    build: { name: 'Build Engineer', role: 'operations' },
    deployment: { name: 'Deployment Manager', role: 'operations' },
    release: { name: 'Release Engineer', role: 'operations' },
    refactor: { name: 'Refactoring Engineer', role: 'maintenance' },
    migration: { name: 'Migration Engineer', role: 'maintenance' },
    docs: { name: 'Documentation Writer', role: 'maintenance' },
    database: { name: 'Database Builder', role: 'implementation' },
    api: { name: 'API Builder', role: 'implementation' },
    backend: { name: 'Backend Engineer', role: 'implementation' },
    integration: { name: 'Integration Builder', role: 'implementation' },
    component: { name: 'Component Builder', role: 'implementation' },
    layout: { name: 'Responsive Layout Builder', role: 'implementation' },
    ui: { name: 'UI Builder', role: 'implementation' },
    feature: { name: 'Feature Builder', role: 'implementation' },
  };

  function generate(task, usedNames = []) {
    const raw = [
      task.title,
      task.description,
      task.taskType,
      (task.files || []).join(' '),
      (task.skills || []).join(' '),
      task.stage,
    ].join(' ');
    const text = raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
    const stage = String(task.stage || 'implementation').toLowerCase();
    const type = String(task.taskType || '').toLowerCase();
    let selected;
    if (/security/.test(text)) selected = vocabulary.security;
    else if (/accessibility|a11y/.test(text)) selected = vocabulary.accessibility;
    else if (/performance/.test(text)) selected = vocabulary.performance;
    else if (stage === 'analysis')
      selected = /dependency/.test(String(task.title + ' ' + task.description).toLowerCase())
        ? vocabulary.dependency
        : vocabulary.analysis;
    else if (stage === 'planning')
      selected = /migration/.test(text) ? vocabulary.migration : vocabulary.planning;
    else if (/build.*(fix|fail|error)|typescript.*(fix|error)/.test(text))
      selected = vocabulary.buildFix;
    else if (/deploy/.test(text)) selected = vocabulary.deployment;
    else if (/release|ship/.test(text)) selected = vocabulary.release;
    else if (stage === 'debugging' || /debug|investigat|why .*fail|error/.test(text))
      selected = vocabulary.bug;
    else if (stage === 'verification') {
      if (/test.*(fix|fail)|failing tests/.test(text)) selected = vocabulary.testFix;
      else if (
        /test/.test(String(task.title + ' ' + task.description).toLowerCase()) ||
        type === 'testing'
      )
        selected = vocabulary.tests;
      else if (/review/.test(text)) selected = vocabulary.review;
      else selected = vocabulary.visual;
    } else if (/refactor|cleanup/.test(text)) selected = vocabulary.refactor;
    else if (/migration/.test(text)) selected = vocabulary.migration;
    else if (/documentation|docs/.test(text)) selected = vocabulary.docs;
    else if (/authentication|login|session/.test(text)) {
      selected =
        stage === 'planning'
          ? { name: 'Authentication Architect', role: 'planning' }
          : stage === 'verification'
            ? { name: 'Authentication Tester', role: 'quality' }
            : /api|endpoint/.test(text)
              ? { name: 'Authentication API Builder', role: 'implementation' }
              : stage === 'analysis'
                ? { name: 'Authentication Investigator', role: 'analysis' }
                : { name: 'Authentication Builder', role: 'implementation' };
    } else if (/inventory/.test(text) && /schema|database/.test(text))
      selected = { name: 'Inventory Schema Engineer', role: 'implementation' };
    else if (/inventory/.test(text) && /interface|visual|ui|component/.test(text))
      selected = { name: 'Inventory UI Builder', role: 'implementation' };
    else if (/inventory/.test(text))
      selected = { name: 'Inventory Builder', role: 'implementation' };
    else if (/payment/.test(text)) selected = vocabulary.integration;
    else if (/database|schema/.test(text)) selected = vocabulary.database;
    else if (/api|endpoint/.test(text)) selected = vocabulary.api;
    else if (/backend|server/.test(text)) selected = vocabulary.backend;
    else if (/integrat/.test(text)) selected = vocabulary.integration;
    else if (/profile\s*card|profilecard/.test(text))
      selected = { name: 'Profile Card Builder', role: 'implementation' };
    else if (/responsive|layout|sidebar/.test(text)) selected = vocabulary.layout;
    else if (/component/.test(text)) selected = vocabulary.component;
    else if (/interface|visual|style|css|workspace|terminal|preview/.test(text))
      selected = vocabulary.ui;
    else if (type === 'analysis') selected = vocabulary.analysis;
    else selected = vocabulary.feature;
    const humanNames = [
      'Avery',
      'Jordan',
      'Riley',
      'Casey',
      'Morgan',
      'Quinn',
      'Taylor',
      'Cameron',
      'Alex',
      'Jamie',
      'Rowan',
      'Finley',
      'Harper',
      'Reese',
      'Devon',
      'Blair',
      'Elliot',
      'Robin',
      'Sage',
      'Kit',
      'Emery',
      'Drew',
      'Parker',
      'Sam',
    ];
    let savedNames = {};
    try {
      savedNames = JSON.parse(localStorage.getItem('tnai.agentNames.v1') || '{}') || {};
    } catch {}
    const key = String(task.id || task.title || task.scope || 'agent-' + usedNames.length);
    let agentName = savedNames[key];
    if (!agentName || usedNames.includes(agentName)) {
      const available = humanNames.filter(
        n =>
          !usedNames.includes(n) &&
          !Object.entries(savedNames).some(([k, v]) => k !== key && v === n)
      );
      agentName =
        (available.length ? available : humanNames.filter(n => !usedNames.includes(n)))[
          Math.floor(
            Math.random() *
              (available.length
                ? available.length
                : humanNames.filter(n => !usedNames.includes(n)).length)
          )
        ] || 'Agent ' + (usedNames.length + 1);
      savedNames[key] = agentName;
      try {
        localStorage.setItem('tnai.agentNames.v1', JSON.stringify(savedNames));
      } catch {}
    }
    usedNames.push(agentName);
    return { agentName, role: selected.role, reason: task.description || task.title };
  }
  return { generate };
})();
const agentTaskDefinitions = [
  {
    title: 'Refine the project workspace',
    description: 'Improve the desktop workspace and make terminal output easier to read',
    taskType: 'implementation',
    files: ['src/app/ProjectWorkspace.tsx', 'src/styles/project.css'],
    skills: ['Project Search', 'Context Compiler', 'Code Editing', 'Build'],
    stage: 'implementation',
    status: 'working',
    scope: 'Workspace',
    context: '12 files → 3 relevant files',
    calls: '1 focused call',
    verification: 'Preview check in progress',
  },
  {
    title: 'Check the rendered project',
    description: 'Verify the live preview and selected component after the layout change',
    taskType: 'verification',
    files: ['src/app/ProjectWorkspace.tsx'],
    skills: ['Visual QA', 'Build'],
    stage: 'verification',
    status: 'waiting',
    scope: 'Preview',
    context: '3 files → 1 relevant file',
    calls: '0 model calls',
    verification: 'Waiting for implementation',
  },
  {
    title: 'Map project structure',
    description: 'Identify entry points and reusable project components',
    taskType: 'analysis',
    files: ['package.json', 'src/app/ProjectWorkspace.tsx'],
    skills: ['Project Analysis', 'Dependency Mapping'],
    stage: 'analysis',
    status: 'complete',
    scope: 'Project',
    context: '12 files scanned locally',
    calls: '0 model calls',
    verification: 'Project map ready',
  },
];
const usedAgentNames = [];
const namedAgentTasks = agentTaskDefinitions.map(task => ({
  ...task,
  ...window.TnaiAgentIdentity.generate(task, usedAgentNames),
}));
window.TnaiAgentTasks = namedAgentTasks;

// Removed 2026-09-23: unreachable legacy code (runtime panel, AI panels, overview render). It never
// ran: a missing #executionHistory element threw here on every load.
// Emails are partly hidden everywhere, Settings included (nobody watching
// or seeing a screenshot should learn an address to try signing in with or lock out, yet the owner
// still recognizes their own). The name keeps only its first and last letter around five stars (so
// the length never shows); names under 4 letters show none; a +tag is dropped. Common mail
// providers stay readable; any other domain (a company or personal domain can identify someone)
// keeps only its first letter and the rest after the first dot. lindsay@gmail.com →
// l*****y@gmail.com.
window.tnaiMaskEmails = text =>
  String(text ?? '').replace(
    /([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g,
    (m, name, domain) => {
      const base = name.split('+')[0] || name,
        ends = base.length >= 4;
      const common =
        /^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|pm|gmx|zoho|yandex|mail|fastmail|hey)\.[a-z.]+$/i.test(
          domain
        );
      const [first, ...rest] = domain.split('.');
      return (
        (ends ? base[0] : '') +
        '*****' +
        (ends ? base.slice(-1) : '') +
        '@' +
        (common ? domain : (first.length >= 4 ? first[0] : '') + '***.' + rest.join('.'))
      );
    }
  );

// A person's name (the account's display name) is hidden the same way: each word keeps its first
// letter, then five stars. Lee Olsen → L***** O*****.
window.tnaiMaskName = text =>
  String(text ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w[0] + '*****')
    .join(' ');

// A sign-in username (GitHub login, …) keeps its first and last letter like an email's name:
// lindsay → l*****y; under 4 letters → *****.
window.tnaiMaskHandle = text => {
  const t = String(text ?? '').trim();
  return !t ? '' : t.length >= 4 ? t[0] + '*****' + t.slice(-1) : '*****';
};

// Repaints that wait for a press to end. A card or list that builds its buttons anew on a repaint
// replaces the button under the pointer between the press and the release, and then no click is
// sent. A repaint that builds buttons anew asks here first: `TnaiPress.defer(box, repaint)` is true
// while a mouse button or the Space key is held on something inside `box`, and `repaint` then runs
// once, right after the click of that press was delivered.
window.TnaiPress = (() => {
  // what is held now (an element), how ('pointer' or 'key'), and the repaints that wait for it
  let pressed = null;
  let pressedBy = '';
  let ending = 0;
  const waiting = new Map();

  function start(target, by) {
    clearTimeout(ending);
    ending = 0;
    pressed = target;
    pressedBy = by;
  }

  function finish() {
    ending = 0;
    pressed = null;
    const repaints = [...waiting.values()];
    waiting.clear();
    for (const repaint of repaints) {
      try {
        repaint();
      } catch (error) {
        console.error('[tnai] a repaint held for a press failed:', error);
      }
    }
  }

  // The click comes right after the release, in the same task: the repaints run in the next one.
  function end() {
    if (pressed && !ending) ending = setTimeout(finish);
  }

  document.addEventListener('pointerdown', event => start(event.target, 'pointer'), true);
  window.addEventListener('pointerup', end, true);
  window.addEventListener('pointercancel', end, true);
  window.addEventListener('blur', end);

  // A release that was never reported (it happened outside the window): the next move says so.
  window.addEventListener(
    'pointermove',
    event => {
      if (pressedBy === 'pointer' && event.buttons === 0) end();
    },
    true
  );

  // Space presses a button when the key comes up again.
  document.addEventListener(
    'keydown',
    event => {
      if (event.key === ' ' && !event.repeat && event.target.closest?.('button, [role="button"]'))
        start(event.target, 'key');
    },
    true
  );
  window.addEventListener(
    'keyup',
    event => {
      if (event.key === ' ' && pressedBy === 'key') end();
    },
    true
  );

  function defer(box, repaint) {
    if (!pressed || !box || !box.contains(pressed)) return false;
    waiting.set(box, repaint);
    return true;
  }

  return { defer };
})();
