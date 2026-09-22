# Beli API (unofficial) - reference

Beli has **no public API**. This skill uses community reverse-engineering of
Beli's own backend: the [ProjectBarks/beli-api](https://github.com/projectbarks/beli-api)
hand-written OpenAPI 3.1 spec (MIT, 140 operations, refreshed ~Aug 2026),
which was itself built from observed app traffic. A second project,
[jcjc-dev/beli-mcp](https://github.com/jcjc-dev/beli-mcp), independently
reverse-engineered the same backend from the Android app and agrees on the
auth shape.

## Backend transport

Google Cloud Run hosts:

| Host | Base URL | Used for |
|---|---|---|
| ONBOARD | `https://backoffice-service-onboarding-t57o3dxfca-nn.a.run.app` | login, token refresh, own profile |
| API | `https://backoffice-service-t57o3dxfca-nn.a.run.app` | all other reads |
| RECS | `https://backoffice-service-recs-t57o3dxfca-nn.a.run.app` | recommendations (not wired) |
| ACTIVITY | `https://activity-service-978733420956.northamerica-northeast1.run.app` | telemetry (not wired) |

Mandatory on every request (Beli 403s otherwise):
`User-Agent: <any realistic browser string>` and an `Origin` header (any
value; the community client uses `capacitor://localhost`). Trailing slashes
are mandatory. Space requests ~400ms apart; bursts and rapid repeated logins
are throttled.

## Auth

`POST {ONBOARD}/api/token/` with `{"email": "...", "password": "..."}`
(`phone_no` works instead of `email`) returns `{"access": "<jwt>",
"refresh": "<token>"}`. There is no API key or app secret.

| Token | Lifetime | Notes |
|---|---|---|
| access | 20 minutes | `Authorization: Bearer <token>`; `user_id` claim holds her uuid |
| refresh | 7 days, not rotated | `POST {ONBOARD}/api/token/refresh/` with `{"refresh": "..."}` returns a fresh `{"access": "..."}` |

The CLI prefers the refresh token and falls back to password login only when
it is dead. One silent refresh + one retry on 401, never a loop.

**Beli is app-only** (iOS/Android; beliapp.com is a marketing page with no
login), so there is no DevTools session-token grab. Credentials are her real
Beli account email/phone + password, supplied through the secure-entry flow
into env only (`BELI_EMAIL` / `BELI_PASSWORD`, or a minted
`BELI_REFRESH_TOKEN`). `beli login` mints the refresh token and prints it to
stdout once for her to copy. Never commit credentials, never save them to
files or memory.

## Read endpoints the CLI wires

| Method | Endpoint | CLI | Notes |
|---|---|---|---|
| GET | `{ONBOARD}/api/user/logged-in/` | `me` | her profile, incl. uuid |
| GET | `{API}/api/get-ranking/?user=<uuid>&category=RES` | `ranked` | her ranked restaurants; `category` is required (`RES` = restaurants); `{results: [...]}` envelope; large lists come back whole, no working pagination |
| GET | `{API}/api/get-bookmark/` | `bookmarks` | her want-to-try list; no params |
| GET | `{API}/api/search-app/?term=<q>&city=<city>` | `search` | `coords` and `user` also accepted, optional |
| GET | `{API}/api/business/?id=<businessId>` | `restaurant` | full detail; does NOT embed friend scores |
| GET | `{API}/api/scores/{uuid}/{id}/` | `scores` | her score + friends' scores for one business; fetch once and filter client-side |
| GET | `{API}/api/your-newsfeed-data/{uuid}/` | `feed` | friends' recent activity |
| GET | `{API}/api/following/{uuid}/`, `{API}/api/followers/{uuid}/` | `friends` | social graph |

Response shapes are community-documented, not contract-guaranteed; the CLI
picks fields defensively (`summarizeBusiness`) and prints raw JSON for
`restaurant` / `scores` so nothing is lost.

## Verified-but-not-wired reads (roadmap)

`getUserScores` (`/api/user-scores/{uuid}/`), `getUserScoresCached`,
`getScoreAverage` (`/api/score-average/{uuid}/ALL/`),
`getBusinessFriendText` (`/api/business-friend-text/{uuid}/{id}/`),
`getPopularInCity`, `getTrending`, `getMutualBookmarks`
(`/api/mutual-bookmarks/{uuid1},{uuid2}/`), `getSharedMeals`,
`getPublishedList` / `getPublishedListByUser` (her public lists),
`getShortList`, `getLeaderboard`. Each needs one live run against her account
before being documented as supported.

## Known flaky / off-limits

- `/api/followers/` and `/api/average-score/` return 503 intermittently
  (community-observed).
- Do not invent endpoint names: the spec's `Allow` headers hint at writes the
  app never exercised; none are wired.
- Writes (documented, NOT wired): ranking is a three-step sequence -
  `POST {API}/api/add-ranking/` then `/api/process-add-ranking/` then
  `/api/check-share-post-rank/`, body
  `{"category":"RES","user_id":"<uuid>","business_id":<id>,"value":<seed>,...}`.
  Bookmark add/remove and follow/unfollow exist too. All deliberately excluded
  from the CLI; each would need her explicit per-action approval.

## Hard limitations

- **Read-only.** The CLI cannot rank, bookmark, follow, or react.
- **Unofficial.** Endpoints can change or break without notice; keep calls
  minimal and treat failures as "Beli changed something".
- **ToS gray area.** Her own credentials against undocumented endpoints.
  Fine for her personal use; don't build a commercial product on it.
