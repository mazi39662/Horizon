'use strict';
/* Hover descriptions. Keys are lower-case label text; matching is exact, then prefix. */
const TIPS = {
  'hypothetical': 'A what-if scenario that is NOT counted as real cash.', 'hypotheticals': 'What-if income or expenses used only for projections.', 'notifications & warnings': 'Alerts and warnings about your finances.',
  'partner income': 'Optional income from your partner; only counted when switched on and confirmed.', 'household income / month': 'Your confirmed income plus partner income when counted.', 'net monthly': 'Monthly income minus bills and daily spending; negative means you are burning savings.', 'safe / day with partner': 'Safe-to-spend per day including partner income until the horizon date.', 'partner adds by horizon': 'Partner income expected to arrive before the horizon date.',
  // dashboard
  'cash now': 'Total current cash across all your accounts.',
  'reserved for bills': 'Money set aside for bills due before your next payday.',
  'left for daily spending': 'Cash minus reserved bills: what is free for everyday life (also called unallocated).',
  'runway': 'How many days your cash lasts at the current burn rate (bills + daily food/transport).',
  'safe to spend per day until': 'Free cash after bills due until the horizon date, divided by the days left.',
  'warning date': 'The day projected cash first falls below your WARNING level.',
  'critical date': 'The day projected cash first falls below your CRITICAL level (about 30 days of bills).',
  'cash hits zero': 'The day projected cash runs out at the current burn rate.',
  'below business-start line': 'When cash drops under the cost of starting the shop (PCs + room build).',
  'how the daily budget is computed': 'Step-by-step math behind your safe-to-spend per day.',
  'business start progress': 'How close your usable cash is to the cost of 3 or 4 PCs plus the room build.',
  'cash allocation': 'Split of your cash between bill reserve and daily-life money.',
  'upcoming bills (30 days)': 'Bills and debt payments due in the next 30 days.',
  'cash projection': 'Daily projected cash after scheduled bills and the daily spend assumption.',
  // tables / common headers
  'bill': 'Name of the bill.', 'debt': 'Name of the debt.', 'category': 'Type of expense, e.g. necessity or subscription.',
  'amount': 'Amount in pesos (₱).', 'due day': 'Day of the month the payment is due.', 'next due': 'Date of the next unpaid payment.',
  'days left': 'Days until the due date; red = overdue, amber = within 3 days.', 'status': 'Current state: paid, upcoming, due soon or overdue.',
  '% of monthly': 'Share of your total monthly fixed payments.', 'notes': 'Extra details about this item.',
  'due': 'Due date.', 'in': 'Days until due.', '₱': 'Amount in pesos.', 'when': 'Date and time of the change.', 'action': 'What kind of change it was.', 'entity': 'Which list was changed.',
  'what changed': 'Short summary of the change; expand for before/after values.',
  'monthly': 'Monthly payment amount.', 'principal': 'Original amount borrowed.', 'interest': 'Interest rate, if known.', 'paid off': 'Payments made out of total payments.',
  'left': 'Amount or payments still remaining.', 'remaining ₱': 'Monthly payment × payments still left.', 'last payment': 'Date of the final scheduled payment.',
  'account': 'Account the money came from or went to.', 'balance': 'Current balance of the account.', 'share': 'Share of your total cash.',
  'source': 'Where the income comes from.', 'period': 'How often the income is paid.', 'start': 'Date the income starts.', 'payday': 'Weekday you get paid.',
  'date': 'Date of the item.', 'type': 'Kind of entry.', 'note': 'Free-text note.', 'goal': 'Name of the savings goal.', 'target': 'Amount you want to reach.', 'saved': 'Amount saved so far.',
  'progress': 'How much of the target is done.', 'deadline': 'Date you want to reach the goal.', 'needed / month': 'Amount to save each month to hit the deadline.',
  'scenario': 'Business build option, e.g. 3 or 4 PCs plus room.', 'total cost': 'PCs plus room build cost.', 'shortfall': 'How much more cash you need.', 'covered': 'Share of the cost your usable cash covers.',
  'item': 'Bill or debt payment.', 'cumulative': 'Running total of payments up to this date.',
  // kpi per page
  'monthly total': 'Total of all monthly payments on this page.', 'paid this month': 'Payments already marked paid this month.', 'still to save': 'Total left to save across all goals.', 'still to pay': 'Payments not yet paid this month.', 'next due': 'The next payment coming up.',
  'monthly debt payments': 'Total monthly instalments for all debts.', 'total still to pay': 'All remaining instalments added up.', 'payments left': 'Number of instalments still to pay.', 'debt-free by': 'Date of your last scheduled debt payment.',
  'total cash': 'Sum of all account balances.', 'confirmed income / month': 'Monthly income that is confirmed and counted.', 'pending income / month': 'Income not confirmed yet; NOT counted as cash.',
  'accounts': 'Your bank and wallet balances.', 'income sources': 'Jobs or other income, confirmed or pending.', 'emergency fund': 'Savings kept for emergencies versus your target.',
  'spent today': 'Expenses recorded today.', 'expenses this month': 'Total expenses recorded this month.', 'bill payments this month': 'Bills marked paid this month.', 'transactions': 'All recorded expenses, income and bill payments.',
  'goals saved': 'Total saved across all goals.', 'goals target': 'Total target across all goals.', 'goals': 'Your savings goals with progress.',
  'usable after 30-day bills': 'Cash left after the next 30 days of bills.', 'pcs affordable now': 'How many PCs your usable cash covers after the room build.', 'emergency fund target': 'Emergency savings goal (months of bills).',
  'scenarios': 'Compare building with the minimum or maximum number of PCs.', 'cost breakdown': 'PC price, room build and totals.', 'cash vs cost': 'Cash and usable cash compared with the cost of each scenario.', 'warning levels': 'When cash crosses each warning level.',
  'notes from financial manager': 'Warnings and reminders left by Financial Manager.', 'your alerts': 'Your own manual alerts shown on the dashboard.', 'missing info': 'Details still needed to make the numbers exact.',
  'change log': 'Every change you made, saved to changes.json.', 'bills': 'Your recurring bills.', 'debts': 'Your loans and instalments.',
  // analytics
  '90-day projection': 'Daily projection of cash, debt, savings and goals; toggle lines on or off.',
  'spending by category': 'Where your money has gone, by category.', 'monthly commitments by category': 'Your fixed monthly payments grouped by category.',
  'bills paid vs unpaid': 'This month\'s bills split into paid and unpaid.', 'bills this month by due date': 'Each bill sized by amount in order of due date; green = paid.',
  'cash vs reserved vs unallocated': 'How your cash divides into reserved bills and free money.', 'runway gauge': 'Days of cash left compared with a 120-day scale.',
  'daily spending': 'Expenses and bill payments for each of the last 30 days.', 'debt payoff': 'Progress of each debt.', 'upcoming 30 days timeline': 'Every payment due in the next 30 days with a running total.'
};
function tipFor(text) {
  const t = (text || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/[▲▼]/g, '').trim(); if (!t) return '';
  if (TIPS[t]) return TIPS[t];
  const k = Object.keys(TIPS).sort((a, b) => b.length - a.length).find(k => k.length > 3 && t.startsWith(k));
  return k ? TIPS[k] : '';
}
let tipObs = null, tipTimer = null;
function applyTips() {
  document.querySelectorAll('.tooltip').forEach(e => e.remove());
  const set = (el, text) => { const tip = tipFor(text); if (!tip || el.dataset.tipd === tip) return; el.dataset.tipd = tip; el.setAttribute('data-bs-toggle', 'tooltip'); el.setAttribute('data-bs-title', tip); el.setAttribute('aria-label', tip); bootstrap.Tooltip.getInstance(el)?.dispose(); new bootstrap.Tooltip(el, { placement: 'top', trigger: 'hover focus', container: 'body' }); };
  document.querySelectorAll('#page .kpi').forEach(c => set(c, c.querySelector('.lbl')?.textContent));
  document.querySelectorAll('#page .lvl').forEach(c => set(c, c.querySelector('.small')?.textContent));
  document.querySelectorAll('#page .hero').forEach(c => { c.dataset.tipd = ''; set(c, 'safe to spend per day until'); });
  document.querySelectorAll('#page .card-header > span:first-child').forEach(h => { set(h, h.textContent); const card = h.closest('.card'); const cb = card?.querySelector('.chart-box'); const tip = tipFor(h.textContent); if (cb && tip && !cb.title) cb.title = tip; });
  document.querySelectorAll('#page table.dt th').forEach(h => set(h, h.textContent));
  document.querySelectorAll('#nav .nav-link').forEach(a => { if (!a.title) a.title = 'Open ' + a.textContent.trim(); });
}
function watchTips() { tipObs = new MutationObserver(() => { clearTimeout(tipTimer); tipTimer = setTimeout(applyTips, 60); }); tipObs.observe(document.getElementById('app'), { childList: true, subtree: true }); }
