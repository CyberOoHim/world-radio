# World Radio 🌍📻

A modern, ambient web application for discovering and listening to **thousands of live radio stations** from around the globe.

Powered by the community-driven [Radio Browser](https://www.radio-browser.info/) directory (30,000+ live streams across every continent).

**Live App:** [https://CyberOoHim.github.io/world-radio/](https://CyberOoHim.github.io/world-radio/)

---

## ✨ Features

### 🎧 Audio Player & Sound Processing
- **Resilient Playback Engine** — Automatic HTTP-to-HTTPS upgrade for secure streams with fallback to original stream URLs.
- **Failover & Reconnect** — Multi-mirror API failover (`de1`, `nl1`, `at1`, `fr1`) with automated mirror probe monitoring and stream connection timeouts.
- **Web Audio FX & 8-Band Equalizer** — Built-in spatial audio environment presets (Music Hall, Cathedral, Radio Booth, etc.), voice effects, and customizable 8-band graphic equalizer with custom preset creation, naming, and deletion. *(Audio FX & EQ are automatically bypassed on iOS/iPadOS to ensure smooth native streaming).*
- **Soft Volume Fades** — Smooth ~400ms volume fade-in on playback start and gentle fade-out when sleep timer finishes.
- **Close & Hard-Stop** — Dedicated close button to stop playback, detach stream source, and cancel in-flight network requests.
- **Resume Last Station** — Quick action button and automatic restoration of the last played station across reloads.
- **Sleep Timer** — Flexible timer (15, 30, 45, 60, 90 mins) with live countdown (`M:SS`), soft fade-out, and state restoration after reload.

### 🌍 Discovery & Curated Modes
- **🎲 Surprise Me Pipeline** — Smart random station generator with multi-try connect pipeline (~60s budget, up to 6 retry attempts):
  - **Surprise · Anywhere** — Pick random station globally from the community pool.
  - **Surprise · Here** — Pick random station filtered by local country / location.
- **📍 Near Me** — Geolocation discovery via HTML5 Geolocation with expanding radius (100km to 2500km) and proximity badges (e.g. `12 km`, `450 km`).
- **🗺️ World Map & Passport** — Leaflet map that plots geo-tagged stations in the current viewport:
  - **Styles:** Streets (Carto Voyager, default), Terrain (Esri World Topo), and Satellite (Esri World Imagery) with state persistence.
  - **Interactive Pins:** Tinted by local sun position (day/night) with a real-time station clock HUD.
  - **Wander Mode:** Hops to a random global station with 20s blind listening (hidden place name) and manual reveal.
  - **Listening Passport:** Stamps visited countries and cities after ≥90s of listening; jump directly to any stamped place on the map.
  - **Offline Detection:** Banner notifications when offline.
- **☀️ Right Now (Time of Day)** — Station mood strip following local clock or chosen period (Morning 🌅, Day ☀️, Evening 🌇, Night 🌙) with a **"Play Period Mix"** button for instant curated playback.
- **🎵 Mood Chips & Expanded Genres** — Curated mood tags (Jazz, Classical, Lo-Fi, Country, Latin, Sports, Metal, Indie, 80s, Soundtrack, Ambient, Chillout, etc.) plus full tag catalog.
- **🎲 Dynamic Random Genre Picker** — Pick random genres with a **"Random all genres" toggle** to switch between curated mood tags and the full catalog.
- **🌐 Countries & Continents** — Directory filterable by continent (Africa, Asia, Europe, North America, South America, Oceania) and country.

### 🔍 Search, Filters & Organization
- **Instant Search** — Real-time debounced search by station name, city, tag, or keyword.
- **Sorting Options** — Sort stations by Popularity, Trending, Votes, Name, Bitrate, or Random (dynamic cache-busting shuffle).
- **Tag Playback Behavior** — Configure behavior on tag selection: *Keep current station*, *Play 1st station*, or *Play random station*.
- **Station Details Sheet** — Detailed inspect sheet showing bitrate, codec, votes, click counts, click trends, country flag, broadcast language, tags, coordinates, homepage link, direct stream link, and a **"Show on Map"** shortcut.
- **HTTPS-Only Toggle** — Default-ON filter (`httpsOnly: true`) to prevent browser mixed-content playback blocks on HTTPS web hosts.
- **Language Filter** — Filter stations by broadcast language.
- **Snapshot Favorites & Folders** — Save stations as full offline snapshots (up to 200 stations) with customizable folder organization.
- **Import & Export** — Back up or transfer saved favorites via JSON file import/export.
- **Recent History** — Track recently played stations (up to 40 stations) with search and clear capabilities.

### 📲 PWA & System Integration
- **Installable PWA** — Offline app shell caching powered by a Service Worker (`sw.js`) and Add-to-Home-Screen (A2HS) install prompt.
- **🔤 Font Size Adjustment** — Sidebar `A−` / `100%` / `A+` controls (80% to 130% range) with instant app-wide typography scaling and persistent preference storage.
- **🔄 Reload from Web** — One-click refresh button in the sidebar footer that flushes Service Worker caches and pulls the latest web app bundle directly from the server.
- **↩️ Restore Default Values** — Safe reset button with an accessible confirmation dialog (`role="alertdialog"`, focus trap, `Escape` to cancel) that clears stored favorites, history, audio effects, and custom equalizer presets back to factory defaults.
- **Media Session API** — OS lock screen and headset controls with station title, country artwork, and smooth line vector icon.
- **Deep Hash Routing** — Shareable links for stations (`#/station/:uuid`), tags (`#/tag/:tag`), countries (`#/country/:code`), search (`#/search/:q`), near me (`#/near`), map (`#/map`, `#/map/:lat,:lon/:zoom`), and top-level views (`#/`, `#/countries`, `#/genres`, `#/favorites`, `#/recent`).
- **Toast Feedback System** — Visual notifications for actions such as copying station share links, favorite updates, and import/export results.
- **Safe HTML & URL Sanitization** — All user inputs, API strings, and station URLs are strictly validated and escaped against XSS and unsafe protocols.

### ⌨️ Keyboard Shortcuts
| Key | Action |
| --- | --- |
| `Space` | Play / Pause toggle |
| `/` | Focus search input |
| `N` / `P` | Next / Previous station in list |
| `M` | Mute / Unmute toggle |
| `↑` / `↓` or `←` / `→` | Adjust volume (5% increments) |
| `Esc` | Close FX/EQ modal, confirmation dialog, detail sheet, sleep menu, or nav drawer |

---

## 🛠 Tech Stack

- **Framework:** Vite + TypeScript
- **Styling:** Custom CSS design system with responsive layouts & retro-modern radio vector iconography
- **Typography:** DM Sans & Instrument Serif (via `@fontsource`)
- **API:** Radio Browser HTTP API (multi-mirror failover & stream URL resolver)
- **Map:** Leaflet + Streets (CARTO Voyager), Terrain (Esri World Topo), Satellite (Esri World Imagery); viewport station fetch via `geo_lat` / `geo_long` / `geo_distance`
- **Audio:** HTML5 Audio + Web Audio API (BiquadFilter, Convolver, DynamicsCompressor, GainNode)
- **PWA:** Web App Manifest + Service Worker offline shell
- **Testing:** Vitest

---

## 💻 Development

### Setup & Scripts

```bash
# Install dependencies
npm install

# Start development server (http://localhost:5173)
npm run dev

# Run unit tests
npm test

# Type-check and build for production
npm run build

# Preview production build locally
npm run preview

# Verify production output paths
npm run deploy:check
```

---

## 🚀 Deployment (GitHub Pages)

Continuous deployment is automated via GitHub Actions ([`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)).

1. Push updates to the `main` branch.
2. The workflow automatically runs unit tests (`npm test`), builds the production bundle (`npm run build`), and deploys the `dist/` directory to GitHub Pages.
3. `vite.config.ts` uses `base: './'` so all asset paths resolve properly on GitHub Pages or custom subdirectories.

---

## 📄 License

MIT License. Radio stream data is provided under open community licenses by [Radio Browser](https://www.radio-browser.info/).
