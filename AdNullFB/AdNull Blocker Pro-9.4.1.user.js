// ==UserScript==
// @name         AdNull Blocker Pro
// @namespace    https://github.com/SysAdminDoc/AdNull
// @version      9.4.1
// @description  Professional ad blocker for Facebook. Auto-detect and block sponsored content with full control. Enhanced with batch blocking, reels skipper, speed presets, GitHub sync, and background tab support.
// @author       Matthew Parker
// @match        https://www.facebook.com/*
// @match        https://m.facebook.com/*
// @match        https://web.facebook.com/*
// @icon         https://www.facebook.com/favicon.ico
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @grant        GM_openInTab
// @grant        unsafeWindow
// @grant        window.close
// @run-at       document-start
// @connect      raw.githubusercontent.com
// @connect      api.github.com
// @license      MIT
// ==/UserScript==

// ══════════════════════════════════════════════════════════════════════════════
// VISIBILITY & FOCUS OVERRIDE - Using unsafeWindow for direct page context access
// This tricks Facebook into thinking the page is always visible and focused
// Critical for blocking popups/tabs to work without being in the foreground
// ══════════════════════════════════════════════════════════════════════════════
(function applyVisibilityOverride() {
    'use strict';

    // Use unsafeWindow to access the page's actual window object
    const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const pageDocument = pageWindow.document;

    // Prevent multiple applications
    if (pageWindow.__adnullVisibilityOverride) {
        console.log('[AdNull] Visibility override already applied');
        return;
    }
    pageWindow.__adnullVisibilityOverride = true;

    console.log('[AdNull] Applying visibility override via unsafeWindow...');

    // ═══════════════════════════════════════════════════════════════════════════
    // CAPTURE REAL VISIBILITY STATE (before spoofing)
    // ═══════════════════════════════════════════════════════════════════════════
    const extractGetter = (proto, prop) => {
        try {
            const descriptor = Object.getOwnPropertyDescriptor(proto, prop);
            return descriptor?.get ?? null;
        } catch (e) { return null; }
    };

    const realHiddenGetter = extractGetter(pageWindow.Document.prototype, 'hidden');
    const realVisibilityGetter = extractGetter(pageWindow.Document.prototype, 'visibilityState');
    const realHasFocus = pageDocument.hasFocus ? pageDocument.hasFocus.bind(pageDocument) : () => true;

    // Store real getters for internal use
    pageWindow.__adnullRealVisibility = {
        isHidden: () => realHiddenGetter ? !!realHiddenGetter.call(pageDocument) : false,
        getState: () => realVisibilityGetter ? String(realVisibilityGetter.call(pageDocument)) : 'visible',
        hasFocus: realHasFocus
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // SPOOF PAGE VISIBILITY API
    // ═══════════════════════════════════════════════════════════════════════════
    const spoofProps = ['hidden', 'webkitHidden', 'mozHidden', 'msHidden'];
    const spoofStateProps = ['visibilityState', 'webkitVisibilityState', 'mozVisibilityState', 'msVisibilityState'];

    // Override boolean hidden properties on prototype
    spoofProps.forEach(prop => {
        try {
            Object.defineProperty(pageWindow.Document.prototype, prop, {
                get: function() { return false; },
                configurable: true,
                enumerable: true
            });
        } catch (e) { console.log('[AdNull] Failed to spoof', prop, 'on prototype'); }

        try {
            Object.defineProperty(pageDocument, prop, {
                get: function() { return false; },
                configurable: true,
                enumerable: true
            });
        } catch (e) {}
    });

    // Override visibilityState properties
    spoofStateProps.forEach(prop => {
        try {
            Object.defineProperty(pageWindow.Document.prototype, prop, {
                get: function() { return 'visible'; },
                configurable: true,
                enumerable: true
            });
        } catch (e) { console.log('[AdNull] Failed to spoof', prop, 'on prototype'); }

        try {
            Object.defineProperty(pageDocument, prop, {
                get: function() { return 'visible'; },
                configurable: true,
                enumerable: true
            });
        } catch (e) {}
    });

    // Override hasFocus to always return true
    try {
        pageWindow.Document.prototype.hasFocus = function() { return true; };
        pageDocument.hasFocus = function() { return true; };
    } catch (e) {}

    console.log('[AdNull] ✓ Visibility API spoofed');

    // ═══════════════════════════════════════════════════════════════════════════
    // BLOCK VISIBILITY/LIFECYCLE EVENTS
    // ═══════════════════════════════════════════════════════════════════════════
    const blockEvent = (e) => {
        e.stopImmediatePropagation();
        e.stopPropagation();
        // Don't preventDefault - let browser handle normally, just block site handlers
    };

    const visibilityEvents = [
        'visibilitychange', 'webkitvisibilitychange', 'mozvisibilitychange', 'msvisibilitychange',
        'pagehide', 'pageshow', 'freeze', 'resume'
    ];

    visibilityEvents.forEach(type => {
        try { pageDocument.addEventListener(type, blockEvent, true); } catch (e) {}
        try { pageWindow.addEventListener(type, blockEvent, true); } catch (e) {}
    });

    console.log('[AdNull] ✓ Visibility events blocked');

    // ═══════════════════════════════════════════════════════════════════════════
    // BLOCK FOCUS/BLUR EVENTS
    // ═══════════════════════════════════════════════════════════════════════════
    const focusEvents = ['blur', 'focus', 'focusin', 'focusout'];

    focusEvents.forEach(type => {
        try { pageWindow.addEventListener(type, blockEvent, true); } catch (e) {}
        try { pageDocument.addEventListener(type, blockEvent, true); } catch (e) {}
    });

    console.log('[AdNull] ✓ Focus/blur events blocked');

    // ═══════════════════════════════════════════════════════════════════════════
    // PREVENT TIMER THROTTLING (Audio Context Trick)
    // ═══════════════════════════════════════════════════════════════════════════
    const preventThrottling = () => {
        try {
            const AudioContext = pageWindow.AudioContext || pageWindow.webkitAudioContext;
            if (AudioContext && !pageWindow.__adnullAudioCtx) {
                const ctx = new AudioContext();
                // Create a silent oscillator
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                gain.gain.value = 0.00001; // Nearly silent but not zero
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start();
                pageWindow.__adnullAudioCtx = ctx;
                console.log('[AdNull] ✓ Anti-throttling audio context created');
            }
        } catch (e) {
            console.log('[AdNull] Audio context failed:', e.message);
        }
    };

    // Run on user interaction (audio context requires gesture in some browsers)
    const initAudioOnGesture = () => {
        preventThrottling();
        // Also resume if suspended
        if (pageWindow.__adnullAudioCtx && pageWindow.__adnullAudioCtx.state === 'suspended') {
            pageWindow.__adnullAudioCtx.resume();
        }
    };

    ['click', 'keydown', 'touchstart', 'mousedown'].forEach(type => {
        try {
            pageDocument.addEventListener(type, initAudioOnGesture, { once: false, passive: true, capture: true });
        } catch (e) {}
    });

    // Also try immediately
    if (pageDocument.readyState !== 'loading') {
        preventThrottling();
    } else {
        pageDocument.addEventListener('DOMContentLoaded', preventThrottling, { once: true });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BYPASS requestAnimationFrame THROTTLING
    // ═══════════════════════════════════════════════════════════════════════════
    const originalRAF = pageWindow.requestAnimationFrame;
    const originalSetTimeout = pageWindow.setTimeout;

    if (originalRAF) {
        pageWindow.requestAnimationFrame = function(callback) {
            // Use real visibility check - if truly hidden, use setTimeout fallback
            if (pageWindow.__adnullRealVisibility && pageWindow.__adnullRealVisibility.isHidden()) {
                return originalSetTimeout.call(pageWindow, () => callback(performance.now()), 16);
            }
            return originalRAF.call(pageWindow, callback);
        };
        console.log('[AdNull] ✓ requestAnimationFrame throttle bypass installed');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // OVERRIDE document.activeElement
    // ═══════════════════════════════════════════════════════════════════════════
    try {
        const origActiveElement = Object.getOwnPropertyDescriptor(pageWindow.Document.prototype, 'activeElement');
        if (origActiveElement && origActiveElement.get) {
            const origGetter = origActiveElement.get;
            Object.defineProperty(pageWindow.Document.prototype, 'activeElement', {
                get: function() {
                    const real = origGetter.call(this);
                    return real || pageDocument.body || pageDocument.documentElement;
                },
                configurable: true
            });
        }
    } catch (e) {}

    // ═══════════════════════════════════════════════════════════════════════════
    // OVERRIDE window.onblur and window.onfocus setters
    // ═══════════════════════════════════════════════════════════════════════════
    try {
        // Nullify any onblur/onfocus handlers
        Object.defineProperty(pageWindow, 'onblur', {
            get: () => null,
            set: () => {},
            configurable: true
        });
        Object.defineProperty(pageWindow, 'onfocus', {
            get: () => null,
            set: () => {},
            configurable: true
        });
    } catch (e) {}

    console.log('[AdNull] ═══════════════════════════════════════════════════════');
    console.log('[AdNull] ✓ VISIBILITY OVERRIDE COMPLETE');
    console.log('[AdNull]   • document.hidden = false');
    console.log('[AdNull]   • document.visibilityState = "visible"');
    console.log('[AdNull]   • document.hasFocus() = true');
    console.log('[AdNull]   • Visibility/focus events blocked');
    console.log('[AdNull]   • Background tabs will now work properly');
    console.log('[AdNull] ═══════════════════════════════════════════════════════');
})();

// ══════════════════════════════════════════════════════════════════════════════
// MAIN ADNULL SCRIPT
// ══════════════════════════════════════════════════════════════════════════════
(function() {
    'use strict';

    const VERSION = '9.4.1';
    console.log('[AdNull] Content script v' + VERSION, '| URL:', location.href.substring(0, 50));

    // ══════════════════════════════════════════════════════════════════════
    // SPEED PRESETS
    // ══════════════════════════════════════════════════════════════════════
    const SPEED_PRESETS = {
        careful: {
            name: 'Careful', icon: '🐢',
            blockDelay: 1500, pageLoadWait: 2000, clickDelay: 600, tabCloseDelay: 500
        },
        normal: {
            name: 'Normal', icon: '🚶',
            blockDelay: 600, pageLoadWait: 1000, clickDelay: 300, tabCloseDelay: 150
        },
        fast: {
            name: 'Fast', icon: '🏃',
            blockDelay: 300, pageLoadWait: 700, clickDelay: 200, tabCloseDelay: 80
        },
        turbo: {
            name: 'Turbo', icon: '🚀',
            blockDelay: 150, pageLoadWait: 500, clickDelay: 100, tabCloseDelay: 50
        }
    };

    // ══════════════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ══════════════════════════════════════════════════════════════════════
    const DEFAULT_CONFIG = {
        // Blocking Timing
        blockDelay: 600,
        pageLoadWait: 1000,
        clickDelay: 300,
        tabCloseDelay: 150,
        blockTimeout: 30000,

        // Scanning
        scanInterval: 2000,
        autoStart: true,

        // Scrolling (Feed)
        scrollEnabled: true,
        scrollAmount: 800,
        scrollDelay: 2500,

        // Reels Auto-Skipper
        reelsSkipperEnabled: false,
        reelsSkipSpeed: 2000,
        reelsSkipMethod: 'button',
        neverPauseSkipper: false,  // Never pause skipper for batch blocking
        parallelScanning: false,   // Keep scanning while blocking

        // Batch Mode for Reels
        reelsBatchMode: true,
        reelsBatchSize: 10,

        // Features
        skipSponsoredReels: true,
        showManualBlockButtons: true,
        showNotifications: true,
        autoImportFoundation: true,

        // UI
        dashboardPosition: { top: 80, right: 20 },

        // Foundation
        foundationUrl: 'https://raw.githubusercontent.com/SysAdminDoc/AdNull/refs/heads/main/Blocklists/facebook_master_blocklist.csv',

        // GitHub Sync
        githubSyncEnabled: false,
        githubToken: '',
        githubRepo: '',
        githubPath: '',
        githubBranch: 'main',

        // Timing (popup)
        tabOpenDelay: 1500,
        pollInterval: 100,
        maxPolls: 80
    };

    // ══════════════════════════════════════════════════════════════════════
    // STATE
    // ══════════════════════════════════════════════════════════════════════
    let state = {
        config: { ...DEFAULT_CONFIG },
        speedPreset: 'normal',
        masterLog: [],
        masterLogIndex: {},
        blockedSponsors: new Set(),
        whitelist: [],
        whitelistIndex: new Set(),
        totalBlocked: 0,
        foundationImported: false,
        isRunning: false,
        isPaused: false,
        isBlocking: false,
        blockQueue: [],
        sessionDetected: 0,
        sessionBlocked: 0,
        failedCount: 0,
        dashboardReady: false,
        currentBlockItem: null,

        // Reels Skipper
        reelsSkipperActive: false,
        reelsSkipperWasActive: false,
        reelsBatchInProgress: false
    };

    let scannerInterval = null;
    let scrollerInterval = null;
    let reelsSkipperRunning = false;
    let lastScannedVideoId = null;

    // ══════════════════════════════════════════════════════════════════════
    // CHECK IF THIS IS A BLOCKING POPUP
    // ══════════════════════════════════════════════════════════════════════
    function isBlockingPopup() {
        return location.search.includes('__adnull_block=1') || sessionStorage.getItem('adnull_blocking_active') === '1';
    }

    function isProfilePage() {
        const path = location.pathname;
        if (/^\/(watch|reel|marketplace|groups|gaming|events|pages|ads|saved|home)/.test(path)) return false;
        return /\/(profile\.php|[^\/]+\/?$)/.test(path);
    }

    // ══════════════════════════════════════════════════════════════════════
    // STORAGE
    // ══════════════════════════════════════════════════════════════════════
    async function loadState() {
        try {
            const config = GM_getValue('config');
            if (config) state.config = { ...DEFAULT_CONFIG, ...JSON.parse(config) };

            const speedPreset = GM_getValue('speedPreset');
            if (speedPreset) state.speedPreset = speedPreset;

            const masterLog = GM_getValue('masterLog');
            if (masterLog) {
                state.masterLog = JSON.parse(masterLog);
                rebuildMasterLogIndex();
            }

            const blocked = GM_getValue('blocked');
            if (blocked) {
                const arr = JSON.parse(blocked);
                state.blockedSponsors = new Set(arr);
                state.totalBlocked = arr.length;
            }

            const whitelist = GM_getValue('whitelist');
            if (whitelist) {
                state.whitelist = JSON.parse(whitelist);
                state.whitelistIndex = new Set(state.whitelist.map(e => normalizeUrl(e.url)));
            }

            state.foundationImported = GM_getValue('foundationImported', false);

            const blockQueue = GM_getValue('blockQueue');
            if (blockQueue) state.blockQueue = JSON.parse(blockQueue);

            // Load skipper state for persistence across refreshes
            state.reelsSkipperActive = GM_getValue('skipperActive', false);

            // Count failed
            state.failedCount = state.masterLog.filter(e => e.status === 'failed').length;

            console.log('[AdNull] State loaded:', {
                blocked: state.totalBlocked,
                log: state.masterLog.length,
                queue: state.blockQueue.length,
                failed: state.failedCount,
                preset: state.speedPreset,
                skipperActive: state.reelsSkipperActive
            });
        } catch (e) {
            console.error('[AdNull] Load error:', e);
        }
    }

    function rebuildMasterLogIndex() {
        state.masterLogIndex = {};
        state.masterLog.forEach((entry, i) => {
            state.masterLogIndex[normalizeUrl(entry.url)] = i;
        });
    }

    function saveConfig() {
        GM_setValue('config', JSON.stringify(state.config));
        GM_setValue('speedPreset', state.speedPreset);
    }
    function saveBlocked() { GM_setValue('blocked', JSON.stringify(Array.from(state.blockedSponsors))); }
    function saveMasterLog() { GM_setValue('masterLog', JSON.stringify(state.masterLog)); }
    function saveWhitelist() { GM_setValue('whitelist', JSON.stringify(state.whitelist)); }
    function saveBlockQueue() { GM_setValue('blockQueue', JSON.stringify(state.blockQueue)); }
    function saveSkipperState(active) { GM_setValue('skipperActive', active); }

    // ══════════════════════════════════════════════════════════════════════
    // URL UTILITIES
    // ══════════════════════════════════════════════════════════════════════
    function normalizeUrl(url) {
        if (!url) return '';
        try {
            const u = new URL(url.startsWith('http') ? url : `https://www.facebook.com/${url}`);
            let path = u.pathname.replace(/\/+$/, '');
            if (path.includes('profile.php') && u.searchParams.has('id')) {
                return `profile.php?id=${u.searchParams.get('id')}`;
            }
            return path.replace(/^\//, '');
        } catch (e) {
            return url.toLowerCase().replace(/[^a-z0-9._-]/g, '');
        }
    }

    function isWhitelisted(url) {
        return state.whitelistIndex.has(normalizeUrl(url));
    }

    // ══════════════════════════════════════════════════════════════════════
    // UTILITIES
    // ══════════════════════════════════════════════════════════════════════
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function waitFor(fn, maxTries = 80, interval = 100) {
        return new Promise((resolve, reject) => {
            let tries = 0;
            const check = setInterval(() => {
                tries++;
                try {
                    const result = fn();
                    if (result) { clearInterval(check); resolve(result); }
                    else if (tries >= maxTries) { clearInterval(check); reject(new Error('Timeout')); }
                } catch (e) { clearInterval(check); reject(e); }
            }, interval);
        });
    }

    function isVisible(el) {
        if (!el) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    }

    // ══════════════════════════════════════════════════════════════════════
    // PAGE DETECTION
    // ══════════════════════════════════════════════════════════════════════
    function getPageType() {
        const path = location.pathname;
        if (path === '/' || path === '/home' || path === '/home.php') return 'feed';
        if (path.includes('/reel') || path.includes('/reels')) return 'reels';
        if (path.includes('/watch')) return 'watch';
        if (path.includes('/stories')) return 'stories';
        return 'other';
    }

    function getPageIcon() {
        const icons = { feed: '📰', reels: '🎬', watch: '📺', stories: '📖', other: '📄' };
        return icons[getPageType()] || '📄';
    }

    function getPageLabel() {
        const labels = { feed: 'Feed', reels: 'Reels', watch: 'Watch', stories: 'Stories', other: 'Page' };
        return labels[getPageType()] || 'Page';
    }

    function isScanablePage() {
        const type = getPageType();
        return type === 'feed' || type === 'reels' || type === 'watch';
    }

    // ══════════════════════════════════════════════════════════════════════
    // SPONSORED DETECTION (Enhanced with extension methods)
    // ══════════════════════════════════════════════════════════════════════
    function isSponsored(post) {
        // Method 1: Direct "Sponsored" text
        for (const span of post.querySelectorAll('span[dir="auto"]')) {
            const text = span.innerText?.trim();
            if (['Sponsored', 'Sponsorisé', 'Publicidad', 'Gesponsert', 'Sponsorlu', 'Sponsorizzato', 'Patrocinado'].includes(text)) {
                return { method: 'text' };
            }
        }

        // Method 2: Tracking parameters
        for (const link of post.querySelectorAll('a[href*="__cft__[0]="]')) {
            if (!link.href.includes('/groups/') && !link.href.includes('/events/')) {
                return { method: 'tracking' };
            }
        }

        // Method 3: Canvas with aria-labelledby
        const canvas = post.querySelector('a > span > span[aria-labelledby] > canvas');
        if (canvas) {
            const labelId = canvas.parentElement.getAttribute('aria-labelledby');
            if (labelId) {
                try {
                    const escapedId = labelId.replace(/(:)/g, '\\$1');
                    const label = document.querySelector(`[id="${escapedId}"]`);
                    if (label && /Sponsored|Sponsorisé|Publicidad|Gesponsert/i.test(label.innerText)) {
                        return { method: 'canvas' };
                    }
                } catch (e) {}
            }
        }

        // Method 4: aria-label
        for (const el of post.querySelectorAll('span[aria-label], a[aria-label], div[aria-label]')) {
            if (el.getAttribute('aria-label') === 'Sponsored') return { method: 'aria' };
        }

        if (post.querySelector('[aria-label="Sponsored"]')) return { method: 'aria_direct' };
        if (post.querySelector('a[href*="/ads/about"]') || post.querySelector('a[href*="/ads/preferences"]')) return { method: 'adlink' };

        return null;
    }

    function isReelSponsored(container) {
        const text = container.innerText || '';

        // Method 1: Direct "Sponsored" text
        if (/\bSponsored\b/i.test(text)) return { method: 'text' };

        // Method 2: External links with fbclid
        for (const link of container.querySelectorAll('a[href*="fbclid"]')) {
            try {
                const url = new URL(link.href);
                if (!url.hostname.includes('facebook.com') && !url.hostname.includes('fb.com')) {
                    return { method: 'external_fbclid' };
                }
            } catch (e) {}
        }

        // Method 3: rel="nofollow" links to external sites (NEW)
        for (const link of container.querySelectorAll('a[rel="nofollow"]')) {
            try {
                const url = new URL(link.href);
                if (!url.hostname.includes('facebook.com') && !url.hostname.includes('fb.com')) {
                    return { method: 'nofollow_external' };
                }
            } catch (e) {}
        }

        // Method 4: Profile link with tracking
        const profileLink = container.querySelector('a[aria-label="See Owner Profile"]');
        if (profileLink) {
            const target = profileLink.getAttribute('target') || '';
            const href = profileLink.getAttribute('href') || '';
            if (target === '_blank' && href.includes('__cft__')) return { method: 'profile_blank_tracking' };
        }

        // Method 5: CTA buttons to external sites
        const ctaPatterns = /^(learn more|shop now|sign up|get offer|buy now|install now|download|subscribe|get started|book now|order now|apply now|try now|watch more|see more details|get quote|contact us|visit site|see menu|request time|send message|call now|get directions|listen now|play now|use app|open link|view more)$/i;
        for (const link of container.querySelectorAll('a[href], a[role="link"]')) {
            const linkText = link.innerText?.trim();
            if (linkText && ctaPatterns.test(linkText)) {
                try {
                    const url = new URL(link.href);
                    if (!url.hostname.includes('facebook.com') && !url.hostname.includes('fb.com')) {
                        return { method: 'cta_external' };
                    }
                } catch (e) {}
            }
        }

        // Method 6: UTM parameters to external sites (NEW)
        for (const link of container.querySelectorAll('a[href*="utm_"]')) {
            if (link.href.includes('utm_source=fb') || link.href.includes('utm_medium=paid')) {
                try {
                    const url = new URL(link.href);
                    if (!url.hostname.includes('facebook.com') && !url.hostname.includes('fb.com')) {
                        return { method: 'utm_external' };
                    }
                } catch (e) {}
            }
        }

        // Method 7: Styled CTA buttons to external sites (NEW)
        for (const link of container.querySelectorAll('a[style*="background-color"]')) {
            try {
                const url = new URL(link.href);
                if (!url.hostname.includes('facebook.com') && !url.hostname.includes('fb.com')) {
                    return { method: 'styled_cta' };
                }
            } catch (e) {}
        }

        return null;
    }

    // ══════════════════════════════════════════════════════════════════════
    // DATA EXTRACTION
    // ══════════════════════════════════════════════════════════════════════
    function extractPostData(post) {
        const data = { author: 'Unknown', url: null, content: '', source: 'feed' };

        for (const link of post.querySelectorAll('h2 a, h3 a, h4 a, strong a')) {
            const href = link.href;
            if (!href || href.includes('/groups/') || href.includes('/events/') || href.includes('/ads/') ||
                href.includes('/watch/') || href.includes('/reel/') || href.includes('/photo/') ||
                href.includes('/video/') || href.includes('#')) continue;

            try {
                const url = new URL(href);
                const parts = url.pathname.split('/').filter(p => p);
                if (parts[0] === 'profile.php' && url.searchParams.has('id')) {
                    data.author = link.innerText?.trim() || 'Profile';
                    data.url = `https://www.facebook.com/profile.php?id=${url.searchParams.get('id')}`;
                    break;
                }
                if (/^[a-zA-Z0-9._-]+$/.test(parts[0]) &&
                    !['home', 'watch', 'marketplace', 'gaming', 'events', 'pages', 'groups', 'stories'].includes(parts[0])) {
                    data.author = link.innerText?.trim() || parts[0];
                    data.url = `https://www.facebook.com/${parts[0]}`;
                    break;
                }
            } catch (e) {}
        }

        const contentDiv = post.querySelector('div[dir="auto"]');
        if (contentDiv) data.content = contentDiv.innerText?.substring(0, 100).replace(/\n/g, ' ') || '';

        return data;
    }

    function extractReelData(container) {
        const data = { author: 'Unknown', url: null, content: '', source: 'reel' };

        const profileLink = container.querySelector('a[aria-label="See Owner Profile"]');
        if (profileLink) {
            const href = profileLink.href || profileLink.getAttribute('href') || '';
            try {
                const url = new URL(href.startsWith('http') ? href : 'https://www.facebook.com' + href);
                if (url.pathname.includes('profile.php') && url.searchParams.has('id')) {
                    data.url = `https://www.facebook.com/profile.php?id=${url.searchParams.get('id')}`;
                } else {
                    const parts = url.pathname.split('/').filter(p => p);
                    if (parts[0] && /^[a-zA-Z0-9._-]+$/.test(parts[0]) &&
                        !['profile.php', 'watch', 'reel', 'reels', 'groups'].includes(parts[0])) {
                        data.url = `https://www.facebook.com/${parts[0]}`;
                    }
                }
            } catch (e) {}
        }

        const nameEl = container.querySelector('h2 span') || container.querySelector('[aria-label="See Owner Profile"] + div span');
        if (nameEl) {
            const text = nameEl.innerText?.trim();
            if (text && text.length < 100) data.author = text.split('\n')[0];
        }

        const h2 = container.querySelector('h2');
        if (h2 && data.author === 'Unknown') {
            const text = h2.innerText?.trim();
            if (text && text.length < 100) data.author = text.split('\n')[0];
        }

        return data;
    }

    function extractAuthorFromPost(post) {
        const data = { name: 'Unknown', url: null };

        for (const link of post.querySelectorAll('h2 a, h3 a, h4 a, strong a')) {
            const href = link.href;
            if (href.includes('/groups/') || href.includes('/events/') || href.includes('/ads/') ||
                href.includes('/watch/') || href.includes('/reel/') || href.includes('/photo/') ||
                href.includes('/video/') || href.includes('#')) continue;

            try {
                const url = new URL(href);
                const parts = url.pathname.split('/').filter(p => p);
                if (parts.length >= 1) {
                    const username = parts[0];
                    if (/^[a-zA-Z0-9._-]+$/.test(username) &&
                        !['home', 'watch', 'marketplace', 'gaming', 'events', 'pages', 'groups'].includes(username)) {
                        data.name = link.innerText || username;
                        data.url = `https://www.facebook.com/${username}`;
                        break;
                    }
                    if (username === 'profile.php' && url.searchParams.has('id')) {
                        data.name = link.innerText || 'Profile';
                        data.url = `https://www.facebook.com/profile.php?id=${url.searchParams.get('id')}`;
                        break;
                    }
                }
            } catch(e) {}
        }

        return data;
    }

    function extractAuthorFromReel(reelContainer) {
        const data = { name: 'Unknown', url: null };

        const profileLink = reelContainer.querySelector('a[aria-label="See Owner Profile"]');
        if (!profileLink) return data;

        const href = profileLink.getAttribute('href') || '';

        try {
            const url = new URL(href.startsWith('http') ? href : 'https://www.facebook.com' + href);
            if (url.pathname.includes('profile.php') && url.searchParams.has('id')) {
                data.url = `https://www.facebook.com/profile.php?id=${url.searchParams.get('id')}`;
            } else {
                const pathParts = url.pathname.split('/').filter(p => p);
                if (pathParts.length >= 1) {
                    const pageName = pathParts[0];
                    if (/^[a-zA-Z0-9._-]+$/.test(pageName) &&
                        !['profile.php', 'watch', 'reel', 'reels', 'groups'].includes(pageName)) {
                        data.url = `https://www.facebook.com/${pageName}`;
                    }
                }
            }
        } catch(e) {}

        const h2 = reelContainer.querySelector('h2');
        if (h2) {
            const text = h2.innerText?.trim();
            if (text && text.length < 100) data.name = text.split('\n')[0];
        }

        if (data.name === 'Unknown' && data.url) {
            const parts = data.url.split('/');
            data.name = parts[parts.length - 1].split('?')[0];
        }

        return data;
    }

    // ══════════════════════════════════════════════════════════════════════
    // MASTER LOG
    // ══════════════════════════════════════════════════════════════════════
    function addToMasterLog(entry) {
        const normalized = normalizeUrl(entry.url);
        if (!normalized || state.masterLogIndex[normalized] !== undefined) return false;
        if (state.whitelistIndex.has(normalized)) return false;

        const logEntry = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            url: entry.url,
            author: entry.author || 'Unknown',
            source: entry.source || 'feed',
            detectedAt: new Date().toISOString(),
            timestamp: Date.now(),
            status: 'detected'
        };

        state.masterLog.unshift(logEntry);
        rebuildMasterLogIndex();
        saveMasterLog();
        return true;
    }

    function updateLogStatus(url, status, extra = {}) {
        const normalized = normalizeUrl(url);
        const idx = state.masterLogIndex[normalized];
        if (idx !== undefined && state.masterLog[idx]) {
            state.masterLog[idx].status = status;
            Object.assign(state.masterLog[idx], extra);
            saveMasterLog();

            // Update failed count
            state.failedCount = state.masterLog.filter(e => e.status === 'failed').length;
            return state.masterLog[idx];
        }
        return null;
    }

    function markAsBlocked(url) {
        const normalized = normalizeUrl(url);
        if (!normalized) return false;

        state.blockedSponsors.add(normalized);
        state.totalBlocked = state.blockedSponsors.size;

        updateLogStatus(url, 'blocked', { blockedAt: new Date().toISOString() });
        saveBlocked();
        return true;
    }

    function addToWhitelist(url, name) {
        const normalized = normalizeUrl(url);
        if (!normalized || state.whitelistIndex.has(normalized)) return false;
        state.whitelist.push({ url, name, addedAt: new Date().toISOString() });
        state.whitelistIndex.add(normalized);

        // Remove from queue
        const idx = state.blockQueue.findIndex(q => normalizeUrl(q.url) === normalized);
        if (idx >= 0) {
            state.blockQueue.splice(idx, 1);
            saveBlockQueue();
        }

        updateLogStatus(url, 'whitelisted');
        saveWhitelist();
        return true;
    }

    function removeFromWhitelist(url) {
        const normalized = normalizeUrl(url);
        state.whitelist = state.whitelist.filter(e => normalizeUrl(e.url) !== normalized);
        state.whitelistIndex.delete(normalized);
        saveWhitelist();
    }

    // ══════════════════════════════════════════════════════════════════════
    // BLOCKING LOGIC (POPUP WINDOW)
    // ══════════════════════════════════════════════════════════════════════
    function findProfileMenuButton() {
        const wanted = ["profile settings", "see more options", "more options"];
        for (const el of document.querySelectorAll('div[role="button"][aria-haspopup="menu"]')) {
            const label = (el.getAttribute("aria-label") || "").toLowerCase();
            if (wanted.some(w => label.includes(w))) return el;
        }
        return null;
    }

    function findBlockMenuItem() {
        for (const menu of document.querySelectorAll('div[role="menu"], div[role="listbox"]')) {
            for (const item of menu.querySelectorAll('[role="menuitem"], [role="option"]')) {
                if (/^block/i.test(item.textContent?.trim())) return item;
            }
        }
        return null;
    }

    function findBlockDialog() {
        for (const d of document.querySelectorAll('[role="dialog"]')) {
            if (isVisible(d) && /block/i.test(d.textContent)) return d;
        }
        return null;
    }

    function findButtonInDialog(dialog, label) {
        let btn = dialog.querySelector(`[role="button"][aria-label="${label}"]`);
        if (btn && isVisible(btn)) return btn;
        const el = Array.from(dialog.querySelectorAll('*')).find(e => e.textContent?.trim() === label);
        if (el) return el.closest('[role="button"]') || el;
        return null;
    }

    async function executeBlockSequence() {
        const clickDelay = state.config.clickDelay || 300;

        try {
            console.log('[AdNull] Looking for menu button...');
            const menuBtn = await waitFor(findProfileMenuButton, 300, 150); // Increased attempts
            if (!menuBtn) throw new Error('Menu button not found');

            // Ensure button is in viewport and click it
            menuBtn.scrollIntoView({ block: 'center' });
            await sleep(100);
            menuBtn.click();
            await sleep(clickDelay * 1.5);

            console.log('[AdNull] Looking for Block menu item...');
            const blockItem = await waitFor(findBlockMenuItem, 200, 150); // Increased attempts
            if (!blockItem) throw new Error('Block menu item not found');
            blockItem.click();
            await sleep(clickDelay * 1.5);

            console.log('[AdNull] Looking for Block dialog...');
            const dialog = await waitFor(findBlockDialog, 200, 150);
            if (!dialog) throw new Error('Block dialog not found');

            const confirmBtn = await waitFor(() => findButtonInDialog(dialog, 'Confirm'), 150, 150);
            if (!confirmBtn) throw new Error('Confirm button not found');
            confirmBtn.click();
            await sleep(clickDelay * 3);

            console.log('[AdNull] Looking for success dialog...');
            const successDialog = await waitFor(() => {
                for (const d of document.querySelectorAll('[role="dialog"]')) {
                    if (isVisible(d) && /you blocked|has been blocked|you've blocked/i.test(d.textContent)) return d;
                }
                return null;
            }, 150, 150);

            if (successDialog) {
                const closeBtn = await waitFor(() => findButtonInDialog(successDialog, 'Close'), 100, 100);
                if (closeBtn) closeBtn.click();
            }

            return true;
        } catch(e) {
            console.log('[AdNull] Block failed:', e.message);
            return false;
        }
    }

    function isPageUnavailable() {
        const pageText = document.body?.innerText || '';
        const patterns = [
            /this content isn't available/i,
            /this page isn't available/i,
            /this account has been disabled/i,
            /sorry, this content isn't available/i,
            /the link you followed may be broken/i,
            /page not found/i,
            /content not found/i
        ];

        for (const pattern of patterns) {
            if (pattern.test(pageText)) return true;
        }

        const goToFeed = document.querySelector('a[aria-label="Go to Feed"]');
        if (goToFeed && /go back|visit help center/i.test(pageText)) return true;

        return false;
    }

    async function runBlockingPopup() {
        sessionStorage.setItem('adnull_blocking_active', '1');

        // Check if this is a retry attempt
        const urlParams = new URLSearchParams(location.search);
        const isRetry = urlParams.has('__adnull_retry');
        const retryNum = parseInt(urlParams.get('__adnull_retry')) || 1;

        console.log('[AdNull] Running as blocking popup', isRetry ? `(retry #${retryNum})` : '');

        // Wait longer on retries to ensure page fully loads
        const waitTime = isRetry ? (state.config.pageLoadWait || 1500) * 2 : (state.config.pageLoadWait || 1500);
        await sleep(waitTime);

        // On retries, force a page re-render by scrolling
        if (isRetry) {
            console.log('[AdNull] Retry attempt - forcing page interaction...');
            window.scrollTo(0, 100);
            await sleep(300);
            window.scrollTo(0, 0);
            await sleep(500);
        }

        if (isPageUnavailable()) {
            console.log('[AdNull] Page unavailable - already blocked or deleted');

            const overlay = document.createElement('div');
            overlay.innerHTML = `<div style="position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:999999;
                display:flex;align-items:center;justify-content:center;">
                <div style="background:#1a1a2e;color:white;padding:40px;border-radius:20px;text-align:center;border:2px solid #4CAF50;">
                    <div style="font-size:50px;margin-bottom:20px;">✓</div>
                    <div style="font-size:20px;font-weight:bold;color:#4CAF50;">Already Blocked/Unavailable</div>
                    <div style="font-size:14px;color:#888;margin-top:10px;">Closing window...</div>
                </div></div>`;
            document.body.appendChild(overlay);

            GM_setValue('adnull_block_complete', Date.now());
            GM_setValue('adnull_block_result', 'already_blocked');

            await sleep(1000);
            tryCloseWindow();
            return;
        }

        const overlay = document.createElement('div');
        overlay.innerHTML = `<div style="position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:999999;
            display:flex;align-items:center;justify-content:center;">
            <div style="background:#1a1a2e;color:white;padding:40px;border-radius:20px;text-align:center;border:2px solid #fa3e3e;">
                <div style="font-size:50px;margin-bottom:20px;">🚫</div>
                <div id="block-status" style="font-size:20px;font-weight:bold;">Blocking${isRetry ? ' (retry ' + retryNum + ')' : ''}...</div>
                <div style="font-size:12px;color:#888;margin-top:10px;">Please wait</div>
            </div></div>`;
        document.body.appendChild(overlay);

        // Try up to 3 times within this tab if we fail
        let success = false;
        for (let attempt = 1; attempt <= 3 && !success; attempt++) {
            if (attempt > 1) {
                console.log(`[AdNull] Internal retry attempt ${attempt}...`);
                const statusEl = document.getElementById('block-status');
                if (statusEl) statusEl.textContent = `Retrying (${attempt}/3)...`;
                await sleep(1000);
            }
            success = await executeBlockSequence();
        }

        const statusEl = document.getElementById('block-status');
        if (statusEl) {
            statusEl.textContent = success ? '✓ BLOCKED!' : '✗ Failed';
            statusEl.style.color = success ? '#4CAF50' : '#fa3e3e';
        }

        GM_setValue('adnull_block_complete', Date.now());
        GM_setValue('adnull_block_result', success ? 'success' : 'failed');

        await sleep(state.config.tabCloseDelay || 500);
        tryCloseWindow();
    }

    function tryCloseWindow() {
        console.log('[AdNull] Attempting to close window...');
        try { window.close(); } catch(e) {}
        try { self.close(); } catch(e) {}

        setTimeout(() => {
            if (!window.closed) {
                document.body.innerHTML = `
                    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                        height:100vh;background:#111;color:#4CAF50;font-family:sans-serif;text-align:center;">
                        <div style="font-size:48px;margin-bottom:20px;">✓</div>
                        <div style="font-size:24px;margin-bottom:10px;">Complete</div>
                        <div style="color:#888;font-size:14px;">You can close this window</div>
                    </div>
                `;
            }
        }, 500);
    }

    async function processBlockQueue() {
        if (state.isBlocking || state.isPaused || state.blockQueue.length === 0) return;
        if (!state.isRunning && !state.reelsBatchInProgress) return;

        state.isBlocking = true;
        updateDashboard();

        while (state.blockQueue.length > 0 && (state.isRunning || state.reelsBatchInProgress) && !state.isPaused) {
            const sponsor = state.blockQueue[0];
            const normalized = normalizeUrl(sponsor.url);

            // Skip if already blocked or whitelisted
            if (state.blockedSponsors.has(normalized)) {
                state.blockQueue.shift();
                saveBlockQueue();
                continue;
            }
            if (isWhitelisted(sponsor.url)) {
                state.blockQueue.shift();
                updateLogStatus(sponsor.url, 'whitelisted');
                saveBlockQueue();
                continue;
            }

            sponsor.attempts = (sponsor.attempts || 0) + 1;
            state.currentBlockItem = sponsor;

            console.log(`[AdNull] Blocking: ${sponsor.author} - ${sponsor.url} (attempt ${sponsor.attempts})`);
            updateDashboardStatus(`🔄 Blocking: ${sponsor.author}... (${sponsor.attempts})`);
            updateLogStatus(sponsor.url, 'blocking');
            updateDashboard();

            GM_setValue('adnull_block_complete', 0);
            GM_setValue('adnull_block_result', '');

            // Add force_rescan flag on retry attempts
            let blockUrl = sponsor.url + (sponsor.url.includes('?') ? '&' : '?') + '__adnull_block=1';
            if (sponsor.attempts > 1) {
                blockUrl += '&__adnull_retry=' + sponsor.attempts + '&__adnull_ts=' + Date.now();
            }

            // Open tab as ACTIVE (focused) - one at a time
            console.log('[AdNull] Opening blocking tab (focused):', blockUrl);
            const tabRef = GM_openInTab(blockUrl, { active: true, setParent: true, insert: true });

            const startTime = Date.now();
            const startSignal = GM_getValue('adnull_block_complete', 0);
            let result = null;

            // Extended timeout for retries
            const timeout = sponsor.attempts > 1 ? state.config.blockTimeout * 1.5 : state.config.blockTimeout;

            while (Date.now() - startTime < timeout) {
                await sleep(500);

                const currentSignal = GM_getValue('adnull_block_complete', 0);
                if (currentSignal > startSignal) {
                    result = GM_getValue('adnull_block_result', '');
                    console.log('[AdNull] Block completed:', result);

                    // Close the tab
                    if (tabRef && tabRef.close) {
                        try { tabRef.close(); } catch(e) {}
                    }
                    break;
                }

                // Check if tab was closed manually
                if (tabRef && tabRef.closed) {
                    console.log('[AdNull] Tab was closed');
                    result = 'closed';
                    break;
                }
            }

            // If timeout, try to close the tab
            if (!result && tabRef && tabRef.close) {
                console.log('[AdNull] Timeout - closing tab');
                try { tabRef.close(); } catch(e) {}
            }

            if (result === 'success' || result === 'already_blocked') {
                markAsBlocked(sponsor.url);
                state.sessionBlocked++;
                if (state.config.showNotifications) {
                    showToast(`Blocked: ${sponsor.author}`, 'success');
                }
            } else {
                console.log('[AdNull] Block failed:', sponsor.author, 'result:', result);
                updateLogStatus(sponsor.url, 'failed', { error: result || 'timeout', failedAt: Date.now(), attempts: sponsor.attempts });
                state.failedCount++;

                // Retry up to 3 times
                if (sponsor.attempts < 3) {
                    console.log(`[AdNull] Will retry (${sponsor.attempts}/3)`);
                    state.blockQueue.push(sponsor);
                }
            }

            state.blockQueue.shift();
            state.currentBlockItem = null;
            saveBlockQueue();
            updateDashboard();

            if (state.blockQueue.length > 0 && (state.isRunning || state.reelsBatchInProgress) && !state.isPaused) {
                await sleep(state.config.blockDelay);
            }
        }

        state.isBlocking = false;
        state.currentBlockItem = null;
        updateDashboard();
        updateDashboardStatus(state.isRunning ? '📜 Scanning...' : 'Ready');

        // If batch mode completed, handle refresh
        if (state.reelsBatchInProgress) {
            await completeReelsBatch();
        }
    }

    function queueForBlocking(url, author, source) {
        const normalized = normalizeUrl(url);
        if (state.blockedSponsors.has(normalized)) return false;
        if (state.blockQueue.some(q => normalizeUrl(q.url) === normalized)) return false;
        if (isWhitelisted(url)) return false;

        state.blockQueue.push({
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            url,
            author,
            source,
            addedAt: Date.now(),
            attempts: 0
        });

        updateLogStatus(url, 'queued');
        saveBlockQueue();
        console.log(`[AdNull] Queued: ${author} (${state.blockQueue.length} in queue)`);

        // Check for batch mode trigger
        if (source === 'reel' && state.config.reelsBatchMode && !state.reelsBatchInProgress) {
            if (state.blockQueue.length >= state.config.reelsBatchSize) {
                console.log('[AdNull] 🎬 Reels batch size reached! Starting batch block...');
                triggerReelsBatchBlock();
            }
        }

        return true;
    }

    function skipCurrentBlock() {
        if (!state.currentBlockItem) return;
        console.log('[AdNull] Skipping current block:', state.currentBlockItem.author);

        // Mark as skipped
        updateLogStatus(state.currentBlockItem.url, 'skipped');

        // Remove from queue if present
        const idx = state.blockQueue.findIndex(q => normalizeUrl(q.url) === normalizeUrl(state.currentBlockItem.url));
        if (idx >= 0) {
            state.blockQueue.splice(idx, 1);
            saveBlockQueue();
        }

        state.currentBlockItem = null;
        showToast('Block skipped', 'info');
        updateDashboard();
    }

    // ══════════════════════════════════════════════════════════════════════
    // REELS BATCH BLOCKING
    // ══════════════════════════════════════════════════════════════════════
    async function triggerReelsBatchBlock() {
        if (state.isBlocking) {
            console.log('[AdNull] Already blocking, skipping');
            return;
        }

        // If neverPauseSkipper is enabled, don't start batch blocking at all
        if (state.config.neverPauseSkipper && reelsSkipperRunning) {
            console.log('[AdNull] Never pause enabled - skipping batch block, continuing to scan');
            return;
        }

        // In parallel mode, allow multiple batches but don't start a new one if one is in progress
        if (state.reelsBatchInProgress && !state.config.parallelScanning) {
            console.log('[AdNull] Batch already in progress');
            return;
        }

        state.reelsBatchInProgress = true;
        state.reelsSkipperWasActive = reelsSkipperRunning;

        console.log('[AdNull] ══════════════════════════════════════════');
        console.log('[AdNull] 🎬 REELS BATCH BLOCKING STARTED');
        console.log('[AdNull] Queue size:', state.blockQueue.length);
        console.log('[AdNull] Parallel scanning:', state.config.parallelScanning);
        console.log('[AdNull] ══════════════════════════════════════════');

        // If parallel scanning is enabled, DON'T stop the skipper and DON'T await
        if (state.config.parallelScanning) {
            console.log('[AdNull] Parallel mode - blocking in background, skipper continues');
            showToast('Blocking in background...', 'info');

            // Fire and forget - don't await, let it run in background
            processBlockQueueParallel();
            return; // Return immediately so skipper keeps running
        }

        // Non-parallel mode: stop skipper and wait for blocking to complete
        if (reelsSkipperRunning) {
            stopReelsSkipper(true); // temporary stop
            showToast('Pausing skipper for batch block...', 'info');
        }
        await sleep(500);

        // Start blocking (blocking mode)
        state.isRunning = true;
        updateDashboardStatus('🔄 Batch blocking...');
        updateDashboard();

        await processBlockQueue();
    }

    // Separate function for parallel processing that doesn't block
    async function processBlockQueueParallel() {
        console.log('[AdNull] Starting parallel block processing...');

        // Take a snapshot of current queue to process
        const queueSnapshot = [...state.blockQueue];
        const toProcess = queueSnapshot.slice(0, state.config.reelsBatchSize);

        console.log('[AdNull] Processing', toProcess.length, 'items in parallel mode');

        for (const item of toProcess) {
            if (!state.blockQueue.includes(item)) continue; // Already processed

            await processBlockItem(item);
            await sleep(state.config.blockDelay);
        }

        state.reelsBatchInProgress = false;
        console.log('[AdNull] Parallel batch complete');
        showToast(`Batch done: ${toProcess.length} processed`, 'success');

        // Sync to GitHub if enabled
        if (state.config.githubSyncEnabled) {
            await syncToGitHub();
        }

        updateDashboard();
    }

    // Extract single item blocking into its own function
    async function processBlockItem(sponsor) {
        if (state.blockedSponsors.has(normalizeUrl(sponsor.url))) {
            console.log('[AdNull] Already blocked:', sponsor.url);
            state.blockQueue = state.blockQueue.filter(q => q.id !== sponsor.id);
            saveBlockQueue();
            return 'already_blocked';
        }

        sponsor.attempts = (sponsor.attempts || 0) + 1;
        state.currentBlockItem = sponsor;

        console.log(`[AdNull] Blocking: ${sponsor.author} - ${sponsor.url} (attempt ${sponsor.attempts})`);
        updateLogStatus(sponsor.url, 'blocking');

        GM_setValue('adnull_block_complete', 0);
        GM_setValue('adnull_block_result', '');

        // Add force_rescan flag on retry attempts
        let blockUrl = sponsor.url + (sponsor.url.includes('?') ? '&' : '?') + '__adnull_block=1';
        if (sponsor.attempts > 1) {
            blockUrl += '&__adnull_retry=' + sponsor.attempts + '&__adnull_ts=' + Date.now();
        }

        // Open tab as ACTIVE (focused) - one at a time
        console.log('[AdNull] Opening blocking tab (focused):', blockUrl);
        const tabRef = GM_openInTab(blockUrl, { active: true, setParent: true, insert: true });

        const startTime = Date.now();
        const startSignal = GM_getValue('adnull_block_complete', 0);
        let result = null;

        // Extended timeout for retries
        const timeout = sponsor.attempts > 1 ? state.config.blockTimeout * 1.5 : state.config.blockTimeout;

        while (Date.now() - startTime < timeout) {
            await sleep(500);

            const currentSignal = GM_getValue('adnull_block_complete', 0);
            if (currentSignal > startSignal) {
                result = GM_getValue('adnull_block_result', '');
                console.log('[AdNull] Block completed:', result);

                if (tabRef && tabRef.close) {
                    try { tabRef.close(); } catch(e) {}
                }
                break;
            }

            if (tabRef && tabRef.closed) {
                console.log('[AdNull] Tab was closed');
                result = 'closed';
                break;
            }
        }

        // If timeout, try to close the tab
        if (!result && tabRef && tabRef.close) {
            console.log('[AdNull] Timeout - closing tab');
            try { tabRef.close(); } catch(e) {}
        }

        // Remove from queue
        state.blockQueue = state.blockQueue.filter(q => q.id !== sponsor.id);
        state.currentBlockItem = null;
        saveBlockQueue();

        if (result === 'success' || result === 'already_blocked') {
            markAsBlocked(sponsor.url);
            state.sessionBlocked++;
            if (state.config.showNotifications) {
                showToast(`Blocked: ${sponsor.author}`, 'success');
            }
            return 'success';
        } else {
            console.log('[AdNull] Block failed:', sponsor.author, 'result:', result);
            updateLogStatus(sponsor.url, 'failed', { error: result || 'timeout', failedAt: Date.now(), attempts: sponsor.attempts });
            state.failedCount++;

            // Retry up to 3 times
            if (sponsor.attempts < 3) {
                console.log(`[AdNull] Will retry (${sponsor.attempts}/3)`);
                state.blockQueue.push(sponsor);
                saveBlockQueue();
            }
            return 'failed';
        }
    }

    async function completeReelsBatch() {
        console.log('[AdNull] Completing batch...');

        const blockedInBatch = state.sessionBlocked;
        showToast(`Batch done: ${blockedInBatch} blocked`, 'success');

        // Sync to GitHub if enabled
        if (state.config.githubSyncEnabled && blockedInBatch > 0) {
            await syncToGitHub();
        }

        state.reelsBatchInProgress = false;

        // If parallel scanning is enabled, don't navigate away - just continue
        if (state.config.parallelScanning) {
            console.log('[AdNull] Parallel mode - staying on current page, continuing scan');
            updateDashboardStatus('📜 Scanning...');
            return;
        }

        // Check if skipper should restart
        const shouldRestartSkipper = state.reelsSkipperWasActive || GM_getValue('skipperActive', false);

        // Navigate to fresh reels
        const FRESH_REELS_URL = 'https://www.facebook.com/reel/?s=tab';
        updateDashboardStatus('Loading fresh reels...');

        await sleep(1000);

        // Refresh the page to get new reels - skipper will auto-restart due to saved state
        if (getPageType() === 'reels') {
            // Save skipper state to restart after refresh
            if (shouldRestartSkipper) {
                saveSkipperState(true);
            }
            location.href = FRESH_REELS_URL;
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    // RETRY FAILED
    // ══════════════════════════════════════════════════════════════════════
    function retryAllFailed(forceStart = false) {
        let requeued = 0;
        const failedEntries = state.masterLog.filter(e => e.status === 'failed');

        console.log('[AdNull] Retrying', failedEntries.length, 'failed entries...');

        for (const entry of failedEntries) {
            const url = normalizeUrl(entry.url);

            if (state.blockedSponsors.has(url)) continue;
            if (state.blockQueue.some(q => normalizeUrl(q.url) === url)) continue;

            state.blockQueue.push({
                id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
                url: entry.url,
                author: entry.author || 'Unknown',
                source: 'retry',
                addedAt: Date.now(),
                attempts: 0  // Reset attempts for retry
            });

            updateLogStatus(entry.url, 'queued');
            requeued++;
        }

        if (requeued > 0) {
            saveBlockQueue();
            state.failedCount = 0; // Reset failed count
            updateDashboard();
            showToast(`Requeued ${requeued} failed entries`, 'success');

            // Force start blocking if requested or if scanner is running
            if (forceStart || state.isRunning) {
                if (!state.isBlocking) {
                    state.isRunning = true;
                    processBlockQueue();
                }
            }
        } else {
            showToast('No failed entries to retry', 'info');
        }

        return requeued;
    }

    // ══════════════════════════════════════════════════════════════════════
    // VISUAL TAGGING
    // ══════════════════════════════════════════════════════════════════════
    function tagPost(post) {
        if (post.querySelector('.adnull-tag')) return;
        const tag = document.createElement('div');
        tag.className = 'adnull-tag';
        tag.innerHTML = '<span class="tag-icon">🚫</span><span>SPONSOR</span>';
        const header = post.querySelector('h2, h3, h4') || post.firstChild;
        if (header?.parentNode) header.parentNode.insertBefore(tag, header);
        else post.insertBefore(tag, post.firstChild);
        post.style.border = '2px solid #fa3e3e';
        post.style.borderRadius = '8px';
    }

    function tagReel(container) {
        if (container.querySelector('.adnull-reel-tag')) return;
        const tag = document.createElement('div');
        tag.className = 'adnull-reel-tag';
        tag.innerHTML = '🚫 SPONSORED REEL';
        if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
        container.appendChild(tag);
    }

    // ══════════════════════════════════════════════════════════════════════
    // MANUAL BLOCK BUTTONS
    // ══════════════════════════════════════════════════════════════════════
    function injectManualBlockButton(post) {
        if (post.querySelector('.adnull-manual-block-btn') || post.querySelector('.adnull-video-block-btn')) return;

        const authorData = extractAuthorFromPost(post);
        if (!authorData.url) return;

        const normalized = normalizeUrl(authorData.url);
        const isBlocked = state.blockedSponsors.has(normalized);
        const isQueued = state.blockQueue.some(q => normalizeUrl(q.url) === normalized);

        const videoContainer = post.querySelector('video')?.closest('div[class*="x1"]') ||
                               post.querySelector('[data-video-id]') ||
                               post.querySelector('[aria-label="Play"]')?.closest('div[class*="x1"]');

        const hasVideo = !!videoContainer;

        const btn = document.createElement('button');
        btn.className = (hasVideo ? 'adnull-video-block-btn' : 'adnull-manual-block-btn') +
                        (isBlocked ? ' blocked' : '') + (isQueued ? ' queued' : '');
        btn.innerHTML = isBlocked
            ? '<span class="icon">✓</span> Blocked'
            : isQueued
                ? '<span class="icon">⏳</span> Queued'
                : '<span class="icon">🚫</span> Block';
        btn.title = `Block ${authorData.name}`;

        if (!isBlocked && !isQueued) {
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                manualBlockAuthor(authorData, btn, 'feed-manual');
            };
        }

        if (hasVideo && videoContainer) {
            if (getComputedStyle(videoContainer).position === 'static') videoContainer.style.position = 'relative';
            videoContainer.appendChild(btn);
        } else {
            if (getComputedStyle(post).position === 'static') post.style.position = 'relative';
            post.appendChild(btn);
        }
    }

    function injectReelBlockButton(reelContainer) {
        if (reelContainer.querySelector('.adnull-reel-block-btn')) return;

        const authorData = extractAuthorFromReel(reelContainer);
        if (!authorData.url) return;

        const normalized = normalizeUrl(authorData.url);
        const isBlocked = state.blockedSponsors.has(normalized);
        const isQueued = state.blockQueue.some(q => normalizeUrl(q.url) === normalized);

        const btn = document.createElement('button');
        btn.className = 'adnull-reel-block-btn' + (isBlocked ? ' blocked' : '') + (isQueued ? ' queued' : '');
        btn.innerHTML = isBlocked
            ? '<span class="icon">✓</span> Blocked'
            : isQueued
                ? '<span class="icon">⏳</span> Queued'
                : '<span class="icon">🚫</span> Block & Skip';
        btn.title = `Block ${authorData.name}`;

        if (!isBlocked && !isQueued) {
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                manualBlockAuthor(authorData, btn, 'reel-manual');
            };
        }

        if (getComputedStyle(reelContainer).position === 'static') reelContainer.style.position = 'relative';
        reelContainer.appendChild(btn);
    }

    function manualBlockAuthor(authorData, btn, source) {
        console.log(`[AdNull] Manual block: ${authorData.name} - ${authorData.url}`);

        if (btn) {
            btn.innerHTML = '<span class="icon">⏳</span> Blocking...';
            btn.classList.add('queued');
            btn.onclick = null;
        }

        addToMasterLog({ url: authorData.url, author: authorData.name, content: '(Manual block)', source: source });
        state.sessionDetected++;

        if (queueForBlocking(authorData.url, authorData.name, source)) {
            showToast(`Blocking: ${authorData.name}`, 'info');
        } else {
            showToast('Already queued or blocked', 'info');
            if (source === 'reel-manual') {
                setTimeout(skipReel, 300);
            }
            return;
        }

        updateDashboard();

        // Skip the reel first, then start blocking
        if (source === 'reel-manual') {
            setTimeout(skipReel, 300);
        }

        // ALWAYS start blocking immediately for manual blocks (regardless of scanner state or batch mode)
        if (!state.isBlocking) {
            state.isRunning = true; // Ensure we can process
            setTimeout(() => processBlockQueue(), 500); // Small delay to let skip happen first
        }
    }

    function injectAllBlockButtons() {
        if (getPageType() === 'feed') {
            const posts = document.querySelectorAll('div[aria-posinset], div[role="article"], div[data-pagelet^="FeedUnit"]');
            posts.forEach(post => {
                if (post.innerText.length < 20) return;
                if (post.querySelector('.adnull-manual-block-btn') || post.querySelector('.adnull-video-block-btn')) return;
                injectManualBlockButton(post);
            });
        }

        const pageType = getPageType();
        if (pageType === 'reels' || pageType === 'watch') {
            const reelContainer = getCurrentReelContainer();
            if (reelContainer && !reelContainer.querySelector('.adnull-reel-block-btn')) {
                injectReelBlockButton(reelContainer);
            }
        }
    }

    function getCurrentReelContainer() {
        const reelContainers = document.querySelectorAll('[data-video-id]');
        for (const container of reelContainers) {
            const rect = container.getBoundingClientRect();
            if (rect.top > -100 && rect.top < 300 && rect.height > 400) return container;
        }
        for (const container of reelContainers) {
            if (isVisible(container)) return container;
        }
        return null;
    }

    // ══════════════════════════════════════════════════════════════════════
    // SCANNING
    // ══════════════════════════════════════════════════════════════════════
    const processedPosts = new WeakSet();
    const processedReels = new Set();

    function scanFeed() {
        if (getPageType() !== 'feed') return { found: 0 };
        let found = 0;

        for (const post of document.querySelectorAll('div[role="article"]')) {
            if (processedPosts.has(post)) continue;
            processedPosts.add(post);

            const sponsored = isSponsored(post);
            if (sponsored) {
                const data = extractPostData(post);
                if (data.url) {
                    console.log('[AdNull] 🎯 Sponsor:', data.author, '| Method:', sponsored.method);
                    tagPost(post);

                    if (addToMasterLog(data)) {
                        state.sessionDetected++;
                        found++;
                        queueForBlocking(data.url, data.author, 'feed');
                    }
                }
            }
        }

        if (state.config.showManualBlockButtons !== false) {
            injectAllBlockButtons();
        }

        return { found };
    }

    function scanReels() {
        const pageType = getPageType();
        if (pageType !== 'reels' && pageType !== 'watch') return { found: 0 };
        let found = 0;

        for (const container of document.querySelectorAll('[data-video-id]')) {
            const rect = container.getBoundingClientRect();
            if (rect.bottom < 0 || rect.top > window.innerHeight) continue;

            const videoId = container.getAttribute('data-video-id');
            if (!videoId || processedReels.has(videoId)) continue;
            processedReels.add(videoId);

            const sponsored = isReelSponsored(container);
            if (sponsored) {
                const data = extractReelData(container);
                console.log('[AdNull] 🎯 Sponsored reel:', sponsored.method, '| Author:', data.author);
                tagReel(container);

                if (data.url) {
                    if (addToMasterLog(data)) {
                        state.sessionDetected++;
                        found++;
                        queueForBlocking(data.url, data.author, 'reel');
                    }

                    if (state.config.skipSponsoredReels !== false && !reelsSkipperRunning) {
                        setTimeout(skipReel, 500);
                    }
                }
            }
        }

        if (state.config.showManualBlockButtons !== false) {
            injectAllBlockButtons();
        }

        return { found };
    }

    function runScan() {
        const feed = scanFeed();
        const reels = scanReels();
        const total = feed.found + reels.found;
        if (total > 0) {
            updateDashboard();
            if (state.config.showNotifications) {
                showToast(`Found ${total} sponsor${total > 1 ? 's' : ''}`, 'success');
            }

            if (state.isRunning && !state.isBlocking && state.blockQueue.length > 0 && !state.config.reelsBatchMode) {
                processBlockQueue();
            }
        }
        return total;
    }

    // ══════════════════════════════════════════════════════════════════════
    // REELS AUTO-SKIPPER (Enhanced)
    // ══════════════════════════════════════════════════════════════════════
    function skipReel() {
        const notif = document.createElement('div');
        notif.className = 'adnull-skip-notif';
        notif.innerHTML = '<span>⏭️</span><span>SKIPPING AD</span>';
        document.body.appendChild(notif);
        setTimeout(() => notif.remove(), 1000);

        if (state.config.reelsSkipMethod === 'button') {
            if (!clickNextCardButton()) {
                simulateDownKey();
            }
        } else {
            simulateDownKey();
        }
    }

    function simulateDownKey() {
        const event = new KeyboardEvent('keydown', {
            key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true, cancelable: true
        });
        document.body.dispatchEvent(event);
    }

    function clickNextCardButton() {
        const nextBtn = document.querySelector('[aria-label="Next Card"]');
        if (nextBtn) {
            nextBtn.click();
            return true;
        }
        const downArrow = document.querySelector('div[role="button"] svg path[d*="57.47"]')?.closest('[role="button"]');
        if (downArrow) {
            downArrow.click();
            return true;
        }
        return false;
    }

    function getCurrentVideoId() {
        for (const container of document.querySelectorAll('[data-video-id]')) {
            const rect = container.getBoundingClientRect();
            const centerY = window.innerHeight / 2;
            if (rect.top < centerY && rect.bottom > centerY) {
                return container.getAttribute('data-video-id');
            }
        }
        return null;
    }

    async function waitForCurrentReel() {
        for (let i = 0; i < 30; i++) {
            const video = document.querySelector('video');
            if (video && video.readyState >= 2) return;
            await sleep(100);
        }
    }

    async function reelsSkipperLoop() {
        if (!reelsSkipperRunning) return;

        try {
            await waitForCurrentReel();

            const currentVideoId = getCurrentVideoId();

            if (currentVideoId && currentVideoId !== lastScannedVideoId) {
                lastScannedVideoId = currentVideoId;

                const scanResult = scanReels();
                console.log('[AdNull] Scanned reel:', currentVideoId, 'Found:', scanResult.found);
                updateDashboard();

                await sleep(200);
            }

            await sleep(state.config.reelsSkipSpeed);

            // In parallel mode, continue skipping even during batch blocking
            const shouldContinue = !state.reelsBatchInProgress || state.config.parallelScanning;

            if (reelsSkipperRunning && shouldContinue) {
                skipReel();
                await sleep(500);
            }

            if (reelsSkipperRunning && shouldContinue) {
                requestAnimationFrame(() => reelsSkipperLoop());
            } else if (reelsSkipperRunning && state.reelsBatchInProgress && !state.config.parallelScanning) {
                // Batch in progress but not parallel - wait and check again
                setTimeout(() => reelsSkipperLoop(), 1000);
            }
        } catch (e) {
            console.error('[AdNull] Skipper error:', e);
            if (reelsSkipperRunning) {
                setTimeout(() => reelsSkipperLoop(), 1000);
            }
        }
    }

    function startReelsSkipper() {
        if (reelsSkipperRunning) return;

        reelsSkipperRunning = true;
        state.reelsSkipperActive = true;
        lastScannedVideoId = null;

        // Save state for persistence across page refreshes
        saveSkipperState(true);

        console.log(`[AdNull] Reels skipper started (${state.config.reelsSkipSpeed}ms, method: ${state.config.reelsSkipMethod}, neverPause: ${state.config.neverPauseSkipper})`);
        updateReelsSkipperUI(true);
        showToast('Reels skipper started', 'success');

        reelsSkipperLoop();
    }

    function stopReelsSkipper(temporary = false) {
        if (!reelsSkipperRunning) return;

        reelsSkipperRunning = false;
        state.reelsSkipperActive = false;
        lastScannedVideoId = null;

        // Only clear saved state if not a temporary stop (batch blocking)
        if (!temporary) {
            saveSkipperState(false);
        }

        console.log('[AdNull] Reels skipper stopped', temporary ? '(temporary)' : '');
        updateReelsSkipperUI(false);
    }

    function updateReelsSkipperUI(active) {
        const startBtn = document.getElementById('btn-reels-start');
        const stopBtn = document.getElementById('btn-reels-stop');
        const section = document.getElementById('reels-section');

        if (startBtn) startBtn.classList.toggle('hidden', active);
        if (stopBtn) stopBtn.classList.toggle('hidden', !active);
        if (section) section.classList.toggle('active', active);
    }

    // ══════════════════════════════════════════════════════════════════════
    // SCANNER CONTROLS
    // ══════════════════════════════════════════════════════════════════════
    function startScanner() {
        if (state.isRunning) return;
        state.isRunning = true;
        state.isPaused = false;
        console.log('[AdNull] Scanner started');
        updateDashboard();
        updateDashboardStatus('📜 Scanning...');

        runScan();

        scannerInterval = setInterval(() => {
            if (!state.isPaused) runScan();
        }, state.config.scanInterval);

        if (state.config.scrollEnabled && getPageType() === 'feed') {
            scrollerInterval = setInterval(() => {
                if (state.isRunning && !state.isBlocking && !state.isPaused) {
                    window.scrollBy({ top: state.config.scrollAmount, behavior: 'smooth' });
                }
            }, state.config.scrollDelay);
        }

        if (state.blockQueue.length > 0 && !state.isBlocking && !state.config.reelsBatchMode) {
            processBlockQueue();
        }
    }

    function stopScanner() {
        state.isRunning = false;
        state.isPaused = false;
        if (scannerInterval) clearInterval(scannerInterval);
        if (scrollerInterval) clearInterval(scrollerInterval);
        console.log('[AdNull] Scanner stopped');
        updateDashboard();
        updateDashboardStatus('Stopped');
    }

    function pauseScanner() {
        state.isPaused = true;
        console.log('[AdNull] Scanner paused');
        updateDashboard();
        updateDashboardStatus('⏸ Paused');
    }

    function resumeScanner() {
        state.isPaused = false;
        console.log('[AdNull] Scanner resumed');
        updateDashboard();
        updateDashboardStatus('📜 Scanning...');

        if (state.blockQueue.length > 0 && !state.isBlocking && !state.config.reelsBatchMode) {
            processBlockQueue();
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    // SPEED PRESETS
    // ══════════════════════════════════════════════════════════════════════
    function setSpeedPreset(presetName) {
        const preset = SPEED_PRESETS[presetName];
        if (!preset) return;

        state.speedPreset = presetName;
        state.config.blockDelay = preset.blockDelay;
        state.config.pageLoadWait = preset.pageLoadWait;
        state.config.clickDelay = preset.clickDelay;
        state.config.tabCloseDelay = preset.tabCloseDelay;

        saveConfig();
        updateSpeedPresetUI();
        showToast(`Speed: ${preset.icon} ${preset.name}`, 'info');
    }

    function updateSpeedPresetUI() {
        document.querySelectorAll('.speed-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.speed === state.speedPreset);
        });
    }

    // ══════════════════════════════════════════════════════════════════════
    // TOAST
    // ══════════════════════════════════════════════════════════════════════
    function showToast(message, type = 'info') {
        document.querySelectorAll('.adnull-toast').forEach(t => t.remove());
        const toast = document.createElement('div');
        toast.className = `adnull-toast ${type}`;
        const icons = { success: '✓', error: '✗', warning: '⚠', info: 'ℹ' };
        toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span><span>${message}</span>`;
        document.body.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('visible'));
        setTimeout(() => {
            toast.classList.remove('visible');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ══════════════════════════════════════════════════════════════════════
    // IMPORT/EXPORT
    // ══════════════════════════════════════════════════════════════════════
    function exportCSV() {
        const csv = [
            ['Author', 'URL', 'Source', 'Detected', 'Status'].join(','),
            ...state.masterLog.map(e => [
                `"${(e.author || '').replace(/"/g, '""')}"`,
                e.url, e.source, e.detectedAt, e.status
            ].join(','))
        ].join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `adnull_export_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showToast(`Exported ${state.masterLog.length} entries`, 'success');
    }

    function importFoundation(force = false) {
        if (!force && state.foundationImported) return;

        console.log('[AdNull] Importing foundation blocklist...');
        updateDashboardStatus('📥 Importing foundation...');

        GM_xmlhttpRequest({
            method: 'GET',
            url: state.config.foundationUrl,
            onload: (response) => {
                if (response.status === 200) {
                    const lines = response.responseText.split('\n');
                    let imported = 0, queued = 0;

                    for (let i = 1; i < lines.length; i++) {
                        const line = lines[i].trim();
                        if (!line) continue;

                        const parts = line.split(',');
                        if (parts.length < 2) continue;

                        const author = parts[0].replace(/^"|"$/g, '');
                        const url = parts[1].trim();

                        if (!url.includes('facebook.com')) continue;
                        if (state.masterLogIndex[normalizeUrl(url)] !== undefined) continue;

                        if (addToMasterLog({ url, author, source: 'foundation' })) {
                            imported++;
                            if (queueForBlocking(url, author, 'foundation')) queued++;
                        }
                    }

                    state.foundationImported = true;
                    GM_setValue('foundationImported', true);
                    console.log(`[AdNull] Foundation imported: ${imported} entries, ${queued} queued`);
                    showToast(`Imported ${imported}, queued ${queued}`, 'success');
                    updateDashboard();
                    updateDashboardStatus('✓ Foundation imported');

                    if (state.isRunning && !state.isBlocking && state.blockQueue.length > 0 && !state.config.reelsBatchMode) {
                        processBlockQueue();
                    }
                }
            },
            onerror: (e) => {
                console.error('[AdNull] Foundation import error:', e);
                showToast('Foundation import failed', 'error');
            }
        });
    }

    // ══════════════════════════════════════════════════════════════════════
    // GITHUB SYNC
    // ══════════════════════════════════════════════════════════════════════
    async function syncToGitHub() {
        if (!state.config.githubSyncEnabled || !state.config.githubToken || !state.config.githubRepo) {
            console.log('[AdNull] GitHub sync not configured');
            return { success: false, error: 'not_configured' };
        }

        console.log('[AdNull] Syncing to GitHub...');
        updateDashboardStatus('☁️ Syncing to GitHub...');

        const csv = [
            ['Author', 'URL', 'Source', 'Detected', 'Status'].join(','),
            ...state.masterLog.filter(e => e.status === 'blocked').map(e => [
                `"${(e.author || '').replace(/"/g, '""')}"`,
                e.url, e.source, e.detectedAt, e.status
            ].join(','))
        ].join('\n');

        const content = btoa(unescape(encodeURIComponent(csv)));
        const path = state.config.githubPath || 'adnull_blocklist.csv';

        return new Promise((resolve) => {
            // First get the current file SHA if it exists
            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://api.github.com/repos/${state.config.githubRepo}/contents/${path}?ref=${state.config.githubBranch}`,
                headers: {
                    'Authorization': `Bearer ${state.config.githubToken}`,
                    'Accept': 'application/vnd.github.v3+json'
                },
                onload: (getResponse) => {
                    let sha = null;
                    if (getResponse.status === 200) {
                        try {
                            sha = JSON.parse(getResponse.responseText).sha;
                        } catch (e) {}
                    }

                    // Now push the file
                    const body = {
                        message: `AdNull sync: ${state.totalBlocked} blocked sponsors`,
                        content: content,
                        branch: state.config.githubBranch
                    };
                    if (sha) body.sha = sha;

                    GM_xmlhttpRequest({
                        method: 'PUT',
                        url: `https://api.github.com/repos/${state.config.githubRepo}/contents/${path}`,
                        headers: {
                            'Authorization': `Bearer ${state.config.githubToken}`,
                            'Accept': 'application/vnd.github.v3+json',
                            'Content-Type': 'application/json'
                        },
                        data: JSON.stringify(body),
                        onload: (putResponse) => {
                            if (putResponse.status === 200 || putResponse.status === 201) {
                                console.log('[AdNull] GitHub sync successful');
                                showToast('Synced to GitHub', 'success');
                                resolve({ success: true });
                            } else {
                                console.error('[AdNull] GitHub sync failed:', putResponse.status);
                                showToast('GitHub sync failed', 'error');
                                resolve({ success: false, error: putResponse.status });
                            }
                        },
                        onerror: (e) => {
                            console.error('[AdNull] GitHub sync error:', e);
                            showToast('GitHub sync error', 'error');
                            resolve({ success: false, error: e });
                        }
                    });
                },
                onerror: () => {
                    // File doesn't exist, create new
                    const body = {
                        message: `AdNull sync: ${state.totalBlocked} blocked sponsors`,
                        content: content,
                        branch: state.config.githubBranch
                    };

                    GM_xmlhttpRequest({
                        method: 'PUT',
                        url: `https://api.github.com/repos/${state.config.githubRepo}/contents/${path}`,
                        headers: {
                            'Authorization': `Bearer ${state.config.githubToken}`,
                            'Accept': 'application/vnd.github.v3+json',
                            'Content-Type': 'application/json'
                        },
                        data: JSON.stringify(body),
                        onload: (putResponse) => {
                            if (putResponse.status === 200 || putResponse.status === 201) {
                                console.log('[AdNull] GitHub sync successful (new file)');
                                showToast('Synced to GitHub', 'success');
                                resolve({ success: true });
                            } else {
                                console.error('[AdNull] GitHub sync failed:', putResponse.status);
                                resolve({ success: false, error: putResponse.status });
                            }
                        },
                        onerror: (e) => {
                            resolve({ success: false, error: e });
                        }
                    });
                }
            });
        });
    }

    // ══════════════════════════════════════════════════════════════════════
    // DASHBOARD
    // ══════════════════════════════════════════════════════════════════════
    function createDashboard() {
        if (document.getElementById('adnull-dashboard')) return;

        const dash = document.createElement('div');
        dash.id = 'adnull-dashboard';
        dash.innerHTML = `
            <div class="panel-header">
                <span class="title">🚫 AdNull Pro v${VERSION}</span>
                <button class="close-btn" id="dash-close">×</button>
            </div>
            <div class="panel-body">
                <div class="tabs">
                    <button class="tab active" data-tab="main">Main</button>
                    <button class="tab" data-tab="reels">Reels</button>
                    <button class="tab" data-tab="settings">Settings</button>
                    <button class="tab" data-tab="github">GitHub</button>
                </div>

                <div id="tab-main" class="tab-content active">
                    <div class="stats-grid">
                        <div class="stat-card"><div class="stat-value" id="stat-detected">${state.sessionDetected}</div><div class="stat-label">Session</div></div>
                        <div class="stat-card"><div class="stat-value" id="stat-blocked">${state.totalBlocked}</div><div class="stat-label">Blocked</div></div>
                        <div class="stat-card accent"><div class="stat-value" id="stat-queue">${state.blockQueue.length}</div><div class="stat-label">Queue</div></div>
                        <div class="stat-card fail"><div class="stat-value" id="stat-failed">${state.failedCount}</div><div class="stat-label">Failed</div></div>
                    </div>

                    <div class="speed-section">
                        <div class="speed-label">Speed:</div>
                        <div class="speed-btns">
                            <button class="speed-btn ${state.speedPreset === 'careful' ? 'active' : ''}" data-speed="careful" title="Careful">🐢</button>
                            <button class="speed-btn ${state.speedPreset === 'normal' ? 'active' : ''}" data-speed="normal" title="Normal">🚶</button>
                            <button class="speed-btn ${state.speedPreset === 'fast' ? 'active' : ''}" data-speed="fast" title="Fast">🏃</button>
                            <button class="speed-btn ${state.speedPreset === 'turbo' ? 'active' : ''}" data-speed="turbo" title="Turbo">🚀</button>
                        </div>
                    </div>

                    <div class="control-row">
                        <button class="ctrl-btn primary" id="btn-start">▶ Start</button>
                        <button class="ctrl-btn danger hidden" id="btn-stop">⏹ Stop</button>
                        <button class="ctrl-btn" id="btn-pause">⏸</button>
                        <button class="ctrl-btn" id="btn-scan">🔍</button>
                    </div>

                    <div class="current-block hidden" id="current-block">
                        <span class="cb-label">Blocking:</span>
                        <span class="cb-name" id="current-name">-</span>
                        <button class="cb-skip" id="btn-skip-block">Skip</button>
                    </div>

                    <div class="status-bar">
                        <span id="page-icon">${getPageIcon()}</span>
                        <span id="page-label">${getPageLabel()}</span>
                        <span class="status-indicator" id="status-indicator">Ready</span>
                    </div>

                    <button class="retry-btn ${state.failedCount > 0 ? '' : 'hidden'}" id="btn-retry">🔄 Retry ${state.failedCount} Failed</button>

                    <div id="dash-status" class="dash-status">Ready - Click Start</div>
                </div>

                <div id="tab-reels" class="tab-content">
                    <div class="reels-section" id="reels-section">
                        <div class="reels-info">Scan → Collect → Batch Block → Refresh</div>

                        <div class="batch-status">
                            <span>Queue: <strong id="batch-queue">${state.blockQueue.length}</strong> / <span id="batch-size-display">${state.config.reelsBatchSize}</span></span>
                            <div class="batch-progress">
                                <div class="batch-bar" id="batch-bar" style="width: ${Math.min(100, (state.blockQueue.length / state.config.reelsBatchSize) * 100)}%"></div>
                            </div>
                        </div>

                        <div class="control-row">
                            <button class="ctrl-btn primary" id="btn-reels-start">▶ Start Skipper</button>
                            <button class="ctrl-btn danger hidden" id="btn-reels-stop">⏹ Stop</button>
                            <button class="ctrl-btn" id="btn-trigger-batch">⚡ Block Now</button>
                        </div>

                        <div class="reels-settings">
                            <div class="setting-row">
                                <label>Speed: <span id="reels-speed-val">${(state.config.reelsSkipSpeed / 1000).toFixed(1)}s</span></label>
                                <input type="range" id="reels-speed" min="500" max="5000" step="250" value="${state.config.reelsSkipSpeed}">
                            </div>
                            <div class="setting-row">
                                <label>Method:</label>
                                <div class="method-btns">
                                    <button class="method-btn ${state.config.reelsSkipMethod === 'button' ? 'active' : ''}" data-method="button">🔘 Button</button>
                                    <button class="method-btn ${state.config.reelsSkipMethod === 'keyboard' ? 'active' : ''}" data-method="keyboard">⌨️ Key</button>
                                </div>
                            </div>
                            <div class="setting-row">
                                <label>Batch Size:</label>
                                <input type="number" id="batch-size" min="1" max="100" value="${state.config.reelsBatchSize}">
                            </div>
                        </div>

                        <div class="opt"><input type="checkbox" id="opt-batch-mode" ${state.config.reelsBatchMode ? 'checked' : ''}><label for="opt-batch-mode">Batch mode (collect then block)</label></div>
                        <div class="opt"><input type="checkbox" id="opt-never-pause" ${state.config.neverPauseSkipper ? 'checked' : ''}><label for="opt-never-pause">Never pause (keep skipping, queue only)</label></div>
                        <div class="opt"><input type="checkbox" id="opt-parallel-scan" ${state.config.parallelScanning ? 'checked' : ''}><label for="opt-parallel-scan">Parallel mode (scan while blocking)</label></div>
                        <div class="opt"><input type="checkbox" id="opt-skip-sponsored" ${state.config.skipSponsoredReels !== false ? 'checked' : ''}><label for="opt-skip-sponsored">Auto-skip sponsored reels</label></div>
                    </div>
                    <button class="ctrl-btn" id="btn-skip-reel">⏭️ Skip Current Reel</button>
                </div>

                <div id="tab-settings" class="tab-content">
                    <div class="opt"><input type="checkbox" id="opt-autostart" ${state.config.autoStart ? 'checked' : ''}><label for="opt-autostart">Auto-start scanner</label></div>
                    <div class="opt"><input type="checkbox" id="opt-scroll" ${state.config.scrollEnabled ? 'checked' : ''}><label for="opt-scroll">Auto-scroll feed</label></div>
                    <div class="opt"><input type="checkbox" id="opt-notifications" ${state.config.showNotifications ? 'checked' : ''}><label for="opt-notifications">Show notifications</label></div>
                    <div class="opt"><input type="checkbox" id="opt-manual-buttons" ${state.config.showManualBlockButtons !== false ? 'checked' : ''}><label for="opt-manual-buttons">Show manual block buttons</label></div>

                    <div class="data-section">
                        <h4>Data Management</h4>
                        <button class="set-btn" id="btn-export">📤 Export CSV</button>
                        <button class="set-btn" id="btn-import-foundation">🔄 Re-import Foundation</button>
                    </div>

                    <div class="data-section">
                        <h4>Queue Management</h4>
                        <button class="set-btn" id="btn-process-queue">▶ Process Queue Now</button>
                        <button class="set-btn danger" id="btn-clear-queue">🗑️ Clear Queue</button>
                    </div>

                    <div class="data-section danger">
                        <h4>⚠️ Danger Zone</h4>
                        <button class="set-btn danger" id="btn-clear-log">Clear Master Log</button>
                        <button class="set-btn danger" id="btn-clear-blocked">Clear Blocked List</button>
                        <button class="set-btn danger" id="btn-reset-all">Reset Everything</button>
                    </div>
                </div>

                <div id="tab-github" class="tab-content">
                    <div class="github-section">
                        <h4>☁️ GitHub Sync</h4>
                        <p class="github-info">Automatically backup your blocklist to a GitHub repository</p>

                        <div class="opt"><input type="checkbox" id="opt-github-enabled" ${state.config.githubSyncEnabled ? 'checked' : ''}><label for="opt-github-enabled">Enable GitHub Sync</label></div>

                        <div class="github-fields ${state.config.githubSyncEnabled ? '' : 'disabled'}">
                            <div class="field">
                                <label>Token (PAT):</label>
                                <input type="password" id="github-token" value="${state.config.githubToken}" placeholder="ghp_xxxx...">
                            </div>
                            <div class="field">
                                <label>Repository:</label>
                                <input type="text" id="github-repo" value="${state.config.githubRepo}" placeholder="username/repo">
                            </div>
                            <div class="field">
                                <label>File Path:</label>
                                <input type="text" id="github-path" value="${state.config.githubPath}" placeholder="blocklist.csv">
                            </div>
                            <div class="field">
                                <label>Branch:</label>
                                <input type="text" id="github-branch" value="${state.config.githubBranch}" placeholder="main">
                            </div>
                        </div>

                        <button class="set-btn" id="btn-github-save">💾 Save GitHub Settings</button>
                        <button class="set-btn" id="btn-github-sync">☁️ Sync Now</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(dash);

        if (state.config.dashboardPosition) {
            dash.style.top = state.config.dashboardPosition.top + 'px';
            dash.style.right = state.config.dashboardPosition.right + 'px';
        }

        // Event handlers
        document.getElementById('dash-close').onclick = () => dash.classList.toggle('minimized');
        document.getElementById('btn-start').onclick = () => { startScanner(); updateControls(); };
        document.getElementById('btn-stop').onclick = () => { stopScanner(); updateControls(); };
        document.getElementById('btn-pause').onclick = () => {
            if (state.isPaused) resumeScanner();
            else pauseScanner();
            updateControls();
        };
        document.getElementById('btn-scan').onclick = () => runScan();
        document.getElementById('btn-skip-reel').onclick = skipReel;
        document.getElementById('btn-export').onclick = exportCSV;
        document.getElementById('btn-import-foundation').onclick = () => importFoundation(true);
        document.getElementById('btn-retry').onclick = () => retryAllFailed(true);
        document.getElementById('btn-skip-block').onclick = skipCurrentBlock;

        document.getElementById('btn-process-queue').onclick = () => {
            if (state.blockQueue.length > 0 && !state.isBlocking) {
                state.isRunning = true;
                processBlockQueue();
            } else {
                showToast('Queue is empty or already processing', 'info');
            }
        };

        document.getElementById('btn-clear-queue').onclick = () => {
            if (confirm(`Clear ${state.blockQueue.length} items from queue?`)) {
                state.blockQueue = [];
                saveBlockQueue();
                updateDashboard();
                showToast('Queue cleared', 'warning');
            }
        };

        document.getElementById('btn-clear-log').onclick = () => {
            if (confirm('Clear entire master log?')) {
                state.masterLog = [];
                state.masterLogIndex = {};
                state.failedCount = 0;
                saveMasterLog();
                updateDashboard();
                showToast('Master log cleared', 'warning');
            }
        };

        document.getElementById('btn-clear-blocked').onclick = () => {
            if (confirm('Clear blocked list?')) {
                state.blockedSponsors.clear();
                state.totalBlocked = 0;
                saveBlocked();
                updateDashboard();
                showToast('Blocked list cleared', 'warning');
            }
        };

        document.getElementById('btn-reset-all').onclick = () => {
            if (confirm('Reset ALL data? This cannot be undone!')) {
                GM_deleteValue('config');
                GM_deleteValue('masterLog');
                GM_deleteValue('blocked');
                GM_deleteValue('whitelist');
                GM_deleteValue('blockQueue');
                GM_deleteValue('foundationImported');
                GM_deleteValue('speedPreset');
                location.reload();
            }
        };

        // Settings checkboxes
        document.getElementById('opt-autostart').onchange = (e) => { state.config.autoStart = e.target.checked; saveConfig(); };
        document.getElementById('opt-scroll').onchange = (e) => { state.config.scrollEnabled = e.target.checked; saveConfig(); };
        document.getElementById('opt-notifications').onchange = (e) => { state.config.showNotifications = e.target.checked; saveConfig(); };
        document.getElementById('opt-skip-sponsored').onchange = (e) => { state.config.skipSponsoredReels = e.target.checked; saveConfig(); };
        document.getElementById('opt-manual-buttons').onchange = (e) => { state.config.showManualBlockButtons = e.target.checked; saveConfig(); };
        document.getElementById('opt-batch-mode').onchange = (e) => { state.config.reelsBatchMode = e.target.checked; saveConfig(); };
        document.getElementById('opt-never-pause').onchange = (e) => { state.config.neverPauseSkipper = e.target.checked; saveConfig(); };
        document.getElementById('opt-parallel-scan').onchange = (e) => { state.config.parallelScanning = e.target.checked; saveConfig(); };

        // Speed presets
        dash.querySelectorAll('.speed-btn').forEach(btn => {
            btn.onclick = () => setSpeedPreset(btn.dataset.speed);
        });

        // Reels skipper controls
        document.getElementById('btn-reels-start').onclick = startReelsSkipper;
        document.getElementById('btn-reels-stop').onclick = stopReelsSkipper;
        document.getElementById('btn-trigger-batch').onclick = () => {
            if (state.blockQueue.length > 0 && !state.reelsBatchInProgress) {
                triggerReelsBatchBlock();
            } else {
                showToast('Queue is empty', 'info');
            }
        };

        document.getElementById('reels-speed').oninput = (e) => {
            state.config.reelsSkipSpeed = parseInt(e.target.value);
            document.getElementById('reels-speed-val').textContent = (state.config.reelsSkipSpeed / 1000).toFixed(1) + 's';
            saveConfig();
        };

        document.getElementById('batch-size').onchange = (e) => {
            state.config.reelsBatchSize = parseInt(e.target.value) || 10;
            document.getElementById('batch-size-display').textContent = state.config.reelsBatchSize;
            saveConfig();
            updateDashboard();
        };

        dash.querySelectorAll('.method-btn').forEach(btn => {
            btn.onclick = () => {
                state.config.reelsSkipMethod = btn.dataset.method;
                saveConfig();
                dash.querySelectorAll('.method-btn').forEach(b => b.classList.toggle('active', b.dataset.method === state.config.reelsSkipMethod));
            };
        });

        // GitHub settings
        document.getElementById('opt-github-enabled').onchange = (e) => {
            state.config.githubSyncEnabled = e.target.checked;
            saveConfig();
            document.querySelector('.github-fields').classList.toggle('disabled', !e.target.checked);
        };

        document.getElementById('btn-github-save').onclick = () => {
            state.config.githubToken = document.getElementById('github-token').value;
            state.config.githubRepo = document.getElementById('github-repo').value;
            state.config.githubPath = document.getElementById('github-path').value || 'adnull_blocklist.csv';
            state.config.githubBranch = document.getElementById('github-branch').value || 'main';
            saveConfig();
            showToast('GitHub settings saved', 'success');
        };

        document.getElementById('btn-github-sync').onclick = syncToGitHub;

        // Tabs
        dash.querySelectorAll('.tab').forEach(tab => {
            tab.onclick = () => {
                dash.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                dash.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
            };
        });

        makeDraggable(dash);
        state.dashboardReady = true;
    }

    function updateDashboard() {
        if (!state.dashboardReady) return;

        const detected = document.getElementById('stat-detected');
        const blocked = document.getElementById('stat-blocked');
        const queue = document.getElementById('stat-queue');
        const failed = document.getElementById('stat-failed');
        const indicator = document.getElementById('status-indicator');
        const pageIcon = document.getElementById('page-icon');
        const pageLabel = document.getElementById('page-label');
        const retryBtn = document.getElementById('btn-retry');
        const pauseBtn = document.getElementById('btn-pause');
        const currentBlock = document.getElementById('current-block');
        const currentName = document.getElementById('current-name');
        const batchQueue = document.getElementById('batch-queue');
        const batchBar = document.getElementById('batch-bar');

        if (detected) detected.textContent = state.sessionDetected;
        if (blocked) blocked.textContent = state.totalBlocked;
        if (queue) queue.textContent = state.blockQueue.length;
        if (failed) failed.textContent = state.failedCount;
        if (pageIcon) pageIcon.textContent = getPageIcon();
        if (pageLabel) pageLabel.textContent = getPageLabel();

        if (retryBtn) {
            retryBtn.classList.toggle('hidden', state.failedCount === 0);
            retryBtn.textContent = `🔄 Retry ${state.failedCount} Failed`;
        }

        if (pauseBtn) {
            pauseBtn.textContent = state.isPaused ? '▶' : '⏸';
            pauseBtn.title = state.isPaused ? 'Resume' : 'Pause';
        }

        if (currentBlock && currentName) {
            if (state.currentBlockItem) {
                currentBlock.classList.remove('hidden');
                currentName.textContent = state.currentBlockItem.author;
            } else {
                currentBlock.classList.add('hidden');
            }
        }

        if (batchQueue) batchQueue.textContent = state.blockQueue.length;
        if (batchBar) batchBar.style.width = Math.min(100, (state.blockQueue.length / state.config.reelsBatchSize) * 100) + '%';

        if (indicator) {
            if (state.isBlocking) {
                indicator.textContent = 'Blocking';
                indicator.className = 'status-indicator blocking';
            } else if (state.isPaused) {
                indicator.textContent = 'Paused';
                indicator.className = 'status-indicator paused';
            } else if (state.isRunning) {
                indicator.textContent = 'Running';
                indicator.className = 'status-indicator running';
            } else {
                indicator.textContent = 'Ready';
                indicator.className = 'status-indicator';
            }
        }

        updateControls();
    }

    function updateDashboardStatus(text) {
        const status = document.getElementById('dash-status');
        if (status) status.textContent = text;
    }

    function updateControls() {
        const startBtn = document.getElementById('btn-start');
        const stopBtn = document.getElementById('btn-stop');
        if (startBtn && stopBtn) {
            startBtn.classList.toggle('hidden', state.isRunning);
            stopBtn.classList.toggle('hidden', !state.isRunning);
        }
    }

    function makeDraggable(el) {
        const header = el.querySelector('.panel-header');
        let isDragging = false, startX, startY, startRight, startTop;

        header.onmousedown = (e) => {
            if (e.target.classList.contains('close-btn')) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startRight = parseInt(el.style.right) || 20;
            startTop = parseInt(el.style.top) || 80;
        };

        document.onmousemove = (e) => {
            if (!isDragging) return;
            el.style.right = (startRight + startX - e.clientX) + 'px';
            el.style.top = (startTop + e.clientY - startY) + 'px';
        };

        document.onmouseup = () => {
            if (isDragging) {
                isDragging = false;
                state.config.dashboardPosition = { right: parseInt(el.style.right), top: parseInt(el.style.top) };
                saveConfig();
            }
        };
    }

    // ══════════════════════════════════════════════════════════════════════
    // STYLES
    // ══════════════════════════════════════════════════════════════════════
    function injectStyles() {
        GM_addStyle(`
            #adnull-dashboard { position: fixed; top: 80px; right: 20px; width: 320px; background: linear-gradient(145deg, #1a1a2e, #16162a); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 12px; color: white; z-index: 99999; box-shadow: 0 10px 40px rgba(0,0,0,0.5); display: flex; flex-direction: column; max-height: 650px; }
            #adnull-dashboard.minimized { height: 40px; overflow: hidden; }
            #adnull-dashboard.minimized .panel-body { display: none; }
            .hidden { display: none !important; }

            .panel-header { padding: 10px 12px; background: rgba(0,0,0,0.3); border-radius: 12px 12px 0 0; display: flex; justify-content: space-between; align-items: center; cursor: move; }
            .panel-header .title { font-weight: 600; color: #fa3e3e; }
            .close-btn { background: none; border: none; color: rgba(255,255,255,0.5); cursor: pointer; font-size: 16px; }
            .close-btn:hover { color: white; }
            .panel-body { flex: 1; overflow-y: auto; padding: 12px; }

            .tabs { display: flex; gap: 4px; margin-bottom: 12px; }
            .tab { flex: 1; padding: 6px; background: rgba(255,255,255,0.05); border: none; border-radius: 6px; cursor: pointer; font-size: 10px; color: rgba(255,255,255,0.6); transition: all 0.2s; }
            .tab:hover { background: rgba(255,255,255,0.1); }
            .tab.active { background: rgba(24,119,242,0.3); color: white; }
            .tab-content { display: none; }
            .tab-content.active { display: block; }

            .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 12px; }
            .stat-card { background: rgba(255,255,255,0.05); border-radius: 8px; padding: 8px 4px; text-align: center; }
            .stat-card.accent { background: rgba(24,119,242,0.2); }
            .stat-card.fail { background: rgba(250,62,62,0.2); }
            .stat-value { font-size: 16px; font-weight: 700; color: #fa3e3e; }
            .stat-card.accent .stat-value { color: #1877f2; }
            .stat-card.fail .stat-value { color: #ff6b6b; }
            .stat-label { font-size: 8px; color: rgba(255,255,255,0.5); text-transform: uppercase; }

            .speed-section { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; padding: 8px; background: rgba(0,0,0,0.2); border-radius: 6px; }
            .speed-label { font-size: 10px; color: rgba(255,255,255,0.6); }
            .speed-btns { display: flex; gap: 4px; flex: 1; }
            .speed-btn { flex: 1; padding: 6px; background: rgba(255,255,255,0.05); border: none; border-radius: 4px; cursor: pointer; font-size: 14px; transition: all 0.2s; }
            .speed-btn:hover { background: rgba(255,255,255,0.1); }
            .speed-btn.active { background: rgba(24,119,242,0.4); box-shadow: 0 0 8px rgba(24,119,242,0.5); }

            .control-row { display: flex; gap: 8px; margin-bottom: 12px; }
            .ctrl-btn { flex: 1; padding: 8px; border: none; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600; transition: all 0.2s; }
            .ctrl-btn.primary { background: #1877f2; color: white; }
            .ctrl-btn.danger { background: #fa3e3e; color: white; }
            .ctrl-btn:not(.primary):not(.danger) { background: rgba(255,255,255,0.1); color: white; }
            .ctrl-btn:hover { opacity: 0.9; transform: translateY(-1px); }

            .current-block { display: flex; align-items: center; gap: 8px; padding: 8px; background: rgba(247,185,40,0.2); border-radius: 6px; margin-bottom: 8px; }
            .cb-label { font-size: 10px; color: rgba(255,255,255,0.6); }
            .cb-name { flex: 1; font-size: 11px; font-weight: 600; color: #f7b928; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .cb-skip { padding: 4px 8px; background: rgba(255,255,255,0.1); border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 10px; }

            .status-bar { display: flex; align-items: center; gap: 8px; padding: 8px; background: rgba(0,0,0,0.2); border-radius: 6px; font-size: 11px; margin-bottom: 8px; }
            .status-indicator { margin-left: auto; padding: 2px 8px; border-radius: 4px; background: rgba(255,255,255,0.1); font-size: 10px; }
            .status-indicator.running { background: rgba(66,183,42,0.3); color: #42b72a; }
            .status-indicator.blocking { background: rgba(247,185,40,0.3); color: #f7b928; }
            .status-indicator.paused { background: rgba(255,165,0,0.3); color: orange; }

            .retry-btn { width: 100%; padding: 8px; background: rgba(250,62,62,0.2); border: 1px solid rgba(250,62,62,0.4); border-radius: 6px; color: white; cursor: pointer; font-size: 11px; margin-bottom: 8px; transition: all 0.2s; }
            .retry-btn:hover { background: rgba(250,62,62,0.3); }

            .dash-status { padding: 8px; background: rgba(0,0,0,0.2); border-radius: 6px; font-size: 10px; color: rgba(255,255,255,0.6); text-align: center; }

            .opt { display: flex; align-items: center; gap: 8px; padding: 8px 0; cursor: pointer; font-size: 11px; }
            .opt input[type="checkbox"] { width: 16px; height: 16px; accent-color: #1877f2; }

            .set-btn { display: block; width: 100%; padding: 8px; margin-top: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; cursor: pointer; font-size: 11px; color: white; transition: all 0.2s; }
            .set-btn:hover { background: rgba(255,255,255,0.15); }
            .set-btn.danger { background: rgba(250,62,62,0.2); border-color: rgba(250,62,62,0.4); }
            .set-btn.danger:hover { background: rgba(250,62,62,0.3); }

            .data-section { margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.1); }
            .data-section h4 { margin: 0 0 8px 0; font-size: 11px; color: rgba(255,255,255,0.7); }
            .data-section.danger { border: 1px solid rgba(250,62,62,0.3); padding: 12px; border-radius: 8px; background: rgba(250,62,62,0.05); }

            .reels-section { padding: 8px; background: rgba(0,0,0,0.2); border-radius: 8px; margin-bottom: 12px; }
            .reels-section.active { border: 1px solid rgba(66,183,42,0.5); }
            .reels-info { font-size: 10px; color: rgba(255,255,255,0.5); margin-bottom: 8px; text-align: center; }

            .batch-status { margin-bottom: 12px; }
            .batch-status span { font-size: 11px; color: rgba(255,255,255,0.7); }
            .batch-status strong { color: #1877f2; }
            .batch-progress { height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; margin-top: 6px; overflow: hidden; }
            .batch-bar { height: 100%; background: linear-gradient(90deg, #1877f2, #42b72a); border-radius: 2px; transition: width 0.3s; }

            .reels-settings { margin-top: 12px; }
            .setting-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
            .setting-row label { flex: 1; font-size: 10px; color: rgba(255,255,255,0.6); }
            .setting-row input[type="range"] { flex: 2; }
            .setting-row input[type="number"] { width: 60px; padding: 4px 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; color: white; font-size: 11px; }

            .method-btns { display: flex; gap: 4px; }
            .method-btn { padding: 4px 8px; background: rgba(255,255,255,0.05); border: none; border-radius: 4px; color: rgba(255,255,255,0.6); cursor: pointer; font-size: 10px; transition: all 0.2s; }
            .method-btn.active { background: rgba(24,119,242,0.3); color: white; }

            .github-section { padding: 8px; }
            .github-section h4 { margin: 0 0 8px 0; font-size: 12px; color: white; }
            .github-info { font-size: 10px; color: rgba(255,255,255,0.5); margin-bottom: 12px; }
            .github-fields { margin: 12px 0; }
            .github-fields.disabled { opacity: 0.5; pointer-events: none; }
            .field { margin-bottom: 10px; }
            .field label { display: block; font-size: 10px; color: rgba(255,255,255,0.6); margin-bottom: 4px; }
            .field input { width: 100%; padding: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color: white; font-size: 11px; }
            .field input::placeholder { color: rgba(255,255,255,0.3); }

            .adnull-toast { position: fixed; bottom: 20px; right: 20px; background: #1a1a2e; border: 1px solid rgba(255,255,255,0.1); padding: 10px 16px; border-radius: 8px; display: flex; align-items: center; gap: 8px; font-size: 12px; color: white; opacity: 0; transform: translateY(20px); transition: all 0.3s; z-index: 999999; }
            .adnull-toast.visible { opacity: 1; transform: translateY(0); }
            .adnull-toast.success { border-color: #42b72a; }
            .adnull-toast.error { border-color: #fa3e3e; }
            .adnull-toast.warning { border-color: #f7b928; }

            .adnull-tag { display: inline-flex; align-items: center; gap: 4px; background: linear-gradient(135deg, #fa3e3e, #d92d2d); color: white; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; margin-bottom: 8px; }
            .adnull-reel-tag { position: absolute; top: 60px; left: 10px; background: rgba(250,62,62,0.9); color: white; padding: 6px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; z-index: 1000; }

            .adnull-manual-block-btn { position: absolute; top: 8px; left: 8px; background: rgba(255, 68, 68, 0.85); color: white; border: none; border-radius: 6px; padding: 6px 12px; font-size: 11px; font-weight: bold; font-family: -apple-system, sans-serif; cursor: pointer; z-index: 1000; display: flex; align-items: center; gap: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.3); transition: all 0.2s ease; opacity: 0; }
            div[aria-posinset]:hover .adnull-manual-block-btn, div[role="article"]:hover .adnull-manual-block-btn, .adnull-manual-block-btn:hover { opacity: 1; }
            .adnull-manual-block-btn:hover { background: rgba(255, 40, 40, 1); transform: scale(1.05); }
            .adnull-manual-block-btn.blocked { background: rgba(76, 175, 80, 0.9); pointer-events: none; opacity: 1; }
            .adnull-manual-block-btn.queued { background: rgba(247, 185, 40, 0.9); pointer-events: none; opacity: 1; }

            .adnull-video-block-btn { position: absolute; bottom: 50px; right: 8px; background: rgba(255, 68, 68, 0.85); color: white; border: none; border-radius: 6px; padding: 6px 10px; font-size: 11px; font-weight: bold; cursor: pointer; z-index: 1000; display: flex; align-items: center; gap: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.4); transition: all 0.2s ease; opacity: 0; pointer-events: none; }
            div[aria-posinset]:hover .adnull-video-block-btn, div[role="article"]:hover .adnull-video-block-btn, [data-video-id]:hover .adnull-video-block-btn, .adnull-video-block-btn:hover { opacity: 1; pointer-events: auto; }
            .adnull-video-block-btn.blocked { background: rgba(76, 175, 80, 0.9); opacity: 1; }
            .adnull-video-block-btn.queued { background: rgba(247, 185, 40, 0.9); opacity: 1; }

            .adnull-reel-block-btn { position: absolute; top: 120px; left: 10px; background: rgba(255, 68, 68, 0.9); color: white; border: none; border-radius: 8px; padding: 8px 16px; font-size: 12px; font-weight: bold; cursor: pointer; z-index: 10000; display: flex; align-items: center; gap: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.4); transition: all 0.2s ease; }
            .adnull-reel-block-btn:hover { background: rgba(255, 40, 40, 1); transform: scale(1.05); }
            .adnull-reel-block-btn.blocked { background: rgba(76, 175, 80, 0.9); pointer-events: none; }
            .adnull-reel-block-btn.queued { background: rgba(247, 185, 40, 0.9); pointer-events: none; }

            .adnull-skip-notif { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.8); color: white; padding: 16px 24px; border-radius: 12px; display: flex; align-items: center; gap: 12px; font-size: 14px; font-weight: 600; z-index: 999999; animation: fadeInOut 1s ease-in-out; }
            @keyframes fadeInOut { 0% { opacity: 0; } 20% { opacity: 1; } 80% { opacity: 1; } 100% { opacity: 0; } }
        `);
    }

    // ══════════════════════════════════════════════════════════════════════
    // URL CHANGE DETECTION
    // ══════════════════════════════════════════════════════════════════════
    let lastUrl = location.href;

    function checkUrlChange() {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            console.log('[AdNull] URL changed:', location.href.substring(0, 50));
            updateDashboard();
            if (state.config.showManualBlockButtons !== false) {
                setTimeout(injectAllBlockButtons, 500);
            }
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    // MENU COMMANDS
    // ══════════════════════════════════════════════════════════════════════
    GM_registerMenuCommand('🚀 Start Scanner', startScanner);
    GM_registerMenuCommand('⏹ Stop Scanner', stopScanner);
    GM_registerMenuCommand('📤 Export Data', exportCSV);
    GM_registerMenuCommand('🔄 Import Foundation', () => importFoundation(true));
    GM_registerMenuCommand('☁️ Sync to GitHub', syncToGitHub);

    // ══════════════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ══════════════════════════════════════════════════════════════════════
    async function init() {
        await loadState();

        if (isBlockingPopup() && isProfilePage()) {
            console.log('[AdNull] Running as blocking popup');
            runBlockingPopup();
            return;
        }

        if (!isScanablePage()) {
            console.log('[AdNull] Not a scanable page, skipping dashboard');
            return;
        }

        console.log('[AdNull] Initializing | Page type:', getPageType());

        injectStyles();

        const waitForBody = () => {
            if (document.body) {
                createDashboard();
                if (state.config.autoImportFoundation && !state.foundationImported) setTimeout(() => importFoundation(), 2000);
                if (state.config.autoStart) setTimeout(startScanner, 1000);
                setInterval(checkUrlChange, 500);

                // AUTO-RESTART SKIPPER if it was running before page refresh
                const savedSkipperState = GM_getValue('skipperActive', false);
                if (savedSkipperState && getPageType() === 'reels') {
                    console.log('[AdNull] Restarting skipper after page refresh...');
                    setTimeout(() => {
                        startReelsSkipper();
                        showToast('Skipper auto-restarted', 'success');
                    }, 2000); // Give page time to fully load
                }
            } else {
                requestAnimationFrame(waitForBody);
            }
        };
        waitForBody();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();