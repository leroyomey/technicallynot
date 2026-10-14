// Technically Not tools · desktop-check/fake-oidc.js — TEST ONLY (tools/ is never packaged). A
// local fake Google-like OpenID provider for the plan-lock self-test, at /google: discovery,
// PKCE-checked code exchange, RS256 ID tokens (JWKS at /google/jwks). Its next answer is scripted
// with plan(); tamper = badsig | aud | nonce | expired. Also a fake GitHub OAuth App at /github:
// /login/oauth/authorize, /login/oauth/access_token (client secret + PKCE checked), /api/user and
// /api/user/emails; plan('github', { action: approve | deny | ignore, user, emails }).
'use strict';
const http = require('http');
const crypto = require('crypto');
const jwt = require('../../desktop/auth-jwt');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqPtfDwAE5gJ8cHSe4gAAAABJRU5ErkJggg==',
  'base64'
);

function createFakeProvider({ google, github }) {
  const keys = {
    google: crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }),
    rogue: crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }),
  };
  const kid = { google: 'fake-google-1' };
  const plans = { google: null, github: null };
  const codes = new Map(),
    refresh = new Map(),
    ghTokens = new Map();
  const revoked = [],
    log = [];
  let base = '';
  const issuer = p => base + '/' + p;

  const jwks = p => ({
    keys: [
      { ...keys[p].publicKey.export({ format: 'jwk' }), kid: kid[p], alg: 'RS256', use: 'sig' },
    ],
  });

  function idToken(p, claims, tamper) {
    const now = Math.floor(Date.now() / 1000);
    const body = { iss: issuer(p), iat: now, exp: now + 3600, ...claims };
    if (tamper === 'aud') body.aud = 'someone-else';
    if (tamper === 'nonce') body.nonce = 'not-the-nonce';
    if (tamper === 'expired') {
      body.iat = now - 7200;
      body.exp = now - 3600;
    }
    const data =
      jwt.b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: kid[p] })) +
      '.' +
      jwt.b64url(JSON.stringify(body));
    const key = tamper === 'badsig' ? keys.rogue.privateKey : keys[p].privateKey;
    return data + '.' + jwt.b64url(crypto.sign('sha256', Buffer.from(data), key));
  }
  const tokens = () => ({ access: 'at-' + jwt.random(12), refresh: 'rt-' + jwt.random(12) });

  const readBody = req =>
    new Promise(resolve => {
      let d = '';
      req.on('data', c => {
        d += c;
      });
      req.on('end', () => resolve(new URLSearchParams(d)));
    });
  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=600' });
    res.end(JSON.stringify(body));
  };
  const redirect = (res, url) => {
    res.writeHead(302, { Location: url });
    res.end();
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, base),
      q = Object.fromEntries(url.searchParams),
      route = req.method + ' ' + url.pathname;
    log.push(route);

    // ---- Google-like ----
    if (route === 'GET /google/.well-known/openid-configuration')
      return json(res, 200, {
        issuer: issuer('google'),
        authorization_endpoint: issuer('google') + '/authorize',
        token_endpoint: issuer('google') + '/token',
        jwks_uri: issuer('google') + '/jwks',
        revocation_endpoint: issuer('google') + '/revoke',
      });
    if (route === 'GET /google/jwks') return json(res, 200, jwks('google'));
    if (route === 'GET /google/picture.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(PNG);
    }
    if (route === 'GET /google/authorize') {
      const plan = plans.google;
      plans.google = null;
      const valid =
        q.client_id === google.clientId &&
        q.response_type === 'code' &&
        q.code_challenge_method === 'S256' &&
        q.code_challenge?.length === 43 &&
        /^http:\/\/127\.0\.0\.1:\d+\/callback$/.test(q.redirect_uri || '') &&
        q.state &&
        q.nonce &&
        /openid/.test(q.scope || '');
      if (!valid) {
        res.writeHead(400);
        return res.end('bad authorize request');
      }
      if (!plan || plan.action === 'ignore') {
        res.writeHead(200);
        return res.end('waiting for the user');
      }
      const back = new URL(q.redirect_uri);
      back.searchParams.set('state', q.state);
      if (plan.action === 'deny') {
        back.searchParams.set('error', 'access_denied');
        return redirect(res, back.toString());
      }
      const code = 'gc-' + jwt.random(12);
      codes.set(code, { p: 'google', q, plan });
      back.searchParams.set('code', code);
      return redirect(res, back.toString());
    }
    if (route === 'POST /google/token') {
      const b = await readBody(req);
      if (b.get('client_id') !== google.clientId || b.get('client_secret') !== google.clientSecret)
        return json(res, 401, { error: 'invalid_client' });
      if (b.get('grant_type') === 'refresh_token') {
        const r = refresh.get(b.get('refresh_token'));
        if (!r || r.revoked) return json(res, 400, { error: 'invalid_grant' });
        return json(res, 200, {
          access_token: 'at-' + jwt.random(12),
          expires_in: 3600,
          token_type: 'Bearer',
        });
      }
      const entry = codes.get(b.get('code'));
      codes.delete(b.get('code'));
      if (
        !entry ||
        entry.p !== 'google' ||
        b.get('redirect_uri') !== entry.q.redirect_uri ||
        jwt.challengeOf(b.get('code_verifier') || '') !== entry.q.code_challenge
      )
        return json(res, 400, { error: 'invalid_grant' });
      const u = entry.plan.user,
        t = tokens();
      refresh.set(t.refresh, { p: 'google', revoked: false });
      return json(res, 200, {
        access_token: t.access,
        refresh_token: t.refresh,
        expires_in: 3600,
        token_type: 'Bearer',
        id_token: idToken(
          'google',
          {
            aud: google.clientId,
            sub: u.sub,
            email: u.email,
            email_verified: u.email_verified !== false,
            name: u.name,
            picture: issuer('google') + '/picture.png',
            nonce: entry.q.nonce,
          },
          entry.plan.tamper
        ),
      });
    }

    // ---- GitHub-like OAuth App (code + PKCE; token swapped by the accounts server with the client
    // secret) ----
    if (route === 'GET /github/login/oauth/authorize') {
      const plan = plans.github;
      plans.github = null;
      const valid =
        github &&
        q.client_id === github.clientId &&
        q.code_challenge_method === 'S256' &&
        q.code_challenge?.length === 43 &&
        /^http:\/\/127\.0\.0\.1:\d+\/callback$/.test(q.redirect_uri || '') &&
        q.state &&
        (q.scope || '').split(' ').includes('read:user') &&
        (q.scope || '').split(' ').includes('user:email');
      if (!valid) {
        res.writeHead(400);
        return res.end('bad authorize request');
      }
      if (!plan || plan.action === 'ignore') {
        res.writeHead(200);
        return res.end('waiting for the user');
      }
      const back = new URL(q.redirect_uri);
      back.searchParams.set('state', q.state);
      if (plan.action === 'deny') {
        back.searchParams.set('error', 'access_denied');
        back.searchParams.set('error_description', 'The user has denied your application access.');
        return redirect(res, back.toString());
      }
      const code = 'ghc-' + jwt.random(12);
      codes.set(code, { p: 'github', q, plan });
      back.searchParams.set('code', code);
      return redirect(res, back.toString());
    }
    if (route === 'POST /github/login/oauth/access_token') {
      const b = await readBody(req);
      if (b.get('client_id') !== github.clientId || b.get('client_secret') !== github.clientSecret)
        return json(res, 200, { error: 'incorrect_client_credentials' });
      const entry = codes.get(b.get('code'));
      codes.delete(b.get('code'));
      if (
        !entry ||
        entry.p !== 'github' ||
        b.get('redirect_uri') !== entry.q.redirect_uri ||
        jwt.challengeOf(b.get('code_verifier') || '') !== entry.q.code_challenge
      )
        return json(res, 200, { error: 'bad_verification_code' });
      const token = 'gho-' + jwt.random(12);
      ghTokens.set(token, entry.plan);
      return json(res, 200, {
        access_token: token,
        token_type: 'bearer',
        scope: 'read:user,user:email',
      });
    }
    if (route === 'GET /github/api/user' || route === 'GET /github/api/user/emails') {
      const plan = ghTokens.get((/^Bearer (\S+)$/.exec(req.headers.authorization || '') || [])[1]);
      if (!plan) return json(res, 401, { message: 'Bad credentials' });
      return json(res, 200, url.pathname.endsWith('/emails') ? plan.emails || [] : plan.user);
    }
    if (route === 'POST /google/revoke') {
      const b = await readBody(req);
      const r = refresh.get(b.get('token'));
      if (r) r.revoked = true;
      revoked.push({ p: 'google', token: b.get('token') });
      return json(res, 200, {});
    }
    res.writeHead(404);
    res.end();
  });

  return {
    start: () =>
      new Promise(resolve =>
        server.listen(0, '127.0.0.1', () => {
          base = 'http://127.0.0.1:' + server.address().port;
          resolve(base);
        })
      ),
    stop: () => server.close(),
    plan: (p, plan) => {
      plans[p] = plan;
    },
    issuer,
    revoked,
    log,
    refresh,
    revokeAll: () => {
      for (const r of refresh.values()) r.revoked = true;
    },
    issuedRefreshTokens: () => [...refresh.keys()],
  };
}

module.exports = { createFakeProvider };
