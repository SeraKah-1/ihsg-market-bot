/**
 * Agent memory bus — Cognitive Sandbox style.
 * Each agent SAVES its pack to Firebase (DB market); next agent LOADS it.
 * Local + server /api fallback so pipeline still works offline.
 */
import {
  ensureAuth,
  currentUser,
  runDoc,
  agentStepDoc,
  db
} from "./firebase.js";
import {
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp,
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  addDoc
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import {
  idbPutRun,
  idbGetRun,
  idbPutStep,
  idbGetStep,
  idbListIncompleteRuns,
  nextStepFromSteps,
  cacheLastBriefing
} from "./offline-store.js";

const LOCAL_RUN_PREFIX = "ihsg-run-";
const LOCAL_MEM_KEY = "ihsg-compact-memory-v1";

/** Strip bulky fields before Firestore / LLM handoff */
export function compactForMemory(payload, maxJsonChars = 180_000) {
  if (payload == null) return null;
  let clone;
  try {
    clone = JSON.parse(JSON.stringify(payload));
  } catch {
    return { _error: "non_serializable" };
  }
  // drop noisy agent internals
  if (clone.agentMeta?.rawContent) delete clone.agentMeta.rawContent;
  if (clone.__raw) delete clone.__raw;
  if (clone.rawDump) delete clone.rawDump;
  // cap findings arrays
  if (Array.isArray(clone.findings) && clone.findings.length > 80) {
    clone.findings = clone.findings.slice(0, 80);
  }
  if (Array.isArray(clone.citations) && clone.citations.length > 40) {
    clone.citations = clone.citations.slice(0, 40);
  }
  let s = JSON.stringify(clone);
  if (s.length > maxJsonChars) {
    // progressive trim
    if (clone.findings) clone.findings = clone.findings.slice(0, 30);
    if (clone.marketNotes) clone.marketNotes = clone.marketNotes.slice(0, 20);
    if (clone.shortlist && Array.isArray(clone.shortlist)) {
      clone.shortlist = clone.shortlist.map((t) => ({
        ticker: t.ticker,
        insight: t.insight,
        plain: t.plain,
        stance: t.stance,
        outlook: t.outlook,
        followMoney: t.followMoney,
        whySelected: t.whySelected,
        fundamentals: t.fundamentals,
        bestMoveFraming: t.bestMoveFraming,
        scenarios: t.scenarios
      }));
    }
    if (clone.indicators) {
      // keep chips only — drop huge raw json trees if present as string
      clone.indicators = {
        market: clone.indicators.market,
        tickers: clone.indicators.tickers
      };
    }
    s = JSON.stringify(clone);
    if (s.length > maxJsonChars) {
      clone._truncated = true;
      clone._origChars = s.length;
      // last resort: keep keys only summary
      return {
        _truncated: true,
        summary: s.slice(0, maxJsonChars - 200),
        keys: Object.keys(clone)
      };
    }
  }
  return clone;
}

/**
 * Research pack slim enough for Analysis LLM (avoids Failed to fetch on huge dumps).
 */
export function compactResearchForDownstream(research) {
  if (!research) return {};
  const perTicker = {};
  for (const [k, v] of Object.entries(research.perTicker || {})) {
    perTicker[k] = {
      catalysts: (v.catalysts || []).slice(0, 8),
      unexplained: !!v.unexplained,
      notes: (v.notes || "").slice(0, 600),
      fundamentalsNote: (v.fundamentalsNote || "").slice(0, 600),
      outlookTag: v.outlookTag || "biasa",
      queriesUsed: (v.queriesUsed || []).slice(0, 6)
    };
  }
  return {
    marketNotes: (research.marketNotes || []).slice(0, 16),
    macroNote: (research.macroNote || "").slice(0, 800),
    macroOutlookTag: research.macroOutlookTag || "biasa",
    searchPlan: (research.searchPlan || []).slice(0, 20),
    hotTakes: (research.hotTakes || []).slice(0, 6),
    perTicker,
    unexplainedMarket: (research.unexplainedMarket || []).slice(0, 12),
    findings: (research.findings || []).slice(0, 40).map((f) => ({
      claim: (f.claim || "").slice(0, 280),
      url: f.url || "",
      sourceTier: f.sourceTier || "unknown",
      query: (f.query || "").slice(0, 120),
      ticker: f.ticker || "",
      bucket: f.bucket || ""
    })),
    agentMeta: {
      role: research.agentMeta?.role,
      mode: research.agentMeta?.mode,
      rounds: research.agentMeta?.rounds,
      reasoningEffort: research.agentMeta?.reasoningEffort,
      citations: (research.agentMeta?.citations || []).slice(0, 20)
    },
    memoryRef: research.memoryRef || null
  };
}

/**
 * Analysis pack slim for Writer.
 */
export function compactAnalysisForDownstream(analysis) {
  if (!analysis) return {};
  const c = compactForMemory(analysis, 120_000);
  if (c?.indicators) {
    // writer must not dump numbers — keep only lean flags
    c.indicators = {
      _note: "indikator full di Firebase agents/analysis + code attach di UI",
      marketRegime: c.indicators?.market?.regime || null
    };
  }
  return c;
}

function localSaveRun(runId, patch) {
  try {
    const key = LOCAL_RUN_PREFIX + runId;
    const prev = JSON.parse(localStorage.getItem(key) || "{}");
    const next = { ...prev, ...patch, updatedAt: Date.now() };
    localStorage.setItem(key, JSON.stringify(next));
    // keep last 8 runs keys index
    const idx = JSON.parse(localStorage.getItem("ihsg-run-index") || "[]");
    if (!idx.includes(runId)) idx.unshift(runId);
    localStorage.setItem("ihsg-run-index", JSON.stringify(idx.slice(0, 12)));
    return true;
  } catch (e) {
    console.warn("localSaveRun", e);
    return false;
  }
}

function localLoadRun(runId) {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_RUN_PREFIX + runId) || "null");
  } catch {
    return null;
  }
}

/**
 * Init memory bus — Google session if present; offline IDB always works.
 * @returns {{ ok: boolean, uid: string|null, needsSignIn?: boolean, error?: string }}
 */
export async function initAgentMemory(onLog) {
  try {
    const user = await ensureAuth();
    if (user?.uid) {
      const label = user.displayName || user.email || user.uid.slice(0, 8);
      onLog?.(
        `Firebase memory OK · db=market · Google=${label} · offline IDB on`
      );
      return { ok: true, uid: user.uid, email: user.email || null };
    }
    onLog?.(
      "Belum login Google → memory offline (IndexedDB + local). Login untuk sync cloud.",
      "warn"
    );
    return { ok: false, uid: null, needsSignIn: true, error: "needs_google" };
  } catch (e) {
    onLog?.("Firebase init error: " + (e.message || e), "warn");
    return { ok: false, uid: null, needsSignIn: true, error: String(e.message || e) };
  }
}

/**
 * Create/update run shell doc.
 */
export async function startRunMemory(runId, meta = {}, onLog) {
  const shell = {
    runId,
    kind: meta.kind || "briefing",
    day: meta.day || null,
    status: "running",
    steps: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...meta
  };
  localSaveRun(runId, shell);
  try {
    await idbPutRun(shell);
  } catch (e) {
    onLog?.("IDB run shell: " + e.message, "warn");
  }

  if (!currentUser?.uid) {
    await ensureAuth();
  }
  if (!currentUser?.uid) {
    onLog?.("Run memory: offline IDB/local (no Google uid)");
    return { backend: "local", runId };
  }

  try {
    await setDoc(
      runDoc(runId),
      {
        runId,
        kind: shell.kind,
        day: shell.day,
        status: "running",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        meta: {
          k: meta.k,
          searchMode: meta.searchMode,
          models: meta.models || {}
        }
      },
      { merge: true }
    );
    onLog?.(`Firebase run doc: users/…/ihsg_runs/${runId}`);
    return { backend: "firebase", runId };
  } catch (e) {
    onLog?.("Firebase run start gagal → offline: " + e.message, "warn");
    return { backend: "local", runId, error: e.message };
  }
}

/**
 * Save one agent step. Next agent should loadAgentStep(runId, step).
 * @param {string} step research | analysis | writer | shortlist | deep_dive
 */
export async function saveAgentStep(runId, step, payload, onLog) {
  const data = compactForMemory(payload);
  const entry = {
    step,
    savedAt: Date.now(),
    payload: data
  };

  localSaveRun(runId, {
    [step]: entry,
    [`${step}At`]: Date.now(),
    steps: { ...(localLoadRun(runId)?.steps || {}), [step]: true },
    status: step === "writer" || step === "deep_dive" ? "done" : "running"
  });

  try {
    await idbPutStep(runId, step, data);
  } catch (e) {
    onLog?.(`IDB save [${step}]: ${e.message}`, "warn");
  }

  // server mirror (always try when online)
  try {
    await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId,
        agentStep: step,
        savedAt: entry.savedAt,
        payload: data
      })
    });
  } catch (e) {
    /* offline ok */
  }

  if (!currentUser?.uid) {
    try {
      await ensureAuth();
    } catch {
      /* */
    }
  }

  if (!currentUser?.uid) {
    onLog?.(`Memory save [${step}] → offline IDB (+ /api if online)`);
    return { backend: "local", step, runId };
  }

  try {
    await setDoc(
      agentStepDoc(runId, step),
      {
        step,
        runId,
        savedAt: serverTimestamp(),
        clientTs: entry.savedAt,
        payload: data
      },
      { merge: true }
    );
    await updateDoc(runDoc(runId), {
      updatedAt: serverTimestamp(),
      [`steps.${step}`]: true,
      status: step === "writer" || step === "deep_dive" ? "done" : "running"
    }).catch(() => {});
    onLog?.(`Firebase save agent=${step} · runs/${runId}/agents/${step}`);
    return { backend: "firebase", step, runId };
  } catch (e) {
    onLog?.(`Firebase save [${step}] gagal → offline: ${e.message}`, "warn");
    return { backend: "local", step, runId, error: e.message };
  }
}

/**
 * Load agent step: Firebase (cached offline) → IDB → localStorage.
 */
export async function loadAgentStep(runId, step, onLog) {
  if (currentUser?.uid) {
    try {
      const snap = await getDoc(agentStepDoc(runId, step));
      if (snap.exists()) {
        const d = snap.data();
        onLog?.(`Firebase load agent=${step} OK`);
        // mirror to IDB for pure offline next time
        try {
          await idbPutStep(runId, step, d.payload);
        } catch {
          /* */
        }
        return d.payload ?? null;
      }
    } catch (e) {
      onLog?.(`Firebase load [${step}] gagal: ${e.message}`, "warn");
    }
  }

  try {
    const idb = await idbGetStep(runId, step);
    if (idb != null) {
      onLog?.(`Offline IDB load agent=${step} OK`);
      return idb;
    }
  } catch (e) {
    onLog?.(`IDB load [${step}]: ${e.message}`, "warn");
  }

  const local = localLoadRun(runId);
  if (local?.[step]?.payload) {
    onLog?.(`LocalStorage load agent=${step} OK`);
    return local[step].payload;
  }
  onLog?.(`Memory miss agent=${step}`, "warn");
  return null;
}

/**
 * Inspect run progress for resume.
 */
export async function getRunProgress(runId, onLog) {
  let steps = {};
  let status = "unknown";
  let meta = {};

  try {
    const idb = await idbGetRun(runId);
    if (idb) {
      steps = { ...(idb.steps || {}) };
      status = idb.status || status;
      meta = idb;
    }
  } catch {
    /* */
  }

  const local = localLoadRun(runId);
  if (local) {
    for (const k of ["shortlist", "research", "analysis", "writer", "deep_dive", "market_pack"]) {
      if (local[k]?.payload || local.steps?.[k]) steps[k] = true;
    }
    status = local.status || status;
    meta = { ...meta, ...local };
  }

  if (currentUser?.uid) {
    try {
      const snap = await getDoc(runDoc(runId));
      if (snap.exists()) {
        const d = snap.data();
        steps = { ...steps, ...(d.steps || {}) };
        status = d.status || status;
      }
    } catch {
      /* */
    }
  }

  // probe steps that exist as docs even if shell incomplete
  for (const step of ["shortlist", "research", "analysis", "writer"]) {
    if (steps[step]) continue;
    const p = await loadAgentStep(runId, step, null);
    if (p) steps[step] = true;
  }

  const next = nextStepFromSteps(steps);
  onLog?.(
    `Resume progress run=${runId} steps=${Object.keys(steps).join(",") || "—"} next=${next}`
  );
  return { runId, steps, status, next, meta };
}

export async function listResumableRuns(onLog) {
  try {
    const list = await idbListIncompleteRuns(10);
    onLog?.(`Resumable runs offline: ${list.length}`);
    return list;
  } catch {
    return [];
  }
}

export async function markRunFailed(runId, errMsg, onLog) {
  localSaveRun(runId, {
    status: "failed",
    lastError: String(errMsg || "").slice(0, 500),
    updatedAt: Date.now()
  });
  try {
    const prev = (await idbGetRun(runId)) || { runId };
    await idbPutRun({
      ...prev,
      runId,
      status: "failed",
      lastError: String(errMsg || "").slice(0, 500),
      updatedAt: Date.now()
    });
  } catch {
    /* */
  }
  if (currentUser?.uid) {
    try {
      await updateDoc(runDoc(runId), {
        status: "failed",
        lastError: String(errMsg || "").slice(0, 500),
        updatedAt: serverTimestamp()
      });
    } catch {
      /* */
    }
  }
  onLog?.(`Run ${runId} marked failed — bisa Resume`, "warn");
}

export { cacheLastBriefing, nextStepFromSteps };

/**
 * Compact day memory (like sandbox topic memory — short rolling context).
 */
export async function appendCompactMemory(item, onLog) {
  const row = {
    ...item,
    ts: Date.now()
  };

  // local
  try {
    const arr = JSON.parse(localStorage.getItem(LOCAL_MEM_KEY) || "[]");
    arr.unshift(row);
    localStorage.setItem(LOCAL_MEM_KEY, JSON.stringify(arr.slice(0, 40)));
  } catch {
    /* */
  }

  // server
  try {
    await fetch("/api/memory/compact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row)
    });
  } catch {
    /* */
  }

  if (!currentUser?.uid) {
    try {
      await ensureAuth();
    } catch {
      /* */
    }
  }
  if (!currentUser?.uid) {
    onLog?.("Compact memory → local + /api");
    return { backend: "local" };
  }

  try {
    const col = collection(db, "users", currentUser.uid, "ihsg_compact");
    await addDoc(col, {
      ...row,
      createdAt: serverTimestamp()
    });
    onLog?.("Firebase compact memory appended");
    return { backend: "firebase" };
  } catch (e) {
    onLog?.("Firebase compact gagal → local: " + e.message, "warn");
    return { backend: "local", error: e.message };
  }
}

export async function loadCompactMemory(n = 10, onLog) {
  const out = [];

  if (!currentUser?.uid) {
    try {
      await ensureAuth();
    } catch {
      /* */
    }
  }

  if (currentUser?.uid) {
    try {
      const col = collection(db, "users", currentUser.uid, "ihsg_compact");
      const q = query(col, orderBy("createdAt", "desc"), limit(n));
      const snap = await getDocs(q);
      snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
      if (out.length) {
        onLog?.(`Firebase compact memory n=${out.length}`);
        return out;
      }
    } catch (e) {
      onLog?.("Firebase compact read: " + e.message, "warn");
    }
  }

  try {
    const res = await fetch(`/api/memory/compact?n=${n}`);
    if (res.ok) {
      const j = await res.json();
      if (j.items?.length) return j.items;
    }
  } catch {
    /* */
  }

  try {
    const arr = JSON.parse(localStorage.getItem(LOCAL_MEM_KEY) || "[]");
    return arr.slice(0, n);
  } catch {
    return [];
  }
}

/**
 * Build MEMORY block for agent prompts (sandbox style).
 */
export function buildAgentMemoryContext(priorSteps = {}, compactItems = []) {
  const parts = [];
  if (compactItems?.length) {
    parts.push(
      "[MEMORY COMPACT — run sebelumnya. Jangan ulang omong kosong; bangun di atasnya.]"
    );
    for (const m of compactItems.slice(0, 8)) {
      parts.push(
        `- ${m.date || m.day || "?"} lean=${m.lean || m.judgeLean || "?"} regime=${m.regimeTag || "?"} · ${(m.themes || []).slice(0, 4).join(", ")} · ${(m.top_tickers_1line || []).slice(0, 4).join(" | ")}`
      );
    }
    parts.push("[END COMPACT]");
  }
  if (priorSteps.research) {
    parts.push(
      "[AGENT MEMORY · research]\n" +
        JSON.stringify(compactResearchForDownstream(priorSteps.research), null, 0).slice(
          0,
          12000
        ) +
        "\n[END research]"
    );
  }
  if (priorSteps.analysis) {
    parts.push(
      "[AGENT MEMORY · analysis]\n" +
        JSON.stringify(compactAnalysisForDownstream(priorSteps.analysis), null, 0).slice(
          0,
          14000
        ) +
        "\n[END analysis]"
    );
  }
  if (!parts.length) {
    return "[MEMORY: belum ada run memory untuk sesi ini.]";
  }
  return parts.join("\n\n");
}

export async function finishRunMemory(runId, status = "done", onLog) {
  localSaveRun(runId, { status, finishedAt: Date.now(), updatedAt: Date.now() });
  try {
    const prev = (await idbGetRun(runId)) || { runId };
    await idbPutRun({
      ...prev,
      runId,
      status,
      finishedAt: Date.now(),
      updatedAt: Date.now()
    });
  } catch {
    /* */
  }
  if (!currentUser?.uid) {
    onLog?.(`Offline run ${runId} → ${status}`);
    return;
  }
  try {
    await updateDoc(runDoc(runId), {
      status,
      updatedAt: serverTimestamp(),
      finishedAt: serverTimestamp()
    });
    onLog?.(`Firebase run ${runId} → ${status}`);
  } catch (e) {
    onLog?.("finishRun: " + e.message, "warn");
  }
}

/** Hapus jejak run lokal (localStorage prefix) saat abort/reset sesi */
export function clearLocalRunMemory() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LOCAL_RUN_PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    /* */
  }
}
