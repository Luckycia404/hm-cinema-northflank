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
const MAX_PAGES = Number(process.env.SITEMAP_MAX_PAGES || 500); // under Google's 50k URL limit
const PER_PAGE = 60;
const DELAY_MS = Number(process.env.SITEMAP_DELAY_MS || 200); // gentle between pages
const SITEMAP_LIMIT = 49000; // under Google's 50k limit
const DEFAULT_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 10 * 1000;
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
    if (!type || !item.subjectId) return null;
    const slug = slugify(item.title);
    return `/${type}/${item.subjectId}` + (slug ? `/${slug}` : '');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
    let page = 0;
    let hasMore = true;
    let errors = 0;

    while (hasMore && page < MAX_PAGES && seen.size < SITEMAP_LIMIT) {
        try {
            const { items, hasMore: more } = await fetchPage(page);
            for (const item of items) {
                if (item && item.subjectId && !seen.has(item.subjectId)) {
                    seen.set(item.subjectId, item);
                }
            }
            hasMore = more && items.length > 0;
            if (page % 25 === 0) {
                console.log(`[sitemap] Page ${page}: ${seen.size} unique titles so far, hasMore=${hasMore}`);
            }
            page++;
            if (hasMore) await sleep(DELAY_MS);
        } catch (e) {
            errors++;
            console.error(`[sitemap] Page ${page} error (${errors}/5): ${e.message}`);
            if (errors >= 5) { console.error('[sitemap] Too many errors, stopping early.'); break; }
            page++;
            await sleep(1500);
        }
    }

    console.log(`[sitemap] Crawl done. ${seen.size} unique titles from ${page} pages. Errors: ${errors}`);

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
        // The dedicated player page is the actual video watch page. Keep it
        // discoverable separately from the movie/series detail page.
        if ([1, 2].includes(Number(item.subjectType))) {
            const videoThumbnail = (item.stills && item.stills.url) || (item.trailer && item.trailer.cover && item.trailer.cover.url) || (item.cover && item.cover.url) || item.thumbnail || '';
            const videoDescription = String(item.description || `Watch ${item.title || 'this title'} on HM CINEMA.`).replace(/\s+/g, ' ').trim().slice(0, 500);
            addUrl({
                loc: `${CANONICAL_BASE}/watch/${encodeURIComponent(item.subjectId)}`,
                priority: '0.65',
                changefreq: 'weekly',
                ...(videoThumbnail ? { video: {
                    title: item.title || 'Watch online',
                    description: videoDescription,
                    thumbnail: videoThumbnail,
                    contentLoc: `${CANONICAL_BASE}/api/video/${encodeURIComponent(item.subjectId)}`,
                    duration: Number(item.duration) > 0 ? Math.round(Number(item.duration)) : 0,
                } } : {}),
            });
        }
    }

    // The upstream trending endpoint currently reports hasMore=true without a
    // usable total and exposes only a partial catalogue. Preserve the previous
    // validated sitemap instead of silently deleting thousands of URLs, while
    // adding any newly discovered URLs above.
    for (const loc of existingUrls.keys()) {
        if (!loc.startsWith(CANONICAL_BASE + '/')) continue;
        addUrl({ loc, priority: '0.6', changefreq: 'weekly' });
        // Preserve a dedicated watch-page URL for every known movie or TV
        // detail page, even when it is outside the current trending crawl.
        const watchMatch = loc.match(/\/(?:movie|tv)\/(\d+)(?:\/|$)/);
        if (watchMatch) {
            addUrl({
                loc: `${CANONICAL_BASE}/watch/${encodeURIComponent(watchMatch[1])}`,
                priority: '0.65',
                changefreq: 'weekly',
            });
        }
    }
    if (existingUrls.size && urls.length < existingUrls.size) {
        console.warn(`[sitemap] Preserved ${existingUrls.size} existing URLs; current upstream crawl returned ${urls.length}`);
    }

    const body = urls.map(u => {
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
    console.log(`[sitemap] Written: ${OUT_FILE} — ${urls.length} URLs, ${kb}KB, took ${elapsed}s`);
}

if (require.main === module) {
    build().catch(e => { console.error('[sitemap] Fatal:', e.message); process.exit(1); });
}

module.exports = {
    build,
    getSitemapOutputPath,
    startSitemapScheduler,
};
