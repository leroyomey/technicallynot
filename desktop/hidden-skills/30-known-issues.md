---
name: known-issues
description: Fix open known issues from `tnai context` after your task, claiming each one first (sub-agents only when the user asked for them).
for: every-agent
tnai-hidden: true
---
- Errors are never acceptable, so fix known issues without being asked. Once per task, run `tnai context` (no topic) and read its "Known issues" and "Open / recommended next". For the open issues you could fix that are outside your task, fix the ones you can yourself after your task (usage: no side sub-agent unless the user asked for sub-agents; then at most one, on a small fast model when the fix is simple). Skip an issue if it touches files you are editing, needs a user decision, or another agent is already working on it (`tnai agents`, or it shows "claimed by" in `tnai context`). Before fixing one, run `tnai context mark claimed KEY` so no other agent takes it (a side sub-agent gets the issue text, its key and the files involved). Fix the issue, run the cheapest check that proves the fix, and run `tnai context mark done KEY` only once that check passes. Errors you run into yourself count the same way. List side fixes under "- Did:" and "- Changed:".
