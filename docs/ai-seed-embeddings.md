# AI Seed Index & Pre-Computed Embeddings (`vec`) Guide

This guide explains how the bundled AI station catalog (`data/station-seed-index.json`), the configurable `SEED_SWEET_SPOT_COUNT` target (default **6,000**), and its quantized `Int8` embedding vectors (`vec`) work in World Radio.

---

## 1. Configuration & Automatic Drift Sync

`SEED_SWEET_SPOT_COUNT` defaults to `6000` in [`src/server/seedIndex.ts`](/src/server/seedIndex.ts) and can be overridden via the `SEED_SWEET_SPOT_COUNT` environment variable (valid range `100`–`25000`, e.g., in `.env`, Cloud Run, or GitHub Actions variables).

Both the build CLI (`npm run ai:seed`) and server startup RAM sync (`startSeedSyncBackground()` / `ensureSeedIndexSynced()`) automatically inspect `data/station-seed-index.json` against the active configuration (`targetCount`, `model`, `dim`, `descriptorVersion`):

- **Grow (`current < target`)**: Preserves all existing stations and `vec` vectors, samples only the incremental delta from Radio Browser (scaling regional quotas and cultural tags proportionally), and batch-embeds only the new entries.
- **Shrink (`current > target`)**: Trims excess tail entries down to `SEED_SWEET_SPOT_COUNT` with zero re-embedding.
- **Embedding Spec Change (`model`, `dim`, or `descriptorVersion`)**: Invalidates stale vectors and re-computes embeddings via `gemini-embedding-2`.

| Component | Details (at default 6,000 stations) | Approx. Size |
| :--- | :--- | :--- |
| **Station catalog** | Up to 6,000 playable Radio Browser stations (proportionally balanced across regions & tags) | ~`3.8 MB` |
| **Pre-computed vectors (`vec`)** | 768-dimensional `gemini-embedding-2` vectors quantized to `Int8` base64 (1,024 chars/station) | ~`6.1 MB` |
| **Complete hydrated file** | Stations + `vec` combined in `data/station-seed-index.json` | ~`9.9 MB` |

- `data/` is **not** excluded in [`.gitignore`](/.gitignore), and ~`10 MB` is well below GitHub's 50 MB warning and 100 MB hard file-size limit, so **standard Git commit/push works directly (no Git LFS needed)**.

---

## 2. Seed File Schema (`SeedIndexFile`)

Defined in [`src/server/seedIndex.ts`](/src/server/seedIndex.ts):

```json
{
  "version": 1,
  "model": "gemini-embedding-2",
  "dim": 768,
  "generatedAt": "2026-11-14T00:00:00.000Z",
  "targetCount": 6000,
  "descriptorVersion": 2,
  "configHash": "a1b2c3d4e5f6",
  "items": [
    {
      "station": { "stationuuid": "...", "name": "...", "tags": "...", "country": "..." },
      "vec": "<1024-char base64 Int8 quantized unit vector>"
    }
  ]
}
```

- **With `vec` populated & count matching:** Startup loads all vectors into RAM immediately (`<5ms` semantic lookup, zero startup embedding calls).
- **On config change or unhydrated vectors:** Server startup kicks off a non-blocking background sync (`ensureSeedIndexSynced()`) to adjust the catalog in RAM and hydrate missing vectors once `GEMINI_API_KEY` is active.

---

## 3. Three Ways to Sync & Commit `station-seed-index.json`

### Option A: GitHub Actions (Recommended)

The workflow at [`.github/workflows/update-ai-seed.yml`](/.github/workflows/update-ai-seed.yml) runs on manual dispatch or automatically when seed configuration files are pushed to `main` (if `GEMINI_API_KEY` is configured):

1. Push your repository to GitHub from AI Studio.
2. In your GitHub repository, open **Settings → Secrets and variables → Actions** and add a repository secret named `GEMINI_API_KEY` (and optionally a repository variable `SEED_SWEET_SPOT_COUNT`).
3. Open **Actions → Update AI Seed Embeddings** and click **Run workflow**:
   - Leave `refresh_stations` unchecked (`false`) for automatic incremental delta sync + embedding of missing stations.
   - Optionally enter a `seed_count` override or check `refresh_stations` (`true`) / `reembed_all` (`true`).
4. The workflow commits and pushes the updated `data/station-seed-index.json` back to your branch.

---

### Option B: Download Hydrated JSON from Your Deployed App

The backend exposes a passcode/JWT-protected export endpoint (`GET /api/ai/seed-export`) in [`src/server/aiSearch.ts`](/src/server/aiSearch.ts):

1. Unlock the deployed app in your browser (or obtain a JWT via `POST /api/auth/verify` or `npm run auth:token` — see [`docs/jwt-authentication.md`](/docs/jwt-authentication.md)).
2. Request the hydrated seed file (waits for config delta sync + `GEMINI_API_KEY` vector hydration in RAM, then returns a downloadable JSON file):
   ```bash
   curl -fL "https://<your-cloud-run-host>/api/ai/seed-export?hydrate=1" \
     -H "Authorization: Bearer <YOUR_JWT_TOKEN>" \
     -o data/station-seed-index.json
   ```
3. Commit and push the downloaded file:
   ```bash
   git add data/station-seed-index.json
   git commit -m "chore: sync AI station seed index and vectors"
   git push
   ```

---

### Option C: Local CLI Script (`npm run ai:seed`)

Run [`scripts/build-ai-seed.ts`](/scripts/build-ai-seed.ts) locally with your `GEMINI_API_KEY`:

```bash
# Auto-detect SEED_SWEET_SPOT_COUNT drift (default 6000) and incrementally sync + embed
GEMINI_API_KEY="your-gemini-api-key" npm run ai:seed

# Or override target count via env var or CLI flag
SEED_SWEET_SPOT_COUNT=7500 GEMINI_API_KEY="your-gemini-api-key" npm run ai:seed
GEMINI_API_KEY="your-gemini-api-key" npm run ai:seed -- --count=6000

# Optional: force full catalog refresh or full re-embed
GEMINI_API_KEY="your-gemini-api-key" npm run ai:seed -- --refresh
GEMINI_API_KEY="your-gemini-api-key" npm run ai:seed -- --reembed
```

---

## 4. File Map & Code References

| Purpose | File Path |
| :--- | :--- |
| **Seed Catalog & `vec` Store** | [`data/station-seed-index.json`](/data/station-seed-index.json) |
| **Config Resolution, Drift Check & RAM Index** | [`src/server/seedIndex.ts`](/src/server/seedIndex.ts) |
| **Proportional Sampling & Delta Gathering** | [`src/server/seedSync.ts`](/src/server/seedSync.ts) |
| **Hybrid Search, Startup Sync & `/api/ai/seed-export`** | [`src/server/aiSearch.ts`](/src/server/aiSearch.ts) |
| **Incremental Seeder CLI (`npm run ai:seed`)** | [`scripts/build-ai-seed.ts`](/scripts/build-ai-seed.ts) |
| **GitHub Actions Embedding Workflow** | [`.github/workflows/update-ai-seed.yml`](/.github/workflows/update-ai-seed.yml) |
| **Server Unit Tests** | [`src/server/aiSearch.test.ts`](/src/server/aiSearch.test.ts) |

