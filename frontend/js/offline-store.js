/**
 * IndexedDB offline store — runs, agent steps, last briefing, resume queue.
 * Survives offline PWA; complements Firebase + localStorage.
 */
const DB_NAME = "ihsg-market-offline-v1";
const DB_VER = 1;
const STORE_RUNS = "runs";
const STORE_STEPS = "steps";
const STORE_META = "meta";

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_RUNS)) {
        const s = db.createObjectStore(STORE_RUNS, { keyPath: "runId" });
        s.createIndex("status", "status", { unique: false });
        s.createIndex("updatedAt", "updatedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_STEPS)) {
        const s = db.createObjectStore(STORE_STEPS, { keyPath: "id" });
        s.createIndex("runId", "runId", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("idb open failed"));
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("aborted"));
  });
}

export async function idbPutRun(run) {
  const db = await openDb();
  const tx = db.transaction(STORE_RUNS, "readwrite");
  tx.objectStore(STORE_RUNS).put({
    ...run,
    runId: run.runId,
    updatedAt: Date.now()
  });
  await txDone(tx);
  db.close();
}

export async function idbGetRun(runId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_RUNS, "readonly");
    const req = tx.objectStore(STORE_RUNS).get(runId);
    req.onsuccess = () => {
      db.close();
      resolve(req.result || null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export async function idbPutStep(runId, step, payload) {
  const db = await openDb();
  const tx = db.transaction([STORE_STEPS, STORE_RUNS], "readwrite");
  tx.objectStore(STORE_STEPS).put({
    id: `${runId}::${step}`,
    runId,
    step,
    payload,
    savedAt: Date.now()
  });
  const runStore = tx.objectStore(STORE_RUNS);
  await new Promise((resolve) => {
    const getReq = runStore.get(runId);
    getReq.onsuccess = () => {
      const prev = getReq.result || { runId, steps: {} };
      prev.steps = { ...(prev.steps || {}), [step]: true };
      prev.updatedAt = Date.now();
      prev.status = prev.status || "running";
      if (step === "writer" || step === "deep_dive") prev.status = "done";
      runStore.put(prev);
      resolve();
    };
    getReq.onerror = () => resolve();
  });
  await txDone(tx);
  db.close();
}

export async function idbGetStep(runId, step) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STEPS, "readonly");
    const req = tx.objectStore(STORE_STEPS).get(`${runId}::${step}`);
    req.onsuccess = () => {
      db.close();
      resolve(req.result?.payload ?? null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export async function idbListIncompleteRuns(limitN = 8) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_RUNS, "readonly");
    const req = tx.objectStore(STORE_RUNS).getAll();
    req.onsuccess = () => {
      db.close();
      const all = (req.result || [])
        .filter((r) => r.status === "running" || r.status === "failed" || r.status === "interrupted")
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, limitN);
      resolve(all);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export async function idbListRecentDone(limitN = 5) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_RUNS, "readonly");
    const req = tx.objectStore(STORE_RUNS).getAll();
    req.onsuccess = () => {
      db.close();
      const all = (req.result || [])
        .filter((r) => r.status === "done" || r.status === "data_only")
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, limitN);
      resolve(all);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export async function idbSetMeta(key, value) {
  const db = await openDb();
  const tx = db.transaction(STORE_META, "readwrite");
  tx.objectStore(STORE_META).put({ key, value, updatedAt: Date.now() });
  await txDone(tx);
  db.close();
}

export async function idbGetMeta(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, "readonly");
    const req = tx.objectStore(STORE_META).get(key);
    req.onsuccess = () => {
      db.close();
      resolve(req.result?.value ?? null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

/** Save last rendered briefing for offline open */
export async function cacheLastBriefing(briefing, html) {
  try {
    await idbSetMeta("lastBriefing", {
      briefing,
      html: html ? String(html).slice(0, 2_000_000) : null,
      at: Date.now()
    });
    // also localStorage tiny pointer
    localStorage.setItem(
      "ihsg-last-briefing-meta",
      JSON.stringify({
        runId: briefing?.runId,
        asOf: briefing?.asOfSession,
        lean: briefing?.sentiment?.judgeLean,
        headline: briefing?.presentation?.headline || briefing?.marketWide?.plainHeadline,
        at: Date.now()
      })
    );
  } catch (e) {
    console.warn("cacheLastBriefing", e);
  }
}

export async function loadLastBriefingCached() {
  try {
    return (await idbGetMeta("lastBriefing")) || null;
  } catch {
    return null;
  }
}

/**
 * Which pipeline step to resume next.
 * @returns {'research'|'analysis'|'writer'|'done'|null}
 */
export function nextStepFromSteps(steps = {}) {
  if (!steps.shortlist && !steps.research) return "research"; // may still need shortlist
  if (!steps.research) return "research";
  if (!steps.analysis) return "analysis";
  if (!steps.writer) return "writer";
  return "done";
}

export function isOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}
