/*
 * Technically Not tools · desktop-check/tests/account-signin.main.js — Main-process side of the
 * account-signin self-test (loaded by run.js): a TEST-ONLY fake accounts server (/auth/exchange,
 * /auth/login, /auth/device-replace, /entitlements, /auth/refresh, /auth/logout, /app/login-link; 3
 * computers per account, 409 device_limit + one-time ticket) that signs plan passes with a test
 * Ed25519 key (or a rogue key), the fake Google provider and fake GitHub OAuth App (fake-oidc.js)
 * for the browser part (GitHub's code is swapped here with the server-only secret), and a scripted
 * "system browser". Points user-auth.js at them through the self-test-only env overrides. Methods
 * are called from account-signin.js via TNAI_MAIN.
 *
 * Every sign-in ends with the app asking for the keyboard (user-auth.js, finishSignIn), and the
 * test opens a pop-out: quiet-window.js makes both do nothing here, so the run never takes the
 * keyboard from the user. quiet() reads back what was asked and what reached Windows.
 */
'use strict';
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { createFakeProvider } = require('../fake-oidc');
const auth = require('../../../desktop/user-auth');
const quietWindow = require('../quiet-window');

module.exports = win => {
  const quiet = quietWindow(win);
  const T = auth._test;
  const good = crypto.generateKeyPairSync('ed25519'),
    rogue = crypto.generateKeyPairSync('ed25519');
  const google = {
    clientId: 'test-client.apps.googleusercontent.com',
    clientSecret: 'test-desktop-secret',
  };
  const b64url = b => Buffer.from(b).toString('base64url');
  const githubApp = {
    clientId: 'Iv-test-github-client',
    clientSecret: 'test-github-secret-server-only',
  };
  const s = {
    plan: 'pro',
    key: 'good',
    expIn: 7 * 86400,
    online: true,
    skewMs: 0,
    tokens: new Map(),
    calls: [],
    issued: [],
    githubBodies: [],
    githubDown: false,
    limit: 3,
    devices: {},
    tickets: new Map(),
    tokenDevice: new Map(),
    signIns: [],
    replaceBodies: [],
    totpTickets: new Map(),
    totpBodies: [],
  };
  let base = '',
    provider,
    lastBrowse = null,
    ghBase = '';
  const browsed = [];

  function pass(userId) {
    // skewMs: the server's clock is ahead of this PC's (= this PC's clock set back)
    const now = Math.floor((Date.now() + s.skewMs) / 1000);
    const paid = {
      features: [
        'unlimited_panes',
        'named_workspaces',
        'custom_agents',
        'custom_skills',
        'source_control',
      ],
      limits: { projects: null, panes: 12 },
    };
    const claims =
      s.plan === 'pro'
        ? { plan: 'pro', status: 'active', subscribed: true, ...paid }
        : {
            plan: 'none',
            status: s.status || 'none',
            subscribed: false,
            features: [],
            limits: { projects: 0, panes: 0 },
          }; // status: e.g. 'canceled' or 'unpaid' (plan pass)
    const data =
      b64url(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })) +
      '.' +
      b64url(JSON.stringify({ sub: userId, ...claims, iat: now, exp: now + s.expIn }));
    return (
      data +
      '.' +
      b64url(crypto.sign(null, Buffer.from(data), (s.key === 'rogue' ? rogue : good).privateKey))
    );
  }
  const newToken = (userId, deviceId = '') => {
    const t = 'apptok-' + crypto.randomBytes(16).toString('hex');
    s.tokens.set(t, userId);
    s.tokenDevice.set(t, deviceId);
    s.issued.push(t);
    return t;
  };
  const json = (res, status, body) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      Date: new Date(Date.now() + s.skewMs).toUTCString(),
    });
    res.end(JSON.stringify(body));
  };
  const readBody = req =>
    new Promise(r => {
      let d = '';
      req.on('data', c => {
        d += c;
      });
      req.on('end', () => {
        try {
          r(JSON.parse(d || '{}'));
        } catch {
          r({});
        }
      });
    });
  const userIdOf = email =>
    'u_mail_' + crypto.createHash('sha256').update(email).digest('hex').slice(0, 8);

  // Like the real server: app sign-ins carry device_id + device_name; a 4th computer gets 409
  // device_limit (oldest first) + a one-time ticket, no session.
  function grant(res, id, user, extra, body) {
    const list = s.devices[id] || (s.devices[id] = []),
      now = Math.floor(Date.now() / 1000),
      mine = list.find(d => d.id === body.device_id);
    if (mine) Object.assign(mine, { name: body.device_name, last_seen: now });
    else list.push({ id: body.device_id, name: body.device_name, last_seen: now });
    return json(res, 200, { token: newToken(id, body.device_id), user, ...extra });
  }

  function issue(res, route, body, id, user, extra = {}) {
    s.signIns.push({ route, device_id: body.device_id, device_name: body.device_name });
    if (
      typeof body.device_id !== 'string' ||
      !body.device_id ||
      typeof body.device_name !== 'string' ||
      !body.device_name
    )
      return json(res, 400, { error: 'invalid_request' });
    const list = s.devices[id] || [];
    if (!list.some(d => d.id === body.device_id) && list.length >= s.limit) {
      const ticket = 'dt-' + crypto.randomBytes(12).toString('hex');
      s.tickets.set(ticket, { id, user, extra, deviceId: body.device_id });
      return json(res, 409, {
        error: 'device_limit',
        limit: s.limit,
        devices: list.map(d => ({ id: d.id, name: d.name, last_seen: d.last_seen })),
        device_ticket: ticket,
      });
    }
    return grant(res, id, user, extra, body);
  }
  const bearer = req => (/^Bearer (\S+)$/.exec(req.headers.authorization || '') || [])[1] || '';

  const server = http.createServer(async (req, res) => {
    const route = req.method + ' ' + new URL(req.url, 'http://x').pathname;
    s.calls.push(route);
    if (!s.online) return req.socket.destroy(); // "offline": the connection drops
    const body = req.method === 'POST' ? await readBody(req) : {};
    if (route === 'POST /auth/exchange' && body.provider === 'github') {
      // Like the accounts server: swap the code with the client secret, read /user +
      // /user/emails, numeric id as sub, link only by a verified primary email.
      s.githubBodies.push(body);
      if (
        body.client !== 'app' ||
        typeof body.code !== 'string' ||
        typeof body.code_verifier !== 'string' ||
        !/^http:\/\/127\.0\.0\.1:\d+\/callback$/.test(body.redirect_uri || '')
      )
        return json(res, 400, { error: 'invalid_request' });
      if (s.githubDown) return json(res, 503, { error: 'github_unreachable' });
      const t = await (
        await fetch(ghBase + '/login/oauth/access_token', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: githubApp.clientId,
            client_secret: githubApp.clientSecret,
            code: body.code,
            redirect_uri: body.redirect_uri,
            code_verifier: body.code_verifier,
          }),
        })
      ).json();
      if (!t.access_token) return json(res, 401, { error: 'github_code_invalid' });
      const get = async p =>
        (
          await fetch(ghBase + '/api' + p, {
            headers: { Authorization: 'Bearer ' + t.access_token },
          })
        ).json();
      const [u, emails] = await Promise.all([get('/user'), get('/user/emails')]);
      const primary = (emails || []).find(e => e.primary && e.verified);
      const id = primary
        ? 'u_mail_' + crypto.createHash('sha256').update(primary.email).digest('hex').slice(0, 8)
        : 'u_gh_' + u.id;
      return issue(
        res,
        route,
        body,
        id,
        {
          id,
          email: primary ? primary.email : null,
          name: u.name || u.login,
          providers: primary ? ['password', 'github'] : ['github'],
        },
        primary ? {} : { notice: 'github_no_verified_email' }
      );
    }
    if (route === 'POST /auth/exchange') {
      if (body.provider !== 'google' || body.client !== 'app' || typeof body.id_token !== 'string')
        return json(res, 400, { error: 'invalid_request' });
      let claims;
      try {
        claims = JSON.parse(Buffer.from(body.id_token.split('.')[1], 'base64url').toString());
      } catch {
        return json(res, 401, { error: 'invalid_token' });
      }
      if (claims.nonce !== body.nonce) return json(res, 401, { error: 'nonce_mismatch' });
      const id = 'u_' + claims.sub,
        user = { id, email: claims.email, name: claims.name, providers: ['google'] };

      // Like the real server: an account with an authenticator app gets no session, only a ticket
      // for POST /auth/totp/verify.
      if (claims.email === 'totp@example.com') {
        const t = 'totp-ticket-' + crypto.randomBytes(12).toString('hex');
        s.totpTickets.set(t, user);
        return json(res, 401, { error: 'totp_required', totp_ticket: t });
      }
      return issue(res, route, body, id, user);
    }
    if (route === 'POST /auth/totp/verify') {
      s.totpBodies.push({ keys: Object.keys(body).sort() });
      const user = s.totpTickets.get(body.totp_ticket);
      if (!user || body.client !== 'app') return json(res, 401, { error: 'invalid_ticket' });
      if (body.totp !== '123456' && body.recoveryCode !== 'abcde-fghij')
        return json(res, 401, { error: 'invalid_totp' });
      s.totpTickets.delete(body.totp_ticket);
      return issue(res, route, body, user.id, user);
    }
    if (route === 'POST /auth/login') {
      if (body.client !== 'app') return json(res, 400, { error: 'invalid_client' });
      if (body.password !== 'right-password')
        return json(res, 401, { error: 'invalid_credentials' });
      if (body.email === 'totp@example.com' && body.totp !== '123456')
        return json(res, 401, { error: body.totp ? 'invalid_totp' : 'totp_required' });
      const id = userIdOf(body.email);
      return issue(res, route, body, id, {
        id,
        email: body.email,
        name: '',
        providers: ['password'],
      });
    }
    if (route === 'POST /auth/device-replace') {
      s.replaceBodies.push({
        keys: Object.keys(body).sort(),
        device_id: body.device_id,
        replace_device: body.replace_device,
      });
      const t = s.tickets.get(body.device_ticket);
      if (!t || t.deviceId !== body.device_id) return json(res, 401, { error: 'invalid_ticket' });
      s.tickets.delete(body.device_ticket);
      const list = s.devices[t.id] || [],
        i = list.findIndex(d => d.id === body.replace_device);
      if (i < 0) return json(res, 400, { error: 'unknown_device' });
      list.splice(i, 1);
      for (const [tok, dev] of s.tokenDevice)
        // that computer's next /auth/refresh gets 401
        if (dev === body.replace_device && s.tokens.get(tok) === t.id) s.tokens.delete(tok);
      return grant(res, t.id, t.user, t.extra, body);
    }
    const who = s.tokens.get(bearer(req));
    if (route === 'POST /auth/logout') {
      const dev = s.tokenDevice.get(bearer(req));
      if (who && dev) s.devices[who] = (s.devices[who] || []).filter(d => d.id !== dev);
      s.tokens.delete(bearer(req));
      return json(res, 200, { ok: true });
    }
    if (!who) return json(res, 401, { error: 'not_signed_in' });

    // minVersion: the server's MIN_APP_VERSION (426 update_required below it; the app sends
    // X-TNAI-Version). Plain numeric compare, test only.
    s.lastVersion = req.headers['x-tnai-version'] || '';
    const older = (a, b) => {
      const x = String(a).split('.').map(Number),
        y = String(b).split('.').map(Number);
      for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
      return false;
    };
    if (
      s.minVersion &&
      (route === 'GET /entitlements' || route === 'POST /auth/refresh') &&
      (!s.lastVersion || older(s.lastVersion, s.minVersion))
    )
      return json(res, 426, { error: 'update_required', min_version: s.minVersion });

    // version: the account's entitlement_version (server item 6), only when a test set one; like an
    // older server otherwise (no field, no route).
    const ver = Number.isSafeInteger(s.version) ? { version: s.version } : {};
    if (route === 'GET /entitlements/version' && ver.version != null) return json(res, 200, ver);
    if (route === 'GET /entitlements') return json(res, 200, { pass: pass(who), ...ver });
    if (route === 'POST /auth/refresh') {
      s.tokens.delete(bearer(req));
      return json(res, 200, {
        token: newToken(who, s.tokenDevice.get(bearer(req))),
        pass: pass(who),
      });
    }
    if (route === 'POST /app/login-link')
      return json(res, 200, {
        url:
          base +
          '/site/account.html?code=one-time&' +
          (body.next === 'upgrade' ? 'upgrade=pro' : 'x=1'),
      });
    json(res, 404, { error: 'not_found' });
  });

  // Scripted "system browser": follows redirects, stops at the last page. Website pages are only
  // recorded.
  async function browse(url) {
    let next = url;
    for (let i = 0; i < 8; i++) {
      const r = await fetch(next, { redirect: 'manual' });
      if (r.status >= 300 && r.status < 400) {
        next = new URL(r.headers.get('location'), next).toString();
        continue;
      }
      return {
        status: r.status,
        text: (await r.text())
          .replace(/<style[\s\S]*?<\/style>/g, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 200),
      };
    }
    return { status: 0 };
  }

  const ready = (async () => {
    provider = createFakeProvider({ google, github: githubApp });
    const issuer = await provider.start();
    ghBase = issuer + '/github';
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    base = 'http://127.0.0.1:' + server.address().port;
    Object.assign(process.env, {
      TNAI_ACCOUNTS_URL: base,
      TNAI_PASS_TEST_KEY: good.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      TNAI_GOOGLE_CLIENT_ID: google.clientId,
      TNAI_GOOGLE_CLIENT_SECRET: google.clientSecret,
      TNAI_AUTH_TEST_ISSUER: issuer + '/google',
      TNAI_GITHUB_CLIENT_ID: githubApp.clientId,
      TNAI_AUTH_TEST_GITHUB: ghBase,
    });
    T.setBrowser(async url => {
      browsed.push(url);
      if (url.startsWith(issuer))
        setTimeout(() => {
          browse(url).then(
            r => {
              lastBrowse = r;
            },
            e => {
              lastBrowse = { error: e.message };
            }
          );
        }, 30);
    });
    return { base };
  })();

  return {
    ready: () => ready,
    quiet: () => quiet.state(),
    set: patch => {
      Object.assign(s, patch);
      return true;
    },
    lastVersion: () => ({ sent: s.lastVersion, app: require('electron').app.getVersion() }),
    googlePlan: plan => {
      provider.plan('google', plan);
      return true;
    },
    githubPlan: plan => {
      provider.plan('github', plan);
      return true;
    },
    githubClient: on => {
      process.env.TNAI_GITHUB_CLIENT_ID = on ? githubApp.clientId : '';
      return true;
    },
    // What the app sent for GitHub: never a client secret or a GitHub token, only code + verifier +
    // loopback redirect.
    githubBodies: () =>
      s.githubBodies.map(b => ({
        keys: Object.keys(b).sort(),
        secret:
          JSON.stringify(b).includes(githubApp.clientSecret) || /gho-/.test(JSON.stringify(b)),
        verifier: String(b.code_verifier || '').length,
      })),
    // Computers: seed an account's other computers, read them back, expire every ticket, what each
    // app sign-in sent, this install's tnai-device.json.
    seedDevices: (email, list) => {
      s.devices[userIdOf(email)] = list.map(d => ({ ...d }));
      return true;
    },
    devicesOf: email => (s.devices[userIdOf(email)] || []).map(d => ({ ...d })),
    expireTickets: () => {
      s.tickets.clear();
      return true;
    },
    signIns: () => s.signIns.slice(),
    replaceBodies: () => s.replaceBodies.slice(),
    totpBodies: () => s.totpBodies.slice(),
    deviceFile: () => {
      const file = T.deviceFile();
      return fs.existsSync(file)
        ? { file: true, id: JSON.parse(fs.readFileSync(file, 'utf8')).id || '' }
        : { file: false, id: '' };
    },
    lastBrowse: () => lastBrowse,
    browsed: () => browsed.slice(),
    calls: () => s.calls.slice(),
    liveTokens: () => s.tokens.size,
    dropTokens: () => {
      s.tokens.clear();
      return true;
    }, // every app session ends on the server (this computer signed out)
    restart: () => T.restart(),
    // Release build (build-info.json) pretended in main: config snapshot, then back to a dev
    // copy in the same tick (no network call can start).
    releaseSnapshot: () => {
      const p = require('../../../package.json'),
        st = T.setRelease(true),
        c = T.config();
      T.setRelease(false);
      return {
        apiUrl: c.apiUrl,
        pkgUrl: String(p.tnaiAccountsUrl || '').replace(/\/+$/, ''),
        // accounts are switched off exactly when the build names no accounts server
        off: st.off === true,
        testKey: c.publicKey !== require('../../../desktop/plan-pass').PUBLIC_KEY,
        insecureOk: c.insecureOk,
      };
    },
    setHighWater: async ms => {
      await T.setHighWater(ms);
      return true;
    },
    highWater: () => T.highWater(),
    // What is on disk: the account file exists, and whether any issued app token or pass appears in
    // plain text.
    inspect: () => {
      const file = T.accountFile(),
        raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      return {
        file: !!raw,
        plain:
          s.issued.some(t => raw.includes(t)) ||
          /apptok-|EdDSA|"token"/.test(raw) ||
          raw.includes(b64url(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' }))),
      };
    },
    close: () => {
      server.close();
      provider.stop();
      return true;
    },
  };
};
