// Technically Not · 128-agent-marks.js — what marks an agent wherever it is drawn: its own
// avatar color, its tool's color, and the name of the project it works in. Moved out of the old
// Overview (94-overview-purple.js) on 2026-10-11, values unchanged, so that file could go; the
// Skills page (18), Settings (22), the preview's terminal drawer (33) and the prompt box's agent
// picker (46) read them. `window.TnaiAgentMarks` (`agentColor`, `cliColor`, `projectName`).
(() => {
  // A tool's short name and color.
  const CLI = {
    'Claude Code': ['Claude', '#e8906b'],
    Codex: ['Codex', '#7fe0c0'],
    Cursor: ['Cursor', '#9fb4ff'],
    OpenCode: ['OpenCode', '#c9c1dc'],
  };
  const cliOf = agent => CLI[agent] || [agent || 'Terminal', '#a99fc4'];

  // Each agent keeps its own avatar color everywhere: its name, hashed into eight hues.
  const AVATAR = [
    '#b9a3ff',
    '#ffb86b',
    '#8fe3a8',
    '#b98cff',
    '#f5a3c7',
    '#6fd6c0',
    '#b4b0c8',
    '#e8b98f',
  ];

  function agentColor(name) {
    let hash = 0;
    for (const letter of String(name || '?')
      .trim()
      .toLowerCase())
      hash = (hash * 31 + letter.codePointAt(0)) >>> 0;
    return AVATAR[hash % AVATAR.length];
  }

  // The last part of a folder path.
  const lastPart = path =>
    String(path || '')
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || String(path || '');

  // The project a panel works in: the one its workspace belongs to, else the open project.
  function projectName(paneId) {
    const workspaces = window.TnaiTerminalWorkspaces;
    const normalize = path => workspaces?.normalize?.(path) ?? String(path || '').toLowerCase();
    const key =
      workspaces?.projectOfPane?.(paneId) || normalize(window.TnaiProjects?.active?.() || '');
    let projects = [];
    try {
      projects = window.TnaiProjects?.list?.() || [];
    } catch {}
    const project = projects.find(entry => normalize(entry.path) === key);
    return project?.name || lastPart(project?.path || key) || 'No project folder';
  }

  window.TnaiAgentMarks = {
    agentColor,
    cliColor: agent => cliOf(agent)[1],
    cliName: agent => cliOf(agent)[0],
    projectName,
  };
})();
