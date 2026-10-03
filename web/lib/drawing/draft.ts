// Autosave of in-progress drawings to IndexedDB (a safety net against a closed tab or a crash).
import type { Doc } from "./types";

const DB = "unsigned-drawings", STORE = "drafts";

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function saveDraft(key: string, doc: Doc, caption: string) {
  try {
    const db = await open();
    await new Promise<void>((res, rej) => { const t = db.transaction(STORE, "readwrite"); t.objectStore(STORE).put({ doc, caption, at: Date.now() }, key); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
    db.close();
  } catch { /* private mode or quota: autosave is best-effort */ }
}

export async function loadDraft(key: string): Promise<{ doc: Doc; caption: string; at: number } | null> {
  try {
    const db = await open();
    const v = await new Promise<any>((res, rej) => { const r = db.transaction(STORE).objectStore(STORE).get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    db.close();
    return v ?? null;
  } catch { return null; }
}

export async function clearDraft(key: string) {
  try {
    const db = await open();
    await new Promise<void>((res) => { const t = db.transaction(STORE, "readwrite"); t.objectStore(STORE).delete(key); t.oncomplete = () => res(); });
    db.close();
  } catch { /* */ }
}
