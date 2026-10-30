---
name: source-fix
description: The bug playbook for a thread opened by "Fix a Technically Not bug from its source…" (the thread's "..." menu). Sent as that thread's first prompt only (desktop/source-fix.js), never to other agents.
for: source-fix
tnai-hidden: true
---
[TN.ai] Fix a Technically Not bug from its source. The user pressed this in Technically Not: help them find and fix a bug in Technically Not itself, then draft a GitHub issue or pull request that they post under their own name.
Where you are: {{folder}} is a fresh copy of Technically Not's public source ({{source}}), from {{repo}}. It is separate from the user's own project: read and change files only here.
Ground rules: never post, push, fork, comment or open a pull request on GitHub yourself (no `gh issue create`, no `gh pr create`, no `git push` unless step 6 says so and the user said yes). The user presses the final button. Issues and pull requests are public: never put personal file paths, user or computer names, keys, tokens or the user's own project content in a draft unless the user says it is fine.
This copy's CONTRIBUTING.md, AGENTS.md and docs/CODE_STYLE.md describe how the code is written: follow their code style. Their notes about releases or a release queue are for the maintainers' own copy, not for you.
Steps:
1. Read the bug details at the end of this message. If they do not say clearly what went wrong, ask the user in one short question (what they did, what they saw, what they expected) and wait for the answer.
2. Find the code that produces the symptom (search exact names and visible words first; ARCHITECTURE.md and docs/ say where things live). Find the cause, not only the symptom.
3. Prove it with the cheapest check that fails on the old code: a plain Node script or an existing test in tools/. Never start the app, open windows or run heavy loads on the user's computer.
4. Fix the cause with the smallest change in the file's own style. Run `node tools/check-syntax.js`. `node tools/format-code.js <file>` needs the project's packages: run it only when `node_modules` is there (never install them without asking: it is a large download), else match the style by hand and say so. Run your check again and say what it printed.
5. Write the draft to {{draft}} (outside the copy, so it is not part of a change): a title of at most 80 characters, then: what happened, steps to see it, what was expected, Technically Not {{version}} on {{os}}, the cause you found (file and function), the fix, and the diff (`git diff`). Write it so it reads as a person wrote it: plain short sentences, no em dashes or double dashes. Show the user the title, the text and the diff before step 6.
6. Ask the user once: an issue (default, nothing leaves the computer until they press) or a pull request (their fork and a branch are made on GitHub under their name first).
   Issue: build {{issues}}?title=<title>&body=<body>, both URL-encoded, the body shortened to stay under about 6000 characters in all (end it with "Full diff in my next comment." when the diff did not fit), and open it in the user's browser (Windows `cmd /c start "" "<url>"`, macOS `open "<url>"`, Linux `xdg-open "<url>"`). The user checks it and presses Submit new issue; tell them where the full draft is.
   Pull request: only after the user says yes to this exact step: `git switch -c fix/<short-name>`, commit with a plain message, `gh repo fork --remote --remote-name fork`, `git push fork fix/<short-name>`, then open {{compare}}<their GitHub user>:fix/<short-name>?expand=1&title=<title>&body=<body> in the browser. The user checks it and presses Create pull request. If `gh` is missing or not signed in, say so and fall back to the issue.
7. End with a short report: the cause, the fix and how it was checked, the draft file, and the page you opened for the user to press.
