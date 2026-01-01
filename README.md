# AdNull 🚫

### The nuclear option for social media ads.

**AdNull doesn't hide ads. It blocks the accounts that post them.**

---

## The Problem

Ad blockers play defense. They hide sponsored posts, filter elements, and pretend ads don't exist. But the advertisers are still there, lurking in your feed, waiting for the next page refresh.

Meanwhile, social platforms are in an arms race—constantly changing class names, restructuring DOM elements, and finding new ways to slip ads past your filters. It's an endless game of whack-a-mole, and you're holding a foam hammer.

## The Solution

**AdNull goes on offense.**

When AdNull detects a sponsored post, it doesn't hide it—it opens the advertiser's profile and *blocks them entirely*. That account will never appear in your feed again. Not as an ad. Not as a suggested follow. Not in comments. Gone.

```
Traditional ad blocker:  Ad appears → Hide element → Ad appears again tomorrow
AdNull:                  Ad appears → Block account → Never see them again
```

Every blocked advertiser is one less account that can reach you. Over time, your feed gets cleaner—not because you're filtering harder, but because there's simply *less to filter*.

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  1. DETECT      Scan feed for sponsored/promoted content    │
│  2. IDENTIFY    Extract the advertiser's profile URL        │
│  3. QUEUE       Add to blocking queue                       │
│  4. EXECUTE     Open profile → Click Block → Confirm        │
│  5. RECORD      Log to master list, update stats            │
│  6. REPEAT      Continue scanning, building your blacklist  │
└─────────────────────────────────────────────────────────────┘
```

The scripts handle everything automatically. You just scroll (or let auto-scroll do it) and watch your block list grow.

## Supported Platforms

| Platform | Script | Features |
|----------|--------|----------|
| **Facebook** | [Facebook AdNull Blocker](./facebook/) | Feed scanning, Reels support, auto-scroll, speed presets, manual blocking on any post |
| **TikTok** | [TikTok AdNull Blocker](./tiktok/) | Feed scanning, auto-skip ads, comment blocking, captcha-friendly waits |

## Quick Start

### 1. Install a Userscript Manager
- [Tampermonkey](https://www.tampermonkey.net/) (recommended)
- [Violentmonkey](https://violentmonkey.github.io/)
- [Greasemonkey](https://www.greasespot.net/)

### 2. Install the Script(s)
Click the raw `.user.js` file for your platform, or copy-paste into a new script.

### 3. Import a Starter Block List (Optional)
Each platform folder includes community-contributed block lists. Import them to start with thousands of known advertisers already blocked.

### 4. Browse Normally
The dashboard appears automatically. Ads get detected, accounts get blocked, your feed gets cleaner.

## The Blocklist Advantage

Yes, blocking advertisers one-by-one sounds like whack-a-mole. But here's the thing:

**Advertisers aren't infinite.** 

The same accounts run campaigns repeatedly. Block them once, they're gone forever. And when you combine your blocks with community-shared lists, you're not starting from zero—you're starting with a pre-built wall.

### Sharing is Caring
- **Export** your block list as CSV
- **Share** with friends or the community
- **Import** others' lists to expand your coverage
- **Merge** lists automatically (duplicates are skipped)

A blocklist with 10,000 entries might sound like a lot of moles whacked. But that's 10,000 accounts that will *never* waste your attention again.

## Features at a Glance

### 🎯 Automatic Detection
Identifies sponsored content using multiple methods—keywords, DOM patterns, metadata attributes. Adapts to platform changes.

### ⚡ Automatic Blocking  
Opens profiles in background tabs, executes the block sequence, closes the tab. No manual clicking required.

### 📊 Dashboard UI
Draggable control panel showing:
- Detection stats (session & all-time)
- Block queue status
- Recent activity log
- Import/Export controls

### 💾 Persistent Storage
Block lists and logs survive browser restarts. Pick up where you left off.

### 🔄 Import/Export
CSV format for easy sharing, backup, and cross-device sync.

### 🛡️ Manual Override
Not an ad but still annoying? Every post has a block button. One click to queue any account.

## Philosophy

> *"The best ad is one you never see—from an account that can't reach you."*

AdNull is built on a simple principle: **blocking is better than hiding.**

- Hiding is temporary. Blocking is permanent.
- Hiding requires constant filtering. Blocking is set-and-forget.
- Hiding treats symptoms. Blocking eliminates the source.

We're not trying to build a smarter filter. We're trying to make filtering unnecessary.

## Technical Details

### Requirements
- Modern browser (Chrome, Firefox, Edge, Safari)
- Userscript manager with `GM_*` API support
- Logged into the target platform

### Permissions Used
| Permission | Purpose |
|------------|---------|
| `GM_addStyle` | Inject UI styles |
| `GM_setValue/getValue` | Persist data locally |
| `GM_openInTab` | Open blocking tabs |
| `window.close` | Close tabs after blocking |

### Data Storage
All data is stored locally in your browser via the userscript manager. Nothing is sent to external servers. Your block list is yours.

## Limitations

- **Rate limits**: Blocking too fast may trigger platform security measures. Scripts include delays to stay under the radar.
- **Captchas**: Occasionally you'll need to solve one. Scripts wait patiently.
- **New advertisers**: Yes, new ones will appear. That's what the auto-blocker is for.
- **Platform changes**: DOM structures change. Scripts are updated to adapt.

## Roadmap

- [ ] Instagram support
- [ ] YouTube support
- [ ] Centralized blocklist repository
- [ ] Browser extension wrapper (no userscript manager needed)
- [ ] Blocklist sync across devices

## Contributing

Found a bug? Ads slipping through? Platform changed their HTML?

1. Open an issue with console logs and page context
2. PRs welcome for new detection patterns
3. Share your blocklists to help the community

## License

MIT License – free to use, modify, and distribute.

---

<p align="center">
  <strong>Stop hiding from ads. Eliminate them.</strong><br>
  <em>AdNull</em>
</p>
