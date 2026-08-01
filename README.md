# World Radio

A calm, ambient web app for listening to **thousands of live radio stations** from around the world.

Stations come from the free community [Radio Browser](https://www.radio-browser.info/) directory (30k+ streams across every continent).

**Live:** [https://CyberOoHim.github.io/world_radioX/](https://CyberOoHim.github.io/world_radioX/)

## Features

- **Discover** — popular stations and relaxing mood chips (jazz, ambient, classical, chillout…)
- **Countries** — browse by continent and country
- **Genres** — full tag directory from the global catalog
- **Search** — find stations by name, city, or keyword
- **Favorites & recent** — saved in your browser
- **Soft player** — volume, mute, live equalizer pulse, ambient orbs

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
- Local storage for favorites, history, and volume

No account required. Some streams may fail due to geo-blocks, dead links, or mixed-content rules — try another station if one won’t play.
