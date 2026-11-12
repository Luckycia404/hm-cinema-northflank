#!/usr/bin/env node
// build-sitemap.js — crawls the full catalog via the local API and writes sitemap-full.xml
// Run manually with `npm run sitemap`; the web process also schedules daily refreshes.

const APP_DIR = __dirname;
const axios = require('axios');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(APP_DIR, '.env') });

const PORT = process.env.PORT || 5000;
const LOCAL_API = `http://127.0.0.1:${PORT}`;
const CANONICAL_BASE = process.env.CANONICAL_BASE_URL || 'https://hm-cinema.me';
const OUT_FILE = getSitemapOutputPath();
const MAX_PAGES = Number(process.env.SITEMAP_MAX_PAGES || 20); // five newest pages plus a rotating deeper catalogue window
const DISCOVERY_PAGE_LIMIT = Math.max(5, Number(process.env.SITEMAP_DISCOVERY_PAGE_LIMIT || 500));
const PER_PAGE = 60;
const DELAY_MS = Number(process.env.SITEMAP_DELAY_MS || 200); // gentle between pages
const SITEMAP_LIMIT = 49000; // under Google's 50k limit
const DEFAULT_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 10 * 1000;
const DEFAULT_VALIDATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_VALIDATION_BATCH_SIZE = 300;
const VALIDATION_STATE_FILE = path.join(APP_DIR, 'sitemap-validation-state.json');
const MAX_TIMER_MS = 2_147_483_647;

const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escAttr = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => HTML_ESC[c]);

function getSitemapOutputPath() {
    const configuredDir = process.env.SITEMAP_OUTPUT_DIR;
    const outputDir = configuredDir ? path.resolve(APP_DIR, configuredDir) : APP_DIR;
    return path.join(outputDir, 'sitemap-full.xml');
}

function positiveInteger(value, fallback) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_TIMER_MS
        ? parsed
        : fallback;
}


function getDiscoveryPageNumbers(now = Date.now()) {
    const total = Math.max(1, Math.floor(MAX_PAGES));
    const newestCount = Math.min(5, total);
    const rotatingCount = Math.max(0, total - newestCount);
    const pages = Array.from({ length: newestCount }, (_, index) => index);
    if (rotatingCount === 0 || DISCOVERY_PAGE_LIMIT <= newestCount) return pages;

    const remainingPages = DISCOVERY_PAGE_LIMIT - newestCount;
    const bucketCount = Math.ceil(remainingPages / rotatingCount);
    const bucket = Math.floor(now / 86400000) % bucketCount;
    const firstRotatingPage = newestCount + bucket * rotatingCount;
    for (let offset = 0; offset < rotatingCount; offset++) {
        const page = firstRotatingPage + offset;
        if (page < DISCOVERY_PAGE_LIMIT) pages.push(page);
    }
    return pages;
}

function startSitemapScheduler({ port }) {
    const configuredEnabled = process.env.SITEMAP_SCHEDULER_ENABLED;
    const enabled = configuredEnabled === undefined
        ? process.env.NODE_ENV === 'production'
        : String(configuredEnabled).toLowerCase() === 'true';
    if (!enabled) {
        console.info('[sitemap] Automatic refresh is disabled');
        return () => {};
    }

    const intervalMs = positiveInteger(
        process.env.SITEMAP_REFRESH_INTERVAL_MS,
        DEFAULT_REFRESH_INTERVAL_MS
    );
    const initialDelayMs = positiveInteger(
        process.env.SITEMAP_INITIAL_DELAY_MS,
        DEFAULT_INITIAL_DELAY_MS
    );

    let timer = null;
    let child = null;
    let stopped = false;

    const scheduleNext = () => {
        if (stopped) return;
        timer = setTimeout(run, intervalMs);
    };

    const run = () => {
        if (stopped || child) return;

        console.info('[sitemap] Starting scheduled refresh');
        try {
            child = spawn(process.execPath, [__filename], {
                cwd: APP_DIR,
                env: {
                    ...process.env,
                    PORT: String(port),
                },
                stdio: 'inherit',
            });
        } catch (error) {
            console.error('[sitemap] Could not launch refresh:', error.message);
            scheduleNext();
            return;
        }

        child.once('error', (error) => {
            console.error('[sitemap] Could not start refresh:', error.message);
        });

        child.once('close', (code, signal) => {
            child = null;
            if (code === 0) {
                console.info('[sitemap] Scheduled refresh completed');
            } else {
                console.error(
                    `[sitemap] Scheduled refresh exited with code ${code ?? 'unknown'}${signal ? ` (signal ${signal})` : ''}`
                );
            }
            scheduleNext();
        });
    };

    timer = setTimeout(run, initialDelayMs);
    console.info(
        `[sitemap] Automatic refresh enabled; first run in ${Math.ceil(initialDelayMs / 1000)}s, then every ${Math.round(intervalMs / 60000)}m`
    );

    return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        if (child && !child.killed) child.kill('SIGTERM');
    };
}

function slugify(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

function urlFor(item) {
    const subjectType = Number(item && item.subjectType);
    const type = subjectType === 2 ? 'tv' : (subjectType === 6 ? 'music' : (subjectType === 1 ? 'movie' : null));
    if (!type || !/^\d+$/.test(String(item.subjectId || '')) || !String(item.title || '').trim()) return null;
    const slug = slugify(item.title);
    return `/${type}/${item.subjectId}` + (slug ? `/${slug}` : '');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function readTagAttribute(tag, attribute) {
    const matches = String(tag || '').matchAll(/([a-z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi);
    for (const match of matches) {
        if (match[1].toLowerCase() === attribute.toLowerCase()) {
            return match[2] ?? match[3] ?? match[4] ?? '';
        }
    }
    return '';
}

// Pure response inspection keeps the builder's acceptance rules testable.
function inspectSitemapResponse(response, loc) {
    const parsed = new URL(loc);
    const status = Number(response.status || 0);
    if (status === 404 || status === 410 || (status >= 300 && status < 400)) {
        return { valid: false, reason: 'HTTP ' + status };
    }
    if ([401, 403, 408, 425, 429].includes(status) || status >= 500 || status === 0) {
        return { valid: null, reason: 'HTTP ' + (status || 'network') };
    }
    if (status !== 200) return { valid: false, reason: 'HTTP ' + status };

    const contentType = String(response.headers && response.headers['content-type'] || '').toLowerCase();
    if (!/(?:text\/html|application\/xhtml\+xml)/i.test(contentType)) {
        return { valid: false, reason: 'not an HTML response' };
    }
    const html = String(response.data || '');
    const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
    const robots = metaTags
        .filter(tag => ['robots', 'googlebot', 'googlebot-news'].includes(readTagAttribute(tag, 'name').toLowerCase()))
        .map(tag => readTagAttribute(tag, 'content'))
        .join(',');
    const headerRobots = String(response.headers && response.headers['x-robots-tag'] || '');
    if (/\bnoindex\b/i.test(robots) || /\bnoindex\b/i.test(headerRobots)) {
        return { valid: false, reason: 'noindex' };
    }

    const pagePath = parsed.pathname.replace(/\/$/, '') || '/';
    const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
    const h1Text = h1 ? h1[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
    const pageTitle = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const titleText = pageTitle ? pageTitle[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
    const genericHeading = /^(?:404|not found|page not found|home|home page|hm cinema|movies|tv shows|watch online)$/i;
    if (!titleText || genericHeading.test(titleText) ||
        (pagePath !== '/' && (!h1Text || genericHeading.test(h1Text)))) {
        return { valid: false, reason: 'missing or generic page heading/title' };
    }

    const linkTags = html.match(/<link\b[^>]*>/gi) || [];
    const canonicalTag = linkTags.find(tag => readTagAttribute(tag, 'rel').toLowerCase().split(/\s+/).includes('canonical'));
    const canonical = readTagAttribute(canonicalTag, 'href');
    if (!canonical) return { valid: false, reason: 'canonical missing' };
    if (canonical.trim() !== loc) return { valid: false, reason: 'canonical mismatch' };
    return { valid: true };
}

// Validate URLs as Googlebot would see them before publishing them. Confirmed
// missing, redirected, non-canonical or noindex pages are excluded. Temporary
// server/network failures are reported separately so a healthy old URL is not
// accidentally deleted because the origin had a brief outage.
async function validateSitemapUrl(loc) {
    const parsed = new URL(loc);
    const localUrl = LOCAL_API + parsed.pathname + parsed.search;
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const response = await axios.get(localUrl, {
                timeout: 12000,
                maxRedirects: 0,
                validateStatus: () => true,
                headers: {
                    'Host': new URL(CANONICAL_BASE).host,
                    'X-Forwarded-Proto': 'https',
                    'User-Agent': 'Googlebot',
                    'Accept': 'text/html,application/xhtml+xml',
                },
            });
            const result = inspectSitemapResponse(response, loc);
            if (result.valid !== null) return result;
            lastError = new Error(result.reason);
            if (attempt < 3) {
                const retryAfter = Number(response.headers && response.headers['retry-after']);
                const status = Number(response.status || 0);
                const waitMs = status === 429
                    ? (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * attempt)
                    : 1000 * attempt;
                await sleep(Math.min(waitMs, 10000));
            }
        } catch (error) {
            lastError = error;
            if (attempt < 3) await sleep(1000 * attempt);
        }
    }
    return { valid: null, reason: lastError ? lastError.message : 'temporary validation failure' };
}

function readValidationState() {
    try {
        if (!fs.existsSync(VALIDATION_STATE_FILE)) return {};
        const parsed = JSON.parse(fs.readFileSync(VALIDATION_STATE_FILE, 'utf8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
        console.warn(`[sitemap] Could not read validation state: ${error.message}`);
        return {};
    }
}

function writeValidationState(state) {
    const tempFile = VALIDATION_STATE_FILE + '.tmp';
    fs.writeFileSync(tempFile, JSON.stringify(state), 'utf8');
    fs.renameSync(tempFile, VALIDATION_STATE_FILE);
}

function selectValidationWork({ candidates, due, previouslyKnown, state, now, batchSize }) {
    const newDue = due.filter(item => !previouslyKnown.has(item.loc));
    const retryDue = due.filter(item => previouslyKnown.has(item.loc) && state[item.loc]?.valid === null);
    const regularDue = due.filter(item => previouslyKnown.has(item.loc) && state[item.loc]?.valid !== null);
    const priorityDue = [...newDue, ...retryDue];
    const priorityWork = priorityDue.slice(0, batchSize);
    const regularCapacity = Math.max(0, batchSize - priorityWork.length);
    if (!regularCapacity || !regularDue.length) return priorityWork;

    // Start at a deterministic daily offset, then scan cyclically. Fresh URLs
    // are skipped, but cannot leave today's batch empty while other URLs are due.
    const knownCandidates = candidates.filter(item =>
        previouslyKnown.has(item.loc) && state[item.loc]?.valid !== null
    );
    if (!knownCandidates.length) return priorityWork;
    const dayNumber = Math.floor(now / 86400000);
    const start = (dayNumber * regularCapacity) % knownCandidates.length;
    const ordered = knownCandidates.slice(start).concat(knownCandidates.slice(0, start));
    const dueLocs = new Set(regularDue.map(item => item.loc));
    const selectedRegular = ordered.filter(item => dueLocs.has(item.loc)).slice(0, regularCapacity);
    const selectedLocs = new Set(selectedRegular.map(item => item.loc));
    return priorityWork.concat(regularDue.filter(item => selectedLocs.has(item.loc)));
}

async function validateContentUrls(urls, previouslyKnown) {
    const now = Date.now();
    const ttlMs = positiveInteger(process.env.SITEMAP_VALIDATION_TTL_MS, DEFAULT_VALIDATION_TTL_MS);
    const batchSize = positiveInteger(process.env.SITEMAP_VALIDATION_BATCH_SIZE, DEFAULT_VALIDATION_BATCH_SIZE);
    const state = readValidationState();
    const staticPaths = new Set(['/', '/sports', '/watch-movies-online', '/latest-movies-online', '/moviebox-alternatives', '/free-tv-series-online']);
    const candidates = urls.filter(item => {
        const pathname = new URL(item.loc).pathname.replace(/\/$/, '') || '/';
        return /\/(?:movie|tv|music)\/\d+(?:\/|$)/.test(pathname) || staticPaths.has(pathname);
    });
    const due = candidates.filter(item => {
        const previous = state[item.loc];
        if (!previous) return true;
        const age = Number.isFinite(previous.checkedAt) ? now - previous.checkedAt : Infinity;
        if (previous.valid === false) return age >= ttlMs;
        if (previous.valid === null) return true;
        return age >= ttlMs;
    });
    // New URLs and temporary failures are checked first. Known URLs rotate
    // deterministically, while scanning past fresh entries to avoid empty runs.
    const work = selectValidationWork({ candidates, due, previouslyKnown, state, now, batchSize });
    const selected = new Set(work.map(item => item.loc));
    let valid = 0;
    let removed = 0;
    let temporary = 0;
    let deferred = 0;
    let nextIndex = 0;
    const workers = Array.from({ length: 1 }, async () => {
        while (nextIndex < work.length) {
            const item = work[nextIndex++];
            const result = await validateSitemapUrl(item.loc);
            await sleep(500); // one-at-a-time, gently paced catalogue API traffic
            if (result.valid === true) {
                item._keep = true;
                state[item.loc] = { valid: true, checkedAt: now };
                valid++;
            } else if (result.valid === null) {
                item._keep = previouslyKnown.has(item.loc);
                state[item.loc] = { valid: null, checkedAt: now, reason: result.reason };
                temporary++;
                if (item._keep) console.warn(`[sitemap] Temporary validation failure; preserving ${item.loc}: ${result.reason}`);
                else console.warn(`[sitemap] Skipping new URL until it can be verified ${item.loc}: ${result.reason}`);
            } else {
                item._keep = false;
                state[item.loc] = { valid: false, checkedAt: now, reason: result.reason };
                removed++;
                console.warn(`[sitemap] Excluding ${item.loc}: ${result.reason}`);
            }
        }
    });
    await Promise.all(workers);

    for (const item of candidates) {
        if (selected.has(item.loc)) continue;
        const previous = state[item.loc];
        // A previously published URL that is waiting for its audit turn stays
        // temporarily. A brand-new URL is never published without validation.
        item._keep = previous && previous.valid === false
            ? false
            : (previouslyKnown.has(item.loc) || Boolean(previous && previous.valid === true));
        if (item._keep) deferred++;
        else removed++;
    }
    writeValidationState(state);
    const filtered = urls.filter(item => item._keep !== false);
    for (const item of filtered) delete item._keep;
    console.log(`[sitemap] URL validation: ${valid} valid, ${removed} excluded, ${temporary} temporarily unverified, ${deferred} deferred to next batch (checked ${work.length} of ${candidates.length}; ${due.length} due)`);
    return filtered;
}

function readExistingUrls() {
    if (!fs.existsSync(OUT_FILE)) return new Map();
    try {
        const xml = fs.readFileSync(OUT_FILE, 'utf8');
        const entries = new Map();
        for (const match of xml.matchAll(/<url>\s*([\s\S]*?)\s*<\/url>/g)) {
            const loc = match[1].match(/<loc>([^<]+)<\/loc>/);
            const lastmod = match[1].match(/<lastmod>([^<]+)<\/lastmod>/);
            if (loc && loc[1]) {
                entries.set(loc[1], lastmod && lastmod[1] ? lastmod[1] : '');
            }
        }
        return entries;
    } catch (e) {
        console.warn(`[sitemap] Could not read existing sitemap: ${e.message}`);
        return new Map();
    }
}

async function fetchPage(page) {
    const r = await axios.get(`${LOCAL_API}/api/trending?page=${page}&perPage=${PER_PAGE}`, {
        timeout: 30000,
    });
    const data = r.data && (r.data.data || r.data);
    const items = data.subjectList || data.items || data.records || [];
    const pager = data.pager || {};
    const hasMore = pager.hasMore === true || pager.hasMore === 'true';
    return { items, hasMore };
}

async function build() {
    const start = Date.now();
    console.log(`[sitemap] Starting full catalog crawl at ${new Date().toISOString()}`);

    const seen = new Map(); // subjectId → item
    const pageNumbers = getDiscoveryPageNumbers();
    let pagesVisited = 0;
    let errors = 0;

    for (const page of pageNumbers) {
        if (seen.size >= SITEMAP_LIMIT) break;
        try {
            const { items, hasMore } = await fetchPage(page);
            for (const item of items) {
                if (item && item.subjectId && !seen.has(item.subjectId)) {
                    seen.set(item.subjectId, item);
                }
            }
            pagesVisited++;
            if (pageNumbers.indexOf(page) === 0 || pagesVisited % 5 === 0) {
                console.log(`[sitemap] Page ${page}: ${seen.size} unique titles so far, hasMore=${hasMore}`);
            }
            if (pagesVisited < pageNumbers.length) await sleep(DELAY_MS);
        } catch (e) {
            errors++;
            console.error(`[sitemap] Page ${page} error (${errors}/5): ${e.message}`);
            if (errors >= 5) {
                console.error('[sitemap] Too many errors, stopping discovery early.');
                break;
            }
            await sleep(1500);
        }
    }

    console.log(`[sitemap] Crawl done. ${seen.size} unique titles from ${pagesVisited}/${pageNumbers.length} scheduled pages. Errors: ${errors}`);

    const today = new Date().toISOString().slice(0, 10);
    const existingUrls = readExistingUrls();
    const urls = [];
    const urlSet = new Set();
    const addUrl = (url) => {
        if (!url || urlSet.has(url.loc)) return;
        const previousLastmod = existingUrls.get(url.loc);
        if (!url.lastmod && previousLastmod) {
            url.lastmod = previousLastmod;
        }
        urlSet.add(url.loc);
        urls.push(url);
    };
    addUrl({ loc: `${CANONICAL_BASE}/`,       priority: '1.0', changefreq: 'daily' });
    addUrl({ loc: `${CANONICAL_BASE}/sports`, priority: '0.8', changefreq: 'hourly' });
    for (const landingPath of ['/watch-movies-online', '/latest-movies-online', '/moviebox-alternatives', '/free-tv-series-online']) {
        addUrl({ loc: `${CANONICAL_BASE}${landingPath}`, priority: '0.8', changefreq: 'weekly' });
    }

    for (const item of seen.values()) {
        const itemPath = urlFor(item);
        if (!itemPath) continue; // Never invent a movie URL for an unknown content type.
        // If this ID existed under an old/wrong content prefix, retire that URL
        // so the sitemap only advertises the correctly typed canonical path.
        const idPattern = new RegExp('/(?:movie|tv|music)/' + String(item.subjectId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:/|$)');
        for (const oldLoc of existingUrls.keys()) {
            if (idPattern.test(oldLoc) && oldLoc !== CANONICAL_BASE + itemPath) existingUrls.delete(oldLoc);
        }
        const loc = CANONICAL_BASE + itemPath;
        addUrl({
            loc,
            priority: '0.7',
            changefreq: 'weekly',
            // Only claim a recent modification for URLs newly discovered by this crawl.
            ...(existingUrls.has(loc) ? {} : { lastmod: today }),
        });
        // Playback URLs are intentionally excluded: the movie/TV detail page
        // is the indexable landing page, while /watch/:id is noindex,follow.
    }

    // The upstream trending endpoint exposes only a partial catalogue. Preserve
    // previously published detail URLs until their scheduled validation turn;
    // confirmed broken/non-canonical URLs are removed by the audit below.
    for (const loc of existingUrls.keys()) {
        if (!loc.startsWith(CANONICAL_BASE + '/')) continue;
        // Never carry playback URLs forward from an older sitemap. Keep only
        // typed content detail URLs and known static landing pages for now.
        if (/\/watch\//i.test(new URL(loc).pathname)) continue;
        if (!/^https:\/\/hm-cinema\.me\/(?:$|movie\/|tv\/|music\/|sports$|watch-movies-online$|latest-movies-online$|moviebox-alternatives$|free-tv-series-online$)/.test(loc)) continue;
        addUrl({ loc, priority: '0.6', changefreq: 'weekly' });
    }
    if (existingUrls.size && urls.length < existingUrls.size) {
        console.warn(`[sitemap] Retained ${urls.length} candidate URLs from the current crawl and previous sitemap`);
    }

    const previouslyKnown = new Set(existingUrls.keys());
    const validatedUrls = await validateContentUrls(urls, previouslyKnown);

    const body = validatedUrls.map(u => {
        const videoXml = u.video ? (
            '    <video:video>\n' +
            `      <video:thumbnail_loc>${escAttr(u.video.thumbnail)}</video:thumbnail_loc>\n` +
            `      <video:title>${escAttr(u.video.title)}</video:title>\n` +
            `      <video:description>${escAttr(u.video.description)}</video:description>\n` +
            `      <video:content_loc>${escAttr(u.video.contentLoc)}</video:content_loc>\n` +
            (u.video.duration ? `      <video:duration>${u.video.duration}</video:duration>\n` : '') +
            '    </video:video>\n'
        ) : '';
        return '  <url>\n' +
            `    <loc>${escAttr(u.loc)}</loc>\n` +
            (u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : '') +
            `    <priority>${u.priority}</priority>\n` +
            `    <changefreq>${u.changefreq}</changefreq>\n` +
            videoXml +
            '  </url>';
    }).join('\n');

    const xml =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">\n' +
        body + '\n' +
        '</urlset>\n';

    const tempFile = OUT_FILE + '.tmp';
    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.writeFileSync(tempFile, xml, 'utf8');
    fs.renameSync(tempFile, OUT_FILE);
    const kb = Math.round(fs.statSync(OUT_FILE).size / 1024);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[sitemap] Written: ${OUT_FILE} — ${validatedUrls.length} URLs, ${kb}KB, took ${elapsed}s`);
}

if (require.main === module) {
    build().catch(e => { console.error('[sitemap] Fatal:', e.message); process.exit(1); });
}

module.exports = {
    build,
    getSitemapOutputPath,
    startSitemapScheduler,
    validateSitemapUrl,
    inspectSitemapResponse,
    selectValidationWork,
    urlFor,
    getDiscoveryPageNumbers,
};
