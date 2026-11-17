/* In-browser backend for the GitHub Pages build.
 *
 * Runs the project's Python backend (the framework-free `api.dispatch` + SQLAlchemy + the offline agent)
 * on Pyodide/WebAssembly. Used as a SharedWorker so the wallet and the admin dashboard (separate tabs)
 * share ONE backend and one database. The SQLite file lives in /app/data, persisted to IndexedDB.
 *
 * Start-up is kept small on purpose: Pyodide core + two prebuilt packages (sqlite3, sqlalchemy) that
 * download in parallel with the core, and the backend source in a single JSON file. No PyPI installs,
 * no FastAPI/pydantic. Browsers cache all of it, so later visits start from cache.
 */
const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
const TICK_MS = 30000;

importScripts(`${PYODIDE_URL}pyodide.js`);

const ports = new Set();
const state = { ready: false, error: null };
let py = null;
let bridge = null;
let persistTimer = null;

function post(port, msg) { try { port.postMessage(msg); } catch { /* port closed */ } }
function broadcast(msg) { ports.forEach((p) => post(p, msg)); }

function syncfs(populate) {
  return new Promise((resolve, reject) => py.FS.syncfs(populate, (err) => (err ? reject(err) : resolve())));
}
function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => { syncfs(false).catch(() => {}); }, 300);
}

const ready = (async () => {
  const version = new URL(self.location.href).searchParams.get('v') || '';
  const bundleP = fetch(new URL(`../../py/bundle.json?v=${version}`, self.location.href)).then((r) => r.json());
  py = await loadPyodide({ indexURL: PYODIDE_URL, packages: ['sqlite3', 'sqlalchemy'] });
  const bundle = await bundleP;
  for (const [rel, text] of Object.entries(bundle)) {
    const target = `/app/${rel}`;
    py.FS.mkdirTree(target.slice(0, target.lastIndexOf('/')));
    py.FS.writeFile(target, text);
  }
  py.FS.mkdirTree('/app/data');
  py.FS.mount(py.FS.filesystems.IDBFS, {}, '/app/data');
  await syncfs(true); // restore the saved database
  py.runPython("import sys\nif '/app' not in sys.path: sys.path.insert(0, '/app')");
  bridge = py.pyimport('backend.static_bridge');
  bridge.boot();
  await syncfs(false);
  setInterval(() => {
    try { bridge.tick(); schedulePersist(); } catch (e) { console.error('scheduler tick failed', e); }
  }, TICK_MS);
  state.ready = true;
  broadcast({ type: 'ready' });
})().catch((err) => {
  state.error = String(err && err.message ? err.message : err);
  broadcast({ type: 'error', message: state.error });
});

async function onMessage(port, msg) {
  if (!msg || msg.type !== 'request') return;
  try {
    await ready;
    if (state.error) throw new Error(state.error);
    const [path, query = ''] = String(msg.path).split('?');
    const out = JSON.parse(bridge.handle(msg.method, path, query, msg.body || '', JSON.stringify(msg.headers || {})));
    post(port, { type: 'response', id: msg.id, status: out.status, body: out.body });
    if (msg.method !== 'GET') schedulePersist();
  } catch (err) {
    post(port, { type: 'response', id: msg.id, status: 503, body: { detail: String(err.message || err) } });
  }
}

function attach(port) {
  ports.add(port);
  port.onmessage = (e) => onMessage(port, e.data);
  if (state.error) post(port, { type: 'error', message: state.error });
  else if (state.ready) post(port, { type: 'ready' });
}

if ('onconnect' in self) {
  self.onconnect = (e) => { const port = e.ports[0]; attach(port); port.start(); };
} else {
  attach(self);
}
