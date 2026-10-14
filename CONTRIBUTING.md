# Contributing

Thank you for looking. This page says how to run the app, how the code is laid out, and how to propose a change.

## Run it

```sh
npm install
npm start
```

The app is an Electron program. `desktop/` is the main process (terminals, agent programs, disk). `src/` is the interface: `src/scripts/` holds one feature per file, loaded in the order of the number at the start of the name, and `src/styles/` holds the styles. `index.html` only lists them. `relay/` is the relay a person runs themselves, and `phone/` is the phone page. The longer account, with the security rules a change must keep, is in [ARCHITECTURE.md](ARCHITECTURE.md).

## Code style

All code here is written to be read and changed by hand. The rules are short and are in [docs/CODE_STYLE.md](docs/CODE_STYLE.md). After you edit a code file, run:

```sh
node tools/format-code.js path/to/file.js
```

It formats the file and proves that the program did not change. `npm run format:check` must report nothing to change.

In words: one statement a line, names that say what the thing is, a first comment that says what the file is for, and comments on their own line above the code, saying why.

In text the user sees, one terminal of the app is a "terminal panel".

## Tests

Run these before you propose a change:

```sh
node tools/check-syntax.js
npm run format:check
```

Then run the tests for what you touched:

- **Plain Node tests:** `node tools/<name>-test.js` (or `.mjs`). They need no window.
- **The relay:** `cd relay`, then `npm test`.
- **Window tests:** `powershell -File tools/desktop-check/check.ps1 -Test <name>` starts the real app with a separate, empty profile and runs one test from `tools/desktop-check/tests/`. Run them one at a time.

If you add a feature, add a test for it. If you fix a bug, add the test that would have caught it.

## What to expect

One person reviews every change here. A pull request can wait for a while, can come back with a request to make it smaller, and can be declined, also when it is well made. Opening one does not oblige the project to merge it. That is why the first step for anything larger than a small fix is an issue: an answer there costs you minutes, not an evening.

An idea for the app is not an issue. Start a discussion under Ideas, and say what you are trying to do, not only the feature you have in mind.

## Proposing a change

1. For anything larger than a small fix, open an issue first and say what you want to change and why. It saves you work if the answer is no.
2. Keep a pull request to one thing. Say what problem it solves, what you changed, how you tested it, and what you did not test.
3. If the change shows on screen, add a picture from before and one from after. Take names, keys and private paths out of them first.
4. If an AI agent wrote the change, say which model and which tool. That is welcome here. You still need to understand the change and be able to explain it.
5. Do not add a dependency without asking. The app has few on purpose.

## The design is the owner's

The look of the app (its colors, spacing, type), its pages and where each view and panel sits are decided by the owner and are not open for redesign in a pull request. Bug fixes that bring back the intended look are welcome, and so are new controls that reuse the existing styles and places. For anything else that changes the look or the layout, open an issue and wait for an answer before you build it.

## Security

Do not report a security problem in a public issue. See [SECURITY.md](SECURITY.md).

## Licence

By contributing you agree that your contribution is under the [MIT licence](LICENSE) of this project.
