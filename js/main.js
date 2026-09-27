// Global state
let currentMovies = [];
let currentMovieId = '';
let currentVideoUrl = '';
let currentSources = { sources: [], captions: [] };
let isPlaying = false;
let isMuted = false;
let currentQuality = '';
let currentSubjectType = 1; // 1 = movie, 2 = TV series
let currentSeason = 1;
let currentEpisode = 1;
let isForcedLandscape = false;
let isZoomed = false;
let zoomLevel = 0; // 0 = contain (normal), 1 = cover (1x), 2 = cover (1.2x), 3 = cover (1.5x zoom)
let isPiPActive = false;

// Global subtitle state
let currentSubtitles = [];
let currentSubtitleLanguage = 'off';
let activeDashPlayer = null;
let playbackRecoveryInFlight = false;
let playbackRecoveryAttempts = 0;

function isDashSource(source) {
    return String(source?.format || '').toLowerCase() === 'dash' ||
        /\.mpd(?:[?#]|$)/i.test(source?.directUrl || source?.streamUrl || '');
}

function resetDashPlayer() {
    if (activeDashPlayer) {
        try { activeDashPlayer.reset(); } catch (error) {
            console.warn('[DASH] Failed to reset player:', error);
        }
        activeDashPlayer = null;
    }
}

function loadMediaSource(videoPlayer, source, autoplay = false, options = {}) {
    // Let the viewer's browser fetch signed media directly before falling
    // back to the VPS proxy. The VPS IP may be rate-limited by the CDN.
    const useProxy = options.useProxy === true;
    const sourceUrl = isDashSource(source)
        ? (source.proxyUrl || source.streamUrl || source.directUrl || source.cdnUrl)
        : (useProxy
            ? (source.streamUrl || source.proxyUrl || source.directUrl || source.cdnUrl)
            : (source.directUrl || source.cdnUrl || source.streamUrl || source.proxyUrl));
    if (!sourceUrl) return false;

    currentVideoUrl = sourceUrl;
    videoPlayer._hmPlaybackSource = source;
    videoPlayer._hmPlaybackViaProxy = useProxy;
    videoPlayer.pause();
    resetDashPlayer();

    if (isDashSource(source)) {
        if (!window.dashjs || !window.dashjs.MediaPlayer) {
            console.error('[DASH] dash.js did not load');
            return false;
        }

        const dashUrl = source.proxyUrl || source.streamUrl || source.directUrl || source.cdnUrl;
        const dashPlayer = window.dashjs.MediaPlayer().create();
        const headerName = source.signHeaderKey || 'X-MB-Token';
        const headerValue = source.signCookie || '';

        if (headerValue) {
            dashPlayer.extend('RequestModifier', function() {
                return {
                    modifyRequestURL: function(url) { return url; },
                    modifyRequestHeader: function(xhr) {
                        xhr.setRequestHeader(headerName, headerValue);
                        return xhr;
                    }
                };
            }, true);
        }

        dashPlayer.initialize(videoPlayer, dashUrl, autoplay);
        activeDashPlayer = dashPlayer;
        console.log('[DASH] Initialized signed DASH playback');
        return true;
    }

    videoPlayer.src = sourceUrl;
    videoPlayer.load();
    return true;
}

// Episode selection mode: 'watch' opens player, 'external' opens new tab
let episodeSelectMode = 'watch';
        

        // Initialize the app
        document.addEventListener('DOMContentLoaded', function() {
            console.log('Initializing HM CINEMA...');
            loadAllContent();
            setupMobileMenu();
            setupMobileSearch();
            setupVideoPlayer();
            
            // Add retry buttons to all loading states
            document.addEventListener('click', function(e) {
                if (e.target.classList.contains('retry-btn')) {
                    const gridId = e.target.getAttribute('data-grid');
                    const sectionName = e.target.getAttribute('data-section');
                    retryLoadContent(gridId, sectionName);
                }
            });

            resumeActiveSession();

            const backToTopBtn = document.getElementById('backToTop');
            window.addEventListener('scroll', function() {
                if (window.scrollY > 400) {
                    backToTopBtn.classList.add('visible');
                } else {
                    backToTopBtn.classList.remove('visible');
                }
            });
        });

        // Mobile menu setup
        function setupMobileMenu() {
            // Drawer is handled by openDrawer()/closeDrawer() called from HTML onclick.
            // This function only handles closing mobile search on outside click.
            document.addEventListener('click', function(event) {
                if (!event.target.closest('.mobile-search-row') && !event.target.closest('#searchBtnMain')) {
                    closeMobileSearch();
                }
            });
        }

        function handleSearchBtnClick(e) {
            if (window.innerWidth <= 768) {
                e.preventDefault();
                const inp = document.getElementById('searchInput');
                inp.focus();
                inp.select();
            } else {
                searchContent();
            }
        }

        function closeMobileSearch() {
            const row = document.getElementById('mobileSearchRow');
            if (row) {
                row.classList.remove('open');
                const box = document.getElementById('mobileSearchSuggestions');
                if (box) box.classList.remove('show');
                const inp = document.getElementById('mobileSearchInput');
                if (inp) inp.value = '';
            }
        }

        // Wire mobile search input
        function setupMobileSearch() {
            const mobileInput = document.getElementById('mobileSearchInput');
            const mobileSugBox = document.getElementById('mobileSearchSuggestions');
            let mobileDebounce = null;

            mobileInput.addEventListener('input', function() {
                const query = this.value.trim();
                clearTimeout(mobileDebounce);
                if (query.length < 2) { mobileSugBox.classList.remove('show'); return; }
                mobileSugBox.innerHTML = '<div class="suggestion-loading"><i class="fas fa-spinner fa-spin"></i> Searching...</div>';
                mobileSugBox.classList.add('show');
                mobileDebounce = setTimeout(async () => {
                    try {
                        const response = await fetchAPI(`/api/search/${encodeURIComponent(query)}?perPage=6`);
                        const results = extractMoviesFromResponse(response);
                        if (mobileInput.value.trim() !== query) return;
                        if (!results || results.length === 0) {
                            mobileSugBox.innerHTML = '<div class="suggestion-loading">No results found</div>';
                            return;
                        }
                        mobileSugBox.innerHTML = results.slice(0, 6).map(movie => {
                            const id = movie.id || movie.subjectId || '';
                            const title = (movie.title || movie.name || 'Unknown').replace(/'/g, "\\'");
                            const thumb = movie.thumbnail || movie.cover?.url || '';
                            const year = movie.year || '';
                            const rating = movie.rating || '7.5';
                            const type = movie.subjectType || 1;
                            return `<div class="suggestion-item" onclick="closeMobileSearch();location.href='/movie/${id}'">
                                <img src="${thumb}" class="suggestion-poster" alt="${title}" onerror="this.src='https://via.placeholder.com/40x56/333/666?text=...'">
                                <div class="suggestion-info"><div class="suggestion-title">${title}</div><div class="suggestion-meta">${year}</div></div>
                            </div>`;
                        }).join('');
                        mobileSugBox.classList.add('show');
                    } catch(err) { mobileSugBox.classList.remove('show'); }
                }, 400);
            });

            mobileInput.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    mobileSugBox.classList.remove('show');
                    document.getElementById('searchInput').value = this.value;
                    searchContent();
                    closeMobileSearch();
                }
            });
        }

        // Page navigation
        function showHomePage() {
            document.getElementById('homePage').style.display = 'block';
            document.getElementById('searchPage').style.display = 'none';
            document.getElementById('sportsPage').style.display = 'none';
            document.getElementById('searchInput').value = '';
            document.getElementById('searchSuggestions').classList.remove('show');
            document.body.scrollTop = 0;
            document.documentElement.scrollTop = 0;
            if (typeof stopSportsAutoRefresh === 'function') stopSportsAutoRefresh();
        }

        function showSearchPage() {
            document.getElementById('homePage').style.display = 'none';
            document.getElementById('sportsPage').style.display = 'none';
            document.getElementById('searchPage').style.display = 'block';
            document.body.scrollTop = 0;
            document.documentElement.scrollTop = 0;
            if (typeof stopSportsAutoRefresh === 'function') stopSportsAutoRefresh();
        }

        function showAllContent(type, title) {
            showSearchPage();
            document.getElementById('searchResultsTitle').textContent = title + ' - All Content';
            loadEnhancedContentForType(type, 'searchResultsGrid');
        }

       // ENHANCED: Load MUCH more diverse content for "View All" with better endpoints
async function loadEnhancedContentForType(type, gridId) {
    const grid = document.getElementById(gridId);
    grid.innerHTML = '<div class="skeleton-card"><div class="skeleton-poster"></div><div class="skeleton-info"><div class="skeleton-title"></div><div class="skeleton-meta"></div></div></div><div class="skeleton-card"><div class="skeleton-poster"></div><div class="skeleton-info"><div class="skeleton-title"></div><div class="skeleton-meta"></div></div></div><div class="skeleton-card"><div class="skeleton-poster"></div><div class="skeleton-info"><div class="skeleton-title"></div><div class="skeleton-meta"></div></div></div><div class="skeleton-card"><div class="skeleton-poster"></div><div class="skeleton-info"><div class="skeleton-title"></div><div class="skeleton-meta"></div></div></div><div class="skeleton-card"><div class="skeleton-poster"></div><div class="skeleton-info"><div class="skeleton-title"></div><div class="skeleton-meta"></div></div></div><div class="skeleton-card"><div class="skeleton-poster"></div><div class="skeleton-info"><div class="skeleton-title"></div><div class="skeleton-meta"></div></div></div>';
    
    let endpoints = [];
    const searchTerms = [];
    
    switch(type) {
        case 'trending':
            endpoints = [
                '/api/trending?page=0&perPage=50',
                '/api/trending?page=1&perPage=50',
                '/api/trending?page=2&perPage=50',
                '/api/hot?perPage=50',
                '/api/popular?perPage=50',
                '/api/homepage'
            ];
            searchTerms.push('2024', '2025', 'action', 'comedy', 'drama', 'thriller', 'adventure');
            break;
        case 'movies':
            endpoints = [
                '/api/search/movie?type=1&perPage=60',
                '/api/search/2025?type=1&perPage=40',
                '/api/search/2024?type=1&perPage=40',
                '/api/trending?page=0&perPage=40',
                '/api/trending?page=1&perPage=40',
                '/api/trending?page=2&perPage=40'
            ];
            searchTerms.push('action', 'comedy', 'drama', 'thriller', 'horror', 'romance', 'sci-fi', 'fantasy');
            break;
        case 'tv':
            endpoints = [
                '/api/search/series?type=2&perPage=60',
                '/api/search/2025?type=2&perPage=40',
                '/api/search/2024?type=2&perPage=40',
                '/api/trending?page=0&perPage=40',
                '/api/trending?page=1&perPage=40',
                '/api/trending?page=2&perPage=40'
            ];
            searchTerms.push('netflix', 'hbo', 'amazon', 'disney', 'marvel', 'dc', 'anime', 'korean');
            break;
        case 'new':
            endpoints = [
                '/api/search/2025?perPage=60',
                '/api/search/2026?perPage=60',
                '/api/search/2025?type=1&perPage=50',
                '/api/search/2025?type=2&perPage=50',
                '/api/search/2026?type=1&perPage=50',
                '/api/search/2026?type=2&perPage=50'
            ];
            searchTerms.push('2025', '2026');
            break;
        case 'anime':
            endpoints = ['/api/search/anime?perPage=60', '/api/search/animated?perPage=60', '/api/search/anime%20english%20dubbed?perPage=60'];
            searchTerms.push('anime', 'animated', 'cartoon');
            break;
        case 'nollywood':
            endpoints = ['/api/search/nollywood?perPage=60'];
            searchTerms.push('nollywood', 'nigerian');
            break;
        case 'kdrama':
            endpoints = ['/api/search/k-drama?perPage=60', '/api/search/kdrama?perPage=60'];
            searchTerms.push('korean', 'drama');
            break;
        case 'sadrama':
            endpoints = ['/api/search/sa%20drama?perPage=60', '/api/search/south%20african%20drama?perPage=60'];
            searchTerms.push('south africa', 'africa');
            break;
        case 'horror':
            endpoints = ['/api/search/horror?perPage=60'];
            searchTerms.push('horror', 'scary', 'thriller');
            break;
        case 'adventure':
            endpoints = ['/api/search/adventure?perPage=60'];
            searchTerms.push('adventure', 'action');
            break;
        case 'adultcontent':
            endpoints = ['/api/search/18+?perPage=60', '/api/search/erotic?perPage=60'];
            searchTerms.push('18+', 'erotic');
            break;
        case 'shorttv':
            endpoints = ['/api/search/short%20tv?perPage=60', '/api/search/short%20series?perPage=60'];
            searchTerms.push('short', 'series');
            break;
        case 'blackshows':
            endpoints = ['/api/search/black%20shows?perPage=60', '/api/search/african%20shows?perPage=60'];
            searchTerms.push('black', 'shows');
            break;
        case 'upcoming':
            endpoints = ['/api/search/action?perPage=60', '/api/search/sci-fi?perPage=60'];
            searchTerms.push('action', 'sci-fi');
            break;
        default:
            endpoints = ['/api/homepage'];
    }
    
    let allMovies = [];
    let loadedCount = 0;
    const maxMovies = 200; // Much higher limit for "View All"
    
    console.log(`[START] Loading enhanced content for ${type}, targeting ${maxMovies} movies`);
    
    // Load from primary endpoints first
    for (const endpoint of endpoints) {
        if (loadedCount >= maxMovies) break;
        
        try {
            console.log(`[RETRY] Loading from: ${endpoint}`);
            const response = await fetchAPI(endpoint);
            let movies = extractMoviesFromResponse(response);
            
            // Filter to only 2025-2026 for "new" releases
            if (type === 'new') {
                movies = movies.filter(movie => {
                    let year = movie.year;
                    if (!year && movie.releaseDate) {
                        year = new Date(movie.releaseDate).getFullYear();
                    }
                    const yearNum = parseInt(year);
                    return yearNum === 2025 || yearNum === 2026;
                });
                console.log(`[FILTER] View All filtered to ${movies.length} movies from 2025-2026`);
            }
            
            if (movies.length > 0) {
                const newMovies = movies.filter(movie => 
                    !allMovies.some(existing => 
                        existing.subjectId === movie.subjectId || 
                        existing.id === movie.id
                    )
                );
                allMovies = allMovies.concat(newMovies);
                loadedCount += newMovies.length;
                console.log(`[SUCCESS] Added ${newMovies.length} unique movies from ${endpoint}, total: ${allMovies.length}`);
            }
        } catch (error) {
            console.log(`[ERROR] Endpoint ${endpoint} failed:`, error.message);
        }
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    // If we need more content, try search terms
    if (allMovies.length < 100 && searchTerms.length > 0) {
        console.log(`[SEARCH] Need more content, trying search terms: ${searchTerms.join(', ')}`);
        
        for (const term of searchTerms) {
            if (allMovies.length >= maxMovies) break;
            
            try {
                const searchResponse = await fetchAPI(`/api/search/${term}?perPage=30`);
                let searchMovies = extractMoviesFromResponse(searchResponse);
                
                // Filter to only 2025-2026 for "new" releases
                if (type === 'new') {
                    searchMovies = searchMovies.filter(movie => {
                        let year = movie.year;
                        if (!year && movie.releaseDate) {
                            year = new Date(movie.releaseDate).getFullYear();
                        }
                        const yearNum = parseInt(year);
                        return yearNum === 2025 || yearNum === 2026;
                    });
                }
                
                const uniqueSearchMovies = searchMovies.filter(movie => 
                    !allMovies.some(existing => 
                        existing.subjectId === movie.subjectId || 
                        existing.id === movie.id
                    )
                );
                allMovies = allMovies.concat(uniqueSearchMovies);
                loadedCount += uniqueSearchMovies.length;
                console.log(`[SEARCH] Added ${uniqueSearchMovies.length} from search: ${term}, total: ${allMovies.length}`);
                
                await new Promise(resolve => setTimeout(resolve, 400));
            } catch (error) {
                console.log(`Search for ${term} failed:`, error);
            }
        }
    }
    
    console.log(`[DATA] Final total for ${type}: ${allMovies.length} unique movies`);
    
    if (allMovies.length === 0) {
        grid.innerHTML = `
            <div class="loading">
                <div>No content available for this category</div>
                <button class="retry-btn btn btn-secondary" data-grid="${gridId}" data-section="${type}">
                    <i class="fas fa-redo"></i>
                    Retry
                </button>
            </div>
        `;
        return;
    }
    
    // Shuffle the movies to show different content
    const shuffledMovies = shuffleArray(allMovies);
    const moviesToDisplay = shuffledMovies.slice(0, maxMovies);
    
    // Display all movies at once for "View All"
    displayMovies(moviesToDisplay, gridId, false);
    
    // Add infinite scroll for "View All" sections
    setupInfiniteScroll(gridId, type);
}

        // Helper function to shuffle array (mix up the content)
        function shuffleArray(array) {
            const newArray = [...array];
            for (let i = newArray.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
            }
            return newArray;
        }

        // API Functions with improved error handling
        async function fetchAPI(endpoint) {
            try {
                console.log('[SEARCH] Fetching from backend:', endpoint);
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
                
                const response = await fetch(endpoint, {
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                
                const data = await response.json();
                console.log('[SUCCESS] API Response for', endpoint, ':', data);
                return data;
            } catch (error) {
                console.error('[ERROR] API Error for', endpoint, ':', error);
                if (error.name === 'AbortError') {
                    throw new Error('Request timeout - server took too long to respond');
                }
                throw error;
            }
        }

        // Enhanced source processing
        function enhanceSourcesWithQuality(sources) {
            if (!sources || !Array.isArray(sources)) return [];
            
            return sources.map((source, index) => {
                let quality = source.quality || 'Unknown';
                const url = source.downloadUrl || source.proxyUrl || source.directUrl || source.streamUrl || source.url;
                
                if (!source.quality && url) {
                    const qualityMatch = url.match(/(\d+p|HD|SD|FHD|UHD|4K)/i);
                    if (qualityMatch) {
                        quality = qualityMatch[1].toUpperCase();
                    }
                }
                
                let format = source.format || 'mp4';
                const formatMatch = url ? url.match(/\.(mp4|mkv|avi|mov|wmv|flv|webm)/i) : null;
                if (!source.format && formatMatch) {
                    format = formatMatch[1].toLowerCase();
                }
                
                return {
                    ...source,
                    quality: quality,
                    format: format,
                    label: `${quality} ${format.toUpperCase()}${source.size ? ` (${formatFileSize(source.size)})` : ''}`
                };
            }).sort((a, b) => {
                const qualityOrder = { '4K': 4, 'UHD': 3, 'FHD': 2, 'HD': 1, 'SD': 0 };
                const aNumeric = parseInt(a.quality, 10);
                const bNumeric = parseInt(b.quality, 10);
                if (!Number.isNaN(aNumeric) && !Number.isNaN(bNumeric)) {
                    return bNumeric - aNumeric;
                }
                const aOrder = qualityOrder[a.quality] ?? -1;
                const bOrder = qualityOrder[b.quality] ?? -1;
                return bOrder - aOrder;
            });
        }

        // Check whether a CDN URL's t= timestamp has expired
        function isUrlExpired(url) {
            try {
                const match = (url || '').match(/[?&]t=(\d+)/);
                if (!match) return false;
                return Math.floor(Date.now() / 1000) > parseInt(match[1], 10);
            } catch (e) { return false; }
        }

        // Get streaming sources for a movie with improved error handling
        // Returns an object with { sources: [], captions: [] } to support subtitles
        async function getMovieSources(movieId, season = 0, episode = 0, detailPath = '') {
            if (!movieId) {
                console.error('[ERROR] No movie ID provided');
                return { sources: [], captions: [] };
            }
            
            try {
                let endpoint = `/api/sources/${movieId}`;
                // Build query params - pass detailPath when available (avoids info lookup for dubs)
                const _qp = new URLSearchParams();
                if (season > 0 || episode > 0) { _qp.set('season', season); _qp.set('episode', episode); }
                if (detailPath) _qp.set('detailPath', detailPath);
                const _qs = _qp.toString(); if (_qs) endpoint += '?' + _qs;
                
                console.log('[MOVIE] Fetching sources for movie ID:', movieId, 'Season:', season, 'Episode:', episode);
                const response = await fetchAPI(endpoint);
                
                if (!response) {
                    console.error('[ERROR] No response from sources API');
                    return { sources: [], captions: [] };
                }
                
                let sources = [];
                let captions = [];
                
                // Handle different response structures
                if (response.data) {
                    if (response.data.processedSources && Array.isArray(response.data.processedSources)) {
                        sources = response.data.processedSources;
                    } else if (response.data.downloads && Array.isArray(response.data.downloads)) {
                        sources = response.data.downloads;
                    } else if (Array.isArray(response.data)) {
                        sources = response.data;
                    }
                    // Extract captions/subtitles from response
                    if (response.data.captions && Array.isArray(response.data.captions)) {
                        captions = response.data.captions;
                    }
                } else if (response.processedSources && Array.isArray(response.processedSources)) {
                    sources = response.processedSources;
                } else if (response.downloads && Array.isArray(response.downloads)) {
                    sources = response.downloads;
                }
                
                // Also check for captions at the top level
                if (response.captions && Array.isArray(response.captions)) {
                    captions = response.captions;
                }
                
                console.log(`[PACK] Found ${sources.length} sources and ${captions.length} captions for movie ${movieId}`);
                
                // Return object with both sources and captions
                return {
                    sources: enhanceSourcesWithQuality(sources),
                    captions: captions
                };
                
            } catch (error) {
                console.error('[ERROR] Error getting sources:', error);
                return { sources: [], captions: [] };
            }
        }

        // Enhanced movie info loading with all metadata
async function loadMovieInfo(movieId) {
    try {
        console.log('[INFO] Loading enhanced movie info for:', movieId);
        const movieInfoResponse = await fetchAPI(`/api/info/${movieId}`);
        
        if (!movieInfoResponse || !movieInfoResponse.data) {
            console.error('[ERROR] No movie info received');
            return;
        }
        
        let movieInfo = null;
        let stars = [];
        let resource = null;
        
        // Extract movie info from different response structures
        if (movieInfoResponse.data.subject) {
            movieInfo = movieInfoResponse.data.subject;
            stars = movieInfoResponse.data.stars || [];
            resource = movieInfoResponse.data.resource || null;
        } else if (movieInfoResponse.data) {
            movieInfo = movieInfoResponse.data;
        } else if (movieInfoResponse.subject) {
            movieInfo = movieInfoResponse.subject;
        }
        
        if (movieInfo) {
            // Basic info
            document.getElementById('modalTitle').textContent = movieInfo.title || movieInfo.name || 'Unknown Title';
            let modalYear = movieInfo.year || movieInfo.releaseYear || '';
            if (!modalYear && movieInfo.releaseDate) {
                const ym = movieInfo.releaseDate.match(/\b(19|20)\d{2}\b/);
                if (ym) modalYear = ym[0];
            }
            document.getElementById('modalYear').textContent = modalYear || 'N/A';
            document.getElementById('modalRating').textContent = movieInfo.rating ? movieInfo.rating + '/10' : '7.5/10';
            document.getElementById('modalDescription').textContent = movieInfo.introduction || movieInfo.description || 'No description available.';
            
            // Enhanced metadata
            document.getElementById('modalCountry').textContent = movieInfo.countryName || 'Unknown';
            document.getElementById('modalImdbRating').textContent = movieInfo.imdbRatingValue ? `IMDb: ${movieInfo.imdbRatingValue}` : 'IMDb: N/A';
            
            // Duration formatting
            if (movieInfo.duration) {
                const hours = Math.floor(movieInfo.duration / 3600);
                const minutes = Math.floor((movieInfo.duration % 3600) / 60);
                document.getElementById('modalDuration').textContent = `${hours}h ${minutes}m`;
            }
            
            // Release date
            if (movieInfo.releaseDate) {
                const releaseDate = new Date(movieInfo.releaseDate).toLocaleDateString();
                document.getElementById('modalReleaseDate').textContent = releaseDate;
            }
            
            // Genre tags
            if (movieInfo.genre) {
                const genres = movieInfo.genre.split(',').map(genre => genre.trim());
                const genreHTML = genres.map(genre => 
                    `<span class="genre-tag">${genre}</span>`
                ).join('');
                document.getElementById('genreTags').innerHTML = genreHTML;
            }
            
            // Subtitles
            if (movieInfo.subtitles) {
                const subtitleCount = movieInfo.subtitles.split(',').length;
                document.getElementById('modalSubtitles').textContent = `${subtitleCount} languages`;
            }
            
            // Source info
            if (resource && resource.source) {
                document.getElementById('modalSource').textContent = resource.source;
                if (resource.uploadBy) {
                    document.getElementById('modalSource').textContent += ` (by ${resource.uploadBy})`;
                }
            }
            
          // Cast section - Filter duplicates
if (stars && stars.length > 0) {
    // Filter out duplicate actors (same name)
    const uniqueStars = stars.filter((star, index, self) => 
        index === self.findIndex(s => s.name === star.name)
    );
    
    const castHTML = uniqueStars.slice(0, 6).map(star => `
        <div class="cast-card">
            <img src="${star.avatarUrl || 'https://via.placeholder.com/80x80/333/666?text=No+Image'}" 
                 alt="${star.name}" 
                 class="cast-avatar"
                 onerror="this.src='https://via.placeholder.com/80x80/333/666?text=No+Image'">
            <div class="cast-name">${star.name}</div>
            <div class="cast-character">${star.character || 'Actor'}</div>
        </div>
    `).join('');
    
    document.getElementById('castGrid').innerHTML = castHTML;
    document.getElementById('castSection').style.display = 'block';
} else {
    document.getElementById('castSection').style.display = 'none';
}

// Show additional info section
document.getElementById('additionalInfo').style.display = 'block';

// Detect if it's a TV series (subjectType 2)
currentSubjectType = movieInfo.subjectType || 1;

// Add to watch history with real movie data
const movieTitle = movieInfo.title || movieInfo.name || 'Unknown Title';
const movieThumbnail = movieInfo.cover?.url || movieInfo.stills?.url || 'https://via.placeholder.com/300x450';
addToHistory(movieId, movieTitle, movieThumbnail);
            

        }
    } catch (error) {
        console.error('[ERROR] Error loading enhanced movie info:', error);
        document.getElementById('modalTitle').textContent = 'Movie Information';
        document.getElementById('modalDescription').textContent = 'Unable to load movie details at this time.';
    }
}

        // FIXED: Enhanced movie extraction with real date handling
        function extractMoviesFromResponse(data) {
            if (!data) {
                console.log('[ERROR] No data provided to extractMoviesFromResponse');
                return [];
            }
            
            console.log('[SEARCH] Extracting movies from response:', data);
            
            let movies = [];
            
            // Handle different API response structures
            if (data.data) {
                // Trending endpoint structure
                if (Array.isArray(data.data.subjectList)) {
                    movies = data.data.subjectList;
                }
                // Homepage endpoint structure - extract from operatingList sections
                else if (Array.isArray(data.data.operatingList)) {
                    data.data.operatingList.forEach(section => {
                        if (section.subjects && Array.isArray(section.subjects)) {
                            movies = movies.concat(section.subjects);
                        }
                    });
                }
                // Search endpoint structure
                else if (Array.isArray(data.data.items)) {
                    movies = data.data.items;
                }
                else if (Array.isArray(data.data)) {
                    movies = data.data;
                }
                else if (data.data.subject) {
                    movies = [data.data.subject];
                }
                // Hot/Popular endpoints
                else if (Array.isArray(data.data.popularSearches)) {
                    movies = data.data.popularSearches;
                }
            } 
            // Direct array responses
            else if (Array.isArray(data.items)) {
                movies = data.items;
            } 
            else if (Array.isArray(data)) {
                movies = data;
            } 
            else if (data.subject) {
                movies = [data.subject];
            }
            // Handle subjectList directly
            else if (Array.isArray(data.subjectList)) {
                movies = data.subjectList;
            }
            
            // Enhanced date processing for all movies
            movies = movies.map(movie => {
                const processedMovie = { ...movie };
                
                // Extract real year from available fields
                const currentYear = new Date().getFullYear();
                let extractedYear = null;
                
                // Check various date fields in priority order
                if (processedMovie.year && /^\d{4}$/.test(processedMovie.year.toString())) {
                    const yearNum = parseInt(processedMovie.year);
                    if (yearNum >= 1900 && yearNum <= currentYear + 2) {
                        extractedYear = yearNum.toString();
                    }
                }
                
                if (!extractedYear && processedMovie.releaseYear) {
                    const yearMatch = processedMovie.releaseYear.toString().match(/\b(19|20)\d{2}\b/);
                    if (yearMatch) {
                        const yearNum = parseInt(yearMatch[0]);
                        if (yearNum >= 1900 && yearNum <= currentYear + 2) {
                            extractedYear = yearNum.toString();
                        }
                    }
                }
                
                if (!extractedYear && processedMovie.releaseDate) {
                    const yearMatch = processedMovie.releaseDate.match(/\b(19|20)\d{2}\b/);
                    if (yearMatch) {
                        const yearNum = parseInt(yearMatch[0]);
                        if (yearNum >= 1900 && yearNum <= currentYear + 2) {
                            extractedYear = yearNum.toString();
                        }
                    }
                }
                
                // Set validated year (including 2025 movies)
                processedMovie.year = extractedYear || '';
                
                // Use real rating from API - prefer imdbRatingValue
                let finalRating = '7.5'; // Default fallback
                
                if (processedMovie.imdbRatingValue) {
                    if (typeof processedMovie.imdbRatingValue === 'string') {
                        const numRating = parseFloat(processedMovie.imdbRatingValue);
                        finalRating = isNaN(numRating) ? '7.5' : numRating.toFixed(1);
                    } else if (typeof processedMovie.imdbRatingValue === 'number') {
                        finalRating = processedMovie.imdbRatingValue.toFixed(1);
                    }
                } else if (processedMovie.rating) {
                    if (typeof processedMovie.rating === 'string') {
                        const numRating = parseFloat(processedMovie.rating);
                        finalRating = isNaN(numRating) ? '7.5' : numRating.toFixed(1);
                    } else if (typeof processedMovie.rating === 'number') {
                        finalRating = processedMovie.rating.toFixed(1);
                    }
                }
                
                processedMovie.rating = finalRating;
                
                return processedMovie;
            });
            
            console.log(`[MOVIE] Extracted ${movies.length} movies with enhanced date handling`);
            return movies;
        }

        // Load all content on homepage with sequential loading
        async function loadAllContent() {
            console.log('🏠 Loading all homepage content...');
            const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
            const safeLoad = async (fn, name) => {
                try { await fn(); } catch (e) { console.error(`[ERROR] Section "${name}" failed:`, e.message); }
            };
            // Batch 1: top visible sections fire immediately
            Promise.allSettled([
                safeLoad(loadTrending, 'Trending'),
                safeLoad(loadMovies, 'Movies'),
                safeLoad(loadTVSeries, 'TV Series'),
                safeLoad(loadNewReleases, 'New Releases'),
            ]);
            // Batch 2: secondary sections after a short pause to avoid upstream rate-limiting
            await delay(350);
            Promise.allSettled([
                safeLoad(loadAnime, 'Anime'),
                safeLoad(loadNollywood, 'Nollywood'),
                safeLoad(loadKDrama, 'K-Drama'),
                safeLoad(loadSADrama, 'SA Drama'),
            ]);
            // Batch 3: remaining sections
            await delay(350);
            Promise.allSettled([
                safeLoad(loadHorror, 'Horror'),
                safeLoad(loadAdventure, 'Adventure'),
                safeLoad(loadAdultContent, 'Adult Content'),
                safeLoad(loadShortTV, 'Short TV'),
            ]);
            console.log('[SUCCESS] All homepage sections loading initiated');
        }

        // Improved content loading with better fallbacks
        async function loadContentWithFallback(endpoints, gridId, sectionName, limit = 18, filterByYear = false) {
            const grid = document.getElementById(gridId);
            grid.innerHTML = `<div class="skeleton-card"><div class="skeleton-poster"></div><div class="skeleton-info"><div class="skeleton-title"></div><div class="skeleton-meta"></div></div></div><div class="skeleton-card"><div class="skeleton-poster"></div><div class="skeleton-info"><div class="skeleton-title"></div><div class="skeleton-meta"></div></div></div><div class="skeleton-card"><div class="skeleton-poster"></div><div class="skeleton-info"><div class="skeleton-title"></div><div class="skeleton-meta"></div></div></div><div class="skeleton-card"><div class="skeleton-poster"></div><div class="skeleton-info"><div class="skeleton-title"></div><div class="skeleton-meta"></div></div></div><div class="skeleton-card"><div class="skeleton-poster"></div><div class="skeleton-info"><div class="skeleton-title"></div><div class="skeleton-meta"></div></div></div><div class="skeleton-card"><div class="skeleton-poster"></div><div class="skeleton-info"><div class="skeleton-title"></div><div class="skeleton-meta"></div></div></div>`;
            
            let allMovies = [];
            let lastError = '';
            
            for (const endpoint of endpoints) {
                try {
                    console.log(`[RETRY] Trying endpoint: ${endpoint}`);
                    const response = await fetchAPI(endpoint);
                    let movies = extractMoviesFromResponse(response);
                    
                    // Specific filtering for Nollywood to ensure only Nigerian movies
                    if (gridId === 'nollywoodGrid') {
                        const beforeFilter = movies.length;
                        movies = movies.filter(movie => {
                            const title = (movie.title || '').toLowerCase();
                            const desc = (movie.description || movie.introduction || '').toLowerCase();
                            const country = (movie.countryName || '').toLowerCase();
                            const genre = (movie.genre || '').toLowerCase();

                            // Country check is the most reliable
                            if (country === 'nigeria') return true;
                            
                            // Genre check
                            if (genre.includes('nollywood')) return true;

                            // Title/Desc keyword check
                            return title.includes('nigeria') || 
                                   title.includes('nollywood') || 
                                   title.includes('nigerian') ||
                                   desc.includes('nigeria') || 
                                   desc.includes('nollywood') || 
                                   desc.includes('nigerian');
                        });
                        console.log(`[NOLLYWOOD FILTER] Filtered ${beforeFilter} to ${movies.length} movies (Country: Nigeria/Nollywood)`);
                    }
                    
                    console.log(`[SUCCESS] Endpoint ${endpoint} returned ${movies.length} movies`);
                    
                    if (movies.length > 0) {
                        allMovies = movies;
                        break;
                    }
                } catch (error) {
                    console.log(`[ERROR] Endpoint ${endpoint} failed:`, error.message);
                    lastError = error.message;
                }
            }
            
            // Filter to only 2025-2026 content AFTER getting movies from fallback
            if (filterByYear && allMovies.length > 0) {
                const beforeFilter = allMovies.length;
                allMovies = allMovies.filter(movie => {
                    let year = movie.year;
                    if (!year && movie.releaseDate) {
                        year = new Date(movie.releaseDate).getFullYear();
                    }
                    // Convert to number for comparison
                    const yearNum = parseInt(year);
                    return yearNum === 2025 || yearNum === 2026;
                });
                console.log(`[FILTER] Filtered ${sectionName} from ${beforeFilter} to ${allMovies.length} movies (2025-2026 only)`);
            }
            
            console.log(`[DATA] Final result for ${sectionName}: ${allMovies.length} movies`);
            
            if (allMovies.length === 0) {
                grid.innerHTML = `
                    <div class="loading">
                        <div style="color: var(--error);">
                            <i class="fas fa-exclamation-triangle"></i>
                            Failed to load ${sectionName}
                        </div>
                        <div style="font-size: 0.8rem; color: var(--gray); margin: 10px 0;">
                            ${lastError || 'Please check your connection'}
                        </div>
                        <button class="retry-btn btn btn-secondary" data-grid="${gridId}" data-section="${sectionName}">
                            <i class="fas fa-redo"></i>
                            Retry
                        </button>
                    </div>
                `;
                return;
            }
            
            const moviesToDisplay = allMovies.slice(0, limit);
            displayMovies(moviesToDisplay, gridId, false);
        }

        // Retry function for failed content loads
        function retryLoadContent(gridId, sectionName) {
            console.log(`[RETRY] Retrying load for ${sectionName} in ${gridId}`);
            
            if (gridId === 'trendingGrid') loadTrending();
            else if (gridId === 'moviesGrid') loadMovies();
            else if (gridId === 'tvGrid') loadTVSeries();
            else if (gridId === 'newReleasesGrid') loadNewReleases();
            else if (gridId === 'animeGrid') loadAnime();
            else if (gridId === 'nollywoodGrid') loadNollywood();
            else if (gridId === 'kdramaGrid') loadKDrama();
            else if (gridId === 'sadramaGrid') loadSADrama();
            else if (gridId === 'horrorGrid') loadHorror();
            else if (gridId === 'adventureGrid') loadAdventure();
            else if (gridId === 'adultcontentGrid') loadAdultContent();
            else if (gridId === 'shorttvGrid') loadShortTV();
            else if (gridId === 'blackshowsGrid') loadBlackShows();
            else if (gridId === 'upcomingGrid') loadUpcoming();
            else if (gridId === 'searchResultsGrid') {
                const currentQuery = document.getElementById('searchInput').value;
                if (currentQuery) searchContent();
            }
        }

        async function loadTrending() {
    await loadContentWithFallback([
        '/api/trending?page=0&perPage=24',
        '/api/hot',
        '/api/popular',
        '/api/homepage'
    ], 'trendingGrid', 'trending content', 24); 
}
        async function loadMovies() {
    await loadContentWithFallback([
        '/api/search/2025?type=1&perPage=24',
        '/api/search/movie?type=1&perPage=24',
        '/api/homepage',
        '/api/trending?page=0&perPage=24'
    ], 'moviesGrid', 'movies', 24); 
}
        async function loadTVSeries() {
    await loadContentWithFallback([
        '/api/search/2025?type=2&perPage=24',
        '/api/search/series?type=2&perPage=24',
        '/api/homepage',
        '/api/trending?page=0&perPage=24'
    ], 'tvGrid', 'TV series', 24); 
}
        async function loadNewReleases() {
    await loadContentWithFallback([
        '/api/search/2025?perPage=24',
        '/api/search/2026?perPage=24',
        '/api/hot?perPage=24'
    ], 'newReleasesGrid', 'new releases', 24, true); 
}
        async function loadAnime() {
    await loadContentWithFallback([
        '/api/search/anime?perPage=24',
        '/api/search/animated?perPage=24',
        '/api/search/anime%20english%20dubbed?perPage=24',
        '/api/trending?page=0&perPage=24'
    ], 'animeGrid', 'anime', 24); 
}
        async function loadNollywood() {
    // We are using a dedicated Nollywood search strategy to ensure real results
    await loadContentWithFallback([
        '/api/search/nollywood?perPage=60',
        '/api/search/nigeria?perPage=60',
        '/api/search/nigerian?perPage=60'
    ], 'nollywoodGrid', 'nollywood', 24); 
}
        async function loadKDrama() {
    await loadContentWithFallback([
        '/api/search/k-drama?perPage=24',
        '/api/search/kdrama?perPage=24'
    ], 'kdramaGrid', 'k-drama', 24); 
}
        async function loadSADrama() {
    await loadContentWithFallback([
        '/api/search/sa%20drama?perPage=24',
        '/api/search/south%20african%20drama?perPage=24'
    ], 'sadramaGrid', 'sa drama', 24); 
}
        async function loadHorror() {
    await loadContentWithFallback([
        '/api/search/horror?perPage=24'
    ], 'horrorGrid', 'horror movies', 24); 
}
        async function loadAdventure() {
    await loadContentWithFallback([
        '/api/search/adventure?perPage=24'
    ], 'adventureGrid', 'adventure movies', 24); 
}
        async function loadAdultContent() {
    await loadContentWithFallback([
        '/api/search/18+?perPage=24',
        '/api/search/erotic?perPage=24'
    ], 'adultcontentGrid', 'adult content', 24); 
}
        async function loadShortTV() {
    await loadContentWithFallback([
        '/api/search/short%20tv?perPage=24',
        '/api/search/short%20series?perPage=24'
    ], 'shorttvGrid', 'short tv', 24); 
}
        async function loadBlackShows() {
    await loadContentWithFallback([
        '/api/search/black%20shows?perPage=24',
        '/api/search/african%20shows?perPage=24'
    ], 'blackshowsGrid', 'black shows', 24); 
}
        async function loadUpcoming() {
    await loadContentWithFallback([
        '/api/search/action?perPage=24',
        '/api/search/sci-fi?perPage=24'
    ], 'upcomingGrid', 'upcoming', 24); 
}

        // Load all content for search page
        async function loadAllContentForType(type, gridId) {
            const grid = document.getElementById(gridId);
            grid.innerHTML = '<div class="skeleton-card"><div class="skeleton-poster"></div><div class="skeleton-info"><div class="skeleton-title"></div><div class="skeleton-meta"></div></div></div><div class="skeleton-card"><div class="skeleton-poster"></div><div class="skeleton-info"><div class="skeleton-title"></div><div class="skeleton-meta"></div></div></div><div class="skeleton-card"><div class="skeleton-poster"></div><div class="skeleton-info"><div class="skeleton-title"></div><div class="skeleton-meta"></div></div></div><div class="skeleton-card"><div class="skeleton-poster"></div><div class="skeleton-info"><div class="skeleton-title"></div><div class="skeleton-meta"></div></div></div><div class="skeleton-card"><div class="skeleton-poster"></div><div class="skeleton-info"><div class="skeleton-title"></div><div class="skeleton-meta"></div></div></div><div class="skeleton-card"><div class="skeleton-poster"></div><div class="skeleton-info"><div class="skeleton-title"></div><div class="skeleton-meta"></div></div></div>';
            
            let endpoints = [];
            switch(type) {
                case 'trending':
                    endpoints = ['/api/trending?page=0&perPage=60', '/api/trending?page=1&perPage=60', '/api/hot?perPage=60'];
                    break;
                case 'movies':
                    endpoints = ['/api/search/movie?type=1&perPage=60', '/api/search/2025?type=1&perPage=40'];
                    break;
                case 'tv':
                    endpoints = ['/api/search/series?type=2&perPage=60', '/api/search/2025?type=2&perPage=40'];
                    break;
                case 'new':
                    endpoints = ['/api/search/2025?perPage=60', '/api/search/2026?perPage=60'];
                    break;
                case 'anime':
                    endpoints = ['/api/search/anime?perPage=60', '/api/search/animated?perPage=60'];
                    break;
                case 'nollywood':
                    endpoints = ['/api/search/nollywood?perPage=60', '/api/search/nigeria?perPage=60', '/api/search/nigerian?perPage=60'];
                    break;
                case 'kdrama':
                    endpoints = ['/api/search/k-drama?perPage=60', '/api/search/kdrama?perPage=60'];
                    break;
                case 'sadrama':
                    endpoints = ['/api/search/sa%20drama?perPage=60', '/api/search/south%20african%20drama?perPage=60'];
                    break;
                case 'horror':
                    endpoints = ['/api/search/horror?perPage=60'];
                    break;
                case 'adventure':
                    endpoints = ['/api/search/adventure?perPage=60'];
                    break;
                case 'adultcontent':
                    endpoints = ['/api/search/18+?perPage=60', '/api/search/erotic?perPage=60'];
                    break;
                case 'shorttv':
                    endpoints = ['/api/search/short%20tv?perPage=60', '/api/search/short%20series?perPage=60'];
                    break;
                case 'blackshows':
                    endpoints = ['/api/search/black%20shows?perPage=60', '/api/search/african%20shows?perPage=60'];
                    break;
                case 'upcoming':
                    endpoints = ['/api/search/action?perPage=60', '/api/search/sci-fi?perPage=60'];
                    break;
                default:
                    endpoints = ['/api/homepage'];
            }
            
            try {
                let allMovies = [];
                
                for (const endpoint of endpoints) {
                    if (allMovies.length > 0) break;
                    try {
                        const response = await fetchAPI(endpoint);
                        allMovies = extractMoviesFromResponse(response);
                        if (allMovies.length > 0) {
                            console.log(`[SUCCESS] Loaded ${allMovies.length} movies from ${endpoint} for ${type}`);
                            break;
                        }
                    } catch (e) {
                        console.log(`[RETRY] Endpoint failed, trying next: ${endpoint}`);
                    }
                }
                
                if (allMovies.length === 0) {
                    grid.innerHTML = `
                        <div class="loading">
                            <div>No content available</div>
                            <button class="retry-btn btn btn-secondary" data-grid="${gridId}" data-section="${type}">
                                <i class="fas fa-redo"></i>
                                Retry
                            </button>
                        </div>
                    `;
                    return;
                }
                
                displayMovies(allMovies.slice(0, 60), gridId);
            } catch (error) {
                grid.innerHTML = `
                    <div class="loading">
                        <div style="color: var(--error);">Error loading content</div>
                        <button class="retry-btn btn btn-secondary" data-grid="${gridId}" data-section="${type}">
                            <i class="fas fa-redo"></i>
                            Retry
                        </button>
                    </div>
                `;
            }
        }

function displayMovies(movies, gridId, append = false) {
    const grid = document.getElementById(gridId);
    if (!grid) {
        console.error('[ERROR] Grid element not found:', gridId);
        return;
    }

    if (!movies || movies.length === 0) {
        if (!append) {
            grid.innerHTML = '<div class="loading">No content available</div>';
        }
        return;
    }

    // ENFORCE consistent grid layout with multiple force methods
    grid.style.display = 'grid !important';
    grid.style.gridAutoFlow = 'row';
    grid.style.gridAutoRows = 'auto';
    
    // Check if this is homepage or view all page
    const isHomePage = ['trendingGrid', 'moviesGrid', 'tvGrid', 'newReleasesGrid'].includes(gridId);
    
    const moviesHTML = movies.map((movie, index) => {
        const movieId = movie.id || movie.subjectId || '';
        const title = movie.title || movie.name || 'Unknown Title';
        const year = movie.year || '';
        const rating = movie.rating || '7.5';
        const thumbnail = movie.thumbnail || movie.cover?.url || movie.stills?.url || movie.poster || 'https://via.placeholder.com/300x450/333/666?text=Loading...';
        const subjectType = movie.subjectType || 1;
        const urlType = subjectType === 2 ? 'tv' : 'movie';
        const safeTitle = title.replace(/'/g, "\\'");
        
        // Use same card design for both homepage and view all - click to open modal
        const isAboveFold = index < 8;
        return `
        <div class="movie-card homepage-card" onclick="location.href='/${urlType}/${movieId}'" style="cursor: pointer;">
            <div style="position: relative;">
                <img src="${thumbnail}" 
                     alt="${safeTitle}" 
                     class="movie-poster"
                     loading="${isAboveFold ? 'eager' : 'lazy'}"
                     ${isAboveFold ? 'fetchpriority="high"' : 'decoding="async"'}
                     onerror="this.src='https://via.placeholder.com/300x450/333/666?text=Image+Not+Found'">
                <div class="trailer-overlay">
                    <div class="trailer-play-btn">
                        <i class="fas fa-play"></i>
                    </div>
                </div>
            </div>
            <div class="movie-info">
                <h3 class="movie-title">${safeTitle}</h3>
                <div class="movie-meta">
                    <span>${year}</span>
                    <span><i class="fas fa-star" style="color: #FFD700; font-size: 0.75rem;"></i> ${rating}</span>
                </div>
            </div>
        </div>
        `;
    }).join('');
    
    if (append) {
        grid.innerHTML += moviesHTML;
    } else {
        grid.innerHTML = moviesHTML;
    }


    // FORCE: Aggressive reflow with dense flow to eliminate empty spaces
    grid.style.cssText = 'display: grid !important; grid-auto-flow: dense !important; align-content: start !important;';
    
    // Multiple force cycles to ensure layout sticks
    setTimeout(() => {
        grid.style.display = 'grid';
        grid.style.gridAutoFlow = 'dense';
        grid.style.alignContent = 'start';
    }, 50);
    
    setTimeout(() => {
        grid.style.display = 'grid';
        grid.style.gridAutoFlow = 'dense';
    }, 150);
}


// Load More functionality
let currentPage = {
    trending: 0,
    movies: 0,
    tv: 0,
    new: 0
};

async function loadMoreContent(section) {
    const gridId = section + 'Grid';
    const grid = document.getElementById(gridId);
    const loadMoreBtn = document.getElementById(section + 'LoadMore');
    
    if (loadMoreBtn) {
        loadMoreBtn.innerHTML = '<div class="spinner" style="width: 20px; height: 20px;"></div> Loading...';
        loadMoreBtn.disabled = true;
    }
    
    currentPage[section]++;
    
    try {
        let endpoint;
        switch(section) {
            case 'trending':
                endpoint = `/api/trending?page=${currentPage[section]}&perPage=12`;
                break;
            case 'movies':
                endpoint = `/api/search/movie?type=1&page=${currentPage[section]}&perPage=12`;
                break;
            case 'tv':
                endpoint = `/api/search/series?type=2&page=${currentPage[section]}&perPage=12`;
                break;
            case 'new':
                endpoint = `/api/hot?page=${currentPage[section]}&perPage=12`;
                break;
            case 'nollywood':
                const terms = ['nollywood', 'nigeria', 'nigerian'];
                const term = terms[currentPage[section] % terms.length];
                endpoint = `/api/search/${term}?page=${currentPage[section]}&perPage=12`;
                break;
            default:
                endpoint = `/api/trending?page=${currentPage[section]}&perPage=12`;
        }
        
        const response = await fetchAPI(endpoint);
        let newMovies = extractMoviesFromResponse(response);
        
        // Filter Nollywood more strictly
        if (section === 'nollywood') {
            newMovies = newMovies.filter(movie => {
                const title = (movie.title || '').toLowerCase();
                const desc = (movie.description || movie.introduction || '').toLowerCase();
                const country = (movie.countryName || '').toLowerCase();
                const genre = (movie.genre || '').toLowerCase();
                return country === 'nigeria' || genre.includes('nollywood') ||
                       title.includes('nigeria') || title.includes('nollywood') || title.includes('nigerian') ||
                       desc.includes('nigeria') || desc.includes('nollywood') || desc.includes('nigerian');
            });
        }
        
        if (newMovies.length > 0) {
            displayMovies(newMovies, gridId, true);
            
            if (loadMoreBtn) {
                loadMoreBtn.innerHTML = '<i class="fas fa-plus"></i> Load More';
                loadMoreBtn.disabled = false;
            }
            
            if (newMovies.length < 12) {
                if (loadMoreBtn) {
                    loadMoreBtn.style.display = 'none';
                }
            }
        } else {
            if (loadMoreBtn) {
                loadMoreBtn.style.display = 'none';
            }
        }
    } catch (error) {
        console.error('Load more error:', error);
        if (loadMoreBtn) {
            loadMoreBtn.innerHTML = '<i class="fas fa-redo"></i> Retry';
            loadMoreBtn.disabled = false;
            loadMoreBtn.onclick = () => loadMoreContent(section);
        }
    }
}

// Setup infinite scroll for View All sections
function setupInfiniteScroll(gridId, type) {
    const grid = document.getElementById(gridId);
    let isLoading = false;
    let page = 1;
    
    // Remove any existing load more button
    const existingLoadMore = document.getElementById(`${type}LoadMoreContainer`);
    if (existingLoadMore) {
        existingLoadMore.remove();
    }
    
    // Infinite scroll detection
    window.addEventListener('scroll', async function() {
        if (isLoading) return;
        
        const gridRect = grid.getBoundingClientRect();
        const gridBottom = gridRect.bottom;
        const windowHeight = window.innerHeight;
        
        // Load more when user is 300px from bottom of grid
        if (gridBottom - windowHeight <= 300) {
            isLoading = true;
            await loadMoreViewAllContent(type, gridId, page);
            page++;
            isLoading = false;
        }
    });
}

// Load more content for View All sections
async function loadMoreViewAllContent(type, gridId, page) {
    console.log(`[LOAD] Loading more content for ${type}, page ${page}`);
    
    try {
        let endpoint;
        switch(type) {
            case 'trending':
                endpoint = `/api/trending?page=${page + 2}&perPage=30`;
                break;
            case 'movies':
                endpoint = `/api/search/movie?type=1&page=${page + 1}&perPage=30`;
                break;
            case 'tv':
                endpoint = `/api/search/series?type=2&page=${page + 1}&perPage=30`;
                break;
            case 'new':
                endpoint = `/api/search/2025?page=${page + 1}&perPage=30`;
                break;
            case 'nollywood':
                const terms = ['nollywood', 'nigeria', 'nigerian'];
                const term = terms[page % terms.length];
                endpoint = `/api/search/${term}?page=${page + 1}&perPage=30`;
                break;
            default:
                endpoint = `/api/trending?page=${page + 2}&perPage=30`;
        }
        
        const response = await fetchAPI(endpoint);
        let newMovies = extractMoviesFromResponse(response);
        
        // Filter Nollywood in View All
        if (type === 'nollywood') {
            newMovies = newMovies.filter(movie => {
                const title = (movie.title || '').toLowerCase();
                const desc = (movie.description || movie.introduction || '').toLowerCase();
                const country = (movie.countryName || '').toLowerCase();
                const genre = (movie.genre || '').toLowerCase();
                return country === 'nigeria' || genre.includes('nollywood') ||
                       title.includes('nigeria') || title.includes('nollywood') || title.includes('nigerian') ||
                       desc.includes('nigeria') || desc.includes('nollywood') || desc.includes('nigerian');
            });
        }
        
        // Filter to only 2025-2026 for "new" releases
        if (type === 'new') {
            newMovies = newMovies.filter(movie => {
                let year = movie.year;
                if (!year && movie.releaseDate) {
                    year = new Date(movie.releaseDate).getFullYear();
                }
                const yearNum = parseInt(year);
                return yearNum === 2025 || yearNum === 2026;
            });
            console.log(`[FILTER] Infinite scroll filtered to ${newMovies.length} movies from 2025-2026`);
        }
        
        if (newMovies.length > 0) {
            displayMovies(newMovies, gridId, true);
            console.log(`[SUCCESS] Added ${newMovies.length} more movies to ${type}`);
        } else {
            console.log(`[DONE] No more content available for ${type}`);
            // You could show a "No more content" message here
        }
    } catch (error) {
        console.error(`[ERROR] Error loading more ${type} content:`, error);
    }
}

function showAllContent(type, title) {
    showSearchPage();
    document.getElementById('searchResultsTitle').textContent = `${title} - All Content (Scroll for more)`;
    loadEnhancedContentForType(type, 'searchResultsGrid');
}

        // Search functionality with improved error handling
        async function searchContent() {
            const query = document.getElementById('searchInput').value.trim();
            if (!query) {
                alert('Please enter a search term');
                return;
            }

            showSearchPage();
            const grid = document.getElementById('searchResultsGrid');
            grid.innerHTML = '<div class="loading"><div class="spinner"></div><div>Searching...</div></div>';
            document.getElementById('searchResultsTitle').textContent = `Search Results for "${query}"`;
            
            try {
                const response = await fetchAPI(`/api/search/${encodeURIComponent(query)}?perPage=24`);
                const allResults = extractMoviesFromResponse(response);
                
                if (allResults.length === 0) {
                    grid.innerHTML = `
                        <div class="loading">
                            <div>No results found for "${query}"</div>
                            <button class="btn btn-secondary" onclick="showHomePage()">
                                <i class="fas fa-arrow-left"></i>
                                Back to Home
                            </button>
                        </div>
                    `;
                    return;
                }
                
                                
                displayMovies(allResults, 'searchResultsGrid');

// Remove any existing load more button in search results
const existingLoadMore = document.getElementById('searchLoadMore');
if (existingLoadMore) {
    existingLoadMore.parentElement.remove();
}
                
                
            } catch (error) {
                console.error('[ERROR] Search error:', error);
                grid.innerHTML = `
                    <div class="loading">
                        <div style="color: var(--error);">Error searching. Please try again.</div>
                        <button class="retry-btn btn btn-secondary" data-grid="searchResultsGrid" data-section="search">
                            <i class="fas fa-redo"></i>
                            Retry Search
                        </button>
                    </div>
                `;
            }
        }

        // Watch movie with professional player and improved error handling
    async function watchMovie(movieId, subjectType = 1) {
    if (!movieId) {
        alert('Invalid movie ID');
        return;
    }

    currentMovieId = movieId;
    currentSubjectType = subjectType;
    
    // For TV series, show episode selection first
    if (subjectType === 2) {
        showEpisodeSelection(movieId);
        return;
    }
    
    // For movies, clear episode list (hide next/prev buttons)
    setEpisodeList([], 0);
    currentSeriesSeasonsData = [];
    
    // For movies, proceed directly
    showLoadingModal();
    
    console.log('[MOVIE] Starting to watch movie ID:', movieId);
    
    try {
        // Load movie info first
        await loadMovieInfo(movieId);
        
        // LOAD REAL SUBTITLES FROM MOVIE INFO
        let availableSubtitles = [];
        try {
            // Get detailed movie info with subtitles
            const movieInfoResponse = await fetchAPI(`/api/info/${movieId}`);
            if (movieInfoResponse && movieInfoResponse.data && movieInfoResponse.data.subject) {
                const movieInfo = movieInfoResponse.data.subject;
                if (movieInfo.availableSubtitles) {
                    availableSubtitles = movieInfo.availableSubtitles;
                } else if (movieInfo.subtitles) {
                    // Fallback: parse subtitles string if availableSubtitles not present
                    availableSubtitles = movieInfo.subtitles.split(',').map(lang => lang.trim()).filter(lang => lang);
                }
                console.log('[TARGET] Available subtitles:', availableSubtitles);
            }
        } catch (subError) {
            console.log('[WARNING] Could not load subtitle info:', subError);
        }
        
        // Populate subtitle selector with real languages
        populateSubtitleOptions(availableSubtitles);
        
        // Fetch sources and dubs in parallel so neither blocks the other
        console.log('[SEARCH] Fetching sources for movie ID:', movieId);
        [currentSources] = await Promise.all([
            getMovieSources(movieId, 0, 0),
            loadDubsForPlayer(movieId)
        ]);
                console.log('[PACK] Available sources:', currentSources);
                
                // Populate subtitle options with REAL caption data from sources
                if (currentSources.captions && currentSources.captions.length > 0) {
                    populateSubtitleOptions();
                    const defaultSub = currentSources.captions.find(c =>
                        c.lan === 'en' || (c.lanName && c.lanName.toLowerCase().includes('english'))
                    ) || currentSources.captions[0];
                    currentSubtitleLanguage = defaultSub.lan;
                    loadSubtitleFile(defaultSub.lan);
                }
                
                // Filter valid streaming sources
                const streamSources = currentSources.sources.filter(source => {
                    const streamUrl = source.directUrl || source.cdnUrl || source.streamUrl || source.proxyUrl;
                    return streamUrl && streamUrl.startsWith('http');
                });

                if (streamSources.length === 0) {
                    const hasAnyDownloads = currentSources.sources && currentSources.sources.length > 0;
                    const noResource = !hasAnyDownloads;
                    document.getElementById('modalError').style.display = 'block';
                    document.getElementById('modalError').innerHTML = noResource
                        ? `<i class="fas fa-film" style="font-size: 1.5rem; margin-bottom: 8px; display: block;"></i>
                           This movie is not yet available for streaming. It may be added later — check back soon.`
                        : `<i class="fas fa-exclamation-triangle"></i>
                           Streaming is unavailable right now. Try downloading instead.`;
                    openModal();
                    return;
                }

                // Populate quality selector
                const qualitySelector = document.getElementById('qualitySelector');
                qualitySelector.innerHTML = '<option value="">Select Quality</option>';
                
                streamSources.forEach((source, index) => {
                    const streamUrl = source.directUrl || source.cdnUrl || source.streamUrl || source.proxyUrl;
                    if (streamUrl) {
                        const option = document.createElement('option');
                        option.value = streamUrl;
                        option.dataset.sourceIndex = String(index);
                        option.textContent = source.label || `Quality ${index + 1}`;
                        qualitySelector.appendChild(option);
                    }
                });

                // Quality change handler
                qualitySelector.onchange = function() {
                    const selected = streamSources[Number(this.selectedOptions[0]?.dataset.sourceIndex)];
                    if (!selected) return;
                    const currentTime = videoPlayer.currentTime;
                    const isPaused = videoPlayer.paused;
                    loadMediaSource(videoPlayer, selected, !isPaused);
                    videoPlayer.onloadedmetadata = function() {
                        videoPlayer.currentTime = currentTime;
                        if (!isPaused) {
                            videoPlayer.play().catch(e => console.log('[WARNING] Play failed after quality change:', e));
                        }
                        videoPlayer.onloadedmetadata = null;
                    };
                };

                // Prefer the signed DASH source; fall back to browser-compatible MP4.
                // DASH is the working path when the VPS/CDN rate-limits MP4 requests.
                const mp4Sources = streamSources.filter(s => !isDashSource(s));
                const selectedSource =
                    streamSources.find(isDashSource) ||
                    mp4Sources.find(s => parseInt(s.quality, 10) === 360 || s.label === '360p') ||
                    mp4Sources[0] ||
                    streamSources[0];
                
                const videoPlayer = document.getElementById('videoPlayer');
                
                // Reset player state
                videoPlayer.pause();
                videoPlayer.currentTime = 0;
                window.currentEpisodeKey = '';
                
                // Set video source
                playbackRecoveryInFlight = false;
                playbackRecoveryAttempts = 0;
                loadMediaSource(videoPlayer, selectedSource, true);
                videoPlayer.preload = 'auto';
                
                // Handle a media error once: refresh an expired direct URL, then try the
                // VPS proxy once. Never let the error event start an endless reload loop.
                const handleVideoError = async function(e) {
                    if (playbackRecoveryInFlight) return;
                    playbackRecoveryInFlight = true;
                    try {
                        console.error('[ERROR] Video error, attempting controlled fallback:', e);
                        const currentSrc = videoPlayer.src || '';
                        const failedSource = videoPlayer._hmPlaybackSource || selectedSource;
                
                        if (isUrlExpired(currentSrc) && currentMovieId && playbackRecoveryAttempts < 1) {
                            playbackRecoveryAttempts++;
                            console.log('[REFRESH] CDN URL expired, fetching one fresh direct source...');
                            const resumeAt = videoPlayer.currentTime;
                            try {
                                const fresh = await getMovieSources(currentMovieId, currentSeason || 0, currentEpisode || 0);
                                if (fresh && fresh.sources && fresh.sources.length > 0) {
                                    const freshSrc = fresh.sources.find(s => s.quality === 360 || s.label === '360p') || fresh.sources[0];
                                    if (freshSrc && (freshSrc.directUrl || freshSrc.cdnUrl || freshSrc.streamUrl || freshSrc.proxyUrl)) {
                                        loadMediaSource(videoPlayer, freshSrc, true);
                                        videoPlayer.onloadedmetadata = function() {
                                            videoPlayer.currentTime = resumeAt;
                                            videoPlayer.play().catch(() => {});
                                            videoPlayer.onloadedmetadata = null;
                                        };
                                        return;
                                    }
                                }
                            } catch (err) {
                                console.error('[REFRESH] Re-fetch failed:', err.message);
                            }
                        }
                
                        const canUseProxy = failedSource && !videoPlayer._hmPlaybackViaProxy &&
                            !isDashSource(failedSource, currentSrc) &&
                            (failedSource.streamUrl || failedSource.proxyUrl) &&
                            playbackRecoveryAttempts < 2;
                        if (canUseProxy) {
                            playbackRecoveryAttempts++;
                            console.warn('[PLAYBACK] Direct CDN load failed; trying VPS proxy once');
                            loadMediaSource(videoPlayer, failedSource, true, { useProxy: true });
                            return;
                        }
                
                        // If DASH fails in this browser, try the next available source
                        // (usually MP4 direct) before reporting a total stream failure.
                        const failedIndex = streamSources.indexOf(failedSource);
                        const nextSource = failedIndex >= 0 ? streamSources[failedIndex + 1] : null;
                        if (nextSource) {
                            playbackRecoveryAttempts = 0;
                            console.warn('[PLAYBACK] Current source failed; trying next direct source');
                            loadMediaSource(videoPlayer, nextSource, true);
                            qualitySelector.value = nextSource.directUrl || nextSource.cdnUrl || nextSource.streamUrl || nextSource.proxyUrl || '';
                            return;
                        }

                        document.getElementById('modalError').style.display = 'block';
                        document.getElementById('modalError').innerHTML = `
                            <i class="fas fa-exclamation-triangle"></i>
                            Error loading video stream. Please try a different quality or download instead.
                        `;
                    } finally {
                        playbackRecoveryInFlight = false;
                    }
                };
                
                videoPlayer.onerror = handleVideoError;
                
                // Final check to hide error and open modal
                document.getElementById('modalError').style.display = 'none';
                openModal();
                // Re-render dub options now that the modal is fully visible
                if (currentDubsData && currentDubsData.hasDubs) renderPlayerDubOptions(currentMovieId);
                
                // Auto-select the quality in UI
                qualitySelector.value = currentVideoUrl;
                currentQuality = selectedSource.label || selectedSource.quality + 'p';
                
                // Try to play as soon as enough data is ready (canplay fires earlier than loadeddata)
                videoPlayer.oncanplay = function() {
                    videoPlayer.oncanplay = null;
                    console.log('[SUCCESS] Video ready, attempting to play...');
                    videoPlayer.play().catch(e => {
                        console.log('[WARNING] Auto-play prevented:', e);
                        const tp = document.getElementById('tapToPlay');
                        if (tp) tp.classList.add('active');
                    });
                };

            } catch (error) {
                console.error('[ERROR] Error in watchMovie:', error);
                document.getElementById('modalError').style.display = 'block';
                document.getElementById('modalError').innerHTML = `
                    <i class="fas fa-exclamation-triangle"></i>
                    Failed to load movie: ${error.message}
                `;
                openModal();
            }
        }

      // Enhanced episode selection with REAL episode data from API
async function showEpisodeSelection(movieId) {
    currentMovieId = movieId;
    
    try {
        // Show loading state
        const episodeContent = document.getElementById('episodeSelectionContent');
        episodeContent.innerHTML = `
            <div class="skeleton-card"><div class="skeleton-poster"></div><div class="skeleton-info"><div class="skeleton-title"></div><div class="skeleton-meta"></div></div></div><div class="skeleton-card"><div class="skeleton-poster"></div><div class="skeleton-info"><div class="skeleton-title"></div><div class="skeleton-meta"></div></div></div><div class="skeleton-card"><div class="skeleton-poster"></div><div class="skeleton-info"><div class="skeleton-title"></div><div class="skeleton-meta"></div></div></div><div class="skeleton-card"><div class="skeleton-poster"></div><div class="skeleton-info"><div class="skeleton-title"></div><div class="skeleton-meta"></div></div></div><div class="skeleton-card"><div class="skeleton-poster"></div><div class="skeleton-info"><div class="skeleton-title"></div><div class="skeleton-meta"></div></div></div><div class="skeleton-card"><div class="skeleton-poster"></div><div class="skeleton-info"><div class="skeleton-title"></div><div class="skeleton-meta"></div></div></div>
        `;
        
        document.getElementById('episodeSelectionModal').style.display = 'flex';
        
        // Load movie info to get the title and REAL episode data
        const movieInfoResponse = await fetchAPI(`/api/info/${movieId}`);
        let movieTitle = 'TV Series';
        let seasonsData = [];
        
        if (movieInfoResponse && movieInfoResponse.data) {
            const movieInfo = movieInfoResponse.data.subject || movieInfoResponse.data;
            movieTitle = movieInfo.title || movieInfo.name || 'TV Series';
            
            // Extract REAL episode data from the API response
            seasonsData = extractSeasonsData(movieInfoResponse.data);
        }
        
        document.getElementById('episodeModalTitle').textContent = `Select Episode - ${movieTitle}`;
        
        // Generate episode selection based on REAL data
        if (seasonsData.length === 0) {
            episodeContent.innerHTML = `
                <div class="loading">
                    <div style="color: var(--error);">
                        <i class="fas fa-exclamation-triangle"></i>
                        No episode data available
                    </div>
                    <button class="btn btn-secondary" onclick="closeEpisodeSelection()">
                        <i class="fas fa-times"></i>
                        Close
                    </button>
                </div>
            `;
        } else {
            updateEpisodeSelection(seasonsData);
        }
        
    } catch (error) {
        console.error('[ERROR] Error loading episode selection:', error);
        // Fallback to basic episode selection
        showBasicEpisodeSelection();
    }
}

// Global variable to store current series episode data
let currentSeriesSeasonsData = [];

// Extract REAL seasons and episodes data from API response
function extractSeasonsData(apiData) {
    const seasons = [];
    
    // Check if we have season data in the resource field
    if (apiData.resource && apiData.resource.seasons && Array.isArray(apiData.resource.seasons)) {
        apiData.resource.seasons.forEach(season => {
            if (season.se && season.maxEp) {
                seasons.push({
                    seasonNumber: season.se,
                    totalEpisodes: season.maxEp,
                    resolutions: season.resolutions || []
                });
            }
        });
    }
    
    // Sort seasons by season number
    seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
    
    // Store globally for next/prev navigation
    currentSeriesSeasonsData = seasons;
    
    console.log('[MOVIE] Extracted seasons data:', seasons);
    return seasons;
}

// Update episode selection with REAL data
function updateEpisodeSelection(seasonsData) {
    const episodeContent = document.getElementById('episodeSelectionContent');
    
    let episodesHTML = '';
    
    seasonsData.forEach(season => {
        const episodeButtons = [];
        
        // Create episode buttons based on REAL episode count
        for (let episode = 1; episode <= season.totalEpisodes; episode++) {
            // Check if this episode is available in any resolution
            const isAvailable = isEpisodeAvailable(season, episode);
            const buttonClass = isAvailable ? 'episode-btn' : 'episode-btn disabled';
            const onClick = isAvailable ? `onclick="selectEpisode(${season.seasonNumber}, ${episode})"` : '';
            
            episodeButtons.push(`
                <button class="${buttonClass}" ${onClick} 
                        title="${isAvailable ? `Episode ${episode}` : 'Episode not available'}">
                    E${episode}
                    ${!isAvailable ? '<br><small>N/A</small>' : ''}
                </button>
            `);
        }
        
        episodesHTML += `
            <div class="season-section">
                <h4 class="season-title">
                    Season ${season.seasonNumber}
                    <small style="font-size: 0.8rem; color: var(--gray); margin-left: 10px;">
                        ${season.totalEpisodes} episodes
                    </small>
                </h4>
                <div class="episodes-grid">
                    ${episodeButtons.join('')}
                </div>
                ${getResolutionInfo(season)}
            </div>
        `;
    });
    
    episodeContent.innerHTML = episodesHTML;
}

// Check if a specific episode is available in any resolution
function isEpisodeAvailable(season, episode) {
    if (!season.resolutions || season.resolutions.length === 0) {
        return true; // Assume available if no resolution data
    }
    
    // Check if episode number is less than or equal to the available episodes in any resolution
    return season.resolutions.some(res => episode <= res.epNum);
}

// Get resolution availability information
function getResolutionInfo(season) {
    if (!season.resolutions || season.resolutions.length === 0) {
        return '';
    }
    
    const resolutionText = season.resolutions.map(res => 
        `${res.resolution}p (${res.epNum} eps)`
    ).join(', ');
    
    return `
        <div style="font-size: 0.8rem; color: var(--gray); margin-top: 8px;">
            <i class="fas fa-info-circle"></i>
            Available in: ${resolutionText}
        </div>
    `;
}

// Fallback to basic episode selection if API fails
function showBasicEpisodeSelection() {
    const episodeContent = document.getElementById('episodeSelectionContent');
    episodeContent.innerHTML = `
        <div class="loading">
            <div style="color: var(--warning); margin-bottom: 15px;">
                <i class="fas fa-exclamation-triangle"></i>
                Using basic episode selection
            </div>
        </div>
        <div class="season-section">
            <h4 class="season-title">Season 1</h4>
            <div class="episodes-grid">
                ${Array.from({length: 10}, (_, i) => `
                    <button class="episode-btn" onclick="selectEpisode(1, ${i + 1})">
                        E${i + 1}
                    </button>
                `).join('')}
            </div>
        </div>
        <div style="text-align: center; margin-top: 20px;">
            <button class="btn btn-secondary" onclick="closeEpisodeSelection()">
                <i class="fas fa-times"></i>
                Cancel
            </button>
        </div>
    `;
}

// Enhanced selectEpisode function with better logging
async function selectEpisode(season, episode) {
    currentSeason = season;
    currentEpisode = episode;

    // If triggered from external button, open in new tab instead of player
    if (episodeSelectMode === 'external') {
        episodeSelectMode = 'watch';
        closeEpisodeSelection();
        openWithExternalPlayer(season, episode);
        return;
    }
    
    console.log(`[MOVIE] Selected Season ${season}, Episode ${episode}`);
    
    // Build episode list for next/prev navigation
    buildEpisodeListForNavigation(season, episode);
    
    closeEpisodeSelection();
    showLoadingModal();
    
    try {
        // Load movie info first (for subtitles and metadata)
        await loadMovieInfo(currentMovieId);
        
        // Then get sources with season and episode parameters
        console.log('[SEARCH] Fetching sources for TV series:', currentMovieId, 'Season:', season, 'Episode:', episode);
        [currentSources] = await Promise.all([
            getMovieSources(currentMovieId, season, episode),
            loadDubsForPlayer(currentMovieId)
        ]);
        
        // Populate subtitle options with REAL data
populateSubtitleOptions();

// If there are subtitles available, default to English or first available
if (currentSources.captions && currentSources.captions.length > 0) {
    const defaultSub = currentSources.captions.find(c =>
        c.lan === 'en' || (c.lanName && c.lanName.toLowerCase().includes('english'))
    ) || currentSources.captions[0];
    currentSubtitleLanguage = defaultSub.lan;
    await loadSubtitleFile(defaultSub.lan);
}
        console.log('[PACK] Available sources:', currentSources);
        
        // Filter valid streaming sources
        const streamSources = currentSources.sources.filter(source => {
            const streamUrl = source.directUrl || source.cdnUrl || source.streamUrl || source.proxyUrl;
            return streamUrl && streamUrl.startsWith('http');
        });

        if (streamSources.length === 0) {
            const hasAnyDownloads = currentSources.sources && currentSources.sources.length > 0;
            const noResource = !hasAnyDownloads;
            document.getElementById('modalError').style.display = 'block';
            document.getElementById('modalError').innerHTML = noResource
                ? `<i class="fas fa-film" style="font-size: 1.5rem; margin-bottom: 8px; display: block;"></i>
                   Season ${season} Episode ${episode} is not yet available. It may be added later — check back soon.`
                : `<i class="fas fa-exclamation-triangle"></i>
                   Streaming for S${season}E${episode} is unavailable right now. Try downloading instead.`;
            openModal();
            return;
        }

        // Update modal title to show episode info
        const originalTitle = document.getElementById('modalTitle').textContent;
        document.getElementById('modalTitle').textContent = `${originalTitle} - S${season}E${episode}`;

        // Populate quality selector
        const qualitySelector = document.getElementById('qualitySelector');
        qualitySelector.innerHTML = '<option value="">Select Quality</option>';
        
        streamSources.forEach((source, index) => {
            const streamUrl = source.directUrl || source.cdnUrl || source.streamUrl || source.proxyUrl;
            if (streamUrl) {
                const option = document.createElement('option');
                option.value = streamUrl;
                option.dataset.sourceIndex = String(index);
                option.textContent = source.label || `Quality ${index + 1}`;
                qualitySelector.appendChild(option);
            }
        });

        // Quality change handler
        qualitySelector.onchange = function() {
            const selected = streamSources[Number(this.selectedOptions[0]?.dataset.sourceIndex)];
            if (!selected) return;
            const currentTime = videoPlayer.currentTime;
            const isPaused = videoPlayer.paused;
            loadMediaSource(videoPlayer, selected, !isPaused);
            videoPlayer.onloadedmetadata = function() {
                videoPlayer.currentTime = currentTime;
                if (!isPaused) {
                    videoPlayer.play().catch(e => console.log('[WARNING] Play failed after quality change:', e));
                }
                videoPlayer.onloadedmetadata = null;
            };
        };

        // Prefer the signed DASH source; fall back to browser-compatible MP4.
        // DASH is the working path when the VPS/CDN rate-limits MP4 requests.
        const mp4Sources = streamSources.filter(s => !isDashSource(s));
        const selectedSource =
            streamSources.find(isDashSource) ||
            mp4Sources.find(s => parseInt(s.quality, 10) === 360 || s.label === '360p') ||
            mp4Sources[0] ||
            streamSources[0];
        
        const videoPlayer = document.getElementById('videoPlayer');
        
        // Reset player state
        videoPlayer.pause();
        videoPlayer.currentTime = 0;
        window.currentEpisodeKey = `s${season}e${episode}`;
        
        // Set video source
        loadMediaSource(videoPlayer, selectedSource, true);
        videoPlayer.preload = 'auto';
        
        // Handle a media error once: refresh an expired direct URL, then try the
        // VPS proxy once. Never let the error event start an endless reload loop.
        const handleVideoError = async function(e) {
            if (playbackRecoveryInFlight) return;
            playbackRecoveryInFlight = true;
            try {
                console.error('[ERROR] Video error, attempting controlled fallback:', e);
                const currentSrc = videoPlayer.src || '';
                const failedSource = videoPlayer._hmPlaybackSource || selectedSource;
        
                if (isUrlExpired(currentSrc) && currentMovieId && playbackRecoveryAttempts < 1) {
                    playbackRecoveryAttempts++;
                    console.log('[REFRESH] CDN URL expired, fetching one fresh direct source...');
                    const resumeAt = videoPlayer.currentTime;
                    try {
                        const fresh = await getMovieSources(currentMovieId, currentSeason || 0, currentEpisode || 0);
                        if (fresh && fresh.sources && fresh.sources.length > 0) {
                            const freshSrc = fresh.sources.find(s => s.quality === 360 || s.label === '360p') || fresh.sources[0];
                            if (freshSrc && (freshSrc.directUrl || freshSrc.cdnUrl || freshSrc.streamUrl || freshSrc.proxyUrl)) {
                                loadMediaSource(videoPlayer, freshSrc, true);
                                videoPlayer.onloadedmetadata = function() {
                                    videoPlayer.currentTime = resumeAt;
                                    videoPlayer.play().catch(() => {});
                                    videoPlayer.onloadedmetadata = null;
                                };
                                return;
                            }
                        }
                    } catch (err) {
                        console.error('[REFRESH] Re-fetch failed:', err.message);
                    }
                }
        
                const canUseProxy = failedSource && !videoPlayer._hmPlaybackViaProxy &&
                    !isDashSource(failedSource, currentSrc) &&
                    (failedSource.streamUrl || failedSource.proxyUrl) &&
                    playbackRecoveryAttempts < 2;
                if (canUseProxy) {
                    playbackRecoveryAttempts++;
                    console.warn('[PLAYBACK] Direct CDN load failed; trying VPS proxy once');
                    loadMediaSource(videoPlayer, failedSource, true, { useProxy: true });
                    return;
                }
        
                // If DASH fails in this browser, try the next available source
                // (usually MP4 direct) before reporting a total stream failure.
                const failedIndex = streamSources.indexOf(failedSource);
                const nextSource = failedIndex >= 0 ? streamSources[failedIndex + 1] : null;
                if (nextSource) {
                    playbackRecoveryAttempts = 0;
                    console.warn('[PLAYBACK] Current source failed; trying next direct source');
                    loadMediaSource(videoPlayer, nextSource, true);
                    qualitySelector.value = nextSource.directUrl || nextSource.cdnUrl || nextSource.streamUrl || nextSource.proxyUrl || '';
                    return;
                }

                document.getElementById('modalError').style.display = 'block';
                document.getElementById('modalError').innerHTML = `
                    <i class="fas fa-exclamation-triangle"></i>
                    Error loading video stream. Please try a different quality or download instead.
                `;
            } finally {
                playbackRecoveryInFlight = false;
            }
        };
        
        videoPlayer.onerror = handleVideoError;
        
        // Final check to hide error and open modal
        document.getElementById('modalError').style.display = 'none';
        openModal();
        // Re-render dub options now that modal is visible
        if (currentDubsData && currentDubsData.hasDubs) renderPlayerDubOptions(currentMovieId);
        
        // Auto-select the quality in UI
        qualitySelector.value = currentVideoUrl;
        currentQuality = selectedSource.label || selectedSource.quality + 'p';
        
        // Try to play as soon as enough data is ready (canplay fires earlier than loadeddata)
        videoPlayer.oncanplay = function() {
            videoPlayer.oncanplay = null;
            console.log('[SUCCESS] Video ready, attempting to play...');
            videoPlayer.play().catch(e => {
                console.log('[WARNING] Auto-play prevented:', e);
                const tp = document.getElementById('tapToPlay');
                if (tp) tp.classList.add('active');
            });
        };

    } catch (error) {
        console.error('[ERROR] Error playing episode:', error);
        document.getElementById('modalError').style.display = 'block';
        document.getElementById('modalError').innerHTML = `
            <i class="fas fa-exclamation-triangle"></i>
            Failed to load episode: ${error.message}
        `;
        openModal();
    }
}

// Close episode selection modal
function closeEpisodeSelection() {
    document.getElementById('episodeSelectionModal').style.display = 'none';
}

// Build episode list for next/prev button navigation
function buildEpisodeListForNavigation(currentSeasonNum, currentEpisodeNum) {
    if (!currentSeriesSeasonsData || currentSeriesSeasonsData.length === 0) {
        setEpisodeList([], 0);
        return;
    }
    
    // Find the current season
    const currentSeasonData = currentSeriesSeasonsData.find(s => s.seasonNumber === currentSeasonNum);
    if (!currentSeasonData) {
        setEpisodeList([], 0);
        return;
    }
    
    // Build episode list for current season
    const episodes = [];
    for (let ep = 1; ep <= currentSeasonData.totalEpisodes; ep++) {
        episodes.push({
            season: currentSeasonNum,
            episode: ep,
            onClick: function() {
                selectEpisode(currentSeasonNum, ep);
            }
        });
    }
    
    // Find current episode index (0-based)
    const currentIndex = currentEpisodeNum - 1;
    
    console.log(`[NAV] Episode list built: ${episodes.length} episodes, current index: ${currentIndex}`);
    setEpisodeList(episodes, currentIndex);
}
    

        // Format file size to human readable format
        function formatFileSize(bytes) {
            if (!bytes) return 'Unknown size';
            
            const sizes = ['Bytes', 'KB', 'MB', 'GB'];
            if (bytes === 0) return '0 Bytes';
            
            const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
            return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
        }

       // ENHANCED DOWNLOAD FUNCTION - WITH LOADING OVERLAY
async function downloadMovie(movieId, subjectType = 1) {
    console.log('[START] DOWNLOAD CLICKED - Movie ID:', movieId);
    
    if (!movieId) {
        showQuickMessage('[ERROR] Invalid movie ID', 'error');
        return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'downloadLoadingOverlay';
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.9); z-index: 5000;
        display: flex; flex-direction: column; justify-content: center; align-items: center;
        gap: 16px; backdrop-filter: blur(8px);
    `;
    overlay.innerHTML = `
        <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(229,9,20,0.1); display: flex; align-items: center; justify-content: center;">
            <div style="width: 36px; height: 36px; border: 3px solid rgba(255,255,255,0.1); border-top-color: #e50914; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
        </div>
        <div style="color: white; font-size: 1rem; font-weight: 600; letter-spacing: 0.3px;" id="downloadStatusText">Fetching sources...</div>
        <div style="color: rgba(255,255,255,0.4); font-size: 0.8rem;">Please wait</div>
        <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
    `;
    document.body.appendChild(overlay);

    function removeOverlay() {
        const el = document.getElementById('downloadLoadingOverlay');
        if (el) el.remove();
    }

    try {
        const statusText = document.getElementById('downloadStatusText');

        let movieTitle = 'movie';
        let moviePoster = '';
        try {
            if (statusText) statusText.textContent = 'Getting movie info...';
            const infoResponse = await fetchAPI(`/api/info/${movieId}`);
            const movieInfo = infoResponse.data?.subject || infoResponse.data;
            movieTitle = movieInfo?.title || movieInfo?.name || 'movie';
            moviePoster = movieInfo?.cover?.url || movieInfo?.stills?.url || movieInfo?.poster || '';
        } catch (infoError) {
            console.log('[WARNING] Could not fetch movie info:', infoError);
        }

        if (statusText) statusText.textContent = `Finding sources for "${movieTitle}"...`;

        let sourcesData;
        if (subjectType === 2) {
            sourcesData = await getMovieSources(movieId, 1, 1);
        } else {
            sourcesData = await getMovieSources(movieId, 0, 0);
        }
        
        const sources = sourcesData?.sources || sourcesData || [];
        console.log('[PACK] Sources found:', sources);
        
        if (!sources || !Array.isArray(sources) || sources.length === 0) {
            removeOverlay();
            showQuickMessage('No download sources available', 'error');
            return;
        }

        const validSources = sources.filter(source => 
            source.directUrl || source.url || source.downloadUrl || source.streamUrl
        );

        if (validSources.length === 0) {
            removeOverlay();
            showQuickMessage('No valid download links', 'error');
            return;
        }

        removeOverlay();

        if (validSources.length === 1) {
            const source = validSources[0];
            await triggerDownload(source, movieTitle);
            showQuickMessage('Download started!', 'success');
        } else {
            showQualitySelection(validSources, movieTitle, moviePoster);
        }
        
    } catch (error) {
        console.error('[ERROR] Download error:', error);
        removeOverlay();
        showQuickMessage('Download failed', 'error');
    }
}

function showQualitySelection(sources, movieTitle, moviePoster) {
    const modal = document.createElement('div');
    modal.className = 'dl-modal-overlay';
    
    const safeTitle = movieTitle.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
    
    const qualityLabels = { '360': 'SD', '480': 'SD', '720': 'HD', '1080': 'Full HD', '2160': '4K' };
    
    const posterBg = moviePoster ? `background-image: url('${moviePoster}');` : '';
    
    modal.innerHTML = `
        <div class="dl-modal">
            <button class="dl-modal-close" onclick="this.closest('.dl-modal-overlay').remove()"><i class="fas fa-times"></i></button>
            ${moviePoster ? `<div class="dl-modal-poster" style="${posterBg}"><div class="dl-modal-poster-overlay"></div></div>` : ''}
            <div class="dl-modal-header ${moviePoster ? 'dl-modal-header-with-poster' : ''}">
                <div class="dl-modal-icon"><i class="fas fa-download"></i></div>
                <h3 class="dl-modal-title">Download</h3>
                <p class="dl-modal-subtitle">${movieTitle}</p>
            </div>
            <div class="dl-modal-options">
                ${sources.map((source, index) => {
                    const quality = source.quality || 'Unknown';
                    const size = source.size ? formatFileSize(source.size) : '';
                    const format = source.format ? source.format.toUpperCase() : 'MP4';
                    const label = qualityLabels[quality] || '';
                    const dlUrl = source.downloadUrl || source.directUrl || source.url;
                    return `
                        <div class="dl-quality-card" onclick="selectQualityAndDownload(this, '${dlUrl}', '${quality}', '${safeTitle}')">
                            <div class="dl-quality-left">
                                <div class="dl-quality-res">
                                    <span class="dl-quality-number">${quality}p</span>
                                    ${label ? '<span class="dl-quality-label">' + label + '</span>' : ''}
                                </div>
                                <div class="dl-quality-meta">
                                    ${size ? '<span><i class="fas fa-hdd"></i> ' + size + '</span>' : ''}
                                    <span><i class="fas fa-file-video"></i> ${format}</span>
                                </div>
                            </div>
                            <div class="dl-quality-action">
                                <i class="fas fa-arrow-down"></i>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
            <button class="dl-modal-cancel" onclick="this.closest('.dl-modal-overlay').remove()">Cancel</button>
        </div>
    `;

    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('dl-modal-visible'));

    modal.addEventListener('click', function(event) {
        if (event.target === modal) modal.remove();
    });
}

// TRIGGER DOWNLOAD WITH SELECTED QUALITY
async function selectQualityAndDownload(element, sourceUrl, quality, movieTitle) {
    try {
        element.classList.add('dl-quality-loading');
        element.innerHTML = `
            <div style="display: flex; justify-content: center; align-items: center; gap: 10px; width: 100%;">
                <div style="width: 18px; height: 18px; border: 2px solid rgba(255,255,255,0.1); border-top-color: #e50914; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
                <span style="font-size: 0.85rem; color: rgba(255,255,255,0.7); font-weight: 500;">Preparing download...</span>
            </div>
        `;
        element.style.pointerEvents = 'none';

        const safeQuality = quality.replace(/[^a-zA-Z0-9]/g, '');
        const filename = `${movieTitle}_${safeQuality}.mp4`;
        
        console.log('[TARGET] Downloading:', filename, 'Quality:', quality);
        
        let downloadUrl;
        if (sourceUrl.includes('/api/download')) {
            downloadUrl = sourceUrl + `&filename=${encodeURIComponent(filename)}`;
        } else {
            downloadUrl = `/api/download?url=${encodeURIComponent(sourceUrl)}&filename=${encodeURIComponent(filename)}`;
        }
        
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showQuickMessage('Download started!', 'success');
        
        setTimeout(() => {
            const modal = document.querySelector('.modal[style*="z-index: 3000"]');
            if (modal) modal.remove();
        }, 500);
        
    } catch (error) {
        console.error('[ERROR] Download error:', error);
        showQuickMessage('Download failed', 'error');
    }
}

// SIMPLE DOWNLOAD TRIGGER (for single source)
async function triggerDownload(source, movieTitle) {
    const safeTitle = movieTitle.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
    const quality = source.quality || 'HD';
    const safeQuality = quality.replace(/[^a-zA-Z0-9]/g, '');
    const filename = `${safeTitle}_${safeQuality}.mp4`;
    
    let downloadUrl;
    if (source.downloadUrl) {
        downloadUrl = source.downloadUrl + `&filename=${encodeURIComponent(filename)}`;
    } else {
        downloadUrl = `/api/download?url=${encodeURIComponent(source.directUrl || source.url)}&filename=${encodeURIComponent(filename)}`;
    }
    
    console.log('[TARGET] Direct download:', filename);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// FILE SIZE FORMATTER
function formatFileSize(bytes) {
    if (!bytes) return 'Unknown size';
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

        // Show download options modal
        function showDownloadOptions(sources, movieId) {
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.style.display = 'block';
            modal.style.zIndex = '3000';
            
            const downloadOptions = sources.map((source, index) => {
                const quality = source.quality || 'Unknown';
                const size = source.size ? ` (${formatFileSize(source.size)})` : '';
                const format = source.format || 'mp4';
                const url = source.downloadUrl || source.proxyUrl;
                
                if (!url || !url.startsWith('http')) {
                    console.warn('[ERROR] Invalid download URL:', url);
                    return null;
                }
                
                return {
                    id: source.id || index,
                    quality: quality,
                    size: size,
                    format: format,
                    url: url,
                    directUrl: source.directUrl,
                    label: `${quality} ${format.toUpperCase()}${size}`
                };
            }).filter(option => option && option.url);

            if (downloadOptions.length === 0) {
                alert('No valid download links available. Please try another movie or check back later.');
                return;
            }

            modal.innerHTML = `
                <div class="modal-content" style="max-width: 500px; padding: 20px;">
                    <button class="close-modal" onclick="this.parentElement.parentElement.remove()">&times;</button>
                    <h3 style="margin-bottom: 20px; color: var(--light);">Choose Download Quality</h3>
                    <div class="download-options" style="max-height: 400px; overflow-y: auto;">
                        ${downloadOptions.map(option => `
                            <div class="download-option" 
                                 onclick="startDownload('${option.url.replace(/'/g, "\\'")}', '${option.quality}', '${option.format}')">
                                    <div style="display: flex; justify-content: space-between; align-items: center;">
                                        <div>
                                            <strong style="color: var(--light);">${option.label}</strong>
                                            ${option.directUrl ? `<div style="font-size: 0.8rem; color: var(--gray); margin-top: 5px;">Direct download available</div>` : ''}
                                        </div>
                                        <i class="fas fa-download" style="color: var(--primary);"></i>
                                    </div>
                            </div>
                        `).join('')}
                    </div>
                    <div style="margin-top: 20px; padding: 15px; background: rgba(0, 200, 81, 0.1); border-radius: 8px; border: 1px solid rgba(0, 200, 81, 0.3);">
                        <p style="color: var(--success); margin: 0; font-size: 0.9rem;">
                            <i class="fas fa-info-circle"></i>
                            Click on your preferred quality to start downloading
                        </p>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            modal.addEventListener('click', function(event) {
                if (event.target === modal) {
                    modal.remove();
                }
            });
        }

        // Fixed download function
        function startDownload(downloadUrl, quality, format) {
            console.log('[START] Starting download:', { downloadUrl, quality, format });
            
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = `movie_${quality}_${Date.now()}.${format}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            showDownloadStartedMessage(quality, format);
            
            // Close all download modals
            document.querySelectorAll('.modal').forEach(modal => {
                if (modal.style.zIndex === '3000') {
                    modal.remove();
                }
            });
        }

        // Show download started message
        function showDownloadStartedMessage(quality, format) {
            const message = document.createElement('div');
            message.className = 'download-started-message';
            message.innerHTML = `
                <div style="position: fixed; top: 20px; right: 20px; background: var(--success); color: white; padding: 15px 25px; border-radius: 8px; z-index: 4000; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <i class="fas fa-check-circle"></i>
                        <div>
                            <strong>Download Started</strong>
                            <div style="font-size: 0.8rem; opacity: 0.9;">${quality} ${format.toUpperCase()} quality</div>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.appendChild(message);
            
            setTimeout(() => {
                if (message.parentElement) {
                    message.parentElement.removeChild(message);
                }
            }, 3000);
        }

        // Download current movie from modal
        function downloadCurrentMovie() {
            if (currentMovieId) {
                downloadMovie(currentMovieId, currentSubjectType);
            } else {
                alert('No movie selected for download.');
            }
        }
   
   // External Video Player Functions
async function watchWithExternalPlayer(movieId, subjectType = 1) {
    if (!movieId) {
        showQuickMessage('[ERROR] Invalid movie ID', 'error');
        return;
    }

    currentMovieId = movieId;
    currentSubjectType = subjectType;
    
    if (subjectType === 2) {
        // For TV series, show episode selection first (external mode)
        episodeSelectMode = 'external';
        showEpisodeSelection(movieId);
    } else {
        // For movies, load sources first then open external player
        showQuickMessage('[RETRY] Loading movie sources...', 'info');
        
        try {
            // Get sources for movie (season=0, episode=0)
            const sourcesData = await getMovieSources(movieId, 0, 0);
            
            if (!sourcesData || !sourcesData.sources || sourcesData.sources.length === 0) {
                showQuickMessage('[ERROR] No streaming sources available', 'error');
                return;
            }

            const streamSources = sourcesData.sources.filter(source => {
                const streamUrl = source.directUrl || source.cdnUrl || source.streamUrl || source.proxyUrl;
                return streamUrl && streamUrl.startsWith('http');
            });

            if (streamSources.length === 0) {
                showQuickMessage('[ERROR] No valid streaming sources found', 'error');
                return;
            }

            // Store the sources and open external player
            currentSources = sourcesData;
            openWithExternalPlayer();
            
        } catch (error) {
            console.error('[ERROR] Error loading movie sources:', error);
            showQuickMessage('[ERROR] Failed to load movie sources', 'error');
        }
    }
}

async function openWithExternalPlayer(season = 0, episode = 0) {
    if (!currentMovieId) {
        showQuickMessage('No movie selected', 'error');
        return;
    }

    try {
        showQuickMessage('Opening...', 'info');
        
        let streamSources = [];
        
        if (currentSources && currentSources.sources && currentSources.sources.length > 0) {
            streamSources = currentSources.sources.filter(source => {
                const streamUrl = source.directUrl || source.cdnUrl || source.streamUrl || source.proxyUrl;
                return streamUrl && streamUrl.startsWith('http');
            });
        } else {
            let actualSeason = season;
            let actualEpisode = episode;
            
            if (currentSubjectType === 2) {
                if (season === 0 && episode === 0) {
                    actualSeason = currentSeason || 1;
                    actualEpisode = currentEpisode || 1;
                }
            }
            
            const sourcesData = await getMovieSources(currentMovieId, actualSeason, actualEpisode);
            streamSources = sourcesData.sources.filter(source => {
                const streamUrl = source.directUrl || source.cdnUrl || source.streamUrl || source.proxyUrl;
                return streamUrl && streamUrl.startsWith('http');
            });
        }

        if (streamSources.length === 0) {
            showQuickMessage('No sources available', 'error');
            return;
        }

        const bestSource = streamSources[0];
        const streamUrl = bestSource.directUrl || bestSource.cdnUrl || bestSource.streamUrl || bestSource.proxyUrl;
        
        if (!streamUrl) {
            showQuickMessage('Invalid URL', 'error');
            return;
        }

        // Open proxy stream URL in a new tab — CDN requires server-side headers
        window.open(streamUrl, '_blank');
        
        showQuickMessage('Video opened', 'success');
        
    } catch (error) {
        console.error('Error:', error);
        showQuickMessage('Failed to open', 'error');
    }
}

        // Show loading in modal
        function showLoadingModal() {
            document.getElementById('modalTitle').textContent = 'Loading...';
            document.getElementById('modalYear').textContent = '';
            document.getElementById('modalRating').textContent = '';
            document.getElementById('modalDescription').textContent = 'Please wait while we load the content.';
            document.getElementById('modalError').style.display = 'none';
            document.getElementById('videoPlayer').src = '';

            // Force video area to full 16:9 size immediately — before video has a source
            const vp = document.getElementById('videoPlayer');
            const vw = document.getElementById('videoContainer').querySelector('.video-wrapper');
            const availW = window.innerWidth;
            const availH = window.innerHeight;
            const h = Math.min(availW * 0.5625, availH * 0.72);
            vp.style.minHeight = h + 'px';
            vp.style.height = h + 'px';
            if (vw) { vw.style.minHeight = h + 'px'; }

            openModal();
        }

        // Modal functions
        function openModal() {
            document.getElementById('videoModal').style.display = 'block';
            document.body.style.overflow = 'hidden';
            document.body.classList.add('modal-open');
            handleOrientationChange();
        }

        function closeModal() {
            document.getElementById('videoModal').style.display = 'none';
            document.body.style.overflow = 'auto';
            document.body.classList.remove('modal-open');
            const videoPlayer = document.getElementById('videoPlayer');
            savePlaybackPosition();
            localStorage.removeItem('activeWatchSession');
            videoPlayer.pause();
            videoPlayer.src = '';
            videoPlayer.load();
            currentSources = { sources: [], captions: [] };
            
            // Reset forced landscape
            if (isForcedLandscape) {
                isForcedLandscape = false;
                document.getElementById('rotateBtn').classList.remove('active');
                document.body.classList.remove('landscape-mode');
            }
            
            // Reset zoom
            if (isZoomed) {
                isZoomed = false;
                videoPlayer.style.objectFit = 'contain';
                document.getElementById('zoomBtn').classList.remove('active');
                document.getElementById('zoomBtn').innerHTML = '<i class="fas fa-expand-alt"></i>';
            }
        }

        // Handle landscape mode and orientation changes
        function handleOrientationChange() {
            const videoContainer = document.getElementById('videoContainer');
            const modalContent = document.querySelector('.modal-content');
            
            if (window.innerHeight < window.innerWidth && window.innerHeight < 600) {
                document.body.classList.add('landscape-mode');
            } else {
                document.body.classList.remove('landscape-mode');
            }
        }

        // Add to your existing code
        window.addEventListener('resize', handleOrientationChange);
        window.addEventListener('orientationchange', handleOrientationChange);

        // Close modal when clicking outside
        window.onclick = function(event) {
            const modal = document.getElementById('videoModal');
            if (event.target === modal) {
                closeModal();
            }
            
            const episodeModal = document.getElementById('episodeSelectionModal');
            if (event.target === episodeModal) {
                closeEpisodeSelection();
            }
        }

        // Search on Enter key
        document.getElementById('searchInput').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                closeSuggestions();
                searchContent();
            }
        });

        let searchDebounceTimer = null;
        const searchInput = document.getElementById('searchInput');
        const suggestionsBox = document.getElementById('searchSuggestions');

        searchInput.addEventListener('input', function() {
            const query = this.value.trim();
            clearTimeout(searchDebounceTimer);
            if (query.length < 2) {
                closeSuggestions();
                return;
            }
            suggestionsBox.innerHTML = '<div class="suggestion-loading"><i class="fas fa-spinner"></i> Searching...</div>';
            suggestionsBox.classList.add('show');
            searchDebounceTimer = setTimeout(() => fetchSuggestions(query), 400);
        });

        searchInput.addEventListener('focus', function() {
            if (this.value.trim().length >= 2 && suggestionsBox.children.length > 0) {
                suggestionsBox.classList.add('show');
            }
        });

        document.addEventListener('click', function(e) {
            if (!e.target.closest('.search-box')) {
                closeSuggestions();
            }
        });

        async function fetchSuggestions(query) {
            try {
                const response = await fetchAPI(`/api/search/${encodeURIComponent(query)}?perPage=6`);
                const results = extractMoviesFromResponse(response);
                if (searchInput.value.trim() !== query) return;
                renderSuggestions(results, query);
            } catch (err) {
                console.log('[SUGGEST] Error:', err.message);
                closeSuggestions();
            }
        }

        function renderSuggestions(results, query) {
            if (!results || results.length === 0) {
                suggestionsBox.innerHTML = '<div class="suggestion-loading">No results found</div>';
                return;
            }

            let html = results.slice(0, 6).map(movie => {
                const movieId = movie.id || movie.subjectId || '';
                const title = movie.title || movie.name || 'Unknown';
                const safeTitle = title.replace(/'/g, "\\'");
                const year = movie.year || '';
                const rating = movie.rating || '';
                const thumbnail = movie.thumbnail || movie.cover?.url || movie.stills?.url || 'https://via.placeholder.com/40x56/333/666?text=...';
                const subjectType = movie.subjectType || 1;
        const urlType = subjectType === 2 ? 'tv' : 'movie';
                const typeName = subjectType === 2 ? 'TV' : 'Movie';

                return `<div class="suggestion-item" onclick="closeSuggestions(); location.href='/movie/${movieId}'">
                    <img src="${thumbnail}" class="suggestion-poster" loading="lazy" onerror="this.src='https://via.placeholder.com/40x56/333/666?text=...'">
                    <div class="suggestion-info">
                        <div class="suggestion-title">${title}</div>
                        <div class="suggestion-meta">
                            ${year ? '<span>' + year + '</span>' : ''}
                            ${rating ? '<span class="star"><i class="fas fa-star"></i> ' + rating + '</span>' : ''}
                        </div>
                    </div>
                    <span class="suggestion-type-badge">${typeName}</span>
                </div>`;
            }).join('');

            html += `<div class="search-all-btn" onclick="closeSuggestions(); searchContent();">
                <i class="fas fa-search"></i> See all results for "${query}"
            </div>`;

            suggestionsBox.innerHTML = html;
            suggestionsBox.classList.add('show');
        }

        function closeSuggestions() {
            suggestionsBox.classList.remove('show');
        }

        // Smooth scrolling for navigation links
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function (e) {
                e.preventDefault();
                const targetId = this.getAttribute('href');
                const target = document.querySelector(targetId);
                if (target) {
                    document.getElementById('navLinks').classList.remove('active');
                    target.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                }
            });
        });

window.addEventListener('beforeunload', function() {
    savePlaybackPosition();
});
document.addEventListener('visibilitychange', function() {
    if (document.hidden) savePlaybackPosition();
});
// FAQ Modal Functions
function openFaqModal() {
    document.getElementById('faqModal').style.display = 'block';
    document.body.style.overflow = 'hidden';
    document.body.classList.add('modal-open');
}

function closeFaqModal() {
    document.getElementById('faqModal').style.display = 'none';
    document.body.style.overflow = 'auto';
    document.body.classList.remove('modal-open');
}

// Close FAQ modal when clicking outside
document.addEventListener('click', function(event) {
    const faqModal = document.getElementById('faqModal');
    if (event.target === faqModal) {
        closeFaqModal();
    }
});

// Close FAQ modal with Escape key
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        closeFaqModal();
    }
});
// Contact Modal Functions
function openContactModal() {
    document.getElementById('contactModal').style.display = 'block';
    document.body.style.overflow = 'hidden';
    document.body.classList.add('modal-open');
}

function closeContactModal() {
    document.getElementById('contactModal').style.display = 'none';
    document.body.style.overflow = 'auto';
    document.body.classList.remove('modal-open');
}

// Close Contact modal when clicking outside
document.addEventListener('click', function(event) {
    const contactModal = document.getElementById('contactModal');
    if (event.target === contactModal) {
        closeContactModal();
    }
});

// Close Contact modal with Escape key
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        closeContactModal();
    }
});

// ============= WATCHLIST & FAVORITES =============
function toggleFavorite(btn, movieId, title, thumbnail) {
    let favorites = JSON.parse(localStorage.getItem('favorites') || '[]');
    const index = favorites.findIndex(m => m.id === movieId);
    
    if (index > -1) {
        // Remove from favorites
        favorites.splice(index, 1);
        if (btn && btn.classList) {
            btn.classList.remove('active');
        }
    } else {
        // Add to favorites
        favorites.push({ id: movieId, title, thumbnail, addedAt: new Date().toISOString() });
        if (btn && btn.classList) {
            btn.classList.add('active');
        }
    }
    
    localStorage.setItem('favorites', JSON.stringify(favorites));
    updateFavoriteButtonState(movieId);
    const action = index > -1 ? 'removed from' : 'added to';
    console.log('[FAVORITE] Movie ' + action + ' watchlist');
    return action; // Return for use in messages
}

function updateFavoriteButtonState(movieId) {
    let favorites = JSON.parse(localStorage.getItem('favorites') || '[]');
    const btn = document.getElementById('fav-' + movieId);
    if (btn) {
        btn.classList.toggle('active', favorites.some(m => m.id === movieId));
    }
}

function openWatchlistModal() {
    document.getElementById('watchlistModal').style.display = 'block';
    document.body.style.overflow = 'hidden';
    document.body.classList.add('modal-open');
    renderWatchlist();
}

function closeWatchlistModal() {
    document.getElementById('watchlistModal').style.display = 'none';
    document.body.style.overflow = 'auto';
    document.body.classList.remove('modal-open');
}

function renderWatchlist() {
    let favorites = JSON.parse(localStorage.getItem('favorites') || '[]');
    const content = document.getElementById('watchlistContent');
    
    if (favorites.length === 0) {
        content.innerHTML = '<p style="grid-column: 1/-1; color: var(--gray); text-align: center; padding: 40px 20px;">Your watchlist is empty. Add movies to get started!</p>';
        return;
    }
    
    content.innerHTML = favorites.map(movie => `
        <div class="movie-card" style="position: relative; cursor: pointer;" onclick="closeWatchlistModal(); location.href='/movie/${movie.id}';">
            <img src="${movie.thumbnail}" alt="${movie.title}" class="movie-poster" loading="lazy" onerror="this.src='https://via.placeholder.com/300x450/333/666?text=Image+Not+Found'">
            <div class="movie-info">
                <h3 class="movie-title">${movie.title}</h3>
                <div class="movie-actions" style="gap: 5px;">
                    <button class="action-btn" onclick="event.stopPropagation(); removeFavorite('${movie.id}'); renderWatchlist();" style="flex: 1; background: rgba(255,68,68,0.2); color: var(--error);">
                        <i class="fas fa-trash"></i> Remove
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

function removeFavorite(movieId) {
    let favorites = JSON.parse(localStorage.getItem('favorites') || '[]');
    favorites = favorites.filter(m => m.id !== movieId);
    localStorage.setItem('favorites', JSON.stringify(favorites));
}

// ============= WATCH HISTORY =============
function addToHistory(movieId, title, thumbnail) {
    let history = JSON.parse(localStorage.getItem('watchHistory') || '[]');
    history = history.filter(m => m.id !== movieId);
    history.unshift({ id: movieId, title, thumbnail, watchedAt: new Date().toISOString() });
    history = history.slice(0, 50);
    localStorage.setItem('watchHistory', JSON.stringify(history));
    console.log('[HISTORY] Added to watch history');
}

function openHistoryModal() {
    document.getElementById('historyModal').style.display = 'block';
    document.body.style.overflow = 'hidden';
    document.body.classList.add('modal-open');
    renderHistory();
}

function closeHistoryModal() {
    document.getElementById('historyModal').style.display = 'none';
    document.body.style.overflow = 'auto';
    document.body.classList.remove('modal-open');
}

function renderHistory() {
    let history = JSON.parse(localStorage.getItem('watchHistory') || '[]');
    const content = document.getElementById('historyContent');
    
    if (history.length === 0) {
        content.innerHTML = '<p style="grid-column: 1/-1; color: var(--gray); text-align: center; padding: 40px 20px;">No watch history yet. Start watching movies!</p>';
        return;
    }
    
    content.innerHTML = history.map(movie => `
        <div class="movie-card" style="cursor: pointer;" onclick="closeHistoryModal(); location.href='/movie/${movie.id}';">
            <img src="${movie.thumbnail}" alt="${movie.title}" class="movie-poster" loading="lazy" onerror="this.src='https://via.placeholder.com/300x450/333/666?text=Image+Not+Found'">
            <div class="movie-info">
                <h3 class="movie-title">${movie.title}</h3>
                <p style="font-size: 0.8rem; color: var(--gray);">${new Date(movie.watchedAt).toLocaleDateString()}</p>
            </div>
        </div>
    `).join('');
}

// ============= ADVANCED SEARCH =============
let advancedSearchState = {
    query: '',
    type: '',
    currentPage: 1,
    hasMore: true,
    totalResults: 0
};

function openAdvancedSearch() {
    document.getElementById('advancedSearchModal').style.display = 'block';
    document.body.style.overflow = 'hidden';
    document.body.classList.add('modal-open');
}

function closeAdvancedSearch() {
    document.getElementById('advancedSearchModal').style.display = 'none';
    document.body.style.overflow = 'auto';
    document.body.classList.remove('modal-open');
}

async function performAdvancedSearch() {
    const query = document.getElementById('advSearchQuery').value;
    const type = document.getElementById('advSearchType').value;
    const sort = document.getElementById('advSearchSort').value;
    
    if (!query.trim()) {
        alert('Please enter a search query');
        return;
    }
    
    console.log('[SEARCH] Advanced search: ' + query + ' type:' + (type || 'all'));
    
    advancedSearchState.query = query;
    advancedSearchState.type = type;
    advancedSearchState.currentPage = 1;
    
    closeAdvancedSearch();
    document.getElementById('searchInput').value = query;
    document.getElementById('searchResultsGrid').innerHTML = '';
    
    await loadAdvancedSearchResults();
}

async function loadAdvancedSearchResults() {
    const query = advancedSearchState.query;
    const type = advancedSearchState.type;
    const page = advancedSearchState.currentPage;
    const searchGrid = document.getElementById('searchResultsGrid');
    
    try {
        let endpoint = '/api/search/' + query + '?page=' + page + '&perPage=12';
        if (type) {
            endpoint += '&type=' + type;
        }
        
        console.log('[SEARCH] Loading page ' + page + ' from: ' + endpoint);
        
        const response = await fetch(endpoint);
        const data = await response.json();
        
        if (data.status === 'success' && data.data && data.data.items) {
            const movies = data.data.items;
            const pager = data.data.pager || {};
            
            const moviesHTML = movies.map(movie => createMovieCard(movie)).join('');
            
            if (page === 1) {
                searchGrid.innerHTML = moviesHTML;
                advancedSearchState.totalResults = pager.totalCount || 0;
            } else {
                searchGrid.innerHTML += moviesHTML;
            }
            
            advancedSearchState.hasMore = pager.hasMore || false;
            
            if (advancedSearchState.hasMore) {
                let loadMoreBtn = document.getElementById('loadMoreBtn');
                if (!loadMoreBtn) {
                    loadMoreBtn = document.createElement('button');
                    loadMoreBtn.id = 'loadMoreBtn';
                    loadMoreBtn.className = 'btn btn-primary';
                    loadMoreBtn.style.width = '100%';
                    loadMoreBtn.style.marginTop = '20px';
                    loadMoreBtn.innerHTML = '<i class="fas fa-arrow-down"></i> Load More Results';
                    loadMoreBtn.onclick = function() {
                        advancedSearchState.currentPage++;
                        loadAdvancedSearchResults();
                    };
                    searchGrid.parentNode.appendChild(loadMoreBtn);
                }
            } else {
                const loadMoreBtn = document.getElementById('loadMoreBtn');
                if (loadMoreBtn) loadMoreBtn.remove();
            }
            
            console.log('[SUCCESS] Loaded ' + movies.length + ' results for page ' + page);
        }
    } catch (error) {
        console.error('[ERROR] Advanced search failed:', error);
    }
}

// ============= SHARING =============
function openShareModal(movieId, title) {
    document.getElementById('shareModal').style.display = 'block';
    document.body.style.overflow = 'hidden';
    document.body.classList.add('modal-open');
    document.getElementById('shareMovieTitle').textContent = title;
    
    const baseUrl = window.location.origin;
    const shareLink = baseUrl + '?movie=' + movieId + '&title=' + encodeURIComponent(title);
    document.getElementById('shareLink').value = shareLink;
}

function closeShareModal() {
    document.getElementById('shareModal').style.display = 'none';
    document.body.style.overflow = 'auto';
    document.body.classList.remove('modal-open');
}

function copyShareLink() {
    const link = document.getElementById('shareLink');
    link.select();
    document.execCommand('copy');
    showQuickMessage('[SUCCESS] Link copied to clipboard');
}

function shareOnWhatsApp() {
    const link = document.getElementById('shareLink').value;
    const title = document.getElementById('shareMovieTitle').textContent;
    const message = 'Check out ' + title + ' on HM CINEMA! ' + link;
    const whatsappUrl = 'https://wa.me/?text=' + encodeURIComponent(message);
    window.open(whatsappUrl, '_blank');
}

function shareOnTelegram() {
    const link = document.getElementById('shareLink').value;
    const title = document.getElementById('shareMovieTitle').textContent;
    const message = 'Check out ' + title + ' on HM CINEMA!\n' + link;
    const telegramUrl = 'https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent(title);
    window.open(telegramUrl, '_blank');
}

// ============= MOVIE ACTION MODAL =============
