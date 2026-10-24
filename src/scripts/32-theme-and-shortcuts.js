// Technically Not · 32-theme-and-shortcuts.js: the theme (Settings › General, `tnai.theme.v1`),
// the accent color (`tnai.accent.v2`: purple, blue, teal, rose, sunset or neutral, on
// <html data-accent>) and the keyboard shortcut list (? or Ctrl+/), plus the Ctrl+1…7 page
// shortcuts. window.TnaiTheme (get, set, resolved, accent, setAccent, accents, xterm),
// window.TnaiShortcuts (open, close, list). Loaded in <head>, not at the end like the other
// scripts, so theme and accent are on <html> before the first paint.
//
// Older styles are recolored, not hand-copied: every color declaration in every style sheet (files
// and the <style> blocks the feature scripts inject) gets a copy right after its source sheet,
// remapped by mapColor() in OKLab. Dark: neutrals land on the dark palette, brand greens become
// the accent. Light: greens shift to the accent hue and neutrals take a slight tint. Status colors
// keep their meaning: other hues (amber, red, blue…), 05-status-colors.css and --st-* vars only
// get the plain lightness mirror in Dark and stay as written in Light. Sheets marked data-pg (the
// new design) are left alone. Copies are regenerated when the theme or the accent changes.
//
// In the desktop app the design is the thread layout's (118), always, with two looks: a neutral
// Dark, where neutrals no longer follow the accent's hue, and an off-white Light, chosen with
// TnaiTheme.set('light'). Their tokens are in src/styles/31-thread-pages.css. Four more shades
// (user 2026-10-23): 'dim' and 'hc-dark' on the Dark base, 'paper' and 'hc-light' on the Light
// base; the base stays on data-theme and the shade goes on <html data-look> (tokens in
// src/styles/58-thread-looks.css). In a browser the page is the old purple glass, always dark.
(() => {
  const KEY = 'tnai.theme.v1',
    ACCENT_KEY = 'tnai.accent.v2',
    DARK = 'html[data-theme="dark"]',
    LIGHT = 'html:not([data-theme="dark"])';
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  // The shades of the thread layout, and which base each one is drawn on.
  const SHADES = { dim: 'dark', 'hc-dark': 'dark', paper: 'light', 'hc-light': 'light' };

  // no saved choice → Dark (purple glass)
  const readChoice = v => (v === 'light' || v === 'system' || SHADES[v] ? v : 'dark');
  let choice = 'dark';
  try {
    choice = readChoice(localStorage.getItem(KEY));
  } catch {}

  // The thread layout (118) is the app's design in the desktop app, with two looks: a clean
  // neutral Dark and an off-white Light. `threadLook` is true there, always: there is no setting.
  // In a browser it is false and the page is the old purple glass, always dark.
  const readThreadLook = () => !!window.tnaiNative;
  let threadLook = readThreadLook();

  // Purple glass is always dark; the old Light / Match system look is gone. Light is a choice only
  // in the thread layout.
  const resolved = () =>
    threadLook && (choice === 'light' || SHADES[choice] === 'light') ? 'light' : 'dark';

  // The shade on top of the base ('' for plain Dark or Light), only in the thread layout.
  const shade = () => (threadLook && SHADES[choice] ? choice : '');

  // Accent: OKLab hue h and chroma c of the accent (Dark accent lightness 0.673 = #bd63ff), neutral
  // hue nh and neutral chroma scale n.
  const ACCENTS = {
    purple: { label: 'Purple', h: 308, c: 0.228, nh: 294, n: 1 },
    blue: { label: 'Blue', h: 262, c: 0.18, nh: 272, n: 1 },
    teal: { label: 'Teal', h: 188, c: 0.12, nh: 225, n: 0.8 },
    rose: { label: 'Rose', h: 352, c: 0.2, nh: 330, n: 0.8 },
    sunset: { label: 'Sunset', h: 48, c: 0.17, nh: 20, n: 0.7 },
    neutral: { label: 'Neutral', h: 285, c: 0.012, nh: 285, n: 0.12 },
  };
  const readAccent = v => (ACCENTS[v] ? v : 'purple');

  // The palette a color is mapped with. In the thread layout the ground never follows the accent:
  // neutrals take the Neutral set's hue and strength, the accent keeps its own.
  const tone = key =>
    threadLook ? { ...ACCENTS[key], nh: ACCENTS.neutral.nh, n: ACCENTS.neutral.n } : ACCENTS[key];

  // What a recolored copy was made for: the look, the theme and the accent.
  const lookKey = () => (threadLook ? 'thread|' : '') + resolved() + '|' + accent;
  let accent = 'purple';
  try {
    localStorage.removeItem('tnai.accent.v1');
    accent = readAccent(localStorage.getItem(ACCENT_KEY));
  } catch {} // v1 held dev/test picks (e.g. sunset); v2 starts purple
  root.dataset.accent = accent;

  // ---------------------------------------------------------------- color mapping
  const NAMED = {
    white: [255, 255, 255],
    black: [0, 0, 0],
    red: [255, 0, 0],
    green: [0, 128, 0],
    gray: [128, 128, 128],
    grey: [128, 128, 128],
    silver: [192, 192, 192],
  };
  const TOKEN = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black|red|green|gr[ae]y|silver)\b/gi,
    HAS_COLOR = new RegExp(TOKEN.source, 'i');

  function parse(token) {
    const t = token.toLowerCase();
    if (t[0] === '#') {
      let h = t.slice(1);
      if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('');
      if (h.length !== 6 && h.length !== 8) return null;
      return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
        h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1,
      ];
    }
    if (t.startsWith('rgb')) {
      const n = t
        .slice(t.indexOf('(') + 1, -1)
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map((x, i) =>
          x.endsWith('%') ? (parseFloat(x) / 100) * (i === 3 ? 1 : 255) : parseFloat(x)
        );
      if (n.length < 3 || n.some(Number.isNaN)) return null;
      return [n[0], n[1], n[2], n.length > 3 ? n[3] : 1];
    }
    return NAMED[t] ? [...NAMED[t], 1] : null;
  }
  const toLin = c => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const toSrgb = c =>
    Math.round(
      255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055))
    );

  function toOklab([r, g, b]) {
    r = toLin(r);
    g = toLin(g);
    b = toLin(b);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b),
      m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
      s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  }

  function fromOklab([L, a, b]) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3,
      m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3,
      s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
      toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    ];
  }
  const DEG = Math.PI / 180,
    clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const polar = (L, C, h) => [L, C * Math.cos(h * DEG), C * Math.sin(h * DEG)];
  const curve = (pts, x) => {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1],
        [x1, y1] = pts[i];
      if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
    return pts[pts.length - 1][1];
  };

  // Status hues: the plain lightness mirror (near-white surfaces keep their order, everything
  // darker is mirrored), hue kept.
  const MIRROR = [
    [0, 0.95],
    [0.25, 0.905],
    [0.35, 0.85],
    [0.45, 0.79],
    [0.55, 0.72],
    [0.65, 0.635],
    [0.75, 0.53],
    [0.85, 0.43],
    [0.9, 0.38],
    [0.955, 0.33],
  ];
  const mirror = L => (L >= 0.955 ? 0.215 + ((L - 0.955) / 0.045) * 0.05 : curve(MIRROR, L));

  // Purple glass neutrals: paper → --bg (L .165), white cards → --panel (.208), hover fills and
  // lines → --panel-2 / --line (.24–.30), muted text → --text-4 / --text-3 (.50–.64), body text →
  // --text-2 / --text (.80–.94). Chroma follows the palette (NEUTRAL_C).
  const NEUTRAL_L = [
    [0, 0.95],
    [0.25, 0.935],
    [0.35, 0.88],
    [0.45, 0.8],
    [0.55, 0.68],
    [0.65, 0.58],
    [0.75, 0.45],
    [0.85, 0.36],
    [0.9, 0.3],
    [0.93, 0.26],
    [0.95, 0.24],
    [0.969, 0.222],
  ];
  const NEUTRAL_C = [
    [0.15, 0.042],
    [0.3, 0.048],
    [0.5, 0.057],
    [0.65, 0.057],
    [0.8, 0.05],
    [0.95, 0.028],
  ];
  const neutralL = L => (L >= 0.97 ? 0.165 + ((L - 0.97) / 0.03) * 0.043 : curve(NEUTRAL_L, L));
  const TEXTISH =
    /^(?:color|fill|stroke|caret-color|outline-color|text-decoration-color|-webkit-text-fill-color|-webkit-text-stroke-color)$/;

  // neutral: warm grays; accent: the brand greens (hue 95–175°); status: every other hue keeps its
  // meaning.
  const kindOf = (C, h) =>
    C < 0.02 ? 'neutral' : h >= 95 && h <= 175 ? (C < 0.035 ? 'neutral' : 'accent') : 'status';

  function darkLab(L, a, b, alpha, prop, acc, status) {
    const C = Math.hypot(a, b),
      h = (Math.atan2(b, a) / DEG + 360) % 360;
    const shadow = /shadow/.test(prop),
      background = /^background|^--/.test(prop) && !shadow;
    if (
      (shadow && L < 0.6 && C < 0.04) ||
      (background && alpha < 0.999 && alpha > 0.25 && L < 0.45)
    )
      return null; // shadows and dim backdrops stay dark
    const kind = status ? 'status' : kindOf(C, h);
    if (kind === 'neutral') {
      const L2 = neutralL(L);
      return polar(L2, curve(NEUTRAL_C, L2) * acc.n, acc.nh);
    }
    if (kind === 'accent') {
      if (TEXTISH.test(prop))
        return polar(
          clamp(0.8 + (L - 0.55) * 0.25, 0.74, 0.88),
          acc.c * 0.5 * clamp(C / 0.1, 0.5, 1),
          acc.h
        ); // --accent-2 text

      // pale green tints → --accent-soft
      if (L >= 0.82) return polar(neutralL(L) + 0.02, acc.c * 0.33, acc.h);
      return polar(
        clamp(0.673 + (L - 0.55) * 0.4, 0.58, 0.8),
        acc.c * clamp(C / 0.1, 0.4, 1),
        acc.h
      ); // brand green → --accent
    }
    let L2 = mirror(L);
    const k = L >= 0.955 ? 0.7 : L2 < 0.45 ? 0.6 : 0.9;

    // status accents stay mid-bright and saturated
    if (C > 0.08 && L < 0.8) L2 = clamp(L2, 0.55, 0.85);
    return [L2, a * k, b * k];
  }

  // The thread layout's Light is off-white, not white:
  // a pale surface of an older sheet is brought down
  // to that ground's lightness and warmth. White (1) lands on the island color, the old paper a
  // little under it.
  const OFF_WHITE_FROM = 0.9;

  // The older sheets' muted grays were written for white paper and read about 3 to 1 on off-white:
  // gray text between this lightness and pale is brought down to it.
  const MUTED_TEXT = 0.52;
  const offWhite = L => polar(OFF_WHITE_FROM + (L - OFF_WHITE_FROM) * 0.55, 0.006, 95);

  function lightLab(L, a, b, acc, prop) {
    const C = Math.hypot(a, b),
      h = (Math.atan2(b, a) / DEG + 360) % 360,
      kind = kindOf(C, h);
    if (threadLook && kind === 'neutral' && L > OFF_WHITE_FROM && /^background/.test(prop))
      return offWhite(L);
    if (threadLook && kind === 'neutral' && L > MUTED_TEXT && L < 0.8 && TEXTISH.test(prop))
      return polar(MUTED_TEXT, 0.01, acc.nh);
    if (kind === 'neutral')
      return L >= 0.999 || L <= 0.001 ? null : polar(L, (L > 0.9 ? 0.007 : 0.014) * acc.n, acc.nh);
    if (kind === 'accent') return polar(L, Math.min(acc.c, C * 1.5), acc.h);
    return null; // status hues stay as written
  }
  const hex = n => n.toString(16).padStart(2, '0');
  const out = (rgb, alpha) =>
    alpha >= 0.999
      ? '#' + rgb.map(hex).join('')
      : 'rgba(' + rgb.join(',') + ',' + +alpha.toFixed(3) + ')';
  const cache = new Map();

  // mode 'dark' | 'light'; status = keep hue (05-status-colors.css, --st-*). Light returns the
  // token unchanged when nothing changes. Cache keyed by mode + accent.
  function mapWith(token, prop, mode, accentKey, status) {
    const look = threadLook ? 'thread' : '',
      key = look + mode + accentKey + (status ? '!' : '|') + prop + '|' + token,
      hit = cache.get(key);
    if (hit) return hit;
    const c = parse(token);
    if (!c) return token;
    const [L, a, b] = toOklab(c),
      alpha = c[3],
      acc = tone(accentKey);
    let result = token;
    if (mode === 'dark') {
      const lab = darkLab(L, a, b, alpha, prop, acc, status);
      result = lab
        ? out(fromOklab(lab), alpha)
        : out([0, 0, 0], Math.min(0.7, /shadow/.test(prop) ? alpha * 2.2 + 0.04 : alpha * 1.25));
    } else if (!status) {
      const lab = lightLab(L, a, b, acc, prop);
      if (lab) result = out(fromOklab(lab), alpha);
    }
    cache.set(key, result);
    return result;
  }
  let mode = resolved();
  const mapColor = (token, prop) => mapWith(token, prop, mode, accent, /^--st-/.test(prop));
  const swatch = key => out(fromOklab(polar(0.673, ACCENTS[key].c, ACCENTS[key].h)), 1);

  // ---------------------------------------------------------------- stylesheet → recolored copy
  const COLOR_PROP = /color$|^background|shadow$|^fill$|^stroke$|^--/;
  const VAR_SHORTHANDS = [
    'background',
    'border',
    'border-top',
    'border-right',
    'border-bottom',
    'border-left',
    'border-color',
    'outline',
    'text-decoration',
  ];

  function splitSelectors(text) {
    const parts = [];
    let depth = 0,
      quote = '',
      start = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quote) {
        if (ch === quote && text[i - 1] !== '\\') quote = '';
        continue;
      }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      else if (ch === ',' && !depth) {
        parts.push(text.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(text.slice(start));
    return parts.map(s => s.trim()).filter(Boolean);
  }

  // Same specificity boost in both modes: html[data-theme="dark"] or html:not([data-theme="dark"]).
  // Light drops rules written for Dark.
  const scope = (sel, prefix) =>
    splitSelectors(sel)
      .map(s => {
        if (prefix === LIGHT && /^(?::root|html)\[data-theme=["']?dark/.test(s)) return '';
        if (/^:root\b/.test(s)) return prefix + s.slice(5);
        if (/^html(?![\w-])/.test(s)) return prefix + s.slice(4);
        return prefix + ' ' + s;
      })
      .filter(Boolean)
      .join(',');

  function convertRules(rules, statusSheet) {
    let css = '';
    const dark = mode === 'dark',
      prefix = dark ? DARK : LIGHT;
    for (const rule of rules) {
      if (rule.type === CSSRule.STYLE_RULE) {
        const s = rule.style,
          decls = [];
        let changed = dark;
        for (let i = 0; i < s.length; i++) {
          const prop = s[i];
          if (!COLOR_PROP.test(prop) || prop.startsWith('--pg-')) continue;
          const value = s.getPropertyValue(prop).trim();
          if (!value) continue;
          if (prop.startsWith('--') && !HAS_COLOR.test(value)) continue;
          const status = statusSheet || prop.startsWith('--st-');
          const mapped = value.replace(TOKEN, t => mapWith(t, prop, mode, accent, status));
          if (!dark && mapped === value) continue; // Light: only what the accent changes
          changed = true;
          decls.push(prop + ':' + mapped + (s.getPropertyPriority(prop) ? '!important' : ''));
        }

        // Longhands of a shorthand written with var() read back empty; repeat the shorthand so the
        // cascade order stays the same.
        for (const sh of VAR_SHORTHANDS) {
          const value = s.getPropertyValue(sh);
          if (value && value.includes('var(')) {
            decls.push(sh + ':' + value + (s.getPropertyPriority(sh) ? '!important' : ''));
          }
        }
        const sel = decls.length && changed && scope(rule.selectorText, prefix);
        if (sel) css += sel + '{' + decls.join(';') + '}\n';
      } else if (rule.type === CSSRule.MEDIA_RULE || rule.type === CSSRule.SUPPORTS_RULE) {
        const inner = convertRules(rule.cssRules, statusSheet);
        if (inner)
          css +=
            (rule.type === CSSRule.MEDIA_RULE ? '@media ' : '@supports ') +
            rule.conditionText +
            '{' +
            inner +
            '}\n';
      }
    }
    return css;
  }
  const copies = new WeakMap(); // source <style>/<link> → { el, text, state }

  // Our copies, new-design sheets, and a terminal's own sheet. A terminal gets its colors from
  // `xtermTheme` and rewrites its sheet when the look changes; a copy made a moment before that
  // kept the other look's text color and outranked the terminal's own (Light: the shell's plain
  // output at 1.2 to 1 on the island).
  const skip = node =>
    node.dataset?.tnaiDark !== undefined ||
    !!node.hasAttribute?.('data-pg') ||
    !!node.closest?.('.xterm');

  function convertNode(node) {
    if (!node.sheet || skip(node)) return;
    let rules;
    try {
      rules = node.sheet.cssRules;
    } catch {
      return;
    } // unreadable (cross-origin) sheet: leave it
    const text = node.tagName === 'STYLE' ? node.textContent : node.href;
    const prev = copies.get(node),
      state = lookKey();
    if (prev && prev.text === text && prev.state === state && prev.el.isConnected) return;
    const el = prev?.el || document.createElement('style');
    el.dataset.tnaiDark = '';
    el.textContent = convertRules(
      rules,
      node.tagName === 'LINK' && /05-status-colors\.css(?:$|[?#])/.test(node.href)
    );
    if (el.previousSibling !== node) node.after(el);
    copies.set(node, { el, text, state });
  }
  const sources = () => [
    ...document.querySelectorAll(
      'style:not([data-tnai-dark]):not([data-pg]), link[rel="stylesheet"]:not([data-pg])'
    ),
  ];

  function convertAll() {
    sources().forEach(convertNode);
  }

  // Feature scripts inject <style> blocks while they load; convert each as it arrives (the observer
  // runs before the next paint).
  new MutationObserver(records => {
    const touched = new Set();
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n.nodeName === 'STYLE' && !skip(n)) touched.add(n);
        else if (n.nodeName === 'LINK' && !skip(n))
          n.addEventListener('load', () => convertNode(n), { once: true });
      }
      const host = r.target.nodeName === 'STYLE' ? r.target : r.target.parentNode;
      if (host?.nodeName === 'STYLE' && !skip(host)) touched.add(host);
    }
    touched.forEach(convertNode);
  }).observe(document.head || root, { childList: true, subtree: true, characterData: true });

  // Hand-written Dark extras the mapping can't infer: native controls/scrollbars, inline style=""
  // colors, the brand mark, selection, switches.
  const extra = document.createElement('style');
  extra.dataset.tnaiDark = '';
  const col = lab => out(fromOklab(lab), 1);
  const extraCss = () => {
    if (mode !== 'dark') return '';
    const acc = tone(accent),
      knob = mapColor('#20211f', 'color'),
      off = col(polar(0.36, 0.05 * acc.n, acc.nh));
    return `
${DARK}{color-scheme:dark}
${DARK} .brand-logo{display:none}${DARK} .brand-logo.on-dark{display:block}
${DARK} [style*="color:#55584f"]{color:${mapColor('#55584f', 'color')}!important}
${DARK} [style*="color:#a1a39b"],${DARK} [style*="color:#bbb"]{color:${mapColor('#a1a39b', 'color')}!important}
${DARK} ::selection{background:${col(polar(0.36, acc.c * 0.45, acc.h))}}
${DARK} :is(#settingsPage input.set-switch, input.tnai-switch)::before{background:${knob}}
${DARK} :is(#settingsPage input.set-switch, input.tnai-switch):not(:checked){background:${off}}
${DARK} .set-chip input::before{background:${knob}}
${DARK} .set-chip input:not(:checked){background:${off}}
`;
  };

  let state = '';

  function apply() {
    mode = resolved();
    if (mode === 'dark') root.dataset.theme = 'dark';
    else root.removeAttribute('data-theme');
    if (shade()) root.dataset.look = shade();
    else root.removeAttribute('data-look');
    root.dataset.accent = accent;
    const next = lookKey();
    if (next !== state) {
      state = next;
      extra.textContent = extraCss();
      if (!extra.isConnected) (document.head || root).append(extra);
      convertAll();
    }
    return mode;
  }
  let last = apply(),
    lastAccent = accent,
    lastLook = threadLook,
    lastShade = shade();

  // A change of shade alone (Dark to Dim) also tells the terminals, whose ground is the island's
  // color of the shade.
  const changed = () => {
    const now = apply();
    const nowShade = shade();
    const moved = now !== last || accent !== lastAccent || threadLook !== lastLook;
    if (moved || nowShade !== lastShade) {
      last = now;
      lastAccent = accent;
      lastLook = threadLook;
      lastShade = nowShade;
      window.dispatchEvent(
        new CustomEvent('tnai:theme-changed', { detail: { theme: now, choice, accent } })
      );
    }
    renderSettings();
  };
  media.addEventListener('change', () => {
    if (choice === 'system') changed();
  });
  window.addEventListener('storage', e => {
    if (e.key === KEY) {
      choice = readChoice(e.newValue);
      changed();
    } else if (e.key === ACCENT_KEY) {
      accent = readAccent(e.newValue);
      changed();
    }
  });

  // The thread layout's setting was switched (118): the ground and the theme follow at once.
  window.addEventListener('tnai:threads-setting', () => {
    threadLook = readThreadLook();
    changed();
  });

  // Late sheets (xterm.css, sheets added after load) — pick up anything the observer could not see.
  window.addEventListener('load', convertAll);

  // Terminal colors on the indigo glass: surface = the mapped paper, text / cursor / selection from
  // the accent; ANSI hues keep their meaning.
  const xtermCache = new Map();

  // In the thread layout a terminal draws on the islands' own color, so its screen and the surface
  // around it are one tone: the style sheet's --tnt-island, read once the look is set (the
  // fallback is that token's value, for a terminal made before the sheet has loaded).
  function islandColor(fallback) {
    return tokenColor('--tnt-island', fallback);
  }

  // A color token of the look as a #rrggbb value, or the fallback when it is not set yet.
  function tokenColor(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  }

  function xtermDark() {
    const cacheKey = (threadLook ? 'thread|' : '') + shade() + '|' + accent;
    if (xtermCache.has(cacheKey)) return xtermCache.get(cacheKey);
    const acc = tone(accent),
      n = (L, C) => col(polar(L, C * acc.n, acc.nh)),
      bg = threadLook
        ? islandColor('#17171c')
        : mapWith('#fbfcf9', 'background-color', 'dark', accent);
    const theme = {
      background: bg,
      foreground: n(0.9, 0.035),
      cursor: col(polar(0.81, acc.c * 0.45, acc.h)),
      cursorAccent: bg,
      selectionBackground: col(polar(0.36, acc.c * 0.45, acc.h)),
      black: n(0.33, 0.05),
      red: '#ff7d8e',

      // the app's text green (--pg-work-text, per shade), so green words read the same in a
      // terminal as in a thread (user decision 2026-10-23)
      green: threadLook ? tokenColor('--pg-work-text', '#9cdfbb') : '#5fe0a5',
      yellow: '#ffbf5e',
      blue: '#7fa8ff',
      magenta: '#d58cff',
      cyan: '#6cd4e0',
      white: n(0.82, 0.045),

      // dim text: a step lighter on the island's color, which is lighter than the old terminal
      // ground, so it stays above 4.5 to 1; Dim's island is lighter again, so a step more there
      brightBlack: n(threadLook ? (shade() === 'dim' ? 0.67 : 0.63) : 0.6, 0.055),
      brightRed: '#ff97a5',
      brightGreen: '#86ecbd',
      brightYellow: '#ffd088',
      brightBlue: '#a1bfff',
      brightMagenta: '#e3acff',
      brightCyan: '#93e2eb',
      brightWhite: n(0.95, 0.025),
    };
    xtermCache.set(cacheKey, theme);
    return theme;
  }

  // The thread layout's Light: the terminal on the off-white island, soft near-black text, and
  // colors dark enough to read on it (each at least 4.5 to 1 on the island's color; the test
  // thread-ground measures them). Status hues keep their meaning.
  function xtermLight() {
    const cacheKey = 'light|' + shade() + '|' + accent;
    if (xtermCache.has(cacheKey)) return xtermCache.get(cacheKey);
    const acc = ACCENTS[accent],
      bg = islandColor('#f1efea');
    const theme = {
      background: bg,
      foreground: '#26232d',
      cursor: col(polar(0.5, acc.c * 0.8, acc.h)),
      cursorAccent: bg,
      selectionBackground: col(polar(0.84, acc.c * 0.3, acc.h)),
      black: '#26232d',
      red: '#c4354d',
      green: tokenColor('--pg-work-text', '#206345'),
      yellow: '#9c5b06',
      blue: '#2a63c8',
      magenta: '#8b34d2',
      cyan: '#0d7871',
      white: '#6a6674',
      brightBlack: '#6d6973',
      brightRed: '#b02a42',
      brightGreen: '#0b6845',
      brightYellow: '#8f5304',
      brightBlue: '#2155b0',
      brightMagenta: '#7024b0',
      brightCyan: '#0a6a64',
      brightWhite: '#4b4755',
    };
    xtermCache.set(cacheKey, theme);
    return theme;
  }
  window.TnaiTheme = {
    get: () => choice,
    set(value) {
      choice = readChoice(value);
      try {
        localStorage.setItem(KEY, choice);
      } catch {}
      changed();
      return choice;
    },
    resolved,
    accent: () => accent,
    setAccent(value) {
      accent = readAccent(value);
      try {
        localStorage.setItem(ACCENT_KEY, accent);
      } catch {}
      changed();
      return accent;
    },
    accents: () =>
      Object.entries(ACCENTS).map(([key, a]) => ({ key, label: a.label, color: swatch(key) })),
    // 10-live-terminals uses this for new and open terminals
    xterm: () => (resolved() === 'dark' ? xtermDark() : xtermLight()),

    // true while the thread layout's own looks apply (its setting is on)
    threadLook: () => threadLook,
    mapColor,
  };

  // ---------------------------------------------------------------- keyboard shortcuts
  // Only shortcuts that really work. `where` says where the keys apply.
  const PAGES = [
    ['1', 'Threads', '.side-item[data-view="overview"]'],
    // 2 opened the Agents page, which is gone: the key still lands on Threads, like 1, and the
    // fourth entry keeps it out of the list
    ['2', 'Threads', '.side-item[data-view="agents"]', true],
    ['5', 'All threads', '.side-item[data-view="terminal"]'],
    ['6', 'Skills', '.side-item[data-ai-tool="skills"]'],
    ['7', 'Settings', '.side-item[data-view="settings"]'],
  ];
  const pageItem = sel => {
    const el = document.querySelector(sel);
    return el && el.getAttribute('aria-disabled') !== 'true' ? el : null;
  };

  // Cmd on a Mac; read late: this file loads in <head>, before 01 (the snapshot shortcut stays
  // Ctrl: it is a real Control-key global shortcut)
  const MOD = () => window.tnaiPlatform?.modName || 'Ctrl';
  const LIST = () => [
    {
      group: 'Anywhere',
      items: [
        [['?'], 'Show this list (when not typing)'],
        [[MOD(), '/'], 'Show this list'],
        [['Esc'], 'Close a dialog, menu or this list'],
        [[MOD(), 'K'], 'Find a page or a setting (the search of the three-dots menu)'],
        ...(window.tnaiNative?.attention
          ? [
              [
                [MOD(), 'Shift', 'J'],
                'Jump to the agent that has waited longest for you (Needs you)',
              ],
            ]
          : []),
        [[MOD(), 'B'], 'Hide or show the thread list'],
        ...(window.TnaiVoice
          ? [
              [
                window.TnaiVoice.keys(),
                'Hold to talk: what you say goes into the terminal you are in, or the composer (change it in Settings › Keyboard)',
              ],
            ]
          : []),
        ...(window.tnaiNative?.snapshot
          ? [
              [
                window.TnaiSnapshot?.keys() || ['Ctrl', 'Shift', 'Alt', 'S'],
                'Snapshot: drag a region of the screen, copied to the clipboard (works in any app while Technically Not runs; change it in Settings › Keyboard)',
              ],
            ]
          : []),
        ...(() => {
          const on = PAGES.filter(p => !p[3] && pageItem(p[2]));
          return on.length
            ? [
                [
                  [MOD(), on[0][0] + '–' + on[on.length - 1][0]],
                  'Go to ' + on.map(p => p[0] + ' ' + p[1]).join(' · '),
                ],
              ]
            : [];
        })(),
      ],
    },
    {
      // the keys of the thread layout (175, 173, 169, 135, 119), user 2026-10-23
      group: 'Threads',
      items: [
        [[MOD(), 'Alt', '↑', '↓'], 'Previous / next thread'],
        [[MOD(), 'Alt', 'Shift', '↓'], 'Next thread with something new or a question for you'],
        [[MOD(), 'F'], 'Find in this thread'],
        [[MOD(), 'A'], "Select this thread's conversation (in a dialog: the dialog's words)"],
        [[MOD(), 'P'], 'Find a file (Files tab)'],
        [[MOD(), 'J'], 'Your terminal, and back to the prompt box'],
        [['↑', '↓'], 'In the thread list (after a click in it): open the previous / next thread'],
        [['Home', 'End'], 'In the thread list: open the first / last thread'],
        [[MOD(), 'Alt', '←', '→'], 'All threads: previous / next card'],
        [['←', '→'], 'All threads: previous / next card, when no text box has the keyboard'],
        [['Delete'], 'Close the focused thread in the list'],
      ],
    },
    {
      group: 'Composer',
      items: [
        [['Enter'], 'Send the prompt to the selected agent'],
        [['Esc'], 'Right after sending, in an empty prompt box: take that prompt back to edit it'],
        [[MOD(), 'Enter'], 'Send the prompt to a new Claude Code lead'],
        [[MOD(), 'V'], 'Paste a screenshot as an attachment'],
        [['↑'], 'In an empty box: bring back prompts you sent (↓ goes forward)'],
        [[MOD(), 'S'], 'Park the prompt and its attachments; in an empty box, bring it back'],
      ],
    },
    {
      group: 'Files column',
      items: [
        [['Enter'], 'File search: open the first result'],
        [['Esc'], 'File search: clear'],
      ],
    },
    {
      group: 'Terminal',
      items: [
        [['F2'], 'Rename the focused workspace tab'],
        [['Enter'], 'Rename: confirm'],
        [['Esc'], 'Rename: cancel'],
        ...(window.tnaiNative?.pty?.capture
          ? [
              [
                [MOD(), 'Shift', window.tnaiPlatform?.mac ? 'Option' : 'Alt', 'C'],
                'Rows missing from a reply? Save the terminal you are in (screen text, sizes, recent output) for a bug report',
              ],
            ]
          : []),
      ],
    },
    {
      group: 'Lists and tabs',
      items: [
        [['←', '→'], 'Settings: previous / next tab'],
        [['←', '→'], 'Focused panel divider: resize'],
      ],
    },
  ];
  let overlay = null,
    lastFocus = null;

  function buildOverlay() {
    const style = document.createElement('style');
    style.textContent = `
/* Overlay, surface, title row and × close: the shared dialog in src/styles/01-base.css. */
.tnai-keys-overlay{z-index:2000}
/* Room to read: a wide sheet, the keys in a column of one width so every explanation starts on
   the same line, space between rows in place of rules, and clear air between the groups. */
.tnai-keys{width:min(1060px,calc(100vw - 48px));padding:32px;font:12.5px var(--pg-sans);color:#34382f}
.tnai-keys-head{margin-bottom:24px}
.tnai-keys-grid{column-count:2;column-gap:44px}
.tnai-keys section{break-inside:avoid;margin:0 0 26px}
.tnai-keys h3{margin:0 0 10px;font:600 10px var(--pg-sans);letter-spacing:1px;text-transform:uppercase;color:#8d9288}
.tnai-keys-row{display:grid;grid-template-columns:172px minmax(0,1fr);align-items:baseline;gap:16px;padding:7px 0}
.tnai-keys-row span:first-child{display:flex;gap:5px;flex-wrap:wrap}
.tnai-keys kbd{display:inline-block;min-width:18px;padding:3px 7px;border:1px solid #dfe3d9;border-bottom-width:2px;border-radius:5px;background:#fbfcf9;font:11px Consolas,monospace;color:#40463a;text-align:center}
.tnai-keys-row span:last-child{color:#5b6353;line-height:1.55}
.tnai-keys-foot{margin:4px 0 0;color:#8d9288;font-size:11.5px;line-height:1.5}
`;
    document.head.append(style);
    overlay = document.createElement('div');
    overlay.className = 'tnai-keys-overlay';
    overlay.hidden = true;
    overlay.innerHTML =
      '<section class="tnai-keys" role="dialog" aria-modal="true" aria-labelledby="tnaiKeysTitle"><header class="tnai-keys-head"><h2 id="tnaiKeysTitle">Keyboard shortcuts</h2><button type="button" class="tnai-keys-close" aria-label="Close" title="Close (Esc)">×</button></header><div class="tnai-keys-grid"></div><p class="tnai-keys-foot">' +
      (window.tnaiPlatform?.mac
        ? 'Inside a terminal, Ctrl keys go to the program running there; Cmd shortcuts still work.'
        : 'Inside a terminal, keys go to the program running there (Ctrl+B, Ctrl+/ and Ctrl+1–7 included).') +
      '</p></section>';
    document.body.append(overlay);
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.closest('.tnai-keys-close')) close();
    });
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        overlay.querySelector('.tnai-keys-close').focus();
      }
    });
  }

  function open() {
    if (!overlay) buildOverlay();
    const esc = s =>
      s.replace(
        /[&<>"']/g,
        c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
      );
    overlay.querySelector('.tnai-keys-grid').innerHTML = LIST()
      .map(
        g =>
          '<section><h3>' +
          esc(g.group) +
          '</h3>' +
          g.items
            .map(
              ([keys, what]) =>
                '<div class="tnai-keys-row"><span>' +
                keys.map(k => '<kbd>' + esc(k) + '</kbd>').join('') +
                '</span><span>' +
                esc(what) +
                '</span></div>'
            )
            .join('') +
          '</section>'
      )
      .join('');
    if (overlay.hidden) lastFocus = document.activeElement;
    overlay.hidden = false;
    overlay.querySelector('.tnai-keys-close').focus();
  }

  function close() {
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    if (lastFocus?.isConnected) lastFocus.focus?.();
  }
  const typing = t =>
    t instanceof Element &&
    !!t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], .xterm');

  // Holding Ctrl+V pastes once: the key's auto-repeat never pastes again (terminals do the same in
  // 10-live-terminals).
  document.addEventListener(
    'keydown',
    event => {
      if (
        event.repeat &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === 'v'
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true
  );
  document.addEventListener(
    'keydown',
    event => {
      if (overlay && !overlay.hidden && event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        return;
      }
      const inTerminal = event.target instanceof Element && !!event.target.closest('.xterm');
      if (
        event.key === '?' &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !typing(event.target)
      ) {
        event.preventDefault();
        open();
        return;
      }
      const P = window.tnaiPlatform; // Cmd on a Mac, where terminal programs keep Ctrl
      if (
        P?.mod(event) &&
        !event.altKey &&
        !event.shiftKey &&
        !P.otherMod(event) &&
        (P.mac || !inTerminal)
      ) {
        if (event.key === '/') {
          event.preventDefault();
          overlay && !overlay.hidden ? close() : open();
          return;
        }
        const page = PAGES.find(p => p[0] === event.key);
        const item = page && pageItem(page[2]);
        if (item) {
          event.preventDefault();
          close();
          item.click();
        }
      }
    },
    true
  );
  window.TnaiShortcuts = {
    open,
    close,
    isOpen: () => !!overlay && !overlay.hidden,
    list: () =>
      LIST().flatMap(g =>
        g.items.map(([keys, what]) => ({ group: g.group, keys: keys.join('+'), what }))
      ),
  };

  // ---------------------------------------------------------------- Settings › General (the accent
  // color) and Settings › Keyboard (tabs added in 22)
  function renderSettings() {
    const mount = document.getElementById('tnaiAppearanceMount');
    if (!mount) return;
    if (!mount.firstChild) {
      if (!overlay) buildOverlay();
      const opt = (value, label, glyph) =>
        `<label><input type="radio" name="tnaiTheme" value="${value}"><span class="set-seg-ico" aria-hidden="true">${glyph}</span>${label}</label>`;
      mount.innerHTML = `<section class="set-group settings-appearance"><header class="set-group-head"><div><h3>Color</h3></div></header><div class="set-card">
<div class="set-row"><span class="set-text"><b>Accent color</b><small>Buttons, links and highlights. Status colors keep their meaning.</small></span><div class="tnai-accent-options" role="radiogroup" aria-label="Accent color">${window.TnaiTheme.accents()
        .map(
          a =>
            `<label title="${a.label}" style="color:${a.color}"><input type="radio" name="tnaiAccent" value="${a.key}" aria-label="${a.label}"><span aria-hidden="true"></span></label>`
        )
        .join('')}</div></div></div></section>`;

      // Settings › Keyboard (its own tab since 2026-10-09): 62 and 70 add their key rows to this
      // card.
      const keyboard = document.getElementById('tnaiKeyboardMount');
      if (keyboard)
        keyboard.innerHTML = `<section class="set-group"><header class="set-group-head"><div><h3>Shortcuts</h3></div></header><div class="set-card">
<div class="set-row"><span class="set-text"><b>Keyboard shortcuts</b><small>Every shortcut in Technically Not in one list. It also opens with <kbd>?</kbd> or <kbd>${MOD()}</kbd>+<kbd>/</kbd>.</small></span><button type="button" class="settings-keys-button" id="tnaiShowShortcuts">Show shortcuts</button></div></div></section>`;
      const style = document.createElement('style');
      style.dataset.pg = ''; // round swatches; data-pg: not recolored
      style.textContent =
        '.tnai-accent-options{display:flex;gap:10px;align-items:center}.tnai-accent-options label{position:relative;display:block;width:22px;height:22px;cursor:pointer}.tnai-accent-options input{position:absolute;inset:0;margin:0;opacity:0;cursor:pointer}.tnai-accent-options span{display:block;width:100%;height:100%;border-radius:50%;background:currentColor;box-shadow:inset 0 0 0 1px rgba(0,0,0,.14)}.tnai-accent-options input:checked+span{outline:2px solid currentColor;outline-offset:2px}.tnai-accent-options input:focus-visible+span{outline:var(--pg-ring,2px) dashed currentColor;outline-offset:2px}';
      document.head.append(style);
      mount.addEventListener('change', e => {
        if (e.target.name === 'tnaiTheme') window.TnaiTheme.set(e.target.value);
        else if (e.target.name === 'tnaiAccent') window.TnaiTheme.setAccent(e.target.value);
      });
      document.getElementById('tnaiShowShortcuts')?.addEventListener('click', open);
    }
    mount.querySelectorAll('input[name="tnaiTheme"]').forEach(i => {
      i.checked = i.value === choice;
    });
    mount.querySelectorAll('input[name="tnaiAccent"]').forEach(i => {
      i.checked = i.value === accent;
    });
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', renderSettings);
  else renderSettings();
})();
