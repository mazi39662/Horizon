#!/usr/bin/env python3
"""Finance calc. Commands: summary | due | month-end | add-expense AMT CAT [NOTE] [--account NAME] | mark-paid BILL [--account NAME] | alert TEXT"""
import json, sys, calendar, os
from datetime import date, datetime, timedelta
try:
    from zoneinfo import ZoneInfo
    ZoneInfo("Asia/Manila")
except Exception:  # Windows without tzdata: Manila is a fixed UTC+8 zone
    from datetime import timezone
    def ZoneInfo(_name): return timezone(timedelta(hours=8))
F = os.path.join(os.path.dirname(os.path.abspath(__file__)), "finance.json")
def load(): return json.load(open(F, encoding='utf-8'))
def save(d):
    d["last_updated"] = datetime.now(ZoneInfo("Asia/Manila")).isoformat(timespec="seconds")
    json.dump(d, open(F, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
def today(): return datetime.now(ZoneInfo("Asia/Manila")).date()
def php(n): return f"₱{n:,.0f}"
def dim(y, m): return calendar.monthrange(y, m)[1]
def due_date(y, m, day): return date(y, m, min(day, dim(y, m)))
def items(d):
    out = []
    for b in d["bills"]:
        amt = b["amount_usd"] * d["usd_php_rate"] if "amount_usd" in b else b["amount"]
        out.append(dict(name=b["name"], amount=amt, due_day=b["due_day"], status=b["status"], est=b.get("estimate", False) or not b.get("due_day_confirmed", True), kind="bill"))
    for x in d["debts"]:
        out.append(dict(name=x["name"], amount=x["monthly"], due_day=x["due_day"], status=x["status"], est=False, kind="debt"))
    return out
def next_payday(t):
    n = (4 - t.weekday()) % 7
    return t + timedelta(days=n or 7)
def occurrences(d, t, days):
    """Cycles from this month's (if unsettled & past) through t+days. Returns dicts with due, days, state."""
    res = []; end = t + timedelta(days=days)
    for it in items(d):
        for off in (0, 1, 2):
            y, m = t.year, t.month + off
            if m > 12: y, m = y + 1, m - 12
            dd = due_date(y, m, it["due_day"]); key = f"{y}-{m:02d}"
            st = it["status"].get(key)
            if dd > end: continue
            if dd < t:
                if st in (None, "paid"): continue   # unrecorded past cycles are not assumed owed
                if st != "unconfirmed": continue
            if st == "paid": continue
            res.append(dict(it, due=dd, days=(dd - t).days, state=st or "unpaid", key=key))
    return sorted(res, key=lambda r: r["due"])
def monthly_fixed(d): return sum(i["amount"] for i in items(d))
def totals(d):
    t = today(); cash = sum(a["balance"] for a in d["accounts"])
    pd = next_payday(t); res_items = occurrences(d, t, (pd - t).days)
    reserved = sum(r["amount"] for r in res_items)
    unalloc = cash - reserved; fixed = monthly_fixed(d)
    ef = d["savings"]["emergency_fund"]; ef_target = fixed * d["savings"]["emergency_target_months"]
    # allocation of unallocated cash
    later = [r for r in occurrences(d, t, 30) if r not in res_items]
    essentials = sum(r["amount"] for r in later)
    rem = max(unalloc - essentials, 0)
    emergency = min(rem, max(ef_target - ef, 0)); rem -= emergency
    income_confirmed = any(i.get("confirmed") for i in d["income"])
    b = d["business"]; lo = b["pc_price"] * b["pcs_min"] + b["room_build"]; hi = b["pc_price"] * b["pcs_max"] + b["room_build"]
    business = min(rem, lo) if (ef >= ef_target and income_confirmed) else 0; rem -= business
    need_lo = lo + ef_target + essentials
    return dict(cash=cash, next_payday=pd, reserved=reserved, reserved_items=res_items, unallocated=unalloc,
        fixed=fixed, runway=cash / fixed if fixed else 0, ef=ef, ef_target=ef_target,
        alloc=dict(essentials_next30=essentials, emergency=emergency, business=business, flexible=rem),
        biz=dict(low=lo, high=hi, affordable=business >= lo, shortfall_low=max(need_lo - cash, 0),
                 note="Needs confirmed income + full emergency fund first" if not income_confirmed else ""))
def _monthly_amt(i):
    a = float(i.get("amount") or 0); p = (i.get("period") or "monthly").lower()
    return a * 52 / 12 if p == "weekly" else a * 26 / 12 if p == "biweekly" else 0 if p == "one-time" else a
def household_totals(d, daily=0, include_partner=None):
    """Totals with and without partner income. Partner income counts only if enabled AND confirmed (and > 0).
    include_partner=None uses partner.enabled; True/False overrides (what-if). daily = daily food/transport assumption."""
    p = d.get("partner") or {}
    
    own = sum(_monthly_amt(i) for i in d.get("income", []) if i.get("confirmed") and i.get("owner", "mine") == "mine")
    p_inc = sum(_monthly_amt(i) for i in d.get("income", []) if i.get("confirmed") and i.get("owner") == "partner")
    
    enabled = bool(p.get("enabled")) if include_partner is None else bool(include_partner)
    counted = enabled and p_inc > 0
    m = p_inc

    fixed = monthly_fixed(d); cash = sum(a["balance"] for a in d["accounts"])
    def blk(inc):
        net = inc - fixed - daily * 30
        return dict(income=inc, fixed=fixed, daily_spend=daily * 30, net_monthly=net, runway_days=None if net >= 0 else cash / (-net / 30))
    return dict(partner_enabled=enabled, partner_confirmed=p_inc > 0, partner_counted=counted, partner_monthly=m if counted else 0,
                cash=cash, without_partner=blk(own), with_partner=blk(own + m), active=blk(own + (m if counted else 0)))
def cmd_summary(d):
    t = today(); s = totals(d)
    print(f"CURRENT MONEY ({t}) confirmed cash {php(s['cash'])} | reserved until next payday ({s['next_payday']}) {php(s['reserved'])} | unallocated {php(s['unallocated'])}")
    print(f"Fixed monthly (excl. food/transport, Grok est) {php(s['fixed'])} | runway {s['runway']:.1f} months | emergency fund {php(s['ef'])}/{php(s['ef_target'])}")
    print("UPCOMING (next 30 days; U=unconfirmed/overdue, ~=estimate):")
    for r in occurrences(d, t, 30):
        print(f"  {r['due']} ({r['days']:+d}d) {r['name']} {php(r['amount'])}{'~' if r['est'] else ''} [{r['state']}]")
    a = s["alloc"]
    print(f"ALLOCATION: essentials(next30d beyond reserve) {php(a['essentials_next30'])} | emergency {php(a['emergency'])} | business {php(a['business'])} | flexible {php(a['flexible'])}")
    b = s["biz"]; print(f"BUSINESS: cost {php(b['low'])}-{php(b['high'])}; affordable={b['affordable']}; extra cash needed for safe start (cost+emergency target+30d bills) ≥ {php(b['shortfall_low'])}. Income pending, not counted.")
    for x in d["alerts"]: print("ALERT:", x)
def cmd_due(d):
    t = today(); lines = []
    for r in occurrences(d, t, 3):
        if r["days"] in d["reminders"]["days_before"] or (r["days"] < 0 and r["state"] == "unconfirmed"):
            lines.append(f"{r['name']} {php(r['amount'])}{'~' if r['est'] else ''} due {r['due']} ({r['days']}d, {r['state']})")
    if lines: print("Bills needing attention:\n" + "\n".join(lines))
def cmd_month_end(d):
    t = today()
    if (t + timedelta(days=1)).day != 1: return
    print("MONTH-END"); cmd_summary(d)
    ex = [x for x in d["transactions"] if x["date"].startswith(t.strftime("%Y-%m")) and x["type"] == "expense"]
    by = {}
    for x in ex: by[x["category"]] = by.get(x["category"], 0) + x["amount"]
    print("Spending this month:", {k: php(v) for k, v in by.items()} or "none recorded")
def acct(d, name):
    for a in d["accounts"]:
        if a["name"].lower() == name.lower(): return a
    sys.exit(f"Unknown account {name}")
def opt(args, flag):
    if flag in args:
        i = args.index(flag); v = args[i + 1]; del args[i:i + 2]; return v
def cmd_add_expense(d, args):
    a = opt(args, "--account") or "Wallet"; amt = float(args[0]); cat = args[1]; note = " ".join(args[2:])
    acc = acct(d, a); acc["balance"] -= amt
    d["transactions"].append(dict(date=str(today()), type="expense", amount=amt, category=cat, note=note, account=a))
    save(d); print(f"Recorded {php(amt)} {cat} from {a}; balance {php(acc['balance'])}")
def cmd_mark_paid(d, args):
    a = opt(args, "--account"); q = " ".join(args).lower(); t = today()
    m = [i for i in items(d) if q in i["name"].lower()]
    if len(m) != 1: sys.exit(f"Bill match error: {[i['name'] for i in m]}")
    nm = m[0]["name"]; occ = [o for o in occurrences(d, t, 30) if o["name"] == nm]
    if not occ: sys.exit("No open cycle to mark")
    o = occ[0]; src = d["bills"] + d["debts"]
    rec = next(x for x in src if x["name"] == nm); rec["status"][o["key"]] = "paid"
    msg = f"Marked {nm} paid for {o['key']}"
    if a:
        acc = acct(d, a); acc["balance"] -= o["amount"]; msg += f"; deducted {php(o['amount'])} from {a}"
    else: msg += " (no balance deducted; pass --account to deduct)"
    d["transactions"].append(dict(date=str(t), type="bill_payment", amount=o["amount"], category=m[0]["kind"], note=nm, account=a or None))
    save(d); print(msg)
if __name__ == "__main__":
    d = load(); c = sys.argv[1] if len(sys.argv) > 1 else "summary"; a = sys.argv[2:]
    if c == "summary": cmd_summary(d)
    elif c == "due": cmd_due(d)
    elif c == "month-end": cmd_month_end(d)
    elif c == "add-expense": cmd_add_expense(d, a)
    elif c == "mark-paid": cmd_mark_paid(d, a)
    elif c == "alert": d["alerts"].append(" ".join(a)); save(d)
    else: sys.exit(__doc__)
