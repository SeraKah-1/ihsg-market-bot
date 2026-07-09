/**
 * Storage library — folders + generated docs (briefing / deep_dive).
 * Device-first IndexedDB (like Cognitive Sandbox localStore) + optional Firebase sync.
 */
import { currentUser, ensureAuth, db as firestoreDb } from "./firebase.js";
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  updateDoc,
  serverTimestamp,
  query,
  orderBy,
  where
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const DB_NAME = "ihsg-storage-v1";
const DB_VER = 1;
const STORE_FOLDERS = "folders";
const STORE_DOCS = "docs";

const SYSTEM = {
  BRIEFINGS: { id: "sys_briefings", name: "Briefings", systemKey: "briefings" },
  DEEP_DIVES: { id: "sys_deep_dives", name: "Deep Dives", systemKey: "deep_dives" }
};

let _db = null;

function openDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_FOLDERS)) {
        const s = db.createObjectStore(STORE_FOLDERS, { keyPath: "id" });
        s.createIndex("name", "name", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_DOCS)) {
        const s = db.createObjectStore(STORE_DOCS, { keyPath: "id" });
        s.createIndex("folderId", "folderId", { unique: false });
        s.createIndex("kind", "kind", { unique: false });
        s.createIndex("ticker", "ticker", { unique: false });
        s.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    req.onsuccess = () => {
      _db = req.result;
      resolve(_db);
    };
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

function uid() {
  return (
    "id_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 9)
  );
}

function compactPayload(payload, max = 400_000) {
  try {
    const s = JSON.stringify(payload);
    if (s.length <= max) return payload;
    return JSON.parse(s.slice(0, max)); // may fail — fallback strip
  } catch {
    return { truncated: true, note: "payload too large" };
  }
}

// ═══ Folders ═══

export async function ensureSystemFolders() {
  const db = await openDb();
  const tx = db.transaction(STORE_FOLDERS, "readwrite");
  const store = tx.objectStore(STORE_FOLDERS);
  for (const f of Object.values(SYSTEM)) {
    const existing = await new Promise((res) => {
      const r = store.get(f.id);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!existing) {
      store.put({
        id: f.id,
        name: f.name,
        systemKey: f.systemKey,
        kind: "system",
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    }
  }
  await txDone(tx);
  await cloudSyncFolders().catch(() => {});
  return listFolders();
}

export async function listFolders() {
  await ensureSystemFolders();
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FOLDERS, "readonly");
    const req = tx.objectStore(STORE_FOLDERS).getAll();
    req.onsuccess = () => {
      const list = (req.result || []).sort((a, b) => {
        if (a.kind === "system" && b.kind !== "system") return -1;
        if (b.kind === "system" && a.kind !== "system") return 1;
        return String(a.name).localeCompare(String(b.name));
      });
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function createFolder(name) {
  const n = String(name || "").trim();
  if (!n) throw new Error("Nama folder kosong");
  const folder = {
    id: uid(),
    name: n,
    kind: "user",
    systemKey: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  const db = await openDb();
  const tx = db.transaction(STORE_FOLDERS, "readwrite");
  tx.objectStore(STORE_FOLDERS).put(folder);
  await txDone(tx);
  await cloudPutFolder(folder).catch(() => {});
  return folder;
}

export async function renameFolder(id, name) {
  const n = String(name || "").trim();
  if (!n) throw new Error("Nama kosong");
  const db = await openDb();
  const folder = await idbGet(STORE_FOLDERS, id);
  if (!folder) throw new Error("Folder tidak ada");
  if (folder.kind === "system") throw new Error("Folder sistem tidak bisa diganti nama");
  folder.name = n;
  folder.updatedAt = Date.now();
  const tx = db.transaction(STORE_FOLDERS, "readwrite");
  tx.objectStore(STORE_FOLDERS).put(folder);
  await txDone(tx);
  await cloudPutFolder(folder).catch(() => {});
  return folder;
}

export async function deleteFolder(id) {
  const folder = await idbGet(STORE_FOLDERS, id);
  if (!folder) return;
  if (folder.kind === "system") throw new Error("Folder sistem tidak bisa dihapus");
  // move docs to unsorted (null) or Briefings
  const docs = await listDocs({ folderId: id });
  for (const d of docs) {
    d.folderId = SYSTEM.BRIEFINGS.id;
    d.updatedAt = Date.now();
    await putDocLocal(d);
    await cloudPutDoc(d).catch(() => {});
  }
  const db = await openDb();
  const tx = db.transaction(STORE_FOLDERS, "readwrite");
  tx.objectStore(STORE_FOLDERS).delete(id);
  await txDone(tx);
  await cloudDeleteFolder(id).catch(() => {});
}

// ═══ Documents ═══

async function idbGet(storeName, id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function putDocLocal(docRec) {
  const db = await openDb();
  const tx = db.transaction(STORE_DOCS, "readwrite");
  tx.objectStore(STORE_DOCS).put(docRec);
  await txDone(tx);
}

export async function listDocs(filter = {}) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DOCS, "readonly");
    const req = tx.objectStore(STORE_DOCS).getAll();
    req.onsuccess = () => {
      let list = req.result || [];
      if (filter.folderId) list = list.filter((d) => d.folderId === filter.folderId);
      if (filter.kind) list = list.filter((d) => d.kind === filter.kind);
      if (filter.ticker) {
        const t = String(filter.ticker).toUpperCase();
        list = list.filter((d) => String(d.ticker || "").toUpperCase() === t);
      }
      if (filter.q) {
        const q = String(filter.q).toLowerCase();
        list = list.filter(
          (d) =>
            String(d.title || "").toLowerCase().includes(q) ||
            String(d.ticker || "").toLowerCase().includes(q) ||
            String(d.headline || "").toLowerCase().includes(q)
        );
      }
      list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getDocById(id) {
  return idbGet(STORE_DOCS, id);
}

/**
 * Save a generated briefing or deep dive into storage.
 */
export async function saveGeneratedDoc({
  kind, // 'briefing' | 'deep_dive'
  title,
  ticker = null,
  asOf = null,
  runId = null,
  payload = null,
  html = null,
  folderId = null,
  lean = null,
  headline = null
}) {
  await ensureSystemFolders();
  const k = kind === "deep_dive" ? "deep_dive" : "briefing";
  const fid =
    folderId ||
    (k === "deep_dive" ? SYSTEM.DEEP_DIVES.id : SYSTEM.BRIEFINGS.id);
  const t = ticker ? String(ticker).toUpperCase().replace(/\.JK$/i, "") : null;
  const rec = {
    id: uid(),
    folderId: fid,
    kind: k,
    title:
      title ||
      (k === "deep_dive"
        ? `Deep dive ${t || "?"} · ${asOf || new Date().toISOString().slice(0, 10)}`
        : `Briefing · ${asOf || new Date().toISOString().slice(0, 10)}`),
    ticker: t,
    asOf: asOf || null,
    runId: runId || null,
    lean: lean || payload?.sentiment?.judgeLean || payload?.forecast?.lean || null,
    headline:
      headline ||
      payload?.presentation?.headline ||
      payload?.marketWide?.plainHeadline ||
      payload?.thesis?.headline ||
      null,
    payload: compactPayload(payload),
    html: html ? String(html).slice(0, 2_500_000) : null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  await putDocLocal(rec);
  await cloudPutDoc(rec).catch(() => {});
  return rec;
}

export async function createEmptyDoc({ folderId, title, kind = "briefing" }) {
  return saveGeneratedDoc({
    kind,
    title: title || "Catatan baru",
    folderId: folderId || SYSTEM.BRIEFINGS.id,
    payload: { note: true, body: "" },
    html: null
  });
}

export async function updateDocMeta(id, patch) {
  const rec = await getDocById(id);
  if (!rec) throw new Error("Dokumen tidak ada");
  const next = {
    ...rec,
    ...patch,
    id: rec.id,
    updatedAt: Date.now()
  };
  if (patch.ticker) next.ticker = String(patch.ticker).toUpperCase();
  await putDocLocal(next);
  await cloudPutDoc(next).catch(() => {});
  return next;
}

export async function renameDoc(id, title) {
  const t = String(title || "").trim();
  if (!t) throw new Error("Judul kosong");
  return updateDocMeta(id, { title: t });
}

export async function moveDoc(id, folderId) {
  if (!folderId) throw new Error("folderId wajib");
  return updateDocMeta(id, { folderId });
}

export async function deleteDocRecord(id) {
  const db = await openDb();
  const tx = db.transaction(STORE_DOCS, "readwrite");
  tx.objectStore(STORE_DOCS).delete(id);
  await txDone(tx);
  await cloudDeleteDoc(id).catch(() => {});
}

export async function listDocsForTicker(ticker) {
  return listDocs({ kind: "deep_dive", ticker });
}

export async function countByKind() {
  const docs = await listDocs();
  return {
    briefing: docs.filter((d) => d.kind === "briefing").length,
    deep_dive: docs.filter((d) => d.kind === "deep_dive").length,
    total: docs.length
  };
}

export { SYSTEM };

// ═══ Firebase cloud mirror ═══

function cloudReady() {
  return !!(currentUser?.uid);
}

function folderRef(id) {
  return doc(firestoreDb, "users", currentUser.uid, "ihsg_folders", id);
}
function docRef(id) {
  return doc(firestoreDb, "users", currentUser.uid, "ihsg_docs", id);
}

async function cloudPutFolder(folder) {
  await ensureAuth();
  if (!cloudReady()) return;
  await setDoc(
    folderRef(folder.id),
    {
      ...folder,
      syncedAt: serverTimestamp()
    },
    { merge: true }
  );
}

async function cloudDeleteFolder(id) {
  await ensureAuth();
  if (!cloudReady()) return;
  await deleteDoc(folderRef(id));
}

async function cloudPutDoc(rec) {
  await ensureAuth();
  if (!cloudReady()) return;
  // strip huge html for cloud if needed — keep full offline
  const cloud = {
    ...rec,
    html: rec.html && rec.html.length > 900_000 ? rec.html.slice(0, 900_000) : rec.html,
    syncedAt: serverTimestamp()
  };
  await setDoc(docRef(rec.id), cloud, { merge: true });
}

async function cloudDeleteDoc(id) {
  await ensureAuth();
  if (!cloudReady()) return;
  await deleteDoc(docRef(id));
}

async function cloudSyncFolders() {
  await ensureAuth();
  if (!cloudReady()) return;
  for (const f of Object.values(SYSTEM)) {
    await setDoc(
      folderRef(f.id),
      {
        id: f.id,
        name: f.name,
        systemKey: f.systemKey,
        kind: "system",
        updatedAt: Date.now(),
        syncedAt: serverTimestamp()
      },
      { merge: true }
    );
  }
}

/**
 * Pull cloud → IDB (best-effort after login).
 */
export async function pullCloudStorage(onLog) {
  await ensureAuth();
  if (!cloudReady()) {
    onLog?.("Storage: skip cloud pull (belum login)");
    return { folders: 0, docs: 0 };
  }
  let fCount = 0;
  let dCount = 0;
  try {
    const fSnap = await getDocs(collection(firestoreDb, "users", currentUser.uid, "ihsg_folders"));
    for (const d of fSnap.docs) {
      const data = d.data();
      const rec = { id: d.id, ...data };
      const db = await openDb();
      const tx = db.transaction(STORE_FOLDERS, "readwrite");
      tx.objectStore(STORE_FOLDERS).put(rec);
      await txDone(tx);
      fCount++;
    }
  } catch (e) {
    onLog?.("Storage pull folders: " + e.message, "warn");
  }
  try {
    const dSnap = await getDocs(
      query(
        collection(firestoreDb, "users", currentUser.uid, "ihsg_docs"),
        orderBy("updatedAt", "desc")
      )
    );
    for (const d of dSnap.docs) {
      const data = { id: d.id, ...d.data() };
      await putDocLocal(data);
      dCount++;
    }
  } catch (e) {
    // orderBy may fail without index — fallback getAll
    try {
      const dSnap = await getDocs(
        collection(firestoreDb, "users", currentUser.uid, "ihsg_docs")
      );
      for (const d of dSnap.docs) {
        await putDocLocal({ id: d.id, ...d.data() });
        dCount++;
      }
    } catch (e2) {
      onLog?.("Storage pull docs: " + e2.message, "warn");
    }
  }
  onLog?.(`Storage cloud pull · folders=${fCount} docs=${dCount}`);
  return { folders: fCount, docs: dCount };
}

export async function exportStorageBackup() {
  const folders = await listFolders();
  const docs = await listDocs();
  return {
    format: "ihsg-market-storage",
    version: 1,
    exportedAt: new Date().toISOString(),
    folders,
    docs
  };
}

export async function importStorageBackup(obj) {
  if (!obj || obj.format !== "ihsg-market-storage") {
    throw new Error("Format backup tidak dikenali");
  }
  for (const f of obj.folders || []) {
    const db = await openDb();
    const tx = db.transaction(STORE_FOLDERS, "readwrite");
    tx.objectStore(STORE_FOLDERS).put(f);
    await txDone(tx);
    await cloudPutFolder(f).catch(() => {});
  }
  for (const d of obj.docs || []) {
    await putDocLocal(d);
    await cloudPutDoc(d).catch(() => {});
  }
  return {
    folders: (obj.folders || []).length,
    docs: (obj.docs || []).length
  };
}
