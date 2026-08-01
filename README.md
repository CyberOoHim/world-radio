# World Radio

A calm, ambient web app for listening to **thousands of live radio stations** from around the world.

Stations come from the free community [Radio Browser](https://www.radio-browser.info/) directory (30k+ streams across every continent).

**Live:** [https://CyberOoHim.github.io/world_radioX/](https://CyberOoHim.github.io/world_radioX/)

## Features

- **Discover** — popular stations, mood chips, time-of-day picks, **Surprise me**, **Near me**
- **Countries** — browse by continent and country (filterable)
- **Genres** — full tag directory with local search
- **Search** — stations by name, city, or keyword
- **Sort & filters** — popular, trending, votes, name, bitrate, language, HTTPS-only
- **Favorites & recent** — saved as full station snapshots; export/import JSON
- **Player** — play/pause, next/prev, volume, mute, sleep timer, soft fade, share
- **Resume** — last station restored on reload (play starts on your gesture)
- **Media Session** — lock screen / OS / headset controls
- **Deep links** — `#/station/:uuid`, `#/tag/jazz`, `#/country/JP`, `#/search/…`
- **Keyboard** — Space play/pause · `/` search · `N`/`P` next/prev · `M` mute · arrows volume · Esc close
- **PWA** — installable shell with offline app chrome (streams still need network)

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production → dist/
npm run preview  # preview dist/
```

There is a **single** HTML entry: `index.html` (Vite + TypeScript in `src/`). GitHub Actions builds and deploys `dist/`.

## Deploy (GitHub Pages)

Push to `main`. Workflow: `.github/workflows/deploy-pages.yml`.

Repo settings: **Pages → Source: GitHub Actions**.

`vite.config.ts` uses `base: './'` so assets work under `/world_radioX/`.

## Stack

- Vite + TypeScript
- Radio Browser HTTP API (multi-mirror failover)
- Local storage for favorites, history, volume, last station, prefs
- Optional service worker for shell caching

No account required. Some streams may fail due to geo-blocks, dead links, or mixed-content rules — use **Play next** or **Surprise me** if one won’t play.
