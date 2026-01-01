# Facebook AdNull Blocker

A userscript that automatically detects and blocks Facebook sponsored posts and reels, with manual blocking for any account. Features an auto-scrolling scanner, persistent logs, and flexible export options.

<img width="565" height="587" alt="2026-01-01 05_31_56-C__Users_Admin_Desktop_Facebook AdNull Blocker user js - Notepad++  Administrato" src="https://github.com/user-attachments/assets/d41b8633-5fd6-45b5-9017-953f6cc70747" />

## Features

- **Auto-detect sponsored content** – Identifies ads in your feed and reels
- **Auto-block sponsors** – Automatically blocks the page/profile behind each ad
- **Auto-skip sponsored reels** – Skips to the next reel when an ad is detected
- **Manual blocking** – Block buttons on ALL posts and reels, not just ads
- **Auto-scrolling scanner** – Scans your feed hands-free with adjustable speed
- **Separate exports** – Export auto-detected sponsors, manual blocks, or both
- **Persistent storage** – Block list and master log saved across sessions
- **Import/Export** – Back up your data as CSV or transfer between devices
- **Dashboard UI** – Draggable panel with stats, controls, and activity log

## Installation

1. Install a userscript manager:
   - [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Firefox, Edge, Safari)
   - [Violentmonkey](https://violentmonkey.github.io/) (Chrome, Firefox)
   - [Greasemonkey](https://www.greasespot.net/) (Firefox)

2. Click the raw script file or create a new script and paste the contents

3. Visit [Facebook](https://www.facebook.com) and the dashboard will appear in the top-right corner

## Usage

### Automatic Scanning
Click **Start** in the dashboard to begin auto-scrolling through your feed:
1. The scanner scrolls and detects sponsored posts
2. Sponsors are logged and queued for blocking
3. New tabs open to perform blocks automatically
4. Feed continues scrolling after each block

### Speed Presets
| Speed | Scroll Delay | Best For |
|-------|--------------|----------|
| Slow | 3 seconds | Careful review |
| Normal | 2 seconds | Balanced scanning |
| Fast | 1.2 seconds | Quick passes |
| Turbo | 0.6 seconds | Maximum coverage |

### Manual Blocking
Every post and reel has a 🚫 block button. Click it to:
1. Queue the author for blocking
2. Open their profile in a new tab
3. Execute the block automatically

### Reels Support
On the Reels page (`/reel` or `/reels`):
- Sponsored reels are detected and auto-skipped
- Block buttons appear on each reel
- Scanner pauses scrolling (reels auto-advance)

### Export Options
- **Export All** – Complete master log (auto + manual)
- **Export Auto** – Only auto-detected sponsors
- **Export Manual** – Only manually blocked accounts

## Dashboard

| Stat | Description |
|------|-------------|
| Session | Sponsors detected this session |
| Total Blocked | All-time blocked accounts |
| Manual | Accounts manually blocked |
| Queue | Accounts waiting to be blocked |

| Control | Function |
|---------|----------|
| Start/Stop | Toggle auto-scrolling scanner |
| Speed | Cycle through speed presets |
| Export | Download master log as CSV |
| Import | Load a previously exported CSV |
| Clear | Reset master log (with confirmation) |

## How Blocking Works

1. Sponsored post detected → added to queue
2. Profile URL opened in new tab with special flag
3. Script clicks "..." menu → "Block" → Confirms
4. Tab closes, main feed continues
5. Master log updated with blocked status

## Console API

Access advanced functions via browser console:

```javascript
fbBlocker.start()              // Start scanner
fbBlocker.stop()               // Stop scanner
fbBlocker.export()             // Export all entries
fbBlocker.exportAuto()         // Export auto-detected only
fbBlocker.exportManual()       // Export manual blocks only
fbBlocker.import()             // Open import dialog
fbBlocker.blockUrl(url, name)  // Manually queue a block
fbBlocker.clearLog()           // Clear master log
fbBlocker.clearBlocked()       // Clear blocked list
fbBlocker.clearQueue()         // Clear pending queue
fbBlocker.state                // View current state
fbBlocker.masterLog()          // View master log
```

## Configuration

Edit the `CONFIG` object at the top of the script:

```javascript
const CONFIG = {
    debug: true,              // Console logging
    scanInterval: 500,        // Feed scan frequency (ms)
    reelsScanInterval: 1500,  // Reels scan frequency (ms)
    speeds: {                 // Speed presets
        slow:   { delay: 3000, amount: 600 },
        normal: { delay: 2000, amount: 900 },
        fast:   { delay: 1200, amount: 1200 },
        turbo:  { delay: 600,  amount: 1500 }
    }
};
```

## Permissions

| Permission | Purpose |
|------------|---------|
| `GM_addStyle` | Inject dashboard CSS |
| `GM_setValue` / `GM_getValue` | Persist block list and settings |
| `GM_openInTab` | Open profile tabs for blocking |
| `window.close` | Close tabs after blocking |

## Supported Pages

- `facebook.com` – Main feed
- `facebook.com/reel/*` – Individual reels  
- `facebook.com/reels/*` – Reels feed
- `m.facebook.com` – Mobile web
- `web.facebook.com` – Alternate domain

## Troubleshooting

**Sponsors not being detected?**
- Ensure you're on the main feed (`/` or `/home`)
- Check console (F12) for `[FB Scanner]` logs
- Facebook may have changed their HTML structure

**Blocking tab not closing?**
- You may need to complete a confirmation dialog
- Check if Facebook is asking for verification

**Dashboard not visible?**
- Look for a minimized panel in the top-right
- Try refreshing the page
- Check if another extension is conflicting

**Scanner stops unexpectedly?**
- Feed may have reached the end
- Scanner auto-stops and can refresh after cooldown

## License

MIT License – free to use, modify, and distribute.

## Contributing

Issues and pull requests welcome! Include console logs and Facebook page type when reporting bugs.
