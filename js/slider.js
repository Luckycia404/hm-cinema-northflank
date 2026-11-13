    let currentSlide = 0;
    let sliderInterval;

    // Shared trending data promise — fetched once, used by both slider and trending grid
    const _trendingPromise = fetch('/api/trending?page=0&perPage=24')
        .then(r => r.json())
        .catch(() => null);

    async function initHeroSlider() {
        try {
            const data = await _trendingPromise;
            
            let movies = [];
            if (data && data.status === 'success' && data.data && data.data.subjectList) {
                movies = data.data.subjectList;
            } else if (data && Array.isArray(data.data)) {
                movies = data.data;
            } else if (Array.isArray(data)) {
                movies = data;
            }
            
            if (!movies || movies.length === 0) {
                console.error('No movies found for slider');
                return;
            }
            
            const topMovies = movies.slice(0, 5);

            // Preload the first hero background image before injecting HTML
            if (topMovies[0]) {
                const firstImg = topMovies[0].thumbnail || topMovies[0].cover?.url || topMovies[0].stills?.url || topMovies[0].poster || '';
                if (firstImg) {
                    const preloader = new Image();
                    preloader.fetchPriority = 'high';
                    preloader.decoding = 'async';
                    preloader.src = firstImg;
                }
            }
            
            const slider = document.getElementById('heroSlider');
            const dotsContainer = document.getElementById('sliderDots');
            
            slider.innerHTML = topMovies.map((movie, index) => {
                const movieId = movie.id || movie.subjectId || '';
                const title = movie.title || movie.name || 'Unknown Title';
                const thumbnail = movie.thumbnail || movie.cover?.url || movie.stills?.url || movie.poster || '';
                const rating = movie.rating || '7.5';
                const year = movie.year || '2024';
                const description = movie.description || movie.introduction || 'Watch the latest trending titles on HM CINEMA in high quality.';
                const subjectType = movie.subjectType || 1;
                const safeTitle = title.replace(/'/g, "\\'");

                return `
                <div class="slide ${index === 0 ? 'active' : ''}" style="background-image: linear-gradient(to right, rgba(0,0,0,0.85) 40%, rgba(0,0,0,0.4) 100%), url('${thumbnail}')">
                    <div class="container">
                        <div class="slide-inner">
                            <div class="slide-content">
                                <span class="trending-badge"><i class="fas fa-fire"></i> Trending</span>
                                <h2 class="slide-title">${title}</h2>
                                <p class="slide-description">${description}</p>
                                <div class="slide-meta">
                                    <span><i class="fas fa-star" style="color: #FFD700;"></i> ${rating}</span>
                                    <span><i class="fas fa-calendar"></i> ${year}</span>
                                </div>
                                <div class="slide-actions">
                                    <button class="btn btn-primary watch-now" onclick="location.href='/movie/${movieId}'">
                                        <i class="fas fa-play"></i> Watch Now
                                    </button>
                                    <button class="btn btn-details" onclick="location.href='/movie/${movieId}'">
                                        <i class="fas fa-info-circle"></i> Details
                                    </button>
                                </div>
                            </div>
                            <div class="slide-poster-wrap">
                                <img src="${thumbnail}" alt="${title}" class="slide-poster-img" loading="${index === 0 ? 'eager' : 'lazy'}" fetchpriority="${index === 0 ? 'high' : 'auto'}" onerror="this.parentElement.style.display='none'">
                            </div>
                        </div>
                    </div>
                </div>
            `;}).join('');
            
            dotsContainer.innerHTML = topMovies.map((_, index) => `
                <div class="dot ${index === 0 ? 'active' : ''}" onclick="goToSlide(${index})"></div>
            `).join('');
            
            startSliderTimer();
        } catch (error) {
            console.error('Failed to init slider:', error);
        }
    }

    function startSliderTimer() {
        stopSliderTimer();
        sliderInterval = setInterval(() => moveSlider(1), 5000);
    }

    function stopSliderTimer() {
        if (sliderInterval) clearInterval(sliderInterval);
    }

    function transitionToSlide(index, direction) {
        const slides = document.querySelectorAll('#heroSlider .slide');
        const dots = document.querySelectorAll('#sliderDots .dot');
        if (!slides.length || index === currentSlide || !slides[index]) return;

        const outgoing = slides[currentSlide];
        const incoming = slides[index];
        const enterClass = direction >= 0 ? 'enter-from-right' : 'enter-from-left';
        const exitClass = direction >= 0 ? 'exit-to-left' : 'exit-to-right';

        slides.forEach(slide => {
            slide.classList.remove('enter-from-right', 'enter-from-left', 'exit-to-left', 'exit-to-right');
            slide.style.zIndex = '';
        });
        incoming.classList.add(enterClass);
        incoming.style.zIndex = '3';
        outgoing.style.zIndex = '2';
        void incoming.offsetWidth;

        outgoing.classList.remove('active');
        outgoing.classList.add(exitClass);
        incoming.classList.remove(enterClass);
        incoming.classList.add('active');

        if (dots[currentSlide]) dots[currentSlide].classList.remove('active');
        currentSlide = index;
        if (dots[currentSlide]) dots[currentSlide].classList.add('active');

        window.setTimeout(() => {
            outgoing.classList.remove(exitClass);
            outgoing.style.zIndex = '';
            incoming.style.zIndex = '';
        }, 780);
    }

    function moveSlider(direction) {
        const slides = document.querySelectorAll('#heroSlider .slide');
        if (!slides.length) return;
        const nextIndex = (currentSlide + direction + slides.length) % slides.length;
        transitionToSlide(nextIndex, direction);
        startSliderTimer();
    }

    function goToSlide(index) {
        const slides = document.querySelectorAll('#heroSlider .slide');
        if (!slides.length || index < 0 || index >= slides.length || index === currentSlide) return;
        const direction = index > currentSlide ? 1 : -1;
        transitionToSlide(index, direction);
        startSliderTimer();
    }

    // This script is loaded after the hero markup; don't wait for unrelated page assets.
    initHeroSlider();
