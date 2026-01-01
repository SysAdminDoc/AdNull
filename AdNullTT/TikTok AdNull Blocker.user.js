// ==UserScript==
// @name         TikTok AdNull Blocker
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Block TikTok video posters, commenters, and auto-block ads. Maintains block list with import/export.
// @author       Matthew Parker
// @match        https://www.tiktok.com/*
// @icon         https://www.tiktok.com/favicon.ico
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_openInTab
// @grant        window.close
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    console.log('[TT Blocker] Script version 1.2 starting...');

    // ==================== CONFIGURATION ====================
    const CONFIG = {
        debug: true,
        scanInterval: 1000,
        dashboardRows: 150,

        // Ad detection keywords
        adKeywords: [
            "anúncio", "anuncio", "patrocinado", "patrocinada",
            "publicidade", "publi", "sponsored", "ad", "promo",
            "advertisement", "promoted"
        ],

        // Selectors - using data-e2e attributes where possible for stability
        selectors: {
            adContainer: "div[class*='DivItemTagsContainer'] > div",
            videoArticle: "article[data-e2e='recommend-list-item-container']",
            posterAvatar: "a[data-e2e='video-author-avatar']",
            posterName: "a[href^='/@'] p.TUXText",
            // Comment selectors - multiple fallbacks
            commentWrapper: "[class*='DivCommentObjectWrapper'], [class*='DivCommentItemWrapper']",
            commentUsernameWrapper: "[data-e2e='comment-username-1']",
            commentUserLink: "a.link-a11y-focus[href^='/@']",
            actionBar: "section[class*='SectionActionBarContainer']",
            nextButton: "button[data-e2e='arrow-right'], aside button:nth-child(2)"
        },

        // Blocking settings - increased for captcha scenarios
        pollInterval: 500,
        maxPolls: 120,  // 60 seconds total wait time for captcha
        tabOpenDelay: 2000,

        // Colors
        colors: {
            blockBtn: '#fe2c55',
            blocked: '#4CAF50',
            pending: '#ff9800',
            panel: '#1a1a1a'
        }
    };

    // ==================== STATE ====================
    const state = {
        // Block list - persisted
        blockList: [],           // Array of {url, username, timestamp, source}
        blockListUrls: new Set(),

        // Session state
        blockQueue: [],
        sessionBlocked: 0,
        totalBlocked: 0,
        adsDetected: 0,
        adsBlocked: 0,
        isRunning: false,
        isBlocking: false,
        autoBlockAds: true,
        processedPosts: new WeakSet(),
        processedComments: new WeakSet()
    };

    // ==================== UTILS ====================
    function log(msg, ...args) {
        if (CONFIG.debug) console.log(`[TT Blocker] ${msg}`, ...args);
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

    function formatDate(ts) {
        const d = new Date(ts);
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
    }

    function extractUsername(href) {
        if (!href) return null;
        const match = href.match(/\/@([^/?]+)/);
        return match ? match[1] : null;
    }

    function buildProfileUrl(username) {
        return `https://www.tiktok.com/@${username}`;
    }

    // ==================== PERSISTENCE ====================
    function loadBlockList() {
        try {
            const saved = GM_getValue('tt_block_list_v1', '[]');
            state.blockList = JSON.parse(saved);
            state.blockListUrls = new Set(state.blockList.map(e => e.url));
            state.totalBlocked = state.blockList.length;
            log(`Loaded ${state.blockList.length} blocked profiles`);
        } catch(e) {
            state.blockList = [];
            state.blockListUrls = new Set();
        }
    }

    function saveBlockList() {
        GM_setValue('tt_block_list_v1', JSON.stringify(state.blockList));
    }

    function loadSettings() {
        state.autoBlockAds = GM_getValue('tt_auto_block_ads', true);
    }

    function saveSettings() {
        GM_setValue('tt_auto_block_ads', state.autoBlockAds);
    }

    function addToBlockList(username, source = 'manual') {
        const url = buildProfileUrl(username);

        if (state.blockListUrls.has(url)) {
            log(`Already in block list: ${username}`);
            return false;
        }

        const entry = {
            url: url,
            username: username,
            timestamp: Date.now(),
            source: source // 'manual', 'ad', 'commenter'
        };

        state.blockList.unshift(entry);
        state.blockListUrls.add(url);
        state.totalBlocked++;
        saveBlockList();
        updateDashboardCounts();
        return true;
    }

    // ==================== EXPORT ====================
    function exportBlockList() {
        const csv = [
            ['Username', 'URL', 'Date Blocked', 'Source'].join(','),
            ...state.blockList.map(e => [
                `"${(e.username || '').replace(/"/g, '""')}"`,
                e.url,
                formatDate(e.timestamp),
                e.source || 'manual'
            ].join(','))
        ].join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tiktok_blocklist_${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);

        log(`Exported ${state.blockList.length} entries`);
        updateDashboardStatus(`✓ Exported ${state.blockList.length} profiles`);
    }

    // ==================== IMPORT ====================
    function parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
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

    function importBlockList(file) {
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

            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                const fields = parseCSVLine(line);
                if (fields.length < 2) continue;

                const username = fields[0].replace(/^"|"$/g, '').replace(/""/g, '"');
                const url = fields[1].trim();

                if (!url || !url.includes('tiktok.com')) {
                    skipped++;
                    continue;
                }

                if (state.blockListUrls.has(url)) {
                    skipped++;
                    continue;
                }

                const entry = {
                    url: url,
                    username: username,
                    timestamp: Date.now(),
                    source: 'imported'
                };

                state.blockList.push(entry);
                state.blockListUrls.add(url);
                imported++;
            }

            state.totalBlocked = state.blockList.length;
            saveBlockList();
            updateDashboardCounts();
            refreshDashboardTable();

            alert(`Import complete!\nImported: ${imported}\nSkipped (duplicates/invalid): ${skipped}`);
            log(`Imported ${imported} profiles, skipped ${skipped}`);
        };

        reader.readAsText(file);
    }

    // ==================== AD DETECTION ====================
    function isAd(element) {
        const text = (element.innerText || '').toLowerCase();
        return CONFIG.adKeywords.some(k => text.includes(k.toLowerCase()));
    }

    function detectAdsInFeed() {
        // Strategy 1: Find ads by data-e2e="ad-tag" attribute (most reliable)
        const adTags = document.querySelectorAll('[data-e2e="ad-tag"]');
        adTags.forEach(el => {
            processAdElement(el);
        });

        // Strategy 2: Find ad containers by class pattern with keyword matching
        const adContainers = document.querySelectorAll(
            '[class*="DivItemTagsContainer"] > div, ' +
            '[class*="TagContainer"] > div, ' +
            '[class*="AdTag"]'
        );

        adContainers.forEach(el => {
            if (isAd(el)) {
                processAdElement(el);
            }
        });
    }

    function processAdElement(el) {
        // Find the article containing this ad
        const article = el.closest('article') ||
                       el.closest('[class*="DivContentFlexLayout"]')?.closest('article') ||
                       el.closest('[class*="ArticleItemContainer"]');

        if (!article) {
            log('Ad element found but no parent article');
            return;
        }

        // Check if already processed using article ID or a data attribute
        if (article.dataset.ttAdProcessed) {
            return;
        }
        article.dataset.ttAdProcessed = 'true';

        state.adsDetected++;
        log('=== AD DETECTED ===');
        log('Article ID:', article.id);

        // Tag it visually
        tagAsAd(article);

        // Get poster info
        const posterInfo = getPosterInfo(article);

        log('Poster info result:', posterInfo);
        log('Auto-block ads enabled:', state.autoBlockAds);

        if (posterInfo && posterInfo.username) {
            if (state.autoBlockAds) {
                log(`Auto-blocking ad poster: ${posterInfo.username}`);
                queueBlock(posterInfo.username, 'ad');
                // Small delay then skip
                setTimeout(skipToNextVideo, 1000);
            } else {
                log('Auto-block disabled, not blocking');
            }
        } else {
            log('Could not get poster info for ad - skipping without blocking');
            if (state.autoBlockAds) {
                setTimeout(skipToNextVideo, 500);
            }
        }

        updateDashboardCounts();
    }

    function tagAsAd(article) {
        if (article.querySelector('.tt-ad-tag')) return;

        const tag = document.createElement('div');
        tag.className = 'tt-ad-tag';
        tag.innerText = '🚫 AD - AUTO BLOCKING';
        tag.style.cssText = `
            position: absolute;
            top: 10px;
            left: 10px;
            background: ${CONFIG.colors.blockBtn};
            color: white;
            padding: 8px 16px;
            border-radius: 8px;
            font-weight: bold;
            font-size: 14px;
            z-index: 9999;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        `;

        if (getComputedStyle(article).position === 'static') {
            article.style.position = 'relative';
        }
        article.appendChild(tag);
    }

    function skipToNextVideo() {
        // Try multiple button selectors
        const btnSelectors = [
            'button[data-e2e="arrow-right"]',
            'button[data-e2e="arrow-down"]',
            '#main-content-homepage_hot aside button:nth-child(2)',
            'aside button[class*="ButtonBasicButtonContainer"]:nth-child(2)',
            'button[aria-label*="next" i]',
            'button[aria-label*="down" i]'
        ];

        for (const selector of btnSelectors) {
            const btn = document.querySelector(selector);
            if (btn) {
                btn.click();
                log('Skipped to next video');
                return;
            }
        }

        // Fallback: scroll down
        window.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
        log('No skip button found, scrolled instead');
    }

    // ==================== BLOCKING LOGIC ====================
    function queueBlock(username, source = 'manual') {
        const url = buildProfileUrl(username);

        if (state.blockListUrls.has(url)) {
            log(`Already blocked: ${username}`);
            return;
        }

        // Check if already in queue
        if (state.blockQueue.some(q => q.username === username)) {
            log(`Already in queue: ${username}`);
            return;
        }

        state.blockQueue.push({ username, source });
        addToDashboard({ username, url }, 'pending');
        updateDashboardCounts();

        if (!state.isBlocking) {
            processBlockQueue();
        }
    }

    async function processBlockQueue() {
        if (state.isBlocking || state.blockQueue.length === 0) return;

        state.isBlocking = true;
        updateDashboardStatus('🔄 Blocking in progress...');

        while (state.blockQueue.length > 0) {
            const item = state.blockQueue[0];
            const url = buildProfileUrl(item.username);

            log(`Processing block: ${item.username}`);
            updateRowStatus(url, 'blocking');

            try {
                // Open profile in new tab
                const tab = GM_openInTab(url + '?tt_block_action=1', { active: true });

                // Wait for block to complete (signaled by tab close or timeout)
                await sleep(CONFIG.tabOpenDelay);
                await waitForBlockComplete(item.username);

                // Mark as blocked
                addToBlockList(item.username, item.source);
                state.sessionBlocked++;
                if (item.source === 'ad') state.adsBlocked++;

                updateRowStatus(url, 'blocked');
                log(`Blocked: ${item.username}`);

            } catch (e) {
                log(`Block failed for ${item.username}: ${e.message}`);
                updateRowStatus(url, 'failed');
            }

            state.blockQueue.shift();
            updateDashboardCounts();
            await sleep(1000);
        }

        state.isBlocking = false;
        updateDashboardStatus('✓ Ready');
    }

    async function waitForBlockComplete(username) {
        // Wait for the blocking tab to signal completion
        // This is done via localStorage message passing
        const key = `tt_block_complete_${username}`;

        try {
            await waitFor(() => {
                const val = localStorage.getItem(key);
                if (val) {
                    localStorage.removeItem(key);
                    return true;
                }
                return false;
            }, 100, 200);
        } catch (e) {
            // Timeout - assume it worked if tab was opened
            log(`Block timeout for ${username}, assuming success`);
        }
    }

    // ==================== BLOCKING TAB LOGIC ====================
    function isBlockingTab() {
        return window.location.search.includes('tt_block_action=1');
    }

    function isProfilePage() {
        return window.location.pathname.match(/^\/@[^/]+\/?$/);
    }

    async function runBlockingTab() {
        const username = extractUsername(window.location.pathname);
        if (!username) {
            log('Could not extract username');
            window.close();
            return;
        }

        log(`Blocking tab for: ${username}`);

        // Show a visual indicator that we're waiting
        showBlockingIndicator(`Waiting to block @${username}...`);

        try {
            // Wait for page to fully load - this also handles captcha
            // The script will keep waiting until the more button appears
            await sleep(2000);

            // Find and click the "..." more menu button - wait indefinitely for captcha
            log('Looking for more button (will wait for captcha if needed)...');
            const moreBtn = await waitFor(() => {
                return document.querySelector('button[data-e2e="user-more"]');
            }, CONFIG.maxPolls, CONFIG.pollInterval);

            if (!moreBtn) throw new Error('More button not found after waiting');

            showBlockingIndicator(`Found profile, clicking menu...`);
            moreBtn.click();
            log('Clicked more button');

            await sleep(800);

            // Find and click the Block button in the menu
            log('Looking for Block option in menu...');
            const blockOption = await waitFor(() => {
                // Try multiple selectors for the block option
                const selectors = [
                    'div[role="button"][aria-label="Block"]',
                    'div[tabindex="0"][role="button"] p:contains("Block")',
                    '[class*="DivActionContainer"] [class*="DivActionItem"]'
                ];

                // First try by aria-label
                let btn = document.querySelector('div[role="button"][aria-label="Block"]');
                if (btn) return btn;

                // Then try finding by text content
                const allBtns = document.querySelectorAll('div[role="button"], [class*="ActionItem"]');
                for (const btn of allBtns) {
                    const text = btn.innerText?.trim().toLowerCase();
                    if (text === 'block') return btn;
                    // Check for Block text in child elements
                    const pTag = btn.querySelector('p');
                    if (pTag && pTag.innerText?.trim().toLowerCase() === 'block') return btn;
                }
                return null;
            }, 30, 200);

            if (!blockOption) throw new Error('Block option not found in menu');

            showBlockingIndicator(`Clicking Block option...`);
            blockOption.click();
            log('Clicked block option');

            await sleep(1000);

            // Now wait for and click the confirmation dialog button
            log('Looking for confirmation dialog...');
            const confirmBtn = await waitFor(() => {
                // Look for the confirm button in the popup
                return document.querySelector('button[data-e2e="block-popup-block-btn"]') ||
                       document.querySelector('[data-e2e="block-popup"] button:last-child') ||
                       document.querySelector('button[class*="StyledButtonBlock"]');
            }, 30, 200);

            if (!confirmBtn) throw new Error('Confirmation button not found');

            showBlockingIndicator(`Confirming block...`);
            confirmBtn.click();
            log('Clicked confirmation button');

            await sleep(1500);

            // Signal completion
            localStorage.setItem(`tt_block_complete_${username}`, 'true');
            log(`Block complete: ${username}`);

            showBlockingIndicator(`✓ Blocked @${username}! Closing...`);
            await sleep(1000);
            window.close();

        } catch (e) {
            log(`Block error: ${e.message}`);
            showBlockingIndicator(`❌ Error: ${e.message}`);
            localStorage.setItem(`tt_block_complete_${username}`, 'error');
            await sleep(2000);
            window.close();
        }
    }

    function showBlockingIndicator(message) {
        let indicator = document.getElementById('tt-block-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'tt-block-indicator';
            indicator.style.cssText = `
                position: fixed;
                top: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: linear-gradient(135deg, #fe2c55, #25f4ee);
                color: white;
                padding: 16px 32px;
                border-radius: 12px;
                font-size: 16px;
                font-weight: bold;
                z-index: 999999;
                box-shadow: 0 4px 20px rgba(0,0,0,0.5);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            `;
            document.body.appendChild(indicator);
        }
        indicator.textContent = message;
    }

    // ==================== UI - BLOCK BUTTONS ====================
    function addBlockButtonToPosters() {
        // Find video articles on the feed
        const articles = document.querySelectorAll(
            'article[data-e2e="recommend-list-item-container"], ' +
            'article[class*="ArticleItemContainer"]'
        );

        articles.forEach(article => {
            if (article.querySelector('.tt-block-poster-btn')) return;

            // Find the avatar link - multiple strategies
            let avatarLink = article.querySelector('a[data-e2e="video-author-avatar"]');

            // Fallback: find avatar link by href pattern
            if (!avatarLink) {
                const links = article.querySelectorAll('a[href^="/@"]');
                for (const link of links) {
                    if (link.querySelector('img[class*="Avatar"]') || link.querySelector('span[class*="Avatar"]')) {
                        avatarLink = link;
                        break;
                    }
                }
            }

            if (!avatarLink) return;

            const username = extractUsername(avatarLink.getAttribute('href'));
            if (!username) return;

            // Create block button
            const btn = createBlockButton(username, 'poster');

            // Find the action bar section to insert the button
            const actionBar = article.querySelector('section[class*="ActionBar"]');
            if (actionBar) {
                btn.style.marginTop = '12px';
                btn.style.display = 'block';
                btn.style.width = '48px';
                btn.style.height = 'auto';
                btn.style.fontSize = '10px';
                btn.style.padding = '6px 4px';
                btn.style.textAlign = 'center';
                actionBar.insertBefore(btn, actionBar.firstChild);
                return;
            }

            // Fallback: Insert near the avatar
            const avatarContainer = avatarLink.closest('div');
            if (avatarContainer && avatarContainer.parentElement) {
                btn.style.marginTop = '8px';
                avatarContainer.parentElement.insertBefore(btn, avatarContainer.nextSibling);
            }
        });

        // Also handle the video detail page (when watching a specific video)
        addBlockButtonToVideoPage();
    }

    function addBlockButtonToVideoPage() {
        // Check if we're on a video detail page
        if (!window.location.pathname.includes('/video/')) return;

        // Find the author info section
        const authorSection = document.querySelector('[class*="DivAuthorContainer"], [data-e2e="video-author-uniqueid"]');
        if (!authorSection) return;
        if (authorSection.querySelector('.tt-block-poster-btn')) return;

        // Find author link
        const authorLink = document.querySelector('a[data-e2e="video-author-avatar"], a[href^="/@"][class*="Avatar"]');
        if (!authorLink) return;

        const username = extractUsername(authorLink.getAttribute('href'));
        if (!username) return;

        const btn = createBlockButton(username, 'poster');
        btn.style.marginLeft = '12px';

        // Insert near the author name
        const authorName = document.querySelector('[data-e2e="video-author-uniqueid"], [class*="AuthorTitle"]');
        if (authorName && authorName.parentElement) {
            authorName.parentElement.appendChild(btn);
        }
    }

    function addBlockButtonToCommenters() {
        // Strategy 1: Find comment items by class pattern
        let commentItems = document.querySelectorAll(
            '[class*="DivCommentObjectWrapper"], ' +
            '[class*="DivCommentItemWrapper"], ' +
            '[data-e2e="comment-item"]'
        );

        // Strategy 2: If no items found, look in the comment list container
        if (commentItems.length === 0) {
            const commentList = document.querySelector('[class*="DivCommentListContainer"], [class*="CommentList"]');
            if (commentList) {
                // Find all divs that contain user links (likely comments)
                commentItems = commentList.querySelectorAll('div:has(> div a[href^="/@"])');
            }
        }

        // Strategy 3: Look for elements with comment-related data attributes
        if (commentItems.length === 0) {
            commentItems = document.querySelectorAll('[data-e2e^="comment"]');
        }

        commentItems.forEach(wrapper => {
            if (state.processedComments.has(wrapper)) return;
            if (wrapper.querySelector('.tt-block-commenter-btn')) return;

            state.processedComments.add(wrapper);

            // Find the user link within this comment - multiple strategies
            let userLink = null;

            // Strategy 1: Direct link with class
            userLink = wrapper.querySelector('a.link-a11y-focus[href^="/@"]');

            // Strategy 2: Link in username area
            if (!userLink) {
                const usernameArea = wrapper.querySelector('[data-e2e="comment-username-1"], [data-e2e*="username"]');
                if (usernameArea) {
                    userLink = usernameArea.querySelector('a[href^="/@"]');
                }
            }

            // Strategy 3: Link in trigger wrapper
            if (!userLink) {
                const triggerWrapper = wrapper.querySelector('[class*="TriggerWrapper"]');
                if (triggerWrapper) {
                    userLink = triggerWrapper.querySelector('a[href^="/@"]');
                }
            }

            // Strategy 4: Any profile link that's not in a nested comment
            if (!userLink) {
                const allLinks = wrapper.querySelectorAll('a[href^="/@"]');
                // Get the first one that looks like a username link (near the top of the comment)
                for (const link of allLinks) {
                    // Skip if it's in a nested reply container
                    const replyContainer = link.closest('[class*="ReplyContainer"]');
                    if (replyContainer && replyContainer !== wrapper) continue;
                    userLink = link;
                    break;
                }
            }

            if (!userLink) return;

            const username = extractUsername(userLink.getAttribute('href'));
            if (!username) return;

            // Don't add button if already blocked
            const url = buildProfileUrl(username);

            // Create block button
            const btn = createBlockButton(username, 'commenter');

            // Find the best place to insert the button
            // Strategy 1: After the username in the header area
            const usernameWrapper = wrapper.querySelector('[data-e2e="comment-username-1"]') ||
                                   wrapper.querySelector('[class*="DivUsernameContentWrapper"]') ||
                                   wrapper.querySelector('[class*="CommentHeaderWrapper"]');

            if (usernameWrapper) {
                // Check if there's a "more" menu next to it - insert before that
                const moreMenu = usernameWrapper.querySelector('[class*="DivMore"]');
                if (moreMenu) {
                    moreMenu.insertAdjacentElement('beforebegin', btn);
                } else {
                    usernameWrapper.appendChild(btn);
                }
                return;
            }

            // Strategy 2: Next to the user link's parent container
            const linkContainer = userLink.closest('[class*="TriggerWrapper"]') || userLink.parentElement;
            if (linkContainer && linkContainer.parentElement) {
                linkContainer.parentElement.insertBefore(btn, linkContainer.nextSibling);
                return;
            }

            // Strategy 3: After the user link itself
            userLink.insertAdjacentElement('afterend', btn);
        });

        // Also try to find comments in a different structure (video detail page)
        scanVideoPageComments();
    }

    function scanVideoPageComments() {
        // Look for the comment panel on video detail pages
        const commentPanel = document.querySelector('[class*="DivCommentMain"], [class*="CommentContainer"]');
        if (!commentPanel) return;

        // Find all profile links in comments
        const profileLinks = commentPanel.querySelectorAll('a[href^="/@"]');

        profileLinks.forEach(link => {
            // Skip if already processed
            if (link.dataset.ttBlockProcessed) return;
            link.dataset.ttBlockProcessed = 'true';

            // Find the parent comment container
            const commentContainer = link.closest('[class*="DivCommentObjectWrapper"], [class*="DivCommentItemWrapper"]');
            if (!commentContainer) return;

            // Skip if already has button
            if (commentContainer.querySelector('.tt-block-commenter-btn')) return;

            const username = extractUsername(link.getAttribute('href'));
            if (!username) return;

            // Only add to profile links that are usernames (not @ mentions in text)
            const isInHeader = link.closest('[class*="Header"], [class*="Username"], [data-e2e*="username"]');
            if (!isInHeader) return;

            const btn = createBlockButton(username, 'commenter');
            link.insertAdjacentElement('afterend', btn);
        });
    }

    function createBlockButton(username, type) {
        const btn = document.createElement('button');
        btn.className = `tt-block-${type}-btn`;
        btn.innerText = '🚫';
        btn.title = `Block @${username}`;
        btn.dataset.username = username;

        const isBlocked = state.blockListUrls.has(buildProfileUrl(username));
        const isPending = state.blockQueue.some(q => q.username === username);

        let bgColor = CONFIG.colors.blockBtn;
        let text = '🚫';

        if (isBlocked) {
            bgColor = CONFIG.colors.blocked;
            text = '✓';
        } else if (isPending) {
            bgColor = CONFIG.colors.pending;
            text = '⏳';
        }

        btn.style.cssText = `
            background: ${bgColor};
            color: white;
            border: none;
            padding: 4px 8px;
            border-radius: 4px;
            cursor: ${isBlocked ? 'default' : 'pointer'};
            font-size: 12px;
            font-weight: bold;
            opacity: ${isBlocked ? '0.7' : '1'};
            transition: all 0.2s;
            min-width: 28px;
            height: 24px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            vertical-align: middle;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        `;

        btn.innerText = text;

        if (isBlocked || isPending) {
            btn.disabled = true;
        } else {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                queueBlock(username, type);
                btn.innerText = '⏳';
                btn.title = `Pending block: @${username}`;
                btn.style.background = CONFIG.colors.pending;
                btn.disabled = true;
            });

            btn.addEventListener('mouseenter', () => {
                if (!btn.disabled) {
                    btn.style.opacity = '0.8';
                    btn.style.transform = 'scale(1.1)';
                }
            });
            btn.addEventListener('mouseleave', () => {
                if (!btn.disabled) {
                    btn.style.opacity = '1';
                    btn.style.transform = 'scale(1)';
                }
            });
        }

        return btn;
    }

    function getPosterInfo(article) {
        // Try multiple strategies to find the poster's username
        let username = null;

        log('getPosterInfo: Starting search...');

        // Strategy 1: Look for profile link in creator info section (works for ads)
        // The class contains "DivCreatorInfoContainer" as a substring
        const creatorInfoSelectors = [
            '[class*="DivCreatorInfoContainer"]',
            '[class*="CreatorInfo"]',
            '[class*="e1td56050"]'  // Backup: use the emotion class
        ];

        for (const selector of creatorInfoSelectors) {
            const creatorInfo = article.querySelector(selector);
            if (creatorInfo) {
                log(`getPosterInfo: Found creator info with selector: ${selector}`);
                const profileLink = creatorInfo.querySelector('a[href^="/@"]');
                if (profileLink) {
                    username = extractUsername(profileLink.getAttribute('href'));
                    if (username) {
                        log(`getPosterInfo: Found username from creator info: ${username}`);
                        return { username, url: buildProfileUrl(username) };
                    }
                }
            }
        }

        // Strategy 2: Find ALL profile links in the article and use the first valid one
        const allProfileLinks = article.querySelectorAll('a[href^="/@"]');
        log(`getPosterInfo: Found ${allProfileLinks.length} profile links`);
        for (const link of allProfileLinks) {
            username = extractUsername(link.getAttribute('href'));
            if (username) {
                log(`getPosterInfo: Found username from profile link: ${username}`);
                return { username, url: buildProfileUrl(username) };
            }
        }

        // Strategy 3: Check video-author-avatar link (only if it's a TikTok profile)
        const avatarLink = article.querySelector('a[data-e2e="video-author-avatar"]');
        if (avatarLink) {
            const href = avatarLink.getAttribute('href');
            log(`getPosterInfo: Avatar link href: ${href}`);
            if (href && href.startsWith('/@')) {
                username = extractUsername(href);
                if (username) {
                    log(`getPosterInfo: Found username from avatar link: ${username}`);
                    return { username, url: buildProfileUrl(username) };
                }
            }
        }

        // Strategy 4: Look for username in avatar alt text
        const avatarImg = article.querySelector('img[class*="Avatar"], img[class*="ImgAvatar"]');
        if (avatarImg) {
            const alt = avatarImg.getAttribute('alt');
            log(`getPosterInfo: Avatar alt text: ${alt}`);
            if (alt && alt.length < 50 && !alt.includes(' ')) {
                // Looks like a username
                log(`getPosterInfo: Using avatar alt as username: ${alt}`);
                return { username: alt, url: buildProfileUrl(alt) };
            }
        }

        // Strategy 5: Look for username text in TUXText elements near the creator area
        const textElements = article.querySelectorAll('[class*="StyledTUXText"] p, [class*="TUXText"]');
        for (const el of textElements) {
            const text = el.innerText?.trim();
            // Username criteria: no spaces, reasonable length, not a number-only string
            if (text && text.length > 0 && text.length < 30 && !text.includes(' ') && !/^\d+$/.test(text)) {
                // Check if parent is in creator info area
                const parentCreator = el.closest('[class*="CreatorInfo"], [class*="DivCreatorInfoContainer"]');
                if (parentCreator) {
                    log(`getPosterInfo: Found username from text element: ${text}`);
                    return { username: text, url: buildProfileUrl(text) };
                }
            }
        }

        log('getPosterInfo: Could not find poster info');
        return null;
    }

    // ==================== UI - DASHBOARD ====================
    function initDashboard() {
        GM_addStyle(`
            #tt-blocker-panel {
                position: fixed;
                top: 80px;
                right: 20px;
                width: 400px;
                max-height: 600px;
                background: ${CONFIG.colors.panel};
                border-radius: 12px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.5);
                z-index: 99999;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                color: #fff;
                overflow: hidden;
            }

            #tt-blocker-panel.minimized {
                width: auto;
                max-height: none;
            }

            #tt-blocker-panel.minimized .panel-body {
                display: none;
            }

            .panel-header {
                background: linear-gradient(135deg, #fe2c55, #25f4ee);
                padding: 12px 16px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                cursor: move;
            }

            .panel-header h3 {
                margin: 0;
                font-size: 16px;
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .panel-toggle {
                background: rgba(255,255,255,0.2);
                border: none;
                color: white;
                width: 28px;
                height: 28px;
                border-radius: 50%;
                cursor: pointer;
                font-size: 14px;
            }

            .panel-body {
                padding: 12px;
            }

            .stats-row {
                display: flex;
                gap: 12px;
                margin-bottom: 12px;
                flex-wrap: wrap;
            }

            .stat-box {
                background: rgba(255,255,255,0.1);
                padding: 8px 12px;
                border-radius: 8px;
                flex: 1;
                min-width: 80px;
                text-align: center;
            }

            .stat-box .value {
                font-size: 20px;
                font-weight: bold;
                color: #25f4ee;
            }

            .stat-box .label {
                font-size: 11px;
                color: rgba(255,255,255,0.7);
                margin-top: 2px;
            }

            .controls-row {
                display: flex;
                gap: 8px;
                margin-bottom: 12px;
                flex-wrap: wrap;
            }

            .tt-btn {
                flex: 1;
                padding: 8px 12px;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-size: 12px;
                font-weight: bold;
                transition: all 0.2s;
                min-width: 70px;
            }

            .tt-btn:hover {
                opacity: 0.9;
                transform: translateY(-1px);
            }

            .tt-btn.primary {
                background: #fe2c55;
                color: white;
            }

            .tt-btn.secondary {
                background: rgba(255,255,255,0.15);
                color: white;
            }

            .tt-btn.success {
                background: #4CAF50;
                color: white;
            }

            .toggle-row {
                display: flex;
                align-items: center;
                gap: 10px;
                margin-bottom: 12px;
                padding: 8px;
                background: rgba(255,255,255,0.05);
                border-radius: 6px;
            }

            .toggle-switch {
                position: relative;
                width: 44px;
                height: 24px;
                background: #555;
                border-radius: 12px;
                cursor: pointer;
                transition: background 0.2s;
            }

            .toggle-switch.active {
                background: #4CAF50;
            }

            .toggle-switch::after {
                content: '';
                position: absolute;
                width: 20px;
                height: 20px;
                background: white;
                border-radius: 50%;
                top: 2px;
                left: 2px;
                transition: left 0.2s;
            }

            .toggle-switch.active::after {
                left: 22px;
            }

            .status-bar {
                padding: 8px;
                background: rgba(255,255,255,0.05);
                border-radius: 6px;
                margin-bottom: 12px;
                font-size: 12px;
                text-align: center;
            }

            .table-container {
                max-height: 250px;
                overflow-y: auto;
                border-radius: 6px;
                background: rgba(0,0,0,0.2);
            }

            #dash-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 11px;
            }

            #dash-table th {
                background: rgba(255,255,255,0.1);
                padding: 8px;
                text-align: left;
                position: sticky;
                top: 0;
            }

            #dash-table td {
                padding: 6px 8px;
                border-bottom: 1px solid rgba(255,255,255,0.05);
                max-width: 120px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            #dash-table a {
                color: #25f4ee;
                text-decoration: none;
            }

            #dash-table a:hover {
                text-decoration: underline;
            }

            .status-pending { color: #ff9800; }
            .status-blocking { color: #2196F3; }
            .status-blocked { color: #4CAF50; }
            .status-failed { color: #f44336; }

            .tt-ad-tag {
                animation: pulse 1s infinite;
            }

            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.7; }
            }

            /* Block button styles for comments */
            .tt-block-commenter-btn {
                background: #fe2c55 !important;
                color: white !important;
                border: none !important;
                padding: 2px 6px !important;
                border-radius: 4px !important;
                cursor: pointer !important;
                font-size: 10px !important;
                font-weight: bold !important;
                margin-left: 6px !important;
                vertical-align: middle !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                min-width: 22px !important;
                height: 20px !important;
                line-height: 1 !important;
            }

            .tt-block-commenter-btn:hover {
                opacity: 0.8 !important;
                transform: scale(1.1);
            }

            .tt-block-poster-btn {
                background: #fe2c55 !important;
                color: white !important;
                border: none !important;
                border-radius: 4px !important;
                cursor: pointer !important;
                font-weight: bold !important;
            }

            .tt-block-poster-btn:hover {
                opacity: 0.8 !important;
            }
        `);

        const panel = document.createElement('div');
        panel.id = 'tt-blocker-panel';
        panel.innerHTML = `
            <div class="panel-header">
                <h3>🚫 TikTok Blocker</h3>
                <button class="panel-toggle" id="panel-toggle">−</button>
            </div>
            <div class="panel-body">
                <div class="stats-row">
                    <div class="stat-box">
                        <div class="value" id="stat-total">0</div>
                        <div class="label">Total Blocked</div>
                    </div>
                    <div class="stat-box">
                        <div class="value" id="stat-session">0</div>
                        <div class="label">Session</div>
                    </div>
                    <div class="stat-box">
                        <div class="value" id="stat-ads">0</div>
                        <div class="label">Ads Blocked</div>
                    </div>
                    <div class="stat-box">
                        <div class="value" id="stat-queue">0</div>
                        <div class="label">Queue</div>
                    </div>
                </div>

                <div class="toggle-row">
                    <div class="toggle-switch ${state.autoBlockAds ? 'active' : ''}" id="toggle-auto-ads"></div>
                    <span>Auto-block Ads</span>
                </div>

                <div class="status-bar" id="dash-status">✓ Ready</div>

                <div class="controls-row">
                    <button class="tt-btn primary" id="btn-export">📤 Export</button>
                    <button class="tt-btn secondary" id="btn-import">📥 Import</button>
                    <button class="tt-btn secondary" id="btn-clear">🗑️ Clear</button>
                </div>

                <input type="file" id="import-file" accept=".csv" style="display:none;">

                <div class="table-container">
                    <table id="dash-table">
                        <thead>
                            <tr>
                                <th>Username</th>
                                <th>Source</th>
                                <th>Status</th>
                                <th>Time</th>
                            </tr>
                        </thead>
                        <tbody></tbody>
                    </table>
                </div>
            </div>
        `;

        document.body.appendChild(panel);

        // Event listeners
        document.getElementById('panel-toggle').onclick = () => {
            panel.classList.toggle('minimized');
            document.getElementById('panel-toggle').textContent =
                panel.classList.contains('minimized') ? '+' : '−';
        };

        document.getElementById('toggle-auto-ads').onclick = function() {
            state.autoBlockAds = !state.autoBlockAds;
            this.classList.toggle('active', state.autoBlockAds);
            saveSettings();
        };

        document.getElementById('btn-export').onclick = exportBlockList;

        document.getElementById('btn-import').onclick = () => {
            document.getElementById('import-file').click();
        };

        document.getElementById('import-file').onchange = function() {
            if (this.files.length > 0) {
                importBlockList(this.files[0]);
                this.value = '';
            }
        };

        document.getElementById('btn-clear').onclick = () => {
            if (confirm('Clear entire block list? This cannot be undone.')) {
                state.blockList = [];
                state.blockListUrls.clear();
                state.totalBlocked = 0;
                saveBlockList();
                document.querySelector('#dash-table tbody').innerHTML = '';
                updateDashboardCounts();
                log('Block list cleared');
            }
        };

        // Make panel draggable
        makeDraggable(panel, panel.querySelector('.panel-header'));

        // Populate table with existing blocked profiles
        refreshDashboardTable();
        updateDashboardCounts();
    }

    function makeDraggable(element, handle) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

        handle.onmousedown = dragMouseDown;

        function dragMouseDown(e) {
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }

        function elementDrag(e) {
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
            element.style.right = 'auto';
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
        }
    }

    function updateDashboardCounts() {
        const statTotal = document.getElementById('stat-total');
        const statSession = document.getElementById('stat-session');
        const statAds = document.getElementById('stat-ads');
        const statQueue = document.getElementById('stat-queue');

        if (statTotal) statTotal.textContent = state.totalBlocked;
        if (statSession) statSession.textContent = state.sessionBlocked;
        if (statAds) statAds.textContent = state.adsBlocked;
        if (statQueue) statQueue.textContent = state.blockQueue.length;
    }

    function updateDashboardStatus(msg) {
        const status = document.getElementById('dash-status');
        if (status) status.textContent = msg;
    }

    function addToDashboard(data, status) {
        const tbody = document.querySelector('#dash-table tbody');
        if (!tbody) return;

        const row = document.createElement('tr');
        row.dataset.url = data.url;

        let statusClass = `status-${status}`;
        let statusText = status;
        if (status === 'pending') statusText = '⏳ Pending';
        else if (status === 'blocking') statusText = '🔄 Blocking';
        else if (status === 'blocked') statusText = '✓ Blocked';

        row.innerHTML = `
            <td><a href="${data.url}" target="_blank">@${data.username}</a></td>
            <td>${data.source || 'manual'}</td>
            <td class="${statusClass}">${statusText}</td>
            <td>${new Date().toLocaleTimeString()}</td>
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
                const statusCell = row.children[2];
                if (statusCell) {
                    let statusText = status;
                    if (status === 'pending') statusText = '⏳ Pending';
                    else if (status === 'blocking') statusText = '🔄 Blocking';
                    else if (status === 'blocked') statusText = '✓ Blocked';
                    else if (status === 'failed') statusText = '❌ Failed';
                    statusCell.textContent = statusText;
                    statusCell.className = `status-${status}`;
                }
                break;
            }
        }
    }

    function refreshDashboardTable() {
        const tbody = document.querySelector('#dash-table tbody');
        if (!tbody) return;

        tbody.innerHTML = '';

        const entries = state.blockList.slice(0, CONFIG.dashboardRows);
        entries.forEach(entry => {
            const row = document.createElement('tr');
            row.dataset.url = entry.url;
            row.innerHTML = `
                <td><a href="${entry.url}" target="_blank">@${entry.username}</a></td>
                <td>${entry.source || 'manual'}</td>
                <td class="status-blocked">✓ Blocked</td>
                <td>${formatDate(entry.timestamp)}</td>
            `;
            tbody.appendChild(row);
        });
    }

    // ==================== MAIN LOOP ====================
    function scanPage() {
        addBlockButtonToPosters();
        addBlockButtonToCommenters();
        detectAdsInFeed();
    }

    // ==================== INIT ====================
    function init() {
        log('TikTok Blocker v1.0 Starting...');

        // Check if this is a blocking tab
        if (isBlockingTab() && isProfilePage()) {
            log('Running as blocking tab');
            setTimeout(runBlockingTab, 1500);
            return;
        }

        // Load saved data
        loadBlockList();
        loadSettings();

        // Initialize dashboard
        initDashboard();

        // Start scanning
        setInterval(scanPage, CONFIG.scanInterval);
        scanPage();

        // MutationObserver for dynamic content
        const observer = new MutationObserver(() => {
            scanPage();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        log('Initialization complete - v1.2 with improved ad detection');
    }

    // Start when ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();