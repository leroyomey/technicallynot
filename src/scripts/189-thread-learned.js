/*
 * Technically Not · 189-thread-learned.js — "Learned here" in a thread's Details tab (user
 * 2026-10-28, mock docs/plans/design-concepts/thread-learning.html, part 3).
 *
 * What the app learned from this project's measured tasks (desktop/task-learning.js): each lesson
 * in words, how many tasks stand behind it and what agents are told, and a "Tell agents" switch per
 * lesson (off keeps it out of agents' prompts and `tnai context`). A section of 139's list, added
 * when 139 mounts a copy (its `mount` is wrapped) and drawn with 139's own classes; it is drawn
 * again when a task is kept or a switch changes (`learning:changed`). The two tips in the "Worked
 * for" block are 187's.
 */
(() => {
  const details = window.TnaiThreadDetails;
  const learning = window.tnaiNative?.learning;
  if (!details || !learning?.view) return;

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  // host -> { section, head, body, count, paneId, asked }
  const parts = new Map();
  let folded = false;

  // Words with a command between backticks: the command as code, never as HTML.
  function wordsNode(text) {
    const paragraph = make('p', 'ttl-text');
    String(text || '')
      .split('`')
      .forEach((piece, index) => {
        if (!piece) return;
        paragraph.append(index % 2 ? make('code', '', piece) : document.createTextNode(piece));
      });
    return paragraph;
  }

  function lessonNode(part, lesson) {
    const row = make('div', 'ttl-lesson');
    const toggle = make('label', 'ttl-switch');
    const box = make('input', 'tnai-switch');
    box.type = 'checkbox';
    box.checked = !lesson.muted;
    box.dataset.lesson = lesson.key;
    box.setAttribute('aria-label', 'Tell agents: ' + String(lesson.text || '').replace(/`/g, ''));
    toggle.append(box, make('span', '', 'Tell agents'));
    row.append(wordsNode(lesson.text), make('small', '', lesson.note || ''), toggle);
    box.addEventListener('change', () => {
      Promise.resolve(learning.mute?.(part.paneId, lesson.key, !box.checked)).catch(() => {});
    });
    return row;
  }

  function paintBody(part, view) {
    const lessons = view?.lessons || [];
    part.count.textContent = lessons.length ? String(lessons.length) : '';
    part.section.toggleAttribute('data-empty', !lessons.length);
    if (!lessons.length) {
      part.body.replaceChildren(
        make(
          'p',
          'ttd-note',
          'Nothing learned yet. A lesson shows once enough tasks stand behind it' +
            (view?.count ? ' (' + view.count + ' measured so far).' : '.')
        )
      );
      return;
    }
    const since = new Date(view.since).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
    part.body.replaceChildren(
      make(
        'p',
        'ttl-from',
        'From ' + view.count + ' measured tasks since ' + since + ' · kept on this PC'
      ),
      ...lessons.map(lesson => lessonNode(part, lesson)),
      make(
        'p',
        'ttl-foot',
        'A lesson shows only when enough tasks stand behind it, and says how many.'
      )
    );
  }

  // Asks main for this thread's project; an older answer that comes back late is dropped.
  function refresh(part) {
    const asked = (part.asked || 0) + 1;
    part.asked = asked;
    Promise.resolve(learning.view(part.paneId, 0))
      .catch(() => null)
      .then(view => {
        if (part.asked !== asked || !part.section.isConnected) return;
        paintBody(part, view);
      });
  }

  function add(host, paneId) {
    const list = host.querySelector('.ttd-list');
    if (!list) return;
    const section = make('section', 'ttd-sec');
    section.dataset.sec = 'learned';
    const head = make('button', 'ttd-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', String(!folded));
    const mark = make('i', 'ttd-mark');
    mark.innerHTML = window.TnaiIcon?.('chart-pie', { size: 13 }) || '';
    const count = make('em');
    head.append(mark, make('span', '', 'Learned here'), count);
    const body = make('div', 'ttd-body');
    body.hidden = folded;
    section.append(head, body);

    // after Skills, before Setup
    list.insertBefore(section, list.querySelector(':scope > [data-sec="setup"]'));
    const part = { section, head, body, count, paneId: String(paneId), asked: 0 };
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

  const mount = details.mount;
  const unmount = details.unmount;
  details.mount = (host, paneId) => {
    const done = mount(host, paneId);
    parts.delete(host);
    if (done) {
      try {
        add(host, paneId);
      } catch (error) {
        console.warn('[tnai] Learned here could not be added:', error?.message || error);
      }
    }
    return done;
  };
  details.unmount = host => {
    parts.delete(host);
    return unmount(host);
  };

  try {
    learning.onChanged?.(() => parts.forEach(refresh));
  } catch {}

  window.TnaiThreadLearned = {
    // for tests: the copies drawn now
    state: () =>
      [...parts.values()].map(part => ({
        paneId: part.paneId,
        lessons: part.body.querySelectorAll('.ttl-lesson').length,
        empty: part.section.hasAttribute('data-empty'),
      })),
  };
})();
