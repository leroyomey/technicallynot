/*
 * Technically Not · 191-thread-connections.js — "Connections" in a thread's Details tab (user
 * 2026-10-28: "Yes, build it as shown" on docs/plans/design-concepts/connections-page.html, "In a
 * thread").
 *
 * What this thread's agent has from the Connections page (190, desktop/connections.js): a switch
 * per connection (`setThread`), its state in words (every session, this thread, off, key missing),
 * the app's own connection listed without a switch, "takes effect in this thread's next session"
 * and "Manage connections ›", which opens the page. A section of 139's list, put right after
 * Skills when 139 mounts a copy (its `mount` is wrapped, after 189's wrap) and drawn with 139's own
 * classes; drawn again when the list changes (`connections:changed`). Look:
 * src/styles/67-connections.css.
 */
(() => {
  const details = window.TnaiThreadDetails;
  const connections = window.tnaiNative?.connections;
  if (!details || !connections?.forThread) return;

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  // host -> { section, head, body, count, paneId, asked, answer }
  const parts = new Map();
  let folded = false;

  function stateWords(item) {
    const words = [item.every ? 'every session' : item.on ? 'this thread' : 'off'];
    if ((item.keysMissing || []).length) words.push('key missing');
    return words.join(' · ');
  }

  function lineNode(part, item) {
    const row = make('div', 'cn-line');
    row.append(make('span', '', item.name), make('small', '', stateWords(item)));
    const toggle = make('button', 'sk-switch');
    toggle.type = 'button';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', String(!!item.on));
    toggle.setAttribute('aria-label', item.name + ' in this thread');
    toggle.append(make('i'));

    // On for every session: it is on here too, and only the page's Every session takes it off.
    if (item.every) {
      toggle.disabled = true;
      toggle.title = 'On for every session; change it on the Connections page';
    }
    toggle.addEventListener('click', event => {
      event.stopPropagation();
      const instanceId = part.answer?.instanceId;
      if (!instanceId || toggle.disabled) return;
      const on = toggle.getAttribute('aria-checked') !== 'true';
      toggle.setAttribute('aria-checked', String(on));
      toggle.disabled = true;
      Promise.resolve(connections.setThread(item.id, instanceId, on))
        .catch(error => ({ ok: false, error: String(error?.message || error) }))
        .then(result => {
          if (result && result.ok === false && typeof toast === 'function')
            toast(result.error || 'Could not change it.');
          refresh(part);
        });
    });
    row.append(toggle);
    return row;
  }

  function paintBody(part, answer) {
    const list = answer?.list || [];
    const on = list.filter(item => item.on).length;
    part.count.textContent = String(on + 1);
    const appLine = make('div', 'cn-line');
    appLine.append(
      make('span', '', 'Technically Not'),
      make('small', '', 'always on · how agents talk to the app')
    );
    const manage = make('button', 'cn-manage', 'Manage connections ›');
    manage.type = 'button';
    manage.addEventListener('click', event => {
      event.stopPropagation();
      const open = () => window.TnaiRoute?.('connections');
      if (window.TnaiMotion) window.TnaiMotion.swap(open, 'page');
      else open();
    });
    part.body.replaceChildren(
      ...(answer ? list.map(item => lineNode(part, item)) : []),
      appLine,
      make(
        'p',
        'ttd-note',
        !answer
          ? 'Could not read this thread’s connections.'
          : list.length
            ? 'A change takes effect in this thread’s next session.'
            : 'No connections yet. Add GitHub, a browser and others on the Connections page.'
      ),
      manage
    );
  }

  // Asks main for this thread's list; an older answer that comes back late is dropped.
  function refresh(part) {
    const asked = (part.asked || 0) + 1;
    part.asked = asked;
    Promise.resolve(connections.forThread(part.paneId))
      .catch(() => null)
      .then(answer => {
        if (part.asked !== asked || !part.section.isConnected) return;
        part.answer = answer;
        paintBody(part, answer);
      });
  }

  function add(host, paneId) {
    const list = host.querySelector('.ttd-list');
    if (!list) return;
    const section = make('section', 'ttd-sec');
    section.dataset.sec = 'connections';
    const head = make('button', 'ttd-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', String(!folded));
    const mark = make('i', 'ttd-mark');
    mark.innerHTML = window.TnaiIcon?.('layout-grid', { size: 13 }) || '';
    const count = make('em');
    head.append(mark, make('span', '', 'Connections'), count);
    const body = make('div', 'ttd-body');
    body.hidden = folded;
    section.append(head, body);

    // right after Skills; before Setup when Skills is not there
    const skills = list.querySelector(':scope > [data-sec="skills"]');
    if (skills) skills.after(section);
    else list.insertBefore(section, list.querySelector(':scope > [data-sec="setup"]'));
    const part = { section, head, body, count, paneId: String(paneId), asked: 0, answer: null };
    parts.set(host, part);

    // its own fold (139's press handler knows only its own sections)
    head.addEventListener('click', event => {
      event.stopPropagation();
      folded = head.getAttribute('aria-expanded') === 'true';
      parts.forEach(other => {
        other.head.setAttribute('aria-expanded', String(!folded));
        other.body.hidden = folded;
      });
    });
    refresh(part);
  }

  // 189 wrapped mount and unmount before this file; this wraps what is there now, so both run.
  const mount = details.mount;
  const unmount = details.unmount;
  details.mount = (host, paneId) => {
    const done = mount(host, paneId);
    parts.delete(host);
    if (done) {
      try {
        add(host, paneId);
      } catch (error) {
        console.warn('[tnai] Connections could not be added to Details:', error?.message || error);
      }
    }
    return done;
  };
  details.unmount = host => {
    parts.delete(host);
    return unmount(host);
  };

  try {
    connections.onChanged?.(() => parts.forEach(refresh));
  } catch {}

  window.TnaiThreadConnections = {
    // for checks: the copies drawn now
    state: () =>
      [...parts.values()].map(part => ({
        paneId: part.paneId,
        lines: part.body.querySelectorAll('.cn-line').length,
        switches: part.body.querySelectorAll('.cn-line .sk-switch').length,
      })),
  };
})();
