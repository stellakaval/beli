#!/usr/bin/env node
// beli CLI - read-only access to the user's Beli data.
//
// Beli has no public API. This talks to Beli's own backend using the community
// reverse-engineered contract (ProjectBarks/beli-api, MIT): four Cloud Run
// hosts, JWT auth, browser-like headers. See references/api.md.
//
// Auth: BELI_EMAIL + BELI_PASSWORD (her Beli account login), or
// BELI_REFRESH_TOKEN (7-day refresh token, minted once via `beli login`).
// Tokens live in env only - never written to files. `login` prints the refresh
// token to stdout exactly once for her to copy into her env.

const ONBOARD = 'https://backoffice-service-onboarding-t57o3dxfca-nn.a.run.app';
const API = 'https://backoffice-service-t57o3dxfca-nn.a.run.app';

// Beli 403s anything that does not look like a browser. Any realistic browser
// User-Agent passes; Origin just has to be present (community-verified).
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const ORIGIN = 'capacitor://localhost';

function usage() {
  console.error(`usage:
  beli login                             # mint a 7-day refresh token from BELI_EMAIL + BELI_PASSWORD (prints it once)
  beli me                                # her profile
  beli ranked [--limit N]                # her ranked restaurants
  beli bookmarks [--limit N]             # her want-to-try list
  beli search <term> [--city CITY]       # search restaurants
  beli restaurant <businessId>           # restaurant detail
  beli scores <businessId>               # her score + friends' scores for a restaurant
  beli feed [--limit N]                  # friends' recent activity
  beli friends [--followers] [--limit N] # people she follows (or her followers)

Auth: set BELI_REFRESH_TOKEN, or BELI_EMAIL + BELI_PASSWORD, in env.
All output is JSON.`);
  process.exit(2);
}

function creds() {
  const refresh = process.env.BELI_REFRESH_TOKEN || null;
  const email = process.env.BELI_EMAIL || null;
  const password = process.env.BELI_PASSWORD || null;
  if (!refresh && !(email && password)) {
    console.error('error: set BELI_REFRESH_TOKEN or BELI_EMAIL + BELI_PASSWORD. See references/api.md for how to get them.');
    process.exit(2);
  }
  return { refresh, email, password };
}

function flag(args, name, def) {
  const i = args.indexOf(name);
  if (i === -1) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}
function boolFlag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
}
function limitOf(args, def) {
  const v = parseInt(flag(args, '--limit', String(def)), 10);
  return Number.isFinite(v) && v > 0 ? v : def;
}

async function postJson(url, body, token) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      'Origin': ORIGIN,
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, {
      method: 'POST', signal: ctrl.signal, headers, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

// Read the user uuid from the access JWT's claims (no verification - just
// reading her own token). Needed for the {uuid} path params.
function decodeUserId(access) {
  try {
    const payload = access.split('.')[1];
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const claims = JSON.parse(json);
    return claims.user_id ?? claims.sub ?? null;
  } catch {
    return null;
  }
}

function loginBody(c) {
  const body = { password: c.password };
  if (!c.email.includes('@')) body.phone_no = c.email;
  else body.email = c.email;
  return body;
}

async function mintAccess(c) {
  // Prefer the refresh token (7 days, no password round trip). Fall back to a
  // full login only when the refresh token is missing or dead.
  if (c.refresh) {
    const { status, data } = await postJson(`${ONBOARD}/api/token/refresh/`, { refresh: c.refresh });
    if (status === 200 && data.access) return { access: data.access, refreshed: true };
  }
  if (c.email && c.password) {
    const { status, data } = await postJson(`${ONBOARD}/api/token/`, loginBody(c));
    if (status === 200 && data.access) return { access: data.access, refreshed: false, refresh: data.refresh || null };
    if (status === 401 || status === 400) {
      console.error('error: Beli rejected the login (bad credentials or throttled after rapid logins). Check BELI_EMAIL/BELI_PASSWORD and retry once.');
      process.exit(1);
    }
    console.error(`error: Beli login returned ${status}. The endpoint may have moved - see references/api.md.`);
    process.exit(1);
  }
  console.error('error: the refresh token is dead and no BELI_EMAIL + BELI_PASSWORD is set. Log in again to mint a fresh refresh token.');
  process.exit(1);
}

let lastCall = 0;
async function throttledGet(url, access, retried = false, refreshToken = null) {
  // Beli throttles bursts: keep ~400ms between requests (community-verified).
  const wait = Math.max(0, 400 - (Date.now() - lastCall));
  if (wait) await new Promise((r) => setTimeout(r, wait));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'Authorization': `Bearer ${access}`,
        'User-Agent': USER_AGENT,
        'Origin': ORIGIN,
      },
    });
    lastCall = Date.now();
    if (res.status === 401 && !retried && refreshToken) {
      // One silent refresh, then one retry - never a loop.
      const { status, data } = await postJson(`${ONBOARD}/api/token/refresh/`, { refresh: refreshToken });
      if (status === 200 && data.access) return throttledGet(url, data.access, true, refreshToken);
    }
    if (res.status === 401 || res.status === 403) {
      console.error('error: Beli rejected the token (401/403). The session expired - mint a fresh refresh token with `beli login` and retry once.');
      process.exit(1);
    }
    if (!res.ok) {
      console.error(`error: Beli returned ${res.status}. The endpoint may have moved - see references/api.md.`);
      process.exit(1);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Defensive field picker: response shapes are community-documented, not
// contract-guaranteed, so try several names before giving up.
function pick(obj, names) {
  for (const n of names) {
    const v = obj?.[n];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

function summarizeBusiness(b) {
  const biz = b.business ?? b;
  return {
    id: pick(biz, ['id', 'business_id']),
    name: pick(biz, ['name', 'title']),
    score: pick(b, ['value', 'score', 'avg_score', 'average_score']),
    city: pick(biz, ['city', 'city_name']),
    cuisine: pick(biz, ['cuisine', 'cuisines', 'default_category']),
    price: pick(biz, ['price', 'price_range']),
  };
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd) usage();

try {
  if (cmd === 'login') {
    const c = creds();
    if (!c.email || !c.password) {
      console.error('error: login needs BELI_EMAIL + BELI_PASSWORD to mint the first refresh token.');
      process.exit(2);
    }
    const { status, data } = await postJson(`${ONBOARD}/api/token/`, loginBody(c));
    if (status !== 200 || !data.refresh) {
      console.error(`error: Beli login failed (${status}). Check the email/password and retry once; rapid repeated logins are throttled.`);
      process.exit(1);
    }
    // The refresh token goes to stdout alone so she can copy it into her env.
    // Everything explanatory goes to stderr. Treat it like a password.
    console.error('Logged in. Copy the token below into BELI_REFRESH_TOKEN (valid 7 days). Do not share it.');
    process.stdout.write(data.refresh + '\n');
    process.exit(0);
  }

  const c = creds();
  const { access } = await mintAccess(c);
  const userId = decodeUserId(access);
  if (!userId) {
    console.error('error: could not read the user id from the access token. Grab a fresh token and retry.');
    process.exit(2);
  }
  const get = (path) => throttledGet(`${API}${path}`, access, false, c.refresh);
  const getOnboard = (path) => throttledGet(`${ONBOARD}${path}`, access, false, c.refresh);

  if (cmd === 'me') {
    const me = await getOnboard('/api/user/logged-in/');
    console.log(JSON.stringify(me, null, 2));
  } else if (cmd === 'ranked') {
    const limit = limitOf(rest, 50);
    const data = await get(`/api/get-ranking/?user=${userId}&category=RES`);
    const rows = Array.isArray(data?.results) ? data.results : [];
    console.log(JSON.stringify({
      count: rows.length,
      restaurants: rows.slice(0, limit).map(summarizeBusiness),
    }, null, 2));
  } else if (cmd === 'bookmarks') {
    const limit = limitOf(rest, 50);
    const data = await get('/api/get-bookmark/');
    const rows = Array.isArray(data?.results) ? data.results : (Array.isArray(data) ? data : []);
    console.log(JSON.stringify({
      count: rows.length,
      restaurants: rows.slice(0, limit).map(summarizeBusiness),
    }, null, 2));
  } else if (cmd === 'search') {
    const city = flag(rest, '--city', null);
    const [term] = rest;
    if (!term) usage();
    const q = new URLSearchParams({ term });
    if (city) q.set('city', city);
    const data = await get(`/api/search-app/?${q.toString()}`);
    const rows = Array.isArray(data?.results) ? data.results : (Array.isArray(data) ? data : []);
    console.log(JSON.stringify(rows.slice(0, 20).map(summarizeBusiness), null, 2));
  } else if (cmd === 'restaurant') {
    const [id] = rest;
    if (!id) usage();
    const data = await get(`/api/business/?id=${encodeURIComponent(id)}`);
    console.log(JSON.stringify(data, null, 2));
  } else if (cmd === 'scores') {
    const [id] = rest;
    if (!id) usage();
    const data = await get(`/api/scores/${userId}/${encodeURIComponent(id)}/`);
    console.log(JSON.stringify(data, null, 2));
  } else if (cmd === 'feed') {
    const limit = limitOf(rest, 20);
    const data = await get(`/api/your-newsfeed-data/${userId}/`);
    const rows = Array.isArray(data?.results) ? data.results : (Array.isArray(data) ? data : []);
    console.log(JSON.stringify(rows.slice(0, limit), null, 2));
  } else if (cmd === 'friends') {
    const followers = boolFlag(rest, '--followers');
    const limit = limitOf(rest, 50);
    const data = await get(followers ? `/api/followers/${userId}/` : `/api/following/${userId}/`);
    const rows = Array.isArray(data?.results) ? data.results : (Array.isArray(data) ? data : []);
    console.log(JSON.stringify(rows.slice(0, limit).map((u) => ({
      id: pick(u, ['uuid', 'id']),
      username: pick(u, ['username', 'name']),
      name: pick(u, ['display_name', 'full_name']),
    })), null, 2));
  } else {
    usage();
  }
} catch (e) {
  console.error('error:', e?.message ?? String(e));
  process.exit(1);
}
