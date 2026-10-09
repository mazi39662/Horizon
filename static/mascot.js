'use strict';
/* Mascot speech-bubble widget driven by notes.json (/api/notes). One bubble, rotates through notes that have an emotion. */
const DEFAULT_TEXT = 'Hello! I am your AI Grok Bot. How can I assist you with your finances today?';
let MAS = { map: {}, def: 'Introducing' }, masList = [], masIdx = 0, masOpen = false, masSeen = '', masHover = false, masTimer = null;
const masKey = n => n ? (n.timestamp || '') + '|' + (n.text || '') : 'default';
const masImg = e => { const m = MAS.map; const f = m[e] || m[MAS.def] || Object.values(m)[0]; return f ? '/mascots/' + f.split('/').map(encodeURIComponent).join('/') : ''; };
function masSort(notes) {
  const w = (notes || []).map((n, i) => [n, i]).filter(([n]) => n && n.emotion && String(n.emotion).trim());
  w.sort((a, b) => String(b[0].timestamp || '').localeCompare(String(a[0].timestamp || '')) || b[1] - a[1]);
  return w.map(x => x[0]);
}
function masCur() { return masList.length ? masList[masIdx % masList.length] : null; }
function masMark() { try { masSeen = masKey(masList[0] || null); localStorage.setItem('masSeen', masSeen); } catch (e) { } }
function masRender() {
  const el = document.getElementById('mascot'); if (!el) return;
  const n = masCur(), emo = n ? n.emotion : MAS.def, text = n ? n.text : DEFAULT_TEXT, lvl = n ? (n.level || 'info') : 'info';
  const cls = { warning: 'danger', reminder: 'primary', info: 'info' }[lvl] || 'info'; const unseen = masList.length && masKey(masList[0]) !== masSeen;
  const img = masImg(emo), multi = masList.length > 1;
  el.className = 'mascot ' + (masOpen ? 'open' : 'closed');
  el.innerHTML = `<div class="mas-bubble border-${cls}"><button class="mas-x" aria-label="Collapse" title="Collapse">&times;</button><div class="small text-uppercase fw-bold text-${cls}">${esc(lvl)} · ${esc(emo)}</div><div>${esc(text)}</div>
    <div class="d-flex align-items-center gap-2 mt-1 small text-secondary">${n && n.timestamp ? `<span>${esc(String(n.timestamp).replace('T', ' ').slice(0, 16))}</span>` : ''}
    ${multi ? `<span class="ms-auto d-flex align-items-center gap-1"><button class="mas-nav" data-d="-1" aria-label="Previous message" title="Previous">&lsaquo;</button><span>${masIdx % masList.length + 1}/${masList.length}</span><button class="mas-nav" data-d="1" aria-label="Next message" title="Next">&rsaquo;</button></span>` : ''}</div></div>
  <button class="mas-btn" aria-label="Mascot" title="${masOpen ? 'Hide' : 'Show'} message">${img ? `<img src="${esc(img)}" alt="${esc(emo)}" onerror="this.style.display='none'">` : ''}${!masOpen && unseen ? `<span class="mas-dot bg-${cls}"></span>` : ''}</button>`;
  el.querySelector('.mas-x').onclick = () => { masOpen = false; masMark(); masRender(); };
  el.querySelector('.mas-btn').onclick = () => { masOpen = !masOpen; if (masOpen) masMark(); masRender(); };
  el.querySelectorAll('.mas-nav').forEach(b => b.onclick = e => { e.stopPropagation(); masIdx = (masIdx + (+b.dataset.d) + masList.length) % masList.length; masRender(); });
}
function masTick() { if (masOpen && !masHover && masList.length > 1) { masIdx = (masIdx + 1) % masList.length; masRender(); } }
async function masPoll(first) {
  try {
    const j = await (await fetch('/api/notes', { cache: 'no-store' })).json(); const nl = masSort(j.notes);
    const changed = nl.map(masKey).join('~') !== masList.map(masKey).join('~');
    if (changed) { masList = nl; masIdx = 0; if (nl.length && nl[0].level === 'warning' && masKey(nl[0]) !== masSeen) masOpen = true; }
    if (first || changed) masRender();
  } catch (e) { if (first) masRender(); }
}
async function masInit() {
  const d = document.createElement('div'); d.id = 'mascot'; document.body.appendChild(d);
  d.addEventListener('mouseenter', () => masHover = true); d.addEventListener('mouseleave', () => masHover = false);
  try { masSeen = localStorage.getItem('masSeen') || ''; } catch (e) { }
  try { const j = await (await fetch('/mascots/mascots.json', { cache: 'no-store' })).json(); MAS = { map: j.emotions || {}, def: j.default || 'Introducing' }; } catch (e) { }
  await masPoll(true); setInterval(() => masPoll(false), 30000); masTimer = setInterval(masTick, 6000);
}
