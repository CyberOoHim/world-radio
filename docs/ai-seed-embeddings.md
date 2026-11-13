# AI Seed Index & Pre-Computed Embeddings (`vec`) Guide

This guide explains how the bundled AI station catalog (`data/station-seed-index.json`) and its quantized `Int8` embedding vectors (`vec`) work in World Radio, and how to populate and push both to a remote Git repository.

---

## 1. Overview & Git Storage

The hybrid AI station search loads a bundled catalog at server startup from [`data/station-seed-index.json`](/data/station-seed-index.json):

| Component | Details | Size |
| :--- | :--- | :--- |
| **Station catalog** | 2,399 playable Radio Browser stations (top global + mood/genre tags) | ~`1.51 MB` |
| **Pre-computed vectors (`vec`)** | 768-dimensional `gemini-embedding-2` vectors quantized to `Int8` base64 (1,024 chars/station) | ~`2.46 MB` |
| **Complete hydrated file** | Stations + `vec` combined in `data/station-seed-index.json` | ~`4.0 MB` |

- `data/` is **not** excluded in [`.gitignore`](/.gitignore), and ~`4.0 MB` is well below GitHub's 50 MB warning and 100 MB hard file-size limit, so **standard Git commit/push works directly (no Git LFS needed)**.
- Note: The AI Studio sandbox does not contain a local `.git` repository or your `GEMINI_API_KEY` secret; files are synced to GitHub externally, while `GEMINI_API_KEY` runs in Cloud Run or GitHub Actions.

---

## 2. Seed File Schema (`SeedIndexFile`)

Defined in [`src/server/seedIndex.ts`](/src/server/seedIndex.ts):

```json
{
  "version": 1,
  "model": "gemini-embedding-2",
  "dim": 768,
  "generatedAt": "2026-11-12T00:00:00.000Z",
  "items": [
    {
      "station": { "stationuuid": "...", "name": "...", "tags": "...", "country": "..." },
      "vec": "<1024-char base64 Int8 quantized unit vector>"
    }
  ]
}
```

- **With `vec` populated:** Startup loads all 2,399 vectors into RAM immediately (`<3ms` semantic lookup, zero startup embedding calls).
- **Without `vec`:** Startup loads metadata for lexical/tag fallback, and `warmSeedIndexInBackground()` in [`src/server/aiSearch.ts`](/src/server/aiSearch.ts) automatically hydrates missing vectors in RAM once `GEMINI_API_KEY` is active on Cloud Run.

---

## 3. Three Ways to Populate `vec` and Push to Git Remote

### Option A: GitHub Actions (Recommended)

A manual workflow is included at [`.github/workflows/update-ai-seed.yml`](/.github/workflows/update-ai-seed.yml):

1. Push your repository to GitHub from AI Studio.
2. In your GitHub repository, open **Settings → Secrets and variables → Actions** and add a repository secret named `GEMINI_API_KEY`.
3. Open **Actions → Update AI Seed Embeddings** and click **Run workflow**:
   - Leave `refresh_stations` unchecked (`false`) to reuse the existing 2,399 stations and only compute missing `vec` embeddings.
   - Check `refresh_stations` (`true`) to re-fetch up to 2,500 stations from Radio Browser first (`npm run ai:seed -- --refresh`).
4. The workflow computes `vec` and commits/pushes the updated `data/station-seed-index.json` back to your branch.

---

### Option B: Download Hydrated JSON from Your Deployed App

The backend exposes a passcode/JWT-protected export endpoint (`GET /api/ai/seed-export`) in [`src/server/aiSearch.ts`](/src/server/aiSearch.ts):

1. Unlock the deployed app in your browser (or obtain a JWT via `POST /api/auth/verify` or `npm run auth:token` — see [`docs/jwt-authentication.md`](/docs/jwt-authentication.md)).
2. Request the hydrated seed file (waits for the server's `GEMINI_API_KEY` to fill all missing `vec` vectors in RAM, then returns a downloadable JSON file):
   ```bash
   curl -fL "https://<your-cloud-run-host>/api/ai/seed-export?hydrate=1" \
     -H "Authorization: Bearer <YOUR_JWT_TOKEN>" \
     -o data/station-seed-index.json
   ```
   *(If you are already unlocked in the browser on that origin, you can also open `/api/ai/seed-export?hydrate=1` directly to download `station-seed-index.json`.)*
3. Commit and push the downloaded file:
   ```bash
   git add data/station-seed-index.json
   git commit -m "chore: add pre-computed AI station vectors"
   git push
   ```

---

### Option C: Local CLI Script (`npm run ai:seed`)

Run [`scripts/build-ai-seed.ts`](/scripts/build-ai-seed.ts) locally with your `GEMINI_API_KEY` (either exported in your shell or placed in a local `.env` file, which is gitignored via `*.local` or kept untracked):

```bash
# Fill missing `vec` vectors while keeping the existing 2,399 stations
GEMINI_API_KEY="your-gemini-api-key" npm run ai:seed

# Optional: re-fetch fresh stations from Radio Browser + compute all `vec` vectors
GEMINI_API_KEY="your-gemini-api-key" npm run ai:seed -- --refresh
```

Then commit and push:

```bash
git add data/station-seed-index.json
git commit -m "chore: update pre-computed AI station embeddings"
git push
```

---

## 4. File Map & Code References

| Purpose | File Path |
| :--- | :--- |
| **Seed Catalog & `vec` Store** | [`data/station-seed-index.json`](/data/station-seed-index.json) |
| **Quantization, RAM Index & `exportSeedFile()`** | [`src/server/seedIndex.ts`](/src/server/seedIndex.ts) |
| **Hybrid Search, Warming & `/api/ai/seed-export`** | [`src/server/aiSearch.ts`](/src/server/aiSearch.ts) |
| **Incremental Seeder CLI (`npm run ai:seed`)** | [`scripts/build-ai-seed.ts`](/scripts/build-ai-seed.ts) |
| **GitHub Actions Embedding Workflow** | [`.github/workflows/update-ai-seed.yml`](/.github/workflows/update-ai-seed.yml) |
| **Server Unit Tests** | [`src/server/aiSearch.test.ts`](/src/server/aiSearch.test.ts) |
