/**
 * Storage shim.
 *
 * Inside a Claude artifact, `window.storage` is provided by the sandbox and is
 * genuinely shared across everyone who opens the artifact. Outside of it (here),
 * that API doesn't exist, so this fills it in with localStorage.
 *
 * IMPORTANT: localStorage is per-browser. "Shared" data is NOT actually shared
 * between devices — every person testing locally sees their own board. That's
 * fine for development. To make the board real, replace the body of these four
 * functions with calls to your backend (Supabase, Firebase, or your own API).
 * Nothing else in App.jsx needs to change.
 */

const PREFIX = "freshy:";

function keyFor(key, shared) {
  return `${PREFIX}${shared ? "shared" : "personal"}:${key}`;
}

const storage = {
  async get(key, shared = false) {
    const raw = localStorage.getItem(keyFor(key, shared));
    if (raw === null) {
      // Matches the artifact API: missing keys throw rather than return null.
      throw new Error(`Key not found: ${key}`);
    }
    return { key, value: raw, shared };
  },

  async set(key, value, shared = false) {
    localStorage.setItem(keyFor(key, shared), value);
    return { key, value, shared };
  },

  async delete(key, shared = false) {
    localStorage.removeItem(keyFor(key, shared));
    return { key, deleted: true, shared };
  },

  async list(prefix = "", shared = false) {
    const scope = keyFor(prefix, shared);
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(scope)) {
        keys.push(k.replace(keyFor("", shared), ""));
      }
    }
    return { keys, prefix, shared };
  },
};

if (typeof window !== "undefined" && !window.storage) {
  window.storage = storage;
}

export default storage;
