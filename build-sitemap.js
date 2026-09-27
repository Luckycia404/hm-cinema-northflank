#!/usr/bin/env node
// build-sitemap.js — crawls the full catalog via the local API and writes sitemap-full.xml
// Run manually: node /home/ubuntu/hmcinema/build-sitemap.js
// Cron (daily 3am): 0 3 * * * ubuntu node /home/ubuntu/hmcinema/build-sitemap.js >> /var/log/hmcinema-sitemap.log 2>&1

const APP_DIR = __dirname;
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(APP_DIR, '.env') });

const PORT = process.env.PORT || 7800;
const LOCAL_API = `http://127.0.0.1:${PORT}`;
const CANONICAL_BASE = process.env.CANONICAL_BASE_URL || 'https://hm-cinema.me';
const OUT_FILE = path.join(process.env.SITEMAP_OUTPUT_DIR || APP_DIR, 'sitemap-full.xml');
const MAX_PAGES = Number(process.env.SITEMAP_MAX_PAGES || 500); // under Google's 50k URL limit
const PER_PAGE = 60;
const DELAY_MS = Number(process.env.SITEMAP_DELAY_MS || 200); // gentle between pages
const SITEMAP_LIMIT = 49000; // under Google's 50k limit

const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escAttr = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => HTML_ESC[c]);

function slugify(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

function urlFor(item) {
    const type = item.subjectType === 2 ? 'tv' : 'movie';
    const slug = slugify(item.title);
    return `/${type}/${item.subjectId}` + (slug ? `/${slug}` : '');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function readExistingUrls() {
    if (!fs.existsSync(OUT_FILE)) return [];
    try {
        const xml = fs.readFileSync(OUT_FILE, 'utf8');
        return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]).filter(Boolean);
    } catch (e) {
        console.warn(`[sitemap] Could not read existing sitemap: ${e.message}`);
        return [];
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
    const urls = [];
    const urlSet = new Set();
    const addUrl = (url) => {
        if (!url || urlSet.has(url.loc)) return;
        urlSet.add(url.loc);
        urls.push(url);
    };
    addUrl({ loc: `${CANONICAL_BASE}/`,      priority: '1.0', changefreq: 'daily',  lastmod: today });
    addUrl({ loc: `${CANONICAL_BASE}/sports`, priority: '0.8', changefreq: 'hourly', lastmod: today });

    for (const item of seen.values()) {
        addUrl({
            loc: CANONICAL_BASE + urlFor(item),
            priority: '0.7',
            changefreq: 'weekly',
            lastmod: today,
        });
    }

    // The upstream trending endpoint currently reports hasMore=true without a
    // usable total and exposes only a partial catalogue. Preserve the previous
    // validated sitemap instead of silently deleting thousands of URLs, while
    // adding any newly discovered URLs above.
    const existingUrls = readExistingUrls();
    for (const loc of existingUrls) {
        if (!loc.startsWith(CANONICAL_BASE + '/')) continue;
        addUrl({ loc, priority: '0.6', changefreq: 'weekly', lastmod: today });
    }
    if (existingUrls.length && urls.length < existingUrls.length) {
        console.warn(`[sitemap] Preserved ${existingUrls.length} existing URLs; current upstream crawl returned ${urls.length}`);
    }

    const body = urls.map(u =>
        '  <url>\n' +
        `    <loc>${escAttr(u.loc)}</loc>\n` +
        `    <lastmod>${u.lastmod}</lastmod>\n` +
        `    <priority>${u.priority}</priority>\n` +
        `    <changefreq>${u.changefreq}</changefreq>\n` +
        '  </url>'
    ).join('\n');

    const xml =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        body + '\n' +
        '</urlset>\n';

    const tempFile = OUT_FILE + '.tmp';
    fs.writeFileSync(tempFile, xml, 'utf8');
    fs.renameSync(tempFile, OUT_FILE);
    const kb = Math.round(fs.statSync(OUT_FILE).size / 1024);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[sitemap] Written: ${OUT_FILE} — ${urls.length} URLs, ${kb}KB, took ${elapsed}s`);
}

build().catch(e => { console.error('[sitemap] Fatal:', e.message); process.exit(1); });
