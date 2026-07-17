/**
 * Welcome modal — first-time visitor onboarding for /workspace.
 * Seen-flag persists in IndexedDB so it survives reloads and only ever
 * appears once. Closing OR finishing the flow sets the flag.
 */
import { openDB, type IDBPDatabase } from "idb";

const DB = "pdfmacro-prefs";
const STORE = "prefs";
const KEY = "welcome-seen";

let dbp: Promise<IDBPDatabase> | null = null;
function db() {
  if (typeof indexedDB === "undefined") return null;
  if (!dbp) {
    dbp = openDB(DB, 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      },
    });
  }
  return dbp;
}

export async function hasSeenWelcome(): Promise<boolean> {
  try {
    const d = await db();
    if (!d) return true; // SSR / no IDB → don't pop the modal
    return (await d.get(STORE, KEY)) === true;
  } catch {
    return true;
  }
}

export async function markWelcomeSeen(): Promise<void> {
  try {
    const d = await db();
    if (!d) return;
    await d.put(STORE, true, KEY);
  } catch {
    /* ignore */
  }
}

export async function resetWelcomeSeen(): Promise<void> {
  try {
    const d = await db();
    if (!d) return;
    await d.delete(STORE, KEY);
  } catch {
    /* ignore */
  }
}
