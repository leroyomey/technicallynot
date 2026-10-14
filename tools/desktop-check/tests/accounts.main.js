// Technically Not tools · desktop-check/tests/accounts.main.js — Main-process side of the accounts
// self-test: writes fake, throwaway credential files (never real tokens) into a test account's own
// folder, so the plan-tag reader (account-service.js planFor) can be checked without any real CLI
// sign-in. Methods are called from accounts.js via TNAI_MAIN.
'use strict';
const fs = require('fs');
const path = require('path');

const b64url = obj =>
  Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

module.exports = () => ({
  // Claude Code reads <dir>/.credentials.json -> claudeAiOauth.subscriptionType.
  writeClaudeCreds: (dir, subscriptionType) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.credentials.json'),
      JSON.stringify({
        claudeAiOauth: { subscriptionType, accessToken: 'fake', refreshToken: 'fake' },
      })
    );
    return true;
  },
  // Codex reads <dir>/auth.json -> tokens.id_token (a JWT) ->
  // payload["https://api.openai.com/auth"].chatgpt_plan_type. alg "none", unsigned: only the
  // payload is ever decoded.
  writeCodexAuth: (dir, chatgptPlanType) => {
    fs.mkdirSync(dir, { recursive: true });
    const idToken =
      b64url({ alg: 'none', typ: 'JWT' }) +
      '.' +
      b64url({ 'https://api.openai.com/auth': { chatgpt_plan_type: chatgptPlanType } }) +
      '.';
    fs.writeFileSync(
      path.join(dir, 'auth.json'),
      JSON.stringify({ tokens: { id_token: idToken, access_token: 'fake' } })
    );
    return true;
  },
});
