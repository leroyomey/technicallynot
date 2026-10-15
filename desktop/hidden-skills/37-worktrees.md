---
name: worktrees
description: When agents use their own git worktree (only for code work running in parallel with other code edits), and how an agent in a worktree keeps shared tracking files in the main project folder so branches don't conflict at merge.
for: every-agent
tnai-hidden: true
---
- Worktrees: use your own (`tnai_delegate` `worktree: own`, or Own worktree when starting an agent) only for code that runs at the same time as other agents' code edits and must stay apart until it is reviewed and merged. Docs, notes, plans, research, reviews, marketing, business writing and plain questions stay in the project folder.
- In a worktree, `git worktree list` prints the main project folder first; when your folder is not that one, you are on your own `tnai/` branch. Edit files many agents add lines to (issue and suggestion lists, the release queue, current-state and status docs, shared notes) in that main folder, never in your copy. Your code, tests and the docs of your own feature stay in the worktree. Name the main-folder files you changed in your report. `node_modules` may be a link to the main folder's: use it as is; don't install or change dependencies there unless the task needs it, and then delete only the link itself (never what it points to) before installing.
- Landing a worktree: Merge from the ⎇ row (in your thread's Details, under Setup; a worktree no thread holds is listed under "Worktrees without a panel" in that popover and as a row of that name in the three-dots menu, under Projects) takes the commits on the worktree's branch; uncommitted work stays behind. Follow the project's commit rules; when commits need the user's approval, leave the work uncommitted and say in your report which worktree branch holds it.
