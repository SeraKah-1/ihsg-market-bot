/**
 * Firebase — Google Sign-In + named DB `market` + offline cache.
 */
import { firebaseConfig, firestoreDatabaseId } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as fbSignOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

export const app = initializeApp(firebaseConfig);

const dbId = firestoreDatabaseId || "market";

/** Firestore with multi-tab IndexedDB persistence (offline reads of cached docs) */
export const db = initializeFirestore(
  app,
  {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  },
  dbId
);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

/** @type {import("firebase/auth").User | null} */
export let currentUser = null;

/** @type {((u: import("firebase/auth").User|null) => void)[]} */
const authListeners = [];

let authReadyPromise = null;
let persistenceReady = null;

export function onUserChanged(fn) {
  authListeners.push(fn);
  if (currentUser !== undefined) fn(currentUser);
  return () => {
    const i = authListeners.indexOf(fn);
    if (i >= 0) authListeners.splice(i, 1);
  };
}

function emitAuth(user) {
  currentUser = user;
  for (const fn of authListeners) {
    try {
      fn(user);
    } catch (e) {
      console.warn("auth listener", e);
    }
  }
}

async function ensurePersistence() {
  if (persistenceReady) return persistenceReady;
  persistenceReady = setPersistence(auth, browserLocalPersistence).catch((e) => {
    console.warn("[firebase] setPersistence:", e?.message || e);
  });
  return persistenceReady;
}

/**
 * Wait for existing session (Google, local persistence). Does NOT auto-login.
 * @returns {Promise<import("firebase/auth").User | null>}
 */
export function waitForAuth() {
  if (authReadyPromise) return authReadyPromise;
  authReadyPromise = (async () => {
    await ensurePersistence();
    try {
      const redirect = await getRedirectResult(auth);
      if (redirect?.user) {
        emitAuth(redirect.user);
        return redirect.user;
      }
    } catch (e) {
      console.warn("[firebase] getRedirectResult:", e?.message || e);
    }
    return new Promise((resolve) => {
      const unsub = onAuthStateChanged(auth, (user) => {
        emitAuth(user);
        unsub();
        resolve(user || null);
      });
    });
  })();
  return authReadyPromise;
}

/** @deprecated use waitForAuth — kept for agent-memory compat */
export function ensureAuth() {
  return waitForAuth();
}

export async function signInWithGoogle({ preferRedirect = false } = {}) {
  await ensurePersistence();
  try {
    if (preferRedirect) {
      await signInWithRedirect(auth, googleProvider);
      return null; // page will navigate
    }
    const cred = await signInWithPopup(auth, googleProvider);
    emitAuth(cred.user);
    return cred.user;
  } catch (e) {
    const code = e?.code || "";
    // popup blocked / cancelled → try redirect
    if (
      code === "auth/popup-blocked" ||
      code === "auth/popup-closed-by-user" ||
      code === "auth/cancelled-popup-request"
    ) {
      if (!preferRedirect) {
        await signInWithRedirect(auth, googleProvider);
        return null;
      }
    }
    throw e;
  }
}

export async function signOut() {
  await fbSignOut(auth);
  emitAuth(null);
}

export function userColl(name) {
  if (!currentUser?.uid) throw new Error("Belum login Google");
  return collection(db, "users", currentUser.uid, name);
}

export function userDoc(collName, id) {
  if (!currentUser?.uid) throw new Error("Belum login Google");
  return doc(db, "users", currentUser.uid, collName, id);
}

export function runDoc(runId) {
  return userDoc("ihsg_runs", runId);
}

export function agentStepDoc(runId, step) {
  if (!currentUser?.uid) throw new Error("Belum login Google");
  return doc(db, "users", currentUser.uid, "ihsg_runs", runId, "agents", step);
}

// Keep live user via continuous listener after first wait
waitForAuth().then(() => {
  onAuthStateChanged(auth, (user) => emitAuth(user));
});
