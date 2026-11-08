// Sauvegarde locale (IndexedDB) : images, palettes et progression.
const DB = 'magicolor', STORE = 'drawings';
let dbp;

function open() {
  dbp ||= new Promise((ok, ko) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => ok(req.result);
    req.onerror = () => ko(req.error);
  });
  return dbp;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((ok, ko) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => ok(req && req.result);
    t.onerror = () => ko(t.error);
    t.onabort = () => ko(t.error || new Error('Sauvegarde annulée'));
  });
}

export const getAll = () => tx('readonly', s => s.getAll());
export const get = id => tx('readonly', s => s.get(id));
export const put = d => tx('readwrite', s => s.put(d));
export const remove = id => tx('readwrite', s => s.delete(id));

// Demande au navigateur de ne pas effacer les données sous pression mémoire
export function persist() {
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}
