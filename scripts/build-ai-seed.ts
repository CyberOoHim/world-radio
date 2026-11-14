import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import {
  SEED_EMBEDDING_DIM,
  SEED_EMBEDDING_MODEL,
  SeedIndexStore,
  buildStationDescriptor,
  normalizeVector,
  resolveSeedSweetSpotCount,
} from '../src/server/seedIndex.ts';
import { gatherDiverseStations } from '../src/server/seedSync.ts';
import type { Station } from '../src/types.ts';

function loadEnvLocal(): void {
  for (const envFile of ['.env.local', '.env']) {
    const envPath = path.resolve(process.cwd(), envFile);
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        if (!(k in process.env)) process.env[k] = v;
      }
    }
  }
}

function parseCountArg(argv: string[]): number | undefined {
  const flag = argv.find((arg) => arg.startsWith('--count='));
  if (!flag) return undefined;
  const parsed = Number.parseInt(flag.slice('--count='.length), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function embedMissingStations(ai: GoogleGenAI, store: SeedIndexStore): Promise<void> {
  const missing = store.getMissingVectorStations();
  if (missing.length === 0) return;

  const BATCH = 50;
  const CONCURRENCY = 4;
  const batches: Station[][] = [];
  for (let i = 0; i < missing.length; i += BATCH) {
    batches.push(missing.slice(i, i + BATCH));
  }

  let completed = 0;
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const wave = batches.slice(i, i + CONCURRENCY);
    await Promise.all(
      wave.map(async (slice) => {
        const texts = slice.map((st) => buildStationDescriptor(st));
        const res = await ai.models.embedContent({
          model: SEED_EMBEDDING_MODEL,
          contents: texts,
          config: { outputDimensionality: SEED_EMBEDDING_DIM },
        });
        const embeddings = res.embeddings ?? [];
        slice.forEach((st, idx) => {
          const vals = embeddings[idx]?.values;
          if (vals && vals.length === SEED_EMBEDDING_DIM) {
            store.setVector(st.stationuuid, normalizeVector(vals));
          }
        });
        completed += slice.length;
      })
    );
    console.log(`Embedded ${Math.min(completed, missing.length)} / ${missing.length}`);
  }
}

async function main(): Promise<void> {
  loadEnvLocal();
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  const outDir = path.resolve(process.cwd(), 'data');
  const outPath = path.join(outDir, 'station-seed-index.json');
  const forceRefresh = process.argv.includes('--refresh');
  const forceReembed = process.argv.includes('--reembed');
  const targetCount = resolveSeedSweetSpotCount(parseCountArg(process.argv));

  const store = new SeedIndexStore();
  store.load(outPath);
  const status = store.inspectSyncStatus(targetCount);

  if (status.currentCount > 0) {
    console.log(
      `Loaded ${status.currentCount} existing stations (${status.vectorCount} vectors) from ${outPath}`
    );
  }

  if (!forceRefresh && !forceReembed && !status.needsAnySync && !status.configChanged) {
    console.log(
      `Seed index already matches SEED_SWEET_SPOT_COUNT=${targetCount} and current embedding spec (${status.vectorCount}/${status.currentCount} vectors). Nothing to update.`
    );
    return;
  }

  let mutated = forceRefresh || forceReembed || status.configChanged;

  if (forceReembed || status.needsReembed) {
    const cleared = store.invalidateVectors();
    console.log(
      forceReembed
        ? `Cleared ${cleared} existing vectors (--reembed requested).`
        : `Embedding config changed (model/dim/descriptor); invalidated ${cleared} stale vectors.`
    );
    mutated = true;
  }

  if (forceRefresh) {
    console.log(`Refreshing up to ${targetCount} geographically balanced stations from Radio Browser...`);
    const freshStations = await gatherDiverseStations(targetCount, {
      onLog: (msg) => console.log(msg),
    });
    if (freshStations.length === 0 && status.currentCount > 0) {
      console.warn('Radio Browser returned 0 stations; keeping existing seed catalog.');
    } else {
      const res = store.applyTargetStations(freshStations, {
        targetCount,
        preserveExistingVectors: !forceReembed && !status.needsReembed,
      });
      console.log(
        `Refreshed catalog to ${res.totalStations} stations (preserved ${res.preservedVectors} existing vectors).`
      );
      mutated = true;
    }
  } else if (status.needsGrow) {
    console.log(
      `SEED_SWEET_SPOT_COUNT drift detected (${status.currentCount} -> ${targetCount}); fetching incremental delta...`
    );
    const existingStations = store.getAllEntries().map((e) => e.station);
    const expanded = await gatherDiverseStations(targetCount, {
      existingStations,
      onLog: (msg) => console.log(msg),
    });
    if (expanded.length > existingStations.length) {
      const res = store.applyTargetStations(expanded, {
        targetCount,
        preserveExistingVectors: true,
      });
      console.log(
        `Expanded catalog to ${res.totalStations} stations (+${res.totalStations - existingStations.length} new, ${res.preservedVectors} vectors preserved).`
      );
      mutated = true;
    } else {
      console.warn('Could not fetch additional stations from Radio Browser; retaining existing pool.');
    }
  } else if (status.needsTrim) {
    const removed = store.trimToTargetCount(targetCount);
    console.log(
      `SEED_SWEET_SPOT_COUNT drift detected (${status.currentCount} -> ${targetCount}); trimmed ${removed} tail stations.`
    );
    mutated = true;
  } else if (status.configChanged) {
    store.markConfigSynced(targetCount);
    mutated = true;
  }

  const missingAfterCatalogSync = store.getMissingVectorStations();
  if (missingAfterCatalogSync.length === 0) {
    console.log(`All ${store.getStats().totalStations} stations already have pre-computed vectors.`);
  } else if (apiKey) {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    await embedMissingStations(ai, store);
    mutated = true;
  } else {
    console.warn(
      `GEMINI_API_KEY not set — ${missingAfterCatalogSync.length} stations remain unembedded and will warm on server.`
    );
  }

  if (!mutated) {
    console.log('No changes to write.');
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });
  const payload = store.exportSeedFile(targetCount);
  fs.writeFileSync(outPath, JSON.stringify(payload));
  const sizeMb = (fs.statSync(outPath).size / (1024 * 1024)).toFixed(2);
  const vecCount = payload.items.filter((i) => typeof i.vec === 'string' && i.vec.length > 0).length;
  console.log(
    `Saved seed index (${payload.items.length} stations, ${vecCount} vectors, target=${targetCount}, ${sizeMb} MB) to ${outPath}`
  );
}

void main();

