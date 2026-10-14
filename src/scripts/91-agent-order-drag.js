/*
 * Technically Not · 91-agent-order-drag.js — One agent order everywhere: the order of the
 * terminal panels underneath (07) is the one source, and the thread list follows it. This file
 * keeps that order in blocks: a lead and its sub-agents (43's task-graph panels) stand
 * together, each sub-agent right after its lead, and a sub-agent never moves on its own
 * (`pinned`). The order is saved through 07 `TnaiTerminalWorkspaces.reordered()` (event
 * tnai:terminal-panes-reordered). Dragging an agent to another place went with the pages that
 * could be dragged on (the old Overview, the Agents list, the terminal grid).
 * window.TnaiAgentOrder (blocks, pinned, move, normalize).
 */
(() => {
  const EASE = 'cubic-bezier(.2,.7,.3,1)',
    reduce = matchMedia('(prefers-reduced-motion: reduce)');

  // ---------- Terminal order: blocks of lead + sub-agent panels ----------
  const sessions = () => window.TnaiAgents?.sessions?.() || [];
  const leadOf = id => {
    const g = window.TnaiGraph,
      n = g?.node?.(id);
    if (!n?.parentId) return '';
    return n.parentPaneId || g.state?.()?.nodes?.find(p => p.id === n.parentId)?.paneId || '';
  };
  const panesOf = grid => [...grid.querySelectorAll(':scope>.terminal-pane[data-pane-id]')];
  const paneEl = id =>
    document.querySelector('.terminal-pane[data-pane-id="' + CSS.escape(id) + '"]');
  const gridOf = id => {
    const g = paneEl(id)?.parentElement;
    return g?.classList.contains('terminal-workspace-grid') ? g : null;
  };

  // Same grouping as 11's Overview: in pane order, each sub-agent right after the agent that
  // started it (nested ones after theirs).
  function blocksOf(grid) {
    const ids = panesOf(grid).map(p => p.dataset.paneId),
      live = new Set(sessions().map(s => s.paneId)),
      parent = new Map(ids.map(id => [id, leadOf(id)]));
    const hasLead = id => {
      const p = parent.get(id);
      return !!p && p !== id && ids.includes(p) && live.has(p);
    };
    const seen = new Set(),
      out = [];
    const add = (id, block) => {
      if (seen.has(id)) return;
      seen.add(id);
      block.push(id);
      ids.filter(k => parent.get(k) === id && hasLead(k)).forEach(k => add(k, block));
    };
    const take = id => {
      if (seen.has(id)) return;
      const b = [];
      add(id, b);
      out.push(b);
    };
    ids.filter(id => !hasLead(id)).forEach(take);
    ids.forEach(take); // the second pass keeps any id a loop left out
    return out;
  }
  const rootOf = id => {
    const g = gridOf(id);
    return (g && blocksOf(g).find(b => b.includes(id))?.[0]) || id;
  };
  const pinned = id => rootOf(id) !== id; // a sub-agent panel: moves only with its lead

  // Puts the grid's panes in this order; saves and announces it when anything moved. Visible grid:
  // the moved panels slide (FLIP).
  function applyOrder(grid, ids) {
    const panes = panesOf(grid),
      byId = new Map(panes.map(p => [p.dataset.paneId, p]));
    if (ids.length === panes.length && ids.every((id, i) => panes[i].dataset.paneId === id))
      return false;
    const before =
      !reduce.matches && grid.offsetParent
        ? new Map(panes.map(p => [p, p.getBoundingClientRect()]))
        : null;
    let prev = null;
    ids.forEach(id => {
      const p = byId.get(id);
      if (!p) return;
      if (prev) {
        if (prev.nextElementSibling !== p) prev.after(p);
      } else if (panes[0] !== p) panes[0].before(p);
      prev = p;
    });
    window.TnaiTerminalWorkspaces?.reordered?.();
    window.dispatchEvent(
      new CustomEvent('tnai:terminal-panes-reordered', {
        detail: {
          workspaceId: grid.dataset.workspaceId || panes[0]?.dataset.workspaceId,
          source: 'agent-order',
        },
      })
    );
    if (before)
      for (const p of panes) {
        const a = before.get(p),
          b = p.getBoundingClientRect(),
          dx = a.left - b.left,
          dy = a.top - b.top;
        if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1)
          p.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], {
            duration: 200,
            easing: EASE,
          });
      }
    return true;
  }

  // Keeps every Terminal grid in block order (a sub-agent panel opened at the end of the grid moves
  // next to its lead).
  function normalize() {
    document
      .querySelectorAll('#terminalView .terminal-workspace-grid')
      .forEach(grid => applyOrder(grid, blocksOf(grid).flat()));
  }
  let timer = 0;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(normalize, 80);
  };

  // Moves the block of `id` right before the block of `beforeId`, or (no beforeId) right after the
  // block of `afterId`.
  function moveBlock(id, beforeId, afterId) {
    const grid = gridOf(id);
    if (!grid) return false;
    const blocks = blocksOf(grid),
      mine = blocks.find(b => b[0] === rootOf(id));
    if (!mine) return false;
    const rest = blocks.filter(b => b !== mine),
      ref = beforeId || afterId,
      at = rest.findIndex(b => b.includes(ref));
    if (at < 0) return false;
    rest.splice(beforeId ? at : at + 1, 0, mine);
    return applyOrder(grid, rest.flat());
  }
  window.addEventListener('tnai:terminal-panes-reordered', e => {
    if (e.detail?.source !== 'agent-order') later();
  }); // 86's drop: its sub-agents follow the lead
  window.TnaiAgents?.onChange?.(later);
  window.tnaiNative?.graph?.onState?.(later);
  setTimeout(later, 300);

  window.TnaiAgentOrder = {
    blocks: workspaceId => {
      const g =
        document.querySelector(
          '#terminalView .terminal-workspace-grid[data-workspace-id="' +
            CSS.escape(workspaceId || '') +
            '"]'
        ) ||
        gridOf(
          document.querySelector(
            '.terminal-pane[data-workspace-id="' + CSS.escape(workspaceId || '') + '"]'
          )?.dataset.paneId || ''
        );
      return g ? blocksOf(g) : [];
    },
    pinned,
    move: moveBlock,
    normalize,
  };
})();
