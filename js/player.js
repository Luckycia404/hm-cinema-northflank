// HM Cinema - Video Player Module
// Handles: video player setup, playback session, gestures,
//          episode navigation, subtitle system, quick messages
// Depends on globals declared in main.js (currentMovieId, currentSubjectType, etc.)

    function resumeActiveSession() {
        try {
            const sessionData = localStorage.getItem('activeWatchSession');
            if (!sessionData) return;
            const session = JSON.parse(sessionData);
            const hoursSince = (Date.now() - session.timestamp) / (1000 * 60 * 60);
            if (hoursSince > 12) {
                localStorage.removeItem('activeWatchSession');
                return;
            }
            window.currentEpisodeKey = session.episodeKey || '';
            const playbackKey = getPlaybackKey(session.movieId);
            const savedPos = localStorage.getItem(playbackKey);
            if (!savedPos) {
                localStorage.removeItem('activeWatchSession');
                return;
            }
            const posData = JSON.parse(savedPos);
            const timeStr = formatTime(posData.time);
            const durationStr = formatTime(posData.duration);
            const resumeBanner = document.createElement('div');
            resumeBanner.id = 'resumeBanner';
            resumeBanner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:linear-gradient(135deg,#e50914,#b20710);color:#fff;padding:16px 20px;z-index:99999;display:flex;align-items:center;justify-content:space-between;box-shadow:0 -4px 20px rgba(0,0,0,0.5);animation:slideUp 0.4s ease;';
            const isEpisode = session.subjectType === 2;
            const epLabel = isEpisode ? ` (S${session.season} E${session.episode})` : '';
            resumeBanner.innerHTML = `
                <div style="flex:1;">
                    <div style="font-weight:bold;font-size:15px;">Continue Watching${epLabel}</div>
                    <div style="font-size:13px;opacity:0.85;margin-top:2px;">${timeStr} / ${durationStr}</div>
                </div>
                <button onclick="resumeWatchSession()" style="background:#fff;color:#e50914;border:none;padding:10px 22px;border-radius:25px;font-weight:bold;font-size:14px;cursor:pointer;margin-right:10px;">&#9654; Resume</button>
                <button onclick="dismissResumeBanner()" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.5);padding:8px 14px;border-radius:20px;font-size:13px;cursor:pointer;">Dismiss</button>
            `;
            const style = document.createElement('style');
            style.textContent = '@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}';
            document.head.appendChild(style);
            document.body.appendChild(resumeBanner);
        } catch (e) {
            console.log('Could not check active session:', e);
        }
    }

    window.resumeWatchSession = function() {
        const banner = document.getElementById('resumeBanner');
        if (banner) banner.remove();
        try {
            const session = JSON.parse(localStorage.getItem('activeWatchSession'));
            if (session) {
                window.currentEpisodeKey = session.episodeKey || '';
                if (session.subjectType === 2 && session.season && session.episode) {
                    currentMovieId = session.movieId;
                    currentSubjectType = 2;
                    selectEpisode(session.season, session.episode);
                } else {
                    watchMovie(session.movieId, session.subjectType || 1);
                }
            }
        } catch (e) { console.log('Resume failed:', e); }
    };

    window.dismissResumeBanner = function() {
        const banner = document.getElementById('resumeBanner');
        if (banner) {
            banner.style.transform = 'translateY(100%)';
            banner.style.transition = 'transform 0.3s ease';
            setTimeout(() => banner.remove(), 300);
        }
        localStorage.removeItem('activeWatchSession');
    };

    function getPlaybackKey(movieId) {
        const epKey = window.currentEpisodeKey || '';
        return `playback_${movieId}${epKey ? '_' + epKey : ''}`;
    }

    function savePlaybackPosition() {
        const videoPlayer = document.getElementById('videoPlayer');
        if (currentMovieId && videoPlayer.currentTime > 5 && videoPlayer.duration) {
            const progressPercent = (videoPlayer.currentTime / videoPlayer.duration) * 100;
            const saveKey = getPlaybackKey(currentMovieId);
            if (progressPercent < 95) {
                localStorage.setItem(saveKey, JSON.stringify({
                    time: videoPlayer.currentTime,
                    duration: videoPlayer.duration,
                    timestamp: Date.now()
                }));
                localStorage.setItem('activeWatchSession', JSON.stringify({
                    movieId: currentMovieId,
                    subjectType: currentSubjectType,
                    season: currentSeason,
                    episode: currentEpisode,
                    episodeKey: window.currentEpisodeKey || '',
                    timestamp: Date.now()
                }));
            } else {
                localStorage.removeItem(saveKey);
                localStorage.removeItem('activeWatchSession');
            }
        }
    }

    function restorePlaybackPosition(movieId, videoPlayer) {
        const saveKey = getPlaybackKey(movieId);
        const saved = localStorage.getItem(saveKey);
        if (saved) {
            try {
                const data = JSON.parse(saved);
                const daysSinceLastWatch = (Date.now() - data.timestamp) / (1000 * 60 * 60 * 24);
                if (daysSinceLastWatch < 30 && data.time > 5) {
                    const resumeHandler = function() {
                        videoPlayer.currentTime = data.time;
                        videoPlayer.removeEventListener('loadeddata', resumeHandler);
                        const resumeToast = document.createElement('div');
                        resumeToast.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.85);color:#fff;padding:14px 24px;border-radius:10px;z-index:99999;font-size:15px;text-align:center;pointer-events:none;';
                        resumeToast.innerHTML = `<div style="margin-bottom:4px;">▶ Resuming from ${formatTime(data.time)}</div>`;
                        document.body.appendChild(resumeToast);
                        setTimeout(() => { resumeToast.style.opacity = '0'; resumeToast.style.transition = 'opacity 0.5s'; }, 2500);
                        setTimeout(() => resumeToast.remove(), 3000);
                    };
                    videoPlayer.addEventListener('loadeddata', resumeHandler);
                    return true;
                }
            } catch (e) { console.log('Could not restore playback:', e); }
        }
        return false;
    }

      // Enhanced video player setup with smooth progress bar
function setupVideoPlayer() {
    const videoPlayer = document.getElementById('videoPlayer');
    const playPauseBtn = document.getElementById('playPauseBtn');
    const muteBtn = document.getElementById('muteBtn');
    const progressBar = document.getElementById('progressBar');
    const progressContainer = document.getElementById('progressContainer');
    const timeDisplay = document.getElementById('timeDisplay');
    const bigPlayBtn = document.getElementById('bigPlayBtn');
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const qualitySelector = document.getElementById('qualitySelector');
    const customControls = document.getElementById('customControls');
    const videoContainer = document.getElementById('videoContainer');
    const rotateBtn = document.getElementById('rotateBtn');
    const rewindBtn = document.getElementById('rewindBtn');
    const forwardBtn = document.getElementById('forwardBtn');
    const zoomBtn = document.getElementById('zoomBtn');
    const pipBtn = document.getElementById('pipBtn');

    // Initialize subtitle system
    initializeSubtitleSystem();

    // Create and add timer toast
const timerToast = document.createElement('div');
timerToast.className = 'seek-timer-toast';
timerToast.innerHTML = `
    <div class="time-display">0:00/0:00</div>
`;
videoContainer.appendChild(timerToast);

    // Remove default browser controls
    videoPlayer.removeAttribute('controls');
    videoPlayer.controls = false;

    // Play/Pause functionality
    playPauseBtn.addEventListener('click', function() {
        if (videoPlayer.paused) {
            videoPlayer.play();
        } else {
            videoPlayer.pause();
        }
    });

    // Once video has data, release the forced loading height so it flows naturally
    videoPlayer.addEventListener('loadeddata', function() {
        videoPlayer.style.minHeight = '';
        videoPlayer.style.height = '';
        const vw = videoContainer.querySelector('.video-wrapper');
        if (vw) vw.style.minHeight = '';
    });

    videoPlayer.addEventListener('play', function() {
        playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
        bigPlayBtn.style.display = 'none';
        videoContainer.classList.add('playing');
        videoContainer.classList.remove('paused');
        isPlaying = true;
    });

    videoPlayer.addEventListener('pause', function() {
        playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
        bigPlayBtn.style.display = 'flex';
        videoContainer.classList.add('paused');
        videoContainer.classList.remove('playing');
        isPlaying = false;
    });

    // Big play button
    bigPlayBtn.addEventListener('click', function() {
        videoPlayer.play();
    });

    // Enhanced touch controls
    videoPlayer.addEventListener('touchstart', function(e) {
        // Don't auto-show controls on touchstart - let touchend handle toggle
        // This prevents the "appear then vanish" bug in portrait mode
        if (!e.target.closest('.custom-controls') && !e.target.closest('.big-play-btn')) {
            e.preventDefault();
        }
    });

    // Volume control
    muteBtn.addEventListener('click', function() {
        videoPlayer.muted = !videoPlayer.muted;
        muteBtn.innerHTML = videoPlayer.muted ? 
            '<i class="fas fa-volume-mute"></i>' : 
            '<i class="fas fa-volume-up"></i>';
    });

    // Enhanced progress bar with smooth seeking
    let isSeeking = false;
    let hideTimerTimeout;

  // Update time display to show hours when needed
videoPlayer.addEventListener('timeupdate', function() {
    if (videoPlayer.duration && !isSeeking) {
        const progress = (videoPlayer.currentTime / videoPlayer.duration) * 100;
        progressBar.style.width = progress + '%';
        
        // Update buffering bar
        if (videoPlayer.buffered.length > 0) {
            const bufferedEnd = videoPlayer.buffered.end(videoPlayer.buffered.length - 1);
            const bufferedPercent = (bufferedEnd / videoPlayer.duration) * 100;
            document.getElementById('bufferedBar').style.width = bufferedPercent + '%';
        }
        
        const currentTime = formatTime(videoPlayer.currentTime);
        const duration = formatTime(videoPlayer.duration);
        timeDisplay.textContent = `${currentTime}/${duration}`;

        if (currentMovieId && videoPlayer.currentTime > 5) {
            const saveKey = getPlaybackKey(currentMovieId);
            const now = Date.now();
            if (!videoPlayer._lastSaveTime || now - videoPlayer._lastSaveTime > 5000) {
                videoPlayer._lastSaveTime = now;
                const progressPercent = (videoPlayer.currentTime / videoPlayer.duration) * 100;
                if (progressPercent < 95) {
                    localStorage.setItem(saveKey, JSON.stringify({
                        time: videoPlayer.currentTime,
                        duration: videoPlayer.duration,
                        timestamp: now
                    }));
                } else {
                    localStorage.removeItem(saveKey);
                }
            }
        }
    }
});

    // Update buffering bar on progress
    videoPlayer.addEventListener('progress', function() {
        if (videoPlayer.duration && videoPlayer.buffered.length > 0) {
            const bufferedEnd = videoPlayer.buffered.end(videoPlayer.buffered.length - 1);
            const bufferedPercent = (bufferedEnd / videoPlayer.duration) * 100;
            const bufferedBar = document.getElementById('bufferedBar');
            if (bufferedBar) bufferedBar.style.width = bufferedPercent + '%';
        }
    });

    // Enhanced progress container events
    progressContainer.addEventListener('click', handleSeek);
    
    // Touch events for mobile
    progressContainer.addEventListener('touchstart', function(e) {
        e.preventDefault();
        isSeeking = true;
        handleSeek(e);
        showTimerToast();
    });
    
    progressContainer.addEventListener('touchmove', function(e) {
        if (isSeeking) {
            e.preventDefault();
            handleSeek(e);
            showTimerToast();
        }
    });
    
    progressContainer.addEventListener('touchend', function() {
        isSeeking = false;
        hideTimerToast();
    });
    
    // Mouse events for desktop
    progressContainer.addEventListener('mousedown', function(e) {
        isSeeking = true;
        handleSeek(e);
        showTimerToast();
    });
    
    document.addEventListener('mousemove', function(e) {
        if (isSeeking) {
            handleSeek(e);
            showTimerToast();
        }
    });
    
    document.addEventListener('mouseup', function() {
        if (isSeeking) {
            isSeeking = false;
            hideTimerToast();
        }
    });

    function handleSeek(e) {
        if (!videoPlayer.duration) return;
        
        const rect = progressContainer.getBoundingClientRect();
        let clientX;
        
        if (e.type.includes('touch')) {
            clientX = e.touches[0].clientX;
        } else {
            clientX = e.clientX;
        }
        
        const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const newTime = percent * videoPlayer.duration;
        
        // Update progress bar immediately for smooth visual feedback
        progressBar.style.width = (percent * 100) + '%';
        
        // Update video time
        videoPlayer.currentTime = newTime;
        
        // Update timer toast
        updateTimerToast(newTime, videoPlayer.duration);
    }
    
    function showTimerToast() {
        timerToast.classList.add('show');
        clearTimeout(hideTimerTimeout);
    }
    
    function hideTimerToast() {
        hideTimerTimeout = setTimeout(() => {
            timerToast.classList.remove('show');
        }, 500);
    }
    
    function updateTimerToast(currentTime, duration) {
    const currentFormatted = formatTime(currentTime);
    const totalFormatted = formatTime(duration);
    
    timerToast.querySelector('.time-display').textContent = `${currentFormatted}/${totalFormatted}`;
}

    // Enhanced time formatting function
    function formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}:${secs.toString().padStart(2, '0')}`;
        }
    }

    // Skip buttons
    rewindBtn.addEventListener('click', function() {
        videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - 10);
    });

    forwardBtn.addEventListener('click', function() {
        videoPlayer.currentTime = Math.min(videoPlayer.duration, videoPlayer.currentTime + 10);
    });

    // Zoom controls - 4 level zoom with no cropping - just stretches to fit screen
    zoomBtn.addEventListener('click', function() {
        zoomLevel = (zoomLevel + 1) % 4;
        
        if (zoomLevel === 0) {
            // Normal - fit entire video with black bars
            videoPlayer.style.objectFit = 'contain';
            videoPlayer.style.transform = 'scale(1)';
            zoomBtn.classList.remove('active');
            zoomBtn.innerHTML = '<i class="fas fa-expand-alt"></i>';
        } else if (zoomLevel === 1) {
            // Light zoom - stretch to fill screen (no cropping)
            videoPlayer.style.objectFit = 'fill';
            videoPlayer.style.transform = 'scale(1)';
            zoomBtn.classList.add('active');
            zoomBtn.innerHTML = '<i class="fas fa-search-plus"></i>';
        } else if (zoomLevel === 2) {
            // Medium zoom - fill + 1.05x scale (still no cropping)
            videoPlayer.style.objectFit = 'fill';
            videoPlayer.style.transform = 'scale(1.05)';
            zoomBtn.classList.add('active');
            zoomBtn.innerHTML = '<i class="fas fa-search-plus"></i>';
        } else {
            // Full zoom - fill + 1.15x scale (still no cropping)
            videoPlayer.style.objectFit = 'fill';
            videoPlayer.style.transform = 'scale(1.15)';
            zoomBtn.classList.add('active');
            zoomBtn.innerHTML = '<i class="fas fa-search-minus"></i>';
        }
    });

    // Picture-in-Picture
    pipBtn.addEventListener('click', function() {
        if (document.pictureInPictureElement) {
            document.exitPictureInPicture().catch(error => {
                console.log('PiP error:', error);
            });
        } else if (document.pictureInPictureEnabled) {
            videoPlayer.requestPictureInPicture().catch(error => {
                console.log('PiP error:', error);
            });
        }
    });

    videoPlayer.addEventListener('enterpictureinpicture', function() {
        pipBtn.classList.add('active');
        isPiPActive = true;
    });

    videoPlayer.addEventListener('leavepictureinpicture', function() {
        pipBtn.classList.remove('active');
        isPiPActive = false;
    });

    const speedBtn = document.getElementById('speedBtn');
    const speedDropdown = document.getElementById('speedDropdown');
    speedBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        speedDropdown.classList.toggle('show');
        const otherDropdowns = document.querySelectorAll('.subtitle-dropdown.show');
        otherDropdowns.forEach(d => d.classList.remove('show'));
    });
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.speed-selector-container')) {
            speedDropdown.classList.remove('show');
        }
    });

    // Fullscreen functionality
    fullscreenBtn.addEventListener('click', function() {
        if (!document.fullscreenElement) {
            if (videoContainer.requestFullscreen) {
                videoContainer.requestFullscreen();
            } else if (videoContainer.webkitRequestFullscreen) {
                videoContainer.webkitRequestFullscreen();
            } else if (videoContainer.msRequestFullscreen) {
                videoContainer.msRequestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
        }
    });

    // Update fullscreen button when fullscreen changes
    document.addEventListener('fullscreenchange', updateFullscreenButton);
    document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
    document.addEventListener('msfullscreenchange', updateFullscreenButton);

    function updateFullscreenButton() {
        if (document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement) {
            fullscreenBtn.innerHTML = '<i class="fas fa-compress"></i>';
        } else {
            fullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
        }
    }

    // Quality selector
    qualitySelector.addEventListener('change', function() {
        const selectedUrl = this.value;
        if (selectedUrl) {
            const currentTime = videoPlayer.currentTime;
            videoPlayer.src = selectedUrl;
            videoPlayer.load();
            videoPlayer.currentTime = currentTime;
            videoPlayer.play().catch(e => console.log('Auto-play prevented'));
            currentQuality = this.options[this.selectedIndex].text;
        }
    });

    // Force landscape rotation
    rotateBtn.addEventListener('click', function() {
        isForcedLandscape = !isForcedLandscape;
        this.classList.toggle('active', isForcedLandscape);
        
        if (isForcedLandscape) {
            // Request fullscreen first (required for orientation lock on most browsers)
            const requestFullscreen = () => {
                if (!document.fullscreenElement) {
                    const fsPromise = videoContainer.requestFullscreen 
                        ? videoContainer.requestFullscreen()
                        : videoContainer.webkitRequestFullscreen 
                        ? videoContainer.webkitRequestFullscreen()
                        : videoContainer.msRequestFullscreen
                        ? videoContainer.msRequestFullscreen()
                        : Promise.resolve();
                    
                    fsPromise.then(() => {
                        // After fullscreen, lock orientation
                        if (screen.orientation && screen.orientation.lock) {
                            screen.orientation.lock('landscape').catch(function(error) {
                                console.log('Orientation lock failed: ', error);
                            });
                        }
                    }).catch(err => console.log('Fullscreen failed:', err));
                } else {
                    // Already fullscreen, just lock orientation
                    if (screen.orientation && screen.orientation.lock) {
                        screen.orientation.lock('landscape').catch(function(error) {
                            console.log('Orientation lock failed: ', error);
                        });
                    }
                }
            };
            
            requestFullscreen();
            document.body.classList.add('landscape-mode');
            customControls.style.opacity = '0';
            controlsShownInLandscape = false;
            showMessage('Landscape mode activated');
        } else {
            // Exit fullscreen and unlock orientation
            if (document.exitFullscreen) {
                document.exitFullscreen().catch(err => console.log('Exit fullscreen failed:', err));
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
            
            if (screen.orientation && screen.orientation.unlock) {
                screen.orientation.unlock();
            }
            document.body.classList.remove('landscape-mode');
            customControls.style.opacity = '1';
            showMessage('Portrait mode activated');
        }
    });

    // Show controls on mouse move - no auto-hide
    let controlsTimeout;
    videoContainer.addEventListener('mousemove', function() {
        customControls.style.opacity = '1';
        clearTimeout(controlsTimeout);
    });

    // Touch controls for mobile - toggle controls on tap (landscape mode fix)
    let lastTouchTime = 0;
    let controlsShownInLandscape = false;
    
    videoContainer.addEventListener('touchend', function(e) {
        // Ignore if touching controls or big play button
        if (e.target.closest('.custom-controls') || e.target.closest('.big-play-btn')) {
            return;
        }
        
        const currentTime = new Date().getTime();
        const tapLength = currentTime - lastTouchTime;
        
        // Landscape mode: strict toggle - tap 1 shows, tap 2 hides
        if (document.body.classList.contains('landscape-mode')) {
            // Simple toggle in landscape mode
            if (!controlsShownInLandscape) {
                // Controls hidden, show them on tap
                customControls.style.opacity = '1';
                clearTimeout(controlsTimeout);
                controlsShownInLandscape = true;
            } else {
                // Controls shown, hide them on tap
                customControls.style.opacity = '0';
                controlsShownInLandscape = false;
            }
        } else {
            // Portrait mode: toggle as before
            if (customControls.style.opacity === '0' || customControls.style.opacity === '') {
                customControls.style.opacity = '1';
                clearTimeout(controlsTimeout);
            } else {
                customControls.style.opacity = '0';
            }
        }
        
        lastTouchTime = currentTime;
    });

    // Keep controls visible when hovering over them
    customControls.addEventListener('mouseenter', function() {
        clearTimeout(controlsTimeout);
        customControls.style.opacity = '1';
    });

    customControls.addEventListener('mouseleave', function() {
        // Controls stay visible - no auto-hide
    });

    videoPlayer.addEventListener('ended', function() {
        console.log('[AUTOPLAY] Video ended. Type:', currentSubjectType, 'Index:', currentEpisodeIndex, 'Total:', episodeList.length);
        if (currentSubjectType === 2 && currentEpisodeIndex < episodeList.length - 1) {
            console.log('[AUTOPLAY] Triggering countdown');
            showAutoPlayToast();
        }
    });

    // Buffering spinner
    const bufferingSpinner = document.getElementById('bufferingSpinner');
    function showSpinner() {
        if (bufferingSpinner) bufferingSpinner.classList.add('active');
        if (bigPlayBtn) bigPlayBtn.style.display = 'none';
    }
    function hideSpinner() {
        if (bufferingSpinner) bufferingSpinner.classList.remove('active');
        if (bigPlayBtn && videoPlayer.paused && !videoPlayer.ended) bigPlayBtn.style.display = 'flex';
    }
    videoPlayer.addEventListener('loadstart', showSpinner);
    videoPlayer.addEventListener('waiting', showSpinner);
    videoPlayer.addEventListener('stalled', showSpinner);
    videoPlayer.addEventListener('seeking', showSpinner);
    videoPlayer.addEventListener('playing', hideSpinner);
    videoPlayer.addEventListener('canplay', hideSpinner);
    videoPlayer.addEventListener('seeked', hideSpinner);
    videoPlayer.addEventListener('pause', hideSpinner);
    videoPlayer.addEventListener('error', hideSpinner);

    // Tap to play (autoplay blocked)
    const tapToPlayEl = document.getElementById('tapToPlay');
    if (tapToPlayEl) {
        tapToPlayEl.addEventListener('click', function() {
            tapToPlayEl.classList.remove('active');
            videoPlayer.play().catch(() => {});
        });
    }
    videoPlayer.addEventListener('playing', function() {
        if (tapToPlayEl) tapToPlayEl.classList.remove('active');
    });

    // Stall recovery: only intervene after 12 seconds of zero playback progress
    // Nudging/reloading on every 'waiting' event resets the buffer and causes stuttering —
    // the browser handles normal buffering better on its own.
    let stallTimer = null;
    let lastProgressTime = Date.now();

    function clearStallTimer() {
        if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
    }

    videoPlayer.addEventListener('timeupdate', function() {
        lastProgressTime = Date.now();
        clearStallTimer();
    });

    function scheduleLastResortRecovery() {
        clearStallTimer();
        stallTimer = setTimeout(function() {
            if (videoPlayer.paused || videoPlayer.ended) return;
            // Only act if truly no progress for 12 seconds
            if (Date.now() - lastProgressTime < 12000) return;
            const resumeAt = videoPlayer.currentTime;
            videoPlayer.load();
            videoPlayer.addEventListener('canplay', function onCanPlay() {
                videoPlayer.currentTime = resumeAt;
                videoPlayer.play().catch(() => {});
                videoPlayer.removeEventListener('canplay', onCanPlay);
            });
        }, 12000);
    }

    videoPlayer.addEventListener('waiting', scheduleLastResortRecovery);
    videoPlayer.addEventListener('stalled', scheduleLastResortRecovery);
    videoPlayer.addEventListener('playing', clearStallTimer);
    videoPlayer.addEventListener('seeked', function() {
        lastProgressTime = Date.now();
        clearStallTimer();
    });

    let autoPlayTimer;
    function showAutoPlayToast() {
        const toast = document.createElement('div');
        toast.id = 'autoPlayToast';
        toast.style.cssText = `
            position: fixed;
            bottom: 100px;
            right: 20px;
            background: rgba(0,0,0,0.9);
            color: white;
            padding: 20px;
            border-radius: 12px;
            z-index: 10000;
            border-left: 4px solid var(--primary);
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            display: flex;
            flex-direction: column;
            gap: 10px;
            min-width: 250px;
            animation: slideInRight 0.5s ease-out;
        `;
        
        const nextEpisode = episodeList[currentEpisodeIndex + 1];
        const nextTitle = nextEpisode ? (nextEpisode.title || `Episode ${currentEpisodeIndex + 2}`) : 'Next Episode';
        
        toast.innerHTML = `
            <div style="font-weight: bold; font-size: 0.9rem; color: var(--gray);">Up Next in 5s</div>
            <div style="font-size: 1.1rem; font-weight: 700;">${nextTitle}</div>
            <div style="display: flex; gap: 10px; margin-top: 5px;">
                <button id="cancelAutoPlay" class="btn btn-secondary" style="flex: 1; padding: 8px; font-size: 0.8rem;">Cancel</button>
                <button id="playNowAutoPlay" class="btn btn-primary" style="flex: 1; padding: 8px; font-size: 0.8rem;">Play Now</button>
            </div>
            <div id="autoPlayProgress" style="height: 3px; background: var(--primary); width: 100%; transition: width 5s linear;"></div>
        `;
        
        document.body.appendChild(toast);
        
        // Start progress bar animation
        setTimeout(() => {
            const progress = document.getElementById('autoPlayProgress');
            if (progress) progress.style.width = '0%';
        }, 100);

        autoPlayTimer = setTimeout(() => {
            playNextEpisode();
            toast.remove();
        }, 5000);

        document.getElementById('cancelAutoPlay').onclick = () => {
            clearTimeout(autoPlayTimer);
            toast.remove();
        };

        document.getElementById('playNowAutoPlay').onclick = () => {
            clearTimeout(autoPlayTimer);
            playNextEpisode();
            toast.remove();
        };
    }

    // Add CSS for the toast animation if not exists
    if (!document.getElementById('autoPlayStyles')) {
        const styles = document.createElement('style');
        styles.id = 'autoPlayStyles';
        styles.textContent = `
            @keyframes slideInRight {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(styles);
    }

    
    // Initialize brightness/volume gesture controls
    initializeBrightnessVolumeGestures();
    
    // Initialize next/prev buttons
    initializeNextPrevButtons();
}

// Brightness/Volume Gesture Controls
let videoBrightness = 1;
let gestureStartY = 0;
let gestureStartX = 0;
let isGesturing = false;
let gestureType = null;
let gestureHideTimeout = null;

function initializeBrightnessVolumeGestures() {
    const videoWrapper = document.querySelector('.video-wrapper');
    const videoPlayer = document.getElementById('videoPlayer');
    const gestureIndicator = document.getElementById('gestureIndicator');
    const gestureIcon = document.getElementById('gestureIcon');
    const gestureBarFill = document.getElementById('gestureBarFill');
    const gestureValue = document.getElementById('gestureValue');
    
    if (!videoWrapper || !gestureIndicator) return;
    
    videoWrapper.addEventListener('touchstart', function(e) {
        if (e.target.closest('.custom-controls') || e.target.closest('.big-play-btn')) {
            return;
        }
        
        const touch = e.touches[0];
        gestureStartY = touch.clientY;
        gestureStartX = touch.clientX;
        
        const wrapperRect = videoWrapper.getBoundingClientRect();
        const touchX = touch.clientX - wrapperRect.left;
        const halfWidth = wrapperRect.width / 2;
        
        if (touchX > halfWidth) {
            gestureType = 'brightness';
            gestureIcon.innerHTML = '<i class="fas fa-sun"></i>';
            gestureIcon.className = 'gesture-icon brightness';
        } else {
            gestureType = 'volume';
            gestureIcon.innerHTML = '<i class="fas fa-volume-up"></i>';
            gestureIcon.className = 'gesture-icon volume';
        }
    }, { passive: true });
    
    videoWrapper.addEventListener('touchmove', function(e) {
        if (!gestureType) return;
        
        const touch = e.touches[0];
        const deltaY = gestureStartY - touch.clientY;
        const deltaX = Math.abs(touch.clientX - gestureStartX);
        
        if (deltaX > 30 && !isGesturing) {
            return;
        }
        
        if (Math.abs(deltaY) > 15) {
            isGesturing = true;
            e.preventDefault();
            
            const sensitivity = 0.005;
            
            if (gestureType === 'brightness') {
                videoBrightness = Math.max(0.1, Math.min(1, videoBrightness + (deltaY * sensitivity)));
                videoPlayer.style.filter = `brightness(${videoBrightness})`;
                
                const percentage = Math.round(videoBrightness * 100);
                gestureBarFill.style.width = percentage + '%';
                gestureBarFill.style.background = '#FFD700';
                gestureValue.textContent = percentage + '%';
            } else if (gestureType === 'volume') {
                const newVolume = Math.max(0, Math.min(1, videoPlayer.volume + (deltaY * sensitivity)));
                videoPlayer.volume = newVolume;
                
                const percentage = Math.round(newVolume * 100);
                gestureBarFill.style.width = percentage + '%';
                gestureBarFill.style.background = 'var(--secondary)';
                gestureValue.textContent = percentage + '%';
                
                if (newVolume === 0) {
                    gestureIcon.innerHTML = '<i class="fas fa-volume-mute"></i>';
                } else if (newVolume < 0.5) {
                    gestureIcon.innerHTML = '<i class="fas fa-volume-down"></i>';
                } else {
                    gestureIcon.innerHTML = '<i class="fas fa-volume-up"></i>';
                }
            }
            
            gestureIndicator.classList.add('show');
            gestureStartY = touch.clientY;
            
            clearTimeout(gestureHideTimeout);
        }
    }, { passive: false });
    
    videoWrapper.addEventListener('touchend', function() {
        if (isGesturing) {
            gestureHideTimeout = setTimeout(() => {
                gestureIndicator.classList.remove('show');
            }, 500);
        }
        isGesturing = false;
        gestureType = null;
    }, { passive: true });
}

// Next/Prev Episode Navigation
let currentEpisodeIndex = 0;
let episodeList = [];

function initializeNextPrevButtons() {
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    
    if (!prevBtn || !nextBtn) return;
    
    prevBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        playPreviousEpisode();
    });
    
    nextBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        playNextEpisode();
    });
    
    updateNextPrevButtons();
}

function updateNextPrevButtons() {
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    
    if (!prevBtn || !nextBtn) return;
    
    if (episodeList.length <= 1) {
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        prevBtn.style.display = 'none';
        nextBtn.style.display = 'none';
    } else {
        prevBtn.style.display = 'inline-flex';
        nextBtn.style.display = 'inline-flex';
        prevBtn.disabled = currentEpisodeIndex <= 0;
        nextBtn.disabled = currentEpisodeIndex >= episodeList.length - 1;
    }
}

function setEpisodeList(episodes, currentIndex) {
    episodeList = episodes || [];
    currentEpisodeIndex = currentIndex || 0;
    updateNextPrevButtons();
}

function playPreviousEpisode() {
    if (currentEpisodeIndex > 0 && episodeList.length > 0) {
        currentEpisodeIndex--;
        const episode = episodeList[currentEpisodeIndex];
        if (episode && episode.onClick) {
            episode.onClick();
        }
        updateNextPrevButtons();
        showMessage('Playing previous episode');
    }
}

function playNextEpisode() {
    if (currentEpisodeIndex < episodeList.length - 1 && episodeList.length > 0) {
        currentEpisodeIndex++;
        const episode = episodeList[currentEpisodeIndex];
        if (episode && episode.onClick) {
            episode.onClick();
        }
        updateNextPrevButtons();
        showMessage('Playing next episode');
    }
}

        function formatTime(seconds) {
            if (isNaN(seconds)) return '0:00';
            const minutes = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
        }
        
        function showMessage(message) {
    const msg = document.createElement('div');
    msg.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0,0,0,0.8);
        color: white;
        padding: 15px 25px;
        border-radius: 8px;
        z-index: 9999;
        font-weight: 600;
        backdrop-filter: blur(10px);
    `;
    msg.textContent = message;
    document.body.appendChild(msg);
    
    setTimeout(() => {
        if (msg.parentNode) {
            msg.parentNode.removeChild(msg);
        }
    }, 2000);
}

// Initialize subtitle system
function initializeSubtitleSystem() {
    const subtitleBtn = document.getElementById('subtitleBtn');
    const subtitleDropdown = document.getElementById('subtitleDropdown');
    
    // Toggle subtitle dropdown
    subtitleBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        subtitleDropdown.classList.toggle('show');
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', function() {
        subtitleDropdown.classList.remove('show');
    });
    
    // Prevent dropdown close when clicking inside
    subtitleDropdown.addEventListener('click', function(e) {
        e.stopPropagation();
    });
}

// Populate subtitle options with REAL data from API sources
function populateSubtitleOptions(availableLanguages) {
    const subtitleOptionsList = document.getElementById('subtitleOptionsList');
    
    // Use REAL subtitle data from currentSources if available
    if (currentSources && currentSources.captions && currentSources.captions.length > 0) {
        const optionsHTML = currentSources.captions.map(cap => `
            <div class="subtitle-option ${currentSubtitleLanguage === cap.lan ? 'active' : ''}" 
                 data-lang="${cap.lan}" 
                 onclick="selectSubtitle('${cap.lan.replace(/'/g, "\\'")}')">
                <i class="fas fa-closed-captioning"></i>
                ${cap.lanName || cap.lan}
            </div>
        `).join('');
        
        subtitleOptionsList.innerHTML = optionsHTML;
        return;
    }
    
    // Fallback to availableLanguages if no currentSources
    if (!availableLanguages || availableLanguages.length === 0) {
        subtitleOptionsList.innerHTML = `
            <div class="subtitle-option" style="color: var(--gray);">
                <i class="fas fa-info-circle"></i>
                No subtitles available
            </div>
        `;
        return;
    }
    
    const optionsHTML = availableLanguages.map(lang => `
        <div class="subtitle-option ${currentSubtitleLanguage === lang ? 'active' : ''}" 
             data-lang="${lang}" 
             onclick="selectSubtitle('${lang.replace(/'/g, "\\'")}')">
            <i class="fas fa-closed-captioning"></i>
            ${lang}
        </div>
    `).join('');
    
    subtitleOptionsList.innerHTML = optionsHTML;
}

// Select subtitle language
function setPlaybackSpeed(speed) {
    const videoPlayer = document.getElementById('videoPlayer');
    videoPlayer.playbackRate = speed;
    document.getElementById('speedLabel').textContent = speed === 1 ? '1x' : speed + 'x';
    
    const options = document.querySelectorAll('.speed-option');
    options.forEach(opt => {
        opt.classList.toggle('active', parseFloat(opt.dataset.speed) === speed);
    });
    
    document.getElementById('speedDropdown').classList.remove('show');
    
    const speedBtn = document.getElementById('speedBtn');
    speedBtn.style.color = speed !== 1 ? '#e50914' : '';
}

function selectSubtitle(language) {
    const subtitleBtn = document.getElementById('subtitleBtn');
    
    currentSubtitleLanguage = language;
    
    // Update UI
    document.querySelectorAll('.subtitle-option').forEach(option => {
        option.classList.remove('active');
        if (option.getAttribute('data-lang') === language) {
            option.classList.add('active');
        }
    });
    
    // Update button state
    if (language === 'off') {
        subtitleBtn.classList.remove('active');
        subtitleBtn.innerHTML = '<i class="fas fa-closed-captioning"></i>';
        subtitleBtn.title = 'Subtitles Off';
    } else {
        subtitleBtn.classList.add('active');
        subtitleBtn.innerHTML = `<i class="fas fa-closed-captioning"></i>`;
        subtitleBtn.title = `Subtitles: ${language}`;
    }
    
        // Close dropdown
    document.getElementById('subtitleDropdown').classList.remove('show');
    
    console.log(`[TARGET] Subtitle selected: ${language}`);
    showQuickMessage(`Subtitles: ${language === 'off' ? 'Off' : language}`, 'success');
    
    // Load the actual subtitle file
    loadSubtitleFile(language);
}

// Load and display REAL subtitle files from API sources
async function loadSubtitleFile(language) {
    const videoPlayer = document.getElementById('videoPlayer');
    
    // Remove existing subtitle tracks
    const existingTracks = videoPlayer.querySelectorAll('track');
    existingTracks.forEach(track => track.remove());
    
    if (language === 'off') {
        console.log('[TARGET] Subtitles turned off');
        showQuickMessage('Subtitles: Off', 'info');
        return;
    }
    
    try {
        console.log(`[TARGET] Loading REAL subtitles for: ${language}`);
        
        // Get the actual subtitle URL from currentSources
        const subtitleInfo = findSubtitleUrl(language);
        
        if (!subtitleInfo || !subtitleInfo.url) {
            console.warn(`[ERROR] No subtitle URL found for: ${language}`);
            showQuickMessage(`No ${language} subtitles available`, 'warning');
            return;
        }
        
        console.log('[TARGET] Subtitle URL:', subtitleInfo.url);
        
        // Proxy subtitle URL through backend to avoid CORS issues
        const proxyUrl = `/api/proxy-subtitle?url=${encodeURIComponent(subtitleInfo.url)}`;
        console.log('[TARGET] Proxied subtitle URL:', proxyUrl);
        
        const track = document.createElement('track');
        track.kind = 'subtitles';
        track.label = subtitleInfo.lanName || language;
        track.srclang = getLanguageCode(language);
        track.src = proxyUrl;
        track.default = true;
        
        videoPlayer.appendChild(track);
        
        // Wait for track to load and enable it
        track.addEventListener('load', function() {
            console.log(`[SUCCESS] Subtitles loaded for: ${language}`);
            const textTrack = this.track;
            if (textTrack) {
                textTrack.mode = 'showing';
                showQuickMessage(`Subtitles: ${subtitleInfo.lanName || language}`, 'success');
            }
        });
        
        track.addEventListener('error', function() {
            console.error(`[ERROR] Failed to load subtitles for: ${language}`);
            showQuickMessage(`Could not load ${language} subtitles`, 'error');
        });
        
    } catch (error) {
        console.error('[ERROR] Error loading subtitle file:', error);
        showQuickMessage(`Error loading ${language} subtitles`, 'error');
    }
}

// Find subtitle URL from currentSources for the selected language
function findSubtitleUrl(language) {
    if (!currentSources || !currentSources.captions) {
        console.warn('[ERROR] No captions data in currentSources');
        return null;
    }
    
    // Try exact match first
    let subtitle = currentSources.captions.find(cap => 
        cap.lan === language || cap.lanName === language
    );
    
    // If not found, try case-insensitive match
    if (!subtitle) {
        subtitle = currentSources.captions.find(cap => 
            cap.lan.toLowerCase() === language.toLowerCase() || 
            cap.lanName.toLowerCase() === language.toLowerCase()
        );
    }
    
    // If still not found, try partial match
    if (!subtitle) {
        subtitle = currentSources.captions.find(cap => 
            cap.lanName.toLowerCase().includes(language.toLowerCase()) ||
            language.toLowerCase().includes(cap.lanName.toLowerCase())
        );
    }
    
    return subtitle;
}


// Enhanced language code mapping
function getLanguageCode(language) {
    const languageMap = {
        // English variants
        'english': 'en', 'en': 'en', 'eng': 'en',
        // Spanish variants
        'spanish': 'es', 'es': 'es', 'español': 'es', 'esp': 'es',
        // French variants
        'french': 'fr', 'fr': 'fr', 'français': 'fr', 'fra': 'fr',
        // Arabic variants
        'arabic': 'ar', 'ar': 'ar', 'اَلْعَرَبِيَّةُ': 'ar', 'ara': 'ar',
        // Russian variants
        'russian': 'ru', 'ru': 'ru', 'русский': 'ru', 'rus': 'ru',
        // Chinese variants
        'chinese': 'zh', 'zh': 'zh', '中文': 'zh', 'chi': 'zh',
        // Portuguese variants
        'portuguese': 'pt', 'pt': 'pt', 'português': 'pt', 'por': 'pt',
        // German variants
        'german': 'de', 'de': 'de', 'deutsch': 'de', 'ger': 'de',
        // Japanese variants
        'japanese': 'ja', 'ja': 'ja', '日本語': 'ja', 'jpn': 'ja',
        // Korean variants
        'korean': 'ko', 'ko': 'ko', '한국어': 'ko', 'kor': 'ko',
        // Hindi variants
        'hindi': 'hi', 'hi': 'hi', 'हिन्दी': 'hi', 'hin': 'hi',
        // Turkish variants
        'turkish': 'tr', 'tr': 'tr', 'türkçe': 'tr', 'tur': 'tr',
        // Italian variants
        'italian': 'it', 'it': 'it', 'italiano': 'it', 'ita': 'it',
        // Vietnamese variants
        'vietnamese': 'vi', 'vi': 'vi', 'tiếng việt': 'vi', 'vie': 'vi',
        // Thai variants
        'thai': 'th', 'th': 'th', 'ภาษาไทย': 'th', 'tha': 'th',
        // Indonesian variants
        'indonesian': 'id', 'id': 'id', 'in_id': 'id', 'ind': 'id',
        // Malay variants
        'malay': 'ms', 'ms': 'ms', 'msa': 'ms',
        // Filipino variants
        'filipino': 'fil', 'fil': 'fil', 'tl': 'fil',
        // Swahili variants
        'swahili': 'sw', 'sw': 'sw', 'kiswahili': 'sw', 'swa': 'sw',
        // Bengali variants
        'bengali': 'bn', 'bn': 'bn', 'বাংলা': 'bn', 'ben': 'bn',
        // Punjabi variants
        'punjabi': 'pa', 'pa': 'pa', 'ਪੰਜਾਬੀ': 'pa', 'pan': 'pa',
        // Urdu variants
        'urdu': 'ur', 'ur': 'ur', 'اُردُو': 'ur', 'urd': 'ur',
        // Hausa variants
        'hausa': 'ha', 'ha': 'ha', 'هَرْشٜن هَوْس': 'ha', 'hau': 'ha'
    };
    
    // Clean the language string and try multiple matches
    const cleanLang = language.toLowerCase().trim();
    
    // Direct match
    if (languageMap[cleanLang]) {
        return languageMap[cleanLang];
    }
    
    // Try matching by key contains
    for (const [key, code] of Object.entries(languageMap)) {
        if (cleanLang.includes(key) || key.includes(cleanLang)) {
            return code;
        }
    }
    
    // Return the first 2 characters as fallback
    return cleanLang.substring(0, 2);
}

    // Quick message function for subtitle notifications
function showQuickMessage(message, type = 'info') {
    const messageEl = document.createElement('div');
    messageEl.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'error' ? 'var(--error)' : type === 'success' ? 'var(--primary)' : 'var(--card-bg)'};
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        z-index: 9999;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        font-weight: 600;
        border-left: 4px solid ${type === 'error' ? 'var(--error)' : 'var(--primary)'};
        max-width: 300px;
        word-wrap: break-word;
    `;
    messageEl.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
            <i class="fas ${type === 'error' ? 'fa-exclamation-triangle' : type === 'success' ? 'fa-check-circle' : 'fa-info-circle'}"></i>
            <div>${message}</div>
        </div>
    `;
    
    document.body.appendChild(messageEl);
    
    // Auto remove after 3 seconds
    setTimeout(() => {
        if (messageEl.parentElement) {
            messageEl.parentElement.removeChild(messageEl);
        }
    }, 3000);
}

