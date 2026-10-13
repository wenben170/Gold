/**
 * Live YouTube Monitor
 * ----------------------------------------------------------------------------
 * Vanilla JS dashboard that shows 8 YouTube videos across 2 pages (2 x 2 grid).
 *
 * - Videos are embedded with YouTube's official iframe embed URL.
 * - YouTube's official IFrame API (loaded from youtube.com) is used only to
 *   read real player events (ready / state change / error) and to mute/unmute.
 * - Nothing is downloaded, proxied or scraped, and no restriction is bypassed.
 */
(() => {
    'use strict';

    /* ======================================================================
       Configuration
       ====================================================================== */

    /** All video slots, in display order. */
    const videos = [
    { id: '3H4IVQejlDE', title: 'YouTube Monitor 01' },
    { id: '-ps7V40GrA4', title: 'YouTube Monitor 02' },
    { id: '6OGkxoouYD4', title: 'YouTube Monitor 03' },
    { id: 'QjPymAueOY8', title: 'YouTube Monitor 04' },
    { id: 'Cf9klXhb0G8', title: 'YouTube Monitor 05' },
    { id: 'C3eAZB9tHC8', title: 'YouTube Monitor 06' },
    { id: 'T5QkPj4dEZk', title: 'YouTube Monitor 07' },
    { id: 'eb2W1kfRbXE', title: 'YouTube Monitor 08' }
    ];

    const VIDEOS_PER_PAGE = 4;
    const TOTAL_PAGES = Math.ceil(videos.length / VIDEOS_PER_PAGE);

    /** How long to wait for autoplay before showing the "click to start" hint. */
    const AUTOPLAY_HINT_DELAY_MS = 6000;
    /** How long to wait for the player to report back before status becomes UNKNOWN. */
    const READY_TIMEOUT_MS = 15000;

    const IFRAME_ALLOW =
        'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';

    /** Status keys mapped to the label shown on the card. */
    const STATUS_LABELS = {
        loading: 'LOADING',
        embedded: 'EMBEDDED',
        playing: 'PLAYING',
        paused: 'PAUSED',
        ended: 'ENDED',
        unavailable: 'UNAVAILABLE',
        unknown: 'UNKNOWN'
    };

    /** Tooltip text that explains exactly what each status means. */
    const STATUS_HINTS = {
        loading: 'Waiting for the YouTube player to load.',
        embedded: 'The embedded player loaded. This does not mean the video is a live stream.',
        playing: 'The player reports that the video is playing.',
        paused: 'The player reports that the video is paused.',
        ended: 'The player reports that the video has ended.',
        unavailable: 'YouTube reported that this video cannot be played in an embedded player.',
        unknown: 'The player did not report its state, so the status cannot be determined.'
    };

    /** Explanations for the error codes documented for the YouTube IFrame API. */
    const ERROR_DETAILS = {
        2: 'The video ID is invalid.',
        5: 'The player hit an HTML5 playback error.',
        100: 'The video was not found, was removed, or is private.',
        101: 'The video owner does not allow it to be embedded.',
        150: 'The video owner does not allow it to be embedded.',
        // Error 153 means YouTube received no referrer from the embedding page.
        // This is typical when the page is opened from disk (file://) and says
        // nothing about the video itself.
        153: 'YouTube received no referrer from this page. This usually happens when the dashboard is opened as a local file (file://) rather than from http(s). The video itself may be fine.'
    };

    /* ======================================================================
       State and DOM references
       ====================================================================== */

    const dom = {
        pages: document.getElementById('video-pages'),
        prevBtn: document.getElementById('prev-btn'),
        nextBtn: document.getElementById('next-btn'),
        pageButtons: document.getElementById('page-buttons'),
        indicator: document.getElementById('page-indicator'),
        sourceCount: document.getElementById('source-count')
    };

    /** Card objects, indexed like the `videos` array. */
    const cards = [];
    /** One grid element per page, indexed by page number. */
    const pageGrids = [];
    /** Pages whose players have been created already. */
    const pageMounted = new Array(TOTAL_PAGES).fill(false);
    const pageButtonEls = [];

    let currentPage = 0;

    /* ======================================================================
       Small helpers
       ====================================================================== */

    /**
     * Create an element.
     * @param {string} tag
     * @param {Object<string, string|boolean|null>} [attrs] - "class" and "text" are handled specially.
     * @param {Array<Node>} [children]
     */
    function h(tag, attrs = {}, children = []) {
        const node = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs)) {
            if (value === false || value === null || value === undefined) continue;
            if (key === 'class') node.className = value;
            else if (key === 'text') node.textContent = value;
            else node.setAttribute(key, value === true ? '' : value);
        }
        children.forEach((child) => node.appendChild(child));
        return node;
    }

    const watchUrl = (id) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;

    /** Builds the official embed URL (never the /watch?v= URL). */
    function embedUrl(id) {
        const params = new URLSearchParams({
            autoplay: '1',      // attempt autoplay (browsers may still block it)
            mute: '1',          // muted autoplay is the only kind browsers usually allow
            playsinline: '1',
            rel: '0',
            modestbranding: '1',
            enablejsapi: '1'    // lets the IFrame API report real player events
        });
        return `https://www.youtube.com/embed/${encodeURIComponent(id)}?${params.toString()}`;
    }

    const pageOfIndex = (index) => Math.floor(index / VIDEOS_PER_PAGE);

    /** Run a player call without letting a failing API call break the dashboard. */
    function safely(fn) {
        try {
            return fn();
        } catch (error) {
            return undefined;
        }
    }

    function fullscreenElement() {
        return document.fullscreenElement || document.webkitFullscreenElement || null;
    }

    /* ======================================================================
       YouTube IFrame API loader (official script, loaded once)
       ====================================================================== */

    let apiPromise = null;

    function loadYouTubeApi() {
        if (apiPromise) return apiPromise;

        apiPromise = new Promise((resolve, reject) => {
            if (window.YT && window.YT.Player) {
                resolve(window.YT);
                return;
            }

            const previousHandler = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = () => {
                if (typeof previousHandler === 'function') previousHandler();
                resolve(window.YT);
            };

            const script = document.createElement('script');
            script.src = 'https://www.youtube.com/iframe_api';
            script.async = true;
            script.onerror = () => reject(new Error('YouTube IFrame API failed to load.'));
            document.head.appendChild(script);
        });

        return apiPromise;
    }

    /* ======================================================================
       Card creation
       ====================================================================== */

    function createCard(index) {
        const video = videos[index];
        const number = String(index + 1).padStart(2, '0');

        const statusLabel = h('span', { class: 'status-label' });
        const statusEl = h('span', { class: 'status' }, [
            h('span', { class: 'status-dot', 'aria-hidden': 'true' }),
            statusLabel
        ]);

        const notice = h('div', { class: 'notice', hidden: true, role: 'status' });

        const errorDetail = h('p', { class: 'error-detail' });
        const errorLink = h('a', {
            class: 'btn',
            href: watchUrl(video.id),
            target: '_blank',
            rel: 'noopener noreferrer',
            text: 'Open on YouTube'
        });
        const errorOverlay = h('div', { class: 'error-overlay', hidden: true, role: 'alert' }, [
            h('h3', { text: 'Video unavailable' }),
            h('p', { text: 'This YouTube video cannot currently be embedded.' }),
            errorDetail,
            errorLink
        ]);

        const stage = h('div', { class: 'stage' }, [notice, errorOverlay]);

        const openLink = h('a', {
            class: 'btn btn-small',
            href: watchUrl(video.id),
            target: '_blank',
            rel: 'noopener noreferrer',
            'aria-label': `Open ${video.title} on YouTube (new tab)`,
            text: 'Open YouTube'
        });
        const refreshBtn = h('button', {
            class: 'btn btn-small',
            type: 'button',
            'aria-label': `Refresh ${video.title}`,
            text: 'Refresh'
        });
        const muteBtn = h('button', {
            class: 'btn btn-small',
            type: 'button',
            'aria-pressed': 'true',
            'aria-label': `Unmute ${video.title}`,
            disabled: true,
            title: 'Available once the player is ready',
            text: 'Unmute'
        });
        const fullscreenBtn = h('button', {
            class: 'btn btn-small',
            type: 'button',
            'aria-label': `Fullscreen ${video.title}`,
            text: 'Fullscreen'
        });

        const root = h('article', { class: 'card', 'data-status': 'loading', 'aria-label': video.title }, [
            h('div', { class: 'card-head' }, [
                h('div', { class: 'card-heading' }, [
                    h('span', { class: 'card-number', 'aria-hidden': 'true', text: number }),
                    h('h2', { class: 'card-title', text: video.title })
                ]),
                statusEl
            ]),
            stage,
            h('div', { class: 'card-actions' }, [openLink, refreshBtn, muteBtn, fullscreenBtn])
        ]);

        const card = {
            index,
            video,
            root,
            stage,
            statusEl,
            statusLabel,
            notice,
            errorOverlay,
            errorDetail,
            muteBtn,
            fullscreenBtn,
            iframe: null,
            player: null,
            status: 'loading',
            wasPlaying: false,
            iframeLoaded: false,
            apiFailed: false,
            loadToken: 0,
            timers: { ready: null, hint: null }
        };

        refreshBtn.addEventListener('click', () => mountPlayer(card));
        muteBtn.addEventListener('click', () => toggleMute(card));
        fullscreenBtn.addEventListener('click', () => toggleFullscreen(card));

        if (!(document.fullscreenEnabled || document.webkitFullscreenEnabled)) {
            fullscreenBtn.disabled = true;
            fullscreenBtn.title = 'Fullscreen is not supported in this browser';
        }

        setStatus(card, 'loading');
        return card;
    }

    /* ======================================================================
       Card state helpers
       ====================================================================== */

    function setStatus(card, key) {
        card.status = key;
        card.root.dataset.status = key;
        card.statusLabel.textContent = STATUS_LABELS[key];
        card.statusEl.title = STATUS_HINTS[key];
    }

    function setNotice(card, message) {
        if (message) {
            card.notice.textContent = message;
            card.notice.hidden = false;
        } else {
            card.notice.hidden = true;
        }
    }

    function clearTimers(card) {
        clearTimeout(card.timers.ready);
        clearTimeout(card.timers.hint);
        card.timers.ready = null;
        card.timers.hint = null;
    }

    function syncMuteButton(card) {
        const muted = safely(() => card.player.isMuted());
        if (typeof muted !== 'boolean') return;
        card.muteBtn.textContent = muted ? 'Unmute' : 'Mute';
        card.muteBtn.setAttribute('aria-pressed', String(muted));
        card.muteBtn.setAttribute('aria-label', `${muted ? 'Unmute' : 'Mute'} ${card.video.title}`);
    }

    function markUnavailable(card, errorCode) {
        clearTimers(card);
        setStatus(card, 'unavailable');
        setNotice(card, null);
        const detail = ERROR_DETAILS[errorCode] || 'The player reported an error.';
        card.errorDetail.textContent = `${detail} (error code ${errorCode})`;
        card.errorOverlay.hidden = false;
        card.muteBtn.disabled = true;
    }

    function markUnknown(card) {
        if (card.status !== 'loading') return;
        setStatus(card, 'unknown');
        setNotice(card, 'Player status unknown. If the video does not start, click the player or use Refresh.');
    }

    /* ======================================================================
       Player lifecycle
       ====================================================================== */

    /**
     * Create (or re-create) the iframe for a card.
     * Called once per card the first time its page is shown, and again only when
     * the user presses Refresh.
     */
    function mountPlayer(card) {
        clearTimers(card);
        card.loadToken += 1;
        const token = card.loadToken;

        if (card.iframe) {
            card.iframe.remove();
            card.iframe = null;
        }
        card.player = null;
        card.iframeLoaded = false;
        card.apiFailed = false;
        card.wasPlaying = false;

        card.errorOverlay.hidden = true;
        setNotice(card, null);
        setStatus(card, 'loading');
        card.muteBtn.disabled = true;
        card.muteBtn.title = 'Available once the player is ready';
        card.muteBtn.textContent = 'Unmute';
        card.muteBtn.setAttribute('aria-pressed', 'true');

        const iframe = h('iframe', {
            class: 'player-frame',
            id: `yt-player-${card.index + 1}`,
            src: embedUrl(card.video.id),
            title: `${card.video.title} - YouTube video player`,
            frameborder: '0',
            allow: IFRAME_ALLOW,
            referrerpolicy: 'strict-origin-when-cross-origin',
            allowfullscreen: true
        });
        card.iframe = iframe;

        iframe.addEventListener('load', () => onIframeLoad(card, token));
        card.stage.prepend(iframe);

        // Attach the official API to this iframe so we receive real player events.
        loadYouTubeApi()
            .then((YT) => {
                if (card.loadToken !== token) return;
                card.player = new YT.Player(iframe, {
                    events: {
                        onReady: () => onPlayerReady(card, token),
                        onStateChange: (event) => onPlayerStateChange(card, token, event),
                        onError: (event) => onPlayerError(card, token, event)
                    }
                });
            })
            .catch(() => {
                if (card.loadToken !== token) return;
                card.apiFailed = true;
                if (card.iframeLoaded) markUnknown(card);
            });
    }

    /** The iframe document finished loading (this alone says nothing about playback). */
    function onIframeLoad(card, token) {
        if (card.loadToken !== token) return;
        card.iframeLoaded = true;

        if (card.apiFailed) {
            markUnknown(card);
            return;
        }
        card.timers.ready = setTimeout(() => {
            if (card.loadToken === token) markUnknown(card);
        }, READY_TIMEOUT_MS);
    }

    function onPlayerReady(card, token) {
        if (card.loadToken !== token) return;
        clearTimeout(card.timers.ready);

        if (card.status === 'loading' || card.status === 'unknown') {
            setStatus(card, 'embedded');
            setNotice(card, null);
        }
        card.muteBtn.disabled = false;
        card.muteBtn.title = '';
        syncMuteButton(card);

        // If autoplay is blocked, tell the user how to start the video.
        clearTimeout(card.timers.hint);
        card.timers.hint = setTimeout(() => {
            if (card.loadToken !== token) return;
            const visible = pageOfIndex(card.index) === currentPage;
            if (visible && card.status === 'embedded') {
                setNotice(card, 'Click the player to start the video.');
            }
        }, AUTOPLAY_HINT_DELAY_MS);
    }

    function onPlayerStateChange(card, token, event) {
        if (card.loadToken !== token || card.status === 'unavailable') return;

        // Values documented for the IFrame API: -1 unstarted, 0 ended, 1 playing,
        // 2 paused, 3 buffering, 5 video cued.
        switch (event.data) {
            case 1:
                setStatus(card, 'playing');
                setNotice(card, null);
                break;
            case 2:
                setStatus(card, 'paused');
                break;
            case 0:
                setStatus(card, 'ended');
                break;
            case -1:
            case 5:
                if (card.status === 'loading' || card.status === 'unknown') setStatus(card, 'embedded');
                break;
            default:
                break; // buffering: keep the current status
        }
        syncMuteButton(card);
    }

    function onPlayerError(card, token, event) {
        if (card.loadToken !== token) return;
        markUnavailable(card, event.data);
    }

    /* ======================================================================
       Card controls
       ====================================================================== */

    function toggleMute(card) {
        const muted = safely(() => card.player.isMuted());
        if (typeof muted !== 'boolean') return;
        safely(() => (muted ? card.player.unMute() : card.player.mute()));
        syncMuteButton(card);
    }

    function toggleFullscreen(card) {
        if (fullscreenElement()) {
            const exit = document.exitFullscreen || document.webkitExitFullscreen;
            if (exit) safely(() => exit.call(document));
            return;
        }
        const request = card.stage.requestFullscreen || card.stage.webkitRequestFullscreen;
        if (!request) return;
        const result = safely(() => request.call(card.stage));
        if (result && typeof result.catch === 'function') {
            result.catch(() => {
                setNotice(card, 'Fullscreen was blocked by the browser.');
                setTimeout(() => setNotice(card, null), 3000);
            });
        }
    }

    function updateFullscreenButtons() {
        const active = fullscreenElement();
        cards.forEach((card) => {
            const isActive = active === card.stage;
            card.fullscreenBtn.textContent = isActive ? 'Exit fullscreen' : 'Fullscreen';
            card.fullscreenBtn.setAttribute(
                'aria-label',
                `${isActive ? 'Exit fullscreen for' : 'Fullscreen'} ${card.video.title}`
            );
        });
    }

    /* ======================================================================
       Pages and navigation
       ====================================================================== */

    function buildPages() {
        for (let page = 0; page < TOTAL_PAGES; page += 1) {
            const grid = h('section', {
                class: 'video-grid',
                'aria-label': `Page ${page + 1} of ${TOTAL_PAGES}`,
                hidden: page !== currentPage
            });

            const start = page * VIDEOS_PER_PAGE;
            const end = Math.min(start + VIDEOS_PER_PAGE, videos.length);
            for (let index = start; index < end; index += 1) {
                const card = createCard(index);
                cards[index] = card;
                grid.appendChild(card.root);
            }

            pageGrids[page] = grid;
            dom.pages.appendChild(grid);
        }
    }

    /** Create the players of a page the first time it becomes visible. */
    function ensurePageMounted(page) {
        if (pageMounted[page]) return;
        pageMounted[page] = true;
        cardsOfPage(page).forEach(mountPlayer);
    }

    function cardsOfPage(page) {
        return cards.slice(page * VIDEOS_PER_PAGE, (page + 1) * VIDEOS_PER_PAGE);
    }

    /**
     * Switch pages without rebuilding any iframes.
     * Videos on the page being left are paused (and resumed on return if they
     * were playing) so hidden players do not keep streaming in the background.
     */
    function showPage(requested) {
        const page = Math.min(Math.max(requested, 0), TOTAL_PAGES - 1);
        const previous = currentPage;

        if (page !== previous) {
            cardsOfPage(previous).forEach((card) => {
                card.wasPlaying = card.status === 'playing';
                if (card.wasPlaying) safely(() => card.player.pauseVideo());
                setNotice(card, null);
            });
        }

        currentPage = page;
        pageGrids.forEach((grid, index) => {
            grid.hidden = index !== page;
        });
        ensurePageMounted(page);

        if (page !== previous) {
            cardsOfPage(page).forEach((card) => {
                if (card.wasPlaying) safely(() => card.player.playVideo());
                card.wasPlaying = false;
            });
        }
        updateNavigation();
    }

    function updateNavigation() {
        dom.indicator.textContent = `PAGE ${currentPage + 1} / ${TOTAL_PAGES}`;
        dom.prevBtn.disabled = currentPage === 0;
        dom.nextBtn.disabled = currentPage === TOTAL_PAGES - 1;

        pageButtonEls.forEach((button, index) => {
            if (index === currentPage) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
        });
    }

    function buildNavigation() {
        for (let page = 0; page < TOTAL_PAGES; page += 1) {
            const button = h('button', {
                class: 'btn',
                type: 'button',
                'aria-label': `Go to page ${page + 1}`,
                text: `Page ${page + 1}`
            });
            button.addEventListener('click', () => showPage(page));
            pageButtonEls.push(button);
            dom.pageButtons.appendChild(button);
        }

        dom.prevBtn.addEventListener('click', () => showPage(currentPage - 1));
        dom.nextBtn.addEventListener('click', () => showPage(currentPage + 1));
    }

    function onKeyDown(event) {
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
        if (fullscreenElement()) return; // keep keys free while a video is fullscreen

        const target = event.target;
        if (target instanceof HTMLElement && target.matches('input, textarea, select, [contenteditable="true"]')) {
            return;
        }

        if (event.key === 'ArrowLeft') {
            showPage(currentPage - 1);
        } else if (event.key === 'ArrowRight') {
            showPage(currentPage + 1);
        } else {
            const number = Number(event.key);
            if (Number.isInteger(number) && number >= 1 && number <= TOTAL_PAGES) {
                showPage(number - 1);
            }
        }
    }

    /* ======================================================================
       Start-up
       ====================================================================== */

    function init() {
        dom.sourceCount.textContent = String(videos.length);

        buildPages();
        buildNavigation();
        showPage(0);

        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('fullscreenchange', updateFullscreenButtons);
        document.addEventListener('webkitfullscreenchange', updateFullscreenButtons);
    }

    init();
})();
