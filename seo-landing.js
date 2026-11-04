'use strict';

const BASE = 'https://hm-cinema.me';
const PAGES = {
  '/watch-movies-online': {
    title: 'Watch Movies Online | HM CINEMA',
    description: 'Explore movies and TV series on HM CINEMA. Search by title, discover popular releases, check movie details and find available viewing options.',
    h1: 'Watch Movies Online',
    intro: 'Find movies and TV series in one place. Browse what is popular, search for a particular title, and open its page to check the available details and viewing options.',
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
    title: 'Latest Movies Online | Explore New Releases | HM CINEMA',
    description: 'Explore recently added and popular movie titles on HM CINEMA. Search the catalogue, compare release years and open individual movie pages for details.',
    h1: 'Explore Latest Movies Online',
    intro: 'Looking for something new to watch? Explore the movie catalogue, search for recent releases by name, and check each title page for its release information and available viewing options.',
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
    title: 'Explore TV Series Online | HM CINEMA',
    description: 'Discover TV series on HM CINEMA. Search by show name, verify seasons and episode details, and check the viewing options listed for each series.',
    h1: 'Explore TV Series Online',
    intro: 'Find a show by name and check its series page before you start. Confirm the correct title, season and episode information where available.',
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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function render(pathname) {
  const page = PAGES[pathname];
  if (!page) return null;
  const canonical = BASE + pathname;
  const faqJson = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: page.faqs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }))
  };
  const pageJson = { '@context': 'https://schema.org', '@type': 'WebPage', name: page.title, description: page.description, url: canonical, isPartOf: { '@type': 'WebSite', name: 'HM CINEMA', url: BASE + '/' } };
  const sections = page.sections.map(([h, p]) => `<section><h2>${escapeHtml(h)}</h2><p>${escapeHtml(p)}</p></section>`).join('\n');
  const faqs = page.faqs.map(([q, a]) => `<section class="faq"><h3>${escapeHtml(q)}</h3><p>${escapeHtml(a)}</p></section>`).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(page.title)}</title><meta name="description" content="${escapeHtml(page.description)}"><meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${canonical}"><meta property="og:type" content="website"><meta property="og:site_name" content="HM CINEMA"><meta property="og:title" content="${escapeHtml(page.title)}"><meta property="og:description" content="${escapeHtml(page.description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${BASE}/og-image.jpg"><meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(pageJson)}</script><script type="application/ld+json">${JSON.stringify(faqJson)}</script>
<style>*{box-sizing:border-box}body{margin:0;background:#0a0a0f;color:#eee;font:16px/1.7 system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:900px;margin:auto;padding:28px 20px 60px}a{color:#ff6670}header{border-bottom:1px solid #292936;padding:18px 20px}header a{color:#fff;text-decoration:none;font-weight:800;letter-spacing:.08em}.eyebrow{color:#ff6670;text-transform:uppercase;font-size:.78rem;font-weight:700;letter-spacing:.12em;margin-top:28px}h1{font-size:clamp(2rem,6vw,3.3rem);line-height:1.12;margin:10px 0 16px;color:#fff}h2{font-size:1.35rem;color:#fff;margin-bottom:6px}h3{font-size:1.05rem;color:#fff;margin-bottom:4px}.intro{font-size:1.12rem;color:#c9c9d2}.panel{background:#15151f;border:1px solid #292936;border-radius:14px;padding:20px;margin:24px 0}section{margin:28px 0}.cta{display:inline-block;background:#e50914;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:9px;margin:10px 0}.muted{color:#aaa;font-size:.92rem}footer{border-top:1px solid #292936;padding-top:20px;margin-top:40px}</style></head>
<body><header><a href="${BASE}/">HM CINEMA</a></header><main><div class="eyebrow">Movie & TV discovery</div><h1>${escapeHtml(page.h1)}</h1><p class="intro">${escapeHtml(page.intro)}</p><a class="cta" href="${BASE}/">Explore HM CINEMA</a>
<div class="panel"><strong>How to get started</strong><p>Open the catalogue, enter a movie or series name in search, then check the result's title and release details before opening its page.</p></div>
${sections}<h2>Frequently asked questions</h2>${faqs}<footer><p><a href="${BASE}/">Browse HM CINEMA</a> · <a href="${BASE}/sports">Sports</a></p><p class="muted">HM CINEMA is an independent website. Catalogue and playback availability may change.</p></footer></main></body></html>`;
}
module.exports = { PAGES, render };
