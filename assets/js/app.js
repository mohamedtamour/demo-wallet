// Pay Transfer Agent — wallet frontend (vanilla ES module, no build step)
import { icon, hydrateIcons } from './icons.js?v=04bab6a77c';
import { EXAMPLES, WEEKDAYS, isEn, lang, setLang, t, withLang } from './i18n.js?v=04bab6a77c';
import {
  PROVIDERS, STATIC, aiConfig, aiHeader, apiUrl, providerInfo, rememberBoot, request, setAiConfig, staticSnapshot, validKey,
} from './transport.js?v=04bab6a77c';

/* =========================================================================
   Utilities
   ========================================================================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
// entities without digits, so number-isolation in rich() can never split an entity
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const toEn = (s) => String(s ?? '')
  .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const fmtNum = (n, dec = 0) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: dec });
const fmtIQD = (n) => `${fmtNum(Math.round(n))} ${t('iqd')}`;
const fmtMoney = (n, cur) => (cur === 'USD' ? `$${fmtNum(n, 2)}` : fmtIQD(n));
const fmtPhone = (p) => (p && p.length === 11 ? `${p.slice(0, 4)} ${p.slice(4, 7)} ${p.slice(7)}` : p || '');
const fmtDate = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(isEn() ? 'en-GB' : 'ar-IQ-u-nu-latn', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
};
// Values made only of digits/symbols (phones, codes, card masks) must be laid out LTR inside RTL text.
const val = (v) => (/^[\d\s+\-:/.,$•*#()]+$/.test(String(v ?? '')) ? `<span dir="ltr" class="num">${esc(v)}</span>` : esc(v));
// Escape text and isolate number runs ("0780 123 4567", "042-699-1063") so RTL layout doesn't reorder them.
const rich = (s) => esc(s).replace(/\d[\d ,.\-]*\d/g, (m) => `<span dir="ltr" class="num">${m}</span>`);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const isTouch = matchMedia('(pointer: coarse)').matches;
const CONFIRM_WORDS = /^(أكّد|أكد|تأكيد|confirm)$/i;
const CANCEL_WORDS = /^(إلغاء|الغاء|cancel)$/i;

const api = {
  async req(method, url, body, headers = {}) {
    let r;
    try { r = await request(method, url, body, headers); } catch (e) {
      throw new Error(STATIC ? `${t('err_load')}: ${e.message}` : t('err_server'));
    }
    const data = r.data;
    if (!r.ok) throw new Error((data && (typeof data.detail === 'string' ? data.detail : t('err_request'))) || `HTTP ${r.status}`);
    return data;
  },
  get(u) { return this.req('GET', u); },
  post(u, b = {}, h = {}) { return this.req('POST', u, b, h); },
};

/* =========================================================================
   State
   ========================================================================= */
const S = {
  app: {}, user: { balance: 0 }, services: {}, order: [], providers: [], txs: [], bills: [], contacts: [], agent: {},
  schedules: [], notifications: [], unread: 0, schedulable: [], lastNoteId: 0, live: !STATIC,
  stack: [{ name: 'home', params: {} }],
  hideBalance: store.get('hideBal', false),
  tts: store.get('tts', true),
  fs: store.get('fs', 1),
  convId: store.get('convId', null),
};

const els = {
  view: $('#view'), screen: $('#screen'), toast: $('#toast'),
  sheet: $('#assistant'), backdrop: $('#sheetBackdrop'), log: $('#asLog'), quick: $('#asQuick'),
  input: $('#asInput'), mic: $('#asMic'), listen: $('#listenBar'), listenTitle: $('#listenTitle'),
  listenInterim: $('#listenInterim'), asStatus: $('#asStatus'), tts: $('#ttsBtn'), fab: $('#fabMic'),
};

let toastTimer;
function toast(msg, err = false) {
  els.toast.textContent = msg;
  els.toast.classList.toggle('err', !!err);
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3200);
}

function applyFontScale() { document.documentElement.style.setProperty('--fs', S.fs); }

/* =========================================================================
   Static texts in index.html (data-t / data-t-title / data-t-ph)
   ========================================================================= */
function translatePage() {
  $$('[data-t]').forEach((el) => { el.innerHTML = t(el.dataset.t); });
  $$('[data-t-title]').forEach((el) => { el.title = t(el.dataset.tTitle); el.setAttribute('aria-label', t(el.dataset.tTitle)); });
  $$('[data-t-ph]').forEach((el) => { el.placeholder = t(el.dataset.tPh); });
  document.title = `${S.app.name || 'Pay Transfer Agent'} — ${t('app.title')}`;
}

/* =========================================================================
   Data
   ========================================================================= */
function applyBootstrap(b) {
  S.app = b.app; S.user = b.user; S.services = b.catalog.services; S.order = b.catalog.home_order;
  S.providers = b.catalog.providers; S.txs = b.transactions; S.bills = b.bills; S.contacts = b.contacts; S.agent = b.agent;
  S.schedulable = b.schedulable || [];
  applySchedData(b);
  S.lastNoteId = Math.max(S.lastNoteId, 0, ...S.notifications.map((n) => n.id));
}

async function loadBootstrap() {
  const b = await api.get('/api/bootstrap');
  applyBootstrap(b);
  S.live = true;
  if (STATIC) rememberBoot(b);
  return b;
}

async function boot() {
  applyFontScale();
  translatePage();
  hydrateIcons();
  if (STATIC) {
    // paint at once from a snapshot; the in-browser engine starts in the background and replaces it
    const snap = await staticSnapshot();
    if (snap) { applyBootstrap(snap); renderAll(); }
    loadBootstrap().then(() => renderAll(false)).catch((e) => { if (!snap) showLoadError(e); });
    return;
  }
  try { await loadBootstrap(); } catch (e) { showLoadError(e); return; }
  renderAll();
}

function showLoadError(e) {
  els.view.innerHTML = `<div class="placeholder-art"><div class="ri">${icon('alert')}</div><h3>${esc(t('err_load'))}</h3><p>${esc(e.message)}</p><button class="btn primary" data-act="reload">${esc(t('retry'))}</button></div>`;
}

function renderAll(scrollTop = true) {
  translatePage();
  const chip = $('#asLang');
  if (chip) chip.textContent = isEn() ? 'ع' : 'EN';
  renderAgentStatus();
  renderPitchChips();
  updateTtsBtn();
  render(scrollTop);
}

async function switchLanguage(target = null, { keepLog = false } = {}) {
  const next = target === 'ar' || target === 'en' ? target : (isEn() ? 'ar' : 'en');
  if (next === lang()) return;
  setLang(next);
  translatePage();
  try {
    if (STATIC && !S.live) { const snap = await staticSnapshot(); if (snap) applyBootstrap(snap); }
    else await loadBootstrap();
  } catch (e) { toast(e.message, true); }
  if (AS.restored && !keepLog) { AS.restored = false; if (AS.open) restoreConversation(); }
  renderAll(false);
}

async function refreshWallet() {
  try {
    const w = await api.get('/api/wallet');
    S.user.balance = w.balance; S.user.balance_display = w.balance_display; S.bills = w.bills; S.txs = w.transactions;
    applySchedData(w);
    const top = current().name;
    if (['home', 'transactions', 'bills', 'schedules', 'notifications'].includes(top)) render(false);
  } catch { /* keep stale data */ }
}

function applySchedData(d) {
  if (d.schedules) S.schedules = d.schedules;
  if (d.notifications) S.notifications = d.notifications;
  if (typeof d.unread === 'number') S.unread = d.unread;
  const badge = $('#bellDot');
  if (badge) badge.hidden = !S.unread;
}

// Poll for notifications produced by the background scheduler (executed payments, reminders).
async function pollNotifications() {
  if (!S.live) return;
  try {
    const r = await api.get('/api/notifications');
    const fresh = r.items.filter((n) => n.id > S.lastNoteId && !n.read);
    S.notifications = r.items; S.unread = r.unread;
    if (fresh.length) {
      S.lastNoteId = Math.max(S.lastNoteId, ...fresh.map((n) => n.id));
      toast(fresh[0].title);
      if (fresh.some((n) => n.kind === 'schedule_done')) await refreshWallet();
      else applySchedData(r);
      if (['home', 'notifications'].includes(current().name)) render(false);
    } else applySchedData(r);
  } catch { /* offline */ }
}
setInterval(pollNotifications, 20000);

function setBalance(n, bump = false) {
  if (typeof n !== 'number') return;
  const changed = n !== S.user.balance;
  S.user.balance = n;
  const el = $('#balVal');
  if (el) {
    el.textContent = S.hideBalance ? '••••••' : fmtNum(n);
    if (bump && changed) { el.parentElement.classList.remove('bump'); void el.offsetWidth; el.parentElement.classList.add('bump'); }
  }
}

function renderAgentStatus() {
  const llm = S.agent.llm_enabled;
  const label = llm ? t('as.online_llm', { m: S.agent.model || '' }) : t('as.online_offline');
  els.asStatus.innerHTML = `<span class="dot ${llm ? 'on' : 'off'}"></span> ${esc(label)}`;
  $('#pitchStatus').innerHTML = `<span class="dot ${llm ? 'on' : 'off'}"></span><span>${esc(llm ? t('pitch.ai_llm', { model: S.agent.model || '' }) : t('pitch.ai_offline'))}</span>`;
}

function renderPitchChips() {
  $('#pitchChips').innerHTML = EXAMPLES[lang()].map((x) => `<button data-ex="${esc(x)}">${esc(x)}</button>`).join('');
  $('#pitchChips').onclick = (e) => {
    const b = e.target.closest('[data-ex]');
    if (b) { openAssistant(); sendToAssistant(b.dataset.ex); }
  };
}

/* =========================================================================
   Router
   ========================================================================= */
const current = () => S.stack[S.stack.length - 1];
function go(name, params = {}, { reset = false, replace = false } = {}) {
  if (reset) S.stack = [{ name: 'home', params: {} }];
  if (replace && S.stack.length > 1) S.stack.pop();
  if (!(name === 'home' && S.stack.length === 1 && current().name === 'home')) S.stack.push({ name, params });
  render();
}
function back() {
  if (S.stack.length > 1) S.stack.pop();
  render();
}
function render(scrollTop = true) {
  if (!S.services || !Object.keys(S.services).length) return;
  const { name, params } = current();
  const fn = VIEWS[name] || VIEWS.home;
  els.view.innerHTML = fn(params);
  els.view.style.animation = 'none'; void els.view.offsetWidth; els.view.style.animation = '';
  hydrateIcons(els.view);
  BIND[name]?.(params);
  if (scrollTop) els.screen.scrollTop = 0;
  const tabFor = { home: 'home', transactions: 'transactions', bills: 'bills', more: 'more' }[name];
  $$('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === (tabFor || '')));
}

const topbar = (title) => `<div class="topbar"><button class="icon-btn" data-act="back" aria-label="${esc(t('back'))}">${icon('back')}</button><h2>${esc(title)}</h2></div>`;
const optLabel = (f, o) => { const i = (f.options || []).indexOf(o); return i >= 0 && f.option_labels ? f.option_labels[i] : o; };

/* =========================================================================
   Views
   ========================================================================= */
const VIEWS = {
  home() {
    const h = new Date().getHours();
    const greet = h < 12 ? t('home.morning') : t('home.evening');
    const initial = (S.user.name || 'م').trim().charAt(0);
    const quick = [
      ['transfer', 'send', t('home.q_transfer')], ['western_union', 'globe', t('home.q_wu')],
      ['wallet_topup', 'plus', t('home.q_topup')], ['cash_withdraw', 'cash', t('home.q_withdraw')],
    ];
    const tiles = S.order.map((k) => {
      const s = S.services[k]; if (!s) return '';
      return `<button class="tile ${k === 'western_union' ? 'accent' : ''}" data-act="open" data-key="${k}"><span class="ti">${icon(s.icon)}</span>${esc(s.name)}</button>`;
    }).join('');
    return `
      <section class="hero">
        <div class="hero-top">
          <div class="who"><div class="avatar">${esc(initial)}</div><div><small>${greet}</small><b>${esc(S.user.name)}</b></div></div>
          <div class="hero-actions">
            <button class="icon-btn lang-btn" data-act="lang" title="${esc(t('lang.switch_title'))}">${isEn() ? 'ع' : 'EN'}</button>
            <button class="icon-btn" data-act="font" title="${esc(t('home.font'))}">${icon('type')}</button>
            <button class="icon-btn" data-act="go" data-view="notifications" title="${esc(t('home.notifications'))}">${icon('bell')}<span class="badge-dot" id="bellDot" ${S.unread ? '' : 'hidden'}></span></button>
          </div>
        </div>
        <div class="balance-card">
          <div class="bc-row"><span>${t('home.available')}</span><button class="icon-btn" data-act="toggle-bal" title="${esc(t('home.toggle_bal'))}">${icon(S.hideBalance ? 'eyeOff' : 'eye')}</button></div>
          <div class="bc-amount"><span id="balVal">${S.hideBalance ? '••••••' : fmtNum(S.user.balance)}</span><small>${t('iqd')}</small></div>
          <div class="bc-meta"><span>${t('home.wallet_no')} <span class="num">${esc(fmtPhone(S.user.phone))}</span></span><span class="pill-soft">${t('home.demo_wallet')}</span></div>
        </div>
        <div class="quick">${quick.map(([k, ic, l]) => `<button data-act="open" data-key="${k}"><span class="qi">${icon(ic)}</span>${esc(l)}</button>`).join('')}</div>
      </section>
      <button class="assist-cta" data-act="assistant">
        <span class="mic-orb">${icon('mic')}</span>
        <span><b>${t('home.cta_title')}</b><small>${t('home.cta_sub')}</small></span>
        <span class="go">${icon('chevron')}</span>
      </button>
      ${homeAlert()}
      <section class="block"><div class="block-head"><h3>${t('home.services')}</h3></div><div class="svc-grid">${tiles}</div></section>
      <section class="block">
        <div class="block-head"><h3>${t('home.scheduled')}</h3>${S.schedules.length ? `<button class="link-btn" data-act="go" data-view="schedules">${t('home.manage')}</button>` : ''}</div>
        ${S.schedules.length ? scheduleList(S.schedules.slice(0, 3), true) : `
          <button class="sched-promo" data-act="assistant-say" data-text="${esc(EXAMPLES[lang()][3])}">
            <span class="ri">${icon('calendar')}</span>
            <span><b>${t('home.sched_promo_t')}</b><small>${t('home.sched_promo_s')}</small></span>
          </button>`}
      </section>
      <section class="block">
        <div class="block-head"><h3>${t('home.recent')}</h3><button class="link-btn" data-act="tab" data-tab="transactions">${t('home.see_all')}</button></div>
        ${txList(S.txs.slice(0, 4))}
      </section>`;
  },

  service(p) {
    const s = S.services[p.key];
    if (!s) return `${topbar(t('svc.service'))}<div class="empty">${t('svc.not_found')}</div>`;
    if (s.kind === 'screen') return VIEWS[{ payments: 'bills', providers: 'providers', store: 'store', more: 'more' }[p.key]](p);
    const prefill = p.prefill || {};
    const fields = s.fields.map((f) => fieldHtml(s, f, prefill[f.key], p)).join('');
    const hint = s.fields.find((f) => f.hint && f.type === 'name')?.hint;
    return `${topbar(s.name)}
      <div class="page">
        <div class="svc-head"><div class="si">${icon(s.icon)}</div><div><h2>${esc(s.name)}</h2><p>${esc(s.description)}</p></div></div>
        ${p.fromAssistant ? `<div class="note">${icon('sparkles')}<span>${t('svc.filled')} ${p.secure ? t('svc.secure') : t('svc.review')}</span></div>` : ''}
        ${hint ? `<div class="note">${icon('info')}<span>${esc(hint)}</span></div>` : ''}
        <form class="form-card" id="svcForm" novalidate>${fields}${S.schedulable.includes(p.key) ? timingBlock(p) : ''}</form>
        <div class="sticky-cta"><button class="btn primary block" id="svcSubmit">${icon('check')} ${t('continue')}</button></div>
      </div>`;
  },

  confirm(p) {
    const a = p.action;
    return `${topbar(t('cf.review'))}
      <div class="page">
        ${reviewCard(a, true)}
        ${(a.warnings || []).map((w) => `<div class="note warn mt">${icon('alert')}<span>${esc(w)}</span></div>`).join('')}
        <div class="btn-row">
          <button class="btn ok" data-act="confirm-tx" data-id="${a.id}">${icon('check')} ${t('cf.confirm_btn')}</button>
          <button class="btn ghost" data-act="cancel-tx" data-id="${a.id}">${t('cancel')}</button>
        </div>
        <div class="voice-hint">${icon('mic')}<span>${t('cf.voice_hint')}</span></div>
      </div>`;
  },

  receipt(p) {
    const a = p.action; const r = a.result || {};
    const v = p.verified;
    return `<div class="receipt">
        <div class="tick">${icon('check')}</div>
        <h2>${t('rc.done')}</h2>
        <p>${rich(r.message || '')}</p>
        ${v && v.ok ? `<div class="note mt">${icon('shield')}<span>${esc(t('rc.verified', { status: v.status, time: fmtDate(v.checked_at) }))}</span></div>` : ''}
        ${r.code ? codeBox(r.code_label, r.code) : ''}
        ${reviewCard(a, false)}
        <button class="btn primary block" data-act="home">${t('rc.back_home')}</button>
      </div>`;
  },

  transactions() {
    return `${topbar(t('tx.title'))}<div class="page">${txList(S.txs)}</div>`;
  },

  bills() {
    const rows = S.bills.map((b) => `
      <div class="bill-card ${b.status}">
        <div class="ri">${icon('receipt')}</div>
        <div class="rt"><b>${esc(b.biller_label || b.biller)}</b><small>${esc(t('bills.account', { a: b.account }))}${b.due_date ? esc(t('bills.due_on', { d: b.due_date })) : ''}</small>
          <div class="mt" style="margin-top:6px"><span class="status ${b.status}">${b.status === 'due' ? esc(t('bills.due_amt', { a: fmtIQD(b.amount_due) })) : t('bills.paid')}</span></div></div>
        ${b.status === 'due' ? `<button class="btn primary sm" data-act="pay-bill" data-id="${b.id}">${t('bills.pay')}</button>` : ''}
      </div>`).join('');
    return `${topbar(t('bills.title'))}<div class="page">${rows || `<div class="empty">${t('bills.none')}</div>`}
      <button class="btn ghost block mt" data-act="open" data-key="bill_payment">${icon('plus')} ${t('bills.new')}</button></div>`;
  },

  contacts() {
    const rows = S.contacts.map((c) => `
      <div class="row"><div class="ri">${icon('user')}</div><div class="rt"><b>${esc(c.name)}</b><small>${esc(c.relation)} • <span class="ltr">${esc(fmtPhone(c.wallet))}</span></small></div>
      <button class="btn primary sm" data-act="send-to" data-wallet="${esc(c.wallet)}">${t('contacts.send')}</button></div>`).join('');
    return `${topbar(t('contacts.title'))}<div class="page"><div class="list">${rows}</div></div>`;
  },

  providers() {
    const rows = S.providers.map((p) => `<div class="row"><div class="ri">${icon('building')}</div><div class="rt"><b>${esc(p.name)}</b><small>${esc(p.type)}</small></div></div>`).join('');
    return `${topbar(t('providers.title'))}<div class="page"><div class="list">${rows}</div></div>`;
  },

  schedules() {
    const ideas = EXAMPLES[lang()].slice(3, 6);
    return `${topbar(t('sch.title'))}<div class="page">
      <div class="note">${icon('calendar')}<span>${t('sch.note')}</span></div>
      ${S.schedules.length ? scheduleList(S.schedules) : `<div class="list"><div class="empty">${t('sch.empty')}</div></div>`}
      <div class="section-title">${t('sch.ask')}</div>
      <div class="suggest">
        ${ideas.map((x) => `<button data-act="assistant-say" data-text="${esc(x)}">${icon('sparkles')}<span>${esc(x)}</span></button>`).join('')}
      </div></div>`;
  },

  notifications() {
    const items = S.notifications;
    return `${topbar(t('notes.title'))}<div class="page">${items.length ? `<div class="list">${items.map((n) => `
      <div class="row note-row ${n.read ? '' : 'unread'}"><div class="ri ${/failed|overdue/.test(n.kind) ? 'out' : ''}">${icon(NOTE_ICON[n.kind] || 'bell')}</div>
        <div class="rt"><b>${esc(n.title)}</b><small class="wrap">${rich(n.body)}</small><small>${esc(fmtDate(n.created_at))}</small></div>
        ${billerOf(n) && /bill/.test(n.kind) ? `<button class="btn primary sm" data-act="assistant-say" data-text="${esc(t('bills.say_pay', { b: billerOf(n) }))}">${t('bills.pay')}</button>` : ''}
      </div>`).join('')}</div>` : `<div class="list"><div class="empty">${t('notes.empty')}</div></div>`}</div>`;
  },

  confirm_schedule(p) {
    const s = p.schedule;
    return `${topbar(t('sch.confirm_title'))}<div class="page">
      ${scheduleReview(s)}
      <div class="btn-row">
        <button class="btn ok" data-act="sched" data-op="confirm" data-id="${s.id}">${icon('check')} ${t('sch.activate')}</button>
        <button class="btn ghost" data-act="sched" data-op="cancel" data-id="${s.id}">${t('cancel')}</button>
      </div>
      <div class="voice-hint">${icon('mic')}<span>${t('cf.voice_hint')}</span></div></div>`;
  },

  schedule_done(p) {
    const s = p.schedule;
    return `<div class="receipt">
      <div class="tick">${icon('calendar')}</div>
      <h2>${s.kind === 'reminder' ? t('sch.reminder_on') : t('sch.payment_on')}</h2>
      <p>${esc(s.timing)}</p>
      ${scheduleReview(s)}
      <div class="btn-row"><button class="btn primary" data-act="go" data-view="schedules">${t('sch.mine')}</button><button class="btn ghost" data-act="home">${t('home')}</button></div>
    </div>`;
  },

  store() {
    return `${topbar(t('store.title'))}<div class="placeholder-art"><div class="ri">${icon('bag')}</div><h3>${t('store.soon')}</h3><p>${t('store.p')}</p></div>`;
  },

  more() {
    const fsOpts = [[1, t('more.font_1')], [1.12, t('more.font_2')], [1.25, t('more.font_3')]];
    return `${topbar(t('more.title'))}
      <div class="page">
        <div class="list"><div class="row"><div class="ri" style="width:54px;height:54px;border-radius:50%;font-weight:700">${esc((S.user.name || '').charAt(0))}</div>
          <div class="rt"><b>${esc(S.user.name)}</b><small class="ltr">${esc(fmtPhone(S.user.phone))}</small></div><span class="status completed">${t('more.verified')}</span></div></div>
        <div class="section-title">${t('more.access')}</div>
        <div class="list settings">
          <div class="row"><div class="ri">${icon('globe')}</div><div class="rt"><b>${t('more.language')}</b><small>${t('more.language_sub')}</small></div>
            <div class="seg"><button class="${isEn() ? '' : 'on'}" data-act="set-lang" data-v="ar">عربي</button><button class="${isEn() ? 'on' : ''}" data-act="set-lang" data-v="en">English</button></div></div>
          <div class="row"><div class="ri">${icon('type')}</div><div class="rt"><b>${t('more.font')}</b><small>${t('more.font_sub')}</small></div>
            <div class="seg">${fsOpts.map(([v, l]) => `<button class="${S.fs === v ? 'on' : ''}" data-act="set-fs" data-v="${v}">${l}</button>`).join('')}</div></div>
          <div class="row" data-act="toggle-tts"><div class="ri">${icon('volume')}</div><div class="rt"><b>${t('more.tts')}</b><small>${t('more.tts_sub')}</small></div><span class="toggle ${S.tts ? 'on' : ''}"></span></div>
        </div>
        <div class="section-title">${t('more.wallet')}</div>
        <div class="list settings">
          <div class="row clickable" data-act="go" data-view="schedules"><div class="ri">${icon('calendar')}</div><div class="rt"><b>${t('sch.title')}</b><small>${esc(t('more.sched_sub', { n: S.schedules.length }))}</small></div>${icon('chevron')}</div>
          <div class="row clickable" data-act="go" data-view="notifications"><div class="ri">${icon('bell')}</div><div class="rt"><b>${t('notes.title')}</b><small>${esc(t('more.unread', { n: S.unread }))}</small></div>${icon('chevron')}</div>
          <div class="row clickable" data-act="go" data-view="contacts"><div class="ri">${icon('users')}</div><div class="rt"><b>${t('contacts.title')}</b><small>${esc(t('more.contacts_sub', { n: S.contacts.length }))}</small></div>${icon('chevron')}</div>
          <div class="row clickable" data-act="go" data-view="providers"><div class="ri">${icon('building')}</div><div class="rt"><b>${t('providers.title')}</b></div>${icon('chevron')}</div>
          <div class="row clickable" data-act="admin"><div class="ri">${icon('dashboard')}</div><div class="rt"><b>${t('more.admin')}</b><small>${t('more.admin_sub')}</small></div>${icon('chevron')}</div>
          <div class="row clickable" data-act="reset"><div class="ri out">${icon('refresh')}</div><div class="rt"><b>${t('more.reset')}</b><small>${t('more.reset_sub')}</small></div></div>
        </div>
        <div class="section-title">${t('more.ai')}</div>
        <div class="list"><div class="row clickable" data-act="ai-settings"><div class="ri">${icon('sparkles')}</div><div class="rt"><b>${esc(S.agent.llm_enabled ? S.agent.model : t('more.offline'))}</b><small class="wrap">${t('more.ai_open')}</small></div>${icon('chevron')}</div></div>
        <div class="section-title">${t('more.about')}</div>
        <div class="list"><div class="row"><div class="ri">${icon('info')}</div><div class="rt"><b>${esc(S.app.name)} • v${esc(S.app.version)}</b><small>${esc(t('more.assistant', { m: S.agent.llm_enabled ? S.agent.model : t('more.offline') }))} • ${esc(t('more.voice', { v: S.agent.stt_enabled ? 'Whisper' : t('more.browser') }))}</small></div></div></div>
      </div>`;
  },
};

/* ------------------------------------------------------------------ schedules & notifications */
const NOTE_ICON = { bill_due: 'receipt', bill_overdue: 'alert', schedule_upcoming: 'calendar', schedule_done: 'check',
  schedule_failed: 'alert', schedule_skipped: 'info', reminder: 'bell' };

function billerOf(n) {
  const b = n.meta && n.meta.biller;
  if (!b) return '';
  return S.bills.find((x) => x.biller === b)?.biller_label || b;
}

function homeAlert() {
  const n = S.notifications.find((x) => !x.read && (x.kind === 'bill_due' || x.kind === 'bill_overdue' || x.kind === 'schedule_failed'));
  if (!n) return '';
  const biller = billerOf(n);
  return `<div class="home-alert ${n.kind === 'bill_due' ? '' : 'bad'}">
    <span class="ri">${icon(NOTE_ICON[n.kind] || 'bell')}</span>
    <span class="rt"><b>${esc(n.title)}</b><small>${rich(n.body)}</small></span>
    ${biller ? `<button class="btn primary sm" data-act="assistant-say" data-text="${esc(t('bills.say_pay', { b: biller }))}">${t('home.pay_it')}</button>` : ''}
  </div>`;
}

function scheduleList(items, compact = false) {
  return `<div class="list">${items.map((s) => `
    <div class="row sched-row ${s.status}">
      <div class="ri">${icon(s.kind === 'reminder' ? 'bell' : 'calendar')}</div>
      <div class="rt"><b>${esc(s.title)}</b>
        <small>${esc(s.amount_display ? `${s.amount_display} • ` : '')}${esc(s.timing)}</small>
        <small class="next">${s.status === 'active' ? `${icon('history')} ${esc(t('sch.next', { d: s.next_run_display }))}` : `<span class="status ${s.status === 'paused' ? 'due' : 'cancelled'}">${esc(s.status_label)}</span>`}</small>
        ${compact ? '' : `<div class="sched-actions">
          ${s.status === 'active' ? `<button class="chip sm" data-act="sched" data-op="pause" data-id="${s.id}">${t('sch.pause')}</button>` : ''}
          ${s.status === 'paused' ? `<button class="chip sm" data-act="sched" data-op="resume" data-id="${s.id}">${t('sch.resume')}</button>` : ''}
          <button class="chip sm" data-act="sched" data-op="run-now" data-id="${s.id}">${icon('send')} ${t('sch.run_now')}</button>
          <button class="chip sm danger" data-act="sched" data-op="cancel" data-id="${s.id}">${t('sch.delete')}</button>
        </div>`}
      </div>
    </div>`).join('')}</div>`;
}

function scheduleReview(s) {
  return `<div class="review">
    <div class="rv-head"><div class="si">${icon(s.kind === 'reminder' ? 'bell' : 'calendar')}</div><div><small>${esc(s.kind === 'reminder' ? t('sch.reminder') : t('sch.payment', { s: s.service_name }))}</small><h3>${esc(s.title)}</h3></div></div>
    ${s.amount_display ? `<div class="rv-amount"><small>${t('sch.each_time')}</small><b>${esc(s.amount_display)}</b></div>` : ''}
    <dl class="rv-lines">${(s.lines || []).filter((l) => l.kind !== 'amount').map((l) => `<div><dt>${esc(l.label)}</dt><dd>${val(l.value)}</dd></div>`).join('')}</dl>
    <div class="rv-total"><span>${s.status === 'pending' ? t('sch.first_run') : t('sch.next_run')}</span><b>${esc(s.next_run_display)}</b></div>
    ${s.kind === 'payment' ? `<div class="rv-after"><span>${t('sch.reminder_note')}</span></div>` : ''}
  </div>`;
}

/* ------------------------------------------------------------------ partials */
function txList(items) {
  if (!items || !items.length) return `<div class="list"><div class="empty">${t('tx.empty')}</div></div>`;
  return `<div class="list">${items.map((x) => {
    const credit = x.direction === 'credit';
    return `<div class="row"><div class="ri ${credit ? 'in' : 'out'}">${icon(credit ? 'down' : (S.services[x.service]?.icon || 'up'))}</div>
      <div class="rt"><b>${esc(x.title)}</b><small>${esc(fmtDate(x.created_at))} • ${esc(x.service_name)}</small></div>
      <div class="ra ${credit ? 'in' : 'out'}">${credit ? '+' : '-'}${esc(fmtNum(x.total_iqd))}</div></div>`;
  }).join('')}</div>`;
}

function codeBox(label, code) {
  return `<div class="code-box"><div><small>${esc(label || t('rc.code'))}</small><b>${esc(code)}</b></div>
    <button class="icon-btn" data-act="copy" data-text="${esc(code)}" title="${esc(t('copy'))}">${icon('copy')}</button></div>`;
}

function reviewCard(a, pending) {
  const svc = S.services[a.service] || {};
  const lines = (a.lines || []).filter((l) => l.kind !== 'amount');
  return `<div class="review">
    <div class="rv-head"><div class="si">${icon(svc.icon || 'list')}</div><div><small>${esc(a.service_name)} • <span class="ltr">${esc(a.reference)}</span></small><h3>${esc(pending ? a.title : a.subtitle)}</h3></div></div>
    <div class="rv-amount"><small>${t('rc.amount')}</small><b>${esc(a.amount_display)}</b></div>
    <dl class="rv-lines">${lines.map((l) => `<div><dt>${esc(l.label)}</dt><dd>${val(l.value)}</dd></div>`).join('')}
      ${!pending && a.completed_at ? `<div><dt>${t('rc.date')}</dt><dd>${esc(fmtDate(a.completed_at))}</dd></div>` : ''}</dl>
    <div class="rv-total"><span>${esc(a.total_label)}</span><b>${esc(a.total_display)}</b></div>
    <div class="rv-after"><span>${pending ? t('rc.after') : t('rc.current')}</span><b>${esc(a.balance_after_display)}</b></div>
  </div>`;
}

const WEEK_ORDER = [5, 6, 0, 1, 2, 3, 4]; // Iraqi week starts on Saturday
const FREQS = () => [['once', t('freq.once')], ['daily', t('freq.daily')], ['weekly', t('freq.weekly')], ['monthly', t('freq.monthly')]];
const todayISO = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10); // Baghdad date

function timingBlock(p) {
  const tm = p.timing || {};
  const on = !!p.schedule;
  const freq = tm.frequency || 'monthly';
  const days = Array.from({ length: 28 }, (_, i) => i + 1);
  const wd = WEEKDAYS[lang()];
  return `<div class="field timing" data-field="timing">
    <label><span>${t('time.when')}</span>${on && p.fromAssistant ? `<span class="ai-tag">${icon('sparkles')}${t('svc.assistant_tag')}</span>` : ''}</label>
    <div class="seg big"><button type="button" class="${on ? '' : 'on'}" data-act="when" data-v="now">${t('time.now')}</button><button type="button" class="${on ? 'on' : ''}" data-act="when" data-v="later">${icon('calendar')} ${t('time.later')}</button></div>
    <div class="timing-opts" ${on ? '' : 'hidden'}>
      <span class="mini-label">${t('time.repeat')}</span>
      <div class="chips">${FREQS().map(([k, l]) => `<button type="button" class="chip sm ${freq === k ? 'on' : ''}" data-act="tpick" data-k="frequency" data-v="${k}">${l}</button>`).join('')}</div>
      <input type="hidden" data-tkey="frequency" value="${esc(freq)}">
      <div data-tshow="monthly"><span class="mini-label">${t('time.dom')}</span>
        <select class="select" data-tkey="day_month">${days.map((d) => `<option value="${d}" ${Number(tm.day) === d ? 'selected' : ''}>${esc(t('time.day_n', { n: d }))}</option>`).join('')}<option value="31" ${Number(tm.day) === 31 ? 'selected' : ''}>${t('time.last_day')}</option></select></div>
      <div data-tshow="weekly"><span class="mini-label">${t('time.dow')}</span>
        <div class="chips">${WEEK_ORDER.map((i) => `<button type="button" class="chip sm ${freq === 'weekly' && Number(tm.day) === i ? 'on' : ''}" data-act="tpick" data-k="day_week" data-v="${i}">${wd[i]}</button>`).join('')}</div>
        <input type="hidden" data-tkey="day_week" value="${freq === 'weekly' && tm.day != null ? esc(tm.day) : ''}"></div>
      <div data-tshow="once"><span class="mini-label">${t('time.date')}</span><input class="input ltr" type="date" data-tkey="date" min="${todayISO()}" value="${esc(tm.date || '')}"></div>
      <div class="hint">${t('time.hint')}${p.key === 'bill_payment' ? t('time.hint_bill') : ''}</div>
    </div>
    <div class="err" hidden></div></div>`;
}

function applyTimingShow(form) {
  const f = form.querySelector('[data-tkey="frequency"]')?.value;
  $$('[data-tshow]', form).forEach((el) => { el.hidden = el.dataset.tshow !== f; });
}

function readTiming(form) {
  const opts = form.querySelector('.timing-opts');
  if (!opts || opts.hidden) return null;
  const g = (k) => form.querySelector(`[data-tkey="${k}"]`)?.value || '';
  const frequency = g('frequency');
  const tm = { frequency };
  if (frequency === 'monthly') tm.day = g('day_month');
  if (frequency === 'weekly') tm.day = g('day_week');
  if (frequency === 'once') tm.date = g('date');
  return tm;
}

function presetAmounts(svc, f) {
  if (svc.currency === 'USD') return [100, 200, 500, 1000].filter((v) => v >= (f.min || 0) && v <= (f.max || 1e12));
  return [10000, 25000, 50000, 100000, 250000].filter((v) => v >= (f.min || 0) && v <= (f.max || 1e12)).slice(0, 4);
}

function fieldHtml(svc, f, value, p) {
  const has = value !== undefined && value !== null && value !== '';
  const cls = ['field'];
  if (has && p.fromAssistant) cls.push('filled');
  if (p.awaiting === f.key) cls.push('awaiting');
  const show = f.show_if ? ` data-show='${esc(JSON.stringify(f.show_if))}'` : '';
  const tag = has && p.fromAssistant ? `<span class="ai-tag">${icon('sparkles')}${t('svc.assistant_tag')}</span>` : '';
  const label = `<label for="f_${f.key}"><span>${esc(f.label)}${f.required ? '' : ` <small class="muted">${t('optional')}</small>`}</span>${tag}</label>`;
  let control = '';
  const v = has ? String(value) : '';
  switch (f.type) {
    case 'phone': {
      control = `<input class="input ltr" id="f_${f.key}" data-key="${f.key}" type="tel" inputmode="tel" placeholder="${esc(f.placeholder)}" value="${esc(v)}" maxlength="16">`;
      if (svc.key === 'transfer' && S.contacts.length) {
        control += `<span class="mini-label">${t('svc.from_contacts')}</span><div class="chips">${S.contacts.map((c) => `<button type="button" class="chip sm ${v === c.wallet ? 'on' : ''}" data-act="fill" data-target="${f.key}" data-value="${esc(c.wallet)}">${esc(c.name)}</button>`).join('')}</div>`;
      }
      if (svc.key === 'mobile_topup') {
        control += `<span class="mini-label">${t('svc.shortcut')}</span><div class="chips"><button type="button" class="chip sm ${v === S.user.phone ? 'on' : ''}" data-act="fill" data-target="${f.key}" data-value="${esc(S.user.phone)}">${t('svc.my_number')}</button></div>`;
      }
      break;
    }
    case 'money': {
      if (f.options && f.options.length) {
        control = `<input type="hidden" data-key="${f.key}" data-num="1" value="${esc(v)}"><div class="chips">${f.options.map((o) => `<button type="button" class="chip ${Number(v) === o ? 'on' : ''}" data-act="pick" data-target="${f.key}" data-value="${o}">${esc(fmtMoney(o, svc.currency))}</button>`).join('')}</div>`;
      } else {
        const shown = has ? fmtNum(value, svc.currency === 'USD' ? 2 : 0) : '';
        control = `<div class="input-wrap"><input class="input ltr money" id="f_${f.key}" data-key="${f.key}" data-cur="${svc.currency}" inputmode="decimal" placeholder="0" value="${esc(shown)}"><span class="suffix">${svc.currency === 'USD' ? t('usd') : t('iqd')}</span></div>
          <div class="chips" style="margin-top:8px">${presetAmounts(svc, f).map((o) => `<button type="button" class="chip sm" data-act="fill" data-target="${f.key}" data-value="${fmtNum(o)}">${esc(fmtMoney(o, svc.currency))}</button>`).join('')}</div>`;
      }
      break;
    }
    case 'choice': {
      if (f.options.length <= 4) {
        control = `<input type="hidden" data-key="${f.key}" value="${esc(v)}"><div class="chips">${f.options.map((o) => `<button type="button" class="chip ${v === o ? 'on' : ''}" data-act="pick" data-target="${f.key}" data-value="${esc(o)}">${esc(optLabel(f, o))}</button>`).join('')}</div>`;
      } else {
        control = `<select class="select" id="f_${f.key}" data-key="${f.key}"><option value="">${t('choose')}</option>${f.options.map((o) => `<option value="${esc(o)}" ${v === o ? 'selected' : ''}>${esc(optLabel(f, o))}</option>`).join('')}</select>`;
      }
      break;
    }
    case 'card_number': case 'expiry': case 'cvv': {
      const ml = f.type === 'card_number' ? 23 : f.type === 'expiry' ? 5 : 4;
      control = `<div class="input-wrap"><input class="input ltr" id="f_${f.key}" data-key="${f.key}" inputmode="numeric" autocomplete="off" placeholder="${esc(f.placeholder)}" maxlength="${ml}"><span class="lock">${icon('lock')}</span></div>`;
      break;
    }
    default:
      control = `<input class="input" id="f_${f.key}" data-key="${f.key}" type="text" placeholder="${esc(f.placeholder)}" value="${esc(v)}" maxlength="120">`;
  }
  const hint = f.hint && f.type !== 'name' ? `<div class="hint">${esc(f.hint)}</div>` : '';
  return `<div class="${cls.join(' ')}" data-field="${f.key}"${show}>${label}${control}${hint}<div class="err" hidden></div></div>`;
}

/* =========================================================================
   View bindings
   ========================================================================= */
const BIND = {
  service(p) {
    const form = $('#svcForm'); if (!form) return;
    const sync = () => applyShowIf(form);
    form.addEventListener('input', (e) => {
      const x = e.target;
      if (x.classList.contains('money')) {
        const usd = x.dataset.cur === 'USD';
        let raw = toEn(x.value).replace(usd ? /[^\d.]/g : /[^\d]/g, '');
        if (usd) { const [i, d] = raw.split('.'); raw = d !== undefined ? `${i}.${d.slice(0, 2)}` : i; }
        const [i, d] = raw.split('.');
        x.value = i ? fmtNum(Number(i)) + (d !== undefined ? `.${d}` : '') : (d !== undefined ? `0.${d}` : '');
      }
      if (x.dataset.key === 'card_number') x.value = toEn(x.value).replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');
      if (x.dataset.key === 'expiry') { let y = toEn(x.value).replace(/\D/g, '').slice(0, 4); if (y.length > 2) y = `${y.slice(0, 2)}/${y.slice(2)}`; x.value = y; }
      if (x.dataset.key === 'cvv') x.value = toEn(x.value).replace(/\D/g, '').slice(0, 4);
      if (p.key === 'mobile_topup' && x.dataset.key === 'number') {
        const carrier = { '077': 'آسياسيل', '078': 'زين', '079': 'زين', '075': 'كورك' }[toEn(x.value).replace(/\D/g, '').slice(0, 3)];
        const hidden = form.querySelector('[data-key="carrier"]');
        if (carrier && hidden) {
          hidden.value = carrier;
          hidden.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.value === carrier));
          clearFieldError(hidden.closest('.field'));
        }
      }
      clearFieldError(x.closest('.field'));
    });
    form.addEventListener('change', sync);
    applyTimingShow(form);
    form.addEventListener('submit', (e) => { e.preventDefault(); submitService(p); });
    $('#svcSubmit').onclick = (e) => { e.preventDefault(); submitService(p); };
    sync();
    const focusKey = p.awaiting || (p.secure ? 'card_number' : null);
    // never steal focus from the assistant's input while the sheet is open
    if (focusKey && !isTouch && !AS.open) setTimeout(() => { if (!AS.open) form.querySelector(`[data-key="${focusKey}"]:not([type=hidden])`)?.focus(); }, 250);
  },
  notifications() {
    if (!S.unread || !S.live) return;
    api.post('/api/notifications/read').then(() => {
      S.unread = 0; S.notifications.forEach((n) => { n.read = true; }); applySchedData({});
    }).catch(() => {});
  },
};

function applyShowIf(form) {
  const vals = collect(form, false);
  $$('[data-show]', form).forEach((el) => {
    const cond = JSON.parse(el.dataset.show);
    el.hidden = !Object.entries(cond).every(([k, v]) => vals[k] === v);
  });
}

function collect(form, onlyVisible = true) {
  const out = {};
  $$('[data-key]', form).forEach((el) => {
    const field = el.closest('.field');
    if (onlyVisible && field && field.hidden) return;
    let v = el.value.trim();
    if (!v) return;
    if (el.classList.contains('money') || el.dataset.num) v = Number(toEn(v).replace(/,/g, ''));
    else v = toEn(v);
    out[el.dataset.key] = v;
  });
  return out;
}

function clearFieldError(field) {
  if (!field) return;
  field.classList.remove('error');
  const e = field.querySelector('.err'); if (e) { e.hidden = true; e.textContent = ''; }
}

function showFieldErrors(errors) {
  let first = null;
  Object.entries(errors).forEach(([k, msg]) => {
    const field = $(`.field[data-field="${k}"]`);
    if (!field || field.hidden) return;
    field.classList.add('error');
    const e = field.querySelector('.err'); e.textContent = msg; e.hidden = false;
    first = first || field;
  });
  first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function busy(btn, on, label) {
  if (!btn || !btn.isConnected) return;
  btn.disabled = on;
  btn.innerHTML = on ? '<span class="spinner"></span>' : label;
}

async function submitService(p) {
  const form = $('#svcForm'); const btn = $('#svcSubmit');
  const svc = S.services[p.key];
  const vals = collect(form);
  const timing = readTiming(form);
  const errs = {};
  svc.fields.forEach((f) => {
    const field = $(`.field[data-field="${f.key}"]`);
    const optional = timing && p.key === 'bill_payment' && f.key === 'amount'; // recurring bill: pay what's due
    if (f.required && !optional && field && !field.hidden && (vals[f.key] === undefined || vals[f.key] === '')) errs[f.key] = t('required');
  });
  if (timing && timing.frequency === 'weekly' && timing.day === '') errs.timing = t('time.pick_dow');
  if (timing && timing.frequency === 'once' && !timing.date) errs.timing = t('time.pick_date');
  $$('.field', form).forEach(clearFieldError);
  if (Object.keys(errs).length) { showFieldErrors(errs); return; }
  const label = `${icon('check')} ${t('continue')}`;
  busy(btn, true);
  try {
    if (timing) {
      const res = await api.post('/api/schedules', { kind: 'payment', service: p.key, fields: vals, ...timing, conversation_id: p.convId || null });
      if (res.status === 'ready') go('confirm_schedule', { schedule: res.schedule });
      else {
        const e = { ...(res.errors || {}) };
        if (res.awaiting && !e[res.awaiting]) e[['frequency', 'day', 'date'].includes(res.awaiting) ? 'timing' : res.awaiting] = res.message;
        showFieldErrors(e);
      }
      return;
    }
    const res = await api.post('/api/actions', { service: p.key, fields: vals, conversation_id: p.convId || null });
    if (res.status === 'ready') {
      go('confirm', { action: res.action, convId: p.convId });
    } else if (res.status === 'insufficient') {
      showFieldErrors({ amount: res.message }); toast(res.message, true);
    } else {
      const e = { ...(res.errors || {}) };
      (res.missing || []).forEach((k) => { if (!e[k]) e[k] = t('required'); });
      showFieldErrors(e);
    }
  } catch (e) { toast(e.message, true); } finally { busy(btn, false, label); }
}

/* =========================================================================
   Confirm / cancel (shared by screen + chat)
   ========================================================================= */
// A tap on a chat card is answered in the conversation's language; the app screens behind keep the app language.
const chatHeaders = (fromChat) => (fromChat && chatLang() !== lang() ? { 'X-Lang': chatLang() } : {});
async function inAppLang(obj, url, key) {
  if (chatLang() === lang()) return obj;
  try { return (await api.get(url))[key] || obj; } catch { return obj; }
}

async function confirmTx(id, btn) {
  const label = btn ? btn.innerHTML : '';
  busy(btn, true);
  try {
    const fromChat = AS.cards.has(id);
    const res = await api.post(`/api/actions/${id}/confirm`, {}, chatHeaders(fromChat));
    setBalance(res.balance, true);
    const top = current();
    const inChat = fromChat || (AS.restored && top.name === 'confirm' && top.params.convId && top.params.convId === S.convId);
    if (res.status === 'completed') {
      markCard(id, 'ok');
      if (inChat) {
        addBot(res.reply, { mode: 'ui', trace: [{ name: 'screen_confirm', status: res.status, source: 'engine.confirm + database re-read', verified: res.verified }] });
        inChatLang(() => { addCard(receiptCardHtml(res.action), res.action.id, 'receipt'); renderQuick([t('rc.current'), t('home.recent')]); });
        speak(res.reply, chatLang());
      }
      const screenAction = fromChat ? await inAppLang(res.action, `/api/actions/${id}`, 'action') : res.action;
      go('receipt', { action: screenAction, verified: res.verified }, { reset: true });
      refreshWallet();
    } else {
      toast(res.message, true);
      if (res.action && res.action.status !== 'pending') markCard(id, 'no');
      busy(btn, false, label);
    }
  } catch (e) { toast(e.message, true); busy(btn, false, label); }
}

async function cancelTx(id) {
  try {
    const inChat = AS.cards.has(id);
    const res = await api.post(`/api/actions/${id}/cancel`, {}, chatHeaders(inChat));
    markCard(id, 'no');
    toast(res.message);
    if (inChat) { addBot(res.reply); speak(res.reply, chatLang()); renderQuick([]); }
    go('home', {}, { reset: true });
  } catch (e) { toast(e.message, true); }
}

async function schedAction(id, op, btn) {
  if (op === 'cancel' && current().name === 'schedules' && !window.confirm(t('sch.delete_q'))) return;
  const key = `s${id}`;
  const inChat = AS.cards.has(key);
  if (btn) btn.disabled = true;
  try {
    const res = await api.post(`/api/schedules/${id}/${op}`, {}, chatHeaders(inChat && (op === 'confirm' || op === 'cancel')));
    if (op === 'confirm') {
      if (res.status === 'activated') {
        markCard(key, 'ok', inChat ? inChatLang(() => t('sch.activated_mark')) : t('sch.activated_mark'));
        if (inChat) {
          addBot(res.reply);
          inChatLang(() => { addCard(schedActiveCardHtml(res.schedule)); renderQuick([t('sch.mine')]); });
          speak(res.reply, chatLang());
        }
        const screenSched = inChat ? await inAppLang(res.schedule, `/api/schedules/${id}`, 'schedule') : res.schedule;
        go('schedule_done', { schedule: screenSched }, { reset: true });
      } else toast(res.message, true);
    } else if (op === 'cancel') {
      markCard(key, 'no');
      toast(res.message);
      if (inChat) { addBot(res.reply); speak(res.reply, chatLang()); renderQuick([]); }
      if (current().name === 'confirm_schedule') go('home', {}, { reset: true });
    } else {
      toast(res.message);
      if (op === 'run-now') setBalance(res.balance, true);
    }
    await refreshWallet();
    if (op === 'run-now') await pollNotifications();
  } catch (e) { toast(e.message, true); } finally { if (btn && btn.isConnected) btn.disabled = false; }
}

/* =========================================================================
   Global click delegation (main screen)
   ========================================================================= */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  switch (act) {
    case 'back': back(); break;
    case 'reload': location.reload(); break;
    case 'home': go('home', {}, { reset: true }); refreshWallet(); break;
    case 'open': {
      const screenMap = { payments: 'bills', providers: 'providers', store: 'store', more: 'more' };
      const k = el.dataset.key;
      if (screenMap[k]) go(screenMap[k]); else go('service', { key: k });
      break;
    }
    case 'tab': setTab(el.dataset.tab); break;
    case 'go': go(el.dataset.view); break;
    case 'assistant': openAssistant(); break;
    case 'lang': switchLanguage(); break;
    case 'set-lang': if (el.dataset.v !== lang()) switchLanguage(); break;
    case 'ai-settings': openAssistant(); AI.open(); break;
    case 'toggle-bal': S.hideBalance = !S.hideBalance; store.set('hideBal', S.hideBalance); render(false); break;
    case 'font': {
      const steps = [1, 1.12, 1.25]; S.fs = steps[(steps.indexOf(S.fs) + 1) % steps.length]; store.set('fs', S.fs); applyFontScale();
      toast(t('more.font_toast', { v: { 1: t('more.font_1'), 1.12: t('more.font_2'), 1.25: t('more.font_3') }[S.fs] }));
      break;
    }
    case 'set-fs': S.fs = Number(el.dataset.v); store.set('fs', S.fs); applyFontScale(); render(false); break;
    case 'toggle-tts': toggleTts(); render(false); break;
    case 'fill': case 'pick': {
      const form = el.closest('form') || document;
      const input = form.querySelector(`[data-key="${el.dataset.target}"]`);
      if (input) { input.value = el.dataset.value; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); }
      el.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === el));
      break;
    }
    case 'confirm-tx': confirmTx(Number(el.dataset.id), el); break;
    case 'cancel-tx': cancelTx(Number(el.dataset.id)); break;
    case 'copy': try { await navigator.clipboard.writeText(el.dataset.text); toast(t('copied')); } catch { toast(t('copy_failed')); } break;
    case 'pay-bill': {
      const b = S.bills.find((x) => x.id === Number(el.dataset.id));
      if (b) go('service', { key: 'bill_payment', prefill: { biller: b.biller, account: b.account, amount: b.amount_due } });
      break;
    }
    case 'send-to': go('service', { key: 'transfer', prefill: { wallet: el.dataset.wallet } }); break;
    case 'admin': window.open('admin.html', '_blank', 'noopener'); break;
    case 'reset':
      if (!window.confirm(t('more.reset_q'))) break;
      try {
        await api.post('/api/admin/demo/reset');
        store.set('convId', null);
        try { localStorage.removeItem('boot:ar'); localStorage.removeItem('boot:en'); } catch { /* ignore */ }
        location.reload();
      } catch (err) { toast(err.message, true); }
      break;
    case 'open-secure': {
      const ui = AS.lastSecure; if (!ui) break;
      closeAssistant();
      go('service', { key: ui.service, prefill: ui.fields, awaiting: 'card_number', fromAssistant: true, secure: true, convId: S.convId }, { reset: true });
      break;
    }
    case 'view-receipt': {
      const a = AS.actions.get(Number(el.dataset.id));
      if (a) { closeAssistant(); go('receipt', { action: a }, { reset: true }); }
      break;
    }
    case 'sched': schedAction(Number(el.dataset.id), el.dataset.op, el); break;
    case 'assistant-say': openAssistant(); sendToAssistant(el.dataset.text); break;
    case 'when': {
      const block = el.closest('.timing');
      const later = el.dataset.v === 'later';
      block.querySelector('.timing-opts').hidden = !later;
      block.querySelectorAll('[data-act="when"]').forEach((b) => b.classList.toggle('on', b === el));
      break;
    }
    case 'tpick': {
      const block = el.closest('.timing');
      block.querySelector(`[data-tkey="${el.dataset.k}"]`).value = el.dataset.v;
      el.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === el));
      if (el.dataset.k === 'frequency') applyTimingShow(block);
      clearFieldError(block);
      break;
    }
    case 'sched-list': closeAssistant(); go('schedules', {}, { reset: true }); break;
    case 'suggest': case 'qr': sendToAssistant(el.dataset.text); break;
    default: break;
  }
});

function setTab(tab) {
  if (tab === 'home') go('home', {}, { reset: true });
  else go(tab, {}, { reset: true });
  if (tab === 'transactions' || tab === 'bills') refreshWallet();
}
$$('.tab').forEach((x) => x.addEventListener('click', () => setTab(x.dataset.tab)));
$('#pitchLang')?.addEventListener('click', () => switchLanguage());

/* =========================================================================
   Assistant
   ========================================================================= */
const AS = { open: false, busy: false, restored: false, cards: new Map(), actions: new Map(), seen: new Set(), lastId: 0, draftEl: null, poll: null, lastSecure: null, replyLang: null };
// The app language is the one the user picks (ع / EN button) and never changes by itself. Inside the assistant chat
// the replies, chat cards and read-aloud follow the language of the user's messages (res.lang from the backend):
// write in English in the Arabic app and the assistant answers in English, and the other way round.
const voiceLang = () => (isEn() ? 'en-US' : 'ar-IQ');
const chatLang = () => AS.replyLang || lang();
// Chat cards also read data the backend sends already translated (service names and fields, operations, bills,
// schedules, notifications). When the chat language differs from the app language, a second copy of that data is
// loaded in the chat language and used for chat cards only; the app's own copy is never touched.
const CHAT_DATA = { lang: null, data: null };
const CHAT_KEYS = (b) => ({ services: b.catalog.services, providers: b.catalog.providers, txs: b.transactions,
  bills: b.bills, contacts: b.contacts, ...(b.schedules ? { schedules: b.schedules } : {}),
  ...(b.notifications ? { notifications: b.notifications } : {}) });
async function loadChatData(fresh = false) {
  const l = chatLang();
  if (l === lang() || (!fresh && CHAT_DATA.lang === l && CHAT_DATA.data)) return;
  try {
    const b = await api.req('GET', '/api/bootstrap', undefined, { 'X-Lang': l });
    CHAT_DATA.lang = l; CHAT_DATA.data = CHAT_KEYS(b);
  } catch { /* cards fall back to the app-language data */ }
}
function inChatLang(fn, l = chatLang()) {
  const alt = l !== lang() && CHAT_DATA.lang === l ? CHAT_DATA.data : null;
  const saved = alt ? Object.fromEntries(Object.keys(alt).map((k) => [k, S[k]])) : null;
  if (alt) Object.assign(S, alt);
  try { return withLang(l, fn); } finally { if (saved) Object.assign(S, saved); }
}
const dirOf = (l) => (l === 'en' ? 'ltr' : l === 'ar' ? 'rtl' : 'auto');

function openAssistant({ listen = false } = {}) {
  els.sheet.classList.add('open'); els.sheet.setAttribute('aria-hidden', 'false');
  els.backdrop.classList.add('show'); AS.open = true;
  if (!AS.restored) restoreConversation();
  if (listen) Voice.start();
  else if (!isTouch) setTimeout(() => els.input.focus(), 320);
}
function closeAssistant() {
  els.sheet.classList.remove('open'); els.sheet.setAttribute('aria-hidden', 'true');
  els.backdrop.classList.remove('show'); AS.open = false;
  Voice.stop(true);
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
els.fab.onclick = () => { if (AS.open) Voice.start(); else openAssistant({ listen: true }); };
$('#closeAs').onclick = closeAssistant;
$('#sheetHandle').onclick = closeAssistant;
els.backdrop.onclick = closeAssistant;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && AS.open) closeAssistant(); });
$('#asSend').onclick = () => sendToAssistant(els.input.value);
els.input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sendToAssistant(els.input.value); } });
els.mic.onclick = () => Voice.start();
$('#stopListen').onclick = () => Voice.stop(false);
$('#asLang').onclick = async () => { await switchLanguage(); toast(t('as.lang_switched')); };
$('#aiBtn').onclick = () => AI.open();
$('#newChatBtn').onclick = async () => {
  try {
    const r = await api.post('/api/assistant/conversations');
    S.convId = r.conversation_id; store.set('convId', S.convId);
  } catch { S.convId = null; store.set('convId', null); }
  resetLog(); renderWelcome(); stopPolling(); toast(t('as.new_started'));
};
els.tts.onclick = toggleTts;

function toggleTts() {
  S.tts = !S.tts; store.set('tts', S.tts); updateTtsBtn();
  if (!S.tts && 'speechSynthesis' in window) speechSynthesis.cancel();
  toast(S.tts ? t('as.tts_on') : t('as.tts_off'));
}
function updateTtsBtn() {
  els.tts.innerHTML = icon(S.tts ? 'volume' : 'volumeOff');
  els.tts.classList.toggle('off', !S.tts);
}

function resetLog() {
  els.log.innerHTML = ''; els.quick.innerHTML = '';
  AS.cards.clear(); AS.actions.clear(); AS.seen.clear(); AS.lastId = 0; AS.draftEl = null; AS.replyLang = null;
}

function scrollLog() { requestAnimationFrame(() => { els.log.scrollTop = els.log.scrollHeight; }); }

function renderWelcome() {
  const first = (S.user.name || '').trim().split(' ')[0];
  const ex = EXAMPLES[lang()];
  const sugg = [['send', ex[0]], ['globe', ex[1]], ['receipt', ex[2]], ['calendar', ex[3]], ['wallet', ex[8]]];
  const notes = S.notifications.filter((n) => !n.read).slice(0, 3);
  const notesHtml = notes.length ? `<div class="welcome-notes"><small>${icon('bell')} ${esc(t('notes.you_have', { n: notes.length === 1 ? t('notes.one') : t('notes.many', { n: notes.length }) }))}</small>
    ${notes.map((n) => `<div class="wn"><span class="ri">${icon(NOTE_ICON[n.kind] || 'bell')}</span><span><b>${esc(n.title)}</b><small>${rich(n.body)}</small></span></div>`).join('')}</div>` : '';
  els.log.innerHTML = `<div class="welcome" id="welcome">
    <div class="orb">${icon('mic')}</div>
    <h3>${esc(t('as.hello', { name: first }))}</h3>
    ${notesHtml}
    <p>${t('as.hello_p')}</p>
    <div class="suggest">${sugg.map(([ic, x]) => `<button data-act="suggest" data-text="${esc(x)}">${icon(ic)}<span>${esc(x)}</span></button>`).join('')}</div>
  </div>`;
  const billQuick = notes.map(billerOf).filter(Boolean).map((b) => t('bills.say_pay', { b }));
  renderQuick([...new Set(billQuick)]);
}

async function restoreConversation() {
  AS.restored = true;
  resetLog();
  if (!S.convId) { renderWelcome(); return; }
  try {
    const c = await api.get(`/api/assistant/conversations/${encodeURIComponent(S.convId)}`);
    const msgs = c.messages.slice(-30);
    if (!msgs.length) { renderWelcome(); return; }
    msgs.forEach((m) => {
      AS.seen.add(m.id); AS.lastId = Math.max(AS.lastId, m.id);
      if (m.role === 'user') addUser(m.content, m.channel);
      else if (m.role === 'staff') addStaff(m.content);
      else if (m.role === 'assistant') {
        if (m.meta?.lang) AS.replyLang = m.meta.lang;
        addBot(m.content, { mode: m.meta?.mode, trace: m.meta?.tools, model: m.meta?.model, lang: m.meta?.lang });
        const ui = m.meta && m.meta.ui;
        if (ui && ui.type === 'receipt' && ui.action) inChatLang(() => addCard(receiptCardHtml(ui.action), ui.action.id, 'receipt'));
      }
    });
    if (c.pending) await loadChatData();
    if (c.pending) inChatLang(() => { addCard(confirmCardHtml(c.pending), c.pending.id, 'confirm'); renderQuick([t('confirm'), t('cancel')]); });
    if (c.status === 'handover') startPolling();
    scrollLog();
  } catch {
    S.convId = null; store.set('convId', null); renderWelcome();
  }
}

function removeWelcome() { $('#welcome')?.remove(); }

function addUser(text, channel = 'text') {
  const d = document.createElement('div');
  d.className = 'msg user';
  d.innerHTML = `<div class="bubble" dir="auto">${channel === 'voice' ? `<span class="voice-tag">${icon('mic')} ${t('as.voice_note')}</span>\n` : ''}<span class="t">${rich(text)}</span></div>`;
  els.log.appendChild(d); scrollLog();
  return d;
}

// "Show your work": what the assistant checked, where each fact came from, what the database confirmed.
function traceHtml(info) {
  const steps = (info && info.trace) || [];
  if (!steps.length && !(info && info.mode)) return '';
  const modeKey = `tr.mode.${info.mode}`;
  const items = steps.map((s) => {
    const name = t(`tr.tool.${s.name}`) !== `tr.tool.${s.name}` ? t(`tr.tool.${s.name}`) : s.name;
    const v = s.verified;
    return `<li><b>${esc(name)}</b>
      <span>${esc(t('tr.status', { s: s.status || '—' }))}${s.source ? ` • ${esc(t('tr.source', { s: s.source }))}` : ''}${s.at ? ` • ${esc(fmtDate(s.at))}` : ''}</span>
      ${v ? `<span class="${v.ok ? 'ok' : 'bad'}">${esc(t('tr.verified', { ref: v.reference || '', status: v.status || '', time: fmtDate(v.checked_at) }))}</span>` : ''}</li>`;
  }).join('');
  const mode = t(modeKey) !== modeKey ? t(modeKey) : (info.mode || '');
  return `<details class="trace"><summary>${icon('shield')} ${esc(t('tr.how'))}<span class="mode-pill">${esc(mode)}${info.model ? ` · ${esc(info.model)}` : ''}</span></summary>${items ? `<ol>${items}</ol>` : ''}</details>`;
}

function addBot(text, info = null) {
  if (!text) return null;
  const d = document.createElement('div');
  d.className = 'msg bot';
  const l = info?.lang || chatLang();
  d.innerHTML = `<div class="mini-av">${icon('sparkles')}</div><div class="bubble" dir="${dirOf(l)}" lang="${l}">${rich(text)}</div>`;
  els.log.appendChild(d);
  const tr = traceHtml(info);
  if (tr) { const x = document.createElement('div'); x.innerHTML = tr; els.log.appendChild(x.firstElementChild); }
  scrollLog();
  return d;
}
function addStaff(text) {
  const d = document.createElement('div');
  d.className = 'msg staff';
  d.innerHTML = `<div class="mini-av">${icon('headset')}</div><div class="bubble"><span class="who-tag">${t('as.staff')}</span>${rich(text)}</div>`;
  els.log.appendChild(d); scrollLog();
}
function addTyping() {
  const d = document.createElement('div');
  d.className = 'msg bot';
  d.innerHTML = `<div class="mini-av">${icon('sparkles')}</div><div class="bubble typing"><i></i><i></i><i></i></div>`;
  els.log.appendChild(d); scrollLog();
  return d;
}
function addCard(html, id, kind) {
  const d = document.createElement('div');
  d.className = 'msg-card';
  d.dataset.lang = chatLang(); d.dir = dirOf(d.dataset.lang);
  d.innerHTML = html;
  els.log.appendChild(d);
  if (id && kind === 'confirm') AS.cards.set(id, d);
  scrollLog();
  return d;
}

function markCard(id, kind, label = '') {
  const d = AS.cards.get(id); if (!d) return;
  const actions = d.querySelector('.actions'); if (!actions) return;
  actions.outerHTML = inChatLang(() => (kind === 'ok'
    ? `<div class="resolved ok">${esc(label || t('as.confirmed'))}</div>`
    : `<div class="resolved no">${kind === 'edit' ? t('as.edited') : t('as.cancelled')}</div>`), d.dataset.lang);
  d.querySelector('.voice-hint')?.remove();
  AS.cards.delete(id);
}

function renderQuick(list) {
  els.quick.innerHTML = (list || []).map((q) => {
    const cls = CONFIRM_WORDS.test(q) ? 'yes' : CANCEL_WORDS.test(q) ? 'no' : '';
    return `<button class="qr ${cls}" data-act="qr" data-text="${esc(q)}">${esc(q)}</button>`;
  }).join('');
}

/* ---------------------------------------------------------------- chat cards */
function fieldDisplay(svc, f, v) {
  // returns safe HTML
  if (f.type === 'money') return esc(fmtMoney(v, svc.currency));
  if (f.type === 'phone') {
    const c = S.contacts.find((x) => x.wallet === v);
    return c ? `${esc(c.name)} • ${val(fmtPhone(v))}` : val(fmtPhone(v));
  }
  if (f.type === 'choice') return esc(optLabel(f, v));
  return val(String(v));
}

function draftCardHtml(ui) {
  const svc = S.services[ui.service]; if (!svc) return '';
  const vals = ui.fields || {};
  const applies = (f) => !f.show_if || Object.entries(f.show_if).every(([k, v]) => vals[k] === v);
  const slots = svc.fields.filter((f) => applies(f) && !f.sensitive && (f.required || vals[f.key] !== undefined)).map((f) => {
    const v = vals[f.key];
    const done = v !== undefined && v !== null && v !== '';
    const wait = !done && ui.awaiting === f.key;
    return `<div class="slot ${done ? 'done' : wait ? 'wait' : ''}"><span class="sd">${done ? icon('check') : ''}</span>
      <span class="sl">${esc(f.label)}</span><span class="sv">${done ? fieldDisplay(svc, f, v) : wait ? t('as.waiting') : '—'}</span></div>`;
  }).join('');
  const secure = svc.fields.some((f) => f.sensitive && applies(f));
  return `<div class="ccard">
    <div class="ccard-head"><div class="si">${icon(svc.icon)}</div><div><b>${esc(svc.name)}</b><small>${t('as.preparing')}</small></div></div>
    <div class="ccard-body">${slots}
      ${secure ? `<div class="slot ${ui.secure_input ? 'wait' : ''}"><span class="sd">${icon('lock')}</span><span class="sl">${t('as.card_info')}</span><span class="sv">${t('as.card_secure')}</span></div>` : ''}
      ${ui.secure_input ? `<button class="btn primary block secure-btn" data-act="open-secure">${icon('lock')} ${t('as.open_secure')}</button>` : ''}
    </div></div>`;
}

function confirmCardHtml(a) {
  const lines = (a.lines || []).filter((l) => l.kind !== 'amount');
  return `<div class="ccard">
    <div class="ccard-head"><div class="si">${icon(S.services[a.service]?.icon || 'list')}</div><div><b>${esc(a.title)}</b><small>${t('as.ready')}</small></div></div>
    <div class="ccard-body">
      <div class="amount-big"><small>${t('rc.amount')}</small><b>${esc(a.amount_display)}</b></div>
      ${lines.map((l) => `<div class="kv"><span>${esc(l.label)}</span><b>${val(l.value)}</b></div>`).join('')}
      <div class="total"><span>${esc(a.total_label)}</span><b>${esc(a.total_display)}</b></div>
      ${(a.warnings || []).map((w) => `<div class="warn-line">${icon('alert')}<span>${esc(w)}</span></div>`).join('')}
    </div>
    <div class="actions">
      <button class="btn ok" data-act="confirm-tx" data-id="${a.id}">${icon('check')} ${t('confirm')}</button>
      <button class="btn ghost" data-act="cancel-tx" data-id="${a.id}">${t('cancel')}</button>
    </div>
    <div class="voice-hint" style="margin:-4px 0 12px">${icon('mic')}<span>${t('cf.say_confirm')}</span></div>
  </div>`;
}

function receiptCardHtml(a) {
  AS.actions.set(a.id, a);
  const r = a.result || {};
  return `<div class="ccard receipt-card">
    <div class="ccard-head"><div class="si">${icon('check')}</div><div><b>${esc(a.subtitle)}</b><small>${t('rc.done')}</small></div></div>
    <div class="ccard-body">
      <div class="amount-big"><b>${esc(a.amount_display)}</b></div>
      ${r.code ? codeBox(r.code_label, r.code) : ''}
      <div class="kv"><span>${t('rc.ref')}</span><b class="ltr">${esc(a.reference)}</b></div>
      <div class="kv"><span>${t('rc.current')}</span><b>${esc(a.balance_after_display)}</b></div>
      <button class="btn ghost block mt" style="height:44px" data-act="view-receipt" data-id="${a.id}">${t('rc.view')}</button>
    </div></div>`;
}

function timingText(tm) {
  if (!tm || !tm.frequency) return '';
  if (tm.frequency === 'daily') return t('freq.daily');
  if (tm.frequency === 'weekly') return tm.day != null && tm.day !== '' ? t('freq.every_dow', { d: WEEKDAYS[lang()][Number(tm.day)] }) : t('freq.weekly');
  if (tm.frequency === 'monthly') return tm.day ? (Number(tm.day) === 31 ? t('freq.end_month') : t('freq.dom', { n: tm.day })) : t('freq.monthly');
  return tm.date ? t('freq.once_on', { d: tm.date }) : t('freq.once');
}

function schedDraftCardHtml(ui) {
  const svc = ui.service ? S.services[ui.service] : null;
  const vals = ui.fields || {};
  const slot = (label, value, waiting) => `<div class="slot ${value ? 'done' : waiting ? 'wait' : ''}"><span class="sd">${value ? icon('check') : ''}</span>
    <span class="sl">${esc(label)}</span><span class="sv">${value ? val(value) : waiting ? t('as.waiting') : '—'}</span></div>`;
  let rows = '';
  if (svc) {
    const applies = (f) => !f.show_if || Object.entries(f.show_if).every(([k, v]) => vals[k] === v);
    rows = svc.fields.filter((f) => applies(f) && !f.sensitive && (f.required || vals[f.key] !== undefined)).map((f) => {
      const v = vals[f.key];
      if (f.key === 'amount' && v === undefined && ui.service === 'bill_payment' && ui.awaiting !== 'amount') return slot(f.label, t('sch.due_each'), false);
      const done = v !== undefined && v !== null && v !== '';
      return `<div class="slot ${done ? 'done' : ui.awaiting === f.key ? 'wait' : ''}"><span class="sd">${done ? icon('check') : ''}</span>
        <span class="sl">${esc(f.label)}</span><span class="sv">${done ? fieldDisplay(svc, f, v) : ui.awaiting === f.key ? t('as.waiting') : '—'}</span></div>`;
    }).join('');
  } else {
    rows = slot(t('sch.reminder'), '', ui.awaiting === 'note');
  }
  const tm = ui.timing || {};
  rows += slot(t('time.repeat'), tm.frequency ? timingText({ frequency: tm.frequency }) : '', ui.awaiting === 'frequency');
  if (tm.frequency === 'monthly' || tm.frequency === 'weekly') rows += slot(t('sch.day'), tm.day != null && tm.day !== '' ? timingText(tm) : '', ui.awaiting === 'day');
  if (tm.frequency === 'once') rows += slot(t('time.date'), tm.date || '', ui.awaiting === 'date');
  return `<div class="ccard">
    <div class="ccard-head"><div class="si">${icon('calendar')}</div><div><b>${esc(svc ? t('sch.of', { s: svc.name }) : t('sch.new_reminder'))}</b><small>${t('sch.prep')}</small></div></div>
    <div class="ccard-body">${rows}</div></div>`;
}

function confirmSchedCardHtml(s) {
  return `<div class="ccard">
    <div class="ccard-head"><div class="si">${icon(s.kind === 'reminder' ? 'bell' : 'calendar')}</div><div><b>${esc(s.title)}</b><small>${t('sch.ready')}</small></div></div>
    <div class="ccard-body">
      ${s.amount_display ? `<div class="amount-big"><small>${t('sch.each')}</small><b>${esc(s.amount_display)}</b></div>` : ''}
      ${(s.lines || []).filter((l) => l.kind !== 'amount').map((l) => `<div class="kv"><span>${esc(l.label)}</span><b>${val(l.value)}</b></div>`).join('')}
      <div class="total"><span>${t('sch.first_run')}</span><b>${esc(s.next_run_display)}</b></div>
    </div>
    <div class="actions">
      <button class="btn ok" data-act="sched" data-op="confirm" data-id="${s.id}">${icon('check')} ${t('sch.activate_short')}</button>
      <button class="btn ghost" data-act="sched" data-op="cancel" data-id="${s.id}">${t('cancel')}</button>
    </div>
    <div class="voice-hint" style="margin:-4px 0 12px">${icon('mic')}<span>${t('cf.say_confirm')}</span></div>
  </div>`;
}

function schedActiveCardHtml(s) {
  return `<div class="ccard receipt-card">
    <div class="ccard-head"><div class="si">${icon('calendar')}</div><div><b>${esc(s.title)}</b><small>${s.kind === 'reminder' ? t('sch.reminder_active') : t('sch.active')}</small></div></div>
    <div class="ccard-body">
      <div class="kv"><span>${t('time.repeat')}</span><b>${esc(s.timing)}</b></div>
      <div class="kv"><span>${t('sch.next_run')}</span><b>${esc(s.next_run_display)}</b></div>
      <button class="btn ghost block mt" style="height:44px" data-act="sched-list">${t('sch.mine')}</button>
    </div></div>`;
}

function infoCardHtml(screen) {
  if (screen === 'schedules') {
    return `<div class="ccard"><div class="ccard-head"><div class="si">${icon('calendar')}</div><div><b>${t('home.scheduled')}</b><small>${esc(t('sch.active_n', { n: S.schedules.length }))}</small></div></div>
      <div class="ccard-body">${S.schedules.length ? S.schedules.slice(0, 5).map((s) => `<div class="kv"><span>${esc(s.title)}${s.amount_display ? ` • ${esc(s.amount_display)}` : ''}</span><b>${esc(s.timing)}</b></div>`).join('') : `<div class="kv"><span>${t('sch.none_yet')}</span></div>`}</div></div>`;
  }
  if (screen === 'notifications') {
    const items = S.notifications.slice(0, 4);
    return `<div class="ccard"><div class="ccard-head"><div class="si">${icon('bell')}</div><div><b>${t('notes.title')}</b><small>${t('notes.latest')}</small></div></div>
      <div class="ccard-body">${items.length ? items.map((n) => `<div class="kv"><span>${esc(n.title)}</span></div>`).join('') : `<div class="kv"><span>${t('notes.none')}</span></div>`}</div></div>`;
  }
  if (screen === 'home') {
    return `<div class="ccard"><div class="ccard-head"><div class="si">${icon('wallet')}</div><div><b>${t('as.balance')}</b><small>${t('as.updated_now')}</small></div></div>
      <div class="ccard-body"><div class="amount-big"><b>${esc(fmtIQD(S.user.balance))}</b></div></div></div>`;
  }
  if (screen === 'transactions') {
    const items = S.txs.slice(0, 4);
    return `<div class="ccard"><div class="ccard-head"><div class="si">${icon('history')}</div><div><b>${t('home.recent')}</b><small>${esc(t('as.tx_n', { n: S.txs.length }))}</small></div></div>
      <div class="ccard-body">${items.length ? items.map((x) => `<div class="kv"><span>${esc(x.title)}</span><b>${x.direction === 'credit' ? '+' : '-'}${esc(fmtNum(x.total_iqd))}</b></div>`).join('') : `<div class="kv"><span>${t('as.no_tx')}</span></div>`}</div></div>`;
  }
  if (screen === 'bills') {
    return `<div class="ccard"><div class="ccard-head"><div class="si">${icon('receipt')}</div><div><b>${t('as.your_bills')}</b><small>${t('as.bills_sub')}</small></div></div>
      <div class="ccard-body">${S.bills.map((b) => `<div class="kv"><span>${esc(b.biller_label || b.biller)}</span><b>${b.status === 'due' ? esc(fmtIQD(b.amount_due)) : t('as.paid_ok')}</b></div>`).join('')}</div></div>`;
  }
  if (screen === 'contacts') {
    return `<div class="ccard"><div class="ccard-head"><div class="si">${icon('users')}</div><div><b>${t('contacts.title')}</b><small>${t('contacts.by_name')}</small></div></div>
      <div class="ccard-body">${S.contacts.map((c) => `<div class="kv"><span>${esc(c.name)} (${esc(c.relation)})</span><b>${val(fmtPhone(c.wallet))}</b></div>`).join('')}</div></div>`;
  }
  return '';
}

/* ---------------------------------------------------------------- send / receive */
async function sendToAssistant(text, channel = 'text', alternatives = null) {
  text = (text || '').trim();
  if (!text || AS.busy) return;
  if (!AS.open) openAssistant();
  removeWelcome();
  addUser(text, channel);
  els.input.value = ''; els.quick.innerHTML = '';
  AS.busy = true;
  const typing = addTyping();
  try {
    const body = { text, conversation_id: S.convId, channel };
    if (alternatives?.length) body.alternatives = alternatives;
    const res = await api.post('/api/assistant/message', body);
    typing.remove();
    await handleAssistantResponse(res);
  } catch (e) {
    typing.remove();
    addBot(e.message || t('as.unreachable'));
  } finally { AS.busy = false; }
}

async function handleAssistantResponse(res) {
  S.convId = res.conversation_id; store.set('convId', S.convId);
  if (res.message_id) {
    if (AS.seen.has(res.message_id)) return;
    AS.seen.add(res.message_id); AS.lastId = Math.max(AS.lastId, res.message_id);
  }
  const ui = res.ui;
  if (res.lang === 'en' || res.lang === 'ar') AS.replyLang = res.lang;
  setBalance(res.balance, ui?.type === 'receipt');
  addBot(res.reply, { mode: res.mode, trace: res.trace, model: res.model, lang: res.lang });
  if (ui?.type === 'screen' && ['transactions', 'bills', 'schedules', 'notifications'].includes(ui.screen)) await refreshWallet();
  if (ui) await loadChatData(ui.type === 'screen');
  if (ui) inChatLang(() => {
    if (ui.type === 'form') {
      AS.draftEl?.remove();
      AS.draftEl = addCard(draftCardHtml(ui), null, 'draft');
      if (ui.secure_input) AS.lastSecure = ui;
    } else if (ui.type === 'confirm') {
      AS.draftEl?.remove(); AS.draftEl = null;
      [...AS.cards.keys()].forEach((id) => { if (id !== ui.action.id) markCard(id, 'edit'); });
      if (!AS.cards.has(ui.action.id)) addCard(confirmCardHtml(ui.action), ui.action.id, 'confirm');
    } else if (ui.type === 'receipt') {
      AS.draftEl = null;
      markCard(ui.action.id, 'ok');
      addCard(receiptCardHtml(ui.action), ui.action.id, 'receipt');
    } else if (ui.type === 'home') {
      AS.draftEl?.remove(); AS.draftEl = null;
      [...AS.cards.keys()].forEach((id) => markCard(id, 'no'));
    } else if (ui.type === 'handover') {
      const fraud = ui.department === 'fraud';
      addCard(`<div class="ccard handover"><div class="ccard-head"><div class="si">${icon(fraud ? 'shield' : 'headset')}</div><div><b>${t(fraud ? 'as.handover_fraud_t' : 'as.handover_t')}</b><small>${t(fraud ? 'as.handover_fraud_s' : 'as.handover_s')}</small></div></div></div>`);
    } else if (ui.type === 'schedule_form') {
      AS.draftEl?.remove();
      AS.draftEl = addCard(schedDraftCardHtml(ui), null, 'draft');
    } else if (ui.type === 'confirm_schedule') {
      AS.draftEl?.remove(); AS.draftEl = null;
      const key = `s${ui.schedule.id}`;
      [...AS.cards.keys()].forEach((id) => { if (id !== key) markCard(id, 'edit'); });
      if (!AS.cards.has(key)) addCard(confirmSchedCardHtml(ui.schedule), key, 'confirm');
    } else if (ui.type === 'schedule_active') {
      AS.draftEl = null;
      markCard(`s${ui.schedule.id}`, 'ok', t('sch.activated_mark'));
      addCard(schedActiveCardHtml(ui.schedule));
      refreshWallet();
    } else if (ui.type === 'screen') {
      const html = infoCardHtml(ui.screen);
      if (html) addCard(html);
    }
  });
  renderQuick(res.quick_replies);
  syncMain(ui, res);
  if (AS.open && !isTouch && !Voice.active) els.input.focus({ preventScroll: true });
  if (ui?.type === 'receipt') refreshWallet();
  speak(res.reply, res.lang);
  if (res.conversation_status === 'handover') startPolling();
}

function syncMain(ui, res) {
  if (!ui) return;
  if (ui.type === 'form') {
    go('service', { key: ui.service, prefill: ui.fields, awaiting: ui.awaiting, fromAssistant: true, secure: ui.secure_input, convId: S.convId }, { reset: true });
  } else if (ui.type === 'confirm') {
    go('confirm', { action: ui.action, convId: S.convId }, { reset: true });
  } else if (ui.type === 'receipt') {
    const verified = (res.trace || []).map((x) => x.verified).find(Boolean);
    go('receipt', { action: ui.action, verified }, { reset: true });
  } else if (ui.type === 'home') {
    go('home', {}, { reset: true });
  } else if (ui.type === 'schedule_form') {
    if (ui.service) go('service', { key: ui.service, prefill: ui.fields, schedule: true, timing: ui.timing, fromAssistant: true, convId: S.convId }, { reset: true });
    else go('schedules', {}, { reset: true });
  } else if (ui.type === 'confirm_schedule') {
    go('confirm_schedule', { schedule: ui.schedule }, { reset: true });
  } else if (ui.type === 'schedule_active') {
    go('schedule_done', { schedule: ui.schedule }, { reset: true });
  } else if (ui.type === 'screen') {
    const map = { home: 'home', balance: 'home', transactions: 'transactions', bills: 'bills', contacts: 'contacts', providers: 'providers', services: 'home', schedules: 'schedules', notifications: 'notifications' };
    go(map[ui.screen] || 'home', {}, { reset: true });
  }
}

/* ---------------------------------------------------------------- handover polling */
function startPolling() {
  if (AS.poll) return;
  AS.poll = setInterval(async () => {
    if (!S.convId) return stopPolling();
    try {
      const c = await api.get(`/api/assistant/conversations/${encodeURIComponent(S.convId)}?after=${AS.lastId}`);
      c.messages.forEach((m) => {
        AS.lastId = Math.max(AS.lastId, m.id);
        if (AS.seen.has(m.id)) return;
        AS.seen.add(m.id);
        if (m.role === 'staff') { addStaff(m.content); speak(m.content); }
        else if (m.role === 'assistant' && m.meta?.mode === 'staff_resume') { addBot(m.content); speak(m.content); }
      });
      if (c.status !== 'handover') stopPolling();
    } catch { /* retry next tick */ }
  }, 4000);
}
function stopPolling() { clearInterval(AS.poll); AS.poll = null; }

/* =========================================================================
   Voice: speech-to-text (browser or server Whisper) + text-to-speech
   ========================================================================= */
const getSR = () => window.SpeechRecognition || window.webkitSpeechRecognition; // resolved lazily
const WHISPER = {
  openai: { url: 'https://api.openai.com/v1/audio/transcriptions', model: 'whisper-1' },
  groq: { url: 'https://api.groq.com/openai/v1/audio/transcriptions', model: 'whisper-large-v3' },
};
// Whisper reads this as "earlier text": the wallet words in both languages get spelled right
const STT_PROMPT = 'محادثة باللهجة العراقية أو بالإنكليزي مع محفظة: حوّل خمسة وعشرين ألف لعلي، شكد رصيدي، ادفع فاتورة الكهرباء، '
  + 'ويسترن يونيون، اشحن رصيد آسياسيل، أكّد، إلغاء. Send 25,000 to Ali, my balance, pay the bill, confirm, cancel.';
function whisperChoice() {
  const c = aiConfig();
  if (c.stt !== 'whisper-openai' && c.stt !== 'whisper-groq') return null;
  const p = c.stt === 'whisper-openai' ? 'openai' : 'groq';
  const key = c.stt_key || (c.provider === p ? c.key : '');
  return validKey(key) ? { ...WHISPER[p], key, provider: p } : null;
}

const Voice = {
  active: false, rec: null, media: null, stream: null, chunks: [], timer: null, maxTimer: null, cancelled: false,
  errored: false, audio: null,

  // NOT async on purpose: the browser's speech recognition must start inside the tap itself (no await before it),
  // otherwise some Chrome versions silently do nothing.
  start() {
    try {
      if (this.active) { this.stop(false); return; }
      if ('speechSynthesis' in window) speechSynthesis.cancel();
      if (!window.isSecureContext) { toast(t('as.voice_https'), true); return; }
      const canRecord = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
      const whisper = whisperChoice();
      if (whisper && canRecord) { this.startRecorder('whisper', whisper); return; }
      if (S.agent.stt_enabled && !STATIC && canRecord) { this.startRecorder('server'); return; }
      if (getSR()) { this.startBrowser(); return; }
      toast(t(canRecord ? 'as.voice_need_whisper' : 'as.voice_browser'), true);
    } catch (e) {
      this.active = false; this.ui(false);
      toast(`${t('as.mic_err')} (${(e && (e.name || e.message)) || 'error'})`, true);
    }
  },
  /** Something always shows: if the microphone does not start within a few seconds, say where to allow it. */
  watchdog(started) {
    clearTimeout(this.permTimer);
    this.permTimer = setTimeout(() => {
      if (this.active && !started()) els.listenInterim.textContent = t('as.perm_wait');
    }, 4000);
  },

  /** Ask for the microphone first: the browser shows its permission prompt and every failure gets a clear message. */
  async askMic() {
    if (!navigator.mediaDevices?.getUserMedia) return null;
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      const n = e && e.name;
      toast(t(n === 'NotAllowedError' || n === 'SecurityError' ? 'as.mic_denied' : n === 'NotFoundError' ? 'as.mic_none' : 'as.mic_err'), true);
      return false;
    }
  },

  startBrowser() {
    const SR = getSR();
    const r = new SR();
    r.lang = voiceLang(); r.interimResults = true; r.continuous = true; r.maxAlternatives = 4;
    let finalText = ''; let interimText = ''; const alts = [];
    const stopSoon = (ms) => { clearTimeout(this.timer); this.timer = setTimeout(() => { try { r.stop(); } catch { /* ended */ } }, ms); };
    r.onresult = (e) => {
      interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const res = e.results[i];
        const x = res[0].transcript;
        if (res.isFinal) {
          const before = finalText;
          finalText += x;
          // n-best: the backend picks the hypothesis that makes most sense for a wallet
          for (let k = 1; k < res.length; k += 1) alts[k - 1] = (alts[k - 1] ?? before) + res[k].transcript;
        } else interimText += x;
      }
      els.listenInterim.textContent = (finalText + interimText).trim();
      stopSoon(1800); // 1.8 s of silence after speech = done
    };
    let audioStarted = false;
    r.onaudiostart = () => { audioStarted = true; els.listenInterim.textContent = t('as.listening_hint'); };
    r.onerror = (e) => {
      this.errored = true;
      const map = { 'not-allowed': 'as.mic_denied', 'service-not-allowed': 'as.mic_denied', 'no-speech': 'as.no_speech',
        network: 'as.voice_net', 'audio-capture': 'as.mic_none', 'language-not-supported': 'as.voice_lang' };
      if (e.error !== 'aborted') toast(map[e.error] ? t(map[e.error]) : `${t('as.mic_err')} (${e.error})`, e.error !== 'no-speech');
    };
    r.onend = () => {
      clearTimeout(this.timer); clearTimeout(this.maxTimer); clearTimeout(this.permTimer);
      const txt = (finalText || interimText).trim();
      const { cancelled, errored } = this;
      this.active = false; this.rec = null; this.ui(false);
      if (txt && !cancelled) sendToAssistant(txt, 'voice', alts.map((a) => a.trim()).filter((a) => a && a !== txt).slice(0, 4));
      else if (!txt && !cancelled && !errored) toast(t('as.no_speech'));
    };
    this.rec = r; this.cancelled = false; this.errored = false; this.active = true;
    this.ui(true, t('as.listening_in'));
    els.listenInterim.textContent = t('as.mic_starting');
    try {
      r.start(); // inside the tap: the browser shows its microphone prompt now if needed
      this.watchdog(() => audioStarted);
      stopSoon(12000); // nothing said for 12 s (permission prompt included): stop
      this.maxTimer = setTimeout(() => { try { r.stop(); } catch { /* ended */ } }, 45000);
    } catch (e) {
      this.active = false; this.ui(false);
      toast(`${t('as.mic_err')} (${(e && (e.name || e.message)) || 'start'})`, true);
    }
  },

  async startRecorder(kind, whisper = null) {
    // show the bar at once, while the browser asks for the microphone
    this.active = true; this.cancelled = false;
    this.ui(true, t(kind === 'whisper' ? 'as.recording_whisper' : 'as.recording'));
    els.listenInterim.textContent = t('as.mic_starting');
    let granted = false;
    this.watchdog(() => granted);
    const stream = await this.askMic();
    granted = true; clearTimeout(this.permTimer);
    if (!stream || this.cancelled) {
      if (stream) stream.getTracks().forEach((x) => x.stop());
      this.active = false; this.ui(false);
      if (stream === null) toast(t('as.voice_browser'), true);
      return;
    }
    this.stream = stream;
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
    this.media = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    this.chunks = []; this.cancelled = false;
    this.media.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.media.onstop = () => {
      this.stream.getTracks().forEach((x) => x.stop());
      clearInterval(this.timer); this.closeAudio(); this.active = false; this.ui(false);
      if (this.cancelled || !this.chunks.length) return;
      const blob = new Blob(this.chunks, { type: this.media.mimeType || 'audio/webm' });
      if (kind === 'whisper') this.whisper(blob, whisper); else this.upload(blob);
    };
    this.media.start(250);
    this.active = true;
    const t0 = Date.now();
    this.ui(true, t(kind === 'whisper' ? 'as.recording_whisper' : 'as.recording'));
    els.listenInterim.textContent = t('as.listening_hint');
    this.timer = setInterval(() => {
      const sec = Math.floor((Date.now() - t0) / 1000);
      if (sec >= 1) els.listenInterim.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} · ${t('as.tap_stop')}`;
      if (sec >= 45) this.stop(false);
    }, 500);
    this.watchSilence(stream);
  },

  /** Stop recording by itself: 1.6 s of quiet after speech, or nothing said for 8 s (then nothing is sent). */
  watchSilence(stream) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(an);
      this.audio = ctx;
      const buf = new Uint8Array(an.fftSize);
      const start = performance.now();
      let spoke = false; let quietSince = start;
      const loop = () => {
        if (!this.active || this.media?.state !== 'recording') return;
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) { const d = (v - 128) / 128; sum += d * d; }
        const now = performance.now();
        if (Math.sqrt(sum / buf.length) > 0.035) { spoke = true; quietSince = now; }
        if (spoke && now - quietSince > 1600) { this.stop(false); return; }
        if (!spoke && now - start > 8000) { this.stop(true); toast(t('as.no_speech')); return; }
        setTimeout(loop, 100);
      };
      loop();
    } catch { /* the stop button still works */ }
  },
  closeAudio() { try { this.audio?.close(); } catch { /* closed */ } this.audio = null; },

  /** Whisper straight from the browser with the visitor's own OpenAI / Groq key: detects Arabic or English itself. */
  async whisper(blob, w) {
    if (!AS.open) openAssistant();
    removeWelcome();
    const typing = addTyping();
    AS.busy = true;
    let text = '';
    try {
      const fd = new FormData();
      fd.append('file', blob, `voice.${blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm'}`);
      fd.append('model', w.model); fd.append('response_format', 'json'); fd.append('temperature', '0'); fd.append('prompt', STT_PROMPT);
      const r = await fetch(w.url, { method: 'POST', headers: { Authorization: `Bearer ${w.key}` }, body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { toast(t('as.whisper_fail', { e: data?.error?.message || `HTTP ${r.status}` }), true); return; }
      text = (data.text || '').trim();
      if (!text) toast(t('as.no_speech'));
    } catch { toast(t('as.voice_send_fail'), true); } finally { typing.remove(); AS.busy = false; }
    if (text) await sendToAssistant(text, 'voice');
  },

  async upload(blob) {
    if (!AS.open) openAssistant();
    removeWelcome();
    const bubble = addUser(t('as.voice_note_pending'), 'voice');
    const typing = addTyping();
    AS.busy = true;
    try {
      const fd = new FormData();
      fd.append('audio', blob, `voice.${blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm'}`);
      if (S.convId) fd.append('conversation_id', S.convId);
      fd.append('lang', lang());
      const hdr = aiHeader();
      const r = await fetch(apiUrl('/api/assistant/voice'), { method: 'POST', body: fd, headers: { 'X-Lang': lang(), ...(hdr ? { 'X-LLM-Config': hdr } : {}) } });
      const res = await r.json().catch(() => ({}));
      typing.remove();
      if (!r.ok) { bubble.querySelector('.t').textContent = t('as.voice_sent_fail'); toast(res.detail || t('as.voice_fail'), true); return; }
      bubble.querySelector('.t').textContent = res.transcript || t('as.voice_empty');
      await handleAssistantResponse(res);
    } catch {
      typing.remove(); toast(t('as.voice_send_fail'), true);
    } finally { AS.busy = false; }
  },

  stop(cancel = false) {
    if (!this.active) return;
    this.cancelled = cancel;
    if (!this.rec && !(this.media && this.media.state !== 'inactive')) { // still waiting for the permission prompt
      this.cancelled = true; this.active = false; clearTimeout(this.permTimer); this.ui(false); return;
    }
    try {
      if (this.rec) { if (cancel) this.rec.abort(); else this.rec.stop(); }
      if (this.media && this.media.state !== 'inactive') this.media.stop();
    } catch { /* ignore */ }
  },

  ui(on, title = '') {
    els.listen.hidden = !on;
    els.mic.classList.toggle('live', on);
    if (on) { els.listenTitle.textContent = title; els.listenInterim.textContent = ''; }
  },
};

/* =========================================================================
   AI settings (in the app, no admin page, nothing on the server): the built-in agent, or any provider + model
   + the visitor's own key. Kept in this browser only and sent with each request (transport.js).
   ========================================================================= */
const AI = {
  draft: null,
  open() {
    const c = aiConfig();
    const opts = [
      ...(STATIC ? [] : [['', t('ai.opt_default')]]),
      ['offline', t('ai.opt_local')],
      ...PROVIDERS.map((p) => [p.id, p.label]),
    ];
    const current = c.provider || (STATIC ? 'offline' : '');
    $('#aiProvider').innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(l)}</option>`).join('');
    $('#aiModel').value = c.model || '';
    $('#aiBase').value = c.base_url || '';
    $('#aiKey').value = c.key || '';
    $('#aiKey').type = 'password';
    $('#aiStt').innerHTML = [['browser', 'ai.stt_browser'], ['whisper-openai', 'ai.stt_openai'], ['whisper-groq', 'ai.stt_groq']]
      .map(([v, k]) => `<option value="${v}" ${v === (c.stt || 'browser') ? 'selected' : ''}>${esc(t(k))}</option>`).join('');
    $('#aiSttKey').value = c.stt_key || '';
    this.status('');
    this.sync();
    $('#aiPanel').hidden = false;
  },
  close() { $('#aiPanel').hidden = true; },
  read() {
    return {
      provider: $('#aiProvider').value, model: $('#aiModel').value.trim(), base_url: $('#aiBase').value.trim(),
      key: $('#aiKey').value.trim(), stt: $('#aiStt').value, stt_key: $('#aiSttKey').value.trim(),
    };
  },
  sync() {
    const c = this.read();
    const p = providerInfo(c.provider);
    $('#aiModelF').hidden = !p; $('#aiKeyF').hidden = !p || (!p.key && p.id !== 'custom'); $('#aiBaseF').hidden = !p || !p.url;
    $('#aiModels').innerHTML = (p?.models || []).map((m) => `<option value="${esc(m)}">`).join('');
    $('#aiModel').placeholder = p?.models[0] || 'model-name';
    $('#aiBase').placeholder = c.provider === 'lmstudio' ? 'http://localhost:1234/v1' : 'http://localhost:11434/v1';
    const sttProvider = c.stt === 'whisper-openai' ? 'openai' : c.stt === 'whisper-groq' ? 'groq' : '';
    $('#aiSttKeyF').hidden = !sttProvider || c.provider === sttProvider; // same provider: its key is reused
    $('#aiLocalHint').hidden = c.provider !== 'ollama' && c.provider !== 'lmstudio';
  },
  problem(c) {
    const p = providerInfo(c.provider);
    if (p) {
      if (p.key && !validKey(c.key)) return t('ai.need_key');
      if (p.url && c.provider === 'custom' && (!/^https?:\/\/\S+$/.test(c.base_url) || !c.model)) return t('ai.need_url');
      if (c.base_url && !/^https?:\/\/\S+$/.test(c.base_url)) return t('ai.need_url');
    }
    if ((c.stt === 'whisper-openai' || c.stt === 'whisper-groq') && !(validKey(c.stt_key)
      || (c.provider === (c.stt === 'whisper-openai' ? 'openai' : 'groq') && validKey(c.key)))) return t('ai.need_stt_key');
    return '';
  },
  status(msg, kind = '') { const el = $('#aiStatus'); el.textContent = msg; el.className = `ai-status ${kind}`; },
  async test() {
    const c = this.read();
    const bad = this.problem(c);
    if (bad) { this.status(bad, 'bad'); return; }
    const btn = $('#aiTest'); busy(btn, true, t('ai.testing'));
    try {
      const hdr = aiHeader(c);
      const r = await api.req('POST', '/api/ai/test', {}, { 'X-LLM-Config': hdr || null });
      if (r.ok) this.status(t('ai.test_ok', { m: r.model === 'offline' ? t('ai.opt_local') : r.model, ms: r.latency_ms ?? 0 }), 'ok');
      else this.status(t('ai.test_fail', { e: r.error || '' }), 'bad');
    } catch (e) { this.status(e.message, 'bad'); } finally { busy(btn, false, t('ai.test')); }
  },
  async save() {
    const c = this.read();
    const bad = this.problem(c);
    if (bad) { this.status(bad, 'bad'); return; }
    const p = providerInfo(c.provider);
    setAiConfig({ ...c, model: p ? (c.model || p.models[0] || '') : '', key: p ? c.key : '', base_url: p?.url ? c.base_url : '' });
    try { await loadBootstrap(); } catch { /* the next message will tell */ }
    renderAll(false);
    this.close();
    toast(t('ai.saved', { m: S.agent.llm_enabled ? S.agent.model : t('more.offline') }));
  },
};
$('#aiClose').onclick = () => AI.close();
$('#aiProvider').onchange = () => { $('#aiModel').value = ''; AI.sync(); AI.status(''); };
$('#aiStt').onchange = () => AI.sync();
$('#aiTest').onclick = () => AI.test();
$('#aiSave').onclick = () => AI.save();
$('#aiKeyEye').onclick = () => { const k = $('#aiKey'); k.type = k.type === 'password' ? 'text' : 'password'; };

const TTS = { voices: [] };
function loadVoices() { if ('speechSynthesis' in window) TTS.voices = speechSynthesis.getVoices(); }
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
function speak(text, langCode = null) {
  if (!S.tts || !text || !('speechSynthesis' in window) || !AS.open) return;
  try {
    speechSynthesis.cancel();
    const english = langCode ? langCode === 'en' : (/[a-z]{3}/i.test(text) && !/[؀-ۿ]/.test(text));
    const voice = english ? TTS.voices.find((v) => /^en[-_]/i.test(v.lang))
      : (TTS.voices.find((v) => /^ar[-_]IQ/i.test(v.lang)) || TTS.voices.find((v) => /^ar/i.test(v.lang)));
    const u = new SpeechSynthesisUtterance(text.replace(/[«»]/g, ''));
    u.lang = voice?.lang || (english ? 'en-US' : 'ar-SA');
    if (voice) u.voice = voice;
    u.rate = 0.97;
    speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

boot();
