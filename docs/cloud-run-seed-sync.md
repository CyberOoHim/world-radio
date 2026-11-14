# Cloud Run AI Seed Hydration & Git Sync Guide

This guide explains how the AI station seed catalog ([`data/station-seed-index.json`](/data/station-seed-index.json)) behaves after deploying to Cloud Run when `SEED_SWEET_SPOT_COUNT` (default **6,000**) changes, how startup RAM sync adjusts the catalog and embeddings, and how to commit the synced file back to Git.

---

## 1. What Happens After Cloud Run Deployment?

| Asset | State in Repo | Runtime Behavior on Cloud Run |
| :--- | :--- | :--- |
| **Bundled Station Catalog** | Pre-generated and bundled in [`data/station-seed-index.json`](/data/station-seed-index.json) | Loaded from disk into RAM at startup (`<50ms`). |
| **Config Drift Auto-Sync** (`SEED_SWEET_SPOT_COUNT`, default `6000`) | Controlled via `SEED_SWEET_SPOT_COUNT` env var | On server startup (`startSeedSyncBackground()`), if the bundled count differs from `SEED_SWEET_SPOT_COUNT`, Cloud Run incrementally grows (fetching only the delta from Radio Browser) or trims the in-memory pool—preserving all existing stations and `vec` embeddings. |
| **Pre-computed Vectors (`vec`)** (`768`-dim `Int8` base64) | Existing stations retain `vec`; newly added delta stations start without `vec` until synced | Background startup sync uses the server's `GEMINI_API_KEY` to batch-embed only missing/new stations into **RAM**. |

> **Important Cloud Run Caveat:** Runtime-computed delta stations and `vec` embeddings live **only in that container's memory**. Cloud Run does not write them back to `data/station-seed-index.json` on disk, so cold starts or new container instances must re-sync any delta until the updated JSON is committed to Git.

---

## 2. Download the Synced & Hydrated Seed from Cloud Run

The backend exposes an AI-authenticated export endpoint (`GET /api/ai/seed-export?hydrate=1`). Passing `hydrate=1` makes the server complete any pending `SEED_SWEET_SPOT_COUNT` delta sync and compute all missing `vec` embeddings in RAM before streaming back `station-seed-index.json`.

### Option A: Download via Browser (Simplest)

1. Open your deployed Cloud Run app and unlock **AI Tune** using your configured `APP_PASSCODE`.
   - *Note: The guest passcode (`guest-radio`) only unlocks map features and returns `403 AI_AUTH_REQUIRED` on `/api/ai/*`.*
2. In the same browser tab/origin, open:
   ```text
   https://<your-cloud-run-host>/api/ai/seed-export?hydrate=1
   ```
3. Wait for server-side delta sync and embedding hydration to complete; the browser will download `station-seed-index.json`.
4. Move the downloaded file into your local Git repo, overwriting `data/station-seed-index.json`.

### Option B: Download via Terminal (`curl`)

1. Exchange your `APP_PASSCODE` for a full-access JWT via `POST /api/auth/verify`:
   ```bash
   TOKEN=$(curl -sS -X POST "https://<your-cloud-run-host>/api/auth/verify" \
     -H "Content-Type: application/json" \
     -d '{"passcode":"<YOUR_APP_PASSCODE>"}' \
     | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if(!d.token) { console.error(d); process.exit(1); } process.stdout.write(d.token);')
   ```
2. Stream the synced, hydrated seed file directly into `data/station-seed-index.json`:
   ```bash
   curl -fL "https://<your-cloud-run-host>/api/ai/seed-export?hydrate=1" \
     -H "Authorization: Bearer $TOKEN" \
     -o data/station-seed-index.json
   ```

---

## 3. Commit & Push Back to Git Remote

`data/` is tracked by Git (not excluded in [`.gitignore`](/.gitignore)), and the hydrated `6,000`-station file (`~10 MB`) is well below GitHub's 50 MB warning and 100 MB file-size limits—no Git LFS is required:

```bash
git add data/station-seed-index.json
git commit -m "chore: sync 6,000-station AI seed index and embeddings"
git push
```

Once redeployed from that commit, every Cloud Run instance starts with all configured stations and vectors pre-loaded in RAM (`<5ms` semantic lookup, zero cold-start delta fetches or embedding calls).

