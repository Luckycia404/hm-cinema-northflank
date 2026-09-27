// ─── LIVE SPORTS — SportsNow / AOneRoom integration ───────────────────────────
const SPORTSNOW_API = 'https://h5-sport-api.aoneroom.com';
const SPORTSNOW_MATCH_LIST = SPORTSNOW_API + '/wefeed-h5api-bff/live/match-list-v5';
const SPORTSNOW_MATCH_DETAIL = SPORTSNOW_API + '/wefeed-h5api-bff/sport/detail-v1?matchId=';

function sportsNowPlaybackUrl(rawUrl) {
    if (typeof rawUrl !== 'string' || !rawUrl) return '';
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === 'https:' && parsed.hostname === 'live-pull.aisports.mobi') {
            return '/api/sportsnow/stream?url=' + encodeURIComponent(parsed.toString());
        }
    } catch (_) {}
    return rawUrl;
}

function sportsNowClipUrl(rawUrl) {
    if (typeof rawUrl !== 'string' || !rawUrl) return '';
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === 'https:' && parsed.hostname === 'lacdn.aoneroom.com') {
            return '/api/sportsnow/clip?url=' + encodeURIComponent(parsed.toString());
        }
    } catch (_) {}
    return '';
}

function sportsNowClipItems(value, kind) {
    if (!Array.isArray(value)) return [];
    return value.map((item, index) => {
        const row = item && typeof item === 'object' ? item : {};
        const url = sportsNowClipUrl(row.path || row.url || '');
        if (!url) return null;
        return {
            title: String(row.title || ((kind === 'replay' ? 'Replay' : 'Highlight') + ' ' + (index + 1))),
            url,
            kind: 'clip',
            duration: row.duration != null ? String(row.duration) : '',
            cover: row.cover && typeof row.cover.url === 'string' ? row.cover.url : ''
        };
    }).filter(Boolean);
}

async function fetchSportsNowMatches(signal) {
    const res = await fetch(SPORTSNOW_MATCH_LIST, { signal, cache: 'no-store' });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload || !payload.data) {
        throw new Error('SportsNow match list unavailable');
    }
    const data = payload.data;
    return {
        list: Array.isArray(data.list) ? data.list : [],
        hasMore: Boolean(data.hasMore)
    };
}

async function fetchSportsNowMatch(matchId) {
    const res = await fetch(SPORTSNOW_MATCH_DETAIL + encodeURIComponent(matchId), { cache: 'no-store' });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload || !payload.data) {
        throw new Error('SportsNow match detail unavailable');
    }
    return payload.data.match || payload.data;
}

function sportsNowTimestamp(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : NaN;
}

function sportsNowIsoTime(value) {
    const timestamp = sportsNowTimestamp(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

function sportsNowTeam(team) {
    const t = team && typeof team === 'object' ? team : {};
    return {
        name: String(t.name || t.nameI18n || team || ''),
        logo: typeof t.avatar === 'string' ? t.avatar : '',
        score: t.score != null ? t.score : (t.regularScore != null ? t.regularScore : '')
    };
}

function sportsNowStatus(match) {
    const status = String(match && match.status || '');
    if (status === 'MatchIng') return 'live';
    if (status === 'MatchNotStart') return 'upcoming';
    if (status === 'MatchEnded') return 'finished';
    const start = sportsNowTimestamp(match && match.startTime);
    return Number.isFinite(start) && start > Date.now() ? 'upcoming' : 'scheduled';
}

// SportsNow provides a signed primary HLS playPath. playSource entries are often
// third-party web pages, so they are retained as metadata but not offered as HLS
// quality buttons in the player.
function normalizeSportsNowMatch(m) {
    if (!m || typeof m !== 'object') return m;
    const status = sportsNowStatus(m);
    const playPath = typeof m.playPath === 'string' ? m.playPath : '';
    const streamList = playPath ? [{ title: 'Live stream', url: sportsNowPlaybackUrl(playPath), kind: 'hls' }] : [];
    const replayItems = sportsNowClipItems(m.replay, 'replay');
    const highlightItems = sportsNowClipItems(m.highlights, 'highlight');
    const minute = m.timeDesc ? String(m.timeDesc) : (status === 'live' ? 'LIVE' : '');
    return {
        ...m,
        id: String(m.id || ''),
        homeTeam: sportsNowTeam(m.team1),
        awayTeam: sportsNowTeam(m.team2),
        league: String(m.league || ''),
        status,
        startTime: sportsNowIsoTime(m.startTime),
        streamUrl: sportsNowPlaybackUrl(playPath),
        _streamList: streamList,
        _playSources: Array.isArray(m.playSource) ? m.playSource : [],
        _replayItems: replayItems,
        _highlightItems: highlightItems,
        replayItems,
        highlightItems,
        minute,
        _sportsNow: true
    };
}

let sportsHls = null;
let currentSportsFilter = 'all';
let sportsLoaded = false;
let sportsAutoRefreshTimer = null;
const SPORTS_AUTO_REFRESH_MS = 30000; // 30s — keeps live scores fresh

// Silent refresh: re-fetch + re-render without flashing the loading spinner.
async function autoRefreshSports() {
    if (document.hidden) return; // tab in background — skip
    const sportsPage = document.getElementById('sportsPage');
    if (!sportsPage || sportsPage.style.display === 'none') return;
    await loadSports(null, currentSportsFilter, /*silent=*/true);
}

function startSportsAutoRefresh() {
    stopSportsAutoRefresh();
    sportsAutoRefreshTimer = setInterval(autoRefreshSports, SPORTS_AUTO_REFRESH_MS);
}
function stopSportsAutoRefresh() {
    if (sportsAutoRefreshTimer) { clearInterval(sportsAutoRefreshTimer); sportsAutoRefreshTimer = null; }
}

function showSportsPage() {
    document.getElementById('homePage').style.display = 'none';
    document.getElementById('searchPage').style.display = 'none';
    document.getElementById('sportsPage').style.display = 'block';
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;
    if (!sportsLoaded) {
        loadSports(document.querySelector('.sports-tab.active'), 'all');
    } else {
        // Already loaded earlier — pull a fresh snapshot now so scores aren't stale
        autoRefreshSports();
    }
    startSportsAutoRefresh();
}

// Auto-load the homepage Live Sports rail (live + upcoming, max 12)
async function loadHomeSportsRail() {
    const section = document.getElementById('liveSportsRail');
    const rail    = document.getElementById('sportsRail');
    if (!section || !rail) return;

    // Skeleton placeholders while loading
    rail.innerHTML = Array.from({length: 6}, () =>
        '<div class="srail-card srail-skeleton">' +
        '  <div class="srail-skel-line srail-skel-line-sm"></div>' +
        '  <div class="srail-skel-teams">' +
        '    <div class="srail-skel-circle"></div>' +
        '    <div class="srail-skel-line srail-skel-line-md"></div>' +
        '    <div class="srail-skel-circle"></div>' +
        '  </div>' +
        '  <div class="srail-skel-line srail-skel-btn"></div>' +
        '</div>'
    ).join('');
    section.style.display = 'block';

    try {
        const _ctrl1 = new AbortController();
        const _t1 = setTimeout(() => _ctrl1.abort(), 8000);
        const result = await fetchSportsNowMatches(_ctrl1.signal);
        clearTimeout(_t1);
        let matches = result.list;

        // Treat as live ONLY when:
        //   - upstream status says so AND
        //   - the match isn't already over (FT/AET/long-elapsed) AND
        //   - upstream is actually serving a stream URL.
        // Live matches without a stream URL are useless on the homepage rail —
        // the "Watch Live" button can't render and users complain that live
        // matches "have no watch button". Hide them here; the full sports page
        // still shows them with score updates so info isn't lost.
        matches = matches.map(normalizeSportsNowMatch);
        const live = matches.filter(m =>
            m.status === 'live' && !sportsIsFinished(m)
        );
        const upcoming = matches.filter(m => m.status === 'upcoming');
        const ordered  = [...live, ...upcoming].slice(0, 12);

        if (!ordered.length) {
            section.style.display = 'none';
            return;
        }

        rail.innerHTML = ordered.map(buildRailCard).join('');
    } catch (e) {
        // Fail silently — don't break the homepage if the football service is down
        section.style.display = 'none';
    }
}

// A match is "finished" when:
//   1) its minute marker says so (FT/AET/PEN/FULL TIME/etc), OR
//   2) it started long enough ago that it can't realistically still be live.
// The second check is the important one — upstream frequently leaves
// status="live" stuck for hours after a match ends (e.g. Arsenal still showing
// "live, 90'" two hours after kickoff), so we use startTime as a tripwire.
const FINISHED_MINUTES = ['FT','AET','PEN','FT (PEN)','HT (?)','FULL TIME','ENDED','FINISHED'];

// 2h30m covers a regulation football match (90 + 15 HT + ~10 injury) plus
// generous slack, and most basketball/hockey games. The very rare cup match
// that goes to extra time + penalties may drop off ~15min early; that's an
// acceptable trade vs. ended matches lingering on the homepage.
const SPORTS_MAX_DURATION_MS = 2.5 * 60 * 60 * 1000;

function sportsIsFinished(m) {
    if (!m) return false;
    if (m.status === 'finished') return true;
    // Trust the upstream status for live/halftime matches.
    // Only force-finish after 3 h (handles extreme extra-time or stale data).
    if (m.status === 'live' || m.status === 'halftime') {
        const started = sportsNowTimestamp(m.startTime);
        if (Number.isFinite(started) && Date.now() - started > 3 * 60 * 60 * 1000) return true;
        return false;
    }
    // For finished/unknown statuses, check minute string and elapsed time.
    const min = String(m.minute || '').toUpperCase().trim();
    if (min) {
        if (FINISHED_MINUTES.includes(min)) return true;
        if (/\bFT\b|\bAET\b|\bPEN\b|FULL\s*TIME|ENDED|FINISHED/.test(min)) return true;
    }
    const started = sportsNowTimestamp(m.startTime);
    if (Number.isFinite(started) && Date.now() - started > SPORTS_MAX_DURATION_MS) return true;
    return false;
}

// HTML-escape any text from the API before injecting into innerHTML
function srailEscape(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
// Allow only http(s) URLs for images/streams to block javascript: URIs etc.
function srailSafeUrl(u) {
    if (typeof u !== 'string') return '';
    return /^https?:\/\//i.test(u) ? u : '';
}

// ── SportsNow normalization is defined near the API adapter above. ───────────

let _lsmAllStreams = []; // track all quality options for current modal

function pickBestStream(streams) {
    if (!Array.isArray(streams) || !streams.length) return '';
    // Auto-select stable quality: SD > MD > HD2+ > HD1 (HD1 720 is often unstable)
    // Handles titles with or without spaces: "HD1", "HD 1", "HD 1 720p" etc.
    const isHD1 = t => /^HD\s*1(\s|$)/i.test(t);
    const rank = s => {
        const t = (s.title || '').toUpperCase().trim();
        if (t.startsWith('SD')) return 0;
        if (t.startsWith('MD')) return 1;
        if (t.startsWith('HD') && !isHD1(t)) return 2; // HD2, HD3 etc
        if (t.startsWith('HD')) return 3; // HD1 — last resort
        return 4;
    };
    const sorted = [...streams].sort((a, b) => rank(a) - rank(b));
    return sorted[0].proxy || sorted[0].url || '';
}

function buildRailCard(m) {
    if (!m || typeof m !== 'object') return '';
    const home = m.homeTeam || {};
    const away = m.awayTeam || {};
    const homeName = srailEscape(home.name || 'Home');
    const awayName = srailEscape(away.name || 'Away');
    const league   = srailEscape(m.league || 'Match');

    const isLive     = m.status === 'live' || m.status === 'halftime';
    const isUpcoming = m.status === 'upcoming';
    const rawStatus  = isLive
        ? (m.status === 'halftime' ? 'HT' : (m.minute || 'LIVE'))
        : isUpcoming ? 'UPCOMING' : String(m.status || '').toUpperCase();
    const statusLabel = srailEscape(rawStatus);
    const statusClass = isLive ? 'srail-live' : isUpcoming ? 'srail-upcoming' : 'srail-finished';

    const placeholder = '<div class="srail-logo srail-logo-ph"><i class="fas fa-shield-alt"></i></div>';
    const homeLogoUrl = srailSafeUrl(home.logo);
    const awayLogoUrl = srailSafeUrl(away.logo);
    const homeLogo = homeLogoUrl
        ? '<img src="' + srailEscape(homeLogoUrl) + '" alt="" class="srail-logo" onerror="this.outerHTML=\'<div class=&quot;srail-logo srail-logo-ph&quot;><i class=&quot;fas fa-shield-alt&quot;></i></div>\'">'
        : placeholder;
    const awayLogo = awayLogoUrl
        ? '<img src="' + srailEscape(awayLogoUrl) + '" alt="" class="srail-logo" onerror="this.outerHTML=\'<div class=&quot;srail-logo srail-logo-ph&quot;><i class=&quot;fas fa-shield-alt&quot;></i></div>\'">'
        : placeholder;

    // API returns scores as strings ("1") — coerce to number; default to 0 only if missing/NaN
    const _hs = Number(home.score), _as = Number(away.score);
    const homeScore = Number.isFinite(_hs) ? _hs : 0;
    const awayScore = Number.isFinite(_as) ? _as : 0;
    const center = isLive
        ? '<div class="srail-score">' + homeScore + '<span>:</span>' + awayScore + '</div>'
        : isUpcoming && m.startTime
            ? '<div class="srail-kickoff">' + srailEscape(formatKickoff(m.startTime)) + '</div>'
            : '<div class="srail-vs">VS</div>';

    const _rmid = srailEscape(String(m.id || m.fixture || ''));
    const _rtitle = srailEscape(String(home.name||'Home') + ' vs ' + String(away.name||'Away'));
    const _rleague = srailEscape(typeof m.league === 'string' ? m.league : (m.league && m.league.name ? m.league.name : ''));
    const _hasHighlights = Array.isArray(m.highlightItems || m.highlights) && (m.highlightItems || m.highlights).length > 0;
    const action = isLive
        ? '<button class="srail-watch" data-mid="' + _rmid + '" data-title="' + _rtitle + '" data-league="' + _rleague + '" onclick="watchFootballById(this.dataset.mid,this.dataset.title,this.dataset.league)">' +
            '<i class="fas fa-play"></i> Watch Live</button>'
        : !isUpcoming && _hasHighlights
            ? '<div class="srail-actions">' +
                '<button class="srail-watch" data-mid="' + _rmid + '" data-title="' + _rtitle + '" data-league="' + _rleague + '" onclick="watchSportsClipsById(this.dataset.mid,this.dataset.title,this.dataset.league,&quot;highlight&quot;)"><i class="fas fa-film"></i> Highlights</button>' +
              '</div>'
            : '<button class="srail-watch srail-watch-disabled" onclick="showSportsPage();return false;">'+
                (isUpcoming ? '<i class="far fa-clock"></i> Upcoming' : '<i class="fas fa-info-circle"></i> Details') + '</button>';

    return '<div class="srail-card ' + (isLive ? 'srail-card-live' : '') + '">' +
        '<div class="srail-top">' +
            '<span class="srail-league" title="' + league + '">' + league + '</span>' +
            '<span class="srail-status ' + statusClass + '">' + (isLive ? '<span class="srail-pulse"></span>' : '') + statusLabel + '</span>' +
        '</div>' +
        '<div class="srail-body">' +
            '<div class="srail-side">' + homeLogo + '<span class="srail-name">' + homeName + '</span></div>' +
            center +
            '<div class="srail-side">' + awayLogo + '<span class="srail-name">' + awayName + '</span></div>' +
        '</div>' +
        action +
    '</div>';
}

// Kick the rail off as soon as the page is interactive
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadHomeSportsRail);
} else {
    loadHomeSportsRail();
}
// Refresh the rail every 30s so live scores stay fresh (skip when tab hidden)
setInterval(() => { if (!document.hidden) loadHomeSportsRail(); }, 30000);

async function loadSports(tabEl, filter, silent) {
    currentSportsFilter = filter;
    if (tabEl) {
        document.querySelectorAll('.sports-tab').forEach(t => t.classList.remove('active'));
        tabEl.classList.add('active');
    }

    const grid = document.getElementById('sportsGrid');
    const bar  = document.getElementById('sportsStatusBar');
    // Silent (auto-refresh) mode keeps the existing grid visible until new data arrives
    if (!silent) {
        grid.innerHTML = '<div class="loading"><div class="spinner"></div><div>Loading matches…</div></div>';
        bar.style.display = 'none';
    }

    try {
        const _ctrl2 = new AbortController();
        const _t2 = setTimeout(() => _ctrl2.abort(), 8000);
        const result = await fetchSportsNowMatches(_ctrl2.signal);
        clearTimeout(_t2);

        sportsLoaded = true;
        let matches = result.list.map(normalizeSportsNowMatch);
        if (filter === 'live') {
            matches = matches.filter(m => (m.status === 'live' || m.status === 'halftime') && !sportsIsFinished(m));
        } else if (filter === 'upcoming') {
            matches = matches.filter(m => m.status === 'upcoming');
        } else if (filter === 'streams') {
            matches = matches.filter(m => (m.status === 'live' || m.status === 'halftime') && !sportsIsFinished(m) && !!m.streamUrl);
        }

        // Sort so users always see: live → upcoming → finished (everything else last)
        const bucket = m => {
            if ((m.status === 'live' || m.status === 'halftime') && !sportsIsFinished(m)) return 0; // LIVE
            if (m.status === 'upcoming')                                                 return 1; // UPCOMING
            if (sportsIsFinished(m))                                                     return 3; // FINISHED at the bottom
            return 2;                                                                              // anything else (scheduled/unknown) above finished
        };
        matches = matches.slice().sort((a, b) => {
            const ba = bucket(a), bb = bucket(b);
            if (ba !== bb) return ba - bb;
            // Within the same bucket, keep upstream order but tie-break by kickoff for upcoming
            if (ba === 1 && a.startTime && b.startTime) {
                return new Date(a.startTime) - new Date(b.startTime);
            }
            return 0;
        });

        // status bar — only count truly-live matches (exclude FT/AET/etc. that upstream still tags as 'live')
        const liveCount = matches.filter(m => (m.status === 'live' || m.status === 'halftime') && !sportsIsFinished(m)).length;
        if (liveCount > 0) {
            bar.style.display = 'flex';
            bar.innerHTML = '<span class="sports-live-dot"></span> ' + liveCount + ' match' + (liveCount > 1 ? 'es' : '') + ' live right now';
        } else {
            // Important during silent auto-refresh: hide stale "X live" banner once no matches are actually live
            bar.style.display = 'none';
            bar.innerHTML = '';
        }

        if (!matches.length) {
            const msgs = {
                live:     'No matches are live right now. Check back soon.',
                upcoming: 'No upcoming matches found.',
                streams:  'No active streams right now.',
                all:      'No matches found.',
            };
            grid.innerHTML = '<div class="sports-empty"><i class="fas fa-futbol"></i><p>' + (msgs[filter] || msgs.all) + '</p></div>';
            return;
        }

        grid.innerHTML = matches.map(m => buildMatchCard(m)).join('');
    } catch(e) {
        grid.innerHTML = '<div class="sports-empty"><i class="fas fa-exclamation-triangle"></i><p>Could not load matches. Check your connection.</p></div>';
    }
}

function refreshSports() {
    const icon = document.querySelector('.sports-refresh i');
    if (icon) { icon.style.animation = 'spin 0.6s linear'; setTimeout(() => icon.style.animation = '', 700); }
    sportsLoaded = false;
    loadSports(document.querySelector('.sports-tab.active'), currentSportsFilter);
}

function buildMatchCard(m) {
    if (!m || typeof m !== 'object') return '';
    const home = m.homeTeam || {};
    const away = m.awayTeam || {};
    const homeName = srailEscape(home.name || 'Home');
    const awayName = srailEscape(away.name || 'Away');
    const league   = srailEscape(m.league || 'Match');

    const finished = sportsIsFinished(m);
    // A match is only really "live" if upstream says so AND it isn't already over
    const isLive = (m.status === 'live' || m.status === 'halftime') && !finished;
    const isUpcoming = m.status === 'upcoming';
    let rawStatus;
    if (isLive)            rawStatus = m.status === 'halftime' ? 'HT' : (m.minute || 'LIVE');
    else if (isUpcoming)   rawStatus = 'UPCOMING';
    else if (finished)     rawStatus = String(m.minute || 'FINISHED').toUpperCase(); // FT / AET / PEN / etc.
    else                   rawStatus = 'SCHEDULED'; // unknown + no minute — don't say "UNKNOWN" to users
    const statusLabel = srailEscape(rawStatus);
    const statusClass = isLive ? 'scard-live' : isUpcoming ? 'scard-upcoming' : 'scard-finished';

    const homeLogoUrl = srailSafeUrl(home.logo);
    const awayLogoUrl = srailSafeUrl(away.logo);
    const homeLogo = homeLogoUrl
        ? '<img src="' + srailEscape(homeLogoUrl) + '" class="scard-logo" onerror="this.style.display=\'none\'">'
        : '<div class="scard-logo-placeholder"><i class="fas fa-shield-alt"></i></div>';
    const awayLogo = awayLogoUrl
        ? '<img src="' + srailEscape(awayLogoUrl) + '" class="scard-logo" onerror="this.style.display=\'none\'">'
        : '<div class="scard-logo-placeholder"><i class="fas fa-shield-alt"></i></div>';

    const homeScore = Number.isFinite(home.score) ? home.score : (parseInt(home.score, 10) || 0);
    const awayScore = Number.isFinite(away.score) ? away.score : (parseInt(away.score, 10) || 0);
    const scoreBlock = isLive
        ? '<div class="scard-score">' + homeScore + ' <span class="scard-score-sep">–</span> ' + awayScore + '</div>'
        : finished
            ? '<div class="scard-score muted">' + homeScore + ' – ' + awayScore + '</div>'
            : isUpcoming && m.startTime
                ? '<div class="scard-kickoff scard-countdown" data-kickoff="' + srailEscape(m.startTime||'') + '">' + srailEscape(formatKickoff(m.startTime)) + '</div>'
                : '<div class="scard-vs">VS</div>';

    // Only show "Watch Live" when the match is actually live. Finished matches
    // still carry a streamUrl from the provider but it is dead; upcoming matches
    // don't have a real feed yet either.
        const _smid = srailEscape(String(m.id || m.fixture || ''));
    const _stitle = srailEscape(String(home.name||'Home') + ' vs ' + String(away.name||'Away'));
    const _sleague = srailEscape(typeof m.league === 'string' ? m.league : (m.league && m.league.name ? m.league.name : ''));
    const hasLiveFeed = isLive && !!m.streamUrl;
    const watchBtn = hasLiveFeed
        ? '<button class="scard-watch-btn" data-mid="' + _smid + '" data-title="' + _stitle + '" data-league="' + _sleague + '" onclick="watchFootballById(this.dataset.mid,this.dataset.title,this.dataset.league)">&#9654; Watch Live</button>'
        : '';
    const unavailableBtn = isLive && !hasLiveFeed
        ? '<button class="scard-watch-btn scard-unavailable" type="button" disabled title="SportsNow has not published a live video feed for this match">&#9888; Live feed unavailable</button>'
        : '';
    // Prefer the media type the provider actually supplied. Some feeds expose
    // full-match replays but no highlights, while others expose highlights only.
    const hasHighlights = Array.isArray(m.highlightItems) && m.highlightItems.length > 0;
    const hasReplays = Array.isArray(m.replayItems) && m.replayItems.length > 0;
    const mediaKind = hasHighlights ? 'highlight' : hasReplays ? 'replay' : 'auto';
    const mediaLabel = hasHighlights ? 'Highlights' : hasReplays ? 'Replay' : 'Watch Video';
    const mediaBtns = !isLive && finished
        ? '<button class="scard-watch-btn scard-media-btn" data-mid="' + _smid + '" data-title="' + _stitle + '" data-league="' + _sleague + '" onclick="watchSportsClipsById(this.dataset.mid,this.dataset.title,this.dataset.league,&quot;' + mediaKind + '&quot;)"><i class="fas fa-film"></i> ' + mediaLabel + '</button>'
        : '';
    const cardActions = watchBtn + unavailableBtn + mediaBtns;

    return '<div class="scard ' + (isLive ? 'scard-is-live' : '') + '">' +
        '<div class="scard-header">' +
            '<span class="scard-league">' + league + '</span>' +
            '<span class="scard-status ' + statusClass + '">' + statusLabel + '</span>' +
        '</div>' +
        '<div class="scard-teams">' +
            '<div class="scard-team">' + homeLogo + '<span class="scard-team-name">' + homeName + '</span></div>' +
            scoreBlock +
            '<div class="scard-team">' + awayLogo + '<span class="scard-team-name">' + awayName + '</span></div>' +
        '</div>' +
        (cardActions ? '<div class="scard-footer">' + cardActions + '</div>' : '') +
    '</div>';
}

function formatKickoff(iso) {
    try {
        const d = new Date(iso);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch(e) { return ''; }
}

// =============================================================
// Live Sports — DEDICATED MODAL (independent of movie player)
// =============================================================
// We build our own minimal modal so the movie player's custom
// controls/overlays/loaders don't conflict with live streams.

function ensureLiveSportsModal() {
    if (document.getElementById('liveSportsModal')) return;

    const css = `
    #liveSportsModal{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.92);display:none;align-items:center;justify-content:center;}
    #liveSportsModal.lsm-open{display:flex;}
    #liveSportsModal .lsm-shell{position:relative;width:min(1100px,95vw);background:#0b0b0b;border-radius:12px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.6);}
    #liveSportsModal .lsm-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:linear-gradient(90deg,#1a0000,#0b0b0b);border-bottom:1px solid #222;}
    #liveSportsModal .lsm-title{color:#fff;font-weight:600;font-size:15px;display:flex;align-items:center;gap:10px;}
    #liveSportsModal .lsm-live-dot{width:8px;height:8px;border-radius:50%;background:#ff2d2d;box-shadow:0 0 0 0 rgba(255,45,45,.7);animation:lsm-pulse 1.4s infinite;}
    @keyframes lsm-pulse{0%{box-shadow:0 0 0 0 rgba(255,45,45,.7)}70%{box-shadow:0 0 0 10px rgba(255,45,45,0)}100%{box-shadow:0 0 0 0 rgba(255,45,45,0)}}
    #liveSportsModal .lsm-league{color:#9aa0a6;font-size:12px;margin-left:6px;}
    #liveSportsModal .lsm-close{background:transparent;border:0;color:#fff;font-size:22px;cursor:pointer;padding:4px 10px;line-height:1;}
    #liveSportsModal .lsm-close:hover{color:#ff5252;}
    #liveSportsModal .lsm-video-wrap{position:relative;background:#000;aspect-ratio:16/9;}
    #liveSportsModal video{width:100%;height:100%;display:block;background:#000;}
    #liveSportsModal .lsm-loading-msg{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:#ddd;font-size:13px;text-align:center;background:rgba(0,0,0,.3);pointer-events:none;}
    #liveSportsModal .lsm-loading-msg-text{padding:7px 12px;border-radius:6px;background:rgba(0,0,0,.55);}
    #liveSportsModal .lsm-start-btn{display:none;border:1px solid rgba(255,82,82,.7);border-radius:7px;background:#c62828;color:#fff;padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer;pointer-events:auto;box-shadow:0 4px 16px rgba(0,0,0,.35);}
    #liveSportsModal .lsm-start-btn:active{transform:scale(.98);}
    #liveSportsModal .lsm-error{position:absolute;inset:auto 0 0 0;background:rgba(20,0,0,.92);color:#fff;padding:14px 18px;font-size:14px;text-align:center;display:none;border-top:1px solid #4a0000;}
    #liveSportsModal .lsm-error.lsm-show{display:block;}
    #liveSportsModal .lsm-minute{display:inline-flex;align-items:center;background:rgba(255,45,45,.15);border:1px solid rgba(255,45,45,.35);color:#ff6b6b;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;margin-left:8px;min-width:36px;justify-content:center;letter-spacing:.03em;}
    #liveSportsModal .lsm-streams{display:none;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 16px;background:#0d0d0d;border-top:1px solid #1e1e1e;}
    #liveSportsModal .lsm-streams{display:none;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 16px;background:#0d0d0d;border-top:1px solid #1e1e1e;}
    #liveSportsModal .lsm-stream-btn{background:#1a1a1a;border:1px solid #2e2e2e;color:#bbb;border-radius:6px;padding:4px 11px;font-size:12px;cursor:pointer;font-weight:600;transition:all .15s;}
    #liveSportsModal .lsm-stream-btn:hover{border-color:#e85d04;color:#fff;}
    #liveSportsModal .lsm-stream-btn.lsm-stream-active{background:#e85d04;border-color:#e85d04;color:#fff;}
    `;
    const style = document.createElement('style');
    style.id = 'liveSportsModalStyle';
    style.textContent = css;
    document.head.appendChild(style);

    const modal = document.createElement('div');
    modal.id = 'liveSportsModal';
    modal.innerHTML =
        '<div class="lsm-shell" role="dialog" aria-modal="true" aria-label="Live match player">' +
            '<div class="lsm-head">' +
                '<div class="lsm-title">' +
                    '<span class="lsm-live-dot"></span>' +
                    '<span id="lsmTitle">Live Match</span>' +
                    '<span class="lsm-league" id="lsmLeague"></span>' +
                '<span class="lsm-minute" id="lsmMinute" style="display:none"></span>' +
                '</div>' +
                '<button type="button" class="lsm-close" id="lsmClose" aria-label="Close">&times;</button>' +
            '</div>' +
            '<div class="lsm-video-wrap">' +
                '<video id="lsmVideo" controls playsinline webkit-playsinline preload="auto"></video>' +
                '<div class="lsm-loading-msg" id="lsmLoadingMsg"><span class="lsm-loading-msg-text" id="lsmLoadingText">Connecting to live stream...</span><button type="button" class="lsm-start-btn" id="lsmStartButton">▶ Play live stream</button></div>' +
                '<div class="lsm-error" id="lsmError"></div>' +
            '</div>' +
            '<div class="lsm-streams" id="lsmStreams"></div>' +
        '</div>';
    document.body.appendChild(modal);

    // Close handlers
    document.getElementById('lsmClose').addEventListener('click', closeLiveSports);
    modal.addEventListener('click', e => { if (e.target === modal) closeLiveSports(); });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && modal.classList.contains('lsm-open')) closeLiveSports();
    });
}
ensureLiveSportsModal();

function closeLiveSports() {
    const modal  = document.getElementById('liveSportsModal');
    const video  = document.getElementById('lsmVideo');
    if (sportsHls) { try { sportsHls.destroy(); } catch(e) {} sportsHls = null; }
    if (typeof clearSportsStallWatch === 'function') clearSportsStallWatch();
    sportsCurrent = { matchId: '', title: '', league: '', streamUrl: '', proxyUrl: '', refetching: false };
    if (video) {
        try { video.pause(); } catch(e) {}
        video.removeAttribute('src');
        try { video.load(); } catch(e) {}
    }
    if (modal) { modal.classList.remove('lsm-open'); modal.style.display = ''; modal.setAttribute('aria-hidden','true'); }
    var _minElC = document.getElementById('lsmMinute'); if (_minElC) { _minElC.style.display = 'none'; _minElC.textContent = ''; }
    if (window._sportsMinuteInterval) { clearInterval(window._sportsMinuteInterval); window._sportsMinuteInterval = null; }
    document.body.style.overflow = '';
    document.body.classList.remove('modal-open');
}

// Track current playback context so we can self-heal (re-fetch a fresh signed URL,
// nudge past stalls, etc.) without the user having to do anything.
let sportsCurrent = { matchId: '', title: '', league: '', streamUrl: '', proxyUrl: '', refetching: false, minute: '' };
let sportsStallTimer = null;

// Live match minute updater — fires every 30s while player is open
async function _refreshLsmMinute() {
    if (!sportsCurrent.matchId) return;
    try {
        const cur = normalizeSportsNowMatch(await fetchSportsNowMatch(sportsCurrent.matchId));
        const min = cur.minute ? String(cur.minute) : '';
        sportsCurrent.minute = min;
        const el = document.getElementById('lsmMinute');
        if (!el) return;
        if (min && min !== 'LIVE') { el.textContent = min + '′'; el.style.display = 'inline-flex'; }
        else if (min === 'LIVE') { el.textContent = 'LIVE'; el.style.display = 'inline-flex'; }
    } catch(e) {}
}
function _startSportsMinuteInterval() {
    if (window._sportsMinuteInterval) clearInterval(window._sportsMinuteInterval);
    window._sportsMinuteInterval = setInterval(_refreshLsmMinute, 30000);
}

// Countdown tick — updates all upcoming match cards every second
(function _startCountdownTick() {
    setInterval(function() {
        document.querySelectorAll('.scard-countdown[data-kickoff]').forEach(function(el) {
            var ko = el.dataset.kickoff;
            if (!ko) return;
            var diff = new Date(ko) - Date.now();
            if (diff <= 0) { el.textContent = 'Starting soon'; return; }
            var h = Math.floor(diff / 3600000);
            var m = Math.floor((diff % 3600000) / 60000);
            var s = Math.floor((diff % 60000) / 1000);
            if (h >= 24) { var d = Math.floor(h/24); el.textContent = 'In ' + d + 'd ' + (h%24) + 'h'; }
            else if (h > 0) { el.textContent = 'In ' + h + 'h ' + m + 'm'; }
            else if (m > 0) { el.textContent = 'In ' + m + 'm ' + s + 's'; }
            else { el.textContent = 'In ' + s + 's'; }
        });
    }, 1000);
})();
// AbortController used to cleanly remove all video event listeners (waiting/playing/etc.)
// when the modal is closed or the player is re-initialised. Without this, listeners
// would accumulate across opens since we reuse the same <video> element.
let sportsAbort = null;
let sportsWaitingTimer = null;

// Pull the latest signed SportsNow playPath for this match and swap it in.
// Used when the original URL expires mid-stream, or when the player gets stuck
// at a stall the normal recovery can't fix.
async function refreshSportsStream(reason) {
    if (!sportsCurrent.matchId || sportsCurrent.refetching) return false;
    sportsCurrent.refetching = true;
    try {
        const match = normalizeSportsNowMatch(await fetchSportsNowMatch(sportsCurrent.matchId));
        const fresh = match.playPath || '';
        if (fresh && sportsNowPlaybackUrl(fresh) !== sportsCurrent.streamUrl) {
            // Re-init with a newly fetched signed SportsNow URL.
            watchFootball(sportsNowPlaybackUrl(fresh), sportsCurrent.title, sportsCurrent.league, sportsCurrent.matchId, '', match._streamList);
            return true;
        }
    } catch(e) {}
    finally { sportsCurrent.refetching = false; }
    return false;
}

function clearSportsStallWatch() {
    if (sportsStallTimer) { clearInterval(sportsStallTimer); sportsStallTimer = null; }
    if (sportsWaitingTimer) { clearTimeout(sportsWaitingTimer); sportsWaitingTimer = null; }
    if (sportsAbort) { try { sportsAbort.abort(); } catch(e) {} sportsAbort = null; }
}


// Lazy-load stream URL by match ID, then start playback.
// SportsNow returns the signed playPath from match detail; fetch it immediately before playback.
async function watchFootballById(matchId, title, league) {
    // Show the modal immediately with a loading state so user knows something is happening
    ensureLiveSportsModal();
    const modal = document.getElementById('liveSportsModal');
    if (modal) modal.setAttribute('aria-hidden','false');
    const lm = document.getElementById('lsmLoadingMsg');
    const lmText = document.getElementById('lsmLoadingText');
    if (lmText) lmText.textContent = 'Connecting to stream…';
    if (lm) lm.style.display = 'flex';
    const errorEl  = document.getElementById('lsmError');
    const titleEl  = document.getElementById('lsmTitle');
    const leagueEl = document.getElementById('lsmLeague');
    if (titleEl)   titleEl.textContent  = title  || 'Live Match';
    if (leagueEl)  leagueEl.textContent = league ? '· ' + league : '';
    var _minEl0 = document.getElementById('lsmMinute'); if (_minEl0) _minEl0.style.display = 'none';
    if (errorEl)   { errorEl.textContent = ''; errorEl.classList.remove('lsm-show'); }
    if (modal)     modal.classList.add('lsm-open');
    document.body.style.overflow = 'hidden';
    document.body.classList.add('modal-open');
    const video = document.getElementById('lsmVideo');
    if (video) { video.removeAttribute('src'); try { video.load(); } catch(e) {} }
    try {
        const match = normalizeSportsNowMatch(await fetchSportsNowMatch(matchId));
        const url = sportsNowPlaybackUrl(match.playPath || '');
        if (!url) throw new Error('This match is live in the score feed, but SportsNow has not published a live video feed for it yet. Try again shortly.');
        const displayTitle = title || ((match.homeTeam.name || 'Home') + ' vs ' + (match.awayTeam.name || 'Away'));
        const displayLeague = league || match.league || '';
        sportsCurrent.minute = match.minute || '';
        var _fetchedMinute = sportsCurrent.minute;
        var _minEl1 = document.getElementById('lsmMinute');
        if (_minEl1) {
            if (_fetchedMinute && _fetchedMinute !== 'LIVE') {
                _minEl1.textContent = _fetchedMinute + "\u2032";
                _minEl1.style.display = 'inline-flex';
            } else if (_fetchedMinute === 'LIVE') {
                _minEl1.textContent = 'LIVE';
                _minEl1.style.display = 'inline-flex';
            }
        }
        watchFootball(url, displayTitle, displayLeague, matchId, '', match._streamList);
    } catch(e) {
        if (errorEl) { errorEl.textContent = e.message || 'Stream unavailable.'; errorEl.classList.add('lsm-show'); }
    }
}

async function watchSportsClipsById(matchId, title, league, kind) {
    ensureLiveSportsModal();
    const modal = document.getElementById('liveSportsModal');
    const errorEl = document.getElementById('lsmError');
    const lm = document.getElementById('lsmLoadingMsg');
    const lmText = document.getElementById('lsmLoadingText');
    if (lmText) lmText.textContent = kind === 'replay' ? 'Loading replay...' : kind === 'highlight' ? 'Loading highlights...' : 'Loading available video...';
    if (lm) lm.style.display = 'flex';
    if (errorEl) { errorEl.textContent = ''; errorEl.classList.remove('lsm-show'); }
    if (modal) modal.classList.add('lsm-open');
    document.body.style.overflow = 'hidden';
    document.body.classList.add('modal-open');
    try {
        const match = normalizeSportsNowMatch(await fetchSportsNowMatch(matchId));
        const requestedKind = kind === 'replay' || kind === 'highlight' ? kind : 'auto';
        let resolvedKind = requestedKind;
        let items = requestedKind === 'replay' ? match.replayItems : requestedKind === 'highlight' ? match.highlightItems : [];
        if (!items || !items.length) {
            if (requestedKind === 'auto' && match.highlightItems && match.highlightItems.length) {
                resolvedKind = 'highlight';
                items = match.highlightItems;
            } else if ((requestedKind === 'auto' || requestedKind === 'highlight') && match.replayItems && match.replayItems.length) {
                resolvedKind = 'replay';
                items = match.replayItems;
            }
        }
        if (!items || !items.length) {
            const message = requestedKind === 'highlight' ? 'No highlights are available for this match yet.' : requestedKind === 'replay' ? 'No replay is available for this match.' : 'No replay or highlights are available for this match yet.';
            throw new Error(message);
        }
        const displayTitle = title || (match.homeTeam.name + ' vs ' + match.awayTeam.name);
        const streams = items.map((item, index) => ({
            title: item.title || ((resolvedKind === 'replay' ? 'Replay ' : 'Highlight ') + (index + 1)),
            url: item.url,
            kind: 'clip',
            resolution: item.duration ? item.duration + 's' : '',
            _matchId: ''
        }));
        watchFootball(streams[0].url, displayTitle, league || match.league || '', '', '', streams);
    } catch (e) {
        if (lm) lm.style.display = 'none';
        if (errorEl) { errorEl.textContent = e.message || 'Video unavailable.'; errorEl.classList.add('lsm-show'); }
    }
}

function _switchLsmStream(idx) {
    const s = _lsmAllStreams[idx];
    if (!s) return;
    const url = s.proxy || s.url || '';
    if (!url) return;
    const titleEl  = document.getElementById('lsmTitle');
    const leagueEl = document.getElementById('lsmLeague');
    watchFootball(url, titleEl ? titleEl.textContent : '', leagueEl ? leagueEl.textContent.replace(/^·\s*/,'') : '', _lsmAllStreams[0] && _lsmAllStreams[0]._matchId || '', '', _lsmAllStreams);
}

function watchFootball(streamUrl, title, league, matchId, proxyUrl, streams) {
    const modal    = document.getElementById('liveSportsModal');
    const video    = document.getElementById('lsmVideo');
    const titleEl  = document.getElementById('lsmTitle');
    const leagueEl = document.getElementById('lsmLeague');
    const errorEl  = document.getElementById('lsmError');

    if (titleEl)  titleEl.textContent  = title || 'Live Match';
    if (leagueEl) leagueEl.textContent = league ? '· ' + league : '';
    if (errorEl)  { errorEl.textContent = ''; errorEl.classList.remove('lsm-show'); }

    sportsCurrent = { matchId: matchId || '', title: title || '', league: league || '', streamUrl: streamUrl, proxyUrl: proxyUrl || '', refetching: false, minute: sportsCurrent.minute || '' };
    _startSportsMinuteInterval();

    // Update quality switcher
    if (streams && streams.length) {
        _lsmAllStreams = streams.map(s => ({ ...s, _matchId: matchId||'' }));
    }
    const _streamsDiv = document.getElementById('lsmStreams');
    if (_streamsDiv) {
        if (_lsmAllStreams.length > 1) {
            _streamsDiv.style.display = 'flex';
            const _clipSwitcher = _lsmAllStreams.some(s => s.kind === 'clip');
            _streamsDiv.innerHTML = '<span style="color:#666;font-size:11px;align-self:center;margin-right:2px;white-space:nowrap">' + (_clipSwitcher ? 'Clips:' : 'Quality:') + '</span>' +
                _lsmAllStreams.map((s, i) => {
                    const sUrl = s.proxy || s.url || '';
                    const isActive = sUrl === streamUrl;
                    return '<button class="lsm-stream-btn' + (isActive ? ' lsm-stream-active' : '') + '" onclick="_switchLsmStream(' + i + ')">' +
                        srailEscape(s.title||('S'+(i+1))) + (s.resolution ? ' <span style="opacity:.6;font-size:10px">' + srailEscape(s.resolution) + '</span>' : '') +
                        '</button>';
                }).join('');
        } else {
            _streamsDiv.style.display = 'none';
        }
    }

    if (sportsHls) { try { sportsHls.destroy(); } catch(e) {} sportsHls = null; }
    clearSportsStallWatch();
    sportsAbort = new AbortController();

    video.muted = true;       // satisfy autoplay policy
    video.defaultMuted = true;
    video.setAttribute('muted', '');
    video.autoplay = true;
    const initialLoader = document.getElementById('lsmLoadingMsg');
    if (initialLoader) initialLoader.style.display = 'flex';
    video.removeAttribute('src');
    try { video.load(); } catch(e) {}

    modal.classList.add('lsm-open');
    document.body.style.overflow = 'hidden';
    document.body.classList.add('modal-open');

    const setLoading = (visible, message) => {
        const loader = document.getElementById('lsmLoadingMsg');
        const label = document.getElementById('lsmLoadingText');
        if (label && message) label.textContent = message;
        if (loader) loader.style.display = visible ? 'flex' : 'none';
    };
    const setStartButton = visible => {
        const btn = document.getElementById('lsmStartButton');
        if (btn) btn.style.display = visible ? 'inline-block' : 'none';
    };
    const showError = msg => {
        setLoading(false);
        setStartButton(false);
        if (errorEl) { errorEl.textContent = msg; errorEl.classList.add('lsm-show'); }
    };

    // Mobile Chrome can reject play() once before the first frame is ready.
    // Retry when media becomes playable and use an in-player button as fallback.
    const tryPlay = () => {
        if (!video || video.ended) return;
        video.muted = true;
        video.defaultMuted = true;
        const pending = video.play();
        if (pending && typeof pending.catch === 'function') {
            pending.catch(err => {
                if (err && err.name === 'AbortError') return;
                if (err && err.name === 'NotAllowedError') {
                    setLoading(true, 'Playback is ready.');
                    setStartButton(true);
                } else {
                    setLoading(true, 'Buffering live stream...');
                }
            });
        }
    };
    const startBtn = document.getElementById('lsmStartButton');
    if (startBtn) startBtn.onclick = () => { setStartButton(false); tryPlay(); };
    if (sportsAbort) {
        video.addEventListener('loadeddata', tryPlay, { signal: sportsAbort.signal });
        video.addEventListener('canplay', tryPlay, { signal: sportsAbort.signal });
    }

    // Jump the player to the latest live edge available. We prefer the actual
    // seekable.end (what the browser reports) and fall back to hls.js's
    // liveSyncPosition. Returns true if we actually moved.
    const seekToLiveEdge = () => {
        try {
            if (!video) return false;
            const sk = video.seekable;
            if (sk && sk.length) {
                const target = sk.end(sk.length - 1) - 2; // 2s back from absolute live for safety
                if (target > 0 && (video.currentTime < target - 1 || video.readyState < 3)) {
                    video.currentTime = target;
                    return true;
                }
            }
            if (sportsHls && sportsHls.liveSyncPosition) {
                video.currentTime = sportsHls.liveSyncPosition;
                return true;
            }
        } catch(e) {}
        return false;
    };

    // The "waiting" event fires the moment the player runs out of buffer and
    // starts spinning. If we're still waiting after 4s, the most likely cause
    // is that we fell behind the live window — jump straight to live instead
    // of waiting for the slower poll-based watchdog tick.
    const onWaiting = () => {
        setLoading(true, 'Buffering live stream...');
        if (sportsWaitingTimer) clearTimeout(sportsWaitingTimer);
        sportsWaitingTimer = setTimeout(() => {
            if (!video || video.paused || video.ended) return;
            try {
                const sk = video.seekable;
                if (sk && sk.length) {
                    const behind = sk.end(sk.length - 1) - video.currentTime;
                    if (behind > 6) seekToLiveEdge();
                }
            } catch(e) {}
        }, 4000);
    };
    const onPlaying = () => {
        setLoading(false);
        setStartButton(false);
        if (sportsWaitingTimer) { clearTimeout(sportsWaitingTimer); sportsWaitingTimer = null; }
    };
    if (sportsAbort) {
        video.addEventListener('waiting', onWaiting, { signal: sportsAbort.signal });
        video.addEventListener('playing', onPlaying, { signal: sportsAbort.signal });
    }

    // Periodic stall watchdog. Two distinct symptoms it tries to fix:
    //   (a) Fell behind the live window — currentTime is moving, but live edge
    //       is moving faster, so seekable.end - currentTime keeps growing.
    //       Detected even when not "stuck" — we just re-sync to live.
    //   (b) Truly stuck — currentTime barely advancing across ticks despite
    //       playing state. Nudge at ~6s, re-fetch fresh URL at ~12s.
    const startStallWatch = () => {
        if (sportsStallTimer) { clearInterval(sportsStallTimer); sportsStallTimer = null; }
        let lastTime = -1, stuckTicks = 0;
        sportsStallTimer = setInterval(() => {
            if (!video || video.paused || video.ended) { lastTime = video ? video.currentTime : -1; stuckTicks = 0; return; }
            const now = video.currentTime;

            // (a) Fell-behind detector — runs every tick, independent of stuck state.
            try {
                const sk = video.seekable;
                if (sk && sk.length) {
                    const behind = sk.end(sk.length - 1) - now;
                    if (behind > 25) seekToLiveEdge();
                }
            } catch(e) {}

            // (b) Stuck detector — tolerance 0.5s/3s tick catches slow-creep stalls
            // that the old 0.05s threshold missed.
            if (Math.abs(now - lastTime) < 0.5) {
                stuckTicks++;
                if (stuckTicks === 2) { // ~6s stuck → seek to live + kick loader
                    seekToLiveEdge();
                    try { sportsHls && sportsHls.startLoad(); } catch(e) {}
                } else if (stuckTicks >= 4) { // ~12s stuck → refetch fresh signed URL
                    stuckTicks = 0;
                    refreshSportsStream('stall');
                }
            } else {
                stuckTicks = 0;
            }
            lastTime = now;
        }, 3000);
    };

    if (/\.(?:mp4|webm|mov)(?:$|\?)/i.test(streamUrl) || String(streamUrl).startsWith('/api/sportsnow/clip?url=')) {
        video.src = streamUrl;
        video.load();
        video.muted = false;
        const clipPlay = video.play();
        if (clipPlay && typeof clipPlay.catch === 'function') {
            clipPlay.catch(() => { video.muted = true; tryPlay(); });
        }
    } else if (window.Hls && Hls.isSupported()) {
        sportsHls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            xhrSetup: function(xhr, url) { xhr.withCredentials = false; },
            liveDurationInfinity: true,
            // Start with the lightest rendition on phones, then let hls.js adapt up.
            startLevel: 0,
            capLevelToPlayerSize: true,
            initialLiveManifestSize: 1,
            liveSyncDurationCount: 2,
            liveMaxLatencyDurationCount: 6,
            backBufferLength: 15,
            maxBufferLength: 20,
            maxMaxBufferLength: 40,
            manifestLoadingTimeOut: 12000,
            manifestLoadingMaxRetry: 4,
            levelLoadingTimeOut: 12000,
            levelLoadingMaxRetry: 4,
            fragLoadingTimeOut: 20000,
            fragLoadingMaxRetry: 6,
            fragLoadingMaxRetryTimeout: 8000,
        });
        sportsHls.loadSource(streamUrl);
        sportsHls.attachMedia(video);
        sportsHls.on(Hls.Events.MANIFEST_PARSED, () => {
            // Parsing the playlist does not mean a video frame is ready yet.
            // Keep the loader visible until the actual playing event fires.
            setLoading(true, 'Starting live stream...');
            tryPlay();
            startStallWatch();
        });

        let fragRetries = 0, mediaRetries = 0;
        // Reset retry counters whenever a fragment loads cleanly — without this,
        // an occasional network blip 30 mins in would push us past the cumulative
        // limit and kill the stream forever.
        sportsHls.on(Hls.Events.FRAG_LOADED, () => { fragRetries = 0; mediaRetries = 0; });
        sportsHls.on(Hls.Events.ERROR, (event, data) => {
            if (!data.fatal) return;
            const code = data.response && data.response.code;

            // Auth failure or CORS block → try proxy URL first, then refetch a fresh one
            if ((code === 404 || code === 403 || code === 401 || code === 410 || code === 0) && sportsCurrent.matchId) {
                if (sportsCurrent.proxyUrl && streamUrl !== sportsCurrent.proxyUrl) {
                    watchFootball(sportsCurrent.proxyUrl, sportsCurrent.title, sportsCurrent.league, sportsCurrent.matchId, '');
                    return;
                }
                refreshSportsStream('expired-signature').then(ok => {
                    if (!ok) showError('Stream link expired. Tap the matches list to refresh and try again.');
                });
                return;
            }

            if (data.type === 'networkError' && data.details === 'fragLoadError' && code !== 404 && fragRetries < 3) {
                fragRetries++;
                try { sportsHls.startLoad(); return; } catch(e) {}
            }
            if (data.type === 'mediaError' && mediaRetries < 2) {
                mediaRetries++;
                try { sportsHls.recoverMediaError(); return; } catch(e) {}
            }

            // Last-ditch attempt: try a fresh signed URL even if the error code
            // wasn't an obvious expiry. Helps when upstream rotates tokens silently.
            if (sportsCurrent.matchId && data.type === 'networkError' && code !== 404) {
                refreshSportsStream('network-fatal').then(ok => {
                    if (ok) return;
                    showError('Network error reaching the stream. Check your connection.');
                });
                return;
            }

            let msg = 'Stream unavailable.';
            if (data.type === 'networkError') {
                if (code === 404) msg = 'This match is not broadcasting right now. The provider only attaches a live feed when the match is actually being played.';
                else if (code === 403 || code === 401) msg = 'Stream access denied — the link may have expired. Try refreshing matches.';
                else if (code) msg = 'Stream error (HTTP ' + code + '). The match may have ended or not started yet.';
                else msg = 'Network error reaching the stream. Check your connection.';
            } else if (data.type === 'mediaError') {
                msg = 'Playback error — could not decode the live feed.';
            }
            showError(msg);
        });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS path (Safari / iOS) — apply the same self-healing as the Hls.js path
        video.src = streamUrl;
        tryPlay();
        startStallWatch();
        // On any media error (including signed-URL expiry → 403), try refetching a fresh URL
        // before giving up. video.error.code 2 = MEDIA_ERR_NETWORK, 3 = MEDIA_ERR_DECODE, 4 = MEDIA_ERR_SRC_NOT_SUPPORTED.
        video.addEventListener('error', () => {
            if (sportsCurrent.matchId) {
                refreshSportsStream('native-error').then(ok => {
                    if (!ok) showError('Could not load this live stream.');
                });
            } else {
                showError('Could not load this live stream.');
            }
        }, { once: true });
    } else {
        showError('Your browser does not support HLS streaming.');
    }
}
