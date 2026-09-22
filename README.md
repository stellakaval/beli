# beli

A [Muse](https://muse.ai) skill that works with your Beli data: your ranked restaurant list, your want-to-try bookmarks, restaurant search, your and your friends' ratings for a restaurant, and your friends' recent activity.

Beli has **no public API**, so this skill talks to Beli's own backend through community reverse-engineering (the [ProjectBarks/beli-api](https://github.com/projectbarks/beli-api) project, MIT licensed). It is **read-only**: it cannot rank restaurants, add bookmarks, follow people, or post anything.

## Install

Requires Node.js 18+. No npm dependencies.

```bash
git clone <this repo>
cd beli
```

## Auth

Beli is app-only (there is no web app to grab a session token from), so auth uses your real Beli account login.

**Option A: refresh token (recommended, lasts 7 days)**

```bash
export BELI_EMAIL='you@example.com'       # or your phone number
export BELI_PASSWORD='...'                # via the secure-entry flow, never chat
node bin/beli.mjs login                   # prints a refresh token once
export BELI_REFRESH_TOKEN='<paste it>'
```

**Option B: email and password each session**

```bash
export BELI_EMAIL='you@example.com'
export BELI_PASSWORD='...'
```

The CLI prefers the refresh token and only logs in with your password when the refresh token is dead. Access tokens last 20 minutes and are renewed automatically. Never commit credentials, never write them to files. On a 401, mint a fresh refresh token with `beli login`.

## Usage

Run from this directory. All output is JSON.

```bash
node bin/beli.mjs me                                # your profile
node bin/beli.mjs ranked [--limit N]                # your ranked restaurants
node bin/beli.mjs bookmarks [--limit N]             # your want-to-try list
node bin/beli.mjs search "ramen" [--city "San Francisco, CA"]
node bin/beli.mjs restaurant <businessId>           # restaurant detail
node bin/beli.mjs scores <businessId>               # your score + friends' scores
node bin/beli.mjs feed [--limit N]                  # friends' recent activity
node bin/beli.mjs friends [--followers] [--limit N]
```

Business IDs come from `search`, `ranked`, or `bookmarks` output.

## Hard limits

- **Read-only.** Ranking, bookmarking, following, and reacting are not supported.
- **Unofficial.** Endpoints can change or break without notice. If a command fails, it likely means Beli changed something.
- **Personal use only.** This uses your own account credentials against undocumented endpoints. Do not build a commercial product on it.

## How it works

Direct HTTPS calls to Beli's Cloud Run backend with a browser-like User-Agent and Origin header (Beli rejects anything else), spaced ~400ms apart to respect throttling. See [`references/api.md`](references/api.md) for the endpoint table and auth details, and [`SKILL.md`](SKILL.md) for the full agent-facing spec.
