# World Radio

A calm, ambient web app for listening to **thousands of live radio stations** from around the world.

Powered by the community-driven [Radio Browser](https://www.radio-browser.info/) directory (30,000+ live streams across every continent).

**Live Demo:** [https://CyberOoHim.github.io/world_radio/](https://CyberOoHim.github.io/world_radio/)

---

## Features

### 🎧 Audio Player & Playback
- **Resilient Playback** — Automatic HTTP-to-HTTPS upgrade for secure streams with fallback to original stream URLs.
- **Failover & Reconnect** — Multi-mirror API failover (`de1`, `nl1`, `at1`, `fr1`) with automated mirror probe monitoring.
- **Soft Volume Fades** — Smooth ~400ms volume fade-in on playback start and gentle fade-out when sleep timer finishes.
- **Close & Hard-Stop** — Dedicated close button to stop playback, detach stream source, and cancel in-flight network requests.
- **Resume Last Station** — Quick action button and automatic restoration of the last played station across reloads.
- **Sleep Timer** — Flexible timer (15, 30, 45, 60, 90 mins) with live countdown display (`M:SS`) and soft audio fade.

### 🌍 Discovery & Modes
- **Surprise Me** — Smart random station generator with multi-try connect pipeline (~60s budget, up to 6 retry attempts):
  - **Surprise · Anywhere** — Pick random station globally from community pool.
  - **Surprise · Here** — Pick random station filtered by local country / location.
- **Near Me** — Geolocation discovery via HTML5 Geolocation with expanding radius (100km to 2500km) and proximity badges (e.g. `12 km`, `450 km`).
- **Right Now (Time of Day)** — Time-tailored station pick strip (Morning 🌅, Day ☀️, Evening 🌇, Night 🌙) following local clock or user-pinned period.
- **Mood Chips & Genres** — Curated ambient and relaxing mood tags (Jazz, Classical, Ambient, Chillout, Lounge, Meditation, etc.) plus a full tag directory.
- **Countries & Continents** — Filterable directory by continent (Africa, Asia, Europe, North America, South America, Oceania) and country.

### 🔍 Search, Filters & Preferences
- **Instant Search** — Real-time debounced search by station name, city, tag, or keyword.
- **Sorting Options** — Sort stations by Popularity, Trending, Votes, Name, Bitrate, or Random.
- **HTTPS-Only Toggle** — Option to filter non-secure streams for reliable playback on HTTPS environments.
- **Language Filter** — Filter stations by broadcast language.

### ❤️ Favorites & History Management
- **Snapshot Favorites** — Save stations as full offline snapshots (up to 200 stations).
- **Import & Export** — Back up or transfer saved favorites via JSON file import/export.
- **Recent History** — Track recently played stations (up to 40 stations).
- **Session Persistence** — Remembers volume, mute state, preferences, and last played station in local storage.

### 📲 PWA & System Integration
- **Installable PWA** — Offline app shell caching powered by a Service Worker (`sw.js`).
- **Media Session API** — OS lock screen and headset controls with station title, country artwork, and smooth line vector icon.
- **Deep Hash Routing** — Shareable links for stations (`#/station/:uuid`), tags (`#/tag/:tag`), countries (`#/country/:code`), search (`#/search/:q`), near me (`#/near`), and top-level views (`#/`, `#/countries`, `#/genres`, `#/favorites`, `#/recent`).
- **Toast Feedback System** — Visual notifications for actions such as copying station share links, favorite updates, and import/export results.

### ⌨️ Keyboard Shortcuts
- `Space` — Play / Pause toggle
- `/` — Focus search input
- `N` / `P` — Next / Previous station
- `M` — Mute / Unmute toggle
- `↑` / `↓` — Adjust volume up / down (5% increments)
- `Esc` — Close detail modal or collapse active menus

---

## 🛠 Tech Stack

- **Framework:** Vite + TypeScript
- **Styling:** Custom CSS design system with responsive layouts & smooth-line retro radio vector iconography
- **Typography:** DM Sans & Instrument Serif (via `@fontsource`)
- **API:** Radio Browser HTTP API (multi-mirror failover & stream URL resolver)
- **PWA:** Web App Manifest + Service Worker offline shell

---

## 💻 Development

### Setup & Scripts

```bash
# Install dependencies
npm install

# Start development server (http://localhost:5173)
npm run dev

# Type-check and build for production
npm run build

# Preview production build locally
npm run preview

# Verify production output paths
npm run deploy:check
```

---

## 🚀 Deployment (GitHub Pages)

Automatic deployment is configured via GitHub Actions (`.github/workflows/deploy-pages.yml`).

1. Push updates to the `main` branch.
2. Ensure GitHub repository setting: **Pages → Source: GitHub Actions**.
3. `vite.config.ts` uses `base: './'` so assets work relative to `/world_radio/`.
