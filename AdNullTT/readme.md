# TikTok AdNull Blocker

A userscript that automatically detects and blocks TikTok ads, with manual blocking for video posters and commenters. Maintains a persistent block list with import/export functionality.

<img width="500" height="702" alt="2026-01-01 05_31_29-Greenshot" src="https://github.com/user-attachments/assets/21051cd5-24ee-4b8b-9d8b-f5941dccbd51" />

## Features

- **Auto-detect ads** – Identifies sponsored content using multiple detection methods
- **Auto-block ad accounts** – Automatically blocks the profile behind each ad and skips to the next video
- **Manual blocking** – Block buttons appear next to video posters and commenters
- **Persistent block list** – Your blocks are saved locally and persist across sessions
- **Import/Export** – Back up your block list as CSV or import from another device
- **Dashboard UI** – Draggable panel showing stats, queue status, and recent blocks
- **Captcha-friendly** – Waits patiently if you need to solve a captcha during blocking

## Installation

1. Install a userscript manager:
   - [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Firefox, Edge, Safari)
   - [Violentmonkey](https://violentmonkey.github.io/) (Chrome, Firefox)
   - [Greasemonkey](https://www.greasespot.net/) (Firefox)

2. Click the raw script file or create a new script and paste the contents

3. Visit [TikTok](https://www.tiktok.com) and the dashboard will appear in the top-right corner

## Usage

### Automatic Ad Blocking
Ads are detected automatically as you scroll. When an ad is found:
1. A red "🚫 AD - AUTO BLOCKING" tag appears on the video
2. The ad account is queued for blocking
3. A new tab opens to the profile and performs the block
4. The video skips to the next one

Toggle auto-blocking on/off using the switch in the dashboard.

### Manual Blocking
- **Video posters**: Click the 🚫 button near the poster's avatar
- **Commenters**: Click the 🚫 button next to any commenter's username

### Block List Management
- **Export**: Downloads your block list as a CSV file
- **Import**: Load a previously exported block list (duplicates are skipped)
- **Clear**: Remove all entries from your block list

## Dashboard

| Stat | Description |
|------|-------------|
| Total Blocked | All-time blocked accounts |
| Session | Accounts blocked this session |
| Ads Blocked | Ads detected and blocked |
| Queue | Accounts waiting to be blocked |

## How Blocking Works

1. Profile URL is opened in a new tab with a special flag
2. Script waits for the page to load (handles captchas)
3. Clicks the "..." menu → "Block" → Confirms in popup
4. Signals completion and closes the tab
5. Main tab updates the block list and UI

## Configuration

Edit the `CONFIG` object at the top of the script:

```javascript
const CONFIG = {
    debug: true,              // Console logging
    scanInterval: 1000,       // How often to scan for new content (ms)
    maxPolls: 120,            // Max wait time for captcha (× pollInterval)
    pollInterval: 500,        // Check interval during blocking (ms)
    adKeywords: [...]         // Words that identify sponsored content
};
```

## Permissions

| Permission | Purpose |
|------------|---------|
| `GM_addStyle` | Inject dashboard CSS |
| `GM_setValue` / `GM_getValue` | Persist block list |
| `GM_openInTab` | Open profile tabs for blocking |
| `window.close` | Close tabs after blocking |

## Troubleshooting

**Ads detected but not blocked?**
- Check the browser console (F12) for `[AdNull TikTok]` logs
- Ensure auto-block is enabled in the dashboard

**Block buttons not appearing on comments?**
- Comments load dynamically; scroll or wait a moment
- The script scans every second for new content

**Blocking tab not closing?**
- You may need to solve a captcha first
- The script waits up to 60 seconds before timing out

**Dashboard not visible?**
- Check if it's minimized (look for a small panel in the top-right)
- Try refreshing the page

## License

MIT License – free to use, modify, and distribute.

## Contributing

Issues and pull requests welcome! Please include console logs when reporting bugs.
