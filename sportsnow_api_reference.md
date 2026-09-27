# SportsNow / AOneRoom Sports API Reference

Last verified: 2026-09-20 (Africa/Accra)
Purpose: durable reference for the HMCinema SportsNow integration. This file records public web-app API discovery and tested response behavior. It does not contain signed stream query strings, cookies, tokens, credentials, or authorization values.

## Scope and verdict

SportsNow is delivered as a web app at https://sportsnow.top/. The production API used by the current web app is:

    https://h5-sport-api.aoneroom.com

The integration is feasible for live matches, upcoming matches, finished matches, live HLS, full-match replays, highlights, match detail, and text commentary. Stream URLs are temporary and must be fetched dynamically. The reliable HMCinema design is a backend adapter/proxy rather than direct browser calls to the upstream live HLS URL.

No HMCinema production files were modified during endpoint discovery.

## Core endpoints

All paths below are relative to the production API host.

### Match list

    GET /wefeed-h5api-bff/live/match-list-v5
    GET /wefeed-h5api-bff/live/match-list-v5?leagueId=0
    GET /wefeed-h5api-bff/live/match-list-v5?leagueId=<league-id>

The no-parameter and leagueId=0 forms returned the current general list. A league-specific request returned finished matches. Response shape:

    { code, message, data: { list: [...], hasMore } }

Observed status values:

    MatchIng       live
    MatchNotStart upcoming
    MatchEnded     finished

Observed match fields:

    id, team1, team2, status, playType, playPath, startTime, endTime,
    type, timeDesc, playSource, statusLive, league, liveDeviceId,
    teamMatchInfo1, teamMatchInfo2, matchResult, matchRound, replay,
    highlights, extCountryCode, leagueId, isCollect, arrangedTime, season,
    oddsList

The current list returned 18 items in one test (7 MatchIng and 11 MatchNotStart) with hasMore=true. A league-specific test returned 6 MatchEnded items with hasMore=true. Pagination parameters should be confirmed from the live page before implementing a full multi-page fetch.

### Match detail

    GET /wefeed-h5api-bff/sport/detail-v1?matchId=<match-id>

Response shape:

    { code, message, data: { match, newsList, currentStage } }

The detail match has the same playback fields as a list item. A live match test returned playPath, playSource, and highlights. An ended-match test returned replay and highlights.

### Text commentary

Initial page:

    GET /wefeed-h5api-bff/live/match-flow?id=<match-id>&pageSize=30&lastSort=0

Response data:

    { list, hasMore, lastSort }

Refresh for new entries:

    GET /wefeed-h5api-bff/live/match-flow-has-new?id=<match-id>&sort=<sort>

Response data:

    { hasNew, list }

Commentary list entries include id, content, broadcastName, sort, flowTime, crtOvers, crtMemberState, and createTime.

### Match highlights page endpoint

The current web bundle references:

    GET /wefeed-h5api-bff/live/match-highlights-v1

The page bundle passes an `id` parameter, but this endpoint returned PARAMS_ERROR/resource-not-found for the tested match id. Treat it as a separate highlight-page/resource endpoint, not as the primary source for a match detail. The match detail endpoint already returns the usable `highlights` array.

## Playback fields and behavior

### playPath

`playPath` is the primary live playback URL. Observed hosts included:

    live-pull.aisports.mobi

Observed path pattern (query strings intentionally omitted):

    /moviebox/<device-or-channel>/playlist.m3u8

The URL is signed/time-limited. Do not persist it as a permanent URL or print its query string. Fetch match detail/list data again when playback starts.

A live playPath test returned:

    HTTP 206
    Content-Type: application/vnd.apple.mpegurl

The live manifest allowed CORS (`*`) but enforced a SportsNow-style referer. Fetching with a SportsNow referer worked. A request using the HMCinema referer alone returned HTTP 403. A request with HMCinema Origin plus SportsNow Referer returned HTTP 206.

### playSource

`playSource` is an array of alternate sources, normally with title/id/path. Examples included CCTV pages, `play.88player.top`, and `play.sportsteam368.com`. Several entries are HTML player pages rather than direct HLS URLs. Treat them as alternate links/fallback pages, not as guaranteed direct streams.

### replay

Ended matches returned replay entries such as:

    { title: "Full Match Replay", path: "https://lacdn.aoneroom.com/replay/...mp4" }

Signed query strings, when present, must be redacted and not persisted. A tested replay returned HTTP 206 and `video/mp4`.

### highlights

Matches returned highlight entries such as:

    { title: "...", path: "https://lacdn.aoneroom.com/highlight/...mp4" }
    { title: "...", path: "https://lacdn.aoneroom.com/cuts/...mp4" }

A tested live highlight returned HTTP 206 and `video/mp4`. These CDN MP4 responses advertised permissive CORS in testing and should be easier to play directly than live HLS.

## Headers and browser access

The SportsNow browser sends client/device metadata. The API also worked in read-only testing with ordinary browser headers. For browser requests from the HMCinema production origin, the API responded with CORS for:

    Origin: https://hm-cinema.me

An OPTIONS preflight test returned:

    Access-Control-Allow-Origin: https://hm-cinema.me
    Access-Control-Allow-Credentials: true
    Access-Control-Allow-Methods: GET,POST,PUT,OPTIONS
    Access-Control-Allow-Headers: content-type,x-client-info,x-device-info

The backend adapter should still own upstream API calls so the UI does not depend on upstream CORS policy and so HLS manifests/segments can be fetched with the required SportsNow referer.

Do not fabricate or bypass authentication, subscription, gateway signatures, or CDN controls. Use only URLs and access returned for the authorized public/web-app flow.

## Supporting endpoints found in current web bundles

    GET  /wefeed-h5api-bff/live/league-tab
    GET  /wefeed-h5api-bff/sport/aggregate-v1
    GET  /wefeed-h5api-bff/live/vip-config
    GET  /wefeed-h5api-bff/vip/member/brief-info
    GET  /wefeed-h5api-bff/live/match-collect-list
    POST /wefeed-h5api-bff/live/match-collect
    POST /wefeed-h5api-bff/live/match-collect-cancel
    GET  /wefeed-h5api-bff/live/match-board-league
    GET  /wefeed-h5api-bff/live/league-ranking-list
    GET  /wefeed-h5api-bff/live/league-team-vote-list
    POST /wefeed-h5api-bff/live/league-team-vote
    GET  /wefeed-h5api-bff/live/activity/config
    GET  /wefeed-h5api-bff/live/activity/vote-info
    POST /wefeed-h5api-bff/live/activity/vote-chance/claim
    GET  /wefeed-h5api-bff/live/activity/ad-task-list
    GET  /wefeed-h5api-bff/live/activity/betting-ad-list
    POST /wefeed-h5api-bff/live/match-vote
    GET  /wefeed-h5api-bff/news/detail
    GET  /wefeed-h5api-bff/news/trending
    POST /wefeed-h5api-bff/news/trending-tag
    GET  /wefeed-h5api-bff/news/tags
    GET  /wefeed-h5api-bff/ad/get-config

These ancillary routes are not required for the basic HMCinema live/upcoming/replay integration.

## Recommended HMCinema adapter

1. Backend calls match-list-v5 and normalizes `data.list` into live/upcoming/ended groups.
2. Frontend requests `/api/sports/...` from HMCinema instead of the worker URLs.
3. Backend calls sport/detail-v1 on demand for a selected match.
4. Backend returns replay/highlight paths directly when they are public MP4 CDN paths.
5. Backend obtains live playPath on demand and proxies the manifest/segments if direct HLS playback receives 403.
6. Never cache signed playPath values longer than their valid lifetime.
7. Keep an upstream-error response that lets the frontend show unavailable rather than silently returning stale streams.
8. Keep the old worker code only as an explicit temporary fallback while production verification is performed; remove it after successful validation.

## Evidence commands used

The following read-only calls were verified on 2026-09-20:

    GET /live/match-list-v5
    GET /live/match-list-v5?leagueId=0
    GET /live/match-list-v5?leagueId=<league-id>
    GET /sport/detail-v1?matchId=<live-match-id>
    GET /live/match-flow?id=<live-match-id>&pageSize=30&lastSort=0
    GET /live/match-flow-has-new?id=<live-match-id>&sort=0
    GET /live/league-tab
    GET /live/vip-config

No signed URL, token, cookie, password, or private credential is stored in this reference.
