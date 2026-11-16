'use strict';

const BASE = 'https://hm-cinema.me';
const PAGES = {
  '/watch-movies-online': {
    catalogue: 'movies-and-series',
    title: 'Watch Movies Online | HM CINEMA',
    description: 'Browse movies and TV series on HM CINEMA. Explore available titles by poster, release year and genre, then open individual pages for details and viewing information.',
    h1: 'Watch Movies Online',
    intro: 'Browse available movies and TV series from the catalogue. Compare titles by release year and genre, then open a title page to review its details and viewing options.',
    sections: [
      ['Find a movie by title', 'Use the search on HM CINEMA to look for a film or series by its name. If a title has several releases, check the year and details before opening it.'],
      ['Discover more than one kind of story', 'Explore films and series across different release years, languages and styles. Movie pages provide title-specific information, while series pages help you identify the show you want.'],
      ['Check details before you watch', 'Open a title page to review its available information and playback options. Availability and playback quality can vary by title, device and connection.']
    ],
    faqs: [
      ['How do I find a specific movie?', 'Open HM CINEMA and use the search field to enter the movie title. Check the release year and title details to choose the correct result.'],
      ['Can I browse TV series too?', 'Yes. HM CINEMA includes movie and TV-series pages, so you can search for either type of title.'],
      ['Will every title always be available?', 'No streaming catalogue is guaranteed to be complete or permanently available. Check the individual title page for its current details and viewing options.']
    ]
  },
  '/latest-movies-online': {
    catalogue: 'latest-movies',
    title: 'New Movies Online & Latest Releases | HM CINEMA',
    description: 'Discover new movies online and browse the latest releases listed in the HM CINEMA catalogue. Compare release dates and genres, then open individual movie pages for details and current viewing information.',
    h1: 'New Movies & Latest Releases',
    intro: 'Looking for new movies online? Explore recent releases currently listed in the catalogue. Compare posters, release dates and genres, then open an individual movie page for its details and current viewing information.',
    sections: [
      ['Search by the exact movie name', 'New releases can have similar titles or different regional names. Search with the full title and verify the release year before choosing a result.'],
      ['Explore popular titles', 'Start with titles currently featured in the catalogue, then use recommendations and related titles where available to discover something else.'],
      ['Check the movie page', 'A movie page is the best place to confirm the title, release information and viewing options currently listed for that film.']
    ],
    faqs: [
      ['Where can I find a newly released movie?', 'Search HM CINEMA using the movie title and check the release year and details on its individual page.'],
      ['Are release dates the same in every country?', 'Not always. Film release dates can differ by country and distribution platform, so check the details for the specific release you mean.'],
      ['Does latest mean every new cinema release is available?', 'No. Catalogue availability varies, and a new cinema release is not guaranteed to be listed.']
    ]
  },
  '/moviebox-alternatives': {
    title: 'MovieBox Alternatives: Explore HM CINEMA',
    description: 'Looking for MovieBox alternatives? Discover HM CINEMA as another movie and TV-series catalogue, and compare title discovery, device support and viewing options.',
    h1: 'Looking for MovieBox Alternatives?',
    intro: 'If you are comparing movie and TV-series platforms, HM CINEMA is another catalogue you can explore. Search for a title, review its details and decide whether the available experience meets your needs.',
    sections: [
      ['Compare the catalogue', 'Search for the exact films and series you care about. Catalogue size alone does not tell you whether a service has the titles, seasons or language options you want.'],
      ['Check the experience on your device', 'Try the site on the phone, tablet or computer you plan to use. Look at page loading, player compatibility, controls and how clearly playback options are presented.'],
      ['Think about safety and availability', 'Before using any streaming service, review its privacy information, permissions, advertising, content rights and local availability. Do not install unknown apps or files just to access a title.'],
      ['Explore HM CINEMA', 'Use the search on HM CINEMA to check whether a particular movie or series is listed. Each title has its own page with the information and viewing options currently available.']
    ],
    faqs: [
      ['Is HM CINEMA the same service as MovieBox?', 'No. HM CINEMA is a separate website and is not affiliated with or endorsed by MovieBox.'],
      ['Is HM CINEMA a MovieBox replacement?', 'It may be another option to compare, but whether it suits you depends on the titles you want, device compatibility, availability and your own safety and privacy requirements.'],
      ['How should I compare streaming platforms?', 'Compare the specific catalogue you need, playback reliability, supported devices, privacy practices, advertising, content rights and availability in your region.']
    ]
  },
  '/free-tv-series-online': {
    catalogue: 'series',
    title: 'TV Series Online | Explore Shows | HM CINEMA',
    description: 'Explore TV series on HM CINEMA. Browse available shows, compare release years and genres, and open individual series pages for details and current viewing information.',
    h1: 'Explore TV Series Online',
    intro: 'Browse TV series listed in the catalogue. Compare show names, release years and genres, then open an individual series page to check its details and viewing information.',
    sections: [
      ['Search for a show', 'Enter the show name in the site search. If more than one result appears, compare the title and release information.'],
      ['Check seasons and episodes', 'Series can have multiple seasons, specials or similarly named editions. Review the page details to make sure you have selected the right show.'],
      ['Explore related titles', 'When recommendations are available, use them to discover other series and films you may want to explore.']
    ],
    faqs: [
      ['Can I search for a specific TV show?', 'Yes. Use the search field on HM CINEMA and enter the show name.'],
      ['Will every season be available?', 'Not necessarily. Season and episode availability can vary by title. Check the series page for current information.'],
      ['How do I avoid choosing the wrong show?', 'Compare the full title, release year and other identifying details before opening a result.']
    ]
  }
};

// Additional catalogue-led landing pages. Each page is backed by real titles
// from the live feed; genres are filtered from the feed's structured genre field.
const GENRE_PAGES = [
  { slug: 'action', label: 'Action', count: 'fast-paced action stories', description: 'Explore action movies with high-energy stories, crime dramas and adventure elements. Browse the titles currently listed in the HM CINEMA catalogue and open each movie page for its details.', faq: ['What can I find in the action movie collection?', 'The collection brings together catalogue titles tagged with the action genre. Each listing links to its own page for the title details.'] },
  { slug: 'comedy', label: 'Comedy', count: 'comedies and light-hearted stories', description: 'Browse comedy movies listed in the HM CINEMA catalogue. Discover films tagged with comedy, compare release years and open a title page to check its details before watching.', faq: ['How are comedy movies selected?', 'Titles are included when the catalogue identifies comedy as one of their genres. The selection can change as the catalogue is updated.'] },
  { slug: 'horror', label: 'Horror', count: 'horror and suspense films', description: 'Find horror movies in the HM CINEMA catalogue, from suspenseful stories to supernatural and thriller-leaning titles. Check each film page for its release information and current viewing details.', faq: ['Are all horror titles supernatural movies?', 'No. Horror covers different styles, including psychological, supernatural and survival stories. Check each title description for its specific theme.'] },
  { slug: 'thriller', label: 'Thriller', count: 'suspense and mystery-driven films', description: 'Explore thriller movies listed in the catalogue. This collection focuses on films tagged with thriller, including suspense, mystery and crime-related stories where those genres overlap.', faq: ['Can a thriller also be a crime or action movie?', 'Yes. A film can have more than one genre, so some titles may also appear in other genre collections.'] },
  { slug: 'romance', label: 'Romance', count: 'romantic stories and relationship dramas', description: 'Browse romance movies from the HM CINEMA catalogue. Find films tagged with romance, including romantic comedies and relationship dramas, then open a title for its full details.', faq: ['Does this collection include romantic comedies?', 'Yes. Titles tagged with romance may also include comedy or drama, so the collection can include different styles of romantic stories.'] },
  { slug: 'drama', label: 'Drama', count: 'character-led stories and dramatic films', description: 'Discover drama movies listed on HM CINEMA. Browse character-focused stories across romance, crime, history and other genres, using each title page to confirm its details.', faq: ['What types of films appear in the drama collection?', 'The catalogue may tag dramas alongside genres such as romance, crime, thriller or history. Open a movie page to review the individual title.'] },
  { slug: 'crime', label: 'Crime', count: 'crime stories and investigations', description: 'Explore crime movies in the HM CINEMA catalogue, including titles that overlap with drama, mystery, thriller and action. Browse the available listings and check each film page for details.', faq: ['Are crime movies also listed under other genres?', 'Yes. Many films have multiple genre tags, so crime titles may also appear in drama, thriller or action collections.'] },
  { slug: 'sci-fi', label: 'Science Fiction', count: 'science-fiction and speculative stories', description: 'Browse science-fiction movies listed in the catalogue. Discover speculative stories and films tagged with sci-fi, then open each title page to check its release information and viewing details.', faq: ['Does science fiction include fantasy movies?', 'They are separate genres, although a title can be tagged with both. This page follows the science-fiction tags supplied by the catalogue.'] }
];

for (const genre of GENRE_PAGES) {
  const title = `${genre.label} Movies Online | HM CINEMA`;
  PAGES[`/${genre.slug}-movies-online`] = {
    catalogue: 'genre-movies', genre: genre.slug, listingHeading: `${genre.label} movies to explore`,
    title, description: `${genre.description} Browse ${genre.label.toLowerCase()} movie listings on HM CINEMA.`,
    h1: `${genre.label} Movies Online`,
    intro: `Looking for ${genre.label.toLowerCase()} movies? ${genre.description} The list below is built from current catalogue entries, not a fixed or guaranteed list.`,
    sections: [
      [`Explore ${genre.label.toLowerCase()} by title`, `Browse the movie posters below and open a title to check its release year, genre tags and current page information. Some films belong to more than one genre. `],
      ['Check the individual movie page', 'Catalogue entries can change over time. Use the movie page to confirm the exact title and review the information currently listed for it.'],
      ['Discover related genres', `If you enjoy ${genre.label.toLowerCase()} stories, explore related catalogue tags such as drama, thriller, romance, crime or adventure when they appear on a title.`]
    ],
    faqs: [genre.faq, ['How often does this movie collection change?', 'The collection is generated from the live catalogue feed and can change when titles are added, removed or updated.']]
  };
}

PAGES['/popular-movies-online'] = {
  catalogue: 'popular-movies', listingHeading: 'Popular movies in the catalogue',
  title: 'Popular Movies Online | Movies to Explore | HM CINEMA',
  description: 'Explore popular movie selections currently featured in the HM CINEMA catalogue. Browse titles and open each movie page for release details and current viewing information.',
  h1: 'Popular Movies Online',
  intro: 'Start with the movie selection currently featured as popular in the catalogue. Browse the titles below, compare release details and open a movie page to learn more.',
  sections: [
    ['A changing selection of movies', 'This page follows the popular-movie collection supplied by the catalogue. It can change as the source updates its featured titles.'],
    ['Find the right release', 'Some movies share similar names or have different releases. Check the year and title details before opening a result.'],
    ['Explore more by genre', 'Use the genre collections on this site to find action, comedy, drama, horror, romance and other kinds of movies.']
  ],
  faqs: [
    ['How are popular movies chosen?', 'The list follows the popular-movie section supplied by the live catalogue feed. HM CINEMA does not claim that it represents a universal ranking.'],
    ['Does popular mean every movie is available?', 'No. The page displays titles currently present in the catalogue. Check each title page for its current details and viewing options.']
  ]
};

PAGES['/popular-tv-series-online'] = {
  catalogue: 'popular-series', listingHeading: 'Popular TV series in the catalogue',
  title: 'Popular TV Series Online | Shows to Explore | HM CINEMA',
  description: 'Discover TV series currently featured in the HM CINEMA popular-series catalogue. Browse show listings and open individual pages for details and current viewing information.',
  h1: 'Popular TV Series Online',
  intro: 'Explore TV shows featured in the catalogue’s popular-series collection. Compare show titles and release information, then open a series page to check its details.',
  sections: [
    ['Discover featured TV shows', 'This selection follows the popular-series section supplied by the catalogue and may change as the source updates its featured titles.'],
    ['Check the correct series', 'Some shows share similar names or have remakes and regional versions. Compare the title and release year before choosing a result.'],
    ['Explore other series collections', 'Browse the latest series page and genre collections to find more shows from the catalogue.']
  ],
  faqs: [
    ['How are popular series selected?', 'The page follows the popular-series collection provided by the live catalogue feed. It is not presented as an independent industry ranking.'],
    ['Are all seasons listed for every show?', 'Season and episode information can vary by title. Open the individual series page to review its current details.']
  ]
};

PAGES['/latest-tv-series-online'] = {
  catalogue: 'latest-series', listingHeading: 'Recently released TV series',
  title: 'Latest TV Series Online | New Shows | HM CINEMA',
  description: 'Browse recently released TV series listed in the HM CINEMA catalogue. Compare show titles and release years, then open each series page for current details.',
  h1: 'Latest TV Series Online',
  intro: 'Find recently released series currently listed in the catalogue. The selection is ordered using the release information available in the feed, which may differ from local premiere dates.',
  sections: [
    ['Browse new series listings', 'Start with the latest entries shown below and open a series page to review its title, release information and available details.'],
    ['Release dates can vary', 'A show may premiere in different countries on different dates. The catalogue date is a guide, not a guarantee of local release timing.'],
    ['Explore popular shows too', 'If you are not looking for a new release, visit the popular TV series collection to discover other featured shows.']
  ],
  faqs: [
    ['Does this page include every new TV premiere?', 'No. It includes recent series currently listed in the HM CINEMA catalogue, not every television premiere worldwide.'],
    ['Why might a release date differ in my country?', 'Regional premiere dates and catalogue metadata can differ. Check the show details and local listings for the most relevant date.']
  ]
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function renderCard(item) {
  const title = escapeHtml(item.title || 'Untitled');
  const href = escapeHtml(item.url || '#');
  const poster = /^https:\/\//i.test(String(item.poster || '')) ? escapeHtml(item.poster) : '';
  const releaseDate = String(item.releaseDate || '');
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(releaseDate) ? new Date(`${releaseDate}T00:00:00Z`) : new Date(releaseDate);
  const releaseLabel = releaseDate && Number.isFinite(parsedDate.getTime())
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parsedDate)
    : (releaseDate.match(/\b(?:19|20)\d{2}\b/) || [])[0] || '';
  const meta = [releaseLabel, item.genre || ''].filter(Boolean).join(' · ');
  return `<article class="title-card"><a class="poster-link" href="${href}">${poster ? `<img src="${poster}" alt="${title} poster" loading="lazy" decoding="async">` : '<span class="poster-placeholder">HM CINEMA</span>'}<span class="card-title">${title}</span></a>${meta ? `<p class="card-meta">${escapeHtml(meta)}</p>` : ''}<a class="details-link" href="${href}">View details</a></article>`;
}

function render(pathname, catalogue = {}) {
  const page = PAGES[pathname];
  if (!page) return null;
  const canonical = BASE + pathname;
  let catalogueHtml = '';
  let listedItems = [];
  if (page.catalogue === 'latest-movies') {
    listedItems = (catalogue.movies || []).slice(0, 18);
    catalogueHtml = `<section class="catalogue-section"><h2>Recently released movies in the catalogue</h2><p class="muted">Browse available movie listings, then open a title for its full details.</p>${listedItems.length ? `<div class="catalog-grid">${listedItems.map(renderCard).join('')}</div>` : '<p class="muted">Movie listings are temporarily unavailable. Please browse the full catalogue.</p>'}</section>`;
  } else if (page.catalogue === 'series') {
    listedItems = (catalogue.series || []).slice(0, 18);
    catalogueHtml = `<section class="catalogue-section"><h2>TV series to explore</h2><p class="muted">Browse available series and open an individual page to check its details.</p>${listedItems.length ? `<div class="catalog-grid">${listedItems.map(renderCard).join('')}</div>` : '<p class="muted">Series listings are temporarily unavailable. Please browse the full catalogue.</p>'}</section>`;
  } else if (page.catalogue === 'movies-and-series') {
    const movies = (catalogue.movies || []).slice(0, 12);
    const series = (catalogue.series || []).slice(0, 12);
    listedItems = [...movies, ...series];
    catalogueHtml = `${movies.length ? `<section class="catalogue-section"><h2>Movies to explore</h2><div class="catalog-grid">${movies.map(renderCard).join('')}</div></section>` : ''}${series.length ? `<section class="catalogue-section"><h2>TV series to explore</h2><div class="catalog-grid">${series.map(renderCard).join('')}</div></section>` : ''}`;
  } else if (page.catalogue === 'genre-movies') {
    const genre = String(page.genre || '').toLowerCase();
    listedItems = (catalogue.movies || []).filter(item => String(item.genre || '').toLowerCase().split(',').map(x => x.trim()).includes(genre)).slice(0, 24);
    catalogueHtml = `<section class="catalogue-section"><h2>${escapeHtml(page.listingHeading || 'Movies to explore')}</h2><p class="muted">${listedItems.length} matching movie listings currently appear in this catalogue snapshot.</p>${listedItems.length ? `<div class="catalog-grid">${listedItems.map(renderCard).join('')}</div>` : '<p class="muted">No matching titles are available in the current catalogue snapshot. Please check again later.</p>'}</section>`;
  } else if (page.catalogue === 'popular-movies' || page.catalogue === 'popular-series' || page.catalogue === 'latest-series') {
    const source = page.catalogue === 'popular-movies' ? catalogue.popularMovies : page.catalogue === 'popular-series' ? catalogue.popularSeries : catalogue.series;
    listedItems = (source || []).slice(0, 18);
    catalogueHtml = `<section class="catalogue-section"><h2>${escapeHtml(page.listingHeading || 'Titles to explore')}</h2>${listedItems.length ? `<div class="catalog-grid">${listedItems.map(renderCard).join('')}</div>` : '<p class="muted">This selection is temporarily unavailable. Please browse the full catalogue.</p>'}</section>`;
  }
  const faqJson = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: page.faqs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }))
  };
  const pageJson = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: page.title, description: page.description, url: canonical, isPartOf: { '@type': 'WebSite', name: 'HM CINEMA', url: BASE + '/' } };
  if (listedItems.length) {
    pageJson.mainEntity = {
      '@type': 'ItemList',
      numberOfItems: listedItems.length,
      itemListElement: listedItems.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.title, url: BASE + item.url }))
    };
  }
  const sections = page.sections.map(([h, p]) => `<section><h2>${escapeHtml(h)}</h2><p>${escapeHtml(p)}</p></section>`).join('\n');
  const faqs = page.faqs.map(([q, a]) => `<section class="faq"><h3>${escapeHtml(q)}</h3><p>${escapeHtml(a)}</p></section>`).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(page.title)}</title><meta name="description" content="${escapeHtml(page.description)}"><meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${canonical}"><meta property="og:type" content="website"><meta property="og:site_name" content="HM CINEMA"><meta property="og:title" content="${escapeHtml(page.title)}"><meta property="og:description" content="${escapeHtml(page.description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${BASE}/og-image.jpg"><meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(pageJson)}</script><script type="application/ld+json">${JSON.stringify(faqJson)}</script>
<style>*{box-sizing:border-box}body{margin:0;background:#0a0a0f;color:#eee;font:16px/1.7 system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:1100px;margin:auto;padding:28px 20px 60px}a{color:#ff6670}header{border-bottom:1px solid #292936;padding:18px 20px}header a{color:#fff;text-decoration:none;font-weight:800;letter-spacing:.08em}.eyebrow{color:#ff6670;text-transform:uppercase;font-size:.78rem;font-weight:700;letter-spacing:.12em;margin-top:28px}h1{font-size:clamp(2rem,6vw,3.3rem);line-height:1.12;margin:10px 0 16px;color:#fff}h2{font-size:1.35rem;color:#fff;margin-bottom:6px}h3{font-size:1.05rem;color:#fff;margin-bottom:4px}.intro{font-size:1.12rem;color:#c9c9d2}.panel{background:#15151f;border:1px solid #292936;border-radius:14px;padding:20px;margin:24px 0}section{margin:28px 0}.cta{display:inline-block;background:#e50914;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:9px;margin:10px 0}.muted{color:#aaa;font-size:.92rem}.catalog-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:16px;margin-top:18px}.title-card{min-width:0;background:#15151f;border:1px solid #292936;border-radius:12px;overflow:hidden;padding-bottom:10px}.poster-link{display:block;color:#fff;text-decoration:none}.title-card img,.poster-placeholder{display:block;width:100%;aspect-ratio:2/3;object-fit:cover;background:#222}.poster-placeholder{display:grid;place-items:center;color:#aaa;font-size:.8rem}.card-title{display:block;padding:9px 9px 0;font-weight:650;line-height:1.3;font-size:.92rem}.card-meta{padding:0 9px;margin:5px 0;color:#aaa;font-size:.78rem}.details-link{display:inline-block;margin:4px 9px 0;font-size:.82rem;font-weight:650}.catalogue-section{margin:34px 0}.catalogue-section h2{font-size:1.55rem}.faq{margin:20px 0}footer{border-top:1px solid #292936;padding-top:20px;margin-top:40px}@media(max-width:900px){.catalog-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}}@media(max-width:560px){main{padding:22px 14px 44px}.catalog-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.card-title{font-size:.78rem;padding:7px 6px 0}.card-meta{font-size:.68rem;padding:0 6px}.details-link{font-size:.72rem;margin-left:6px}}</style></head>
<body><header><a href="${BASE}/">HM CINEMA</a></header><main><div class="eyebrow">Movie & TV discovery</div><h1>${escapeHtml(page.h1)}</h1><p class="intro">${escapeHtml(page.intro)}</p><a class="cta" href="${BASE}/">Explore HM CINEMA</a>
${catalogueHtml}
<div class="panel"><strong>How to get started</strong><p>Choose a movie or series above to open its individual details page. Check the release information and current viewing options listed for that title.</p></div>
${sections}<h2>Frequently asked questions</h2>${faqs}<footer><h2>Explore more on HM CINEMA</h2><p><a href="${BASE}/latest-movies-online">Latest movies</a> · <a href="${BASE}/popular-movies-online">Popular movies</a> · <a href="${BASE}/latest-tv-series-online">Latest TV series</a> · <a href="${BASE}/popular-tv-series-online">Popular TV series</a></p><p>${Object.entries(PAGES).filter(([path]) => path.endsWith('-movies-online') && path !== '/latest-movies-online').map(([path, item]) => `<a href="${BASE}${path}">${escapeHtml(item.h1)}</a>`).join(' · ')}</p><p><a href="${BASE}/">Browse HM CINEMA</a> · <a href="${BASE}/sports">Sports</a></p><p class="muted">HM CINEMA is an independent website. Catalogue and playback availability may change.</p></footer></main></body></html>`;
}
module.exports = { PAGES, render };
