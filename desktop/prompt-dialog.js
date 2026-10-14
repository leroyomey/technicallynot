// Technically Not desktop · prompt-dialog.js — Electron has no window.prompt(); this small modal
// window provides it (used by "New workspace" naming), and `confirm` asks a yes/no question with
// named buttons (main.js folder trust only when there is no main window; normally it is asked
// inside the agent's panel, 74-trust-ask.js). The window sizes itself to its content (long messages
// wrap, never clipped), capped to the screen; the user can resize it. No OS title bar:
// its own top row, like the main window's (66), with the title and a close button; the
// row drags the window.
'use strict';
const { BrowserWindow, screen } = require('electron');

const esc = text =>
  String(text ?? '').replace(
    /[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  );
const STYLE = `<!doctype html><meta charset="utf-8"><title>Technically Not</title><style>
html{overflow:hidden}html.scroll{overflow-y:auto}
html.sized body{box-sizing:border-box;min-height:100vh;display:flex;flex-direction:column}html.sized form{flex:1;display:flex;flex-direction:column}html.sized form>div{margin-top:auto;padding-top:20px}
header{display:flex;align-items:center;height:32px;margin:0 -24px;padding-left:14px;-webkit-app-region:drag;user-select:none;border-bottom:1px solid #eceee8;background:#fff}header span{flex:1;color:#6d7069;font:11px Arial}header+form{padding-top:20px}
header button{-webkit-app-region:no-drag;display:grid;place-items:center;width:40px;height:30px;padding:0;margin:0 1px 0 0;border:0;border-radius:6px;background:transparent;color:#6d7069;cursor:default}header button:hover{background:#bd6b5f;color:#fff}header button:active{background:#9a4a3e;color:#fff}header svg{width:10px;height:10px;fill:none;stroke:currentColor;stroke-width:1}
body{margin:0;padding:0 24px 24px;background:#fbfcf9;color:#20211f;font:12px Arial}p{margin:0 0 12px;font-weight:600;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}
input{box-sizing:border-box;width:100%;height:30px;padding:0 10px;border:1px solid #dfe3d9;border-radius:6px;background:#fff;color:#3e4438;font:12px Arial;outline:none}input:focus{border-color:#bccaa9;box-shadow:0 0 0 3px #eef3e7}
div{display:flex;flex-wrap:nowrap;justify-content:flex-end;gap:8px;margin-top:20px}button{box-sizing:border-box;flex:none;height:30px;padding:0 12px;border:1px solid #e1e6da;border-radius:7px;background:#fff;color:#4e5547;font:600 11px Arial;white-space:nowrap;cursor:pointer}button:hover{background:#f3f6ee}
button.primary{border-color:#d6e2c6;background:#f0f5e9;color:#46603a}button.primary:hover{background:#e7efdc}button:focus-visible{outline:2px solid #8da56c;outline-offset:2px}</style>`;

// Resizable: once sized to its content, the form fills the window (buttons stay at the bottom) and
// scrolls when the user makes it smaller than its content.
const FIT =
  "addEventListener('resize',()=>{const d=document.documentElement;if(d.classList.contains('sized'))d.classList.toggle('scroll',d.scrollHeight>innerHeight+1)});";
const BAR = `<header><span>Technically Not</span><button type="button" id="x" aria-label="Close" title="Close"><svg viewBox="0 0 10 10"><path d="M.5.5l9 9M9.5.5l-9 9"/></svg></button></header>`,
  BAR_JS = "document.getElementById('x').onclick=()=>window.close();";
const page = (message, value) => `${STYLE}
${BAR}<form><p>${esc(message)}</p><input autofocus value="${esc(value)}"><div><button type="button" id="cancel">Cancel</button><button class="primary">OK</button></div></form>
<script>const f=document.querySelector('form'),i=f.querySelector('input');i.select();
f.onsubmit=e=>{e.preventDefault();document.title='TNAI_OK:'+i.value};document.getElementById('cancel').onclick=()=>window.close();
addEventListener('keydown',e=>{if(e.key==='Escape')window.close()});${BAR_JS}${FIT}</script>`;

// Yes/no: Enter (unless "cancel" has focus) = the primary button, Escape or closing = no.
const confirmPage = (message, ok, cancel) => `${STYLE}
${BAR}<form><p>${esc(message)}</p><div><button type="button" id="cancel">${esc(cancel)}</button><button class="primary" autofocus>${esc(ok)}</button></div></form>
<script>const f=document.querySelector('form');f.onsubmit=e=>{e.preventDefault();document.title='TNAI_OK:1'};document.getElementById('cancel').onclick=()=>window.close();
addEventListener('keydown',e=>{if(e.key==='Escape')window.close();else if(e.key==='Enter'&&document.activeElement?.id!=='cancel'){e.preventDefault();f.requestSubmit()}});${BAR_JS}${FIT}</script>`;

// Resolves with the entered text, or null if cancelled.
const open = (parent, message, html) =>
  new Promise(resolve => {
    // Wider for long messages; the height follows the content once it has loaded.
    const width = String(message ?? '').length > 160 ? 520 : 440;
    const win = new BrowserWindow({
      parent,
      modal: true,
      width,
      height: 170,
      useContentSize: true,
      resizable: true,
      minWidth: 340,
      minHeight: 150,
      minimizable: false,
      maximizable: false,
      autoHideMenuBar: true,
      title: 'Technically Not',
      backgroundColor: '#0f0a1f',
      show: false,
      ...(process.platform !== 'darwin' ? { titleBarStyle: 'hidden' } : {}),
      webPreferences: { sandbox: true, contextIsolation: true },
    });
    let result = null;
    win.on('page-title-updated', (event, title) => {
      if (title.startsWith('TNAI_OK:')) {
        event.preventDefault();
        result = title.slice('TNAI_OK:'.length);
        win.close();
      }
    });
    const show = () => {
      if (!win.isDestroyed() && !win.isVisible()) win.show();
    };
    const fallback = setTimeout(show, 1500);
    win.webContents.once('did-finish-load', async () => {
      try {
        const height = await win.webContents.executeJavaScript(
          'Math.ceil(document.body.getBoundingClientRect().height)'
        );
        if (win.isDestroyed()) return;
        const area = screen.getDisplayMatching(
          parent && !parent.isDestroyed() ? parent.getBounds() : win.getBounds()
        ).workArea;
        const max = Math.max(160, area.height - 80),
          fit = Math.min(height, max);
        if (height > max)
          await win.webContents.executeJavaScript(
            "document.documentElement.classList.add('scroll')"
          );
        if (win.isDestroyed()) return;
        win.setContentSize(Math.min(width, area.width - 40), fit);
        await win.webContents.executeJavaScript("document.documentElement.classList.add('sized')");
        if (parent && !parent.isDestroyed()) {
          const p = parent.getBounds(),
            b = win.getBounds();
          win.setPosition(
            Math.round(p.x + (p.width - b.width) / 2),
            Math.round(p.y + Math.max(40, (p.height - b.height) / 3))
          );
        }
      } catch {}
      clearTimeout(fallback);
      show();
    });
    win.on('closed', () => resolve(result));
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  });
module.exports = (parent, message, value) => open(parent, message, page(message, value));

// Resolves true for the primary button, false for cancel / Escape / closed.
module.exports.confirm = (parent, message, { ok = 'OK', cancel = 'Cancel' } = {}) =>
  open(parent, message, confirmPage(message, ok, cancel)).then(result => result !== null);
