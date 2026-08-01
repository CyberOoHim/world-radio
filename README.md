# World Radio

A calm, ambient web app for listening to **thousands of live radio stations** from around the world.

Stations come from the free community [Radio Browser](https://www.radio-browser.info/) directory (30k+ streams across every continent).

## Features

- **Discover** — popular stations and relaxing mood chips (jazz, ambient, classical, chillout…)
- **Countries** — browse by continent and country
- **Genres** — full tag directory from the global catalog
- **Search** — find stations by name, city, or keyword
- **Favorites & recent** — saved in your browser
- **Soft player** — volume, mute, live equalizer pulse, ambient orbs

## iPad / offline single file

Open **`world-radio.html`** directly in Safari (or any browser).  
No install, no build — one self-contained file.

### On iPad
1. AirDrop / copy `world-radio.html` to **Files** (e.g. On My iPad or iCloud Drive)
2. Tap the file → **Share** → **Open in Safari** (or open from Files)
3. Optional: Share → **Add to Home Screen** for an app-like icon
4. Needs **Wi‑Fi** (loads stations from Radio Browser + streams)

## Dev app (Vite)

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually `http://localhost:5173`).

```bash
npm run build    # production build → dist/
npm run preview  # preview production build
```

## Stack

- Vite + TypeScript
- Radio Browser HTTP API (multi-mirror failover)
- Local storage for favorites, history, and volume

No account required. Some streams may fail due to geo-blocks, dead links, or mixed-content rules — try another station if one won’t play.
