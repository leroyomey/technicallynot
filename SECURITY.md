# Security

## Reporting a problem

Please do not open a public issue for a security problem.

Write to: **security@technicallynot.ai**. You can also use GitHub's private "Report a vulnerability" button on this repository.

Say what you found, how to make it happen, and which version or commit you used. We answer within 5 business days. Please give us 90 days to fix it before you make it public.

## In scope

- **The app:** the code in `desktop/` and `src/`. For example: a web page or a file that makes the app run a command, a way for one terminal panel or agent to act as another, a way around the checks on what a paired computer may do.
- **The relay:** the code in `relay/`. For example: reading or changing messages that should be sealed, joining a relay without its secret.
- **The phone page:** the code in `phone/`.

## Not in scope

- The agent programs the app runs (Claude Code, Codex and the others). Report those to their makers.
- What an agent does with the permissions you gave it. An agent that may run commands can run commands.
- A relay someone runs with a weak or shared secret.
- Problems that need someone to already have full use of your computer account.

## Good to know

- The app runs the agent programs with your own user rights. It is not a sandbox.
- A relay sees who connects and how much is sent. It does not see what is sent.
