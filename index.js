require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const crypto = require('crypto');
const path = require('path');
const { PassThrough, Readable } = require('stream');
const { pipeline } = require('stream/promises');
const seo = require('./seo');
const episodeMetadata = require('./episode-metadata');

const app = express();
const PORT = process.env.PORT || 5000;
const BIND_ADDRESS = process.env.HM_CINEMA_BIND_ADDRESS || '0.0.0.0';

// Trust proxy (Nginx) so req.protocol returns 'https' correctly
app.set('trust proxy', true);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static JS files
app.use("/js", express.static(path.join(__dirname, "js"), { maxAge: "1h" }));

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Range');
    res.header('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});
// -- API Cache-Control headers --
app.use('/api', (req, res, next) => {
    const p = req.path;
    if (p.startsWith('/sources/') || p.startsWith('/stream/') || p.startsWith('/proxy/') || p.startsWith('/sportsnow/') ||
        p.startsWith('/captions/') || p.startsWith('/cache/stats')) {
        res.set('Cache-Control', 'no-store');
    } else if (p.startsWith('/info/') || p.startsWith('/dubs/')) {
        res.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=3600');
    } else {
        res.set('Cache-Control', 'public, max-age=1800, stale-while-revalidate=300');
    }
    next();
});

// Tell browsers and crawlers to stay on HTTPS when the request arrived through
// the TLS-terminating reverse proxy.
app.use((req, res, next) => {
    if (req.secure) {
        res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});


app.get('/style.css', (req, res) => {
    // Set the correct MIME type
    res.type('text/css');
    // Serve the file directly from the moviebox-api directory
    res.sendFile(path.join(__dirname, 'style.css'));
});

// PWA Manifest
app.get('/site.webmanifest', (req, res) => {
    res.type('application/manifest+json');
    res.sendFile(path.join(__dirname, 'site.webmanifest'));
});

// PWA Service Worker
app.get('/sw.js', (req, res) => {
    res.type('application/javascript');
    res.sendFile(path.join(__dirname, 'sw.js'));
});

// OG Preview Image
app.get('/og-image.jpg', (req, res) => {
    res.type('image/jpeg');
    res.sendFile(path.join(__dirname, 'og-image.jpg'));
});

app.get('/profile.png', (req, res) => {
    res.type('image/png');
    res.sendFile(path.join(__dirname, 'profile.png'));
});

const SELECTED_HOST = process.env.MOVIEBOX_API_HOST || "h5.aoneroom.com";
const HOST_URL = `https://${SELECTED_HOST}`;
const SEARCH_HOST_URL = 'https://h5-api.aoneroom.com';
const RELAY_BASE = process.env.RELAY_URL || ''; // e.g. https://hm-moviez-relay.workers.dev

// Build a relay URL: if RELAY_BASE is set, send the request through the
// Cloudflare worker (which uses CF edge IPs, bypassing geo-blocks).
// Otherwise fall back to calling the upstream directly.
function relayApiUrl(targetUrl) {
    if (!RELAY_BASE) return targetUrl;
    return `${RELAY_BASE}/relay?url=${encodeURIComponent(targetUrl)}`;
}

const ALLOWED_CDN_PREFIXES = [
    "https://bcdnw.hakunaymatata.com/",
    "https://bcdnxw.hakunaymatata.com/",
    "https://sbcdnw.hakunaymatata.com/",
    "https://sbcdnxw.hakunaymatata.com/",
    "https://valiw.hakunaymatata.com/",
    "https://cacdn.hakunaymatata.com/",
    "https://macdn.aoneroom.com/"
];

const SOUTH_AFRICAN_IPS = [
    '41.0.0.1', '41.0.0.2', '41.0.0.3', '41.0.0.4', '41.0.0.5',
    '41.76.108.1', '41.76.108.2', '41.76.108.3', '41.76.108.4',
    '102.65.0.1', '102.65.0.2', '102.65.0.3', '102.65.0.4',
    '154.0.0.1', '154.0.0.2', '154.0.0.3', '154.0.0.4',
    '196.21.0.1', '196.21.0.2', '196.21.0.3', '196.21.0.4',
    '197.80.0.1', '197.80.0.2', '197.80.0.3', '197.80.0.4'
];

let ipIndex = 0;
function getRotatingIP() {
    const ip = SOUTH_AFRICAN_IPS[ipIndex % SOUTH_AFRICAN_IPS.length];
    ipIndex++;
    return ip;
}

function getRandomIP() {
    return SOUTH_AFRICAN_IPS[Math.floor(Math.random() * SOUTH_AFRICAN_IPS.length)];
}

function getRegionBypassHeaders() {
    const ip = getRandomIP();
    return {
        'X-Forwarded-For': ip,
        'CF-Connecting-IP': ip,
        'X-Real-IP': ip,
        'True-Client-IP': ip
    };
}

const DEFAULT_HEADERS = {
    'X-Client-Info': '{"timezone":"Africa/Johannesburg"}',
    'Accept-Language': 'en-ZA,en;q=0.9,en-US;q=0.8',
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Referer': HOST_URL,
    'Host': SELECTED_HOST,
    'Connection': 'keep-alive',
    ...getRegionBypassHeaders()
};

const CDN_PROXY_HEADERS = {
    'User-Agent': process.env.CDN_USER_AGENT || 'okhttp/4.12.0',
    'Referer': process.env.FORCE_REFERER_DOMAIN || HOST_URL + '/',
    'Origin': process.env.FORCE_REFERER_DOMAIN || HOST_URL,
    'Accept': '*/*',
    'Accept-Encoding': 'identity'
};

// Exact header identity list used by the friend's standalone download proxy.
// These are forwarded headers only; they do not change this VPS's TCP source IP.
const FRIEND_PROXY_IPS = [
    '196.207.55.12', '196.207.32.10', '196.207.128.50', '196.207.64.30',
    '41.90.64.100', '41.90.100.50', '41.90.200.25',
    '105.163.0.42', '105.163.100.20', '105.163.156.10',
    '41.215.130.10', '41.215.160.50',
    '196.216.0.20', '196.216.2.100',
    '102.0.0.30', '102.0.4.50',
    '41.89.4.10', '41.76.180.20', '197.248.0.50'
];

function getFriendProxyIP() {
    return FRIEND_PROXY_IPS[Math.floor(Math.random() * FRIEND_PROXY_IPS.length)];
}


// Search uses Authorization Bearer (JWT) -- API changed from X-Client-Token in mid-2026.
async function makeSearchApiRequest(keyword, page, perPage, subjectType) {
    const jwt = await getLokLokToken();
    const freshBypassHeaders = getRegionBypassHeaders();
    const config = {
        url: SEARCH_HOST_URL + '/wefeed-h5api-bff/subject/search',
        method: 'POST',
        headers: {
            ...freshBypassHeaders,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + jwt,
            'X-Client-Info': JSON.stringify({timezone: 'Africa/Johannesburg'}),
            'X-Request-Lang': 'en',
            'Accept-Language': 'en-ZA,en;q=0.9,en-US;q=0.8',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
            'Referer': 'https://h5-api.aoneroom.com/',
            'Origin': 'https://h5-api.aoneroom.com',
            'Connection': 'keep-alive'
        },
        data: { keyword, page, perPage, subjectType },
        timeout: 30000
    };
    return await axiosInstance(config);
}
// Subject types
const SubjectType = {
    ALL: 0,
    MOVIES: 1,
    TV_SERIES: 2,
    MUSIC: 6
};

// Sources cache - MovieBox rate-limits download requests per session
// Cache successful results so repeated requests don't hit the API again
const sourcesCache = new Map();
const CACHE_TTL = 8 * 60 * 1000; // 8 min (CDN signed URLs expire ~10 min)

// File size cache - avoids a HEAD round-trip on every range request for the same URL
const fileSizeCache = new Map();
const FILE_SIZE_TTL = 30 * 60 * 1000; // 30 minutes

function getCachedFileSize(url) {
    const entry = fileSizeCache.get(url);
    if (entry && Date.now() - entry.ts < FILE_SIZE_TTL) return entry.size;
    fileSizeCache.delete(url);
    return null;
}

function setCachedFileSize(url, size) {
    fileSizeCache.set(url, { size, ts: Date.now() });
    if (fileSizeCache.size > 500) fileSizeCache.delete(fileSizeCache.keys().next().value);
}

function getCachedSources(key) {
    const cached = sourcesCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }
    sourcesCache.delete(key);
    return null;
}

function setCachedSources(key, data) {
    sourcesCache.set(key, { data, timestamp: Date.now() });
    if (sourcesCache.size > 500) {
        const oldest = sourcesCache.keys().next().value;
        sourcesCache.delete(oldest);
    }
}

// DASH playback sessions keep the provider-issued token on the server. The
// browser only receives an opaque session id and same-origin relay URLs.
const DASH_SESSION_TTL = 12 * 60 * 1000;
const dashSessions = new Map();

function createDashSession(manifestUrl, token, headerName = 'X-MB-Token') {
    if (!manifestUrl || !token) return null;
    const id = crypto.randomBytes(18).toString('hex');
    dashSessions.set(id, {
        manifestUrl,
        baseUrl: new URL('.', manifestUrl).toString(),
        token: String(token),
        headerName: headerName || 'X-MB-Token',
        expiresAt: Date.now() + DASH_SESSION_TTL
    });
    if (dashSessions.size > 500) {
        const first = dashSessions.keys().next().value;
        dashSessions.delete(first);
    }
    return id;
}

function getDashSession(id) {
    const session = dashSessions.get(String(id));
    if (!session || session.expiresAt <= Date.now()) {
        if (session) dashSessions.delete(String(id));
        return null;
    }
    return session;
}

// MP4 playback sessions keep the provider-issued signing cookie on the server.
// The browser receives only an opaque id, just like the DASH path above.
const MP4_SESSION_TTL = 10 * 60 * 1000;
const mp4Sessions = new Map();

function createMp4Session(mediaUrl, signCookie = '', signHeaderKey = '', referer = HOST_URL) {
    if (!mediaUrl) return null;
    const id = crypto.randomBytes(18).toString('hex');
    mp4Sessions.set(id, {
        mediaUrl,
        signCookie: signCookie ? String(signCookie) : '',
        signHeaderKey: signHeaderKey ? String(signHeaderKey) : '',
        referer: referer || HOST_URL,
        origin: HOST_URL,
        expiresAt: Date.now() + MP4_SESSION_TTL
    });
    if (mp4Sessions.size > 500) {
        const first = mp4Sessions.keys().next().value;
        mp4Sessions.delete(first);
    }
    return id;
}

function getMp4Session(id) {
    const session = mp4Sessions.get(String(id));
    if (!session || session.expiresAt <= Date.now()) {
        if (session) mp4Sessions.delete(String(id));
        return null;
    }
    return session;
}

function dashUpstreamHeaders(session) {
    return {
        ...CDN_PROXY_HEADERS,
        // The CDN validates the provider playback page, not hm-cinema.me.
        Referer: 'https://mzfi.me/',
        Origin: 'https://mzfi.me',
        [session.headerName]: session.token
    };
}

function rewriteDashManifest(manifest, sessionId) {
    const prefix = `/api/dash/segment/${sessionId}/`;
    let hasBaseUrl = false;
    let output = String(manifest).replace(
        /(<BaseURL\b[^>]*>)([\s\S]*?)(<\/BaseURL>)/gi,
        (_match, open, _value, close) => {
            hasBaseUrl = true;
            return `${open}${prefix}${close}`;
        }
    );

    // The current provider MPD uses relative SegmentTemplate paths. Keep DASH
    // substitution tokens ($Number$, $RepresentationID$, etc.) untouched;
    // dash.js expands them before requesting the resulting same-origin path.
    if (!hasBaseUrl) {
        output = output.replace(
            /\b(initialization|media)=(['"])([^'"]+)\2/gi,
            (_match, attr, quote, value) => {
                if (/^(?:https?:|data:|\/\/)/i.test(value)) return `${attr}=${quote}${prefix}${value}${quote}`;
                return `${attr}=${quote}${prefix}${value}${quote}`;
            }
        );
    }
    return output;
}
// ─── Generic TTL cache ────────────────────────────────────────────────────────
// makeCache(ttlMs, maxSize) returns a {get, set, size} object backed by a Map.
// Least-recently-inserted entries are evicted when maxSize is reached.
function makeCache(ttlMs, maxSize = 200) {
    const store = new Map();
    return {
        get(key) {
            const entry = store.get(key);
            if (!entry) return null;
            if (Date.now() - entry.ts > ttlMs) { store.delete(key); return null; }
            return entry.data;
        },
        set(key, data) {
            store.set(key, { data, ts: Date.now() });
            if (store.size > maxSize) store.delete(store.keys().next().value);
        },
        del(key) { store.delete(key); },
        size() { return store.size; }
    };
}

// Share one upstream request among concurrent callers for the same key. TTL
// caches prevent repeated requests over time, while this map prevents a cold
// cache burst from multiplying upstream traffic.
const inFlightRequests = new Map();
function coalesceRequest(key, loader) {
    const existing = inFlightRequests.get(key);
    if (existing) return existing;
    const request = Promise.resolve()
        .then(loader)
        .finally(() => inFlightRequests.delete(key));
    inFlightRequests.set(key, request);
    return request;
}

const INFO_TTL   = 24 * 60 * 60 * 1000; // 24 h  — title/cast/detailPath rarely change
const DUBS_TTL   = 12 * 60 * 60 * 1000; // 12 h  — dub lists are stable
const SEARCH_TTL =      30 * 60 * 1000; // 30 min — search results
const HOME_TTL   =      30 * 60 * 1000; // 30 min — homepage/trending rails

const infoCache   = makeCache(INFO_TTL,   10000);
const dubsCache   = makeCache(DUBS_TTL,   5000);
const searchCache = makeCache(SEARCH_TTL, 2000);
const homeCache   = makeCache(HOME_TTL,    20);
// ─────────────────────────────────────────────────────────────────────────────


// LOK_LOK token auto-refresh — the token's 'ext' claim expires 5 min after issue.
// We keep a fresh token in memory and re-fetch it before it expires.
let _lokLokToken = process.env.LOK_LOK_TOKEN || '';
let _lokLokTokenExtExpiry = 0;

function _parseLokLokExt(token) {
    try {
        const payload = token.split('.')[1];
        const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
        const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
        return parseInt(decoded.ext) || 0;
    } catch(e) { return 0; }
}

// Initialise expiry from the env token at startup
if (_lokLokToken) {
    _lokLokTokenExtExpiry = _parseLokLokExt(_lokLokToken);
}

// Mutex: only one refresh in-flight at a time
let _lokLokRefreshPromise = null;

async function _doLokLokRefresh() {
    const resp = await axios.get(
        'https://h5-api.aoneroom.com/wefeed-h5api-bff/app/get-latest-app-pkgs?app_name=moviebox',
        {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-A325F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36',
                'Accept': 'application/json',
                'X-Client-Info': JSON.stringify({timezone: 'Africa/Accra'})
            },
            timeout: 10000
        }
    );
    const setCookie = resp.headers['set-cookie'];
    if (setCookie) {
        const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
        for (const cookie of cookies) {
            const match = cookie.match(/token=([^;]+)/);
            if (match && match[1]) {
                _lokLokToken = match[1];
                _lokLokTokenExtExpiry = _parseLokLokExt(_lokLokToken);
                process.env.LOK_LOK_TOKEN = _lokLokToken;
                console.log('[LokLok] Token refreshed, ext valid until:', new Date(_lokLokTokenExtExpiry * 1000).toISOString());
                return;
            }
        }
    }
    throw new Error('No token cookie in response');
}

// ── Proactive background refresh ──────────────────────────────────────────────
// Refresh shortly before the JWT's actual expiry instead of calling the
// upstream every 45 seconds regardless of token lifetime.
let _bgRefreshTimer = null;
let _bgLastRefreshAt = 0; // unix ms of last successful refresh

function _nextBgRefreshDelay() {
    const now = Math.floor(Date.now() / 1000);
    if (_lokLokTokenExtExpiry > now) {
        // Refresh 30 seconds before expiry, bounded so an unknown/very long
        // token never schedules an unexpectedly distant refresh.
        return Math.max(30 * 1000, Math.min(4 * 60 * 1000, (_lokLokTokenExtExpiry - now - 30) * 1000));
    }
    return 60 * 1000;
}

function _startBgRefreshLoop(delayMs = _nextBgRefreshDelay()) {
    if (_bgRefreshTimer) clearTimeout(_bgRefreshTimer);
    _bgRefreshTimer = setTimeout(async () => {
        if (_lokLokRefreshPromise) {
            _startBgRefreshLoop(30 * 1000);
            return;
        }
        try {
            _lokLokRefreshPromise = _doLokLokRefresh()
                .finally(() => { _lokLokRefreshPromise = null; });
            await _lokLokRefreshPromise;
            _bgLastRefreshAt = Date.now();
        } catch(e) {
            const status = e.response && e.response.status;
            if (status === 429) {
                console.warn('[LokLok] Rate limited (429) — retrying refresh in 5 min');
                _startBgRefreshLoop(5 * 60 * 1000);
                return;
            }
            console.warn('[LokLok] Background refresh failed:', e.message);
        }
        _startBgRefreshLoop();
    }, delayMs);
}

// Kick off the background interval once the module loads
_startBgRefreshLoop();

async function getLokLokToken() {
    const now = Math.floor(Date.now() / 1000);
    // The token can be present in .env but already expired. Do not let the
    // first playback request silently fall back to the older empty-stream
    // contract; refresh whenever the JWT is missing or within 30 seconds of
    // expiry.
    const tokenNeedsRefresh = !_lokLokToken ||
        (_lokLokTokenExtExpiry > 0 && _lokLokTokenExtExpiry <= now + 30);
    if (tokenNeedsRefresh) {
        if (!_lokLokRefreshPromise) {
            console.log('[LokLok] Token missing or expired — doing synchronous refresh...');
            _lokLokRefreshPromise = _doLokLokRefresh()
                .catch(e => console.warn('[LokLok] Sync refresh failed:', e.message))
                .finally(() => { _lokLokRefreshPromise = null; });
        }
        await _lokLokRefreshPromise;
    }
    return _lokLokToken;
}

// Session management - using axios cookie jar for proper session handling
const jar = new CookieJar();
const axiosInstance = wrapper(axios.create({
    jar,
    withCredentials: true,
    timeout: 30000
}));

// Global retry interceptor to mitigate transient 403/429/400 responses
axiosInstance.interceptors.response.use(
    (response) => response,
    async (error) => {
        const status = error?.response?.status;
        const originalConfig = error.config;
        const retryCount = originalConfig?.__retryCount || 0;
        
        if ((status === 403 || status === 429 || status === 400) && originalConfig && retryCount < 3) {
            originalConfig.__retryCount = retryCount + 1;
            const newIp = getRotatingIP();
            console.log(`Retry ${retryCount + 1}/3 with IP: ${newIp}`);
            originalConfig.headers = {
                ...(originalConfig.headers || {}),
                'X-Forwarded-For': newIp,
                'CF-Connecting-IP': newIp,
                'X-Real-IP': newIp,
                'True-Client-IP': newIp
            };
            await new Promise(r => setTimeout(r, 500 + (retryCount * 500)));
            return axiosInstance(originalConfig);
        }
        return Promise.reject(error);
    }
);

let movieboxAppInfo = null;
let cookiesInitialized = false;
let cookiesInitializedAt = 0;
let relayCookies = ''; // raw cookie string forwarded via X-Forward-Cookie

// Helper functions
function processApiResponse(response) {
    if (response.data && response.data.data) {
        return response.data.data;
    }
    return response.data || response;
}

async function ensureCookiesAreAssigned() {
    if (!cookiesInitialized || (Date.now() - cookiesInitializedAt > 30 * 60 * 1000)) {
        cookiesInitialized = false; // force refresh if stale
        try {
            console.log('Initializing session cookies...');
            // IMPORTANT: call cookie-init THROUGH the relay so the session cookie
            // is bound to Cloudflare's edge IP (not the VPS IP).  aoneroom sessions
            // are IP-bound – a cookie created on the VPS returns 403 when later used
            // through the relay.
            const initUrl = RELAY_BASE
                ? `${RELAY_BASE}/relay?url=${encodeURIComponent(`${HOST_URL}/wefeed-h5-bff/app/get-latest-app-pkgs?app_name=moviebox`)}`
                : `${HOST_URL}/wefeed-h5-bff/app/get-latest-app-pkgs?app_name=moviebox`;
            const response = await axiosInstance.get(initUrl, {
                headers: RELAY_BASE
                    ? { 'Accept': 'application/json', 'User-Agent': DEFAULT_HEADERS['User-Agent'] }
                    : DEFAULT_HEADERS
            });

            // tough-cookie stores the set-cookie response in the jar for the relay
            // domain automatically.  Read it back as our forwarding cookie string.
            if (RELAY_BASE) {
                const jarCookies = jar.getCookiesSync(RELAY_BASE)
                    .map(c => `${c.key}=${c.value}`)
                    .join('; ');
                if (jarCookies) {
                    relayCookies = jarCookies;
                    console.log('Relay cookies from jar:', relayCookies.substring(0, 60) + '...');
                } else {
                    // Fallback: try the x-set-cookie header the relay echoes back
                    const hdr = response.headers['x-set-cookie'];
                    if (hdr) {
                        relayCookies = Array.isArray(hdr) ? hdr.map(c => c.split(';')[0]).join('; ') : hdr.split(';')[0];
                        console.log('Relay cookies from x-set-cookie header:', relayCookies.substring(0, 60) + '...');
                    } else {
                        console.warn('No relay cookie obtained – relay requests may get 403');
                    }
                }
            } else {
                console.log('Session cookie stored in jar for', HOST_URL);
            }
            
            movieboxAppInfo = processApiResponse(response);
            cookiesInitialized = true;
            cookiesInitializedAt = Date.now();
            console.log('Session cookies initialized successfully');
            
            // Log available cookies for debugging
            if (response.headers['set-cookie']) {
                console.log('Received cookies:', response.headers['set-cookie']);
            }
            
        } catch (error) {
            console.error('Failed to get app info:', error.message);
            throw error;
        }
    }
    return cookiesInitialized;
}

async function makeApiRequest(url, options = {}) {
    await ensureCookiesAreAssigned();
    
    const config = {
        url: url,
        headers: { ...DEFAULT_HEADERS, ...options.headers },
        withCredentials: true,
        ...options
    };
    
    try {
        const response = await axiosInstance(config);
        return response;
    } catch (error) {
        console.error(`Request to ${url} failed:`, error.response?.status, error.response?.statusText);
        throw error;
    }
}

async function makeApiRequestWithCookies(url, options = {}) {
    await ensureCookiesAreAssigned();

    // If relay is configured, build the relay URL with params baked in,
    // and forward cookies via X-Forward-Cookie instead of the cookie jar.
    if (RELAY_BASE) {
        let targetUrl = url;
        if (options.params) {
            const qs = new URLSearchParams(options.params).toString();
            targetUrl = url + (url.includes('?') ? '&' : '?') + qs;
        }
        const relayed = relayApiUrl(targetUrl);
        const config = {
            url: relayed,
            method: options.method || 'GET',
            headers: {
                // Pass only neutral headers to the relay. Do NOT spread
                // region headers (CF-Connecting-IP, X-Forwarded-For, etc.)
                // because sending CF-specific headers to a Cloudflare Workers
                // endpoint triggers CF WAF and returns 403.
                // The relay injects its own SA IPs for the upstream call.
                'Accept': 'application/json',
                ...(options.data ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(options.data ? { data: options.data } : {}),
            timeout: 30000
        };
        const resp = await axiosInstance(config);
        return resp;
    }

    const freshBypassHeaders = getRegionBypassHeaders();

    const config = {
        url: url,
        headers: {
            ...DEFAULT_HEADERS,
            ...freshBypassHeaders,
            ...options.headers
        },
        withCredentials: true,
        ...options
    };
    
    try {
        const response = await axiosInstance(config);
        return response;
    } catch (error) {
        console.error(`Request with cookies to ${url} failed:`, error.response?.status, error.response?.statusText);
        throw error;
    }
}

function parseAndValidateCdnUrl(urlParam) {
    if (!urlParam) return null;
    
    try {
        const decoded = decodeURIComponent(urlParam);
        const allowAll = String(process.env.ALLOW_ALL_CDN || '').toLowerCase() === 'true';
        if (allowAll) return decoded;

        const extra = (process.env.ADDITIONAL_CDN_PREFIXES || '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
        const allowed = ALLOWED_CDN_PREFIXES.concat(extra);

        const isValid = allowed.some(prefix => decoded.startsWith(prefix));
        
        if (!isValid) {
            console.warn(`Rejected CDN URL (not in whitelist): ${decoded.substring(0, 80)}...`);
            return null;
        }
        
        return decoded;
    } catch (error) {
        console.error('Failed to parse CDN URL:', error.message);
        return null;
    }
}

function safeDownloadFilename(input, fallback = 'movie.mp4') {
    const cleaned = String(input || '')
        .replace(/[\\/\r\n\"]/g, '_')
        .trim();
    return cleaned || fallback;
}

function decodeUrlParam(param) {
    if (!param) return null;
    try {
        return decodeURIComponent(param);
    } catch (error) {
        console.error('Failed to decode URL parameter:', error.message);
        return param; // Return original if decoding fails
    }
}


// Enhanced date parsing and validation
function parseAndValidateDate(dateString, fallbackYear = '2024') {
    if (!dateString) return fallbackYear;
    
    try {
        // Handle various date formats from the API
        const date = new Date(dateString);
        
        // Check if date is valid
        if (!isNaN(date.getTime())) {
            const year = date.getFullYear();
            // Only return if it's a reasonable year
            const currentYear = new Date().getFullYear();
            if (year >= 1900 && year <= currentYear + 2) {
                return year.toString();
            }
        }
        
        // Try to extract year from string
        const yearMatch = dateString.match(/\b(19|20)\d{2}\b/);
        if (yearMatch) {
            const year = parseInt(yearMatch[0]);
            const currentYear = new Date().getFullYear();
            if (year >= 1900 && year <= currentYear + 2) {
                return year.toString();
            }
        }
        
        return fallbackYear;
    } catch (error) {
        console.log('Date parsing error:', error.message);
        return fallbackYear;
    }
}

// Enhanced movie data processing with real date and subtitle extraction
function enhanceMovieData(movie) {
    if (!movie) return movie;
    
    const currentYear = new Date().getFullYear();
    
    // Priority order for date extraction
    let extractedYear = null;
    
    // 1. Check direct year field
    if (movie.year && typeof movie.year === 'number' && movie.year >= 1900 && movie.year <= currentYear + 2) {
        extractedYear = movie.year.toString();
    }
    else if (movie.year && typeof movie.year === 'string' && /^\d{4}$/.test(movie.year)) {
        const yearNum = parseInt(movie.year);
        if (yearNum >= 1900 && yearNum <= currentYear + 2) {
            extractedYear = movie.year;
        }
    }
    
    // 2. Check releaseYear field
    if (!extractedYear && movie.releaseYear) {
        extractedYear = parseAndValidateDate(movie.releaseYear.toString());
    }
    
    // 3. Check releaseDate field
    if (!extractedYear && movie.releaseDate) {
        extractedYear = parseAndValidateDate(movie.releaseDate);
    }
    
    // 4. Check publishTime field
    if (!extractedYear && movie.publishTime) {
        extractedYear = parseAndValidateDate(movie.publishTime);
    }
    
    // 5. Check createTime field
    if (!extractedYear && movie.createTime) {
        extractedYear = parseAndValidateDate(movie.createTime);
    }
    
    // Set the validated year
    movie.year = extractedYear || '2024';
    
    // Ensure rating is properly formatted
    if (movie.rating) {
        if (typeof movie.rating === 'string') {
            const numRating = parseFloat(movie.rating);
            movie.rating = isNaN(numRating) ? '7.5' : numRating.toFixed(1);
        } else if (typeof movie.rating === 'number') {
            movie.rating = movie.rating.toFixed(1);
        }
    } else {
        movie.rating = '7.5';
    }
    
    // Enhanced subtitle processing
    if (movie.subtitles) {
        // Parse subtitles string into array of languages
        const subtitleLanguages = movie.subtitles.split(',').map(lang => lang.trim()).filter(lang => lang);
        movie.availableSubtitles = subtitleLanguages;
        
        // Set default subtitle (English if available, otherwise first language)
        if (subtitleLanguages.includes('English')) {
            movie.defaultSubtitle = 'English';
        } else if (subtitleLanguages.length > 0) {
            movie.defaultSubtitle = subtitleLanguages[0];
        } else {
            movie.defaultSubtitle = null;
        }
    } else {
        movie.availableSubtitles = [];
        movie.defaultSubtitle = null;
    }
    
    // Ensure thumbnail URL
    if (!movie.thumbnail) {
        if (movie.cover && movie.cover.url) {
            movie.thumbnail = movie.cover.url;
        } else if (movie.stills && movie.stills.url && !movie.thumbnail) {
            movie.thumbnail = movie.stills.url;
        } else if (movie.poster) {
            movie.thumbnail = movie.poster;
        }
    }
    
    return movie;
}


function isBenignStreamError(error) {
    if (!error) return true;
    const code = error.code;
    const message = String(error.message || '');
    return code === 'ERR_STREAM_PREMATURE_CLOSE' ||
        code === 'ECONNRESET' ||
        code === 'EPIPE' ||
        code === 'ECANCELED' ||
        message === 'aborted' ||
        message === 'terminated' ||
        /closed prematurely|socket hang up/i.test(message);
}

// Stream with exact browser Range forwarding and abort-safe cleanup.
async function pipeCdnStream(res, targetUrl, contentDisposition = null, extraHeaders = {}) {
    try {
        // Use cached file size if available — otherwise we'll learn it from the CDN response
        let fileSize = getCachedFileSize(targetUrl) || 0;
        if (fileSize > 0) console.log(`File size from cache: ${fileSize}`);

        // Handle range requests from the browser
        const rangeHeader = res.req.headers.range;

        // Fresh forwarding identity for each MP4/CDN request.
        // The CDN must be explicitly configured to trust these headers;
        // they do not change the actual TCP source IP of this server.
        const regionBypassHeaders = getRegionBypassHeaders();

        const requestHeaders = {
            ...CDN_PROXY_HEADERS,
            ...regionBypassHeaders,
            ...extraHeaders
        };

        // Forward the browser's Range exactly. This preserves suffix ranges
        // such as bytes=-500 and lets the CDN define the authoritative range.
        delete requestHeaders.Range;

        console.log(
            `[CDN] MP4 request identity: ${regionBypassHeaders['X-Forwarded-For']}`
        );
        // Preserve an explicit provider/session Referer and Origin. For legacy
        // URL-only requests retain the existing hakunaymatata.com behavior.
        if (targetUrl.includes('hakunaymatata.com') && !extraHeaders.Referer) {
            requestHeaders.Referer = 'https://lok-lok.cc';
            requestHeaders.Origin = 'https://lok-lok.cc';
        }
        
        let start = 0;
        let end = 0;
        let chunksize = 0;
        let statusCode = 200;

        if (rangeHeader) {
            requestHeaders.Range = rangeHeader;
            console.log(`Forwarding range header as-is: ${rangeHeader}`);
        }

        // Make the actual streaming request
        let response;
        try {
            response = await axios({
                method: 'GET',
                url: targetUrl,
                responseType: 'stream',
                headers: requestHeaders,
                timeout: 0,
                maxRedirects: 5
            });
        } catch (err) {
            if (err.response && err.response.status === 403) {
                const altHeaders = {
                    ...requestHeaders,
                    Referer: extraHeaders.Referer || HOST_URL,
                    Origin: extraHeaders.Origin || HOST_URL
                };
                response = await axios({
                    method: 'GET',
                    url: targetUrl,
                    responseType: 'stream',
                    headers: altHeaders,
                    timeout: 0,
                    maxRedirects: 5
                });
            } else {
                throw err;
            }
        }

        // If we didn't know the file size, try to get it from the GET response
        if (fileSize === 0) {
            if (response.headers['content-range']) {
                const totalMatch = response.headers['content-range'].match(/\/(\d+)/);
                if (totalMatch) fileSize = parseInt(totalMatch[1]);
            }
            if (fileSize === 0 && response.headers['content-length']) {
                fileSize = parseInt(response.headers['content-length']) || 0;
            }
            if (fileSize > 0) setCachedFileSize(targetUrl, fileSize);
        }

        // Determine response status from CDN response
        const upstreamContentRange = response.headers['content-range'];
        if (response.status === 206 && upstreamContentRange) {
            statusCode = 206;
            const rangeMatch = upstreamContentRange.match(/bytes (\d+)-(\d+)\/(\d+)/);
            if (rangeMatch) {
                start = parseInt(rangeMatch[1]);
                end = parseInt(rangeMatch[2]);
                fileSize = parseInt(rangeMatch[3]);
                chunksize = (end - start) + 1;
            }
        }

        // Set response headers
        const headers = {
            'Content-Type': response.headers['content-type'] || 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Range',
            'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges'
        };

        if (statusCode === 206 && fileSize > 0) {
            headers['Content-Range'] = upstreamContentRange;
            headers['Content-Length'] = response.headers['content-length'] || chunksize;
            res.status(206);
        } else {
            if (response.headers['content-length']) {
                headers['Content-Length'] = response.headers['content-length'];
            } else if (fileSize > 0) {
                headers['Content-Length'] = fileSize;
            }
        }

        if (contentDisposition) {
            headers['Content-Disposition'] = contentDisposition;
        }

        res.set(headers);

        const onClientClose = () => {
            if (!res.writableFinished && response.data.destroy) {
                response.data.destroy();
            }
        };
        res.once('close', onClientClose);
        try {
            await pipeline(response.data, res);
        } catch (streamError) {
            if (!isBenignStreamError(streamError)) throw streamError;
        } finally {
            res.removeListener('close', onClientClose);
        }

    } catch (error) {
        console.error('Failed to pipe CDN stream:', error.message);
        if (!res.headersSent) {
            const upstreamStatus = Number(error.response?.status);
            const responseStatus = (upstreamStatus >= 400 && upstreamStatus < 600)
                ? upstreamStatus
                : 502;
            const retryAfter = error.response?.headers?.['retry-after'];
            if (retryAfter) res.set('Retry-After', String(retryAfter));
            res.status(responseStatus).json({
                status: 'error',
                message: responseStatus === 429
                    ? 'The upstream CDN is rate-limiting this server'
                    : 'The upstream stream could not be fetched',
                upstreamStatus: upstreamStatus || null
            });
        }
    }
}

// SportsNow live HLS relay. The upstream CDN requires sportsnow.top as
// Referer/Origin and rejects direct browser requests from hm-cinema.me. Keep the
// allow-list narrow and rewrite every playlist URI so segments use this relay too.
const SPORTSNOW_STREAM_HOST = 'live-pull.aisports.mobi';
const SPORTSNOW_STREAM_HEADERS = {
    'User-Agent': 'Mozilla/5.0',
    'Referer': 'https://sportsnow.top/',
    'Origin': 'https://sportsnow.top',
    'Accept': '*/*',
    'Accept-Encoding': 'identity'
};

function isSportsNowStreamUrl(rawUrl) {
    try {
        const parsed = new URL(String(rawUrl || ''));
        return parsed.protocol === 'https:' && parsed.hostname === SPORTSNOW_STREAM_HOST;
    } catch (_) {
        return false;
    }
}

function sportsNowProxyTarget(rawUrl, baseUrl) {
    try {
        const absolute = new URL(String(rawUrl || ''), baseUrl);
        if (!isSportsNowStreamUrl(absolute.toString())) return String(rawUrl || '');
        return '/api/sportsnow/stream?url=' + encodeURIComponent(absolute.toString());
    } catch (_) {
        return String(rawUrl || '');
    }
}

function rewriteSportsNowManifest(manifest, baseUrl) {
    return String(manifest).split(/\r?\n/).map(line => {
        const uriLine = line.replace(/URI=(['"])([^'"]+)\1/gi, (whole, quote, uri) => {
            const proxied = sportsNowProxyTarget(uri, baseUrl);
            return proxied === uri ? whole : 'URI=' + quote + proxied + quote;
        });
        if (uriLine !== line || !uriLine.trim() || uriLine.trim().startsWith('#')) return uriLine;
        const trimmed = uriLine.trim();
        const proxied = sportsNowProxyTarget(trimmed, baseUrl);
        if (proxied === trimmed) return uriLine;
        return uriLine.slice(0, uriLine.indexOf(trimmed)) + proxied;
    }).join('\n');
}

app.get('/api/sportsnow/stream', async (req, res) => {
    const targetUrl = String(req.query.url || '');
    if (!isSportsNowStreamUrl(targetUrl)) {
        return res.status(400).json({ status: 'error', message: 'Invalid SportsNow stream URL' });
    }

    const requestHeaders = { ...SPORTSNOW_STREAM_HEADERS };
    if (req.headers.range) requestHeaders.Range = req.headers.range;
    const isPlaylist = /\.m3u8(?:$|\?)/i.test(new URL(targetUrl).pathname + new URL(targetUrl).search);

    try {
        const upstream = await axios.get(targetUrl, {
            headers: requestHeaders,
            responseType: isPlaylist ? 'text' : 'stream',
            timeout: 20000,
            maxRedirects: 5,
            validateStatus: status => status >= 200 && status < 400
        });

        res.set({
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'
        });

        if (isPlaylist) {
            const finalUrl = upstream.request?.res?.responseUrl || targetUrl;
            res.type('application/vnd.apple.mpegurl').send(rewriteSportsNowManifest(upstream.data, finalUrl));
            return;
        }

        for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
            if (upstream.headers[header]) res.set(header, upstream.headers[header]);
        }
        res.status(upstream.status);
        upstream.data.on('error', () => { if (!res.headersSent) res.status(502).end(); else res.end(); });
        upstream.data.pipe(res);
        res.on('close', () => { if (upstream.data.destroy) upstream.data.destroy(); });
    } catch (error) {
        const status = Number(error.response?.status);
        console.error('SportsNow stream relay error:', status || error.message);
        if (!res.headersSent) {
            res.status(status >= 400 && status < 600 ? status : 502).json({
                status: 'error',
                message: 'SportsNow stream could not be fetched',
                upstreamStatus: status || null
            });
        }
    }
});

// SportsNow replay/highlight MP4 relay. Keeping clips same-origin avoids
// browser hotlink and cross-origin playback failures from the provider CDN.
const SPORTSNOW_CLIP_HOST = 'lacdn.aoneroom.com';
const SPORTSNOW_CLIP_HEADERS = {
    'User-Agent': 'Mozilla/5.0',
    'Referer': 'https://sportsnow.top/',
    'Origin': 'https://sportsnow.top',
    'Accept': 'video/mp4,video/*,*/*;q=0.8',
    'Accept-Encoding': 'identity'
};
function isSportsNowClipUrl(rawUrl) {
    try {
        const parsed = new URL(String(rawUrl || ''));
        return parsed.protocol === 'https:' && parsed.hostname === SPORTSNOW_CLIP_HOST;
    } catch (_) {
        return false;
    }
}
app.get('/api/sportsnow/clip', async (req, res) => {
    const targetUrl = String(req.query.url || '');
    if (!isSportsNowClipUrl(targetUrl)) {
        return res.status(400).json({ status: 'error', message: 'Invalid SportsNow clip URL' });
    }
    const requestHeaders = { ...SPORTSNOW_CLIP_HEADERS };
    if (req.headers.range) requestHeaders.Range = req.headers.range;
    try {
        const upstream = await axios.get(targetUrl, {
            headers: requestHeaders,
            responseType: 'stream',
            timeout: 30000,
            maxRedirects: 5,
            validateStatus: status => status >= 200 && status < 400
        });
        res.set({
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'
        });
        for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
            if (upstream.headers[header]) res.set(header, upstream.headers[header]);
        }
        res.status(upstream.status);
        upstream.data.on('error', () => { if (!res.headersSent) res.status(502).end(); else res.end(); });
        upstream.data.pipe(res);
        res.on('close', () => { if (upstream.data.destroy) upstream.data.destroy(); });
    } catch (error) {
        const status = Number(error.response?.status);
        console.error('SportsNow clip relay error:', status || error.message);
        if (!res.headersSent) {
            res.status(status >= 400 && status < 600 ? status : 502).json({
                status: 'error',
                message: 'SportsNow clip could not be fetched',
                upstreamStatus: status || null
            });
        }
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// -----------------------------------------------------------------------------
// SEO: search-engine-friendly per-movie / per-show pages.
//
// /movie/:id and /tv/:id (with optional decorative /:slug) return the SPA
// template with title/description/OG tags/canonical/JSON-LD swapped in for
// the requested title. Real users see the SPA and the deep-link bootstrap
// (in index.html) auto-opens the modal for that movie. Crawlers see rich,
// indexable HTML so each title can rank for its own keywords.
// -----------------------------------------------------------------------------

// Wire the seo module to our existing API helpers — we share the cookie jar
// and rate-limited makeApiRequestWithCookies path. Done after the helpers are
// declared above (they're hoisted in module scope by `function` declarations).
seo.configure({
    getMovieInfo: async (id) => {
        // Retry up to 3 times — same policy as /api/info to survive token expiry
        // and transient upstream errors without poisoning the negative cache too quickly.
        let _seoResponse;
        for (let _attempt = 1; _attempt <= 3; _attempt++) {
            const _seoJwt = await getLokLokToken();
            const _seoUrl = RELAY_BASE
                ? `${RELAY_BASE}/relay?url=${encodeURIComponent(`${HOST_URL}/wefeed-h5-bff/web/subject/detail?subjectId=${id}`)}`
                : `${HOST_URL}/wefeed-h5-bff/web/subject/detail?subjectId=${id}`;
            try {
                _seoResponse = await axiosInstance({
                    method: 'GET',
                    url: _seoUrl,
                    headers: {
                        'Accept': 'application/json',
                        'X-Client-Info': JSON.stringify({timezone: 'Africa/Accra'}),
                        'Authorization': `Bearer ${_seoJwt}`,
                        'X-Request-Lang': 'en'
                    },
                    timeout: 15000
                });
                break; // success — exit retry loop
            } catch (_err) {
                const _s = _err.response && _err.response.status;
                if (_attempt < 3 && (_s === 403 || _s === 429 || (_s && _s >= 500))) {
                    if (_s === 403) { _lokLokToken = ''; } // force fresh token
                    await new Promise(r => setTimeout(r, 800 * _attempt));
                    continue;
                }
                throw _err; // out of retries or non-retryable error
            }
        }
        return processApiResponse(_seoResponse);
    },
    getCatalogLists: async () => {
        // Fetch 10 pages of trending (perPage=60) in parallel = up to 600 unique
        // titles in the sitemap. Each page may fail independently.
        const safe = (p) => p.then(x => x).catch(() => null);
        const SMAP_HEADERS = { 'Accept': 'application/json', 'X-Client-Info': JSON.stringify({timezone:'Africa/Accra'}), 'X-Request-Lang': 'en' };
        const requests = Array.from({ length: 10 }, (_, i) =>
            safe(axiosInstance({ url: `${SEARCH_HOST_URL}/wefeed-h5api-bff/subject/trending?page=${i}&perPage=60`, headers: SMAP_HEADERS }))
        );
        const results = await Promise.all(requests);
        const lists = [];
        for (const r of results) {
            if (!r) continue;
            const data = processApiResponse(r);
            // Normalize to a flat array of subject-like items.
            if (Array.isArray(data?.subjectList)) lists.push(data.subjectList);
            else if (Array.isArray(data?.items)) lists.push(data.items);
            else if (Array.isArray(data?.records)) lists.push(data.records);
        }
        return lists;
    },
});

// Bots / link-preview crawlers that need server-rendered SEO meta tags.
// Regular browsers get movie.html served directly so the upstream API call
// never blocks or rate-limits a real user visit.
const CRAWLER_RE = /Googlebot|bingbot|Baiduspider|YandexBot|Slurp|DuckDuckBot|facebookexternalhit|Facebot|Twitterbot|WhatsApp|TelegramBot|LinkedInBot|Discordbot|Slackbot|ia_archiver/i;
function isCrawler(req) {
    return CRAWLER_RE.test(req.headers['user-agent'] || '');
}

// Shared handler for /movie/:id/:slug? and /tv/:id/:slug?
async function handleSeoTitlePage(req, res, isTv) {
    const { id } = req.params;
    // Accept only numeric subjectIds — anything else is almost certainly an
    // attempt to probe for files and would just waste an upstream call.
    if (!/^\d+$/.test(id)) {
        return res.status(404).sendFile(path.join(__dirname, '404.html'));
    }
    // Non-crawler: serve movie.html instantly; client JS fetches data itself
    if (!isCrawler(req)) {
        return res.sendFile(path.join(__dirname, 'movie.html'));
    }
    try {
        const data = await seo.fetchMovieCached(id);
        const subject = data && (data.subject || data);
        const stars = (data && data.stars) || [];
        if (!subject || !subject.title) {
            // Never synthesize a title from the URL slug. That creates
            // indexable soft-404 pages for arbitrary IDs and fake titles.
            return res.status(404).sendFile(path.join(__dirname, 'movie.html'));
        }

        const subjectIsTv = subject.subjectType === 2;
        const canonical = seo.baseUrl(req) + seo.urlFor(subject);

        // 301 redirect when the URL prefix doesn't match the content type.
        // e.g. /movie/4553172416389965520 for a TV series should redirect to
        // /tv/4553172416389965520/the-last-teal-dragon so Google has one clear
        // canonical URL and doesn't split signals between /movie/ and /tv/.
        if (subjectIsTv !== isTv) {
            return res.redirect(301, canonical);
        }

        const html = seo.renderSeoHtml({
            template: seo.getMovieTemplate(),
            subject,
            stars,
            isTv: subjectIsTv,
            canonicalUrl: canonical,
        });
        res.type('html').send(html);
    } catch (e) {
        console.error('[SEO] handleSeoTitlePage error:', e.message);
        // Return 503 (not 200) so search engines don't soft-index a broken
        // page during an upstream outage — they'll just retry later.
        res.status(503).sendFile(path.join(__dirname, 'movie.html'));
    }
}

// Express 5 removed the `?` optional-segment syntax — register both forms.
app.get('/movie/:id',       (req, res) => handleSeoTitlePage(req, res, false));
app.get('/movie/:id/:slug', (req, res) => handleSeoTitlePage(req, res, false));
app.get('/tv/:id',            (req, res) => handleSeoTitlePage(req, res, true));
app.get('/tv/:id/:slug',      (req, res) => handleSeoTitlePage(req, res, true));
app.get('/sports',            (req, res) => res.sendFile(path.join(__dirname, 'sports.html')));
app.get('/watch/:id',         (req, res) => {
    res.set('X-Robots-Tag', 'noindex, follow');
    return res.sendFile(path.join(__dirname, 'watch.html'));
});

// Static metadata routes
app.get('/sitemap.xml', async (req, res) => {
    try {
        res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=300');
        // Serve the pre-built full-catalog sitemap if it exists (generated by build-sitemap.js).
        // Falls back to the live dynamic sitemap so the route never breaks.
        const _prebuilt = path.join(__dirname, 'sitemap-full.xml');
        if (require('fs').existsSync(_prebuilt)) {
            return res.type('application/xml').sendFile(_prebuilt);
        }
        const xml = await seo.buildSitemapXml(req);
        res.type('application/xml').send(xml);
    } catch (e) {
        console.error('[SEO] sitemap error:', e.message);
        // Fall back to a minimal sitemap so search engines never see a 500.
        const root = seo.baseUrl(req);
        res.type('application/xml').send(
            '<?xml version="1.0" encoding="UTF-8"?>\n' +
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
            `  <url><loc>${root}/</loc><priority>1.0</priority><changefreq>daily</changefreq></url>\n` +
            '</urlset>\n'
        );
    }
});

app.get('/robots.txt', (req, res) => {
    const robots = `User-agent: *\nAllow: /\n\nSitemap: ${seo.baseUrl(req)}/sitemap.xml\n`;
    res.type('text/plain').send(robots);
});

app.get('/site.webmanifest', (req, res) => {
    res.sendFile(path.join(__dirname, 'site.webmanifest'));
});

// Fallback icon route: serves local icon.png when present; otherwise a 1x1 transparent PNG
app.get('/icon.png', (req, res) => {
    const iconPath = path.join(__dirname, 'icon.png');
    res.sendFile(iconPath, (err) => {
        if (err) {
            const transparentPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOeZgBsAAAAASUVORK5CYII=';
            const buffer = Buffer.from(transparentPngBase64, 'base64');
            res.set('Content-Type', 'image/png');
            res.send(buffer);
        }
    });
});

// Standard favicon route for crawlers and browsers
app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'favicon.ico'));
});

// Homepage content
app.get('/api/homepage', async (req, res) => {
    try {
        const _hk = 'homepage';
        const _hc = homeCache.get(_hk);
        if (_hc) return res.json(_hc);

        const _hr = await coalesceRequest('api:homepage', async () => {
            const response = await axios.get(
                `${SEARCH_HOST_URL}/wefeed-h5api-bff/home?host=h5.aoneroom.com`,
                { headers: { 'Accept': 'application/json', 'User-Agent': 'HM-Cinema/1.0 (+https://hm-cinema.me)' }, timeout: 30000 }
            );
            const content = processApiResponse(response);
            return { status: 'success', creator:'Hector Manuel ', data: content };
        });
        homeCache.set(_hk, _hr);
        res.json(_hr);
    } catch (error) {
        console.error('Homepage error:', error.message);
        res.status(500).json({
            status: 'error',
            creator:'Hector Manuel ',
            message: 'Failed to fetch homepage content',
            error: error.message
        });
    }
});

// Trending content
app.get('/api/trending', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 0;
        const perPage = parseInt(req.query.perPage) || 18;
        
        const params = {
            page,
            perPage,
            uid: '5591179548772780352'
        };
        
        const _tk = `trending_${page}_${perPage}`;
        const _tc = homeCache.get(_tk);
        if (_tc) return res.json(_tc);

        const _tr = await coalesceRequest(`api:${_tk}`, async () => {
            const response = await axios.get(
                `${SEARCH_HOST_URL}/wefeed-h5api-bff/subject/trending?page=${page}&perPage=${perPage}`,
                { headers: { 'Accept': 'application/json', 'User-Agent': 'HM-Cinema/1.0 (+https://hm-cinema.me)' }, timeout: 30000 }
            );
            const content = processApiResponse(response);
            return { status: 'success', creator:'Hector Manuel ', data: content };
        });
        homeCache.set(_tk, _tr);
        res.json(_tr);
    } catch (error) {
        console.error('Trending error:', error.message);
        res.status(500).json({
            status: 'error',
            creator:'Hector Manuel ',
            message: 'Failed to fetch trending content',
            error: error.message
        });
    }
});

// Hot content
app.get('/api/hot', async (req, res) => {
    try {
        const _hotc = homeCache.get('hot');
        if (_hotc) return res.json(_hotc);

        const _hotr = await coalesceRequest('api:hot', async () => {
            const response = await axios.get(
                `${SEARCH_HOST_URL}/wefeed-h5api-bff/subject/trending?page=1&perPage=18`,
                { headers: { 'Accept': 'application/json', 'User-Agent': 'HM-Cinema/1.0 (+https://hm-cinema.me)' }, timeout: 30000 }
            );
            const content = processApiResponse(response);
            return { status: 'success', creator:'Hector Manuel ', data: content };
        });
        homeCache.set('hot', _hotr);
        res.json(_hotr);
    } catch (error) {
        console.error('Hot content error:', error.message);
        res.status(500).json({
            status: 'error',
            creator:'Hector Manuel ',
            message: 'Failed to fetch hot content',
            error: error.message
        });
    }
});

// Popular searches
app.get('/api/popular', async (req, res) => {
    try {
        const _popc = homeCache.get('popular');
        if (_popc) return res.json(_popc);

        const _popr = await coalesceRequest('api:popular', async () => {
            const response = await axios.get(
                `${SEARCH_HOST_URL}/wefeed-h5api-bff/subject/everyone-search`,
                { headers: { 'Accept': 'application/json', 'User-Agent': 'HM-Cinema/1.0 (+https://hm-cinema.me)' }, timeout: 30000 }
            );
            const content = processApiResponse(response);
            return { status: 'success', creator:'Hector Manuel ', data: content };
        });
        homeCache.set('popular', _popr);
        res.json(_popr);
    } catch (error) {
        console.error('Popular searches error:', error.message);
        res.status(500).json({
            status: 'error',
            creator:'Hector Manuel ',
            message: 'Failed to fetch popular searches',
            error: error.message
        });
    }
});

// Search movies and TV series - FIXED to handle GET requests
app.get('/api/search/:query', async (req, res) => {
    try {
        const { query } = req.params;
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.perPage) || 24;
        const subjectType = parseInt(req.query.type) || SubjectType.ALL;

        const _sqck = `${query}_${page}_${perPage}_${subjectType}`;
        const _sqcc = searchCache.get(_sqck);
        if (_sqcc) return res.json(_sqcc);

        const payload = {
            keyword: query,
            page,
            perPage,
            subjectType
        };
        
        const _sqr = await coalesceRequest(`api:search:${_sqck}`, async () => {
            const response = await makeSearchApiRequest(
                payload.keyword,
                payload.page,
                payload.perPage,
                payload.subjectType
            );
            let content = processApiResponse(response);

            // Filter results by subject type if specified
            if (subjectType !== SubjectType.ALL && content.items) {
                content.items = content.items.filter(item => item.subjectType === subjectType);
            }

            // Enhance each item with easily accessible thumbnail
            if (content.items) {
                content.items.forEach(item => {
                    if (item.cover && item.cover.url) {
                        item.thumbnail = item.cover.url;
                    }
                    if (item.stills && item.stills.url && !item.thumbnail) {
                        item.thumbnail = item.stills.url;
                    }
                });
            }

            return { status: 'success', creator:'Hector Manuel ', data: content };
        });
        searchCache.set(`${query}_${page}_${perPage}_${subjectType}`, _sqr);
        res.json(_sqr);
    } catch (error) {
        console.error('Search error:', error.message);
        res.status(500).json({
            status: 'error',
            creator:'Hector Manuel ',
            message: 'Failed to search content',
            error: error.message
        });
    }
});

// ADD THIS - Handle search without query parameter for general searches
app.get('/api/search', async (req, res) => {
    try {
        const query = req.query.q || 'movie'; // Default to 'movie' if no query
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.perPage) || 24;
        const subjectType = parseInt(req.query.type) || SubjectType.ALL;

        const _sq2ck = `${query}_${page}_${perPage}_${subjectType}`;
        const _sq2cc = searchCache.get(_sq2ck);
        if (_sq2cc) return res.json(_sq2cc);

        const payload = {
            keyword: query,
            page,
            perPage,
            subjectType
        };
        
        const _sq2r = await coalesceRequest(`api:search:${_sq2ck}`, async () => {
            const response = await makeSearchApiRequest(
                payload.keyword,
                payload.page,
                payload.perPage,
                payload.subjectType
            );
            let content = processApiResponse(response);

            // Filter results by subject type if specified
            if (subjectType !== SubjectType.ALL && content.items) {
                content.items = content.items.filter(item => item.subjectType === subjectType);
            }

            // Enhance each item with easily accessible thumbnail
            if (content.items) {
                content.items.forEach(item => {
                    if (item.cover && item.cover.url) {
                        item.thumbnail = item.cover.url;
                    }
                    if (item.stills && item.stills.url && !item.thumbnail) {
                        item.thumbnail = item.stills.url;
                    }
                });
            }

            return { status: 'success', creator:'Hector Manuel ', data: content };
        });
        searchCache.set(`${query}_${page}_${perPage}_${subjectType}`, _sq2r);
        res.json(_sq2r);
    } catch (error) {
        console.error('Search error:', error.message);
        res.status(500).json({
            status: 'error',
            creator:'Hector Manuel ',
            message: 'Failed to search content',
            error: error.message
        });
    }
});

async function hydrateTvSeasonMetadata(content, movieId) {
    if (!episodeMetadata.needsSeasonHydration(content)) return content;

    const detailPath = content.subject?.detailPath;
    if (!detailPath) return content;

    try {
        const token = await getLokLokToken();
        if (!token) return content;

        const response = await axios.get(
            `${SEARCH_HOST_URL}/wefeed-h5api-bff/detail`,
            {
                params: { detailPath },
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'Cookie': `token=${token}`,
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36',
                    'Referer': `https://mzfi.me/spa/videoPlayPage/movies/${detailPath}?id=${movieId}&type=/movie/detail&lang=en`,
                    'Origin': 'https://mzfi.me',
                    'X-Client-Info': JSON.stringify({ timezone: 'Africa/Accra' }),
                    'X-Request-Lang': 'en',
                    'X-Source': '',
                    'X-No-High-Risk-Restrict': '0',
                    'X-Vip-Restrict': '1'
                },
                timeout: 15000
            }
        );
        const detail = processApiResponse(response);
        const enriched = episodeMetadata.mergeSeasonDetail(content, detail, movieId);
        if (episodeMetadata.getSeasons(enriched).length > 0) {
            console.log('[Info] Filled missing TV seasons from H5 detail response');
        }
        return enriched;
    } catch (error) {
        const status = Number(error.response?.status) || 0;
        console.warn(`[Info] H5 season lookup failed${status ? ` (HTTP ${status})` : ''}`);
        return content;
    }
}

// Get movie/series detailed information
app.get('/api/info/:movieId', async (req, res) => {
    try {
        const { movieId } = req.params;

        const _ic = infoCache.get(movieId);
        if (_ic && !episodeMetadata.needsSeasonHydration(_ic.data)) {
            return res.json(_ic);
        }
        if (_ic) infoCache.del(movieId);

        // Try the SEO module's cache first — crawler visits already populated it
        const _seoHit = await seo.fetchMovieCached(movieId).catch(() => null);
        if (_seoHit && (_seoHit.subject || _seoHit.data)) {
            let seoContent = _seoHit.data?.subject ? _seoHit.data : _seoHit;
            seoContent = await hydrateTvSeasonMetadata(seoContent, movieId);
            const _cached = { status: 'success', creator:'Hector Manuel ', data: seoContent };
            if (!episodeMetadata.needsSeasonHydration(seoContent)) {
                infoCache.set(movieId, _cached);
            }
            return res.json(_cached);
        }

        // Upstream call with up to 3 retries on 403/5xx (temporary rate-limit)
        let response;
        for (let _attempt = 1; _attempt <= 3; _attempt++) {
            const _infoJwt = await getLokLokToken();
            const _infoUrl = RELAY_BASE
                ? `${RELAY_BASE}/relay?url=${encodeURIComponent(`${HOST_URL}/wefeed-h5-bff/web/subject/detail?subjectId=${movieId}`)}`
                : `${HOST_URL}/wefeed-h5-bff/web/subject/detail?subjectId=${movieId}`;
            try {
                response = await axiosInstance({
                    method: 'GET',
                    url: _infoUrl,
                    headers: {
                        'Accept': 'application/json',
                        'X-Client-Info': JSON.stringify({timezone: 'Africa/Accra'}),
                        'Authorization': `Bearer ${_infoJwt}`,
                        'X-Request-Lang': 'en'
                    },
                    timeout: 15000
                });
                break; // success — exit retry loop
            } catch (_err) {
                const _status = _err.response && _err.response.status;
                if (_attempt < 3 && (_status === 403 || _status === 429 || _status >= 500)) {
                    if (_status === 403) { _lokLokToken = ''; } // force fresh token on next attempt
                    await new Promise(r => setTimeout(r, 800 * _attempt));
                    continue;
                }
                throw _err; // out of retries or non-retryable error
            }
        }
        
        let content = processApiResponse(response);
        content = await hydrateTvSeasonMetadata(content, movieId);
        
        // Add easily accessible thumbnail URLs and enhance subtitle data
        if (content.subject) {
            if (content.subject.cover && content.subject.cover.url) {
                content.subject.thumbnail = content.subject.cover.url;
            }
            if (content.subject.stills && content.subject.stills.url && !content.subject.thumbnail) {
                content.subject.thumbnail = content.subject.stills.url;
            }
            
            // Enhance subtitle data
            if (content.subject.subtitles) {
                const subtitleLanguages = content.subject.subtitles.split(',').map(lang => lang.trim()).filter(lang => lang);
                content.subject.availableSubtitles = subtitleLanguages;
                
                if (subtitleLanguages.includes('English')) {
                    content.subject.defaultSubtitle = 'English';
                } else if (subtitleLanguages.length > 0) {
                    content.subject.defaultSubtitle = subtitleLanguages[0];
                } else {
                    content.subject.defaultSubtitle = null;
                }
            } else {
                content.subject.availableSubtitles = [];
                content.subject.defaultSubtitle = null;
            }
        }
        
        const _ir = { status: 'success', creator:'Hector Manuel ', data: content };
        if (!episodeMetadata.needsSeasonHydration(content)) {
            infoCache.set(movieId, _ir);
        }
        res.json(_ir);
    } catch (error) {
        console.error('Info error:', error.message);
        const _upStatus = error.response && error.response.status;
        const _httpCode = (_upStatus === 404) ? 404 : 500;
        res.status(_httpCode).json({
            status: 'error',
            creator:'Hector Manuel ',
            message: 'Failed to fetch movie/series info',
            error: error.message
        });
    }
});



// Get streaming sources/download links
app.get('/api/sources/:movieId', async (req, res) => {
    try {
        const { movieId } = req.params;
        const season = parseInt(req.query.season) || 0; // Movies use 0 for season
        const episode = parseInt(req.query.episode) || 0; // Movies use 0 for episode
        
        const cacheKey = `${movieId}_${season}_${episode}`;
        const cached = getCachedSources(cacheKey);
        if (cached) {
            console.log(`Serving cached sources for movieId: ${movieId}`);
            return res.json(cached);
        }

        // First get movie details to get the detailPath for the referer
        console.log(`Getting sources for movieId: ${movieId}`);

        // Accept a pre-resolved detailPath (e.g. from the dubs endpoint) to skip
        // the info lookup. Dubbed subjectIds often have no standalone info entry.
        let detailPath = req.query.detailPath || null;

        if (!detailPath) {
        const _srcJwt = await getLokLokToken();
        const _srcUrl = RELAY_BASE
            ? `${RELAY_BASE}/relay?url=${encodeURIComponent(`${HOST_URL}/wefeed-h5-bff/web/subject/detail?subjectId=${movieId}`)}`
            : `${HOST_URL}/wefeed-h5-bff/web/subject/detail?subjectId=${movieId}`;
        const infoResponse = await axiosInstance({
                method: 'GET',
                url: _srcUrl,
                headers: {
                    'Accept': 'application/json',
                    'X-Client-Info': JSON.stringify({timezone: 'Africa/Accra'}),
                    'Authorization': `Bearer ${_srcJwt}`,
                    'X-Request-Lang': 'en'
                },
                timeout: 15000
            })
        
        const movieInfo = processApiResponse(infoResponse);
        detailPath = movieInfo?.subject?.detailPath;
        } // end if (!detailPath) -- skip info lookup when detailPath provided

        if (!detailPath) {
            throw new Error('Could not get movie detail path for referer header');
        }
        
        // Create the proper referer header - MUST use h5.aoneroom.com/movies/{detailPath} format
        // Without this specific referer format, the API returns empty downloads
        const refererUrl = `${HOST_URL}/movies/${detailPath}`;
        console.log(`Using referer: ${refererUrl}`);
        
        const params = {
            subjectId: movieId,
            se: season,
            ep: episode
        };
        
        const regionConfigs = [
            {
                name: 'US',
                headers: {
                    'X-Forwarded-For': '104.28.0.' + Math.floor(Math.random() * 255),
                    'CF-Connecting-IP': '104.28.0.' + Math.floor(Math.random() * 255),
                    'X-Client-Info': '{"timezone":"America/New_York"}',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            },
            {
                name: 'SA',
                headers: getRegionBypassHeaders()
            },
            {
                name: 'NoSpoof',
                headers: {}
            },
            {
                name: 'UK',
                headers: {
                    'X-Forwarded-For': '185.86.151.' + Math.floor(Math.random() * 255),
                    'CF-Connecting-IP': '185.86.151.' + Math.floor(Math.random() * 255),
                    'X-Client-Info': '{"timezone":"Europe/London"}',
                    'Accept-Language': 'en-GB,en;q=0.9'
                }
            }
        ];

        const paramCombos = [params];
        if (season === 0 && episode === 0) {
            paramCombos.push({ subjectId: movieId, se: 1, ep: 1 });
        }

        // PRIMARY: lok-lok.cc direct (Ghana IP spoof - relay CF IPs get rate-limited by CloudFront)
        let content = null;
        const _activeLokToken = await getLokLokToken();

        // Current browser traffic uses the h5-api play contract. It returns
        // signed, browser-compatible MP4 streams (and optional DASH entries)
        // when the bearer token is sent together with the token cookie.
        // Prefer this response over the older lok-lok.cc download contract.
        if (!content && _activeLokToken) {
            try {
                // Movies use se=0/ep=0. Series callers provide their real season/episode.
                // Forcing movies to 1/1 makes the H5 play contract return no streams.
                const playSe = season;
                const playEp = episode;
                const playUrl = 'https://mzfi.me/wefeed-h5api-bff/subject/play';
                const playResponse = await axios.get(playUrl, {
                    params: {
                        subjectId: movieId,
                        se: playSe,
                        ep: playEp,
                        detailPath,
                        streamSignType: 1,
                        'supportCodecs[hevc]': 1,
                        'supportCodecs[h264]': 1
                    },
                    headers: {
                        'Accept': 'application/json',
                        'Authorization': 'Bearer ' + _activeLokToken,
                        'Cookie': 'token=' + _activeLokToken,
                        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36',
                        'Referer': `https://mzfi.me/spa/videoPlayPage/movies/${detailPath}?id=${movieId}&type=/movie/detail&lang=en`,
                        'Origin': 'https://mzfi.me',
                        'X-Client-Info': JSON.stringify({timezone: 'Africa/Accra'}),
                        'X-Request-Lang': 'en',
                        'X-Source': '',
                        'X-No-High-Risk-Restrict': '0',
                        'X-Vip-Restrict': '1'
                    },
                    timeout: 15000
                });
                const playData = processApiResponse(playResponse);
                const playStreams = Array.isArray(playData?.streams) ? playData.streams : [];
                const playDash = Array.isArray(playData?.dash) ? playData.dash : [];

                // The browser contract can return DASH even when the MP4 streams
                // array is empty. Keep that DASH source: its short-lived URL and
                // X-MB-Token are what the browser uses successfully.
                if (playStreams.length > 0 || playDash.length > 0) {
                    content = {
                        downloads: playStreams
                            .filter(stream => stream && stream.url)
                            .map(stream => ({
                                id: stream.id,
                                url: stream.url,
                                resolution: stream.resolutions,
                                size: parseInt(stream.size) || 0,
                                duration: stream.duration,
                                format: stream.format || 'mp4',
                                signCookie: stream.signCookie || '',
                                signHeaderKey: stream.signHeaderKey || 'X-MB-Token'
                            })),
                        captions: playData.captions || [],
                        hasResource: playData.hasResource !== false,
                        dash: playDash
                            .filter(stream => stream && stream.url)
                            .map(stream => ({
                                id: stream.id,
                                url: stream.url,
                                resolutions: stream.resolutions,
                                size: parseInt(stream.size) || 0,
                                duration: stream.duration,
                                format: stream.format || 'dash',
                                signCookie: stream.signCookie || '',
                                signHeaderKey: stream.signHeaderKey || 'X-MB-Token'
                            }))
                    };
                    console.log('mzfi play returned ' + content.downloads.length + ' MP4 stream(s) and ' + content.dash.length + ' DASH stream(s)');
                } else {
                    console.log('mzfi play returned no playable streams, falling back to lok-lok.cc');
                }
            } catch (playErr) {
                console.log('h5-api play failed: ' + playErr.message + ', falling back to lok-lok.cc');
            }
        }

        if (!content && _activeLokToken) {
            try {
                // lok-lok.cc needs se>=1 — movies use se=0 but lok-lok only returns streams for se=1,ep=1
                const lokSe = season > 0 ? season : 1;
                const lokEp = episode > 0 ? episode : 1;
                const lokLokPlayUrl = 'https://lok-lok.cc/wefeed-h5api-bff/subject/play' +
                    '?subjectId=' + movieId +
                    '&se=' + lokSe +
                    '&ep=' + lokEp +
                    '&detailPath=' + encodeURIComponent(detailPath);
                console.log('Trying lok-lok.cc direct (Ghana IP spoof): se=' + season + ' ep=' + episode);
                const lokResp = await axiosInstance.get(lokLokPlayUrl, {
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36',
                        'X-Client-Info': '{"timezone":"Africa/Accra"}',
                        'X-Source': '',
                        'Referer': 'https://lok-lok.cc/spa/videoPlayPage/movies/' + detailPath + '?id=' + movieId + '&type=/movie/detail&lang=en',
                        'Origin': 'https://lok-lok.cc',
                        'Cookie': 'token=' + _activeLokToken,
                    },
                    timeout: 15000
                });
                const lokData = processApiResponse(lokResp);
                if (lokData && lokData.streams && lokData.streams.length > 0) {
                    console.log('lok-lok.cc returned ' + lokData.streams.length + ' stream(s)');
                    content = {
                        downloads: lokData.streams.map(function(s) {
                            return {
                                id: s.id,
                                url: s.url,
                                resolution: s.resolutions,
                                size: parseInt(s.size) || 0,
                                duration: s.duration,
                                format: (s.format || 'mp4').toLowerCase()
                            };
                        }),
                        captions: lokData.captions || [],
                        hasResource: true
                    };

                    // Fetch captions via h5-api caption endpoint (Ghana IP, confirmed working)
                    if (content && (!content.captions || content.captions.length === 0)) {
                        const dlId = content.downloads[0] && content.downloads[0].id;
                        if (dlId) {
                            try {
                                const capUrl = 'https://h5-api.aoneroom.com/wefeed-h5api-bff/subject/caption' +
                                    '?format=MP4&id=' + dlId +
                                    '&subjectId=' + movieId +
                                    '&detailPath=' + encodeURIComponent(detailPath);
                                const capResp = await axiosInstance.get(capUrl, {
                                    headers: {
                                        Accept: 'application/json',
                                        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36',
                                        Referer: 'https://lok-lok.cc/',
                                        Origin: 'https://lok-lok.cc'
                                    },
                                    timeout: 10000
                                });
                                const fetchedCaps = (capResp.data && capResp.data.data && capResp.data.data.captions) || [];
                                if (fetchedCaps.length > 0) {
                                    content.captions = fetchedCaps;
                                    console.log('Fetched ' + fetchedCaps.length + ' captions from h5-api caption endpoint');
                                }
                            } catch (capErr) {
                                console.log('Caption fetch from h5-api failed: ' + capErr.message);
                            }
                        }
                    }
                } else {
                    console.log('lok-lok.cc returned no streams, falling back to aoneroom');
                }
            } catch (lokErr) {
                console.log('lok-lok.cc direct failed: ' + lokErr.message + ', falling back to aoneroom');
            }
        }

        // FALLBACK: original aoneroom endpoints (if lok-lok.cc returned nothing)
        if (!content) {
        for (const currentParams of paramCombos) {
            if (content) break;
            const comboLabel = `se:${currentParams.se},ep:${currentParams.ep}`;
            for (const region of regionConfigs) {
                console.log(`Trying sources with region: ${region.name} (${comboLabel})`);
                try {
                    // Route through relay — relay injects auth token for h5.aoneroom.com
                    const dlParams = new URLSearchParams(currentParams).toString();
                    // Direct call to aoneroom — relay causes CF-to-CF error 1000
                    let response;
                    response = await axiosInstance({
                        method: 'GET',
                        url: `${HOST_URL}/wefeed-h5-bff/web/subject/download`,
                        params: currentParams,
                        headers: {
                            ...DEFAULT_HEADERS,
                            'Referer': refererUrl,
                            'Origin': HOST_URL,
                            'X-Client-Info': JSON.stringify({timezone: 'Africa/Accra'}),
                            'Accept-Language': 'en-GH,en;q=0.9'
                        },
                        timeout: 15000
                    })
                    const result = processApiResponse(response);
                    if (result && result.downloads && result.downloads.length > 0) {
                        console.log(`Got ${result.downloads.length} download(s) from region: ${region.name} (${comboLabel})`);
                        content = result;
                        // Fetch captions from h5-api caption endpoint (Ghana IP spoof)
                        if (!content.captions || content.captions.length === 0) {
                            const aDlId = content.downloads[0] && content.downloads[0].id;
                            if (aDlId) {
                                try {
                                    const aCUrl = "https://h5-api.aoneroom.com/wefeed-h5api-bff/subject/caption" +
                                        "?format=MP4&id=" + aDlId +
                                        "&subjectId=" + movieId +
                                        "&detailPath=" + encodeURIComponent(detailPath);
                                    const aCR = await axiosInstance.get(aCUrl, {
                                        headers: {
                                            "Accept": "application/json",
                                            "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36",
                                            "Referer": "https://lok-lok.cc/",
                                            "Origin": "https://lok-lok.cc"
                                        },
                                        timeout: 8000
                                    });
                                    const aCaps = (aCR.data && aCR.data.data && aCR.data.data.captions) || [];
                                    if (aCaps.length > 0) {
                                        content.captions = aCaps;
                                        console.log("aoneroom: fetched " + aCaps.length + " captions from h5-api");
                                    }
                                } catch (e) { /* captions optional */ }
                            }
                        }
                        break;
                    }
                } catch (err) {
                    console.log(`Region ${region.name} (${comboLabel}) failed: ${err.message}`);
                }
            }
            if (!content && currentParams.se === 0) {
                console.log('Retrying with se:1, ep:1 fallback...');
            }
        }

        if (!content) {
            console.log('Download endpoint returned empty, trying /play endpoint...');
            for (const region of regionConfigs) {
                try {
                    const playParams = { subjectId: movieId, se: season || 1, ep: episode || 1 };
                    // Route through relay — relay injects auth token for h5.aoneroom.com
                    const playParamStr = new URLSearchParams(playParams).toString();
                    // Direct call to aoneroom — relay causes CF-to-CF error 1000
                    let playResponse;
                    playResponse = await axiosInstance({
                        method: 'GET',
                        url: `${HOST_URL}/wefeed-h5-bff/web/subject/play`,
                        params: playParams,
                        headers: {
                            ...DEFAULT_HEADERS,
                            'Referer': refererUrl,
                            'Origin': HOST_URL,
                            'X-Client-Info': JSON.stringify({timezone: 'Africa/Accra'}),
                            'Accept-Language': 'en-GH,en;q=0.9'
                        },
                        timeout: 15000
                    })
                    const playResult = processApiResponse(playResponse);
                    if (playResult) {
                        console.log(`Play endpoint response from ${region.name}:`, JSON.stringify(playResult).substring(0, 300));
                        if (playResult.url || playResult.playUrl || playResult.mediaUrl) {
                            const streamUrl = playResult.url || playResult.playUrl || playResult.mediaUrl;
                            console.log(`Got HLS stream from /play endpoint (${region.name}): ${streamUrl.substring(0, 100)}`);
                            content = {
                                downloads: [{
                                    id: movieId,
                                    url: streamUrl,
                                    resolution: playResult.quality || 'Auto',
                                    size: 0
                                }],
                                captions: playResult.captions || playResult.subtitles || [],
                                hasResource: true,
                                isHLS: streamUrl.includes('.m3u8')
                            };
                            break;
                        }
                        if (playResult.downloads && playResult.downloads.length > 0) {
                            console.log(`Got ${playResult.downloads.length} download(s) from /play endpoint (${region.name})`);
                            content = playResult;
                            break;
                        }
                        if (playResult.hasResource === true) {
                            console.log(`Play endpoint says hasResource=true but no URL yet, checking deeper...`);
                            const keys = Object.keys(playResult);
                            console.log(`Play response keys: ${keys.join(', ')}`);
                            const allValues = JSON.stringify(playResult);
                            const urlMatch = allValues.match(/(https?:\/\/[^\s"',]+\.(m3u8|mp4)[^\s"',]*)/);
                            if (urlMatch) {
                                console.log(`Found streaming URL in play response: ${urlMatch[1].substring(0, 100)}`);
                                content = {
                                    downloads: [{
                                        id: movieId,
                                        url: urlMatch[1],
                                        resolution: 'Auto',
                                        size: 0
                                    }],
                                    captions: playResult.captions || [],
                                    hasResource: true,
                                    isHLS: urlMatch[1].includes('.m3u8')
                                };
                                break;
                            }
                        }
                    }
                } catch (playErr) {
                    console.log(`Play endpoint failed for ${region.name}: ${playErr.message}`);
                }
            }
        }

        } // end if (!content) aoneroom fallback

        // If the newer play contract returned no MP4 signing data, try the
        // older authorized download contract as an MP4-only fallback. DASH
        // from /subject/play is kept unchanged and remains the preferred path.
        const hasUsableMp4Signing = Boolean(content && Array.isArray(content.downloads) &&
            content.downloads.some(file => file && (file.signCookie || /[?&](?:exp|sig|token)=/i.test(String(file.url || '')))));
        if (content && Array.isArray(content.dash) && content.dash.length > 0 && !hasUsableMp4Signing) {
            try {
                await ensureCookiesAreAssigned();
                const legacyResponse = await axiosInstance({
                    method: 'GET',
                    url: `${HOST_URL}/wefeed-h5-bff/web/subject/download`,
                    params,
                    headers: {
                        ...DEFAULT_HEADERS,
                        'Referer': refererUrl,
                        'Origin': HOST_URL,
                        'Accept-Language': 'en-GH,en;q=0.9',
                        ...(relayCookies ? { 'Cookie': relayCookies } : {})
                    },
                    withCredentials: true,
                    timeout: 15000
                });
                const legacy = processApiResponse(legacyResponse);
                const existing = new Set((content.downloads || []).map(file => String(file.url || '')));
                const legacyMp4 = Array.isArray(legacy?.downloads)
                    ? legacy.downloads.filter(file => file?.url && !existing.has(String(file.url)))
                    : [];
                if (legacyMp4.length > 0) {
                    content.downloads = [...(content.downloads || []), ...legacyMp4];
                    console.log(`Added ${legacyMp4.length} MP4 fallback source(s) from subject/download`);
                }
            } catch (legacyErr) {
                console.warn('subject/download MP4 fallback unavailable:', legacyErr.message);
            }
        }

        if (!content) {
            console.log('All endpoints returned empty');
            content = { downloads: [], captions: [], hasResource: false, processedSources: [] };
        }
        
        // Process the sources to extract direct download links with proxy URLs.
        // The browser flow also returns a DASH source whose signed
        // X-MB-Token must be sent by dash.js. Keep that short-lived token on
        // the source descriptor so the frontend can reproduce the working
        // browser request captured in the HAR.
        if (content && content.downloads) {
            const sources = content.downloads.map(file => {
                const encodedUrl = encodeURIComponent(file.url);
                const sessionId = createMp4Session(
                    file.url,
                    file.signCookie || '',
                    file.signHeaderKey || '',
                    file.referer || HOST_URL + '/'
                );
                const streamUrl = sessionId
                    ? `/api/mp4/stream/${sessionId}`
                    : `/api/stream?url=${encodedUrl}`;
                const downloadUrl = sessionId
                    ? `/api/mp4/friend-download/${sessionId}`
                    : `/api/download?url=${encodedUrl}`;
                return {
                    id: file.id,
                    quality: file.resolution || 'Unknown',
                    directUrl: file.url,
                    // Keep provider URLs available for diagnostics, but prefer
                    // the same-origin session proxy when signing data exists.
                    proxyUrl: streamUrl,
                    downloadUrl,
                    streamUrl,
                    cdnUrl: file.url,
                    size: file.size,
                    format: 'mp4',
                    proxyPreferred: Boolean(sessionId)
                };
            });

            const dashSources = (Array.isArray(content.dash) ? content.dash : [])
                .filter(file => file && file.url)
                .map(file => {
                    const signHeaderKey = file.signHeaderKey || 'X-MB-Token';
                    const sessionId = createDashSession(file.url, file.signCookie, signHeaderKey);
                    const proxyUrl = sessionId
                        ? `/api/dash/manifest/${sessionId}`
                        : file.url;
                    return {
                        id: file.id,
                        quality: file.resolutions || 'Auto',
                        directUrl: file.url,
                        proxyUrl,
                        streamUrl: proxyUrl,
                        cdnUrl: file.url,
                        size: parseInt(file.size) || 0,
                        format: 'dash',
                        signHeaderKey
                    };
                });

            content.processedSources = [...dashSources, ...sources];
            // Do not return the signing token twice in the raw DASH payload.
            // The processed descriptor is the one consumed by the player.
            content.dash = dashSources.map(file => ({
                id: file.id,
                resolutions: file.quality,
                format: 'DASH',
                url: file.directUrl
            }));
        }
        
        const responseData = {
            status: 'success',
            creator:'Hector Manuel ',
            data: content
        };

        if (content.downloads && content.downloads.length > 0) {
            setCachedSources(cacheKey, responseData);
            console.log(`Cached sources for movieId: ${movieId} (${content.downloads.length} downloads)`);
        }

        res.json(responseData);
    } catch (error) {
        console.error('Sources error:', error.message);
        res.status(500).json({
            status: 'error',
            creator:'Hector Manuel ',
            message: 'Failed to fetch streaming sources',
            error: error.message
        });
    }
});

// Same-origin DASH relay. The provider token never leaves the VPS; the
// manifest is rewritten so every initialization/media segment comes back
// through this route as well.
app.get('/api/dash/manifest/:sessionId', async (req, res) => {
    const session = getDashSession(req.params.sessionId);
    if (!session) return res.status(410).json({ status: 'error', message: 'DASH playback session expired' });

    try {
        const response = await axios({
            method: 'GET',
            url: session.manifestUrl,
            responseType: 'text',
            headers: dashUpstreamHeaders(session),
            timeout: 15000,
            maxRedirects: 5
        });
        res.set({
            'Content-Type': 'application/dash+xml',
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*'
        });
        res.send(rewriteDashManifest(response.data, req.params.sessionId));
    } catch (error) {
        const status = Number(error.response?.status);
        const retryAfter = error.response?.headers?.['retry-after'];
        if (retryAfter) res.set('Retry-After', String(retryAfter));
        res.status(status >= 400 && status < 600 ? status : 502).json({
            status: 'error',
            message: 'Failed to fetch DASH manifest',
            upstreamStatus: status || null
        });
    }
});

app.get('/api/dash/segment/:sessionId/*', async (req, res) => {
    const session = getDashSession(req.params.sessionId);
    if (!session) return res.status(410).json({ status: 'error', message: 'DASH playback session expired' });

    const marker = `/api/dash/segment/${req.params.sessionId}/`;
    const requestPath = req.originalUrl.split('?')[0];
    const assetPath = requestPath.startsWith(marker)
        ? decodeURIComponent(requestPath.slice(marker.length))
        : '';
    if (!assetPath || assetPath.includes('..') || assetPath.startsWith('/')) {
        return res.status(400).json({ status: 'error', message: 'Invalid DASH segment path' });
    }

    try {
        const targetUrl = new URL(assetPath, session.baseUrl).toString();
        const headers = dashUpstreamHeaders(session);
        if (req.headers.range) headers.Range = req.headers.range;
        const response = await axios({
            method: 'GET',
            url: targetUrl,
            responseType: 'stream',
            headers,
            timeout: 0,
            maxRedirects: 5
        });
        const passthrough = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag'];
        for (const name of passthrough) {
            if (response.headers[name]) res.set(name, response.headers[name]);
        }
        res.set({
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'
        });
        res.status(response.status);
        response.data.on('error', () => { if (!res.headersSent) res.status(502).end(); else res.end(); });
        response.data.pipe(res);
        res.on('close', () => { if (response.data.destroy) response.data.destroy(); });
    } catch (error) {
        const status = Number(error.response?.status);
        const retryAfter = error.response?.headers?.['retry-after'];
        if (retryAfter) res.set('Retry-After', String(retryAfter));
        res.status(status >= 400 && status < 600 ? status : 502).json({
            status: 'error',
            message: 'Failed to fetch DASH segment',
            upstreamStatus: status || null
        });
    }
});

// MP4 session proxy. Provider signing cookies stay server-side.
async function pipeMp4Session(req, res, asDownload = false) {
    const session = getMp4Session(req.params.sessionId);
    if (!session) return res.status(410).json({ status: 'error', message: 'MP4 playback session expired' });
    const downloadFilename = safeDownloadFilename(req.query.filename);
    const extraHeaders = {};
    if (session.signCookie) extraHeaders.Cookie = session.signCookie;
    if (session.signHeaderKey && session.signCookie) extraHeaders[session.signHeaderKey] = session.signCookie;
    if (session.referer) extraHeaders.Referer = session.referer;
    if (session.origin) extraHeaders.Origin = session.origin;
    // MP4 CDN requests must identify the provider playback page.
    // The old friend-site identity is rate-limited by the provider.
    extraHeaders['User-Agent'] = 'okhttp/4.12.0';
    extraHeaders.Referer = 'https://mzfi.me/';
    extraHeaders.Origin = 'https://mzfi.me';
    try {
        await pipeCdnStream(
            res,
            session.mediaUrl,
            asDownload ? `attachment; filename="${downloadFilename}"` : null,
            extraHeaders
        );
    } catch (error) {
        console.error('MP4 session proxy error:', error.message);
        if (!res.headersSent) res.status(502).json({ status: 'error', message: 'Failed to proxy MP4 stream' });
    }
}

app.get('/api/mp4/stream/:sessionId', (req, res) => pipeMp4Session(req, res, false));
app.get('/api/mp4/download/:sessionId', (req, res) => pipeMp4Session(req, res, true));

// Friend-style MP4 download relay. This intentionally uses native fetch and
// the friend's exact request/response pattern, while keeping normal playback
// on /api/mp4/stream and DASH on its existing routes.
async function pipeFriendDownloadSession(req, res) {
    const session = getMp4Session(req.params.sessionId);
    if (!session) {
        return res.status(410).json({ status: 'error', message: 'MP4 download session expired' });
    }

    // Match the provider identity accepted by the signed MP4 URL.
    // Forwarded client-IP spoofing caused the CDN to return 429 responses.
    const upstreamHeaders = {
        'User-Agent': 'okhttp/4.12.0',
        'Referer': 'https://mzfi.me/',
        'Origin': 'https://mzfi.me'
    };
    if (session.signCookie) {
        upstreamHeaders.Cookie = session.signCookie;
        if (session.signHeaderKey) upstreamHeaders[session.signHeaderKey] = session.signCookie;
    }
    if (req.headers.range) upstreamHeaders.Range = req.headers.range;

    try {
        const upstream = await fetch(session.mediaUrl, { headers: upstreamHeaders });
        if (!upstream.ok && upstream.status !== 206) {
            const retryAfter = upstream.headers.get('retry-after');
            if (retryAfter) res.set('Retry-After', retryAfter);
            return res.status(502).json({
                status: 'error',
                message: `Upstream responded with ${upstream.status}`,
                upstreamStatus: upstream.status
            });
        }

        const downloadFilename = safeDownloadFilename(req.query.filename);
        const responseHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Origin, Range, Content-Type, Accept',
            'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
            'Content-Type': upstream.headers.get('content-type') || 'video/mp4',
            'Content-Disposition': `attachment; filename="${downloadFilename}"`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-store'
        };
        for (const header of ['content-length', 'content-range']) {
            const value = upstream.headers.get(header);
            if (value) responseHeaders[header] = value;
        }

        res.set(responseHeaders);
        res.status(upstream.status);
        if (!upstream.body) return res.end();

        const readable = Readable.fromWeb(upstream.body);
        const onClientGone = () => readable.destroy();
        const onResponseClose = () => {
            if (!res.writableFinished) onClientGone();
        };
        req.once('aborted', onClientGone);
        res.once('close', onResponseClose);
        try {
            await pipeline(readable, res);
        } catch (streamError) {
            if (!isBenignStreamError(streamError)) throw streamError;
        } finally {
            req.removeListener('aborted', onClientGone);
            res.removeListener('close', onResponseClose);
        }
    } catch (error) {
        console.error('Friend-style MP4 download relay error:', error.message);
        if (isBenignStreamError(error)) return;
        if (!res.headersSent) {
            return res.status(502).json({
                status: 'error',
                message: 'Friend-style MP4 download relay failed'
            });
        }
        if (!res.writableEnded) res.destroy();
    }
}

app.get('/api/mp4/friend-download/:sessionId', pipeFriendDownloadSession);

// Stream proxy endpoint - keeps headers for in-browser playback
app.get('/api/stream', async (req, res) => {
    try {
        const targetUrl = parseAndValidateCdnUrl(req.query.url);

        if (!targetUrl) {
            return res.status(400).json({
                status: 'error',
                creator:'Hector Manuel ',
                message: 'Invalid or unsupported stream URL'
            });
        }

        console.log('Streaming from:', targetUrl);
        await pipeCdnStream(res, targetUrl);
    } catch (error) {
        console.error('Stream proxy error:', error.message);
        if (!res.headersSent) {
            res.status(500).json({
                status: 'error',
                creator:'Hector Manuel ',
                message: 'Failed to proxy stream',
                error: error.message
            });
        }
    }
});

// Download proxy endpoint - adds proper headers to bypass CDN restrictions and forces attachment
app.get('/api/download', async (req, res) => {
    try {
        // Compatibility for pages opened before the frontend relay fix.
        // Older clients wrapped /api/mp4/friend-download/<sessionId> inside
        // this endpoint, which must be routed to the session relay directly.
        const requestedUrl = String(req.query.url || '');
        const legacyFriend = requestedUrl.match(/^\/api\/mp4\/friend-download\/([a-f0-9]+)$/i);
        if (legacyFriend) {
            req.params = { ...req.params, sessionId: legacyFriend[1] };
            return pipeFriendDownloadSession(req, res);
        }

        const targetUrl = parseAndValidateCdnUrl(req.query.url);

        if (!targetUrl) {
            return res.status(400).json({
                status: 'error',
                creator:'Hector Manuel ',
                message: 'Invalid or unsupported download URL'
            });
        }

        const filename = (req.query.filename && decodeUrlParam(req.query.filename)) || 'movie.mp4';
        const safeFilename = filename.replace(/[\\/\r\n]/g, '_');
        await pipeCdnStream(res, targetUrl, `attachment; filename="${safeFilename}"`);
    } catch (error) {
        console.error('Download proxy error:', error.message);
        if (!res.headersSent) {
            res.status(500).json({
                status: 'error',
                creator:'Hector Manuel ',
                message: 'Failed to proxy download',
                error: error.message
            });
        }
    }
});


// Convert SRT to VTT format
function srtToVtt(srtContent) {
    let vttContent = 'WEBVTT\n\n';
    
    // Split by double newlines (subtitle blocks)
    const blocks = srtContent.trim().split(/\r?\n\r?\n/);
    
    for (const block of blocks) {
        const lines = block.split(/\r?\n/);
        if (lines.length < 2) continue;
        
        // Find the timing line (contains -->)
        let timingLineIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('-->')) {
                timingLineIndex = i;
                break;
            }
        }
        
        if (timingLineIndex === -1) continue;
        
        // Convert timing format: 00:00:00,000 --> 00:00:00,000 to 00:00:00.000 --> 00:00:00.000
        const timing = lines[timingLineIndex].replace(/,/g, '.');
        
        // Get subtitle text (everything after timing line)
        const text = lines.slice(timingLineIndex + 1).join('\n');
        
        if (text.trim()) {
            vttContent += `${timing}\n${text}\n\n`;
        }
    }
    
    return vttContent;
}

// Proxy subtitle files to bypass CORS restrictions
app.get('/api/proxy-subtitle', async (req, res) => {
    try {
        const targetUrl = parseAndValidateCdnUrl(req.query.url);

        if (!targetUrl) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid or unsupported subtitle URL'
            });
        }

        console.log('Proxying subtitle from:', targetUrl);
        
        // hakunaymatata.com cacdn CDN validates Referer/Origin — must use lok-lok.cc
        const subReferer = targetUrl.includes('hakunaymatata.com') ? 'https://lok-lok.cc/' : HOST_URL + '/';
        const subOrigin  = targetUrl.includes('hakunaymatata.com') ? 'https://lok-lok.cc'  : HOST_URL;
        const response = await axios({
            method: 'GET',
            url: targetUrl,
            headers: {
                'User-Agent': 'okhttp/4.12.0',
                'Accept': '*/*',
                'Referer': subReferer,
                'Origin':  subOrigin
            },
            responseType: 'text',
            timeout: 30000
        });

        // Convert SRT to VTT format
        let subtitleContent = response.data;
        if (targetUrl.includes('.srt') || !subtitleContent.startsWith('WEBVTT')) {
            subtitleContent = srtToVtt(subtitleContent);
        }

        res.set({
            'Content-Type': 'text/vtt; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=86400'
        });
        
        res.send(subtitleContent);
    } catch (error) {
        console.error('Subtitle proxy error:', error.message);
        res.status(500).json({
            status: 'error',
            message: 'Failed to proxy subtitle',
            error: error.message
        });
    }
});

// Get subtitle file for a movie
app.get('/api/subtitles/:movieId', async (req, res) => {
    try {
        const { movieId } = req.params;
        const language = req.query.lang || 'English';
        const season = parseInt(req.query.season) || 0;
        const episode = parseInt(req.query.episode) || 0;
        
        console.log(`Fetching subtitles for movie ${movieId}, language: ${language}`);
        
        // First get movie info to extract subtitle information
        const infoResponse = await axiosInstance({
                method: 'GET',
                url: `${HOST_URL}/wefeed-h5-bff/web/subject/detail`,
                params: { subjectId: movieId },
                headers: {
                    ...DEFAULT_HEADERS,
                    'X-Client-Info': JSON.stringify({timezone: 'Africa/Accra'})
                },
                timeout: 15000
            })
        
        const movieInfo = processApiResponse(infoResponse);
        const availableSubtitles = movieInfo?.subject?.subtitles;
        
        if (!availableSubtitles || !availableSubtitles.includes(language)) {
            return res.status(404).json({
                status: 'error',
                message: `Subtitles not available in ${language}`
            });
        }
        
        // Try to get subtitle URL from sources endpoint
        const sourcesResponse = await axiosInstance({
                method: 'GET',
                url: `${HOST_URL}/wefeed-h5-bff/web/subject/download`,
                params: {
                subjectId: movieId,
                se: season,
                ep: episode
            },
                headers: {
                    ...DEFAULT_HEADERS,
                    'X-Client-Info': JSON.stringify({timezone: 'Africa/Accra'})
                },
                timeout: 15000
            })
        
        const sourcesData = processApiResponse(sourcesResponse);
        
        // Look for subtitle URLs in the response
        let subtitleUrl = null;
        
        if (sourcesData && sourcesData.downloads) {
            // Check if any source has subtitle information
            for (const source of sourcesData.downloads) {
                if (source.subtitles && source.subtitles[language]) {
                    subtitleUrl = source.subtitles[language];
                    break;
                }
            }
        }
        
        if (!subtitleUrl) {
            // If no direct subtitle URL found, return a placeholder or try to construct one
            return res.status(404).json({
                status: 'error',
                message: 'Subtitle file URL not found',
                availableLanguages: availableSubtitles.split(',')
            });
        }
        
        // Proxy the subtitle file
        try {
            const subtitleResponse = await axios.get(subtitleUrl, {
                responseType: 'text',
                timeout: 10000
            });
            
            // Convert to WebVTT format if needed
            let subtitleContent = subtitleResponse.data;
            
            // If it's SRT format, convert to VTT
            if (subtitleUrl.endsWith('.srt') || subtitleContent.includes('-->') && !subtitleContent.includes('WEBVTT')) {
                subtitleContent = convertSrtToVtt(subtitleContent);
            }
            
            res.set('Content-Type', 'text/vtt');
            res.set('Access-Control-Allow-Origin', '*');
            res.send(subtitleContent);
            
        } catch (subError) {
            console.error('Failed to fetch subtitle file:', subError.message);
            res.status(500).json({
                status: 'error',
                message: 'Failed to load subtitle file'
            });
        }
        
    } catch (error) {
        console.error('Subtitle endpoint error:', error.message);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch subtitles',
            error: error.message
        });
    }
});

// Helper function to convert SRT to VTT
function convertSrtToVtt(srtContent) {
    let vttContent = 'WEBVTT\n\n';
    
    // Basic SRT to VTT conversion
    const blocks = srtContent.split('\n\n').filter(block => block.trim());
    
    for (const block of blocks) {
        const lines = block.split('\n').filter(line => line.trim());
        
        if (lines.length >= 3) {
            // Skip the index number (first line)
            // Convert time format (00:00:00,000 --> 00:00:00,000 to 00:00:00.000 --> 00:00:00.000)
            let timeLine = lines[1].replace(/,/g, '.');
            
            // Add the text lines
            const textLines = lines.slice(2).join('\n');
            
            vttContent += `${timeLine}\n${textLines}\n\n`;
        }
    }
    
    return vttContent;
}



// Dubs -- returns all available dubbed versions for a movie/show
app.get('/api/dubs/:movieId', async (req, res) => {
    try {
        const { movieId } = req.params;

        const _dc = dubsCache.get(movieId);
        if (_dc) return res.json(_dc);

        const jwt = await getLokLokToken();

        const bearerHeaders = {
            'Accept': 'application/json',
            'Authorization': 'Bearer ' + jwt,
            'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
            'Referer': 'https://h5-api.aoneroom.com/',
            'Origin': 'https://h5-api.aoneroom.com',
            'X-Request-Lang': 'en',
            'Accept-Language': 'en-US,en;q=0.9'
        };

        // Accept pre-resolved detailPath to skip the info lookup (same pattern as /api/sources/)
        let detailPath = req.query.detailPath || null;

        // Step 1: get detailPath via info endpoint only if not provided
        if (!detailPath) {
            try {
                const infoResp = await axios.get(
                    'http://127.0.0.1:' + PORT + '/api/info/' + movieId,
                    { timeout: 10000 }
                );
                detailPath = infoResp.data &&
                             infoResp.data.data &&
                             infoResp.data.data.subject &&
                             infoResp.data.data.subject.detailPath || null;
            } catch (e) {
                console.warn('Dubs: info lookup failed:', e.message);
            }
        }

        if (!detailPath) {
            return res.status(404).json({
                status: 'error',
                creator: 'Hector Manuel ',
                message: 'Could not resolve detailPath for this movie'
            });
        }

        // Step 2: call h5api detail route -- the only route that returns subject.dubs
        const detailResp = await axiosInstance({
            method: 'GET',
            url: SEARCH_HOST_URL + '/wefeed-h5api-bff/detail',
            params: { detailPath },
            headers: bearerHeaders,
            timeout: 15000
        });

        const subject = (detailResp.data && detailResp.data.data && detailResp.data.data.subject) || {};
        const dubs = subject.dubs || [];

        if (dubs.length === 0) {
            const _dnr = { status: 'success', creator: 'Hector Manuel ', data: { movieId, detailPath, title: subject.title || '', hasDubs: false, dubs: [] } };
            dubsCache.set(movieId, _dnr);
            return res.json(_dnr);
        }

        const original = dubs.find(d => d.original) || dubs[0];
        const dubbed   = dubs.filter(d => !d.original);

        const _dr = {
            status: 'success',
            creator: 'Hector Manuel ',
            data: {
                movieId,
                detailPath,
                title: subject.title || '',
                corner: subject.corner || '',
                hasDubs: dubbed.length > 0,
                original: original ? {
                    subjectId:  original.subjectId,
                    lanName:    original.lanName,
                    lanCode:    original.lanCode,
                    detailPath: original.detailPath
                } : null,
                dubs: dubbed.map(d => ({
                    subjectId:  d.subjectId,
                    lanName:    d.lanName,
                    lanCode:    d.lanCode,
                    detailPath: d.detailPath
                }))
            }
        };
        dubsCache.set(movieId, _dr);
        res.json(_dr);

    } catch (error) {
        console.error('Dubs error:', error.message);
        res.status(500).json({
            status: 'error',
            creator: 'Hector Manuel ',
            message: 'Failed to fetch dub versions',
            error: error.message
        });
    }
});

// ─── NEW ENDPOINTS FROM HAR ANALYSIS ───────────────────────────────────────

// Recommendations — "You May Also Like" for a given movie/show
// Source: h5-api.aoneroom.com/wefeed-h5api-bff/subject/detail-rec
app.get('/api/recommendations/:movieId', async (req, res) => {
    try {
        const { movieId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.perPage) || 12;
        const jwt = await getLokLokToken();

        const response = await axiosInstance({
            method: 'GET',
            url: SEARCH_HOST_URL + '/wefeed-h5api-bff/subject/detail-rec',
            params: { subjectId: movieId, page, perPage },
            headers: {
                'Accept': 'application/json',
                'Authorization': 'Bearer ' + jwt,
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
                'Referer': 'https://h5-api.aoneroom.com/',
                'Origin': 'https://h5-api.aoneroom.com',
                'X-Request-Lang': 'en',
                'Accept-Language': 'en-US,en;q=0.9'
            },
            timeout: 15000
        });

        const data = (response.data && response.data.data) ? response.data.data : response.data;
        res.json({ status: 'success', creator: 'Hector Manuel ', data });
    } catch (error) {
        console.error('Recommendations error:', error.message);
        res.status(500).json({ status: 'error', creator: 'Hector Manuel ', message: 'Failed to fetch recommendations', error: error.message });
    }
});

// Everyone Search — live trending search terms (what everyone is actively searching)
// Source: h5-api.aoneroom.com/wefeed-h5api-bff/subject/everyone-search
app.get('/api/everyone-search', async (req, res) => {
    try {
        const jwt = await getLokLokToken();

        const response = await axiosInstance({
            method: 'GET',
            url: SEARCH_HOST_URL + '/wefeed-h5api-bff/subject/everyone-search',
            headers: {
                'Accept': 'application/json',
                'Authorization': 'Bearer ' + jwt,
                'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
                'Referer': 'https://h5-api.aoneroom.com/',
                'Origin': 'https://h5-api.aoneroom.com',
                'X-Request-Lang': 'en',
                'Accept-Language': 'en-US,en;q=0.9'
            },
            timeout: 15000
        });

        const data = (response.data && response.data.data) ? response.data.data : response.data;
        res.json({ status: 'success', creator: 'Hector Manuel ', data });
    } catch (error) {
        console.error('Everyone-search error:', error.message);
        res.status(500).json({ status: 'error', creator: 'Hector Manuel ', message: 'Failed to fetch trending searches', error: error.message });
    }
});

// Captions — resolves signed subtitle URLs via subject/caption endpoint
// Much more reliable than the old subtitles endpoint.
// Source: h5-api.aoneroom.com/wefeed-h5api-bff/subject/caption
// Query params: season (default 0), episode (default 0), lang (optional ISO code e.g. en/ar/fr)
app.get('/api/captions/:movieId', async (req, res) => {
    try {
        const { movieId } = req.params;
        const season     = parseInt(req.query.season)   || 0;
        const episode    = parseInt(req.query.episode)  || 0;
        const langFilter = (req.query.lang || '').toLowerCase();

        // Ghana IP-spoof headers — same pattern that sources endpoint uses successfully
        const ghanaHeaders = {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
            'Referer': 'https://lok-lok.cc/',
            'Origin':  'https://lok-lok.cc'
        };

        // Step 1: get stream ID + detailPath
        // Prefer the sourcesCache (already populated by /api/sources calls) to avoid a redundant upstream hit
        const cacheKey = movieId + '_' + season + '_' + episode;
        const cached   = getCachedSources(cacheKey);
        let streamId   = cached && cached.downloads && cached.downloads[0] && cached.downloads[0].id || null;
        let detailPath = null;

        // If not cached, self-call /api/sources to trigger the full resolution pipeline
        if (!streamId) {
            try {
                const selfResp = await axios.get(
                    'http://127.0.0.1:' + PORT + '/api/sources/' + movieId +
                    '?season=' + season + '&episode=' + episode,
                    { timeout: 20000 }
                );
                const srcData = selfResp.data && selfResp.data.data;
                if (srcData && srcData.downloads && srcData.downloads.length > 0) {
                    streamId = srcData.downloads[0].id;
                }
            } catch(e) {
                console.warn('Captions: self-source lookup failed:', e.message);
            }
        }

        // Step 1b: get detailPath from /api/info (lightweight, cached by browser usually)
        try {
            const infoResp = await axios.get(
                'http://127.0.0.1:' + PORT + '/api/info/' + movieId,
                { timeout: 10000 }
            );
            detailPath = infoResp.data && infoResp.data.data && infoResp.data.data.subject && infoResp.data.data.subject.detailPath || null;
        } catch(e) {
            console.warn('Captions: info lookup failed:', e.message);
        }

        if (!streamId) {
            return res.status(404).json({
                status: 'error',
                creator: 'Hector Manuel ',
                message: 'Could not resolve stream ID — no sources available for this title'
            });
        }

        // Step 2: fetch signed caption URLs from h5-api subject/caption (same pattern as sources endpoint)
        const captionUrl = 'https://h5-api.aoneroom.com/wefeed-h5api-bff/subject/caption' +
            '?format=MP4&id=' + streamId +
            '&subjectId=' + movieId +
            '&detailPath=' + encodeURIComponent(detailPath || '');

        const captionResp = await axiosInstance.get(captionUrl, {
            headers: ghanaHeaders,
            timeout: 10000
        });

        const captions = (captionResp.data && captionResp.data.data && captionResp.data.data.captions) || [];

        const filtered = langFilter
            ? captions.filter(c => (c.lan || '').toLowerCase().startsWith(langFilter) || (c.lanName || '').toLowerCase().includes(langFilter))
            : captions;

        console.log('Captions: resolved ' + captions.length + ' caption(s) for movieId ' + movieId);

        res.json({
            status: 'success',
            creator: 'Hector Manuel ',
            data: {
                streamId,
                detailPath,
                totalCaptions: captions.length,
                captions: filtered.map(c => ({
                    id:           c.id,
                    language:     c.lan,
                    languageName: c.lanName,
                    url:          '/api/proxy-subtitle?url=' + encodeURIComponent(c.url)
                }))
            }
        });
    } catch (error) {
        console.error('Captions error:', error.message);
        res.status(500).json({ status: 'error', creator: 'Hector Manuel ', message: 'Failed to fetch captions', error: error.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    if (!res.headersSent) {
        res.status(500).json({
            status: 'error',
            creator:'Hector Manuel ',
            message: 'Internal server error',
            error: err.message
        });
    }
});

// Cache stats — lightweight health check showing what's cached in memory
app.get('/api/cache/stats', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
        status: 'success',
        cache: {
            info:    { entries: infoCache.size(),   ttl: '24h' },
            dubs:    { entries: dubsCache.size(),   ttl: '12h' },
            search:  { entries: searchCache.size(), ttl: '30m' },
            home:    { entries: homeCache.size(),   ttl: '30m' },
            sources: { entries: sourcesCache.size, ttl: '8m'  }
        }
    });
});


// 404 handler: serve HTML for non-API routes, JSON for API routes
app.use((req, res) => {
    const isApi = req.path && req.path.startsWith('/api');
    if (isApi || (req.accepts('json') && !req.accepts('html'))) {
        return res.status(404).json({
            status: 'error',
            message: 'Endpoint not found',
            availableEndpoints: [
                'GET /api/homepage',
                'GET /api/trending',
                'GET /api/search/:query',
                'GET /api/info/:movieId',
                'GET /api/sources/:movieId',
                'GET /api/recommendations/:movieId',
                'GET /api/everyone-search',
                'GET /api/captions/:movieId'
            ]
        });
    }
    return res.status(404).sendFile(path.join(__dirname, '404.html'));
});

// Global crash guards — prevent a single bad request from killing the server
process.on('uncaughtException', (err) => {
    console.error('[CRASH GUARD] Uncaught exception (server kept alive):', err.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('[CRASH GUARD] Unhandled promise rejection (server kept alive):', reason);
});

// Only start a local server when not running on Vercel
if (!process.env.VERCEL) {
    // (cache stats endpoint moved above 404 handler)

app.listen(PORT, BIND_ADDRESS, () => {
        console.log(`MovieBox API Server running on http://${BIND_ADDRESS}:${PORT}`);

    // -- Pre-warm caches on startup --
    const _http = require('http');
    const _base = 'http://127.0.0.1:' + PORT;
    const _warm = (label, url) => new Promise(resolve => {
        setTimeout(() => {
            _http.get(url, res => { res.resume(); res.on('end', resolve); }).on('error', resolve);
            console.log('[Warmup] ' + label);
        }, 4000);
    });
    Promise.all([
        _warm('homepage', _base + '/api/homepage'),
        _warm('trending', _base + '/api/trending'),
        _warm('hot',      _base + '/api/hot'),
        _warm('popular',  _base + '/api/popular'),
    ]).then(() => console.log('[Warmup] all done'));

    });
}

module.exports = app;