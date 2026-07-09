/**
 * Firebase init — mirror Cognitive Sandbox pattern.
 * Uses named DB `market` (not sandboxcognitive / mikirexp).
 */
import { firebaseConfig, firestoreDatabaseId } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firestoreDatabaseId || "market");
export const auth = getAuth(app);

/** @type {{ uid: string } | null} */
export let currentUser = null;

let authReadyPromise = null;

/**
 * Ensure anonymous session (personal bot, no Google UI required).
 * Enable Anonymous provider in Firebase Console → Authentication.
 */
export function ensureAuth() {
  if (authReadyPromise) return authReadyPromise;
  authReadyPromise = new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        currentUser = user;
        unsub();
        resolve(user);
        return;
      }
      try {
        const cred = await signInAnonymously(auth);
        currentUser = cred.user;
        unsub();
        resolve(cred.user);
      } catch (e) {
        console.warn("[firebase] anonymous auth failed:", e?.message || e);
        currentUser = null;
        unsub();
        resolve(null);
      }
    });
  });
  return authReadyPromise;
}

export function userColl(name) {
  if (!currentUser?.uid) throw new Error("Firebase auth belum siap");
  return collection(db, "users", currentUser.uid, name);
}

export function userDoc(collName, id) {
  if (!currentUser?.uid) throw new Error("Firebase auth belum siap");
  return doc(db, "users", currentUser.uid, collName, id);
}

export function runDoc(runId) {
  return userDoc("ihsg_runs", runId);
}

export function agentStepDoc(runId, step) {
  return doc(db, "users", currentUser.uid, "ihsg_runs", runId, "agents", step);
}
