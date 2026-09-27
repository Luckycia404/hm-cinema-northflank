// =============================================================================
// SEO module — adds search-engine-friendly server-rendered pages for individual
// movies and TV shows so they can rank for queries like "avatar 2009", plus a
// dynamic sitemap built from the live catalogue.
//
// Design notes:
//   • Routes return the same SPA index.html template, but with the <title>,
//     meta description, OG/Twitter tags, canonical link and a JSON-LD Movie
//     schema swapped in for the specific title. The SPA's deep-link bootstrap
//     reads the URL on load and auto-opens that movie's modal so the user
//     experience is identical to clicking it from the homepage.
//   • Upstream catalog lookups are cached in-process (1h TTL) so a crawler
//     hitting hundreds of pages doesn't multiply load on the upstream API.
//   • Everything that goes into HTML or JSON-LD is escaped to prevent
//     injection from any field the upstream might return.
// =============================================================================

const fs = require('fs');
const path = require('path');

// ---------- HTML escape helpers ----------------------------------------------
const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escAttr = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => HTML_ESC[c]);
const escText = s => String(s == null ? '' : s).replace(/[&<>]/g, c => HTML_ESC[c]);

// JSON-LD goes inside a <script> tag — JSON.stringify handles quoting, but we
// must also defang any literal "</" sequence so an attacker-supplied field
// can't close the script element.
const jsonLdSafe = obj => JSON.stringify(obj).replace(/<\/(script)/gi, '<\\/$1');

// ---------- in-memory cache --------------------------------------------------
// Single-bucket TTL cache with size cap (LRU-ish via Map insertion order).
// `null` is a valid cached value (used for negative caching), so callers must
// distinguish "cache miss" from "cached null" via the {hit, value} return
// shape rather than truthiness — this is what avoids the negative-cache bug
// where bad IDs would keep re-hitting upstream.
const _cache = new Map();
const _inflight = new Map();
const CACHE_MAX = 5000;

function cacheGet(key, ttlMs) {
    const e = _cache.get(key);
    if (!e) return { hit: false };
    if (Date.now() - e.t > ttlMs) { _cache.delete(key); return { hit: false }; }
    // Touch (move-to-end) so LRU eviction prefers genuinely cold keys.
    _cache.delete(key); _cache.set(key, e);
    return { hit: true, value: e.v };
}
function cacheSet(key, v) {
    if (_cache.has(key)) _cache.delete(key);
    _cache.set(key, { v, t: Date.now() });
    // Evict oldest entries if we've blown past the cap. Keeps memory bounded
    // even under a flood of unique bad IDs from crawlers/probes.
    while (_cache.size > CACHE_MAX) {
        const oldestKey = _cache.keys().next().value;
        if (oldestKey === undefined) break;
        _cache.delete(oldestKey);
    }
    return v;
}

const MOVIE_TTL_MS = 60 * 60 * 1000;       // 1 hour
const NEG_TTL_MS = 5 * 60 * 1000;          // 5 min for negative cache (bad IDs)
const SITEMAP_TTL_MS = 60 * 60 * 1000;     // 1 hour (fetching more pages now)

// ---------- index.html template loader --------------------------------------
// Loaded once at startup and reused; tiny (~300KB) so memory cost is trivial.
let _template = null;
function getTemplate() {
    if (_template) return _template;
    _template = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    return _template;
}
// Allow reload after deploys without restart (handy in dev).
function clearTemplate() { _template = null; }

let _movieTemplate = null;
function getMovieTemplate() {
    if (_movieTemplate) return _movieTemplate;
    _movieTemplate = fs.readFileSync(path.join(__dirname, 'movie.html'), 'utf8');
    return _movieTemplate;
}
function clearMovieTemplate() { _movieTemplate = null; }

// ---------- canonical URL helpers -------------------------------------------
// SEO canonical / og:url / sitemap <loc> values control how Google records the
// site, so we must NOT trust the request Host header — that would let any
// bot or misconfigured proxy poison our canonical URLs. Order of trust:
//   1. CANONICAL_BASE_URL env var (explicit, always wins)
//   2. Hard allowlist of known production hostnames
//   3. localhost / 127.0.0.1 in dev
// Anything else falls back to the production canonical.
const CANONICAL_HOST_ALLOWLIST = new Set([
    'hm-cinema.me',
    'www.hm-cinema.me',
]);
const PRODUCTION_BASE_URL = 'https://hm-cinema.me';

function baseUrl(req) {
    if (process.env.CANONICAL_BASE_URL) return process.env.CANONICAL_BASE_URL;
    const rawHost = (req.get('host') || '').toLowerCase();
    const hostOnly = rawHost.split(':')[0];
    if (CANONICAL_HOST_ALLOWLIST.has(hostOnly)) {
        const proto = req.headers['x-forwarded-proto'] || 'https';
        return `${proto}://${rawHost}`;
    }
    if (hostOnly === 'localhost' || hostOnly === '127.0.0.1' || hostOnly.endsWith('.replit.dev')) {
        const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
        return `${proto}://${rawHost}`;
    }
    return PRODUCTION_BASE_URL;
}

// Slugify a title for pretty URLs ("Avatar: The Way of Water" → "avatar-the-way-of-water")
function slugify(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

// Build the canonical /movie/:id/:slug or /tv/:id/:slug path.
function urlFor(typeOrSubject, idMaybe, titleMaybe) {
    let type, id, title;
    if (typeof typeOrSubject === 'object' && typeOrSubject) {
        type = typeOrSubject.subjectType === 2 ? 'tv' : 'movie';
        id = typeOrSubject.subjectId;
        title = typeOrSubject.title;
    } else {
        type = typeOrSubject;
        id = idMaybe;
        title = titleMaybe;
    }
    const slug = slugify(title);
    return `/${type}/${id}` + (slug ? `/${slug}` : '');
}

// ---------- upstream fetchers (need an axios + HOST_URL injection) ----------
// We don't import axios here — the host index.js wires this up by calling
// configure() at startup so we share its cookie jar / interceptors.
let _fetchers = null;
function configure({ getMovieInfo, getCatalogLists }) {
    _fetchers = { getMovieInfo, getCatalogLists };
}

async function fetchMovieCached(id) {
    if (!_fetchers) throw new Error('seo.js not configured');
    const key = `movie:${id}`;
    // Try positive cache first (1h TTL).
    const posHit = cacheGet(key, MOVIE_TTL_MS);
    if (posHit.hit && posHit.value !== null) return posHit.value;
    // Try negative cache (5min TTL) — only honor cached null if it's still
    // within the shorter negative window. This prevents bad-id floods from
    // hammering upstream while still letting genuinely new IDs retry sooner.
    const negHit = cacheGet(key, NEG_TTL_MS);
    if (negHit.hit && negHit.value === null) return null;
    const pending = _inflight.get(key);
    if (pending) return pending;
    const request = (async () => {
        try {
            const data = await _fetchers.getMovieInfo(id);
            return cacheSet(key, data || null);
        } catch (e) {
            cacheSet(key, null);
            return null;
        } finally {
            _inflight.delete(key);
        }
    })();
    _inflight.set(key, request);
    return request;
}

async function fetchCatalogCached() {
    if (!_fetchers) throw new Error('seo.js not configured');
    const key = 'sitemap:catalog';
    const hit = cacheGet(key, SITEMAP_TTL_MS);
    if (hit.hit && hit.value !== null) return hit.value;
    try {
        const lists = await _fetchers.getCatalogLists();
        return cacheSet(key, (lists && lists.length) ? lists : null) || [];
    } catch (e) {
        return [];
    }
}

// ---------- title / description builders ------------------------------------
function buildPageTitle(subject, isTv) {
    const title = subject.title || 'Untitled';
    const yr = (subject.releaseDate && subject.releaseDate.match(/\b(19|20)\d{2}\b/) || [])[0];
    const yrPart = yr ? ` (${yr})` : '';
    const kind = isTv ? 'Series' : 'Movie';
    return `Watch ${title}${yrPart} Online Free in HD - HM CINEMA`;
}

function buildPageDescription(subject) {
    const title = subject.title || 'this title';
    let desc = (subject.description || '').replace(/\s+/g, ' ').trim();
    if (desc.length > 155) desc = desc.slice(0, 152).trimEnd() + '...';
    if (!desc) {
        const genre = subject.genre ? subject.genre.split(',').slice(0, 2).join(', ') : '';
        desc = `Stream ${title}${genre ? ' (' + genre + ')' : ''} in HD for free on HM CINEMA. No sign-up required.`;
    }
    return desc;
}

// ---------- JSON-LD schema --------------------------------------------------
// Google reads schema.org Movie / TVSeries to render rich results: poster,
// star rating, year, runtime in the SERP. Spec: https://schema.org/Movie
function buildJsonLd(subject, canonicalUrl, isTv) {
    const title = subject.title || 'Untitled';
    const desc = buildPageDescription(subject);
    const poster = subject.cover && subject.cover.url ? subject.cover.url : (subject.thumbnail || '');
    const releaseDate = subject.releaseDate || undefined;
    const genre = subject.genre ? subject.genre.split(',').map(s => s.trim()).filter(Boolean) : undefined;
    const country = subject.countryName || undefined;

    const ld = {
        '@context': 'https://schema.org',
        '@type': isTv ? 'TVSeries' : 'Movie',
        name: title,
        description: desc,
        url: canonicalUrl,
    };
    if (poster) ld.image = poster;
    if (releaseDate) ld.datePublished = releaseDate;
    if (genre && genre.length) ld.genre = genre;
    if (country) ld.countryOfOrigin = { '@type': 'Country', name: country };

    // Duration → ISO 8601 (PT2H35M). Upstream gives seconds.
    if (!isTv && subject.duration && subject.duration > 0) {
        const total = subject.duration;
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        ld.duration = 'PT' + (h ? h + 'H' : '') + (m ? m + 'M' : '');
    }

    // IMDb-style aggregate rating, when present.
    const rating = parseFloat(subject.imdbRatingValue);
    const count = parseInt(subject.imdbRatingCount, 10);
    if (!isNaN(rating) && rating > 0) {
        ld.aggregateRating = {
            '@type': 'AggregateRating',
            ratingValue: rating.toFixed(1),
            bestRating: '10',
            worstRating: '1',
            ratingCount: !isNaN(count) && count > 0 ? count : 1,
        };
    }

    // Top-billed cast → schema.org Person.
    if (Array.isArray(subject._stars) && subject._stars.length) {
        ld.actor = subject._stars.slice(0, 8).map(p => ({
            '@type': 'Person',
            name: p.name || undefined,
            ...(p.character ? { characterName: p.character } : {}),
        })).filter(p => p.name);
    }
    return ld;
}

// Pick the best image for social previews (og:image / twitter:image).
// Social platforms render landscape ~1.91:1 nicely; portrait posters get
// cropped/letterboxed and look broken. So:
//   1) Prefer `stills` (landscape backdrop, ~1024x428)
//   2) Fall back to `trailer.cover` (also landscape)
//   3) Last resort: `cover` (portrait poster — better than nothing)
// Returns { url, width, height } so we can also stamp og:image:width/height
// (Twitter especially uses these to lay out the card).
function pickSocialImage(subject) {
    const candidates = [];
    if (subject.stills && subject.stills.url) {
        candidates.push({ url: subject.stills.url, width: subject.stills.width, height: subject.stills.height });
    }
    const tc = subject.trailer && subject.trailer.cover;
    if (tc && tc.url) {
        candidates.push({ url: tc.url, width: tc.width, height: tc.height });
    }
    if (subject.cover && subject.cover.url) {
        candidates.push({ url: subject.cover.url, width: subject.cover.width, height: subject.cover.height });
    }
    if (subject.thumbnail) {
        candidates.push({ url: subject.thumbnail, width: 0, height: 0 });
    }
    return candidates[0] || { url: '', width: 0, height: 0 };
}

function buildServerHero(subject, isTv, canonicalUrl) {
    const title = subject.title || 'Untitled';
    const desc = buildPageDescription(subject);
    const poster = (subject.cover && subject.cover.url) || subject.thumbnail || '';
    const year = String(subject.releaseYear || subject.releaseDate || subject.year || '').match(/\b(19|20)\d{2}\b/)?.[0] || '';
    const rating = subject.imdbRatingValue || subject.score || subject.rating || '';
    const country = subject.countryName || subject.country || '';
    const genres = String(subject.genre || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 5);
    const typeLabel = isTv ? 'TV Series' : 'Movie';
    const subjectId = subject.subjectId || subject.id || '';
    const watchHref = `/watch/${encodeURIComponent(subjectId)}?title=${encodeURIComponent(title)}`;
    const posterHtml = poster
        ? `<img class="movie-poster-img" src="${escAttr(poster)}" alt="${escAttr(title)} poster">`
        : '';
    const meta = [
        year && `<span class="movie-meta-chip">${escText(year)}</span>`,
        rating && `<span class="movie-meta-chip star">${escText(rating)}</span>`,
        country && `<span class="movie-meta-chip">${escText(country)}</span>`,
    ].filter(Boolean).join('');
    const genreHtml = genres.length
        ? `<div class="movie-genre-row">${genres.map(g => `<span class="movie-genre-tag">${escText(g)}</span>`).join('')}</div>`
        : '';

    return `
    <nav aria-label="Breadcrumb" class="seo-breadcrumbs" style="padding:12px 16px 0;color:#999;font-size:12px">
        <a href="/" style="color:#aaa">Home</a> <span aria-hidden="true">›</span>
        <a href="/#${isTv ? 'tv' : 'movies'}" style="color:#aaa">${isTv ? 'TV Series' : 'Movies'}</a>
        <span aria-hidden="true">›</span> <span>${escText(title)}</span>
    </nav>
    <div class="movie-hero seo-server-hero">
        <div class="movie-hero-inner">
            <div>${posterHtml}</div>
            <div class="movie-info-panel">
                <span class="movie-type-badge">${typeLabel}</span>
                <h1 class="movie-title-main">${escText(title)}</h1>
                <div class="movie-meta-row">${meta}</div>
                ${genreHtml}
                <p class="movie-hero-overview">${escText(desc)}</p>
                <div class="movie-hero-actions">
                    <a class="btn-watch-now" href="${escAttr(watchHref)}">Watch Now</a>
                    <a class="btn-wl" href="${escAttr(canonicalUrl)}">Details</a>
                </div>
            </div>
        </div>
    </div>`;
}

function buildBreadcrumbJsonLd(subject, canonicalUrl, isTv) {
    const root = new URL(canonicalUrl).origin;
    return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: root + '/' },
            { '@type': 'ListItem', position: 2, name: isTv ? 'TV Series' : 'Movies', item: root + `/#${isTv ? 'tv' : 'movies'}` },
            { '@type': 'ListItem', position: 3, name: subject.title || 'Title', item: canonicalUrl },
        ],
    };
}

// ---------- main render: stamp the SPA template with movie SEO --------------
// Returns the modified HTML string. Falls back to the plain template if the
// upstream lookup failed — better to serve the SPA than a 500.
function renderSeoHtml({ template, subject, stars, isTv, canonicalUrl }) {
    if (!subject) return template;

    if (Array.isArray(stars)) subject._stars = stars;

    const title = buildPageTitle(subject, isTv);
    const desc = buildPageDescription(subject);
    const poster = (subject.cover && subject.cover.url) || subject.thumbnail || '';
    const social = pickSocialImage(subject);
    const ldJson = jsonLdSafe(buildJsonLd(subject, canonicalUrl, isTv));
    const breadcrumbJson = jsonLdSafe(buildBreadcrumbJsonLd(subject, canonicalUrl, isTv));

    let html = template;

    // 1. <title>
    html = html.replace(/<title([^>]*)>[\s\S]*?<\/title>/i, (_, _a) => `<title${_a}>${escText(title)}</title>`);

    // 2. <meta name="description">
    html = html.replace(
        /<meta\s+name=["']description["'][^>]*>/i,
        `<meta name="description" content="${escAttr(desc)}">`
    );

    // 3. OG / Twitter tags — replace each match individually, leave others alone.
    html = html.replace(
        /<meta\s+property=["']og:title["'][^>]*>/i,
        `<meta property="og:title" content="${escAttr(title)}">`
    );
    html = html.replace(
        /<meta\s+property=["']og:description["'][^>]*>/i,
        `<meta property="og:description" content="${escAttr(desc)}">`
    );
    html = html.replace(
        /<meta\s+property=["']og:url["'][^>]*>/i,
        `<meta property="og:url" content="${escAttr(canonicalUrl)}">`
    );
    // og:image — landscape preferred so WhatsApp / Twitter / FB previews look
    // good. Also stamp width/height/alt and a Twitter "large image" card so
    // platforms know to render it big rather than tiny-thumbnail style.
    if (social.url) {
        html = html.replace(
            /<meta\s+property=["']og:image["'][^>]*>/i,
            `<meta property="og:image" content="${escAttr(social.url)}">`
        );
        // Width — replace existing or strip if upstream didn't tell us a size.
        if (social.width && social.height) {
            html = html.replace(
                /<meta\s+property=["']og:image:width["'][^>]*>/i,
                `<meta property="og:image:width" content="${social.width}">`
            );
            html = html.replace(
                /<meta\s+property=["']og:image:height["'][^>]*>/i,
                `<meta property="og:image:height" content="${social.height}">`
            );
        } else {
            // Drop the stale 1200x630 tags if we can't honestly fill them in.
            html = html.replace(/<meta\s+property=["']og:image:(width|height)["'][^>]*>\s*/gi, '');
        }
        // Replace twitter:image too, and force the large-image card variant
        // so Twitter/X actually shows the picture in-line.
        if (/<meta\s+name=["']twitter:image["']/i.test(html)) {
            html = html.replace(
                /<meta\s+name=["']twitter:image["'][^>]*>/i,
                `<meta name="twitter:image" content="${escAttr(social.url)}">`
            );
        } else {
            html = html.replace(
                /<\/head>/i,
                `<meta name="twitter:image" content="${escAttr(social.url)}">\n</head>`
            );
        }
        if (/<meta\s+name=["']twitter:card["']/i.test(html)) {
            html = html.replace(
                /<meta\s+name=["']twitter:card["'][^>]*>/i,
                `<meta name="twitter:card" content="summary_large_image">`
            );
        } else {
            html = html.replace(
                /<\/head>/i,
                `<meta name="twitter:card" content="summary_large_image">\n</head>`
            );
        }
    }
    html = html.replace(
        /<meta\s+property=["']og:type["'][^>]*>/i,
        `<meta property="og:type" content="video.${isTv ? 'tv_show' : 'movie'}">`
    );

    // 4. Canonical
    html = html.replace(
        /<link\s+rel=["']canonical["'][^>]*>/i,
        `<link rel="canonical" href="${escAttr(canonicalUrl)}">`
    );

    // 5. Inject JSON-LD just before </head>
    const ldTag = `<script type="application/ld+json">${ldJson}</script>\n` +
        `<script type="application/ld+json">${breadcrumbJson}</script>\n</head>`;
    html = html.replace(/<\/head>/i, ldTag);

    // 6. Replace the marker with a real server-rendered title block. The
    // client-side app replaces this block after hydration for normal users,
    // while crawlers get a meaningful H1, image, description and breadcrumbs
    // in the initial HTML response.
    html = html.replace('<!-- SEO_SERVER_HERO -->', buildServerHero(subject, isTv, canonicalUrl));

    return html;
}

// ---------- sitemap ----------------------------------------------------------
// Pulls trending / popular / hot from the local API helpers and emits a
// sitemap with /, /movie/:id/:slug and /tv/:id/:slug for each unique title.
async function buildSitemapXml(req) {
    const root = baseUrl(req);
    const lists = await fetchCatalogCached();

    // Dedupe on subjectId — same movie often appears in multiple lists.
    const seen = new Map();
    for (const list of lists) {
        for (const item of (list || [])) {
            if (!item || !item.subjectId) continue;
            if (!seen.has(item.subjectId)) seen.set(item.subjectId, item);
        }
    }

    const urls = [];
    urls.push({ loc: `${root}/`, priority: '1.0', changefreq: 'daily' });
    urls.push({ loc: `${root}/sports`, priority: '0.8', changefreq: 'hourly' });

    for (const item of seen.values()) {
        urls.push({
            loc: root + urlFor(item),
            priority: '0.7',
            changefreq: 'weekly',
        });
    }

    const _today = new Date().toISOString().slice(0, 10);
    const body = urls.map(u =>
        '  <url>\n' +
        `    <loc>${escAttr(u.loc)}</loc>\n` +
        `    <lastmod>${u.lastmod || _today}</lastmod>\n` +
        `    <priority>${u.priority}</priority>\n` +
        `    <changefreq>${u.changefreq}</changefreq>\n` +
        '  </url>'
    ).join('\n');

    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        body + '\n' +
        '</urlset>\n';
}

module.exports = {
    configure,
    getTemplate,
    clearTemplate,
    getMovieTemplate,
    clearMovieTemplate,
    baseUrl,
    urlFor,
    slugify,
    fetchMovieCached,
    renderSeoHtml,
    buildSitemapXml,
    // exposed for tests / debugging
    _internal: { buildJsonLd, buildPageTitle, buildPageDescription },
};
