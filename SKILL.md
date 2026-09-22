---
name: "beli"
description: "Work with the user's Beli data: her ranked restaurant list, want-to-try bookmarks, restaurant search, her and friends' ratings for a restaurant, and her activity feed. Triggers on Beli, restaurant rankings, want-to-try lists, and friends' restaurant ratings."
metadata: { "includeInPrompt": true }
---

# Beli

## Purpose
Read the user's Beli data: her profile, her ranked restaurant list, her
want-to-try bookmarks, restaurant search results, her and her friends' ratings
for a restaurant, and her friends' recent activity. Beli has **no public API**,
so this skill talks to Beli's own backend through community
reverse-engineering (ProjectBarks/beli-api, MIT). Everything here is
read-only.

## Tooling
Helper CLI at `bin/beli.mjs` (run from this skill's directory). All output is
JSON. No npm dependencies - direct fetch only.

- `node bin/beli.mjs login` - mint a 7-day refresh token from
  `BELI_EMAIL` + `BELI_PASSWORD`. Prints the token to stdout once for her to
  copy into `BELI_REFRESH_TOKEN`. Treat it like a password.
- `node bin/beli.mjs me` - her profile.
- `node bin/beli.mjs ranked [--limit N]` - her ranked restaurants
  (`category=RES`).
- `node bin/beli.mjs bookmarks [--limit N]` - her want-to-try list.
- `node bin/beli.mjs search <term> [--city CITY]` - restaurant search.
- `node bin/beli.mjs restaurant <businessId>` - restaurant detail.
- `node bin/beli.mjs scores <businessId>` - her score plus friends' scores
  for one restaurant.
- `node bin/beli.mjs feed [--limit N]` - friends' recent activity.
- `node bin/beli.mjs friends [--followers] [--limit N]` - people she follows
  (or her followers).

Business IDs come from `search` / `ranked` / `bookmarks` output.

## Transport
Four Cloud Run hosts (community-verified; Beli migrated here from an older
backend):

- Auth + profile: `https://backoffice-service-onboarding-t57o3dxfca-nn.a.run.app`
- Everything else read: `https://backoffice-service-t57o3dxfca-nn.a.run.app`
- (Unused: recs and activity hosts.)

Every request carries a browser-like `User-Agent` and an `Origin` header -
Beli 403s anything that does not look like a browser. Requests are spaced
~400ms apart; Beli throttles bursts and throttles rapid repeated logins.
Trailing slashes on paths are mandatory.

Auth flow (handled inside the CLI): `POST /api/token/` with
`{email, password}` (or `{phone_no, password}`) returns
`{access, refresh}`. Access tokens last 20 minutes, refresh tokens last
7 days and are not rotated. The CLI prefers the refresh token
(`POST /api/token/refresh/` with `{refresh}`) and falls back to a password
login only when the refresh token is dead. On a 401 it does one silent
refresh and one retry - never a loop. The user uuid for `{uuid}` path params
is decoded from the access JWT's `user_id` claim.

## Auth
`BELI_REFRESH_TOKEN` (preferred, 7 days) or `BELI_EMAIL` + `BELI_PASSWORD`
in env. Beli is app-only - there is no web app, so there is no DevTools
token-grab like Partiful; the password is her actual Beli account login and
must come through the secure-entry flow, never chat. Never write any
credential to files or memory; env only. On expiry, mint a fresh refresh
token with `beli login` - do not hammer the login endpoint.

## Operating Rules
- This skill is **read-only**: ranking a restaurant, bookmarking, following,
  and reacting are not supported. The write sequence is community-documented
  (three-step add-ranking) but deliberately not wired. Say so plainly if
  asked.
- The API is unofficial and can break without notice; keep calls minimal and
  report breakage as "Beli changed something" rather than debugging deeply.
- Do not guess endpoint names or param shapes - use only what
  `references/api.md` documents as community-verified.
- **ToS gray area - personal use only.** This uses her own account credentials
  against undocumented endpoints. Fine for her personal use; do not build a
  commercial product on it or share the credential pattern beyond her account.

## Roadmap (not commands yet)
- Read backfill, community-verified but pending one live run each against her
  account: `getUserScores` (cached score list), `getBusinessFriendText`
  (friends' text takes on a restaurant), `getPopularInCity` / `getTrending`
  (city discovery), `getMutualBookmarks` (overlap with a friend).
- Write discovery is a separate milestone: the three-step ranking write is
  documented in `references/api.md` but each write needs her explicit
  per-action approval and re-verification in the Beli app afterward. Never
  auto-rank, auto-bookmark, or auto-follow.
