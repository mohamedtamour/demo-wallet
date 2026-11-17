// Admin dashboard: conversations (with the assistant's tool trace), human handover, transactions, schedules.
import { applyDir, isEn, lang, setLang } from './i18n.js?v=04bab6a77c';
import {
  PROVIDERS, STATIC, aiConfig, downloadJson, providerInfo, request, setAiConfig, validKey,
} from './transport.js?v=04bab6a77c';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtNum = (n) => Number(n || 0).toLocaleString('en-US');
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString(isEn() ? 'en-GB' : 'ar-IQ-u-nu-latn', { dateStyle: 'short', timeStyle: 'short' }) : '');

const D = {
  title: ['لوحة الإدارة', 'Admin dashboard'], subtitle: ['لوحة الإدارة • المحادثات والعمليات', 'Admin • conversations & transactions'],
  ping: ['فحص النموذج', 'Test the model'], pinging: ['جاري الفحص…', 'Testing…'], refresh: ['تحديث', 'Refresh'],
  export: ['تصدير المحادثات JSON', 'Export conversations (JSON)'], reset: ['إعادة ضبط البيانات', 'Reset demo data'],
  open_app: ['فتح التطبيق', 'Open the app'], tab_conv: ['المحادثات', 'Conversations'], tab_tx: ['العمليات', 'Transactions'],
  tab_sched: ['الجدولة والتذكيرات', 'Schedules & reminders'], tab_llm: ['نماذج الذكاء الاصطناعي', 'AI models'],
  llm_active: ['السلسلة المستخدمة هسه', 'Chain in use now'], llm_chain: ['اختيار النموذج', 'Choose the model'],
  llm_chain_hint: ['النموذج الأساسي يُجرَّب أولاً، وإذا فشل يُجرَّب الاحتياطي بالترتيب، وآخر شي الوكيل المحلي. التغيير يتطبق على الرسالة الجاية بدون إعادة تشغيل.', 'The primary model is tried first; if it fails the fallbacks are tried in order, and the offline agent last. Changes apply to the next message, no restart.'],
  llm_primary: ['المزوّد الأساسي', 'Primary provider'], llm_model: ['النموذج', 'Model'], llm_base: ['رابط الـ API (مخصص / محلي)', 'API URL (custom / local)'],
  llm_mode: ['وضع الوكيل', 'Agent mode'], mode_auto: ['تلقائي (نموذج لغوي إذا متوفر)', 'Auto (LLM when available)'],
  mode_llm_only: ['نموذج لغوي دائماً', 'Always the LLM'], mode_offline_only: ['محلي فقط (بدون نموذج)', 'Offline only (no LLM)'],
  llm_fallbacks: ['النماذج الاحتياطية (بالترتيب)', 'Fallback models (in order)'], llm_add_fb: ['+ إضافة احتياطي', '+ Add fallback'],
  llm_save_chain: ['حفظ وتطبيق', 'Save & apply'], llm_reset: ['رجوع لإعدادات ‎.env', 'Back to .env settings'],
  llm_reset_q: ['تمسح كل المفاتيح والإعدادات اللي انضافت من اللوحة؟', 'Remove every key and setting added from the dashboard?'],
  llm_paste: ['الصق المفتاح هنا', 'Paste the key here'], llm_test_save: ['فحص وحفظ', 'Test & save'], llm_save: ['حفظ', 'Save'],
  llm_remove: ['حذف', 'Remove'], llm_test: ['فحص', 'Test'], llm_no_key: ['ماكو مفتاح', 'No key'], llm_from_env: ['من ‎.env', 'from .env'],
  llm_from_dash: ['من اللوحة', 'from dashboard'], llm_saved: ['انحفظ ✓', 'Saved ✓'], llm_removed: ['انحذف', 'Removed'],
  llm_key_fail: ['المفتاح ما اشتغل، ما انحفظ: {e}', 'Key did not work, not saved: {e}'], llm_test_ok: ['يشتغل ✓ {m} ({ms} ms)', 'Works ✓ {m} ({ms} ms)'],
  llm_none: ['ماكو نموذج لغوي مفعّل — الوكيل المحلي يرد على كل الرسائل.', 'No LLM active — the offline agent answers every message.'],
  llm_offline_last: ['الوكيل المحلي', 'Offline agent'], llm_src_dash: ['الإعداد من اللوحة', 'Set from the dashboard'], llm_src_env: ['الإعداد من ‎.env', 'Set from .env'],
  llm_readonly: ['نسخة المتصفح ما تقبل مفاتيح API. شغّل الخادم حتى تضيفها.', 'The browser build cannot hold API keys. Run the server to add them.'],
  lk_title: ['رابط خاص للمقيّم', 'Private evaluator link'],
  lk_hint: ['اختار المزوّد والنموذج، الصق المفتاح (الأفضل مفتاح منفصل برصيد قليل)، واضغط «سوّي الرابط»، ودزه بخاص. اللي يفتحه يشتغل المساعد عنده بهذا النموذج فوراً، والمفتاح ينحفظ بمتصفحه هو بس. الرابط يتسوّى بهذا المتصفح وما ينحفظ بأي مكان. بعد التقييم امسح المفتاح من حساب المزوّد.', 'Pick the provider and model, paste the key (best: a separate key with a small balance), press «Create link» and send it privately. Whoever opens it gets the assistant on that model at once, and the key stays in their own browser. The link is built in this browser and stored nowhere. Delete the key in the provider account after the evaluation.'],
  lk_provider: ['المزوّد', 'Provider'], lk_key: ['مفتاح الـ API', 'API key'], lk_ph: ['الصق المفتاح هنا', 'Paste the key here'],
  lk_on: ['هذا المتصفح يستخدم: {m}', 'This browser uses: {m}'], lk_off: ['هذا المتصفح يستخدم الإعداد الافتراضي', 'This browser uses the default setting'],
  lk_local: ['هذا المتصفح يستخدم الوكيل المحلي', 'This browser uses the built-in agent'],
  llm_default: ['الافتراضي', 'default'], llm_primary_tag: ['أساسي', 'primary'],
  lk_make: ['سوّي الرابط', 'Create link'],
  lk_use: ['استخدمه بهذا المتصفح', 'Use in this browser'], lk_forget: ['مسح من هذا المتصفح', 'Remove from this browser'],
  lk_copy: ['نسخ', 'Copy'], lk_copied: ['انسخ ✓ — دزه بخاص فقط', 'Copied ✓ — share it privately only'],
  lk_bad: ['المفتاح مو صحيح', 'That key does not look right'], llm_local: ['نموذج محلي (بدون إنترنت وبدون مفتاح)', 'Local model (no internet, no key)'],
  llm_local_hint: ['شغّل Ollama أو LM Studio أو vLLM أو llama.cpp على هذا الجهاز (أو جهاز بالشبكة)، واضغط «بحث». تكدر تخليه أساسي، أو احتياطي يشتغل إذا الإنترنت انقطع. النماذج الصغيرة أضعف بالعربي العراقي — مثلاً qwen2.5:14b أحسن من 7b.', 'Run Ollama, LM Studio, vLLM or llama.cpp on this machine (or one on your network) and press «Find». Use it as the primary model, or as a fallback for when the internet is down. Small models are weaker in Iraqi Arabic — e.g. qwen2.5:14b beats 7b.'],
  llm_discover: ['بحث عن نماذج محلية', 'Find local models'], llm_local_check: ['عرض النماذج', 'List models'],
  llm_local_save: ['حفظ الرابط', 'Save URL'], llm_use_primary: ['اجعله أساسي', 'Use as primary'], llm_use_fb: ['أضفه احتياطي', 'Add as fallback'],
  llm_not_running: ['مو شغّال', 'not running'], llm_running: ['شغّال', 'running'], llm_no_models: ['ماكو نماذج منزّلة (مثلاً: ollama pull qwen2.5:7b)', 'No models installed (e.g. ollama pull qwen2.5:7b)'],
  llm_none_found: ['ما لكيت أي خادم محلي على المنافذ الافتراضية (11434، 1234، 8000، 8080).', 'No local server found on the default ports (11434, 1234, 8000, 8080).'],
  llm_set_hint: ['انحط بالنموذج — اضغط «حفظ وتطبيق»', 'Filled in — press «Save & apply»'], all: ['الكل', 'All'], waiting_staff: ['بانتظار موظف', 'Waiting for staff'],
  pick: ['اختار محادثة حتى تشوف تفاصيلها', 'Pick a conversation to see the details'],
  th_ref: ['رقم العملية', 'Reference'], th_service: ['الخدمة', 'Service'], th_details: ['التفاصيل', 'Details'],
  th_amount: ['المبلغ', 'Amount'], th_total: ['المجموع (د.ع)', 'Total (IQD)'], th_source: ['المصدر', 'Source'],
  th_status: ['الحالة', 'Status'], th_date: ['التاريخ', 'Date'], th_kind: ['النوع', 'Type'], th_title: ['العنوان', 'Title'],
  th_repeat: ['التكرار', 'Repeats'], th_next: ['المرة الجاية', 'Next run'], th_runs: ['مرات التنفيذ', 'Runs'], th_last: ['آخر نتيجة', 'Last result'],
  sched_bar: ['المجدول يشتغل تلقائياً كل 30 ثانية وينفّذ الدفعات بموعدها (9 الصبح بتوقيت بغداد).', 'The scheduler runs every 30 seconds and executes payments on time (9 AM Baghdad).'],
  run_sched: ['تشغيل المجدول الآن', 'Run the scheduler now'],
  s_conv: ['المحادثات', 'Conversations'], s_msgs: ['الرسائل', 'Messages'], s_voice: ['الرسائل الصوتية', 'Voice messages'],
  s_done: ['العمليات المكتملة', 'Completed transactions'], s_ai: ['عمليات عن طريق المساعد', 'Via the assistant'],
  s_volume: ['حجم العمليات (د.ع)', 'Volume (IQD)'], s_sched: ['جدولات فعّالة', 'Active schedules'], s_wait: ['بانتظار موظف', 'Waiting for staff'],
  s_p50: ['زمن الرد (الوسيط)', 'Response time (median)'], s_cost: ['كلفة النموذج ($)', 'Model cost ($)'],
  offline: ['الوكيل المحلي (بدون مفتاح)', 'Offline agent (no key)'], no_conv: ['ماكو محادثات بعد', 'No conversations yet'],
  untitled: ['محادثة بدون عنوان', 'Untitled conversation'], active: ['نشطة', 'Active'], msgs_n: ['{n} رسالة', '{n} messages'],
  txs_n: ['{n} عملية', '{n} transactions'], conv: ['محادثة', 'Conversation'], no_msgs: ['ماكو رسائل', 'No messages'],
  handover_bar: ['العميل طلب موظف خدمة العملاء — المساعد الآلي متوقف لهذه المحادثة.', 'The customer asked for a human — the assistant is paused for this conversation.'],
  handover_bar_fraud: ['⚠ بلاغ احتيال — المحادثة محوّلة لقسم مكافحة الاحتيال، والمساعد متوقف.', '⚠ Fraud report — routed to the fraud team; the assistant is paused.'],
  dept_fraud: ['قسم الاحتيال', 'Fraud team'], dept_customer_care: ['خدمة العملاء', 'Customer care'],
  mode_fast: ['مسار سريع', 'Fast path'], mode_router: ['توجيه لقسم', 'Routed'], mode_context: ['من السياق', 'Context'],
  resume: ['استئناف المساعد الآلي', 'Resume the assistant'], resumed: ['تم استئناف المساعد', 'Assistant resumed'],
  conv_txs: ['عمليات هذه المحادثة', 'Transactions in this conversation'], reply_ph: ['اكتب رد كموظف خدمة العملاء…', 'Reply as customer service…'],
  send: ['إرسال', 'Send'], sent: ['تم إرسال الرد للعميل', 'Reply sent'], no_tx: ['ماكو عمليات بعد', 'No transactions yet'],
  no_sched: ['ماكو جدولات بعد', 'No schedules yet'], reminder: ['تذكير', 'Reminder'], reset_q: ['راح تنمسح كل المحادثات والعمليات ويرجع الرصيد لوضعه الأصلي. متأكد؟', 'All conversations and transactions are deleted and the balance is restored. Continue?'],
  reset_done: ['تمت إعادة الضبط', 'Reset done'], sched_done: ['تم: نفّذ {e} دفعة، و{r} تذكير جديد', 'Done: {e} payments run, {r} new reminders'],
  ping_ok: ['النموذج يشتغل ✓ ({m})', 'Model works ✓ ({m})'], token_q: ['أدخل رمز الإدارة (ADMIN_TOKEN):', 'Enter the admin token (ADMIN_TOKEN):'],
  checked: ['تحقق', 'checked'],
  role_user: ['المستخدم', 'User'], role_assistant: ['المساعد', 'Assistant'], role_staff: ['الموظف', 'Staff'], role_event: ['حدث', 'Event'],
  src_assistant: ['المساعد', 'Assistant'], src_scheduled: ['مجدولة', 'Scheduled'], src_manual: ['الشاشة', 'Screen'],
  last_done: ['تم ✓', 'Done ✓'], last_failed: ['فشل', 'Failed'], last_skipped: ['ماكو مستحق', 'Nothing due'],
  mode_llm: ['نموذج لغوي', 'LLM'], mode_offline: ['محلي', 'Offline'], mode_offline_fallback: ['محلي (احتياطي)', 'Offline (fallback)'],
  mode_rule: ['قاعدة تأكيد', 'Confirm rule'], mode_handover: ['تحويل بشري', 'Handover'], mode_ui: ['من الشاشة', 'Screen'],
  mode_staff_resume: ['استئناف', 'Resume'], mode_safety: ['فحص أمان', 'Safety gate'],
  lang: ['English', 'عربي'],
};
const t = (k, vars) => {
  let s = (D[k] || [k, k])[isEn() ? 1 : 0];
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, x) => (vars[x] ?? ''));
  return s;
};

let token = localStorage.getItem('adminToken') || '';
let selected = null;
let filter = '';
let lastDetailSig = '';

function toast(msg) { const x = $('#toast'); x.textContent = msg; x.classList.add('show'); setTimeout(() => x.classList.remove('show'), 2600); }
const authHeaders = () => (token ? { 'X-Admin-Token': token } : {});

async function api(method, url, body) {
  const r = await request(method, url, body, authHeaders());
  if (r.status === 401) {
    const x = window.prompt(t('token_q'));
    if (x) { token = x; localStorage.setItem('adminToken', x); return api(method, url, body); }
    throw new Error('unauthorized');
  }
  if (!r.ok) throw new Error((r.data && r.data.detail) || `HTTP ${r.status}`);
  return r.data;
}

function translateStatic() {
  applyDir();
  $$('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  $$('[data-t-ph]').forEach((el) => { el.placeholder = t(el.dataset.tPh); });
  document.title = `${t('title')} — Pay Transfer Agent`;
}

async function loadStats() {
  const s = await api('GET', '/api/admin/stats');
  const items = [
    [t('s_conv'), s.conversations], [t('s_msgs'), s.messages], [t('s_voice'), s.voice_messages],
    [t('s_done'), s.transactions_completed], [t('s_ai'), s.assistant_transactions],
    [t('s_volume'), fmtNum(s.volume_iqd)], [t('s_sched'), s.active_schedules],
    [t('s_p50'), s.latency_p50_ms != null ? `${s.latency_p50_ms} ms` : '—'], [t('s_cost'), s.llm_cost_usd || 0],
    [t('s_wait'), s.handover_open, s.handover_open > 0],
  ];
  $('#stats').innerHTML = items.map(([l, v, hl]) => `<div class="stat ${hl ? 'hl' : ''}"><small>${esc(l)}</small><b>${esc(v)}</b></div>`).join('');
  const llm = s.agent.llm_enabled;
  $('#agentPill').innerHTML = `<span class="dot ${llm ? 'on' : 'off'}"></span> ${llm ? esc(s.agent.model) : esc(t('offline'))}`;
}

async function loadConversations() {
  const data = await api('GET', `/api/admin/conversations${filter ? `?status=${filter}` : ''}`);
  const box = $('#convItems');
  if (!data.items.length) { box.innerHTML = `<div class="empty">${esc(t('no_conv'))}</div>`; return; }
  box.innerHTML = data.items.map((c) => `
    <div class="ci ${c.id === selected ? 'on' : ''}" data-id="${esc(c.id)}">
      <div class="t"><span>${esc(c.title || t('untitled'))}</span><span class="badge ${c.status}">${esc(c.status === 'handover' ? (c.department ? t(`dept_${c.department}`) : t('waiting_staff')) : t('active'))}</span></div>
      <small>${esc(c.last_role ? `${t(`role_${c.last_role}`)}: ` : '')}${esc(c.last_message)}</small>
      <div class="meta"><span>${esc(t('msgs_n', { n: c.messages }))}</span><span>${esc(t('txs_n', { n: c.transactions }))}</span><span>${esc(fmtDate(c.updated_at))}</span></div>
    </div>`).join('');
}

function toolHtml(x) {
  const v = x.verified;
  const extra = [x.source, x.at].filter(Boolean).join(' • ');
  return `<code title="${esc(extra)}">${esc(x.name)} → ${esc(x.status)}${v ? ` • ${esc(t('checked'))} ${esc(v.reference || '')}=${esc(v.status || '')}` : ''}</code>`;
}

async function loadDetail(force = false) {
  if (!selected) return;
  const c = await api('GET', `/api/admin/conversations/${encodeURIComponent(selected)}`);
  const sig = `${c.status}|${c.messages.length}|${c.transactions.map((x) => x.status).join(',')}|${lang()}`;
  if (!force && sig === lastDetailSig) return;
  lastDetailSig = sig;
  const draftVal = $('#staffInput')?.value || '';
  const msgs = c.messages.map((m) => {
    const meta = m.meta || {};
    const head = [`<b>${esc(t(`role_${m.role}`))}</b>`, `<span>${esc(fmtDate(m.created_at))}</span>`];
    if (m.channel === 'voice') head.push('<span class="chip">voice</span>');
    if (meta.mode) head.push(`<span class="chip ${meta.mode.startsWith('offline') ? 'offline' : meta.mode}">${esc(t(`mode_${meta.mode}`))}</span>`);
    if (meta.latency_ms) head.push(`<span class="chip">${meta.latency_ms}ms</span>`);
    if (meta.model) head.push(`<span class="chip">${esc(meta.model)}</span>`);
    if (meta.usage) head.push(`<span class="chip">${meta.usage.prompt_tokens || 0}+${meta.usage.completion_tokens || 0} tok</span>`);
    const tools = (meta.tools || []).map(toolHtml).join('');
    const audio = meta.audio ? `<audio controls preload="none" src="/api/admin/audio/${encodeURIComponent(meta.audio)}${token ? `?token=${encodeURIComponent(token)}` : ''}"></audio>` : '';
    if (m.role === 'event') return `<div class="m event">— ${esc(m.content)} —</div>`;
    return `<div class="m ${m.role}"><div class="h">${head.join('')}</div><div class="b">${esc(m.content)}</div>${audio}${tools ? `<div class="tools">${tools}</div>` : ''}</div>`;
  }).join('');
  const txs = c.transactions.map((x) => `<div class="r"><span>${esc(x.reference)} • ${esc(x.subtitle)}</span><span>${esc(x.total_display)} <span class="badge ${x.status}">${esc(x.status_label)}</span></span></div>`).join('');
  $('#convDetail').innerHTML = `
    <div class="cd-head"><div><h3>${esc(c.title || t('conv'))}</h3><small>${esc(c.id)}</small></div>
      <div style="display:flex;gap:8px;align-items:center"><button class="btn ghost" id="convJson">JSON</button><span class="badge ${c.status}">${esc(c.status === 'handover' ? t('waiting_staff') : t('active'))}</span></div></div>
    ${c.status === 'handover' ? `<div class="handover-bar"><span>${esc(t(c.department === 'fraud' ? 'handover_bar_fraud' : 'handover_bar'))}</span><button class="btn ok" id="resumeBtn">${esc(t('resume'))}</button></div>` : ''}
    <div class="timeline" id="timeline">${msgs || `<div class="empty">${esc(t('no_msgs'))}</div>`}</div>
    ${txs ? `<div class="txs"><h4>${esc(t('conv_txs'))}</h4>${txs}</div>` : ''}
    <form class="reply" id="replyForm"><input id="staffInput" placeholder="${esc(t('reply_ph'))}" maxlength="1000"><button class="btn primary">${esc(t('send'))}</button></form>`;
  $('#staffInput').value = draftVal;
  const tl = $('#timeline'); tl.scrollTop = tl.scrollHeight;
  $('#convJson').onclick = () => download(`/api/admin/conversations/${encodeURIComponent(selected)}/export.json`, `conversation-${selected}.json`);
  $('#resumeBtn')?.addEventListener('click', async () => { await api('POST', `/api/admin/conversations/${encodeURIComponent(selected)}/resume`); toast(t('resumed')); refreshAll(true); });
  $('#replyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#staffInput').value.trim(); if (!text) return;
    await api('POST', `/api/admin/conversations/${encodeURIComponent(selected)}/reply`, { text });
    $('#staffInput').value = ''; toast(t('sent')); loadDetail(true);
  });
}

async function loadTransactions() {
  const data = await api('GET', '/api/admin/transactions');
  $('#txRows').innerHTML = data.items.map((x) => `<tr>
    <td class="ltr">${esc(x.reference)}</td><td>${esc(x.service_name)}</td><td>${esc(x.subtitle)}</td>
    <td class="ltr">${esc(x.amount_display)}</td><td class="ltr">${fmtNum(x.total_iqd)}</td>
    <td>${esc(t(`src_${x.source}`))}</td><td><span class="badge ${x.status}">${esc(x.status_label)}</span></td>
    <td>${esc(fmtDate(x.created_at))}</td></tr>`).join('') || `<tr><td colspan="8" class="empty">${esc(t('no_tx'))}</td></tr>`;
}

async function loadSchedules() {
  const data = await api('GET', '/api/admin/schedules');
  $('#schedRows').innerHTML = data.items.map((s) => `<tr>
    <td>${s.id}</td><td>${s.kind === 'reminder' ? esc(t('reminder')) : esc(s.service_name)}</td><td>${esc(s.title)}</td>
    <td>${esc(s.amount_display || '—')}</td><td>${esc(s.timing)}</td><td>${esc(s.next_run_display)}</td>
    <td>${s.runs}</td><td>${esc(s.last_status ? t(`last_${s.last_status}`) : '—')}</td><td><span class="badge ${s.status}">${esc(s.status_label)}</span></td></tr>`).join('')
    || `<tr><td colspan="9" class="empty">${esc(t('no_sched'))}</td></tr>`;
}

async function refreshAll(force = false) {
  try {
    await Promise.all([loadStats(), loadConversations(), $('#txTab').hidden ? null : loadTransactions(),
      $('#schedTab').hidden ? null : loadSchedules()]);
    await loadDetail(force);
  } catch (e) { if (e.message !== 'unauthorized') console.error(e); }
}

$('#convItems').addEventListener('click', (e) => {
  const it = e.target.closest('.ci'); if (!it) return;
  selected = it.dataset.id; lastDetailSig = '';
  $$('.ci').forEach((x) => x.classList.toggle('on', x === it));
  loadDetail(true);
});
$$('.filter button').forEach((b) => b.addEventListener('click', () => {
  filter = b.dataset.filter; $$('.filter button').forEach((x) => x.classList.toggle('on', x === b)); loadConversations();
}));
$$('.tabs .tab').forEach((b) => b.addEventListener('click', () => {
  $$('.tabs .tab').forEach((x) => x.classList.toggle('on', x === b));
  $('#convTab').hidden = b.dataset.tab !== 'conv';
  $('#txTab').hidden = b.dataset.tab !== 'tx';
  $('#schedTab').hidden = b.dataset.tab !== 'sched';
  if (b.dataset.tab === 'tx') loadTransactions();
  if (b.dataset.tab === 'sched') loadSchedules();
  $('#llmTab').hidden = b.dataset.tab !== 'llm';
  if (b.dataset.tab === 'llm') { lkState(); if (!STATIC) loadLlm(); }
}));
$('#runSchedBtn').onclick = async () => {
  const r = await api('POST', '/api/admin/scheduler/run');
  toast(t('sched_done', { e: r.executed, r: r.reminders })); refreshAll(true);
};
$('#refreshBtn').onclick = () => refreshAll(true);
$('#langBtn').onclick = () => { setLang(isEn() ? 'ar' : 'en'); translateStatic(); lastDetailSig = ''; refreshAll(true); };
function download(url, filename) {
  downloadJson(url, filename, authHeaders()).catch((e) => toast(e.message));
}
$('#exportBtn').onclick = () => download('/api/admin/export/conversations.json',
  `conversations-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`);
$('#resetBtn').onclick = async () => {
  if (!window.confirm(t('reset_q'))) return;
  await api('POST', '/api/admin/demo/reset'); selected = null; $('#convDetail').innerHTML = `<div class="empty">${esc(t('pick'))}</div>`;
  try { localStorage.removeItem('boot:ar'); localStorage.removeItem('boot:en'); } catch { /* ignore */ }
  toast(t('reset_done')); refreshAll(true);
};
$('#pingBtn').onclick = async () => {
  $('#pingBtn').textContent = t('pinging');
  try {
    const r = await api('GET', '/api/admin/llm/ping');
    toast(r.ok ? t('ping_ok', { m: r.model }) : r.error);
  } catch (e) { toast(e.message); } finally { $('#pingBtn').textContent = t('ping'); }
};

/* =========================================================================
   AI models & API keys (any provider: DeepSeek, OpenAI / ChatGPT, Claude, Gemini, Groq, local, custom).
   Keys go to the server once and are only ever shown masked.
   ========================================================================= */
let LLM = null;
const LOCAL_URL = ['custom', 'ollama', 'lmstudio', 'vllm', 'llamacpp'];
const prov = (id) => (LLM?.providers || []).find((p) => p.id === id) || { models: [] };
const providerOpts = (sel, withCustom = true) => LLM.providers
  .filter((p) => withCustom || p.id !== 'custom')
  .map((p) => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.label)}${p.needs_key && !p.key_set ? ` — ${esc(t('llm_no_key'))}` : ''}</option>`).join('');

async function loadLlm() {
  try { LLM = await api('GET', '/api/admin/llm'); } catch (e) { toast(e.message); return; }
  renderLlm();
}

function renderLlm() {
  const s = LLM;
  $('#llmSource').textContent = t(s.chain_source === 'dashboard' ? 'llm_src_dash' : 'llm_src_env');
  const health = Object.fromEntries((s.health || []).map((h) => [h.model, h]));
  const nodes = s.primary && s.llm_enabled ? [`${s.primary.provider}:${s.primary.model}`, ...s.fallbacks] : [];
  $('#llmChainView').innerHTML = nodes.length
    ? `<div class="chain">${nodes.map((m, i) => {
      const h = health[m];
      return `<div class="node"><span class="dot ${esc(h ? h.state : '')}"></span><b>${esc(m)}</b><small>${esc(i ? `#${i}` : t('llm_primary_tag'))}${h && h.last_latency_ms ? ` · ${h.last_latency_ms} ms` : ''}</small></div><span class="arrow">→</span>`;
    }).join('')}<div class="node"><span class="dot on"></span><b>${esc(t('llm_offline_last'))}</b></div></div>`
    : `<p class="llm-hint">${esc(t('llm_none'))}</p>`;

  const p = s.primary || { provider: 'deepseek', model: '', base_url: '' };
  $('#llmPrimary').innerHTML = providerOpts(p.provider);
  $('#llmModel').value = s.primary ? p.model : '';
  $('#llmBase').value = LOCAL_URL.includes(p.provider) ? (p.base_url || '') : '';
  $('#llmMode').innerHTML = [['auto', 'mode_auto'], ['llm', 'mode_llm_only'], ['offline', 'mode_offline_only']]
    .map(([v, k]) => `<option value="${v}" ${s.agent_mode === v ? 'selected' : ''}>${esc(t(k))}</option>`).join('');
  syncPrimary();
  $('#llmFbRows').innerHTML = '';
  s.fallbacks.forEach((f) => { const i = f.indexOf(':'); addFbRow(f.slice(0, i), f.slice(i + 1)); });

  ['#llmSaveChain', '#llmReset', '#llmAddFb', '#llmDiscover', '#llmLocalCheck', '#llmLocalSave']
    .forEach((q) => { $(q).disabled = !s.editable; });
  const locals = s.providers.filter((x) => x.local);
  const cur = $('#llmLocalProv').value || 'ollama';
  $('#llmLocalProv').innerHTML = locals.map((x) => `<option value="${esc(x.id)}" ${x.id === cur ? 'selected' : ''}>${esc(x.label)}</option>`).join('');
  syncLocalUrl();
}

function syncLocalUrl() {
  const p = prov($('#llmLocalProv').value);
  $('#llmLocalUrl').value = p.base_url || '';
  $('#llmLocalUrl').placeholder = p.default_base_url || 'http://localhost:11434/v1';
}

function syncPrimary() {
  const id = $('#llmPrimary').value;
  $('#llmModelList').innerHTML = prov(id).models.map((m) => `<option value="${esc(m)}">`).join('');
  $('#llmModel').placeholder = prov(id).models[0] || 'model-name';
  $('#llmBaseWrap').hidden = !LOCAL_URL.includes(id);
  if (prov(id).local) {  // show the models actually installed on the local server
    if (!$('#llmBase').value) $('#llmBase').placeholder = prov(id).base_url || '';
    api('POST', '/api/admin/llm/local/models', { provider: id, base_url: $('#llmBase').value.trim() })
      .then((r) => { if (r.ok && r.models.length && $('#llmPrimary').value === id) $('#llmModelList').innerHTML = r.models.map((m) => `<option value="${esc(m)}">`).join(''); })
      .catch(() => {});
  }
}

/* ---- local models (Ollama, LM Studio, vLLM, llama.cpp) */
function localServerHtml(srv) {
  const models = srv.models.length
    ? srv.models.map((m) => `<div class="lm"><code>${esc(m)}</code>
        <button class="btn primary sm" data-use="primary" data-p="${esc(srv.provider)}" data-m="${esc(m)}" data-u="${esc(srv.base_url)}">${esc(t('llm_use_primary'))}</button>
        <button class="btn ghost sm" data-use="fallback" data-p="${esc(srv.provider)}" data-m="${esc(m)}" data-u="${esc(srv.base_url)}">${esc(t('llm_use_fb'))}</button></div>`).join('')
    : (srv.running ? `<small class="llm-hint">${esc(t('llm_no_models'))}</small>` : '');
  return `<div class="local-srv ${srv.running ? '' : 'off'}">
    <div class="top-line"><span class="dot ${srv.running ? 'healthy' : ''}"></span><b>${esc(srv.label || prov(srv.provider).label)}</b>
      <span class="url">${esc(srv.base_url)}</span><small>${esc(t(srv.running ? 'llm_running' : 'llm_not_running'))}</small></div>
    ${srv.running ? `<div class="local-models">${models}</div>` : ''}</div>`;
}

$('#llmDiscover').onclick = async () => {
  const b = $('#llmDiscover'); const label = b.textContent; b.disabled = true; b.textContent = t('pinging');
  try {
    const { servers } = await api('POST', '/api/admin/llm/local/discover');
    const running = servers.filter((x) => x.running);
    $('#llmLocalFound').innerHTML = running.length ? running.map(localServerHtml).join('')
      : `<p class="llm-hint">${esc(t('llm_none_found'))}</p>`;
  } catch (e) { toast(e.message); } finally { b.disabled = false; b.textContent = label; }
};
$('#llmLocalProv').onchange = syncLocalUrl;
$('#llmLocalCheck').onclick = async () => {
  const provider = $('#llmLocalProv').value;
  try {
    const r = await api('POST', '/api/admin/llm/local/models', { provider, base_url: $('#llmLocalUrl').value.trim() });
    $('#llmLocalFound').innerHTML = localServerHtml({ provider, base_url: r.base_url, running: r.ok, models: r.models });
    if (!r.ok) toast(r.error);
  } catch (e) { toast(e.message); }
};
$('#llmLocalSave').onclick = async () => {
  try {
    LLM = (await api('POST', '/api/admin/llm/local/url', { provider: $('#llmLocalProv').value, base_url: $('#llmLocalUrl').value.trim() })).state;
    renderLlm(); toast(t('llm_saved'));
  } catch (e) { toast(e.message); }
};
$('#llmLocalFound').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-use]'); if (!b) return;
  const { p: provider, m: model, u: url } = b.dataset;
  try {  // remember where this server runs, so it also works as a fallback
    if (url && url !== prov(provider).base_url) {
      LLM = (await api('POST', '/api/admin/llm/local/url', { provider, base_url: url })).state;
      renderLlm();
    }
  } catch (err) { toast(err.message); return; }
  if (b.dataset.use === 'primary') {
    $('#llmPrimary').value = provider; syncPrimary();
    $('#llmModel').value = model; $('#llmBase').value = url;
  } else {
    addFbRow(provider, model);
  }
  $('#llmSaveChain').scrollIntoView({ behavior: 'smooth', block: 'center' });
  toast(t('llm_set_hint'));
});

const numberFb = () => $$('#llmFbRows .fb-row').forEach((r, i) => { $('.n', r).textContent = i + 1; });
function addFbRow(provider = 'deepseek', model = '') {
  const row = document.createElement('div');
  row.className = 'fb-row';
  const listId = `fbm${Math.random().toString(36).slice(2, 8)}`;
  row.innerHTML = `<span class="n"></span><select>${providerOpts(provider, false)}</select>
    <input list="${listId}" value="${esc(model)}" placeholder="${esc(t('llm_default'))}" dir="ltr" spellcheck="false"><datalist id="${listId}"></datalist>
    <button class="btn ghost sm x" title="${esc(t('llm_remove'))}">✕</button>`;
  const fill = () => { $('datalist', row).innerHTML = prov($('select', row).value).models.map((m) => `<option value="${esc(m)}">`).join(''); };
  $('select', row).onchange = fill; fill();
  $('.x', row).onclick = () => { row.remove(); numberFb(); };
  $('#llmFbRows').appendChild(row); numberFb();
}

$('#llmPrimary').onchange = () => { $('#llmModel').value = ''; syncPrimary(); };
$('#llmAddFb').onclick = () => addFbRow();
$('#llmSaveChain').onclick = async () => {
  const body = {
    provider: $('#llmPrimary').value, model: $('#llmModel').value.trim(), base_url: $('#llmBase').value.trim(),
    agent_mode: $('#llmMode').value,
    fallbacks: $$('#llmFbRows .fb-row').map((r) => `${$('select', r).value}:${$('input', r).value.trim()}`),
  };
  try { LLM = (await api('POST', '/api/admin/llm/chain', body)).state; renderLlm(); toast(t('llm_saved')); } catch (e) { toast(e.message); }
};
$('#llmReset').onclick = async () => {
  if (!window.confirm(t('llm_reset_q'))) return;
  try { LLM = (await api('POST', '/api/admin/llm/reset')).state; renderLlm(); toast(t('llm_removed')); } catch (e) { toast(e.message); }
};
/* ---- private evaluator link: built in this browser, sent nowhere. Opening it sets that visitor's AI settings. */
const LINK_PROVIDERS = PROVIDERS.filter((p) => p.key && !p.url); // cloud providers (a link cannot reach someone's localhost)
function lkState() {
  const c = aiConfig();
  $('#lkState').textContent = c.provider === 'offline' ? t('lk_local')
    : c.provider ? t('lk_on', { m: `${providerInfo(c.provider)?.label || c.provider} · ${c.model}` }) : t('lk_off');
}
function lkSync() {
  const p = providerInfo($('#lkProvider').value);
  $('#lkModels').innerHTML = (p?.models || []).map((m) => `<option value="${esc(m)}">`).join('');
  $('#lkModel').placeholder = p?.models[0] || '';
}
function lkRead() {
  const provider = $('#lkProvider').value;
  return { provider, model: $('#lkModel').value.trim() || providerInfo(provider)?.models[0] || '', key: $('#lkKey').value.trim() };
}
$('#lkProvider').innerHTML = LINK_PROVIDERS.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('');
$('#lkProvider').onchange = () => { $('#lkModel').value = ''; lkSync(); };
lkSync(); lkState();
$('#lkMake').onclick = () => {
  const c = lkRead();
  if (!validKey(c.key)) { toast(t('lk_bad')); return; }
  const q = new URLSearchParams({ provider: c.provider, model: c.model, key: c.key });
  $('#lkLink').value = `${new URL('./', location.href).href}#${q.toString()}`;
  $('#lkOut').hidden = false; $('#lkLink').select();
};
$('#lkCopy').onclick = async () => {
  try { await navigator.clipboard.writeText($('#lkLink').value); } catch { $('#lkLink').select(); document.execCommand('copy'); }
  toast(t('lk_copied'));
};
$('#lkUse').onclick = () => {
  const c = lkRead();
  if (!validKey(c.key)) { toast(t('lk_bad')); return; }
  setAiConfig({ ...aiConfig(), ...c, base_url: '' }); $('#lkKey').value = ''; lkState(); refreshAll(true);
  if (!STATIC && !$('#llmTab').hidden) loadLlm();
};
$('#lkForget').onclick = () => { setAiConfig(null); lkState(); refreshAll(true); if (!STATIC && !$('#llmTab').hidden) loadLlm(); };
// server-only cards (model chain on the server, local model servers) make no sense in the browser build
if (STATIC) $$('.server-only').forEach((el) => { el.hidden = true; });

translateStatic();
request('GET', '/api/bootstrap').then((r) => { if (r.ok) $('#brandName').textContent = r.data.app.name; }).catch(() => {});
refreshAll(true);
setInterval(() => refreshAll(false), 5000);
