# Cloud Run AI Seed Hydration & Git Sync Guide

This guide explains how the expanded AI station seed catalog ([`data/station-seed-index.json`](/data/station-seed-index.json)) behaves after deploying to Cloud Run, how to download the server-hydrated embeddings (`vec`), and how to commit them back to your Git remote.

---

## 1. What Happens After Cloud Run Deployment?

| Asset | State in Repo | Runtime Behavior on Cloud Run |
| :--- | :--- | :--- |
| **Expanded Station Catalog** (`4,434` stations across `162` countries) | Pre-generated and bundled in [`data/station-seed-index.json`](/data/station-seed-index.json) (`~2.84 MB` unhydrated) | Loaded from disk at startup. Cloud Run does **not** re-run `scripts/build-ai-seed.ts` or rebuild the station list at runtime. |
| **Pre-computed Vectors (`vec`)** (`768`-dim `Int8` base64) | `24` stations carry pre-computed `vec`; `4,410` stations start with `vec: null` when built without `GEMINI_API_KEY` | On the **first AI Tune search**, `warmSeedIndexInBackground()` in [`src/server/aiSearch.ts`](/src/server/aiSearch.ts) uses the server's `GEMINI_API_KEY` to batch-embed all missing stations into **RAM**. |

> **Important Cloud Run Caveat:** Runtime-computed `vec` embeddings live **only in that container's memory**. Cloud Run does not write them back to `data/station-seed-index.json` on disk, so cold starts or new container instances must re-hydrate the missing `4,410` vectors until the hydrated JSON is committed to Git.

---

## 2. Download the Hydrated Seed from Cloud Run

The backend exposes an AI-authenticated export endpoint (`GET /api/ai/seed-export?hydrate=1`). Passing `hydrate=1` makes the server finish computing any missing `vec` embeddings in RAM before streaming back the complete `station-seed-index.json`.

### Option A: Download via Browser (Simplest)

1. Open your deployed Cloud Run app and unlock **AI Tune** using your `AI_PASSCODE` (or custom `APP_PASSCODE`).
   - *Note: The general passcode (`radio-2026`) only unlocks map/general features and returns `403 AI_AUTH_REQUIRED` on `/api/ai/*`.*
2. In the same browser tab/origin, open:
   ```text
   https://<your-cloud-run-host>/api/ai/seed-export?hydrate=1
   ```
3. Wait a few seconds for server-side embedding hydration to complete; the browser will download `station-seed-index.json` (`~7.3–7.5 MB`).
4. Move the downloaded file into your local Git repo, overwriting `data/station-seed-index.json`.

### Option B: Download via Terminal (`curl`)

1. Exchange your AI passcode for an AI-authorized JWT via `POST /api/auth/verify`:
   ```bash
   TOKEN=$(curl -sS -X POST "https://<your-cloud-run-host>/api/auth/verify" \
     -H "Content-Type: application/json" \
     -d '{"passcode":"<YOUR_AI_PASSCODE>","scope":"ai"}' \
     | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if(!d.token) { console.error(d); process.exit(1); } process.stdout.write(d.token);')
   ```
2. Stream the hydrated seed file directly into `data/station-seed-index.json`:
   ```bash
   curl -fL "https://<your-cloud-run-host>/api/ai/seed-export?hydrate=1" \
     -H "Authorization: Bearer $TOKEN" \
     -o data/station-seed-index.json
   ```

---

## 3. Commit & Push Back to Git Remote

`data/` is tracked by Git (not excluded in [`.gitignore`](/.gitignore)), and the hydrated `4,434`-station file (`~7.3–7.5 MB`) is well below GitHub's 50 MB warning and 100 MB file-size limits—no Git LFS is required:

```bash
git add data/station-seed-index.json
git commit -m "chore: hydrate pre-computed vectors for 4,434-station AI seed"
git push
```

Once redeployed from that commit, every Cloud Run instance starts with all `4,434` vectors pre-loaded in RAM (`<3ms` semantic lookup, zero cold-start embedding calls).

---

## 4. Optional: Refresh All `4,434` Vectors with Geo Descriptors

Because `hydrateMissingSeedVectors()` only computes embeddings for stations where `vec === null`, any stations carried over from an earlier seed (`24` stations) retain their older vectors rather than being re-embedded with the enriched `(SubRegion, Continent)` location descriptors from `buildStationDescriptor()`.

To re-compute **all** `4,434` vectors from scratch:

- **GitHub Actions:** Trigger **Actions → Update AI Seed Embeddings** ([`.github/workflows/update-ai-seed.yml`](/.github/workflows/update-ai-seed.yml)) with `GEMINI_API_KEY` configured in **Settings → Secrets and variables → Actions** (it commits and pushes directly to your branch).
- **Local CLI:**
  ```bash
  GEMINI_API_KEY="<your-gemini-api-key>" npm run ai:seed -- --reembed
  git add data/station-seed-index.json
  git commit -m "chore: re-embed 4,434-station AI seed with geo descriptors"
  git push
  ```
