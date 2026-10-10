'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => (n == null || isNaN(n)) ? '–' : (n < 0 ? '-' : '') + '₱' + Math.round(Math.abs(n)).toLocaleString('en-US');
const fmtD = s => { if (!s) return '–'; const d = new Date(s + 'T00:00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
const fmtS = s => { if (!s) return '–'; const d = new Date(s + 'T00:00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
const pct = n => Math.max(0, Math.min(100, n || 0));
let S = null, charts = [], calMonth = null, TBL = {}, SORT = {}, projCache = null;
const NAV_GROUPS = [
  { name: 'Core', pages: [['dashboard', 'Dashboard', 'speedometer2'], ['analytics', 'Analytics', 'graph-up-arrow'], ['calendar', 'Calendar', 'calendar3']] },
  { name: 'Tracking', pages: [['bills', 'Bills', 'receipt'], ['debts', 'Debts', 'credit-card-2-front'], ['accounts', 'Accounts & Income', 'bank'], ['transactions', 'Transactions', 'cash-stack']] },
  { name: 'Planning', pages: [['goals', 'Goals & Savings', 'piggy-bank'], ['business', 'Business Plan', 'pc-display'], ['notes', 'Notes & Changes', 'journal-text']] }
];
const PAGES = NAV_GROUPS.flatMap(g => g.pages);

async function api(path, method = 'GET', body) {
  const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch (e) { }
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
function toast(msg, kind = 'success') {
  const el = document.createElement('div'); el.className = `toast align-items-center text-bg-${kind} border-0`;
  el.innerHTML = `<div class="d-flex"><div class="toast-body">${esc(msg)}</div><button class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
  $('#toasts').appendChild(el); const t = new bootstrap.Toast(el, { delay: 4500 }); t.show(); el.addEventListener('hidden.bs.toast', () => el.remove());
}
function confirmBox(html) {
  return new Promise(res => {
    const m = bootstrap.Modal.getOrCreateInstance($('#confirmModal')); $('#confirmBody').innerHTML = html; let ok = false;
    $('#confirmOk').onclick = () => { ok = true; m.hide(); };
    $('#confirmModal').addEventListener('hidden.bs.modal', () => res(ok), { once: true }); m.show();
  });
}
function openForm({ title, fields, submit, okText = 'Save', okClass = 'btn-primary' }) {
  $('#formTitle').textContent = title; $('#formErr').textContent = ''; $('#formOk').textContent = okText; $('#formOk').className = 'btn ' + okClass;
  $('#formBody').innerHTML = `<div class="row g-3">` + fields.map(f => {
    const id = 'f_' + f.name, v = f.value ?? '', req = f.required ? 'required' : '', col = f.col || 12;
    let inp;
    if (f.type === 'select') inp = `<select class="form-select" id="${id}" name="${f.name}" ${req}>` + f.options.map(o => { const [ov, ol] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(ov)}" ${String(ov) === String(v) ? 'selected' : ''}>${esc(ol)}</option>`; }).join('') + `</select>`;
    else if (f.type === 'checkbox') inp = `<div class="form-check form-switch"><input class="form-check-input" type="checkbox" id="${id}" name="${f.name}" ${v ? 'checked' : ''}><label class="form-check-label" for="${id}">${esc(f.label)}</label></div>`;
    else if (f.type === 'textarea') inp = `<textarea class="form-control" id="${id}" name="${f.name}" rows="2">${esc(v)}</textarea>`;
    else inp = `<input class="form-control" id="${id}" name="${f.name}" type="${f.type || 'text'}" ${f.type === 'number' ? 'step="any"' : ''} value="${esc(v)}" ${req} ${f.list ? `list="dl_${f.name}"` : ''}>` + (f.list ? `<datalist id="dl_${f.name}">${f.list.map(x => `<option value="${esc(x)}">`).join('')}</datalist>` : '');
    return `<div class="col-md-${col}">${f.type === 'checkbox' ? '' : `<label class="form-label small fw-semibold" for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>`}${inp}${f.help ? `<div class="form-text">${esc(f.help)}</div>` : ''}</div>`;
  }).join('') + `</div>`;
  const m = bootstrap.Modal.getOrCreateInstance($('#formModal'));
  $('#formEl').onsubmit = async e => {
    e.preventDefault(); const data = {};
    fields.forEach(f => { const el = $('#f_' + f.name); data[f.name] = f.type === 'checkbox' ? el.checked : el.value; });
    $('#formOk').disabled = true;
    try { await submit(data); m.hide(); } catch (err) { $('#formErr').textContent = err.message; } finally { $('#formOk').disabled = false; }
  };
  m.show();
}
async function mutate(path, method, body, msg) { S = await api(path, method, body); projCache = null; render(); if (msg) toast(msg); }

function table(id, cols, rows, opts = {}) { TBL[id] = { cols, rows, opts }; return `<div class="tbl-wrap" id="tbl-${id}">${tableInner(id)}</div>`; }
function tableInner(id) {
  const { cols, rows, opts } = TBL[id]; const st = SORT[id] || opts.sort || null; let rs = rows.slice();
  if (st) { const c = cols.find(c => c.k === st.k); if (c) rs.sort((a, b) => { const g = c.v || (r => r[c.k]); const x = g(a), y = g(b); const r = (typeof x === 'number' && typeof y === 'number') ? x - y : String(x ?? '').localeCompare(String(y ?? '')); return st.dir * r; }); }
  const head = cols.map(c => `<th class="${c.num ? 'num' : ''} ${c.nosort ? 'nosort' : ''}" ${c.nosort ? '' : `onclick="sortTable('${id}','${c.k}')"`}>${esc(c.label)}${st && st.k === c.k ? (st.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
  const body = rs.length ? rs.map(r => `<tr>${cols.map(c => `<td class="${c.num ? 'num' : ''}">${c.r ? c.r(r) : esc(r[c.k])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" class="text-center text-secondary p-4">${esc(opts.empty || 'Nothing here yet.')}</td></tr>`;
  const foot = opts.totals && rows.length ? `<tfoot><tr>${cols.map((c, i) => `<td class="${c.num ? 'num' : ''}">${c.t ? c.t(rows) : (i === 0 ? 'Total' : '')}</td>`).join('')}</tr></tfoot>` : '';
  return `<table class="table table-hover dt align-middle"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>`;
}
window.sortTable = (id, k) => { const cur = SORT[id] || TBL[id].opts.sort; SORT[id] = { k, dir: cur && cur.k === k ? -cur.dir : 1 }; $('#tbl-' + id).innerHTML = tableInner(id); };
const pill = (txt, cls) => `<span class="badge rounded-pill text-bg-${cls}">${esc(txt)}</span>`;
const STATE = { paid: ['Paid', 'success'], overdue: ['Overdue', 'danger'], unrecorded: ['Past due – unrecorded', 'secondary'], today: ['Due today', 'danger'], soon: ['Due soon', 'warning'], upcoming: ['Upcoming', 'primary'], done: ['Completed', 'secondary'] };
const statePill = s => { const [t, c] = STATE[s] || [s, 'secondary']; return pill(t, c); };
const daysPill = d => d == null ? '–' : pill(d < 0 ? `${-d}d overdue` : d === 0 ? 'today' : `${d}d`, d < 0 ? 'danger' : d <= 3 ? 'warning' : d <= 14 ? 'info' : 'secondary');
const prog = (p, cls = 'primary', label) => `<div class="d-flex align-items-center gap-2"><div class="progress flex-fill" style="min-width:70px"><div class="progress-bar bg-${cls}" style="width:${pct(p)}%"></div></div><small class="text-nowrap">${label ?? Math.round(p) + '%'}</small></div>`;
const btn = (cls, ico, title, on) => `<button class="btn btn-sm btn-outline-${cls}" title="${esc(title)}" onclick="${on}"><i class="bi bi-${ico}"></i></button>`;
const sum = (rows, f) => rows.reduce((a, r) => a + (f(r) || 0), 0);
const kpi = (lbl, val, ico, color, sub) => `<div class="card kpi bar-l" style="--c:${color}"><div class="card-body"><i class="bi bi-${ico} ico"></i><div class="lbl">${esc(lbl)}</div><div class="val">${val}</div>${sub ? `<div class="small text-secondary">${sub}</div>` : ''}</div></div>`;
const card = (title, body, extra = '') => `<div class="card h-100"><div class="card-header d-flex justify-content-between align-items-center"><span>${title}</span>${extra}</div><div class="card-body">${body}</div></div>`;
const todayStr = () => S.dashboard.today;

const COL = { blue: '#4c8dff', green: '#2fb872', red: '#f0506e', amber: '#f5a623', purple: '#9b6bff', teal: '#17b6c9', grey: '#8a93a3', pink: '#e86bb2' };
const PAL = [COL.blue, COL.green, COL.amber, COL.purple, COL.teal, COL.pink, COL.red, COL.grey];
function mkChart(id, cfg) {
  const el = document.getElementById(id); if (!el) return null;
  const dark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
  Chart.defaults.color = dark ? '#c4cad4' : '#495057'; Chart.defaults.borderColor = dark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.1)';
  cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false }, cfg.options || {});
  const c = new Chart(el, cfg); charts.push(c); return c;
}
function killCharts() { charts.forEach(c => c.destroy()); charts = []; }
const money = { callbacks: { label: c => ` ${c.dataset.label || c.label}: ${fmt(c.parsed.y ?? c.parsed)}` } };
const canvas = (id, cls = '') => `<div class="chart-box ${cls}"><canvas id="${id}"></canvas></div>`;

function route() { return (location.hash || '#/dashboard').replace('#/', '') || 'dashboard'; }
function buildNav() { 
  $('#nav').innerHTML = NAV_GROUPS.map(g => 
    `<li class="nav-item mt-3 mb-1"><span class="small text-uppercase text-secondary fw-bold ms-3">${g.name}</span></li>` + 
    g.pages.map(([k, l, i]) => `<li><a class="nav-link" href="#/${k}" data-k="${k}"><i class="bi bi-${i}"></i>${l}</a></li>`).join('')
  ).join(''); 
}
async function refresh() { S = await api('/api/state'); projCache = null; render(); }
function render() {
  if (!S) return; const r = route(); killCharts(); TBL = {};
  document.querySelectorAll('#nav .nav-link').forEach(a => a.classList.toggle('active', a.dataset.k === r));
  const d = S.dashboard, dl = d.daily;
  $('#side-status').innerHTML = `<span class="light-dot" style="background:${{ green: '#2fb872', amber: '#f5a623', red: '#f0506e' }[dl.light]}"></span> Budget status: <b>${dl.light.toUpperCase()}</b><div>Updated ${esc((d.last_updated || '').replace('T', ' ').slice(0, 16))}</div>`;
  const fn = { dashboard: pDashboard, calendar: pCalendar, bills: pBills, debts: pDebts, accounts: pAccounts, transactions: pTx, goals: pGoals, analytics: pAnalytics, business: pBusiness, notes: pNotes }[r] || pDashboard;
  $('#app').innerHTML = `<h2 class="h4 mb-3">${esc((PAGES.find(p => p[0] === r) || PAGES[0])[1])} <small class="text-secondary fs-6 ms-2">${esc(fmtD(d.today))}</small></h2><div id="page"></div>`;
  fn($('#page'));
}
window.addEventListener('hashchange', () => { if (S) render(); window.scrollTo(0, 0); bootstrap.Offcanvas.getInstance($('#sb'))?.hide(); });

const cats = () => S.categories;
function settingsForm() {
  const s = S.settings;
  openForm({
    title: 'Budget settings', fields: [
      { name: 'horizon_date', label: 'Income-confirmed date (planning horizon)', type: 'date', value: s.horizon_date, required: true, help: 'Cash is budgeted day by day until this date.' },
      { name: 'daily_food_transport', label: 'Daily food & transport assumption (₱/day)', type: 'number', value: s.daily_food_transport, required: true, help: 'ASSUMPTION – not in your data yet. Used for burn rate & projections.' },
      { name: 'emergency_reserve', label: 'Emergency reserve to keep untouched (₱)', type: 'number', value: s.emergency_reserve, help: 'Subtracted before computing safe-to-spend.' },
      { name: 'warning_threshold', label: 'WARNING level (₱, blank = auto)', type: 'number', value: s.warning_threshold ?? '', col: 6, help: `Auto = 2 months of bills + 30 days of daily spend (${fmt(S.dashboard.levels.warning)})` },
      { name: 'critical_threshold', label: 'CRITICAL level (₱, blank = auto)', type: 'number', value: s.critical_threshold ?? '', col: 6, help: `Auto = 30 days of bills (${fmt(S.dashboard.levels.critical)})` }],
    submit: d => mutate('/api/settings', 'PUT', d, 'Settings saved')
  });
}
function billForm(b) {
  const e = !!b;
  openForm({
    title: e ? 'Edit bill' : 'Add bill', fields: [
      { name: 'name', label: 'Name', value: b?.name, required: true }, { name: 'amount', label: 'Amount (₱)', type: 'number', value: b?.amount, required: true, col: 6 },
      { name: 'due_day', label: 'Due day of month (1-31)', type: 'number', value: b?.due_day, required: true, col: 6 },
      { name: 'category', label: 'Category', value: b?.category || 'necessity', list: ['necessity', 'subscription', 'utility', 'debt', 'other'], col: 6 },
      { name: 'amount_usd', label: 'Amount in USD (optional)', type: 'number', value: b?.rec?.amount_usd ?? '', col: 6, help: `If set, ₱ amount = USD × ${S.usd_php_rate}` },
      { name: 'payments_remaining', label: 'Payments remaining (optional)', type: 'number', value: b?.rec?.payments_remaining ?? '', help: 'Blank = open-ended. Set for loans (e.g. car loan) so the debt projection works.' },
      { name: 'confirmed', label: 'Confirmed bill', type: 'checkbox', value: b ? b.confirmed : true, col: 6 }, { name: 'estimate', label: 'Amount is an estimate', type: 'checkbox', value: b?.rec?.estimate, col: 6 },
      { name: 'due_day_confirmed', label: 'Due day is exact (not approximate)', type: 'checkbox', value: b ? b.rec.due_day_confirmed !== false : true },
      { name: 'note', label: 'Note', type: 'textarea', value: b?.note }],
    submit: d => mutate(e ? `/api/bills/${b.idx}` : '/api/bills', e ? 'PUT' : 'POST', d, e ? 'Bill updated' : 'Bill added')
  });
}
function debtForm(x) {
  const e = !!x;
  openForm({
    title: e ? 'Edit debt' : 'Add debt', fields: [
      { name: 'name', label: 'Name', value: x?.name, required: true }, { name: 'monthly', label: 'Monthly payment (₱)', type: 'number', value: x?.monthly, required: true, col: 6 },
      { name: 'due_day', label: 'Due day (1-31)', type: 'number', value: x?.due_day, required: true, col: 6 }, { name: 'principal', label: 'Principal (₱)', type: 'number', value: x?.principal ?? '', col: 6 },
      { name: 'interest', label: 'Interest % (optional)', type: 'number', value: x?.interest ?? '', col: 6 }, { name: 'payments_made', label: 'Payments made', type: 'number', value: x?.made ?? 0, col: 4 },
      { name: 'payments_remaining', label: 'Payments remaining', type: 'number', value: x?.remaining ?? '', col: 4 }, { name: 'total_payments', label: 'Total payments', type: 'number', value: x?.total ?? '', col: 4 },
      { name: 'note', label: 'Note', type: 'textarea', value: x?.note }],
    submit: d => mutate(e ? `/api/debts/${x.idx}` : '/api/debts', e ? 'PUT' : 'POST', d, e ? 'Debt updated' : 'Debt added')
  });
}
function acctForm(a) {
  const e = !!a;
  openForm({
    title: e ? 'Edit account' : 'Add account', fields: [{ name: 'name', label: 'Account name', value: a?.name, required: true },
    { name: 'balance', label: 'Balance (₱)', type: 'number', value: a?.balance, required: true }, { name: 'confirmed', label: 'Balance confirmed', type: 'checkbox', value: a ? a.confirmed : true }],
    submit: d => mutate(e ? `/api/accounts/${a.idx}` : '/api/accounts', e ? 'PUT' : 'POST', d, e ? 'Account updated' : 'Account added')
  });
}
function incForm(x) {
  const e = !!x;
  openForm({
    title: e ? 'Edit income source' : 'Add income source', fields: [{ name: 'name', label: 'Name', value: x?.name, required: true }, { name: 'amount', label: 'Amount (₱)', type: 'number', value: x?.amount, required: true, col: 6 },
    { name: 'period', label: 'Period', type: 'select', options: ['monthly', 'weekly', 'biweekly', 'one-time'], value: x?.period || 'monthly', col: 6 },
    { name: 'pay_weekday', label: 'Pay weekday', type: 'select', options: ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], value: x?.pay_weekday || '', col: 6 },
    { name: 'start_date', label: 'Start date', type: 'date', value: x?.start_date || '', col: 6 }, { name: 'status', label: 'Status', type: 'select', options: ['pending', 'confirmed', 'ended'], value: x?.status || 'pending', col: 6 },
    { name: 'confirmed', label: 'Confirmed (counts as income)', type: 'checkbox', value: x?.confirmed, col: 6 }, { name: 'note', label: 'Note', type: 'textarea', value: x?.note }],
    submit: d => mutate(e ? `/api/income/${x.idx}` : '/api/income', e ? 'PUT' : 'POST', d, e ? 'Income updated' : 'Income added')
  });
}
function txForm(t, pre = {}) {
  const e = !!t;
  const first = e ? [] : [{ name: 'type', label: 'Type', type: 'select', options: [['expense', 'Expense (deducts)'], ['income', 'Income (adds)']], value: 'expense', col: 6 }, { name: 'amount', label: 'Amount (₱)', type: 'number', required: true, col: 6 },
    { name: 'account', label: 'Account', type: 'select', options: [['', '(none – do not change balances)'], ...S.accounts.map(a => [a.name, `${a.name} (${fmt(a.balance)})`])], value: S.accounts.find(a => a.name === 'Wallet')?.name || S.accounts[0]?.name || '' }];
  openForm({
    title: e ? 'Edit transaction (amount/account fixed)' : 'Add expense / income', okText: e ? 'Save' : 'Record',
    fields: first.concat([{ name: 'date', label: 'Date', type: 'date', value: t?.date || pre.date || todayStr(), col: 6 }, { name: 'category', label: 'Category', value: t?.category || 'food', list: cats(), col: 6 }, { name: 'note', label: 'Note', value: t?.note || '' }]),
    submit: d => mutate(e ? `/api/transactions/${t.idx}` : '/api/transactions', e ? 'PUT' : 'POST', d, e ? 'Transaction updated' : 'Recorded – balances, calendar & projections updated')
  });
}
function goalForm(g) {
  const e = !!g;
  openForm({
    title: e ? 'Edit goal' : 'Add goal', fields: [{ name: 'name', label: 'Goal name', value: g?.name, required: true }, { name: 'target', label: 'Target (₱)', type: 'number', value: g?.target, required: true, col: 6 },
    { name: 'saved', label: 'Saved so far (₱)', type: 'number', value: g?.saved ?? 0, col: 6 }, { name: 'deadline', label: 'Deadline', type: 'date', value: g?.deadline || '' }, { name: 'note', label: 'Note', type: 'textarea', value: g?.note }],
    submit: d => mutate(e ? `/api/goals/${g.idx}` : '/api/goals', e ? 'PUT' : 'POST', d, e ? 'Goal updated' : 'Goal added')
  });
}
function payForm(it) {
  const open = it.cycles.filter(c => c.status !== 'paid');
  if (!open.length) { toast('No unpaid cycle to mark', 'warning'); return; }
  openForm({
    title: `Mark paid: ${it.name}`, okText: 'Mark paid', okClass: 'btn-success', fields: [
      { name: 'key', label: 'Billing cycle', type: 'select', options: open.map(c => [c.key, `${c.key} – due ${fmtD(c.due)} (${c.days < 0 ? -c.days + 'd overdue' : c.days + 'd'})`]), value: it.next_key || open[0].key },
      { name: 'amount', label: 'Amount paid (₱)', type: 'number', value: it.amount, required: true },
      { name: 'account', label: 'Deduct from account', type: 'select', options: [['', '(do not deduct)'], ...S.accounts.map(a => [a.name, `${a.name} (${fmt(a.balance)})`])], value: '', help: 'Updates the calendar, reserved/unallocated, runway, alerts and all charts immediately.' }],
    submit: d => mutate('/api/cycle', 'POST', { kind: it.kind, idx: it.idx, key: d.key, amount: d.amount, account: d.account, action: 'paid' }, `${it.name} marked paid`)
  });
}
async function unpay(it) {
  const paid = it.cycles.filter(c => c.status === 'paid'); if (!paid.length) return; const c = paid[0];
  if (await confirmBox(`Undo the payment of <b>${esc(it.name)}</b> for ${esc(c.key)}? The matching payment transaction is removed and the amount is refunded to the account it came from.`)) mutate('/api/cycle', 'POST', { kind: it.kind, idx: it.idx, key: c.key, action: 'unpay' }, 'Payment reverted');
}
const del = async (what, path, msg) => { if (await confirmBox(msg)) mutate(path, 'DELETE', null, what + ' deleted'); };
window.A = {
  settings: settingsForm, addBill: () => billForm(), editBill: i => billForm(S.bills[i]), delBill: i => del('Bill', '/api/bills/' + i, `Delete bill <b>${esc(S.bills[i].name)}</b>?`),
  payBill: i => payForm(S.bills[i]), unpayBill: i => unpay(S.bills[i]),
  addDebt: () => debtForm(), editDebt: i => debtForm(S.debts[i]), delDebt: i => del('Debt', '/api/debts/' + i, `Delete debt <b>${esc(S.debts[i].name)}</b>?`),
  payDebt: i => payForm(S.debts[i]), unpayDebt: i => unpay(S.debts[i]),
  addAcct: () => acctForm(), editAcct: i => acctForm(S.accounts[i]), delAcct: i => del('Account', '/api/accounts/' + i, `Delete account <b>${esc(S.accounts[i].name)}</b> (${fmt(S.accounts[i].balance)})? Its balance will no longer count as cash.`),
  addInc: () => incForm(), editInc: i => incForm(S.income[i]), delInc: i => del('Income', '/api/income/' + i, `Delete income source <b>${esc(S.income[i].name)}</b>?`),
  addTx: date => txForm(null, { date }), editTx: i => txForm(S.transactions.find(t => t.idx === i)),
  delTx: async i => {
    const t = S.transactions.find(t => t.idx === i); const rs = t.account ? `<div class="form-check mt-2"><input class="form-check-input" type="checkbox" id="rest" checked><label class="form-check-label" for="rest">Restore ${fmt(t.amount)} to ${esc(t.account)}</label></div>` : '';
    if (await confirmBox(`Delete transaction <b>${fmt(t.amount)}</b> ${esc(t.note || t.category)} (${esc(t.date)})?${rs}`)) mutate('/api/transactions/' + i, 'DELETE', { restore: !!$('#rest')?.checked }, 'Transaction deleted');
  },
  addGoal: () => goalForm(), editGoal: i => goalForm(S.goals[i]), delGoal: i => del('Goal', '/api/goals/' + i, `Delete goal <b>${esc(S.goals[i].name)}</b>?`),
  addAlert: () => openForm({ title: 'Add alert', fields: [{ name: 'text', label: 'Alert text', required: true }], submit: d => mutate('/api/alerts', 'POST', d, 'Alert added') }),
  delAlert: i => del('Alert', '/api/alerts/' + i, 'Delete this alert?'),
  savings: () => openForm({ title: 'Emergency fund', fields: [{ name: 'emergency_fund', label: 'Emergency fund saved (₱)', type: 'number', value: S.savings.emergency_fund, required: true, col: 6 }, { name: 'emergency_target_months', label: 'Target (months of bills)', type: 'number', value: S.savings.emergency_target_months, required: true, col: 6 }], submit: d => mutate('/api/savings', 'PUT', d, 'Emergency fund updated') }),
  business: () => openForm({ title: 'Business plan', fields: [{ name: 'name', label: 'Business name', value: S.business.name, required: true }, { name: 'pc_price', label: 'Price per PC (₱)', type: 'number', value: S.business.pc_price, required: true, col: 6 }, { name: 'room_build', label: 'Room build cost (₱)', type: 'number', value: S.business.room_build, required: true, col: 6 }, { name: 'pcs_min', label: 'Minimum PCs', type: 'number', value: S.business.pcs_min, required: true, col: 6 }, { name: 'pcs_max', label: 'Maximum PCs', type: 'number', value: S.business.pcs_max, required: true, col: 6 }], submit: d => mutate('/api/business', 'PUT', d, 'Business plan updated') }),
  day: showDay, month: m => { calMonth = m; render(); },
  showAlerts: () => {
    const al = S.dashboard.alerts;
    let html = '';
    if (!al.length) {
      html = `<div class="alert alert-success d-flex gap-2 align-items-center"><i class="bi bi-check-circle-fill"></i> No alerts. All clear.</div>`;
    } else {
      const ic = { danger: 'exclamation-octagon-fill', warning: 'exclamation-triangle-fill', info: 'info-circle-fill' };
      html = `<div class="d-flex flex-column gap-2">` + al.map(a => `<div class="alert alert-${a.level || 'info'} d-flex gap-2 align-items-center py-2 mb-0"><i class="bi bi-${ic[a.level] || ic.info}"></i><div class="flex-fill">${esc(a.text)}</div><small class="opacity-75">${a.source === 'computed' ? 'auto' : 'note'}</small></div>`).join('') + `</div>`;
    }
    document.getElementById('alertsBody').innerHTML = html;
    bootstrap.Modal.getOrCreateInstance(document.getElementById('alertsModal')).show();
  },
  addHypo: () => hypoForm(),
  editHypo: id => hypoForm(HYPO.find(x => x.id === id)),
  delHypo: async id => {
    if (await confirmBox('Delete this hypothetical scenario?')) {
      HYPO = HYPO.filter(x => x.id !== id); saveHypo();
    }
  }
};
function hypoForm(h) {
  const e = !!h;
  openForm({
    title: e ? 'Edit hypothetical' : 'Add hypothetical',
    fields: [
      { name: 'name', label: 'Name', value: h?.name, required: true },
      { name: 'type', label: 'Type', type: 'select', options: ['income', 'expense'], value: h?.type || 'income', col: 6 },
      { name: 'amount', label: 'Amount (₱)', type: 'number', value: h?.amount, required: true, col: 6 },
      { name: 'period', label: 'Period', type: 'select', options: ['daily', 'weekly', 'biweekly', 'monthly', 'one-time'], value: h?.period || 'monthly', col: 6 },
      { name: 'start_date', label: 'Start date', type: 'date', value: h?.start_date || todayStr(), required: true, col: 6 },
      { name: 'color', label: 'Line Color', type: 'color', value: h?.color || '#e86bb2', col: 12 }
    ],
    submit: async d => {
      d.enabled = h ? (h.enabled !== false) : true;
      if (e) Object.assign(h, d);
      else { d.id = Math.random().toString(36).slice(2); HYPO.push(d); }
      saveHypo();
    }
  });
}
const rowActs = (pay, unp, edit, dl, i, st) => `<div class="btn-group">${st === 'paid' ? btn('secondary', 'arrow-counterclockwise', 'Undo paid', `A.${unp}(${i})`) : btn('success', 'check2-circle', 'Mark paid', `A.${pay}(${i})`)}${btn('primary', 'pencil', 'Edit', `A.${edit}(${i})`)}${btn('danger', 'trash', 'Delete', `A.${dl}(${i})`)}</div>`;
const crudActs = (edit, dl, i) => `<div class="btn-group">${btn('primary', 'pencil', 'Edit', `A.${edit}(${i})`)}${btn('danger', 'trash', 'Delete', `A.${dl}(${i})`)}</div>`;

const LV = { danger: 'danger', warning: 'warning', info: 'info' };
function alertsHtml(al) {
  const count = al.length;
  const hasDanger = al.some(a => a.level === 'danger');
  const hasWarning = al.some(a => a.level === 'warning');
  const dotColor = count === 0 ? 'bg-success' : (hasDanger ? 'bg-danger' : (hasWarning ? 'bg-warning' : 'bg-primary'));
  const text = count === 0 ? 'All clear' : `${count} update${count > 1 ? 's' : ''}`;
  
  return `<div class="mb-4 d-flex justify-content-end align-items-center">
    <button class="btn btn-sm btn-outline-secondary position-relative px-3 rounded-pill d-flex align-items-center fw-medium" onclick="A.showAlerts()" style="background: var(--bs-tertiary-bg); border-color: var(--bs-border-color);">
      <i class="bi bi-bell me-2"></i> ${text}
      <span class="position-absolute top-0 start-100 translate-middle p-1 ${dotColor} border border-dark rounded-circle">
        <span class="visually-hidden">Alerts</span>
      </span>
    </button>
  </div>`;
}
function levelTile(label, cross, thr, color, icon) {
  let main, sub;
  if (!cross) { main = 'Not within 12 months'; sub = 'cash stays above this level'; color = '#2fb872'; }
  else if (cross.already) { main = 'ALREADY BELOW'; sub = `cash is under ${fmt(thr)} today`; }
  else { main = fmtD(cross.date); sub = `in <b>${cross.days} days</b>`; }
  return `<div class="card lvl" style="--c:${color}"><div class="card-body"><div class="small text-uppercase text-secondary"><i class="bi bi-${icon}"></i> ${esc(label)}</div><div class="date">${main}</div><div class="small">${sub}</div><div class="small text-secondary">level ${fmt(thr)}</div></div></div>`;
}
function thLines(s, th) {
  const l = (label, v, c) => ({ label, data: s.map(() => v), borderColor: c, borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5, fill: false });
  return [l('Warning level', th.warning, COL.amber), l('Critical level', th.critical, COL.red), l('Business start', th.business, COL.purple)];
}
async function getProj(useHypo = false) { if (!useHypo && projCache) return projCache; const p = useHypo ? await api('/api/projection?days=90', 'POST', { hypotheticals: HYPO }) : await api('/api/projection?days=90'); if (!useHypo) projCache = p; return p; }
function pDashboard(el) {
  const d = S.dashboard, dl = d.daily, lv = d.levels, b = d.business;
  const lightTxt = { green: 'ON TRACK', amber: 'WATCH SPENDING', red: 'DANGER' }[dl.light];
  const used = dl.allowed_today > 0 ? dl.spent_today / dl.allowed_today * 100 : (dl.spent_today ? 100 : 0);
  el.innerHTML = alertsHtml(d.alerts) + `
  <div class="row g-3 mb-3">
    <div class="col-12 col-xl-4"><div class="card hero ${dl.light} h-100" id="hero_card"><div class="card-body d-flex flex-column">
      <div class="d-flex justify-content-between"><span><span class="light"></span><b id="hero_status">${lightTxt}</b></span><button class="btn btn-sm btn-light" onclick="A.settings()"><i class="bi bi-sliders"></i> Edit budget</button></div>
      <div class="mt-3 opacity-75 small text-uppercase">Safe to spend per day until <span id="hero_horizon">${fmtD(dl.horizon)}</span></div><div class="big" id="hero_per_day">${fmt(dl.per_day)}</div>
      <div class="small mt-1"><span id="hero_days">${dl.days}</span> days left · food &amp; transport assumption <span id="hero_assump">${fmt(dl.assumption)}</span>/day</div>
      <hr class="border-white opacity-50"><div class="d-flex justify-content-between"><span>Spent today</span><b>${fmt(dl.spent_today)}</b></div>
      <div class="d-flex justify-content-between"><span>Allowed today</span><b id="hero_allowed">${fmt(dl.allowed_today)}</b></div>
      <div class="progress mt-2 bg-white bg-opacity-25"><div class="progress-bar bg-white" id="hero_prog" style="width:${pct(used)}%"></div></div>
      <div class="d-flex justify-content-between mt-1"><span>Left for today</span><b id="hero_left">${fmt(dl.remaining_today)}</b></div>
      <button class="btn btn-light mt-3" onclick="A.addTx()"><i class="bi bi-plus-circle"></i> Add today's expense</button></div></div></div>
    <div class="col-12 col-xl-8"><div class="row g-3">
      <div class="col-6 col-lg-3" id="kpi_cash">${kpi('Cash now', fmt(d.cash), 'wallet2', COL.blue, S.accounts.map(a => esc(a.name) + ' ' + fmt(a.balance)).join(' · '))}</div>
      <div class="col-6 col-lg-3" id="kpi_bills">${kpi('Reserved for bills', fmt(d.reserved), 'lock', COL.amber, `until payday ${fmtS(d.next_payday)}`)}</div>
      <div class="col-6 col-lg-3" id="kpi_free">${kpi('Left for daily spending', fmt(d.unallocated), 'basket', COL.green, 'cash − reserved bills')}</div>
      <div class="col-6 col-lg-3">${kpi('Runway', d.runway_days != null ? Math.round(d.runway_days) + ' days' : '–', 'hourglass-split', d.runway_days < 30 ? COL.red : d.runway_days < 60 ? COL.amber : COL.green, `burn ${fmt(lv.burn)}/day`)}</div>
      <div class="col-12">${card('<i class="bi bi-calculator"></i> Date-Adjustable Daily Budget Calculator', `
        <div class="row g-3 mb-3">
          <div class="col-6"><label class="form-label small text-secondary mb-1">Start Date</label><input type="date" id="calc_start" class="form-control form-control-sm" value="${d.today}" onchange="updateBudgetCalc()"></div>
          <div class="col-6"><label class="form-label small text-secondary mb-1">End Date</label><input type="date" id="calc_end" class="form-control form-control-sm" value="${dl.horizon}" onchange="updateBudgetCalc()"></div>
          
          <div class="col-6 col-md-4"><label class="form-label small text-secondary mb-1">Current Cash</label><input type="number" id="calc_cash" class="form-control form-control-sm" value="${d.cash}" oninput="updateBudgetCalc()"></div>
          <div class="col-6 col-md-4"><label class="form-label small text-secondary mb-1">Upcoming Bills</label><input type="number" id="calc_bills" class="form-control form-control-sm" value="${dl.bills_in_horizon}" oninput="updateBudgetCalc()"></div>
          <div class="col-6 col-md-4"><label class="form-label small text-secondary mb-1">Emergency Reserve</label><input type="number" id="calc_res" class="form-control form-control-sm" value="${dl.reserve}" oninput="updateBudgetCalc()"></div>
          
          <div class="col-6"><label class="form-label small text-secondary mb-1">Daily Essentials</label><input type="number" id="calc_assump" class="form-control form-control-sm" value="${dl.assumption}" oninput="updateBudgetCalc()"></div>
          <div class="col-6">
            <label class="form-label small text-secondary mb-1 d-flex justify-content-between"><span>Safe Spending %</span> <span id="calc_pct_lbl" class="fw-bold">80%</span></label>
            <input type="range" id="calc_pct" class="form-range" min="10" max="100" step="5" value="80" oninput="document.getElementById('calc_pct_lbl').innerText=this.value+'%'; updateBudgetCalc()">
          </div>
        </div>
        <div id="calc_results"></div>`)}</div>
    </div></div>
  </div>
  <div class="row g-3 mb-3">
    <div class="col-6 col-xl-3">${levelTile('WARNING date', lv.warning_cross, lv.warning, COL.amber, 'exclamation-triangle')}</div>
    <div class="col-6 col-xl-3">${levelTile('CRITICAL date', lv.critical_cross, lv.critical, COL.red, 'exclamation-octagon')}</div>
    <div class="col-6 col-xl-3">${levelTile('Cash hits ZERO', lv.zero_cross, 0, '#b02a37', 'x-octagon')}</div>
    <div class="col-6 col-xl-3">${levelTile('Below business-start line', lv.business_cross, lv.business, COL.purple, 'pc-display')}</div>
  </div>
  <div class="row g-3 mb-3">
    <div class="col-12 col-xl-5">${card('<i class="bi bi-pc-display"></i> Business start progress', `
      <div class="d-flex justify-content-between"><span>Usable cash (after next-30-day bills) ${fmt(b.available_after_30d_bills)}</span><span>${b.pcs_min} PCs + room: ${fmt(b.cost_low)}</span></div>${prog(b.progress_low, b.progress_low >= 100 ? 'success' : 'primary', Math.round(b.progress_low) + '%')}
      <div class="d-flex justify-content-end mt-2"><span>${b.pcs_max} PCs + room: ${fmt(b.cost_high)}</span></div>${prog(b.progress_high, b.progress_high >= 100 ? 'success' : 'info', Math.round(b.progress_high) + '%')}
      <div class="row text-center mt-3 g-2"><div class="col-4"><div class="small text-secondary">PCs affordable now</div><div class="fs-3 fw-bold">${b.pcs_affordable}</div><div class="small text-secondary">after ${fmt(b.room_build)} room</div></div>
      <div class="col-4"><div class="small text-secondary">Shortfall for ${b.pcs_min} PCs</div><div class="fs-5 fw-bold text-danger">${fmt(b.shortfall_low)}</div></div><div class="col-4"><div class="small text-secondary">Shortfall for ${b.pcs_max} PCs</div><div class="fs-5 fw-bold text-danger">${fmt(b.shortfall_high)}</div></div></div>
      <div class="small text-secondary mt-2">${esc(b.rule)}</div>`)}</div>
    <div class="col-6 col-xl-3">${card('Cash allocation', canvas('c_alloc', 'sm'))}</div>
    <div class="col-6 col-xl-4">${card('Upcoming bills (30 days)', table('up', [
      { k: 'name', label: 'Bill', r: r => esc(r.name) + (r.est ? ' <small class="text-secondary">~</small>' : '') }, { k: 'due', label: 'Due', r: r => fmtS(r.due) },
      { k: 'days', label: 'In', r: r => daysPill(r.days) }, { k: 'amount', label: '₱', num: true, r: r => fmt(r.amount), t: rs => fmt(sum(rs, r => r.amount)) }], d.upcoming, { totals: true, sort: { k: 'due', dir: 1 }, empty: 'No bills in the next 30 days.' }))}</div>
  </div>
  <div class="row g-3"><div class="col-12">${card('Cash projection – next 60 days (after bills &amp; daily spend)', canvas('c_proj'), '<a href="#/analytics" class="btn btn-sm btn-outline-primary">Full analytics</a>')}</div></div>`;
  mkChart('c_alloc', { type: 'doughnut', data: { labels: ['Reserved for bills', 'Daily-life money'], datasets: [{ data: [d.reserved, Math.max(d.unallocated, 0)], backgroundColor: [COL.amber, COL.green], borderWidth: 0 }] }, options: { cutout: '62%', plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => ` ${c.label}: ${fmt(c.parsed)}` } } } } });
  getProj().then(p => { const s = p.series.slice(0, 61); mkChart('c_proj', { type: 'line', data: { labels: s.map(r => fmtS(r.date)), datasets: [{ label: 'Cash', data: s.map(r => r.cash), borderColor: COL.blue, backgroundColor: COL.blue + '33', fill: true, tension: .2, pointRadius: 0 }, ...thLines(s, p.thresholds)] }, options: { plugins: { tooltip: money }, scales: { y: { ticks: { callback: v => fmt(v) } }, x: { ticks: { maxTicksLimit: 12 } } }, interaction: { mode: 'index', intersect: false } } }); });
  setTimeout(updateBudgetCalc, 0);
}

window.updateBudgetCalc = () => {
  if (!$('#calc_start')) return;
  const start = new Date($('#calc_start').value);
  const end = new Date($('#calc_end').value);
  const days = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
  const cash = parseFloat($('#calc_cash').value) || 0;
  const bills = parseFloat($('#calc_bills').value) || 0;
  const res = parseFloat($('#calc_res').value) || 0;
  const inc = 0;
  const assump = parseFloat($('#calc_assump').value) || 0;
  const pct = parseFloat($('#calc_pct').value) || 80;

  const avail = cash + inc - bills - res;
  const maxSpend = avail / days;
  const safeSpend = maxSpend * (pct / 100);
  const dailySav = maxSpend - safeSpend;
  const totSav = dailySav * days;

  $('#calc_results').innerHTML = `
    <div class="table-responsive"><table class="table table-sm mb-0 tbl-calc"><tbody>
      <tr><td>Available Budget</td><td class="num">${fmt(avail)}</td></tr>
      <tr><td>Maximum to Spend</td><td class="num">${fmt(maxSpend)}/day</td></tr>
      <tr class="fw-bold table-active"><td>Safe to Spend</td><td class="num">${fmt(safeSpend)}/day <span class="${safeSpend >= assump ? 'text-success' : 'text-danger'}">(${safeSpend >= assump ? 'covers' : 'BELOW'} ${fmt(assump)})</span></td></tr>
      <tr><td>Daily Savings Potential</td><td class="num text-success">+${fmt(dailySav)}/day</td></tr>
      <tr class="fw-bold text-success"><td>Potential Savings by ${fmtD($('#calc_end').value)}</td><td class="num">+${fmt(totSav)}</td></tr>
    </tbody></table></div>
  `;

  // Dynamic Dashboard Updates
  if ($('#hero_card')) {
    const light = safeSpend >= assump ? 'green' : (safeSpend > 0 ? 'amber' : 'red');
    const lightTxt = { green: 'ON TRACK', amber: 'WATCH SPENDING', red: 'DANGER' }[light];
    
    $('#hero_card').className = `card hero ${light} h-100`;
    $('#hero_status').innerText = lightTxt;
    $('#hero_horizon').innerText = fmtD($('#calc_end').value);
    $('#hero_per_day').innerText = fmt(safeSpend);
    $('#hero_days').innerText = days;
    $('#hero_assump').innerText = fmt(assump);
    
    const spent = S.dashboard.daily.spent_today;
    const allowed = safeSpend;
    const left = allowed - spent;
    const used = allowed > 0 ? (spent / allowed) * 100 : (spent > 0 ? 100 : 0);
    
    $('#hero_allowed').innerText = fmt(allowed);
    $('#hero_left').innerText = fmt(left);
    $('#hero_prog').style.width = Math.min(100, Math.max(0, used)) + '%';
  }

  if ($('#kpi_cash')) {
    $('#kpi_cash').innerHTML = kpi('Cash now (Sim)', fmt(cash + inc), 'wallet2', COL.blue, 'Based on calc');
    $('#kpi_bills').innerHTML = kpi('Reserved (Sim)', fmt(bills + res), 'lock', COL.amber, 'Bills + Reserve');
    $('#kpi_free').innerHTML = kpi('Free (Sim)', fmt(avail), 'basket', COL.green, 'cash − reserved');
  }
};
async function pCalendar(el) {
  const t = S.dashboard.today; if (!calMonth) calMonth = t.slice(0, 7);
  el.innerHTML = '<div class="text-center p-4"><div class="spinner-border"></div></div>';
  const c = await api('/api/calendar?month=' + calMonth); window._cal = c;
  const [y, m] = c.month.split('-').map(Number); const sh = mm => { const dt = new Date(y, m - 1 + mm, 1); return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0'); };
  let cells = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(n => `<div class="hd">${n}</div>`).join('') + '<div class="cell empty"></div>'.repeat(c.first_weekday);
  c.days.forEach(dd => {
    const n = +dd.date.slice(8); const ev = dd.items.map(i => `<span class="ev ${i.status}" title="${esc(i.name)} ${fmt(i.amount)}">${i.status === 'paid' ? '✓ ' : ''}${esc(i.name)} ${fmt(i.amount)}</span>`).join('') +
      dd.payday.map(p => `<span class="ev payday ${p.confirmed ? '' : 'unc'}">${p.start ? '★ ' : '₱ '}${esc(p.name)}${p.confirmed ? '' : ' (unconf.)'}</span>`).join('');
    const sp = dd.tx.filter(x => x.type === 'expense').reduce((a, x) => a + x.amount, 0);
    cells += `<div class="cell ${dd.date === t ? 'today' : ''}" onclick="A.day('${dd.date}')"><div class="d-flex justify-content-between"><span class="dn">${n}</span>${sp ? `<small class="text-danger">−${fmt(sp)}</small>` : ''}</div>${ev}${dd.proj != null && dd.date >= t ? `<div class="pj">${fmt(dd.proj)}</div>` : ''}</div>`;
  });
  const tot = c.days.flatMap(d => d.items); const due = tot.filter(i => i.status !== 'paid').reduce((a, i) => a + i.amount, 0), paid = tot.filter(i => i.status === 'paid').reduce((a, i) => a + i.amount, 0);
  el.innerHTML = `<div class="d-flex flex-wrap gap-2 align-items-center mb-3"><div class="btn-group"><button class="btn btn-outline-secondary" title="Previous month" onclick="A.month('${sh(-1)}')"><i class="bi bi-chevron-left"></i></button><button class="btn btn-outline-secondary" title="Jump to the current month" onclick="A.month('${t.slice(0, 7)}')">Today</button><button class="btn btn-outline-secondary" title="Next month" onclick="A.month('${sh(1)}')"><i class="bi bi-chevron-right"></i></button></div>
    <h3 class="h5 mb-0 me-3">${esc(c.label)}</h3>${pill('Paid ' + fmt(paid), 'success')} ${pill('Still due ' + fmt(due), 'primary')}
    <span class="ms-auto small d-flex gap-2 flex-wrap"><span title="Bill or debt already paid" class="ev paid px-2 rounded">Paid</span><span title="Payment still to be made" class="ev open px-2 rounded">Due</span><span title="Payment past its due date and not paid" class="ev overdue px-2 rounded">Overdue</span><span title="Past due date with no payment recorded" class="ev unrecorded px-2 rounded">Unrecorded</span><span title="Expected payday; unconfirmed income is not counted as cash" class="ev payday unc px-2 rounded">Payday (unconfirmed)</span><span class="text-secondary" title="Projected cash at the end of each future day">grey ₱ = projected cash</span></span></div>
    <div class="card"><div class="card-body p-2"><div class="cal">${cells}</div></div></div>`;
}
function showDay(date) {
  const dd = window._cal.days.find(x => x.date === date); if (!dd) return;
  const hide = `bootstrap.Modal.getInstance(document.getElementById('dayModal')).hide()`;
  const rows = dd.items.map(i => `<tr><td>${esc(i.name)}</td><td>${esc(i.kind)}</td><td class="num">${fmt(i.amount)}${i.est ? '~' : ''}</td><td>${statePill(i.status === 'open' ? 'upcoming' : i.status)}</td><td class="text-end">${i.status !== 'paid' ? `<button class="btn btn-sm btn-success" onclick="${hide};setTimeout(()=>A.pay${i.kind === 'bill' ? 'Bill' : 'Debt'}(${i.idx}),300)">Mark paid</button>` : ''}</td></tr>`).join('');
  $('#dayTitle').textContent = new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  $('#dayBody').innerHTML = `${dd.payday.map(p => `<div class="alert alert-warning py-2">₱ ${esc(p.name)} ${p.confirmed ? '' : '<b>(unconfirmed – not counted as cash)</b>'}${p.amount ? ' ' + fmt(p.amount) : ''}</div>`).join('')}
   <h6>Bills &amp; debts</h6>${rows ? `<table class="table table-sm"><tbody>${rows}</tbody></table>` : '<p class="text-secondary">Nothing due.</p>'}
   <h6>Transactions</h6>${dd.tx.length ? `<table class="table table-sm"><tbody>${dd.tx.map(x => `<tr><td>${esc(x.type)}</td><td>${esc(x.category)}</td><td>${esc(x.note)}</td><td>${esc(x.account || '')}</td><td class="num">${fmt(x.amount)}</td></tr>`).join('')}</tbody></table>` : '<p class="text-secondary">None recorded.</p>'}
   ${dd.proj != null && date >= S.dashboard.today ? `<p class="small text-secondary">Projected cash at end of day: <b>${fmt(dd.proj)}</b></p>` : ''}
   <button class="btn btn-primary" onclick="${hide};setTimeout(()=>A.addTx('${date}'),300)"><i class="bi bi-plus-circle"></i> Add expense on this day</button>`;
  bootstrap.Modal.getOrCreateInstance($('#dayModal')).show();
}
const nextDue = rows => rows.filter(r => r.state !== 'paid' && r.state !== 'done').sort((a, b) => (a.days_left ?? 999) - (b.days_left ?? 999))[0];
function itemKpis(rows, noun) {
  const paid = rows.filter(r => r.state === 'paid'), open = rows.filter(r => r.state !== 'paid' && r.state !== 'done'), nd = nextDue(rows);
  return `<div class="row g-3 mb-3"><div class="col-6 col-xl-3">${kpi('Monthly total', fmt(sum(rows, r => r.amount)), 'calendar-month', COL.blue, rows.length + ' ' + noun)}</div>
  <div class="col-6 col-xl-3">${kpi('Paid this month', fmt(sum(paid, r => r.amount)), 'check-circle', COL.green, paid.length + ' paid')}</div>
  <div class="col-6 col-xl-3">${kpi('Still to pay', fmt(sum(open, r => r.amount)), 'hourglass', COL.amber, open.length + ' open')}</div>
  <div class="col-6 col-xl-3">${kpi('Next due', nd ? esc(nd.name) : '–', 'alarm', COL.purple, nd ? 'in ' + nd.days_left + ' days (' + fmtS(nd.next_due) + ')' : '')}</div></div>`;
}
function pBills(el) {
  const rows = S.bills;
  el.innerHTML = itemKpis(rows, 'bills') + card('Bills', `<div class="mb-2"><button class="btn btn-primary btn-sm" onclick="A.addBill()"><i class="bi bi-plus-lg"></i> Add bill</button> <span class="small text-secondary ms-2">Click a header to sort · Mark paid updates everything instantly.</span></div>` + table('bills', [
    { k: 'name', label: 'Bill', r: r => `<b>${esc(r.name)}</b>${r.estimate ? ' <small class="text-secondary">~est</small>' : ''}${r.confirmed ? '' : ' ' + pill('unconfirmed', 'secondary')}` },
    { k: 'category', label: 'Category', r: r => pill(r.category, 'secondary') }, { k: 'amount', label: 'Amount', num: true, r: r => fmt(r.amount), t: rs => fmt(sum(rs, r => r.amount)) },
    { k: 'due_day', label: 'Due day', r: r => 'Day ' + r.due_day }, { k: 'next_due', label: 'Next due', r: r => fmtD(r.next_due) }, { k: 'days_left', label: 'Days left', r: r => daysPill(r.days_left), v: r => r.days_left ?? 9999 },
    { k: 'state', label: 'Status', r: r => statePill(r.state) }, { k: 'share', label: '% of monthly', r: r => prog(r.share, 'info'), v: r => r.share, t: () => '100%' },
    { k: 'note', label: 'Notes', r: r => `<small class="text-secondary">${esc(r.note)}</small>` }, { k: 'a', label: '', nosort: true, r: r => rowActs('payBill', 'unpayBill', 'editBill', 'delBill', r.idx, r.state) }], rows, { totals: true, sort: { k: 'days_left', dir: 1 } }));
}
function pDebts(el) {
  const rows = S.debts, last = rows.map(r => r.last_payment).filter(Boolean).sort().pop();
  el.innerHTML = `<div class="row g-3 mb-3"><div class="col-6 col-xl-3">${kpi('Monthly debt payments', fmt(sum(rows, r => r.monthly)), 'calendar-month', COL.blue)}</div><div class="col-6 col-xl-3">${kpi('Total still to pay', fmt(sum(rows, r => r.remaining_amount)), 'credit-card', COL.red, 'monthly × payments left')}</div>
  <div class="col-6 col-xl-3">${kpi('Payments left', sum(rows, r => r.remaining), 'list-ol', COL.amber)}</div><div class="col-6 col-xl-3">${kpi('Debt-free by', esc(fmtD(last)), 'flag', COL.green)}</div></div>` +
    card('Debts', `<div class="mb-2"><button class="btn btn-primary btn-sm" onclick="A.addDebt()"><i class="bi bi-plus-lg"></i> Add debt</button></div>` + table('debts', [
      { k: 'name', label: 'Debt', r: r => `<b>${esc(r.name)}</b>` }, { k: 'monthly', label: 'Monthly', num: true, r: r => fmt(r.monthly), t: rs => fmt(sum(rs, r => r.monthly)) },
      { k: 'principal', label: 'Principal', num: true, r: r => r.principal != null ? fmt(r.principal) : '–', t: rs => fmt(sum(rs, r => r.principal)) },
      { k: 'interest', label: 'Interest', r: r => r.interest != null ? esc(r.interest) + '%' : '<small class="text-secondary">unknown</small>' },
      { k: 'progress', label: 'Paid off', r: r => prog(r.progress, 'success', `${r.made}/${r.total}`), v: r => r.progress },
      { k: 'remaining', label: 'Left', num: true, r: r => r.remaining + ' pmts', t: rs => sum(rs, r => r.remaining) + ' pmts' }, { k: 'remaining_amount', label: 'Remaining ₱', num: true, r: r => fmt(r.remaining_amount), t: rs => fmt(sum(rs, r => r.remaining_amount)) },
      { k: 'next_due', label: 'Next due', r: r => fmtD(r.next_due) }, { k: 'days_left', label: 'Days left', r: r => daysPill(r.days_left), v: r => r.days_left ?? 9999 }, { k: 'state', label: 'Status', r: r => statePill(r.state) },
      { k: 'last_payment', label: 'Last payment', r: r => fmtD(r.last_payment) }, { k: 'note', label: 'Notes', r: r => `<small class="text-secondary">${esc(r.note)}</small>` },
      { k: 'a', label: '', nosort: true, r: r => rowActs('payDebt', 'unpayDebt', 'editDebt', 'delDebt', r.idx, r.state) }], rows, { totals: true })) +
    `<div class="alert alert-secondary mt-3 small mb-0"><i class="bi bi-info-circle"></i> The <b>Car loan</b> is under Bills (no remaining-payments data yet). Edit it and set “Payments remaining” to include it in the debt projection.</div>`;
}

function pAccounts(el) {
  const tot = sum(S.accounts, a => a.balance), em = S.dashboard.emergency;
  el.innerHTML = `<div class="row g-3 mb-3"><div class="col-md-4">${kpi('Total cash', fmt(tot), 'bank', COL.blue, S.accounts.length + ' accounts')}</div><div class="col-md-4">${kpi('Confirmed income / month', fmt(sum(S.income.filter(i => i.confirmed), i => i.amount)), 'cash-coin', COL.green, 'pending income not counted')}</div><div class="col-md-4">${kpi('Pending income / month', fmt(sum(S.income.filter(i => !i.confirmed), i => i.amount)), 'hourglass-split', COL.amber, 'unconfirmed')}</div></div>
  <div class="row g-3"><div class="col-12 col-xl-6">${card('Accounts', `<button class="btn btn-primary btn-sm mb-2" onclick="A.addAcct()"><i class="bi bi-plus-lg"></i> Add account</button>` + table('acc', [
    { k: 'name', label: 'Account', r: r => `<b>${esc(r.name)}</b>` }, { k: 'balance', label: 'Balance', num: true, r: r => fmt(r.balance), t: rs => fmt(sum(rs, r => r.balance)) },
    { k: 'share', label: 'Share', v: r => tot ? r.balance / tot * 100 : 0, r: r => prog(tot ? r.balance / tot * 100 : 0, 'info') }, { k: 'confirmed', label: 'Status', r: r => r.confirmed ? pill('confirmed', 'success') : pill('unconfirmed', 'warning') },
    { k: 'a', label: '', nosort: true, r: r => crudActs('editAcct', 'delAcct', r.idx) }], S.accounts, { totals: true }))}</div>
  <div class="col-12 col-xl-6">${card('Income sources', `<button class="btn btn-primary btn-sm mb-2" onclick="A.addInc()"><i class="bi bi-plus-lg"></i> Add income</button>` + table('inc', [
    { k: 'name', label: 'Source', r: r => `<b>${esc(r.name)}</b>` }, { k: 'amount', label: 'Amount', num: true, r: r => fmt(r.amount) }, { k: 'period', label: 'Period' },
    { k: 'start_date', label: 'Start', r: r => fmtD(r.start_date) }, { k: 'pay_weekday', label: 'Payday' }, { k: 'confirmed', label: 'Status', r: r => r.confirmed ? pill('confirmed', 'success') : pill(r.status || 'pending', 'warning') },
    { k: 'note', label: 'Notes', r: r => `<small class="text-secondary">${esc(r.note)}</small>` }, { k: 'a', label: '', nosort: true, r: r => crudActs('editInc', 'delInc', r.idx) }], S.income, { empty: 'No income sources.' }))}</div>
  <div class="col-12 col-xl-6">${card('Emergency fund', `<div class="d-flex justify-content-between"><span>${fmt(em.fund)} saved</span><span>target ${fmt(em.target)} (${esc(em.months)} months of bills)</span></div>${prog(em.target ? em.fund / em.target * 100 : 0, 'success')}<button class="btn btn-sm btn-outline-primary mt-3" onclick="A.savings()"><i class="bi bi-pencil"></i> Edit emergency fund</button>`)}</div></div>`;
}
function pTx(el) {
  const rows = S.transactions, m = todayStr().slice(0, 7);
  el.innerHTML = `<div class="row g-3 mb-3"><div class="col-6 col-xl-3">${kpi('Spent today', fmt(S.dashboard.daily.spent_today), 'sun', COL.red, 'allowed ' + fmt(S.dashboard.daily.allowed_today))}</div><div class="col-6 col-xl-3">${kpi('Expenses this month', fmt(sum(rows.filter(r => r.type === 'expense' && r.date.startsWith(m)), r => r.amount)), 'cart', COL.amber)}</div>
  <div class="col-6 col-xl-3">${kpi('Bill payments this month', fmt(sum(rows.filter(r => r.type === 'bill_payment' && r.date.startsWith(m)), r => r.amount)), 'receipt', COL.blue)}</div><div class="col-6 col-xl-3">${kpi('Transactions', rows.length, 'list', COL.purple)}</div></div>` +
    card('Transactions', `<button class="btn btn-primary btn-sm mb-2" onclick="A.addTx()"><i class="bi bi-plus-lg"></i> Add expense / income</button> <span class="small text-secondary ms-2">An expense is deducted from the chosen account.</span>` + table('tx', [
      { k: 'date', label: 'Date', r: r => fmtD(r.date) }, { k: 'type', label: 'Type', r: r => pill(r.type.replace('_', ' '), r.type === 'expense' ? 'danger' : r.type === 'bill_payment' ? 'primary' : 'success') },
      { k: 'category', label: 'Category', r: r => pill(r.category, 'secondary') }, { k: 'note', label: 'Note' }, { k: 'account', label: 'Account', r: r => esc(r.account || '–') },
      { k: 'amount', label: 'Amount', num: true, r: r => (r.type === 'income' ? '+' : '−') + fmt(r.amount), t: rs => '−' + fmt(sum(rs.filter(r => r.type !== 'income'), r => r.amount)) },
      { k: 'a', label: '', nosort: true, r: r => crudActs('editTx', 'delTx', r.idx) }], rows, { totals: true, sort: { k: 'date', dir: -1 } }));
}
const daysTo = s => Math.round((new Date(s) - new Date(todayStr())) / 864e5);
function pGoals(el) {
  const g = S.goals, em = S.dashboard.emergency;
  el.innerHTML = `<div class="row g-3 mb-3"><div class="col-6 col-xl-3">${kpi('Goals saved', fmt(sum(g, x => x.saved)), 'piggy-bank', COL.green)}</div><div class="col-6 col-xl-3">${kpi('Goals target', fmt(sum(g, x => x.target)), 'bullseye', COL.blue)}</div>
  <div class="col-6 col-xl-3">${kpi('Emergency fund', fmt(em.fund), 'shield-check', COL.amber, 'of ' + fmt(em.target))}</div><div class="col-6 col-xl-3">${kpi('Still to save', fmt(sum(g, x => Math.max(x.target - x.saved, 0))), 'hourglass', COL.red)}</div></div>` +
    card('Goals', `<button class="btn btn-primary btn-sm mb-2" onclick="A.addGoal()"><i class="bi bi-plus-lg"></i> Add goal</button>` + table('goals', [
      { k: 'name', label: 'Goal', r: r => `<b>${esc(r.name)}</b>` }, { k: 'target', label: 'Target', num: true, r: r => fmt(r.target), t: rs => fmt(sum(rs, r => r.target)) }, { k: 'saved', label: 'Saved', num: true, r: r => fmt(r.saved), t: rs => fmt(sum(rs, r => r.saved)) },
      { k: 'left', label: 'Left', num: true, v: r => r.target - r.saved, r: r => fmt(Math.max(r.target - r.saved, 0)), t: rs => fmt(sum(rs, r => Math.max(r.target - r.saved, 0))) },
      { k: 'p', label: 'Progress', v: r => r.saved / r.target, r: r => prog(r.target ? r.saved / r.target * 100 : 0, r.saved >= r.target ? 'success' : 'primary') }, { k: 'deadline', label: 'Deadline', r: r => fmtD(r.deadline) },
      { k: 'dl', label: 'Days left', v: r => r.deadline ? daysTo(r.deadline) : 99999, r: r => r.deadline ? daysPill(daysTo(r.deadline)) : '–' },
      { k: 'need', label: 'Needed / month', num: true, nosort: true, r: r => { if (!r.deadline || r.saved >= r.target) return '–'; const mo = Math.max(daysTo(r.deadline) / 30.4, 1 / 30); return fmt((r.target - r.saved) / mo); } },
      { k: 'note', label: 'Notes', r: r => `<small class="text-secondary">${esc(r.note)}</small>` }, { k: 'a', label: '', nosort: true, r: r => crudActs('editGoal', 'delGoal', r.idx) }], g, { totals: true, empty: 'No goals yet – add one (e.g. PCs, room build).' })) +
    `<div class="mt-3">${card('Emergency fund', `${prog(em.target ? em.fund / em.target * 100 : 0, 'success', fmt(em.fund) + ' / ' + fmt(em.target))}<button class="btn btn-sm btn-outline-primary mt-3" onclick="A.savings()">Edit</button>`)}</div>`;
}
function pBusiness(el) {
  const b = S.dashboard.business, d = S.dashboard, lv = d.levels;
  const crossTxt = c => c ? (c.already ? 'already' : fmtD(c.date)) : 'not within a year';
  const scen = []; for (let n = b.pcs_min; n <= b.pcs_max; n++) { const cost = n * b.pc_price + b.room_build; scen.push({ n, cost, short: Math.max(cost - b.available_after_30d_bills, 0), pc: cost ? b.available_after_30d_bills / cost * 100 : 0 }); }
  el.innerHTML = `<div class="row g-3 mb-3"><div class="col-6 col-xl-3">${kpi('Cash now', fmt(b.cash), 'wallet2', COL.blue)}</div><div class="col-6 col-xl-3">${kpi('Usable after 30-day bills', fmt(b.available_after_30d_bills), 'unlock', COL.green)}</div>
  <div class="col-6 col-xl-3">${kpi('PCs affordable now', b.pcs_affordable, 'pc-display', COL.purple, `${b.pcs_by_cash} if you ignore upcoming bills`)}</div><div class="col-6 col-xl-3">${kpi('Emergency fund target', fmt(b.emergency_needed), 'shield', COL.amber, 'rule: ' + esc(b.rule))}</div></div>
  <div class="row g-3"><div class="col-12 col-xl-7">${card('Scenarios', `<button class="btn btn-sm btn-outline-primary mb-2" onclick="A.business()"><i class="bi bi-pencil"></i> Edit plan (${fmt(b.pc_price)}/PC, room ${fmt(b.room_build)})</button>` + table('scen', [
    { k: 'n', label: 'Scenario', r: r => `<b>${r.n} PCs + room build</b>` }, { k: 'cost', label: 'Total cost', num: true, r: r => fmt(r.cost) }, { k: 'short', label: 'Shortfall', num: true, r: r => `<span class="text-danger">${fmt(r.short)}</span>` },
    { k: 'pc', label: 'Covered', r: r => prog(r.pc, r.pc >= 100 ? 'success' : 'primary'), v: r => r.pc }, { k: 'st', label: 'Status', nosort: true, r: r => r.short <= 0 ? pill('Affordable', 'success') : pill('Not yet', 'danger') }], scen))}
    <div class="mt-3">${card('Cost breakdown', `<table class="table table-sm mb-0"><tbody><tr><td>PC price</td><td class="num">${fmt(b.pc_price)}</td></tr><tr><td>${b.pcs_min}–${b.pcs_max} PCs</td><td class="num">${fmt(b.pc_price * b.pcs_min)} – ${fmt(b.pc_price * b.pcs_max)}</td></tr><tr><td>Room build</td><td class="num">${fmt(b.room_build)}</td></tr><tr class="fw-bold"><td>Total</td><td class="num">${fmt(b.cost_low)} – ${fmt(b.cost_high)}</td></tr></tbody></table>`)}</div></div>
  <div class="col-12 col-xl-5">${card('Cash vs cost', canvas('c_biz'))}<div class="mt-3">${card('Warning levels', `<div class="small">Cash falls below the business-start line (${fmt(lv.business)}): <b>${crossTxt(lv.business_cross)}</b><br>WARNING: <b>${crossTxt(lv.warning_cross)}</b> · CRITICAL: <b>${crossTxt(lv.critical_cross)}</b><br><span class="text-secondary">With no income, every day of spending moves the business further away.</span></div>`)}</div></div></div>`;
  mkChart('c_biz', { type: 'bar', data: { labels: ['Cash now', 'Usable', `${b.pcs_min} PCs+room`, `${b.pcs_max} PCs+room`], datasets: [{ data: [b.cash, b.available_after_30d_bills, b.cost_low, b.cost_high], backgroundColor: [COL.blue, COL.green, COL.purple, COL.pink] }] }, options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmt(c.parsed.y) } } }, scales: { y: { ticks: { callback: v => fmt(v) } } } } });
}
async function pNotes(el) {
  el.innerHTML = '<div class="text-center p-4"><div class="spinner-border"></div></div>';
  const [ch, nt] = await Promise.all([api('/api/changes'), api('/api/notes')]);
  const lvl = { info: 'info', warning: 'warning', critical: 'danger', danger: 'danger' };
  const bc = { create: 'success', update: 'primary', delete: 'danger', mark_paid: 'success', unpay: 'warning' };
  el.innerHTML = `<div class="row g-3"><div class="col-12 col-xl-4">${card('<i class="bi bi-megaphone"></i> Notes from Financial Manager', nt.notes.length ? nt.notes.map(n => `<div class="alert alert-${lvl[n.level] || 'info'} py-2"><div>${esc(n.text)}</div><small class="opacity-75">${esc((n.timestamp || '').replace('T', ' ').slice(0, 16))}</small></div>`).join('') : '<p class="text-secondary">No notes yet.</p>')}
  <div class="mt-3">${card('Your alerts', `<button class="btn btn-sm btn-primary mb-2" onclick="A.addAlert()"><i class="bi bi-plus-lg"></i> Add alert</button>` + (S.alert_list.length ? S.alert_list.map(a => `<div class="d-flex justify-content-between border-bottom py-1 gap-2"><span>${esc(a.text)}</span><button class="btn btn-sm btn-outline-danger" onclick="A.delAlert(${a.idx})"><i class="bi bi-trash"></i></button></div>`).join('') : '<p class="text-secondary mb-0">No alerts.</p>'))}</div>
  <div class="mt-3">${card('Missing info', `<ul class="mb-0">${S.missing_info.map(m => `<li>${esc(m)}</li>`).join('') || '<li>None</li>'}</ul>`)}</div></div>
  <div class="col-12 col-xl-8">${card('<i class="bi bi-clock-history"></i> Change log', `<div class="alert alert-secondary small py-2"><i class="bi bi-info-circle"></i> Every change is saved to <code>${esc(ch.file)}</code> (${ch.total} entries). It is <b>not</b> sent live to Financial Manager – the Developer agent syncs it on request.</div>` + table('chg', [
    { k: 'timestamp', label: 'When', r: r => esc(r.timestamp.replace('T', ' ').slice(0, 19)) }, { k: 'action', label: 'Action', r: r => pill(r.action, bc[r.action] || 'secondary') }, { k: 'entity', label: 'Entity' },
    { k: 'summary', label: 'What changed', r: r => `${esc(r.summary)}<details><summary class="small text-secondary">before / after</summary><div class="row g-1"><div class="col-6"><pre class="json">${esc(JSON.stringify(r.before, null, 1))}</pre></div><div class="col-6"><pre class="json">${esc(JSON.stringify(r.after, null, 1))}</pre></div></div></details>` }], ch.changes, { empty: 'No changes yet.', sort: { k: 'timestamp', dir: -1 } }))}</div></div>`;
}
const LINES = [['cash', 'Cash balance', COL.blue, 'Cash'], ['debt', 'Total debt outstanding', COL.red, 'Debt'], ['emergency', 'Emergency fund', COL.green, 'Savings'], ['emergency_target', 'Emergency target', COL.green, 'Savings', 1], ['goals_saved', 'Goals saved', COL.teal, 'Goals'], ['goals_target', 'Goals target', COL.teal, 'Goals', 1]];
let lineOn = { Cash: true, Debt: true, Savings: true, Goals: true, Thresholds: true }, projChart = null;
let HYPO = [];
try { 
  const v = localStorage.getItem('hypo_v2');
  if (v) { HYPO = JSON.parse(v); }
} catch(e) { HYPO = []; }
function saveHypo() { localStorage.setItem('hypo_v2', JSON.stringify(HYPO)); drawProj(); renderHypo(); }
async function drawProj() {
  if (!HYPO.length && S) {
    HYPO = [{ id: 'default_daily', name: 'Food & Transport Assumption', type: 'expense', amount: S.settings.daily_food_transport || 300, period: 'daily', start_date: S.dashboard.today, enabled: true, color: COL.pink }];
    localStorage.setItem('hypo_v2', JSON.stringify(HYPO));
  }
  const p = await getProj(true); const s = p.series;
  if (projChart) { projChart.destroy(); charts = charts.filter(c => c !== projChart); }
  const ds = LINES.filter(l => lineOn[l[3]]).map(l => ({ label: l[1], data: s.map(r => r[l[0]]), borderColor: l[2], backgroundColor: l[2] + '22', fill: l[0] === 'cash', tension: .15, pointRadius: 0, borderDash: l[4] ? [4, 4] : [], borderWidth: l[0] === 'cash' ? 3 : 2 }));
  if (p.has_hypos) {
    HYPO.filter(h => h.enabled).forEach(h => {
      ds.push({ label: 'What-if: ' + h.name, data: s.map(r => r.hypos[h.id]), borderColor: h.color || COL.pink, backgroundColor: (h.color || COL.pink) + '22', fill: false, tension: .15, pointRadius: 0, borderDash: [8, 3], borderWidth: 2 });
    });
  }
  if (lineOn.Thresholds) ds.push(...thLines(s, p.thresholds), { label: 'Zero', data: s.map(() => 0), borderColor: '#888', pointRadius: 0, borderWidth: 1, borderDash: [2, 2] });
  projChart = mkChart('c_proj', { type: 'line', data: { labels: s.map(r => fmtS(r.date)), datasets: ds }, options: { interaction: { mode: 'index', intersect: false }, plugins: { tooltip: money, legend: { position: 'bottom' } }, scales: { y: { ticks: { callback: v => fmt(v) } }, x: { ticks: { maxTicksLimit: 15 } } } } });
}
window.toggleHypo = (id, en) => { const h = HYPO.find(x => x.id === id); if (h) { h.enabled = en; saveHypo(); } };
window.toggleLine = (k, on) => { lineOn[k] = on; drawProj(); };
function renderHypo() {
  const el = $('#hypo-list'); if (!el) return;
  if (!HYPO.length) { el.innerHTML = ''; return; }
  el.innerHTML = table('hypo', [
    { k: 'name', label: 'Name', r: r => `<b>${esc(r.name)}</b> <span style="display:inline-block;width:12px;height:12px;background:${r.color||'#e86bb2'};border-radius:50%;margin-left:4px"></span>` },
    { k: 'type', label: 'Type', r: r => pill(r.type, r.type==='income'?'success':'danger') },
    { k: 'amount', label: 'Amount', num: true, r: r => fmt(r.amount) },
    { k: 'period', label: 'Period' },
    { k: 'start_date', label: 'Start', r: r => fmtD(r.start_date) },
    { k: 'enabled', label: 'On/Off', nosort: true, r: r => `<div class="form-check form-switch"><input class="form-check-input" type="checkbox" ${r.enabled!==false?'checked':''} onchange="toggleHypo('${esc(r.id)}', this.checked)"></div>` },
    { k: 'a', label: '', nosort: true, r: r => crudActs('editHypo', 'delHypo', `'${esc(r.id)}'`) }
  ], HYPO, { empty: 'No hypotheticals.' });
}
async function pAnalytics(el) {
  el.innerHTML = '<div class="text-center p-4"><div class="spinner-border"></div></div>';
  const a = await api('/api/analytics'); const d = S.dashboard;
  const tg = Object.keys(lineOn).map(k => `<input type="checkbox" class="btn-check" id="ln_${k}" ${lineOn[k] ? 'checked' : ''} onchange="toggleLine('${k}',this.checked)"><label class="btn btn-sm btn-outline-secondary" for="ln_${k}">${k}</label>`).join('');
  el.innerHTML = card('90-day projection (daily)', `<div class="d-flex flex-wrap gap-2 align-items-center mb-2"><div class="btn-group flex-wrap">${tg}</div>
    <button class="btn btn-sm btn-outline-primary" onclick="A.addHypo()"><i class="bi bi-plus-lg"></i> Add hypothetical</button></div>
    <div class="small text-secondary mb-2">Cash = today's cash − scheduled bills &amp; debt payments. (The daily food &amp; transport assumption is now an adjustable What-If scenario below!)</div>${canvas('c_proj', 'tall')}
    <div id="hypo-list" class="mt-3"></div>`) + `
  <div class="row g-3 mt-0"><div class="col-12 col-md-6 col-xl-4">${card('Spending by category (all outflows)', canvas('c1'))}</div><div class="col-12 col-md-6 col-xl-4">${card('Monthly commitments by category', canvas('c2'))}</div>
  <div class="col-12 col-md-6 col-xl-4">${card('Bills paid vs unpaid (' + esc(a.month) + ')', canvas('c3'))}</div>
  <div class="col-12 col-md-6 col-xl-4">${card('Bills this month by due date', canvas('c4'))}</div><div class="col-12 col-md-6 col-xl-4">${card('Cash vs reserved vs unallocated', canvas('c5'))}</div>
  <div class="col-12 col-md-6 col-xl-4">${card('Runway gauge', canvas('c6', 'sm') + `<div class="text-center fw-bold">${d.runway_days != null ? Math.round(d.runway_days) : '–'} days of cash at ${fmt(d.levels.burn)}/day</div>`)}</div>
  <div class="col-12 col-xl-8">${card('Daily spending – last 30 days', canvas('c7'))}</div><div class="col-12 col-xl-4">${card('Debt payoff', a.debts.length ? a.debts.map(x => `<div class="mb-3"><div class="d-flex justify-content-between"><b>${esc(x.name)}</b><small>${fmt(x.remaining_amount)} left</small></div>${prog(x.progress, 'success', x.made + '/' + x.total)}</div>`).join('') : '<p class="text-secondary">No debts.</p>')}</div>
  <div class="col-12">${card('Upcoming 30 days timeline', table('tl', [{ k: 'due', label: 'Date', r: r => fmtD(r.due) }, { k: 'name', label: 'Item', r: r => `<b>${esc(r.name)}</b>${r.est ? ' <small class="text-secondary">~est</small>' : ''}` }, { k: 'kind', label: 'Type', r: r => pill(r.kind, 'secondary') }, { k: 'days', label: 'Days left', r: r => daysPill(r.days) }, { k: 'st', label: 'Status', nosort: true, r: r => r.days < 0 ? pill('overdue', 'danger') : pill('upcoming', 'primary') },
    { k: 'amount', label: 'Amount', num: true, r: r => fmt(r.amount), t: rs => fmt(sum(rs, r => r.amount)) }, { k: 'cum', label: 'Cumulative', num: true, nosort: true, r: r => fmt(a.upcoming.filter(u => u.due <= r.due).reduce((x, u) => x + u.amount, 0)) }], a.upcoming, { totals: true, sort: { k: 'due', dir: 1 } }))}</div></div>`;
  const doughnut = (id, obj) => { const k = Object.keys(obj); mkChart(id, { type: 'doughnut', data: { labels: k, datasets: [{ data: k.map(x => obj[x]), backgroundColor: PAL, borderWidth: 0 }] }, options: { cutout: '55%', plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => ` ${c.label}: ${fmt(c.parsed)}` } } } } }); };
  doughnut('c1', a.by_category); doughnut('c2', a.commitments);
  mkChart('c3', { type: 'doughnut', data: { labels: ['Paid', 'Unpaid'], datasets: [{ data: [a.paid.amount, a.paid.unpaid_amount], backgroundColor: [COL.green, COL.amber], borderWidth: 0 }] }, options: { cutout: '55%', plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => ` ${c.label}: ${fmt(c.parsed)} (${c.dataIndex ? a.paid.unpaid_n : a.paid.n} bills)` } } } } });
  mkChart('c4', { type: 'bar', data: { labels: a.month_bars.map(b => `${b.due_day}th ${b.name}`), datasets: [{ data: a.month_bars.map(b => b.amount), backgroundColor: a.month_bars.map(b => b.paid ? COL.green : COL.blue) }] }, options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + fmt(c.parsed.x) + (a.month_bars[c.dataIndex].paid ? ' (paid)' : ' (due)') } } }, scales: { x: { ticks: { callback: v => fmt(v) } } } } });
  mkChart('c5', { type: 'bar', data: { labels: ['Cash'], datasets: [{ label: 'Reserved for bills', data: [a.cash_split.reserved], backgroundColor: COL.amber }, { label: 'Unallocated', data: [Math.max(a.cash_split.unallocated, 0)], backgroundColor: COL.green }] }, options: { indexAxis: 'y', plugins: { tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.parsed.x)}` } }, legend: { position: 'bottom' } }, scales: { x: { stacked: true, ticks: { callback: v => fmt(v) } }, y: { stacked: true } } } });
  const rd = Math.min(d.runway_days || 0, 120);
  mkChart('c6', { type: 'doughnut', data: { labels: ['Days of cash', 'to 120'], datasets: [{ data: [rd, 120 - rd], backgroundColor: [rd < 30 ? COL.red : rd < 60 ? COL.amber : COL.green, 'rgba(128,128,128,.2)'], borderWidth: 0 }] }, options: { rotation: -90, circumference: 180, cutout: '70%', plugins: { legend: { display: false }, tooltip: { enabled: false } } } });
  mkChart('c7', { type: 'bar', data: { labels: a.history.map(h => fmtS(h.date)), datasets: [{ label: 'Expenses', data: a.history.map(h => h.expense), backgroundColor: COL.red }, { label: 'Bill payments', data: a.history.map(h => h.bills), backgroundColor: COL.blue }] }, options: { plugins: { tooltip: money }, scales: { x: { stacked: true, ticks: { maxTicksLimit: 15 } }, y: { stacked: true, ticks: { callback: v => fmt(v) } } } } });
  projChart = null; drawProj(); renderHypo();
}
function setTheme(t) { document.documentElement.setAttribute('data-bs-theme', t); try { if (!new URLSearchParams(location.search).get('theme')) localStorage.setItem('theme', t); } catch (e) { } document.querySelectorAll('.theme-btn i').forEach(i => i.className = 'bi bi-' + (t === 'dark' ? 'sun' : 'moon-stars')); if (S) render(); }
document.querySelectorAll('.theme-btn').forEach(b => b.onclick = () => setTheme(document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark'));
$('#btn-settings').onclick = settingsForm;
buildNav(); watchTips(); masInit(); setTheme(document.documentElement.getAttribute('data-bs-theme') || 'dark');
refresh().catch(e => { $('#app').innerHTML = `<div class="alert alert-danger">Could not load data: ${esc(e.message)}</div>`; });
