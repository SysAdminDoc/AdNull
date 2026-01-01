// ==UserScript==
// @name         Facebook AdNull Blocker
// @namespace    http://tampermonkey.net/
// @version      5.5
// @description  Block buttons on ALL posts & reels, auto-skip sponsored reels, separate export for manual vs auto-detected.
// @author       Matthew Parker
// @match        https://www.facebook.com/*
// @match        https://m.facebook.com/*
// @match        https://web.facebook.com/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_openInTab
// @grant        window.close
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ==================== CONFIGURATION ====================
    const CONFIG = {
        debug: true,
        scanInterval: 500,
        reelsScanInterval: 1500,  // Slower for reels (they auto-advance)
        dashboardRows: 150,

        // Speed presets (scroll delay in ms, scroll amount in px)
        speeds: {
            slow:   { delay: 3000, amount: 600 },
            normal: { delay: 2000, amount: 900 },
            fast:   { delay: 1200, amount: 1200 },
            turbo:  { delay: 600,  amount: 1500 }
        },
        currentSpeed: 'normal',

        // End of feed detection
        noNewContentThreshold: 5,
        refreshCooldown: 10000,

        // Blocking settings
        pollInterval: 100,
        maxPolls: 80,
        tabOpenDelay: 1500,

        // Colors
        colors: {
            sponsored: '#ff4444',
            reelSponsored: '#ff6600',
            blocked: '#4CAF50'
        }
    };

    // ==================== STATE ====================
    const state = {
        // Master log - persisted
        masterLog: [],
        masterLogUrls: new Set(),

        // Session state
        blockedSponsors: new Set(),
        blockQueue: [],
        sessionDetected: 0,
        manualBlocks: 0,
        totalBlocked: 0,
        isGroupFeed: false,
        isRunning: false,
        isBlocking: false,

        // Feed end detection
        lastScrollHeight: 0,
        noNewContentCount: 0,
        lastRefreshTime: 0,

        // Reels tracking
        lastReelVideoId: null,
        processedReelIds: new Set()
    };

    // ==================== UTILS ====================
    function log(msg, ...args) {
        if (CONFIG.debug) console.log(`[FB Scanner] ${msg}`, ...args);
    }

    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    function waitFor(fn, tries = CONFIG.maxPolls, interval = CONFIG.pollInterval) {
        return new Promise((resolve, reject) => {
            let count = 0;
            const t = setInterval(() => {
                count++;
                try {
                    const val = fn();
                    if (val) { clearInterval(t); resolve(val); }
                    else if (count >= tries) { clearInterval(t); reject(new Error("Timed out")); }
                } catch (e) { clearInterval(t); reject(e); }
            }, interval);
        });
    }

    function isVisible(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    }

    function formatDate(ts) {
        const d = new Date(ts);
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
    }

    // ==================== PAGE DETECTION ====================
    function isFeedPage() {
        const path = location.pathname;
        return path === '/' || path === '/home' || path === '/home.php' || path.length <= 1;
    }

    function isReelsPage() {
        const path = location.pathname;
        return path.startsWith('/reel') || path.includes('/reels');
    }

    function isProfilePage() {
        const path = location.pathname;
        if (/^\/(watch|reel|marketplace|groups|gaming|events|pages|ads|saved|home)/.test(path)) return false;
        return /\/(profile\.php|[^\/]+\/?$)/.test(path);
    }

    function isBlockingTab() {
        return location.search.includes('__autoblock=1') || sessionStorage.getItem('fb_autoblock_active') === '1';
    }

    function isScanablePage() {
        return isFeedPage() || isReelsPage();
    }

    // ==================== PERSISTENCE ====================
    function loadMasterLog() {
        try {
            const saved = GM_getValue('fb_master_log_v50', '[]');
            state.masterLog = JSON.parse(saved);
            state.masterLogUrls = new Set(state.masterLog.map(e => e.url));
            log(`Loaded ${state.masterLog.length} entries from master log`);
        } catch(e) {
            state.masterLog = [];
            state.masterLogUrls = new Set();
        }
    }

    function saveMasterLog() {
        GM_setValue('fb_master_log_v50', JSON.stringify(state.masterLog));
    }

    function loadBlockedList() {
        try {
            const saved = GM_getValue('fb_blocked_sponsors_v50', '[]');
            const list = JSON.parse(saved);
            state.blockedSponsors = new Set(list);
            state.totalBlocked = list.length;
            log(`Loaded ${list.length} blocked sponsors`);
        } catch(e) {
            state.blockedSponsors = new Set();
        }
    }

    function saveBlockedList() {
        GM_setValue('fb_blocked_sponsors_v50', JSON.stringify(Array.from(state.blockedSponsors)));
    }

    function loadSpeed() {
        CONFIG.currentSpeed = GM_getValue('fb_scan_speed_v50', 'normal');
    }

    function saveSpeed() {
        GM_setValue('fb_scan_speed_v50', CONFIG.currentSpeed);
    }

    function shouldAutoStart() {
        return GM_getValue('fb_autostart_v50', false);
    }

    function setAutoStart(v) {
        GM_setValue('fb_autostart_v50', v);
    }

    function loadDashboardPosition() {
        try {
            const saved = GM_getValue('fb_dash_position_v51', null);
            if (saved) {
                return JSON.parse(saved);
            }
        } catch(e) {}
        return null; // Use default position
    }

    function saveDashboardPosition(x, y) {
        GM_setValue('fb_dash_position_v51', JSON.stringify({ x, y }));
    }

    function addToMasterLog(data) {
        if (state.masterLogUrls.has(data.authorUrl)) {
            log(`Duplicate skipped: ${data.authorUrl}`);
            return false;
        }

        const entry = {
            url: data.authorUrl,
            author: data.author,
            content: data.content || '',
            source: data.source || 'feed',  // 'feed' or 'reel'
            timestamp: Date.now(),
            blocked: false
        };

        state.masterLog.unshift(entry);
        state.masterLogUrls.add(data.authorUrl);
        saveMasterLog();
        return true;
    }

    function markAsBlockedInLog(url) {
        for (const entry of state.masterLog) {
            if (entry.url === url) {
                entry.blocked = true;
                break;
            }
        }
        saveMasterLog();
    }

    // ==================== EXPORT ====================
    function exportMasterLog(filter = 'all') {
        let entries = state.masterLog;

        // Filter if requested
        if (filter === 'auto') {
            entries = entries.filter(e => {
                const source = e.source || 'feed';
                return !source.includes('manual') && source !== 'console' && source !== 'import';
            });
        } else if (filter === 'manual') {
            entries = entries.filter(e => {
                const source = e.source || 'feed';
                return source.includes('manual') || source === 'console';
            });
        }

        const csv = [
            ['Author', 'URL', 'Content', 'Source', 'Type', 'Date Detected', 'Blocked'].join(','),
            ...entries.map(e => {
                // Determine if it was manual or auto-detected
                const source = e.source || 'feed';
                const isManual = source.includes('manual') || source === 'console' || source === 'import';
                const type = isManual ? 'Manual' : 'Auto-detected';

                return [
                    `"${(e.author || '').replace(/"/g, '""')}"`,
                    e.url,
                    `"${(e.content || '').replace(/"/g, '""')}"`,
                    source,
                    type,
                    formatDate(e.timestamp),
                    e.blocked ? 'Yes' : 'No'
                ].join(',');
            })
        ].join('\n');

        const filterLabel = filter === 'all' ? '' : `_${filter}`;
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `fb_sponsors${filterLabel}_${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);

        log(`Exported ${entries.length} entries (filter: ${filter})`);
    }

    // ==================== IMPORT ====================
    function importMasterLog(file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const csv = e.target.result;
            const lines = csv.split('\n');

            if (lines.length < 2) {
                alert('Invalid CSV file - no data found');
                return;
            }

            let imported = 0;
            let skipped = 0;
            let queued = 0;

            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                const fields = parseCSVLine(line);
                if (fields.length < 2) continue;

                const author = fields[0].replace(/^"|"$/g, '').replace(/""/g, '"');
                const url = fields[1].trim();
                const content = fields[2] ? fields[2].replace(/^"|"$/g, '').replace(/""/g, '"') : '';

                if (!url || !url.includes('facebook.com')) {
                    skipped++;
                    continue;
                }

                if (state.masterLogUrls.has(url)) {
                    skipped++;
                    continue;
                }

                const entry = {
                    url: url,
                    author: author || 'Imported',
                    content: content,
                    source: 'import',
                    timestamp: Date.now(),
                    blocked: false
                };

                state.masterLog.unshift(entry);
                state.masterLogUrls.add(url);
                imported++;

                addToDashboard({ authorUrl: url, author: entry.author, content: content }, 'pending');

                if (!state.blockedSponsors.has(url)) {
                    state.blockQueue.push({ url: url, author: entry.author });
                    queued++;
                }
            }

            saveMasterLog();
            updateDashboardCounts();

            alert(`Import complete!\n\nImported: ${imported}\nSkipped (duplicates): ${skipped}\nQueued for blocking: ${queued}`);
            log(`Imported ${imported} entries, ${queued} queued for blocking`);

            if (queued > 0 && state.isRunning && !state.isBlocking) {
                processBlockQueue();
            }
        };
        reader.readAsText(file);
    }

    function parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = line[i + 1];

            if (char === '"' && inQuotes && nextChar === '"') {
                current += '"';
                i++;
            } else if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current);
        return result;
    }

    // ==================== FEED DETECTION LOGIC ====================
    function checkContext() {
        const path = window.location.pathname;
        state.isGroupFeed = path.includes('/groups/') && !path.includes('/groups/feed/');
    }

    function isSponsored(post) {
        // 1. REEL SPECIFIC CHECK (<span dir="auto">Sponsored</span>)
        const autoSpans = post.querySelectorAll('span[dir="auto"]');
        for (const span of autoSpans) {
            if (span.innerText === 'Sponsored') return true;
        }

        // 2. Structural check for tracking params (exclude groups/events)
        const adLinks = Array.from(post.querySelectorAll('a[href*="__cft__[0]="]'));
        for (let link of adLinks) {
            if (!link.href.includes('/groups/') && !link.href.includes('/events/')) {
                return true;
            }
        }

        // 3. Shadow Root / Aria LabelledBy
        const elCanvas = post.querySelector('a > span > span[aria-labelledby] > canvas');
        if (elCanvas) {
            const id = elCanvas.parentElement.getAttribute('aria-labelledby');
            if (id) {
                const escapedId = id.replace(/(:)/g, '\\$1');
                const elLabel = document.querySelector(`[id="${escapedId}"]`);
                if (elLabel && /Sponsored|Sponsorisé|Publicidad/i.test(elLabel.innerText)) return true;
            }
        }

        // 4. Aria Label Fallback
        const els = post.querySelectorAll('span, a, div[aria-label]');
        for (let el of els) {
            if (el.getAttribute('aria-label') === 'Sponsored') return true;
        }

        // 5. Link to Ad Preferences
        if (post.querySelector('a[href*="/ads/about"]')) return true;
        if (post.querySelector('a[href*="/ads/preferences"]')) return true;

        return false;
    }

    function identifyPostType(post) {
        if (state.isGroupFeed) return 'group';
        const headers = post.querySelectorAll('h2 a, h3 a, h4 a, strong a');
        for (let link of headers) {
            if (link.href.includes('/groups/')) return 'group';
        }
        if (isSponsored(post)) return 'sponsored';
        const text = post.innerText.substring(0, 300);
        if (/Suggested for you|Reels and short videos|Follow|Join/i.test(text)) {
            return 'suggested';
        }
        return 'normal';
    }

    // ==================== REELS DETECTION LOGIC ====================

    /**
     * Detects if the current reel is sponsored
     *
     * SPONSORED REELS indicators:
     * 1. Profile link has target="_blank" (regardless of URL format)
     * 2. Contains "Sponsored" text label
     * 3. Contains external product/shop links
     *
     * NON-SPONSORED REELS:
     * - Profile link has target="_self"
     * - Links to personal profiles or Instagram redirects
     */
    function isReelSponsored(reelContainer) {
        // Method 1: Check for explicit "Sponsored" text
        const allText = reelContainer.innerText || '';
        if (/\bSponsored\b/i.test(allText)) {
            log('Sponsored reel detected: "Sponsored" text found');
            return true;
        }

        // Method 2: Check for external shop/product links (not facebook.com)
        const externalLinks = reelContainer.querySelectorAll('a[href*="fbclid"]');
        for (const link of externalLinks) {
            const href = link.href || '';
            if (!href.includes('facebook.com') && !href.includes('l.facebook.com')) {
                log('Sponsored reel detected: external product link found');
                return true;
            }
        }

        // Method 3: Profile link with target="_blank" is sponsored
        // This works for both /PageName and /profile.php?id= formats
        const profileLink = reelContainer.querySelector('a[aria-label="See Owner Profile"]');
        if (profileLink) {
            const target = profileLink.getAttribute('target') || '';
            const href = profileLink.getAttribute('href') || '';

            // target="_blank" indicates sponsored (user stays on reels, link opens in new tab)
            if (target === '_blank' && href.includes('__cft__')) {
                log('Sponsored reel detected: target="_blank" with tracking params');
                return true;
            }
        }

        // Method 4: Check for "Shop now" or similar CTA buttons
        const ctaButtons = reelContainer.querySelectorAll('a[role="link"]');
        for (const btn of ctaButtons) {
            const text = btn.innerText?.toLowerCase() || '';
            if (/shop now|learn more|sign up|get offer|buy now|order now/i.test(text)) {
                log('Sponsored reel detected: CTA button found');
                return true;
            }
        }

        return false;
    }

    function extractReelSponsorData(reelContainer) {
        const data = {
            author: 'Unknown',
            authorUrl: null,
            content: '',
            source: 'reel'
        };

        // Find the profile link
        const profileLink = reelContainer.querySelector('a[aria-label="See Owner Profile"]');
        if (!profileLink) return data;

        const href = profileLink.getAttribute('href') || '';

        // Extract clean URL
        try {
            let url;
            if (href.startsWith('http')) {
                url = new URL(href);
            } else {
                url = new URL('https://www.facebook.com' + href);
            }

            // Handle profile.php?id= format
            if (url.pathname.includes('profile.php') && url.searchParams.has('id')) {
                const profileId = url.searchParams.get('id');
                data.authorUrl = `https://www.facebook.com/profile.php?id=${profileId}`;
            } else {
                // Handle /PageName format
                const pathParts = url.pathname.split('/').filter(p => p);
                if (pathParts.length >= 1) {
                    const pageName = pathParts[0];
                    if (/^[a-zA-Z0-9._-]+$/.test(pageName) &&
                        !['profile.php', 'watch', 'reel', 'reels', 'groups'].includes(pageName)) {
                        data.authorUrl = `https://www.facebook.com/${pageName}`;
                    }
                }
            }
        } catch(e) {}

        // Find author name - look for h2 or strong text near the profile link
        const nameEl = reelContainer.querySelector('h2 a[aria-label="See Owner Profile"]') ||
                       reelContainer.querySelector('h2 span') ||
                       reelContainer.querySelector('a[aria-label="See Owner Profile"] + div span');
        if (nameEl) {
            const text = nameEl.innerText?.trim();
            if (text && text.length < 100) {
                data.author = text.split('\n')[0];
            }
        }

        // Fallback: Try to get name from any h2 in the container
        if (data.author === 'Unknown') {
            const h2 = reelContainer.querySelector('h2');
            if (h2) {
                const text = h2.innerText?.trim();
                if (text && text.length < 100) {
                    data.author = text.split('\n')[0];
                }
            }
        }

        // Get video description if available
        const descEl = reelContainer.querySelector('div[dir="auto"]:not([class*="button"])');
        if (descEl) {
            const text = descEl.innerText;
            if (text && !text.includes('Shop now') && !text.includes('Sponsored')) {
                data.content = text.substring(0, 80);
            }
        }

        return data;
    }

    function getCurrentReelContainer() {
        // Reels have a container with data-video-id
        // Find the one that's currently visible (in viewport)
        const reelContainers = document.querySelectorAll('[data-video-id]');

        for (const container of reelContainers) {
            const rect = container.getBoundingClientRect();
            // Check if it's roughly centered on screen (active reel)
            if (rect.top > -100 && rect.top < 300 && rect.height > 400) {
                return container;
            }
        }

        // Fallback: return first visible one
        for (const container of reelContainers) {
            if (isVisible(container)) {
                return container;
            }
        }

        return null;
    }

    function scanReels() {
        if (!isReelsPage()) return;

        const reelContainer = getCurrentReelContainer();
        if (!reelContainer) return;

        const videoId = reelContainer.getAttribute('data-video-id');
        if (!videoId) return;

        // Skip if already processed this reel
        if (state.processedReelIds.has(videoId)) return;
        state.processedReelIds.add(videoId);

        log(`Scanning reel: ${videoId}`);

        // Check if sponsored
        if (isReelSponsored(reelContainer)) {
            const data = extractReelSponsorData(reelContainer);

            if (!data.authorUrl) {
                log('Sponsored reel but could not extract URL');
                return;
            }

            log(`SPONSORED REEL FOUND: ${data.author} - ${data.authorUrl}`);
            state.reelsDetected++;

            // Tag visually
            tagReelVisuals(reelContainer);

            // Skip to next reel immediately
            skipReel();

            // Add to master log
            const isNew = addToMasterLog(data);

            if (isNew) {
                state.sessionDetected++;
                addToDashboard(data, 'pending');

                if (!state.blockedSponsors.has(data.authorUrl)) {
                    state.blockQueue.push({ url: data.authorUrl, author: data.author });
                }

                updateDashboardCounts();

                if (state.isRunning && !state.isBlocking) {
                    processBlockQueue();
                }
            }
        } else {
            log(`Reel ${videoId} is not sponsored`);
        }
    }

    function tagReelVisuals(reelContainer) {
        if (reelContainer.querySelector('.fb-reel-tag')) return;

        const tag = document.createElement('div');
        tag.className = 'fb-reel-tag';
        tag.innerText = '🚫 SPONSORED REEL';
        tag.style.cssText = `
            position: absolute;
            top: 60px;
            left: 10px;
            background: ${CONFIG.colors.reelSponsored};
            color: white;
            padding: 8px 16px;
            border-radius: 8px;
            font-weight: bold;
            font-family: -apple-system, sans-serif;
            font-size: 14px;
            z-index: 10000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        `;

        if (getComputedStyle(reelContainer).position === 'static') {
            reelContainer.style.position = 'relative';
        }
        reelContainer.appendChild(tag);
    }

    function skipReel() {
        // Show skip notification
        const notification = document.createElement('div');
        notification.innerText = '⏭️ SKIPPING AD';
        notification.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(255, 68, 68, 0.9);
            color: white;
            padding: 20px 40px;
            border-radius: 12px;
            font-size: 24px;
            font-weight: bold;
            font-family: -apple-system, sans-serif;
            z-index: 100000;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5);
            animation: skipFade 0.8s ease-out forwards;
        `;
        document.body.appendChild(notification);

        // Add animation style if not exists
        if (!document.getElementById('skip-animation-style')) {
            const style = document.createElement('style');
            style.id = 'skip-animation-style';
            style.textContent = `
                @keyframes skipFade {
                    0% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
                    70% { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
                    100% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
                }
            `;
            document.head.appendChild(style);
        }

        // Remove notification after animation
        setTimeout(() => notification.remove(), 800);

        // Simulate Arrow Down key press to skip to next reel
        const event = new KeyboardEvent('keydown', {
            key: 'ArrowDown',
            code: 'ArrowDown',
            keyCode: 40,
            which: 40,
            bubbles: true,
            cancelable: true
        });
        document.dispatchEvent(event);
        log('Skipped sponsored reel (Arrow Down)');
    }

    // ==================== DATA EXTRACTION ====================
    function scrapePostData(post, type) {
        const data = {
            id: null,
            type: type,
            author: 'Unknown',
            authorUrl: null,
            content: '',
            source: 'feed'
        };

        const posInset = post.getAttribute('aria-posinset');
        data.id = posInset ? `pos_${posInset}` : 'gen_' + Math.random().toString(36).substr(2, 9);

        const headerLinks = post.querySelectorAll('h2 a, h3 a, h4 a, strong a');
        for (const link of headerLinks) {
            const href = link.href;
            if (href.includes('/groups/') || href.includes('/events/') ||
                href.includes('/ads/') || href.includes('/watch/') ||
                href.includes('/reel/') || href.includes('/photo/') ||
                href.includes('/video/') || href.includes('#')) continue;

            try {
                const url = new URL(href);
                const parts = url.pathname.split('/').filter(p => p);
                if (parts.length >= 1) {
                    const username = parts[0];
                    if (/^[a-zA-Z0-9._-]+$/.test(username) &&
                        !['home', 'watch', 'marketplace', 'gaming', 'events', 'pages', 'groups'].includes(username)) {
                        data.author = link.innerText || username;
                        data.authorUrl = `https://www.facebook.com/${username}`;
                        break;
                    }
                    if (username === 'profile.php' && url.searchParams.has('id')) {
                        data.author = link.innerText || 'Profile';
                        data.authorUrl = `https://www.facebook.com/profile.php?id=${url.searchParams.get('id')}`;
                        break;
                    }
                }
            } catch(e) {}
        }

        const contentDiv = post.querySelector('div[dir="auto"]');
        if (contentDiv) {
            data.content = contentDiv.innerText.substring(0, 80).replace(/\n/g, ' ');
        }

        return data;
    }

    // ==================== BLOCKING LOGIC ====================
    function findProfileMenuButton() {
        const wanted = ["profile settings", "see more options", "more options"];
        for (const el of document.querySelectorAll('div[role="button"][aria-haspopup="menu"]')) {
            const label = (el.getAttribute("aria-label") || "").toLowerCase();
            if (wanted.some(w => label.includes(w))) return el;
        }
        return null;
    }

    function findBlockMenuItem() {
        for (const menu of document.querySelectorAll('div[role="menu"]')) {
            for (const item of menu.querySelectorAll('[role="menuitem"]')) {
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
        try {
            const menuBtn = await waitFor(findProfileMenuButton, 160);
            menuBtn.click();
            await sleep(500);

            const blockItem = await waitFor(findBlockMenuItem);
            blockItem.click();
            await sleep(500);

            const dialog = await waitFor(findBlockDialog);
            const confirmBtn = await waitFor(() => findButtonInDialog(dialog, 'Confirm'));
            confirmBtn.click();
            await sleep(1000);

            const successDialog = await waitFor(() => {
                for (const d of document.querySelectorAll('[role="dialog"]')) {
                    if (isVisible(d) && /you blocked/i.test(d.textContent)) return d;
                }
                return null;
            });
            const closeBtn = await waitFor(() => findButtonInDialog(successDialog, 'Close'));
            closeBtn.click();

            return true;
        } catch(e) {
            log('Block failed:', e.message);
            return false;
        }
    }

    async function runBlockingTab() {
        sessionStorage.setItem('fb_autoblock_active', '1');

        const overlay = document.createElement('div');
        overlay.innerHTML = `<div style="position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:999999;
            display:flex;align-items:center;justify-content:center;">
            <div style="background:#1a1a2e;color:white;padding:40px;border-radius:20px;text-align:center;">
                <div style="font-size:50px;margin-bottom:20px;">🚫</div>
                <div id="block-status" style="font-size:20px;font-weight:bold;">Blocking...</div>
            </div></div>`;
        document.body.appendChild(overlay);

        await sleep(CONFIG.tabOpenDelay);
        const success = await executeBlockSequence();

        document.getElementById('block-status').textContent = success ? '✓ BLOCKED!' : '✗ Failed';
        document.getElementById('block-status').style.color = success ? '#4CAF50' : '#f44336';

        GM_setValue('fb_block_complete_signal', Date.now());
        log('Signaled completion to main tab');

        await sleep(1000);

        const tryClose = () => {
            try { window.close(); } catch(e) {}
            try { self.close(); } catch(e) {}
        };

        tryClose();
        setTimeout(tryClose, 300);
        setTimeout(tryClose, 600);

        setTimeout(() => {
            document.body.innerHTML = `
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                    height:100vh;background:#111;color:#4CAF50;font-family:sans-serif;text-align:center;">
                    <div style="font-size:48px;margin-bottom:20px;">✓</div>
                    <div style="font-size:24px;margin-bottom:10px;">Blocked Successfully</div>
                    <div style="color:#888;font-size:14px;">You can close this tab</div>
                </div>
            `;
        }, 1500);
    }

    async function processBlockQueue() {
        if (state.isBlocking || state.blockQueue.length === 0) return;

        state.isBlocking = true;
        const sponsor = state.blockQueue.shift();

        log(`Blocking: ${sponsor.url}`);
        updateDashboardStatus(`🔄 Blocking: ${sponsor.author}...`);
        updateRowStatus(sponsor.url, 'blocking');

        state.blockedSponsors.add(sponsor.url);
        state.totalBlocked++;
        saveBlockedList();
        markAsBlockedInLog(sponsor.url);

        GM_setValue('fb_block_complete_signal', 0);

        const blockUrl = sponsor.url + (sponsor.url.includes('?') ? '&' : '?') + '__autoblock=1';

        let blockTab = null;
        if (typeof GM_openInTab !== 'undefined') {
            // Open in background so we stay on current page
            blockTab = GM_openInTab(blockUrl, { active: false, setParent: true });
        } else {
            window.open(blockUrl, '_blank');
        }

        const startTime = Date.now();
        const startSignal = GM_getValue('fb_block_complete_signal', 0);

        while (Date.now() - startTime < 30000) {
            await sleep(500);

            const currentSignal = GM_getValue('fb_block_complete_signal', 0);
            if (currentSignal > startSignal) {
                log('Blocking tab signaled completion');
                if (blockTab && typeof blockTab.close === 'function') {
                    try { blockTab.close(); } catch(e) {}
                }
                break;
            }

            if (blockTab && blockTab.closed) {
                log('Blocking tab closed');
                break;
            }
        }

        if (blockTab && typeof blockTab.close === 'function' && !blockTab.closed) {
            try { blockTab.close(); } catch(e) {}
        }

        updateRowStatus(sponsor.url, 'blocked');
        state.isBlocking = false;
        updateDashboardStatus(state.isRunning ? '📜 Scanning...' : 'Idle');
        updateDashboardCounts();

        await sleep(1500);

        if (state.blockQueue.length > 0 && state.isRunning) {
            processBlockQueue();
        }
    }

    // ==================== FEED END DETECTION ====================
    function checkFeedEnd() {
        // Only applies to feed, not reels
        if (isReelsPage()) return false;

        const currentHeight = document.documentElement.scrollHeight;

        if (currentHeight === state.lastScrollHeight) {
            state.noNewContentCount++;
            log(`No new content (${state.noNewContentCount}/${CONFIG.noNewContentThreshold})`);

            if (state.noNewContentCount >= CONFIG.noNewContentThreshold) {
                const now = Date.now();
                if (now - state.lastRefreshTime >= CONFIG.refreshCooldown) {
                    log('Feed end detected - refreshing...');
                    updateDashboardStatus('🔄 Refreshing feed...');
                    state.lastRefreshTime = now;
                    setAutoStart(true);

                    setTimeout(() => {
                        location.reload();
                    }, 1000);
                    return true;
                }
            }
        } else {
            state.noNewContentCount = 0;
            state.lastScrollHeight = currentHeight;
        }

        return false;
    }

    // ==================== GUI / DASHBOARD ====================
    function initDashboard() {
        if (document.getElementById('fb-foundation-dash')) return;

        const dash = document.createElement('div');
        dash.id = 'fb-foundation-dash';
        dash.innerHTML = `
            <div class="dash-header" id="dash-drag-handle">
                <h3>🚫 Sponsor Blocker v5.5</h3>
                <div class="dash-controls">
                    <button id="dash-start" class="dash-btn start">▶ Start</button>
                    <button id="dash-stop" class="dash-btn stop" style="display:none;">⏹ Stop</button>
                </div>
            </div>
            <div class="dash-status" id="dash-status">Ready - Click Start</div>

            <!-- Mode indicator -->
            <div class="dash-mode" id="dash-mode">
                📺 Mode: <span id="mode-text">${isReelsPage() ? 'REELS' : 'FEED'}</span>
            </div>

            <!-- Speed Controls -->
            <div class="dash-speed">
                <span>Speed:</span>
                <button class="speed-btn" data-speed="slow">🐢</button>
                <button class="speed-btn" data-speed="normal">🚶</button>
                <button class="speed-btn" data-speed="fast">🏃</button>
                <button class="speed-btn" data-speed="turbo">🚀</button>
                <input type="file" id="dash-import-file" accept=".csv" style="display:none;">
                <button id="dash-import" class="import-btn" title="Import CSV">📤</button>
                <button id="dash-export" class="export-btn" title="Export CSV">📥</button>
            </div>

            <div class="dash-stats">
                <div class="stat-box">
                    <div class="stat-num" id="stat-total">0</div>
                    <div class="stat-label">Total</div>
                </div>
                <div class="stat-box">
                    <div class="stat-num" id="stat-manual">0</div>
                    <div class="stat-label">Manual</div>
                </div>
                <div class="stat-box">
                    <div class="stat-num" id="stat-blocked">0</div>
                    <div class="stat-label">Blocked</div>
                </div>
                <div class="stat-box">
                    <div class="stat-num" id="stat-queue">0</div>
                    <div class="stat-label">Queue</div>
                </div>
            </div>
            <div class="dash-body">
                <table id="dash-table">
                    <thead>
                        <tr>
                            <th width="25%">Sponsor</th>
                            <th width="35%">Snippet</th>
                            <th width="15%">Source</th>
                            <th width="25%">Status</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
            </div>
        `;

        GM_addStyle(`
            #fb-foundation-dash {
                position: fixed; width: 500px; height: 520px;
                background: #111; color: #eee; border: 1px solid #ff4444; border-radius: 8px;
                font-family: -apple-system, sans-serif; z-index: 9999; display: flex; flex-direction: column;
                box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                user-select: none;
            }
            .dash-header {
                padding: 10px 12px; background: #1a1a1a; border-bottom: 1px solid #333;
                display: flex; justify-content: space-between; align-items: center;
                border-radius: 8px 8px 0 0;
                cursor: move;
            }
            .dash-header:active { cursor: grabbing; }
            .dash-header h3 { margin: 0; color: #ff4444; font-size: 14px; font-weight: bold; }
            .dash-controls { display: flex; gap: 6px; }
            .dash-btn {
                padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer;
                font-weight: bold; font-size: 11px;
            }
            .dash-btn.start { background: #4CAF50; color: white; }
            .dash-btn.stop { background: #f44336; color: white; }
            .dash-btn:hover { opacity: 0.9; }

            .dash-status {
                padding: 8px 12px; background: #0a0a0a; color: #888; font-size: 11px;
                border-bottom: 1px solid #222;
            }

            .dash-mode {
                padding: 6px 12px; background: #1a1a2e; color: #aaa; font-size: 11px;
                border-bottom: 1px solid #222;
            }
            .dash-mode #mode-text { color: #ff6600; font-weight: bold; }

            .dash-speed {
                padding: 8px 12px; background: #0f0f0f; border-bottom: 1px solid #222;
                display: flex; align-items: center; gap: 6px; font-size: 11px;
            }
            .dash-speed span { color: #666; }
            .speed-btn {
                padding: 4px 8px; border: 1px solid #333; background: #1a1a1a;
                border-radius: 4px; cursor: pointer; font-size: 12px;
            }
            .speed-btn:hover { background: #2a2a2a; }
            .speed-btn.active { border-color: #ff4444; background: #2a1a1a; }
            .export-btn {
                padding: 4px 10px; border: 1px solid #4CAF50;
                background: #1a2a1a; border-radius: 4px; cursor: pointer; font-size: 12px;
            }
            .export-btn:hover { background: #2a3a2a; }
            .import-btn {
                padding: 4px 10px; border: 1px solid #2196F3;
                background: #1a1a2a; border-radius: 4px; cursor: pointer; font-size: 12px;
                margin-left: auto;
            }
            .import-btn:hover { background: #1a2a3a; }

            .dash-stats {
                display: flex; padding: 8px; gap: 6px; background: #0f0f0f;
                border-bottom: 1px solid #222;
            }
            .stat-box {
                flex: 1; text-align: center; padding: 6px; background: #1a1a1a;
                border-radius: 6px;
            }
            .stat-num { font-size: 16px; font-weight: bold; color: #ff4444; }
            .stat-label { font-size: 8px; color: #666; text-transform: uppercase; margin-top: 2px; }

            .dash-body { flex: 1; overflow-y: auto; padding: 0; }
            #dash-table { width: 100%; border-collapse: collapse; font-size: 10px; }
            #dash-table th {
                text-align: left; padding: 6px; background: #1a1a1a;
                position: sticky; top: 0; border-bottom: 1px solid #333; color: #666;
            }
            #dash-table td {
                padding: 5px 6px; border-bottom: 1px solid #222;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 0;
            }
            #dash-table a { color: #ff8888; text-decoration: none; }
            #dash-table a:hover { text-decoration: underline; }

            .status-pending { color: #ff9800; }
            .status-blocking { color: #2196F3; }
            .status-blocked { color: #4CAF50; }
            .status-known { color: #666; font-style: italic; }

            .source-feed { color: #888; }
            .source-reel { color: #ff6600; }
            .source-import { color: #2196F3; }
            .source-feed-manual { color: #e91e63; }
            .source-reel-manual { color: #e91e63; }
            .source-console { color: #9c27b0; }

            .fb-post-tag {
                position: absolute; top: 0; right: 0; padding: 4px 8px;
                color: white; font-weight: bold; font-family: sans-serif; font-size: 12px;
                z-index: 100; border-bottom-left-radius: 6px; pointer-events: none;
                box-shadow: -2px 2px 5px rgba(0,0,0,0.3);
            }

            /* Manual Block Buttons - Feed Posts */
            .fb-manual-block-btn {
                position: absolute;
                top: 8px;
                left: 8px;
                background: rgba(255, 68, 68, 0.85);
                color: white;
                border: none;
                border-radius: 6px;
                padding: 6px 12px;
                font-size: 11px;
                font-weight: bold;
                font-family: -apple-system, sans-serif;
                cursor: pointer;
                z-index: 1000;
                display: flex;
                align-items: center;
                gap: 4px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                transition: all 0.2s ease;
                opacity: 0;
            }
            /* Show on hover of parent post */
            div[aria-posinset]:hover .fb-manual-block-btn,
            div[role="article"]:hover .fb-manual-block-btn,
            .fb-manual-block-btn:hover {
                opacity: 1;
            }
            .fb-manual-block-btn:hover {
                background: rgba(255, 40, 40, 1);
                transform: scale(1.05);
            }
            .fb-manual-block-btn.blocked {
                background: rgba(76, 175, 80, 0.9);
                pointer-events: none;
                opacity: 1;
            }
            .fb-manual-block-btn .icon {
                font-size: 14px;
            }

            /* Video block button - bottom right corner of video */
            .fb-video-block-btn {
                position: absolute;
                bottom: 50px;
                right: 8px;
                background: rgba(255, 68, 68, 0.85);
                color: white;
                border: none;
                border-radius: 6px;
                padding: 6px 10px;
                font-size: 11px;
                font-weight: bold;
                font-family: -apple-system, sans-serif;
                cursor: pointer;
                z-index: 1000;
                display: flex;
                align-items: center;
                gap: 4px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.4);
                transition: all 0.2s ease;
                opacity: 0;
                pointer-events: none;
            }
            /* Show on hover of parent post or video container */
            div[aria-posinset]:hover .fb-video-block-btn,
            div[role="article"]:hover .fb-video-block-btn,
            [data-video-id]:hover .fb-video-block-btn,
            .fb-video-block-btn:hover {
                opacity: 1;
                pointer-events: auto;
            }
            .fb-video-block-btn:hover {
                background: rgba(255, 40, 40, 1);
                transform: scale(1.05);
            }
            .fb-video-block-btn.blocked {
                background: rgba(76, 175, 80, 0.9);
                pointer-events: auto;
                opacity: 1;
            }

            /* Reel block button - positioned differently */
            .fb-reel-block-btn {
                position: absolute;
                top: 120px;
                left: 10px;
                background: rgba(255, 68, 68, 0.9);
                color: white;
                border: none;
                border-radius: 8px;
                padding: 8px 16px;
                font-size: 12px;
                font-weight: bold;
                font-family: -apple-system, sans-serif;
                cursor: pointer;
                z-index: 10000;
                display: flex;
                align-items: center;
                gap: 6px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.4);
                transition: all 0.2s ease;
            }
            .fb-reel-block-btn:hover {
                background: rgba(255, 40, 40, 1);
                transform: scale(1.05);
            }
            .fb-reel-block-btn.blocked {
                background: rgba(76, 175, 80, 0.9);
                pointer-events: none;
            }
        `);

        document.body.appendChild(dash);

        // Set initial position (saved or default)
        const savedPos = loadDashboardPosition();
        if (savedPos) {
            dash.style.left = savedPos.x + 'px';
            dash.style.top = savedPos.y + 'px';
            dash.style.right = 'auto';
            dash.style.bottom = 'auto';
        } else {
            // Default position: bottom right
            dash.style.right = '20px';
            dash.style.bottom = '20px';
        }

        // Make dashboard draggable
        const dragHandle = document.getElementById('dash-drag-handle');
        let isDragging = false;
        let dragOffsetX = 0;
        let dragOffsetY = 0;

        dragHandle.addEventListener('mousedown', (e) => {
            // Don't drag if clicking on buttons
            if (e.target.tagName === 'BUTTON') return;

            isDragging = true;
            const rect = dash.getBoundingClientRect();
            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;

            // Switch to top/left positioning
            dash.style.left = rect.left + 'px';
            dash.style.top = rect.top + 'px';
            dash.style.right = 'auto';
            dash.style.bottom = 'auto';

            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            let newX = e.clientX - dragOffsetX;
            let newY = e.clientY - dragOffsetY;

            // Keep within viewport
            const maxX = window.innerWidth - dash.offsetWidth;
            const maxY = window.innerHeight - dash.offsetHeight;
            newX = Math.max(0, Math.min(newX, maxX));
            newY = Math.max(0, Math.min(newY, maxY));

            dash.style.left = newX + 'px';
            dash.style.top = newY + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                // Save position
                const rect = dash.getBoundingClientRect();
                saveDashboardPosition(rect.left, rect.top);
            }
        });

        // Event listeners
        document.getElementById('dash-start').onclick = startScanner;
        document.getElementById('dash-stop').onclick = stopScanner;
        document.getElementById('dash-export').onclick = exportMasterLog;
        document.getElementById('dash-import').onclick = () => document.getElementById('dash-import-file').click();
        document.getElementById('dash-import-file').onchange = (e) => {
            if (e.target.files.length > 0) {
                importMasterLog(e.target.files[0]);
                e.target.value = '';
            }
        };

        document.querySelectorAll('.speed-btn').forEach(btn => {
            btn.onclick = () => setSpeed(btn.dataset.speed);
        });

        loadMasterLog();
        loadBlockedList();
        loadSpeed();
        updateSpeedButtons();
        updateDashboardCounts();
        populateExistingLog();
    }

    function populateExistingLog() {
        const recent = state.masterLog.slice(0, CONFIG.dashboardRows);
        for (const entry of recent.reverse()) {
            addToDashboardFromEntry(entry);
        }
    }

    function addToDashboardFromEntry(entry) {
        const tbody = document.querySelector('#dash-table tbody');
        if (!tbody) return;

        const row = document.createElement('tr');
        row.dataset.url = entry.url;

        const status = entry.blocked ? 'blocked' :
                       state.blockedSponsors.has(entry.url) ? 'blocked' : 'known';
        const statusText = status === 'blocked' ? '✓ Blocked' : '○ Known';
        const source = entry.source || 'feed';

        row.innerHTML = `
            <td><a href="${entry.url}" target="_blank">${entry.author}</a></td>
            <td title="${entry.content}" style="color:#555;">${entry.content || '-'}</td>
            <td class="source-${source}">${source.toUpperCase()}</td>
            <td class="status-${status}">${statusText}</td>
        `;

        tbody.insertBefore(row, tbody.firstChild);

        if (tbody.children.length > CONFIG.dashboardRows) {
            tbody.removeChild(tbody.lastChild);
        }
    }

    function setSpeed(speed) {
        CONFIG.currentSpeed = speed;
        saveSpeed();
        updateSpeedButtons();
        log(`Speed set to: ${speed}`);
    }

    function updateSpeedButtons() {
        document.querySelectorAll('.speed-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.speed === CONFIG.currentSpeed);
        });
    }

    function updateDashboardStatus(text) {
        const el = document.getElementById('dash-status');
        if (el) el.textContent = text;
    }

    function updateModeIndicator() {
        const modeText = document.getElementById('mode-text');
        if (modeText) {
            modeText.textContent = isReelsPage() ? 'REELS' : 'FEED';
        }
    }

    function updateDashboardCounts() {
        const total = document.getElementById('stat-total');
        const manual = document.getElementById('stat-manual');
        const blocked = document.getElementById('stat-blocked');
        const queue = document.getElementById('stat-queue');

        // Count manual blocks from master log
        const manualCount = state.masterLog.filter(e =>
            e.source && (e.source.includes('manual') || e.source === 'console')
        ).length;

        if (total) total.textContent = state.masterLog.length;
        if (manual) manual.textContent = manualCount;
        if (blocked) blocked.textContent = state.totalBlocked;
        if (queue) queue.textContent = state.blockQueue.length;
    }

    function addToDashboard(data, status = 'pending') {
        const tbody = document.querySelector('#dash-table tbody');
        if (!tbody) return;

        const existing = tbody.querySelector(`tr[data-url="${data.authorUrl}"]`);
        if (existing) existing.remove();

        const row = document.createElement('tr');
        row.dataset.url = data.authorUrl;

        let statusText = status;
        let statusClass = `status-${status}`;
        if (status === 'pending') statusText = '⏳ Pending';
        else if (status === 'blocking') statusText = '🔄 Blocking';
        else if (status === 'blocked') statusText = '✓ Blocked';

        const source = data.source || 'feed';

        row.innerHTML = `
            <td><a href="${data.authorUrl}" target="_blank">${data.author}</a></td>
            <td title="${data.content}" style="color:#666;">${data.content || '-'}</td>
            <td class="source-${source}">${source.toUpperCase()}</td>
            <td class="${statusClass}">${statusText}</td>
        `;

        tbody.insertBefore(row, tbody.firstChild);

        if (tbody.children.length > CONFIG.dashboardRows) {
            tbody.removeChild(tbody.lastChild);
        }
    }

    function updateRowStatus(url, status) {
        const tbody = document.querySelector('#dash-table tbody');
        if (!tbody) return;

        for (const row of tbody.querySelectorAll('tr')) {
            if (row.dataset.url === url) {
                const statusCell = row.children[3];
                if (statusCell) {
                    let statusText = status;
                    if (status === 'pending') statusText = '⏳ Pending';
                    else if (status === 'blocking') statusText = '🔄 Blocking';
                    else if (status === 'blocked') statusText = '✓ Blocked';
                    statusCell.textContent = statusText;
                    statusCell.className = `status-${status}`;
                }
                break;
            }
        }
    }

    function tagPostVisuals(post, type) {
        if (type !== 'sponsored') return;
        if (post.querySelector('.fb-post-tag')) return;

        const tag = document.createElement('div');
        tag.className = 'fb-post-tag';
        tag.innerText = 'SPONSORED';
        tag.style.backgroundColor = CONFIG.colors.sponsored;

        if (getComputedStyle(post).position === 'static') {
            post.style.position = 'relative';
        }
        post.style.border = `2px solid ${CONFIG.colors.sponsored}`;
        post.appendChild(tag);
    }

    // ==================== MANUAL BLOCK BUTTONS ====================

    function injectFeedBlockButton(post) {
        // Skip if already has a block button
        if (post.querySelector('.fb-manual-block-btn') || post.querySelector('.fb-video-block-btn')) return;

        // Extract author URL from post
        const authorData = extractAuthorFromPost(post);
        if (!authorData.url) return;

        // Check if already blocked
        const isBlocked = state.blockedSponsors.has(authorData.url);

        // Detect if this is a video post
        const videoContainer = post.querySelector('video')?.closest('div[class*="x1"]') ||
                               post.querySelector('[data-video-id]') ||
                               post.querySelector('[aria-label="Play"]')?.closest('div[class*="x1"]') ||
                               post.querySelector('[aria-label="Pause"]')?.closest('div[class*="x1"]');

        const hasVideo = !!videoContainer;

        const btn = document.createElement('button');
        btn.className = (hasVideo ? 'fb-video-block-btn' : 'fb-manual-block-btn') + (isBlocked ? ' blocked' : '');
        btn.innerHTML = isBlocked
            ? '<span class="icon">✓</span> Blocked'
            : '<span class="icon">🚫</span> Block';
        btn.title = `Block ${authorData.name}`;

        if (!isBlocked) {
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                manualBlockAuthor(authorData, btn, 'feed-manual');
            };
        }

        // For videos, try to attach to the video container for better positioning
        if (hasVideo && videoContainer) {
            if (getComputedStyle(videoContainer).position === 'static') {
                videoContainer.style.position = 'relative';
            }
            videoContainer.appendChild(btn);
        } else {
            if (getComputedStyle(post).position === 'static') {
                post.style.position = 'relative';
            }
            post.appendChild(btn);
        }
    }

    function injectReelBlockButton(reelContainer) {
        if (reelContainer.querySelector('.fb-reel-block-btn')) return;

        // Extract author URL from reel
        const authorData = extractAuthorFromReel(reelContainer);
        if (!authorData.url) return;

        // Check if already blocked
        const isBlocked = state.blockedSponsors.has(authorData.url);

        const btn = document.createElement('button');
        btn.className = 'fb-reel-block-btn' + (isBlocked ? ' blocked' : '');
        btn.innerHTML = isBlocked
            ? '<span class="icon">✓</span> Blocked'
            : '<span class="icon">🚫</span> Block & Skip';
        btn.title = `Block ${authorData.name}`;

        if (!isBlocked) {
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                manualBlockAuthor(authorData, btn, 'reel-manual');
            };
        }

        if (getComputedStyle(reelContainer).position === 'static') {
            reelContainer.style.position = 'relative';
        }
        reelContainer.appendChild(btn);
    }

    function extractAuthorFromPost(post) {
        const data = { name: 'Unknown', url: null };

        const headerLinks = post.querySelectorAll('h2 a, h3 a, h4 a, strong a');
        for (const link of headerLinks) {
            const href = link.href;
            if (href.includes('/groups/') || href.includes('/events/') ||
                href.includes('/ads/') || href.includes('/watch/') ||
                href.includes('/reel/') || href.includes('/photo/') ||
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
            let url;
            if (href.startsWith('http')) {
                url = new URL(href);
            } else {
                url = new URL('https://www.facebook.com' + href);
            }

            if (url.pathname.includes('profile.php') && url.searchParams.has('id')) {
                const profileId = url.searchParams.get('id');
                data.url = `https://www.facebook.com/profile.php?id=${profileId}`;
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

        // Get name from h2
        const h2 = reelContainer.querySelector('h2');
        if (h2) {
            const text = h2.innerText?.trim();
            if (text && text.length < 100) {
                data.name = text.split('\n')[0];
            }
        }

        // Fallback to URL
        if (data.name === 'Unknown' && data.url) {
            const parts = data.url.split('/');
            data.name = parts[parts.length - 1].split('?')[0];
        }

        return data;
    }

    function manualBlockAuthor(authorData, btn, source) {
        log(`Manual block: ${authorData.name} - ${authorData.url}`);

        // Update button immediately (if button exists)
        if (btn) {
            btn.innerHTML = '<span class="icon">⏳</span> Queued';
            btn.classList.add('blocked');
        }

        // Determine the source label
        let sourceLabel = source;
        if (source === 'feed' || source === 'feed-manual') {
            sourceLabel = 'feed-manual';
        } else if (source === 'reel' || source === 'reel-manual') {
            sourceLabel = 'reel-manual';
        }

        // Add to master log
        const logData = {
            authorUrl: authorData.url,
            author: authorData.name,
            content: '(Manual block)',
            source: sourceLabel
        };

        const isNew = addToMasterLog(logData);

        if (isNew) {
            state.sessionDetected++;
            addToDashboard(logData, 'pending');
        }

        // Queue for blocking
        if (!state.blockedSponsors.has(authorData.url)) {
            state.blockQueue.push({ url: authorData.url, author: authorData.name });
            updateDashboardCounts();

            // Start processing if scanner is running
            if (state.isRunning && !state.isBlocking) {
                processBlockQueue();
            }
        }

        // Update button to show blocked (if button exists)
        if (btn) {
            setTimeout(() => {
                btn.innerHTML = '<span class="icon">✓</span> Blocked';
            }, 500);
        }

        // Skip to next reel if in reels
        if (source === 'reel' || source === 'reel-manual') {
            setTimeout(() => {
                skipReel();
            }, 300);
        }

        // Show notification
        showBlockNotification(authorData.name);
    }

    function showBlockNotification(name) {
        const notification = document.createElement('div');
        notification.innerHTML = `🚫 Blocking <strong>${name}</strong>`;
        notification.style.cssText = `
            position: fixed;
            bottom: 100px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(255, 68, 68, 0.95);
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 14px;
            font-family: -apple-system, sans-serif;
            z-index: 100000;
            box-shadow: 0 4px 16px rgba(0,0,0,0.4);
            animation: notifySlide 2s ease-out forwards;
        `;
        document.body.appendChild(notification);

        // Add animation
        if (!document.getElementById('notify-animation-style')) {
            const style = document.createElement('style');
            style.id = 'notify-animation-style';
            style.textContent = `
                @keyframes notifySlide {
                    0% { opacity: 0; transform: translateX(-50%) translateY(20px); }
                    15% { opacity: 1; transform: translateX(-50%) translateY(0); }
                    85% { opacity: 1; transform: translateX(-50%) translateY(0); }
                    100% { opacity: 0; transform: translateX(-50%) translateY(-20px); }
                }
            `;
            document.head.appendChild(style);
        }

        setTimeout(() => notification.remove(), 2000);
    }

    // Inject block buttons into visible posts/reels
    function injectBlockButtons() {
        // Feed posts - add to ALL posts for manual blocking
        if (isFeedPage()) {
            const posts = document.querySelectorAll('div[aria-posinset], div[role="article"], div[data-pagelet^="FeedUnit"]');
            posts.forEach(post => {
                // Skip very small elements (likely not actual posts)
                if (post.innerText.length < 20) return;
                // Skip if already has button
                if (post.querySelector('.fb-manual-block-btn') || post.querySelector('.fb-video-block-btn')) return;
                injectFeedBlockButton(post);
            });
        }

        // Reels
        if (isReelsPage()) {
            const reelContainer = getCurrentReelContainer();
            if (reelContainer && !reelContainer.querySelector('.fb-reel-block-btn')) {
                injectReelBlockButton(reelContainer);
            }
        }
    }

    // ==================== MAIN ENGINE ====================

    function processPost(post) {
        if (post.dataset.fbScanned === 'true') return;
        post.dataset.fbScanned = 'true';

        const type = identifyPostType(post);
        if (type !== 'sponsored') return;

        const data = scrapePostData(post, type);

        if (!data.authorUrl) {
            log('Ignored: No valid author URL');
            return;
        }

        tagPostVisuals(post, type);

        const isNew = addToMasterLog(data);

        if (!isNew) {
            if (state.blockedSponsors.has(data.authorUrl)) {
                log(`Already blocked: ${data.authorUrl}`);
            } else {
                log(`Already logged: ${data.authorUrl}`);
            }
            return;
        }

        state.sessionDetected++;
        log(`NEW SPONSOR: ${data.author} - ${data.authorUrl}`);

        addToDashboard(data, 'pending');

        if (!state.blockedSponsors.has(data.authorUrl)) {
            state.blockQueue.push({ url: data.authorUrl, author: data.author });
        }

        updateDashboardCounts();

        if (state.isRunning && !state.isBlocking) {
            processBlockQueue();
        }
    }

    function scanFeed() {
        checkContext();
        const selectors = [
            'div[aria-posinset]',
            'div[role="article"]',
            'div[data-pagelet^="FeedUnit"]',
            'div.x1lliihq'
        ];

        const candidates = document.querySelectorAll(selectors.join(','));
        candidates.forEach(node => {
            if (node.innerText.length < 10) return;
            if (node.dataset.fbScanned !== 'true') {
                processPost(node);
            }
        });
    }

    function scan() {
        updateModeIndicator();

        // Inject manual block buttons
        injectBlockButtons();

        if (isReelsPage()) {
            scanReels();
        } else if (isFeedPage()) {
            scanFeed();
        }
    }

    async function startScanner() {
        if (state.isRunning) return;
        state.isRunning = true;
        setAutoStart(true);
        state.lastScrollHeight = document.documentElement.scrollHeight;
        state.noNewContentCount = 0;

        document.getElementById('dash-start').style.display = 'none';
        document.getElementById('dash-stop').style.display = 'inline-block';
        updateDashboardStatus('📜 Scanning...');

        log('Scanner started');

        while (state.isRunning) {
            scan();

            if (state.blockQueue.length > 0 && !state.isBlocking) {
                await processBlockQueue();
            }

            const speed = CONFIG.speeds[CONFIG.currentSpeed];

            // Only scroll on feed page, not reels
            if (state.isRunning && !state.isBlocking && isFeedPage()) {
                window.scrollBy({ top: speed.amount, behavior: 'smooth' });
                await sleep(speed.delay);
                if (checkFeedEnd()) return;
            } else {
                // For reels, just wait between scans
                await sleep(isReelsPage() ? CONFIG.reelsScanInterval : speed.delay);
            }
        }
    }

    function stopScanner() {
        state.isRunning = false;
        setAutoStart(false);

        document.getElementById('dash-start').style.display = 'inline-block';
        document.getElementById('dash-stop').style.display = 'none';
        updateDashboardStatus('⏹ Stopped');

        log('Scanner stopped');
    }

    // ==================== INIT ====================

    function start() {
        log('Scanner v5.5 Starting...');
        log(`Page type: ${isReelsPage() ? 'REELS' : isFeedPage() ? 'FEED' : 'OTHER'}`);

        if (isBlockingTab() && isProfilePage()) {
            log('Running as blocking tab');
            setTimeout(runBlockingTab, 1000);
            return;
        }

        if (!isScanablePage()) {
            log('Not a scanable page, skipping dashboard');
            return;
        }

        initDashboard();

        // Passive scanning always runs
        setInterval(scan, CONFIG.scanInterval);
        scan();

        // Watch for URL changes (SPA navigation)
        let lastPath = location.pathname;
        setInterval(() => {
            if (location.pathname !== lastPath) {
                lastPath = location.pathname;
                log(`URL changed to: ${lastPath}`);
                updateModeIndicator();
                state.processedReelIds.clear(); // Reset processed reels on navigation
            }
        }, 500);

        if (shouldAutoStart()) {
            setTimeout(startScanner, 2000);
        }

        window.fbBlocker = {
            start: startScanner,
            stop: stopScanner,
            export: () => exportMasterLog('all'),
            exportAuto: () => exportMasterLog('auto'),      // Export only auto-detected sponsors
            exportManual: () => exportMasterLog('manual'),  // Export only manual blocks
            import: () => document.getElementById('dash-import-file').click(),
            state: state,
            masterLog: () => state.masterLog,
            queue: () => state.blockQueue,
            scanReels: scanReels,
            skipReel: skipReel,
            blockUrl: (url, name = 'Manual') => {
                if (!url.includes('facebook.com')) {
                    console.error('Invalid URL - must be a Facebook profile URL');
                    return;
                }
                manualBlockAuthor({ url: url, name: name }, null, 'console');
                log(`Manual block queued: ${url}`);
            },
            clearLog: () => {
                if (confirm('Clear entire master log? This cannot be undone.')) {
                    state.masterLog = [];
                    state.masterLogUrls.clear();
                    saveMasterLog();
                    document.querySelector('#dash-table tbody').innerHTML = '';
                    updateDashboardCounts();
                    log('Master log cleared');
                }
            },
            clearBlocked: () => {
                if (confirm('Clear blocked list?')) {
                    state.blockedSponsors.clear();
                    state.totalBlocked = 0;
                    saveBlockedList();
                    updateDashboardCounts();
                    log('Blocked list cleared');
                }
            },
            clearQueue: () => {
                state.blockQueue = [];
                updateDashboardCounts();
                log('Queue cleared');
            }
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

})();