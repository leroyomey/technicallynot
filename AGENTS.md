# Rules for AI coding agents

You are working on Technically Not, a desktop app (Electron) that runs AI coding agents in terminal panels. These rules are for any agent that changes this repository. People follow the same rules; see `CONTRIBUTING.md`.

## Where things are

- `index.html`: markup and the ordered list of styles and scripts. Nothing else.
- `src/scripts/`: the interface, one feature per file. The files are classic scripts, loaded in the order of the number their name starts with. `src/styles/`: the styles.
- `desktop/`: the main process. Terminals, agent programs, disk access, and the `window.tnaiNative` bridge to the interface.
- `relay/`: the relay a person runs themselves. `phone/`: the phone page.
- `tools/`: the format command, the checks and the tests.

Search for the exact name first and open only the file that owns the feature.

## Code is written to be read by hand

- One statement a line. Names that say what the thing is. A first comment that says what the file is for.
- Comments stand on their own line above the code and say why.
- No new function over about 150 lines, no new file over about 1,500.
- After you edit a code file: `node tools/format-code.js <file>`. `npm run format:check` must stay at 0.
- Never write dense or minified code to match an older file. The rules are in `docs/CODE_STYLE.md`.

## Check your change

- `node tools/check-syntax.js` after every change to `src/scripts/` or `desktop/`.
- Run the plain Node test of what you touched (`node tools/<name>-test.js`), and `npm test` in `relay/` for the relay.
- Window tests (`tools/desktop-check/`) open the real app. Run one at a time, never several together, and stop every process you start.
- Say plainly what you tested and what you did not.

## The design is locked

The look of the app (colors, spacing, type, radii), its pages and navigation, and where each view and panel sits do not change unless the owner asks for that change. Allowed without asking: a bug fix that brings back the intended look, and a new control that reuses existing styles and places. A request to "improve" or "polish" is not permission to redesign. Ask first.

## Product rules

- The product is called **Technically Not**. Internal names use `tnai` (the `tnai` command, `tnai-*` classes, `TNAI_*` variables).
- Say **panel**, never "pane", in everything a person reads. `pane` stays only inside code names such as `paneId`.
- Desktop first; tablet sizes adapt. No phone layout for the main app.
- Be honest about what works. A control without a working feature stays grayed out (`src/scripts/12-inactive-ui.js`). No fake results and no made-up status.
- Live status comes from events (file watchers, messages between processes), not from asking again and again.

## Do not

- Do not change how an existing feature works or looks to make your own task easier.
- Do not add a dependency without the owner's word.
- Do not build an installer, commit, push or publish unless you are asked to.
- Do not put keys, tokens, personal names or home folder paths into code, tests or comments.
