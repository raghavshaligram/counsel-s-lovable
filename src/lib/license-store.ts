import { openDB, type IDBPDatabase } from "idb";
import type { LicenseSnapshot } from "./license.functions";

const DB_NAME = "pdfmacro-license";
const STORE = "license";
const KEY = "current";

let dbPromise: Promise<IDBPDatabase> | null = null;
function db() {
  if (typeof indexedDB === "undefined") return null;
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      },
    });
  }
  return dbPromise;
}

export async function saveLicense(snap: LicenseSnapshot) {
  const d = await db();
  if (!d) return;
  await d.put(STORE, snap, KEY);
}

export async function loadLicense(): Promise<LicenseSnapshot | null> {
  const d = await db();
  if (!d) return null;
  return ((await d.get(STORE, KEY)) as LicenseSnapshot | null) ?? null;
}

export async function clearLicense() {
  const d = await db();
  if (!d) return;
  await d.delete(STORE, KEY);
}

/** Ask the browser to keep IDB through storage pressure. Safe to call repeatedly. */
export async function persistStorage(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
