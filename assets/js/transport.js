// How the pages reach the backend.
//  - Server mode (FastAPI running): plain fetch('/api/...'), or fetch(API_BASE + '/api/...') when the static
//    page is pointed at a hosted backend (window.API_BASE) — the LLM key then stays on that server.
//  - Static mode (GitHub Pages, window.STATIC_MODE = true): the same Python backend runs in the browser
//    inside a shared Web Worker (pyworker.js). It starts in the background the moment the page loads;
//    the page paints immediately from a bootstrap snapshot and requests simply wait until it is ready.
// AI settings: no API key is built into the site. In the app's «AI settings» a visitor picks the built-in agent or
// any provider + model + their own key (or opens a private link `…/#provider=deepseek&key=…`). It is kept in THIS
// browser only (localStorage) and sent with each request as X-LLM-Config: on GitHub Pages to the in-browser
// backend (a worker on this device, which calls the provider directly); on a server, used for that request only.
import { lang } from './i18n.js?v=04bab6a77c';

const API_BASE = (window.API_BASE || '').replace(/\/$/, '');
export const STATIC = !!window.STATIC_MODE && !API_BASE;

export const PROVIDERS = [
  // id, label, models (first = default), needs a key, takes a URL
  ['deepseek', 'DeepSeek', ['deepseek-v4-flash', 'deepseek-chat'], true, false],
  ['openai', 'OpenAI (ChatGPT)', ['gpt-4o-mini', 'gpt-4o'], true, false],
  ['anthropic', 'Anthropic (Claude)', ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'], true, false],
  ['gemini', 'Google Gemini', ['gemini-2.0-flash'], true, false],
  ['groq', 'Groq', ['llama-3.3-70b-versatile'], true, false],
  ['openrouter', 'OpenRouter', ['meta-llama/llama-3.3-70b-instruct:free'], true, false],
  ['mistral', 'Mistral', ['mistral-small-latest'], true, false],
  ['xai', 'xAI (Grok)', ['grok-2-latest'], true, false],
  ['together', 'Together AI', ['meta-llama/Llama-3.3-70B-Instruct-Turbo'], true, false],
  ['cerebras', 'Cerebras', ['llama-3.3-70b'], true, false],
  ['ollama', 'Ollama (local)', ['qwen2.5:7b', 'qwen2.5:14b', 'llama3.1:8b'], false, true],
  ['lmstudio', 'LM Studio (local)', ['local-model'], false, true],
  ['custom', 'Custom (OpenAI-compatible URL)', [], true, true],
].map(([id, label, models, key, url]) => ({ id, label, models, key, url }));
export const providerInfo = (id) => PROVIDERS.find((p) => p.id === id);

const CFG_STORE = 'aiConfig';
const KEY_RE = /^[\x21-\x7e]{8,400}$/;
// provider '' = this app's default (the server's own model, or the built-in agent); 'offline' = built-in agent only
const EMPTY = { provider: '', model: '', key: '', base_url: '', stt: 'browser', stt_key: '' };

export function aiConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(CFG_STORE) || 'null');
    if (c && typeof c === 'object') return { ...EMPTY, ...c };
    const old = localStorage.getItem('llmKey'); // older private links stored only a DeepSeek key
    if (old) return { ...EMPTY, provider: 'deepseek', model: 'deepseek-v4-flash', key: old };
  } catch { /* storage blocked */ }
  return { ...EMPTY };
}
export function setAiConfig(cfg) {
  try {
    if (!cfg) localStorage.removeItem(CFG_STORE); else localStorage.setItem(CFG_STORE, JSON.stringify({ ...EMPTY, ...cfg }));
    localStorage.removeItem('llmKey');
  } catch { /* storage blocked */ }
}
/** The header for one config (or null = let the app use its default). */
export function aiHeader(cfg = aiConfig()) {
  if (!cfg.provider) return null;
  if (cfg.provider === 'offline') return JSON.stringify({ provider: 'offline' });
  return JSON.stringify({ provider: cfg.provider, model: cfg.model || providerInfo(cfg.provider)?.models[0] || '',
    key: cfg.key || '', base_url: cfg.base_url || '' });
}

function takeConfigFromLink() {
  const h = (location.hash || '').replace(/^#/, '');
  if (!/(^|&)(key|k|provider)=/.test(h)) return;
  const params = new URLSearchParams(h);
  const key = (params.get('key') || params.get('k') || '').trim();
  const provider = (params.get('provider') || 'deepseek').trim().toLowerCase();
  const model = (params.get('model') || '').trim();
  ['key', 'k', 'provider', 'model'].forEach((x) => params.delete(x));
  const rest = params.toString();
  history.replaceState(null, '', location.pathname + location.search + (rest ? `#${rest}` : '')); // out of the bar & history
  if (providerInfo(provider) && (KEY_RE.test(key) || !providerInfo(provider).key)) {
    setAiConfig({ ...aiConfig(), provider, model: model || providerInfo(provider).models[0] || '', key });
  }
}
takeConfigFromLink();
export const validKey = (k) => KEY_RE.test(k || '');

const pending = new Map();
let port = null;
let ready = null;
let seq = 0;

function connect() {
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    const url = new URL('pyworker.js', import.meta.url);
    if (window.BUILD_ID) url.searchParams.set('v', window.BUILD_ID); // a new deploy never reuses an old worker
    if (window.SharedWorker) {
      port = new SharedWorker(url, { name: 'wallet-backend' }).port;
      port.start();
    } else {
      port = new Worker(url);
    }
    port.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'ready') resolve();
      else if (m.type === 'error') reject(new Error(m.message));
      else if (m.type === 'response') {
        const done = pending.get(m.id);
        if (done) { pending.delete(m.id); done(m); }
      }
    };
    port.postMessage({ type: 'hello' });
  });
  return ready;
}
if (STATIC) connect(); // start the engine at once, in parallel with the first paint

/** Instant first paint in static mode: last data seen in this browser, else the build-time snapshot. */
export async function staticSnapshot(l = lang()) {
  try {
    const cached = localStorage.getItem(`boot:${l}`);
    if (cached) return JSON.parse(cached);
  } catch { /* storage unavailable */ }
  try {
    const r = await fetch(new URL(`../../py/boot-${l}.json`, import.meta.url));
    if (r.ok) return await r.json();
  } catch { /* offline */ }
  return null;
}

export function rememberBoot(data, l = lang()) {
  try { localStorage.setItem(`boot:${l}`, JSON.stringify(data)); } catch { /* storage unavailable */ }
}

/** Returns {ok, status, data}. */
export async function request(method, path, body, headers = {}) {
  const hdrs = { 'X-Lang': lang(), ...headers };
  if (!('X-LLM-Config' in hdrs)) { const h = aiHeader(); if (h) hdrs['X-LLM-Config'] = h; }
  if (hdrs['X-LLM-Config'] === null) delete hdrs['X-LLM-Config'];
  if (!STATIC) {
    const opt = { method, headers: hdrs };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const r = await fetch(API_BASE + path, opt);
    let data = null;
    try { data = await r.json(); } catch { /* not json */ }
    return { ok: r.ok, status: r.status, data };
  }
  await connect();
  return new Promise((resolve) => {
    seq += 1;
    const id = seq;
    pending.set(id, (m) => resolve({ ok: m.status < 400, status: m.status, data: m.body }));
    port.postMessage({ type: 'request', id, method, path, body: body === undefined ? '' : JSON.stringify(body), headers: hdrs });
  });
}

export const apiUrl = (path) => API_BASE + path;

/** Trigger a browser download of a JSON document (works in both modes). */
export async function downloadJson(path, filename, headers = {}) {
  const r = await request('GET', path, undefined, headers);
  if (!r.ok) throw new Error((r.data && r.data.detail) || `HTTP ${r.status}`);
  const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
