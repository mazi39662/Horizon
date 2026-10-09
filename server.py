#!/usr/bin/env python3
"""Boss Finance dashboard server. stdlib only, binds 127.0.0.1. Usage: python server.py [port]"""
import json, os, sys, shutil, threading, mimetypes, uuid, math, webbrowser, socket
from datetime import date, datetime, timedelta
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import calc as C
FIN = os.path.join(HERE, "finance.json")
CHG = os.path.join(HERE, "changes.json")
NOTES = os.path.join(HERE, "notes.json")
BK = os.path.join(HERE, "backups")
STATIC = os.path.join(HERE, "static")
LOCK = threading.RLock()
DEFAULT_SETTINGS = {"horizon_date": "2026-10-31", "daily_food_transport": 300, "emergency_reserve": 0,
                    "warning_threshold": None, "critical_threshold": None}

class ApiError(Exception):
    def __init__(self, msg, code=400): super().__init__(msg); self.code = code

# ---------- storage ----------
def now_iso(): return datetime.now(C.ZoneInfo("Asia/Manila")).isoformat(timespec="seconds")
def read_json(p, default):
    try:
        with open(p, encoding="utf-8") as f: return json.load(f)
    except FileNotFoundError: return default
def atomic_write(p, obj):
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False); f.flush(); os.fsync(f.fileno())
    os.replace(tmp, p)
def normalize(d):
    d.setdefault("accounts", []); d.setdefault("income", []); d.setdefault("bills", []); d.setdefault("debts", [])
    d.setdefault("transactions", []); d.setdefault("alerts", []); d.setdefault("goals", [])
    d.setdefault("usd_php_rate", 57); d.setdefault("savings", {}); d["savings"].setdefault("emergency_fund", 0)
    d["savings"].setdefault("emergency_target_months", 3)
    d.setdefault("business", {}); b = d["business"]
    for k, v in (("pc_price", 0), ("pcs_min", 3), ("pcs_max", 4), ("room_build", 0)): b.setdefault(k, v)
    d.setdefault("reminders", {})
    s = d.setdefault("settings", {})
    for k, v in DEFAULT_SETTINGS.items(): s.setdefault(k, v)
    for x in d["bills"] + d["debts"]:
        if not isinstance(x.get("status"), dict): x["status"] = {}
    for b_ in d["bills"]: b_.setdefault("amount", 0)
    return d
def load(): return normalize(read_json(FIN, {}))
def backup():
    if not os.path.exists(FIN): return
    os.makedirs(BK, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    shutil.copy2(FIN, os.path.join(BK, f"finance-{stamp}.json"))
    fs = sorted(f for f in os.listdir(BK) if f.startswith("finance-") and f.endswith(".json"))
    for f in fs[:-20]:
        try: os.remove(os.path.join(BK, f))
        except OSError: pass
def commit(d, before_d, action, entity, summary, before=None, after=None):
    """Backup, atomically write finance.json, append to changes.json."""
    d["last_updated"] = now_iso()
    backup(); atomic_write(FIN, d)
    ch = read_json(CHG, [])
    ch.append({"id": uuid.uuid4().hex[:10], "timestamp": now_iso(), "action": action, "entity": entity,
               "summary": summary, "before": before, "after": after})
    atomic_write(CHG, ch)

def today(): return C.today()
def php(n): return "₱{:,.0f}".format(n)

# ---------- schedule ----------
def my_items(d):
    its = C.items(d); nb = len(d["bills"])
    for n, it in enumerate(its):
        if n < nb: rec = d["bills"][n]; it["kind"] = "bill"; it["idx"] = n
        else: rec = d["debts"][n - nb]; it["kind"] = "debt"; it["idx"] = n - nb
        it["category"] = rec.get("category") or ("debt" if it["kind"] == "debt" else "other")
        it["limit"] = rec.get("payments_remaining") if rec.get("payments_remaining") not in ("", None) else None
        it["rec"] = rec; it["confirmed"] = rec.get("confirmed", True); it["note"] = rec.get("note", "")
    return its
def month_add(y, m, off):
    m0 = m - 1 + off; return y + m0 // 12, m0 % 12 + 1
def occ(d, t, days, its=None):
    end = t + timedelta(days=days); res = []
    for it in (its or my_items(d)):
        cnt = 0
        for off in range(0, days // 28 + 3):
            y, m = month_add(t.year, t.month, off)
            dd = C.due_date(y, m, it["due_day"]); key = f"{y}-{m:02d}"; st = it["status"].get(key)
            if dd > end: break
            if st == "paid": continue
            if dd < t and st != "unconfirmed": continue
            if it["limit"] is not None and cnt >= int(it["limit"]): break
            cnt += 1
            res.append({k: v for k, v in it.items() if k != "rec"} | dict(due=dd, days=(dd - t).days, state=st or "unpaid", key=key))
    return sorted(res, key=lambda r: (r["due"], r["name"]))

def settings_vals(d):
    s = d["settings"]
    def num(k, dflt):
        try: return float(s.get(k)) if s.get(k) not in (None, "") else dflt
        except (TypeError, ValueError): return dflt
    try: hz = date.fromisoformat(s.get("horizon_date") or "")
    except ValueError: hz = today() + timedelta(days=22)
    fixed = C.monthly_fixed(d); daily = num("daily_food_transport", 300)
    return dict(horizon=hz, daily=daily, reserve=num("emergency_reserve", 0),
                warning=num("warning_threshold", 2 * fixed + 30 * daily),
                critical=num("critical_threshold", fixed),
                warning_auto=s.get("warning_threshold") in (None, ""), critical_auto=s.get("critical_threshold") in (None, ""), fixed=fixed)

def projection(d, days=90, hypotheticals=None):
    t = today(); S = settings_vals(d); cash = sum(a["balance"] for a in d["accounts"])
    its = my_items(d); oc = occ(d, t, days + 31, its); by = {}
    for o in oc: by.setdefault(o["due"] if o["due"] > t else t, []).append(o)
    debt0 = 0.0
    for it in its:
        if it["kind"] == "debt" or (it["category"] == "debt" and it["limit"] is not None):
            if it["limit"] is not None: debt0 += it["amount"] * int(it["limit"])
    ef = d["savings"]["emergency_fund"]; ef_t = S["fixed"] * d["savings"]["emergency_target_months"]
    gs = sum(float(g.get("saved") or 0) for g in d["goals"]); gt = sum(float(g.get("target") or 0) for g in d["goals"])
    
    rows = []; c = cash; debt = debt0
    hypo_cum = {h["id"]: 0 for h in (hypotheticals or []) if h.get("enabled")}
    
    for i in range(days + 1):
        dt = t + timedelta(days=i); bills = 0; paid_debt = 0
        for o in by.get(dt, []):
            bills += o["amount"]
            if o["limit"] is not None and (o["kind"] == "debt" or o["category"] == "debt"): paid_debt += o["amount"]
        
        # Base cash no longer subtracts the daily assumption (it is moved to a hypothetical)
        spend = 0
        c -= bills + spend; debt = max(debt - paid_debt, 0)
        
        hypos_out = {}
        if hypotheticals:
            for h in hypotheticals:
                if not h.get("enabled"): continue
                hid = h["id"]
                try: st = date.fromisoformat(h.get("start_date") or str(t))
                except Exception: st = t
                if dt >= st:
                    match = False
                    p = h.get("period", "monthly")
                    if p == "one-time" and dt == st: match = True
                    elif p == "monthly" and dt.day == st.day: match = True
                    elif p == "weekly" and dt.weekday() == st.weekday(): match = True
                    elif p == "biweekly" and (dt - st).days % 14 == 0: match = True
                    elif p == "daily": match = True
                    if match:
                        if h.get("type") == "income": hypo_cum[hid] += float(h.get("amount", 0))
                        else: hypo_cum[hid] -= float(h.get("amount", 0))
                hypos_out[hid] = round(c + hypo_cum[hid], 2)

        rows.append(dict(date=str(dt), cash=round(c, 2), bills=round(bills, 2), daily=spend, debt=round(debt, 2),
                         emergency=ef, emergency_target=round(ef_t, 2), goals_saved=gs, goals_target=gt, hypos=hypos_out))
    th = dict(warning=S["warning"], critical=S["critical"], zero=0.0, business=d["business"]["pc_price"] * d["business"]["pcs_min"] + d["business"]["room_build"])
    return dict(series=rows, thresholds=th, start=str(t), daily=S["daily"], has_hypos=bool(hypo_cum))
def crossing(rows, thr):
    for i, r in enumerate(rows):
        if r["cash"] < thr: return dict(date=r["date"], days=i, already=(i == 0))
    return None

# ---------- views ----------
def cycle_list(it, t):
    out = []
    for off in range(0, 3):
        y, m = month_add(t.year, t.month, off); key = f"{y}-{m:02d}"; dd = C.due_date(y, m, it["due_day"])
        out.append(dict(key=key, due=str(dd), days=(dd - t).days, status=it["status"].get(key) or "unpaid"))
    return out
def item_views(d, kind):
    t = today(); its = [i for i in my_items(d) if i["kind"] == kind]; oc = occ(d, t, 400, None); res = []
    total_m = sum(i["amount"] for i in my_items(d)) or 1
    for it in its:
        rec = it["rec"]; cy = cycle_list(it, t); mine = [o for o in oc if o["kind"] == kind and o["idx"] == it["idx"]]
        focus = mine[0] if mine else None; cur = cy[0]
        if cur["status"] == "paid": state = "paid"
        elif focus and focus["due"] < t: state = "overdue"
        elif cur["days"] < 0: state = "unrecorded"
        elif focus is None: state = "done"
        elif focus["days"] == 0: state = "today"
        elif focus["days"] <= 3: state = "soon"
        else: state = "upcoming"
        if state == "done": state = "done"
        v = dict(idx=it["idx"], kind=kind, name=it["name"], amount=round(it["amount"], 2), due_day=it["due_day"], category=it["category"],
                 confirmed=it["confirmed"], estimate=bool(it["est"]), note=it["note"], state=state, cycles=cy,
                 next_due=str(focus["due"]) if focus else None, days_left=focus["days"] if focus else None,
                 next_key=focus["key"] if focus else None, share=round(it["amount"] / total_m * 100, 1), rec=rec)
        if kind == "debt":
            made = int(rec.get("payments_made") or 0); rem = int(rec.get("payments_remaining") or 0); tot = int(rec.get("total_payments") or (made + rem) or 0)
            v.update(monthly=rec.get("monthly", 0), principal=rec.get("principal"), interest=rec.get("interest"), made=made, remaining=rem, total=tot,
                     progress=round(made / tot * 100, 1) if tot else 0, remaining_amount=round(rec.get("monthly", 0) * rem, 2),
                     last_payment=str(mine[min(rem, len(mine)) - 1]["due"]) if mine and rem else None)
        else:
            lim = rec.get("payments_remaining")
            v["payments_remaining"] = lim
        res.append(v)
    return res

def spent_today(d):
    t = str(today()); return sum(x["amount"] for x in d["transactions"] if x.get("type") == "expense" and x.get("date") == t)

def dashboard(d):
    t = today(); S = settings_vals(d); T = C.totals(d); cash = T["cash"]
    horizon_days = max((S["horizon"] - t).days, 1)
    due_h = [o for o in occ(d, t, max((S["horizon"] - t).days, 0)) if o["due"] <= S["horizon"]]
    bills_h = sum(o["amount"] for o in due_h)
    free = cash - bills_h - S["reserve"]; per_day = free / horizon_days
    sp = spent_today(d); allowed_today = (free + sp) / horizon_days
    proj = projection(d, 365); rows = proj["series"]
    warn = crossing(rows, S["warning"]); crit = crossing(rows, S["critical"]); zero = crossing(rows, 0); biz_thr = proj["thresholds"]["business"]; biz_c = crossing(rows, biz_thr)
    b30 = sum(r["amount"] for r in occ(d, t, 30))
    burn = b30 / 30 + S["daily"]
    ib = d["business"]; lo = ib["pc_price"] * ib["pcs_min"] + ib["room_build"]; hi = ib["pc_price"] * ib["pcs_max"] + ib["room_build"]
    avail = max(cash - b30 - S["reserve"], 0)
    pcs = int(max((avail - ib["room_build"]) // ib["pc_price"], 0)) if ib["pc_price"] else 0
    pcs_raw = int(max((cash - ib["room_build"]) // ib["pc_price"], 0)) if ib["pc_price"] else 0
    alerts = [dict(level="info", text=a, source="alerts") for a in d["alerts"]]
    if free < 0: alerts.append(dict(level="danger", text=f"Cash does not cover bills due until {S['horizon']} (short by {php(-free)}).", source="computed"))
    elif per_day < S["daily"]: alerts.append(dict(level="warning", text=f"Safe-to-spend {php(per_day)}/day is below your daily food & transport assumption ({php(S['daily'])}).", source="computed"))
    if sp > allowed_today and allowed_today > 0: alerts.append(dict(level="warning", text=f"Spent today {php(sp)} exceeds today's allowance {php(allowed_today)}.", source="computed"))
    runway_m = cash / (burn * 30) if burn else 0
    if runway_m < 1: alerts.append(dict(level="danger", text=f"Runway only {runway_m*30:.0f} days at current burn ({php(burn)}/day).", source="computed"))
    elif runway_m < 2: alerts.append(dict(level="warning", text=f"Runway {runway_m*30:.0f} days at current burn ({php(burn)}/day).", source="computed"))
    for o in occ(d, t, 3):
        if o["days"] < 0: alerts.append(dict(level="danger", text=f"OVERDUE: {o['name']} {php(o['amount'])} was due {o['due']}.", source="computed"))
        elif o["days"] <= 3: alerts.append(dict(level="warning", text=f"{o['name']} {php(o['amount'])} due {'today' if o['days']==0 else 'in %dd (%s)' % (o['days'], o['due'])}.", source="computed"))
    if crit and not crit["already"] and crit["days"] <= 30: alerts.append(dict(level="danger", text=f"CRITICAL level ({php(S['critical'])}) is reached on {crit['date']} ({crit['days']} days).", source="computed"))
    elif crit and crit["already"]: alerts.append(dict(level="danger", text="Cash is already below the CRITICAL level.", source="computed"))
    if warn and warn["already"]: alerts.append(dict(level="warning", text="Cash is already below the WARNING level.", source="computed"))
    elif warn and warn["days"] <= 30: alerts.append(dict(level="warning", text=f"WARNING level ({php(S['warning'])}) is reached on {warn['date']} ({warn['days']} days).", source="computed"))
    if not any(i.get("confirmed") for i in d["income"]): alerts.append(dict(level="info", text="No confirmed income. Pending job income is NOT counted as cash.", source="computed"))
    lv = {"danger": 0, "warning": 1, "info": 2}; alerts.sort(key=lambda a: lv.get(a["level"], 3))
    if free < 0 or per_day < 0 or (crit and crit["days"] <= max((S["horizon"] - t).days, 1)): light = "red"
    elif per_day < S["daily"] or sp > allowed_today: light = "amber"
    else: light = "green"
    up = [dict(name=o["name"], kind=o["kind"], amount=round(o["amount"], 2), due=str(o["due"]), days=o["days"], state=o["state"], est=o["est"]) for o in occ(d, t, 30)]
    return dict(today=str(t), cash=cash, next_payday=str(T["next_payday"]), reserved=T["reserved"], unallocated=T["unallocated"],
        reserved_items=[dict(name=r["name"], amount=r["amount"], due=str(r["due"])) for r in T["reserved_items"]],
        daily=dict(horizon=str(S["horizon"]), days=horizon_days, bills_in_horizon=round(bills_h, 2), bills_list=[dict(name=o["name"], amount=o["amount"], due=str(o["due"])) for o in due_h],
                   reserve=S["reserve"], free=round(free, 2), per_day=round(per_day, 2), assumption=S["daily"], spent_today=sp, allowed_today=round(allowed_today, 2),
                   remaining_today=round(allowed_today - sp, 2), light=light, burn=round(burn, 2), bills30=round(b30, 2)),
        levels=dict(warning=S["warning"], critical=S["critical"], warning_auto=S["warning_auto"], critical_auto=S["critical_auto"], business=biz_thr,
                    warning_cross=warn, critical_cross=crit, zero_cross=zero, business_cross=biz_c, burn=round(burn, 2)),
        business=dict(name=ib.get("name"), pc_price=ib["pc_price"], pcs_min=ib["pcs_min"], pcs_max=ib["pcs_max"], room_build=ib["room_build"], cost_low=lo, cost_high=hi,
                      cash=cash, available_after_30d_bills=round(avail, 2), pcs_affordable=pcs, pcs_by_cash=pcs_raw,
                      progress_low=round(min(avail / lo * 100, 100), 1) if lo else 0, progress_high=round(min(avail / hi * 100, 100), 1) if hi else 0,
                      shortfall_low=round(max(lo - avail, 0), 2), shortfall_high=round(max(hi - avail, 0), 2), rule=ib.get("rule", ""),
                      status=ib.get("status", ""), emergency_needed=round(T["ef_target"], 2)),
        runway_days=round(cash / burn, 1) if burn else None, runway_months=round(runway_m, 2), fixed_monthly=S["fixed"],
        emergency=dict(fund=T["ef"], target=T["ef_target"], months=d["savings"]["emergency_target_months"]),
        alloc=T["alloc"], alerts=alerts, upcoming=up, last_updated=d.get("last_updated"), income_confirmed=any(i.get("confirmed") for i in d["income"]),
        missing_info=d.get("missing_info", []))

def calendar_view(d, ym):
    t = today()
    try: y, m = int(ym[:4]), int(ym[5:7]); date(y, m, 1)
    except Exception: y, m = t.year, t.month
    oc = occ(d, t, 500); oset = {(o["kind"], o["idx"], o["key"]): o for o in oc}
    proj = {r["date"]: r["cash"] for r in projection(d, 365)["series"]}
    pwd = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    pay_names = [(i["pay_weekday"].lower(), i) for i in d["income"] if i.get("pay_weekday")] or ([(d["reminders"].get("payday_weekday", "Friday").lower(), None)])
    days = {}
    for k in range(1, C.dim(y, m) + 1):
        dt = date(y, m, k); days[str(dt)] = dict(date=str(dt), items=[], tx=[], payday=[], proj=proj.get(str(dt)))
        for wd, inc in pay_names:
            if wd in pwd and dt.weekday() == pwd.index(wd) and (not (inc or {}).get('start_date') or str(dt) >= inc['start_date']):
                days[str(dt)]["payday"].append(dict(name=(inc or {}).get("name", "Payday"), confirmed=bool(inc and inc.get("confirmed")), amount=(inc or {}).get("amount")))
    key = f"{y}-{m:02d}"
    for it in my_items(d):
        dd = C.due_date(y, m, it["due_day"]); st = it["status"].get(key)
        if st == "paid": s = "paid"
        elif (it["kind"], it["idx"], key) in oset: s = "overdue" if dd < t else "open"
        elif dd < t and (y, m) == (t.year, t.month): s = "unrecorded"
        else: continue
        days[str(dd)]["items"].append(dict(name=it["name"], kind=it["kind"], amount=round(it["amount"], 2), status=s, est=bool(it["est"]), category=it["category"], idx=it["idx"], key=key, due=str(dd)))
    for inc in d["income"]:
        sd = inc.get("start_date")
        if sd in days: days[sd]["payday"].append(dict(name=inc["name"] + " – start", confirmed=bool(inc.get("confirmed")), amount=inc.get("amount"), start=True))
    for x in d["transactions"]:
        if x.get("date") in days: days[x["date"]]["tx"].append(dict(type=x.get("type"), amount=x.get("amount", 0), category=x.get("category"), note=x.get("note"), account=x.get("account")))
    first = date(y, m, 1)
    return dict(month=key, label=first.strftime("%B %Y"), first_weekday=first.weekday(), days=list(days.values()), today=str(t))

def analytics(d):
    t = today(); out_cat = {}; per_day = {}
    cats = {i["name"]: i["category"] for i in my_items(d)}
    for x in d["transactions"]:
        if x.get("type") in ("expense", "bill_payment"):
            c = x.get("category") or "other"
            if x["type"] == "bill_payment": c = cats.get(x.get("note"), c)
            out_cat[c] = out_cat.get(c, 0) + x["amount"]
            dd = per_day.setdefault(x["date"], {"expense": 0, "bills": 0})
            dd["expense" if x["type"] == "expense" else "bills"] += x["amount"]
    commit_cat = {}
    its = my_items(d)
    for i in its: commit_cat[i["category"]] = commit_cat.get(i["category"], 0) + i["amount"]
    key = f"{t.year}-{t.month:02d}"; bars = []; paid_amt = unpaid_amt = 0; paid_n = unpaid_n = 0
    for i in sorted(its, key=lambda i: i["due_day"]):
        st = i["status"].get(key); paid = st == "paid"
        if (not paid) and i["limit"] is not None and int(i["limit"]) == 0: continue
        bars.append(dict(name=i["name"], amount=round(i["amount"], 2), due_day=i["due_day"], paid=paid))
        if paid: paid_amt += i["amount"]; paid_n += 1
        else: unpaid_amt += i["amount"]; unpaid_n += 1
    hist = []
    for k in range(29, -1, -1):
        dt = str(t - timedelta(days=k)); v = per_day.get(dt, {"expense": 0, "bills": 0}); hist.append(dict(date=dt, expense=v["expense"], bills=v["bills"]))
    dv = item_views(d, "debt"); T = C.totals(d)
    return dict(by_category=out_cat, commitments=commit_cat, month_bars=bars, month=key, paid=dict(amount=paid_amt, n=paid_n, unpaid_amount=unpaid_amt, unpaid_n=unpaid_n),
                history=hist, debts=[dict(name=x["name"], progress=x["progress"], made=x["made"], total=x["total"], remaining_amount=x["remaining_amount"]) for x in dv],
                cash_split=dict(reserved=T["reserved"], unallocated=T["unallocated"], cash=T["cash"]), upcoming=dashboard(d)["upcoming"])

def state(d):
    t = today()
    return dict(dashboard=dashboard(d), bills=item_views(d, "bill"), debts=item_views(d, "debt"),
                accounts=[dict(idx=i, **a) for i, a in enumerate(d["accounts"])], income=[dict(idx=i, **x) for i, x in enumerate(d["income"])],
                transactions=[dict(idx=i, **x) for i, x in enumerate(d["transactions"])][::-1],
                goals=[dict(idx=i, **g) for i, g in enumerate(d["goals"])], settings=d["settings"], savings=d["savings"], business=d["business"],
                alert_list=[dict(idx=i, text=a) for i, a in enumerate(d["alerts"])], usd_php_rate=d["usd_php_rate"], missing_info=d.get("missing_info", []),
                categories=sorted({x.get("category") for x in d["transactions"] if x.get("category")} | {i["category"] for i in my_items(d)} | {"food", "transport", "other"}))

# ---------- CRUD ----------
def to_num(v, name, req=False, ge0=True, null=False):
    if v in (None, ""):
        if req: raise ApiError(f"{name} is required")
        return None
    try: n = float(v)
    except (TypeError, ValueError): raise ApiError(f"{name} must be a number")
    if math.isnan(n) or math.isinf(n): raise ApiError(f"{name} must be a number")
    if ge0 and n < 0: raise ApiError(f"{name} must be 0 or more")
    return int(n) if n == int(n) and abs(n) < 1e15 else n
def to_int(v, name, lo=None, hi=None, req=False):
    n = to_num(v, name, req)
    if n is None: return None
    if int(n) != n: raise ApiError(f"{name} must be a whole number")
    n = int(n)
    if (lo is not None and n < lo) or (hi is not None and n > hi): raise ApiError(f"{name} must be {lo}-{hi}")
    return n
def to_str(v, name, req=False, maxlen=300):
    v = "" if v is None else str(v).strip()
    if req and not v: raise ApiError(f"{name} is required")
    return v[:maxlen]
def to_date(v, name, req=False):
    v = to_str(v, name, req)
    if not v: return ""
    try: date.fromisoformat(v)
    except ValueError: raise ApiError(f"{name} must be YYYY-MM-DD")
    return v
def to_bool(v): return v in (True, "true", "1", 1, "on")
WD = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
# entity -> {field: (parser, required_on_create)}
SPEC = {
 "bills": dict(name=lambda v: to_str(v, "name", True), amount=lambda v: to_num(v, "amount", True), amount_usd=lambda v: to_num(v, "amount_usd"),
               due_day=lambda v: to_int(v, "due_day", 1, 31, True), category=lambda v: to_str(v, "category") or "other", confirmed=to_bool, estimate=to_bool,
               due_day_confirmed=to_bool, note=lambda v: to_str(v, "note", maxlen=500), payments_remaining=lambda v: to_int(v, "payments_remaining", 0)),
 "debts": dict(name=lambda v: to_str(v, "name", True), monthly=lambda v: to_num(v, "monthly", True), due_day=lambda v: to_int(v, "due_day", 1, 31, True),
               principal=lambda v: to_num(v, "principal"), interest=lambda v: to_num(v, "interest"), payments_made=lambda v: to_int(v, "payments_made", 0),
               payments_remaining=lambda v: to_int(v, "payments_remaining", 0), total_payments=lambda v: to_int(v, "total_payments", 0),
               note=lambda v: to_str(v, "note", maxlen=500)),
 "accounts": dict(name=lambda v: to_str(v, "name", True), balance=lambda v: to_num(v, "balance", True, ge0=False), confirmed=to_bool),
 "income": dict(name=lambda v: to_str(v, "name", True), amount=lambda v: to_num(v, "amount", True), period=lambda v: to_str(v, "period") or "monthly",
                pay_weekday=lambda v: to_str(v, "pay_weekday"), status=lambda v: to_str(v, "status") or "pending", confirmed=to_bool,
                start_date=lambda v: to_date(v, "start_date"), note=lambda v: to_str(v, "note", maxlen=500)),
 "goals": dict(name=lambda v: to_str(v, "name", True), target=lambda v: to_num(v, "target", True), saved=lambda v: to_num(v, "saved") or 0,
               deadline=lambda v: to_date(v, "deadline"), note=lambda v: to_str(v, "note", maxlen=500)),
}
NULLABLE = {"amount_usd", "interest", "principal", "payments_remaining", "payments_made", "total_payments", "start_date", "pay_weekday"}
def parse(entity, body, creating):
    out = {}; spec = SPEC[entity]
    for k, fn in spec.items():
        if k not in body:
            if creating and k in ("name", "amount", "due_day", "monthly", "balance", "target"): fn(None)  # raises required
            continue
        v = fn(body[k])
        if v in (None, "") and k in NULLABLE: v = None
        out[k] = v
    return out
def clean_none(rec):
    for k in ("amount_usd", "payments_remaining", "start_date", "pay_weekday"):
        if k in rec and rec[k] in (None, ""): rec.pop(k)
def recount(rec):
    if "amount_usd" in rec and rec["amount_usd"] is not None: pass

def crud(entity, method, idx, body):
    with LOCK:
        d = load(); before_state = None
        if entity == "settings":
            if method != "PUT": raise ApiError("use PUT", 405)
            before = dict(d["settings"]); s = d["settings"]
            if "horizon_date" in body: s["horizon_date"] = to_date(body["horizon_date"], "horizon_date", True)
            if "daily_food_transport" in body: s["daily_food_transport"] = to_num(body["daily_food_transport"], "daily_food_transport", True)
            if "emergency_reserve" in body: s["emergency_reserve"] = to_num(body["emergency_reserve"], "emergency_reserve") or 0
            for k in ("warning_threshold", "critical_threshold"):
                if k in body: s[k] = to_num(body[k], k)
            commit(d, None, "update", "settings", "Updated budget settings", before, dict(s)); return state(load())
        if entity == "savings":
            before = dict(d["savings"])
            if "emergency_fund" in body: d["savings"]["emergency_fund"] = to_num(body["emergency_fund"], "emergency_fund", True)
            if "emergency_target_months" in body: d["savings"]["emergency_target_months"] = to_num(body["emergency_target_months"], "emergency_target_months", True)
            commit(d, None, "update", "savings", f"Emergency fund now {php(d['savings']['emergency_fund'])}", before, dict(d["savings"])); return state(load())
        if entity == "business":
            before = dict(d["business"]); b = d["business"]
            for k in ("pc_price", "room_build"):
                if k in body: b[k] = to_num(body[k], k, True)
            for k in ("pcs_min", "pcs_max"):
                if k in body: b[k] = to_int(body[k], k, 1, 50, True)
            if "name" in body: b["name"] = to_str(body["name"], "name", True)
            if b["pcs_max"] < b["pcs_min"]: raise ApiError("pcs_max must be >= pcs_min")
            commit(d, None, "update", "business", "Updated business plan", before, dict(b)); return state(load())
        if entity == "alerts":
            if method == "POST":
                txt = to_str(body.get("text"), "text", True); d["alerts"].append(txt)
                commit(d, None, "create", "alerts", f"Added alert: {txt}", None, txt)
            elif method == "DELETE":
                if idx is None or not 0 <= idx < len(d["alerts"]): raise ApiError("not found", 404)
                old = d["alerts"].pop(idx); commit(d, None, "delete", "alerts", f"Deleted alert: {old}", old, None)
            else: raise ApiError("unsupported", 405)
            return state(load())
        if entity == "transactions":
            tx = d["transactions"]
            if method == "POST":
                amt = to_num(body.get("amount"), "amount", True)
                if amt <= 0: raise ApiError("amount must be greater than 0")
                typ = to_str(body.get("type"), "type") or "expense"
                if typ not in ("expense", "income", "transfer_in"): raise ApiError("type must be expense or income")
                acct = to_str(body.get("account"), "account") or None
                rec = dict(date=to_date(body.get("date") or str(today()), "date", True), type=typ, amount=amt, category=to_str(body.get("category"), "category") or "other",
                           note=to_str(body.get("note"), "note", maxlen=300), account=acct)
                msg = f"{'Expense' if typ=='expense' else 'Income'} {php(amt)} ({rec['category']})"
                if acct:
                    a = next((a for a in d["accounts"] if a["name"].lower() == acct.lower()), None)
                    if not a: raise ApiError(f"Unknown account {acct}")
                    rec["account"] = a["name"]; a["balance"] = a["balance"] + (amt if typ != "expense" else -amt); msg += f" {'to' if typ!='expense' else 'from'} {a['name']}; balance {php(a['balance'])}"
                tx.append(rec); commit(d, None, "create", "transactions", msg, None, rec)
            else:
                if idx is None or not 0 <= idx < len(tx): raise ApiError("not found", 404)
                old = dict(tx[idx])
                if method == "PUT":
                    for k, fn in (("date", lambda v: to_date(v, "date", True)), ("category", lambda v: to_str(v, "category") or "other"), ("note", lambda v: to_str(v, "note", maxlen=300))):
                        if k in body: tx[idx][k] = fn(body[k])
                    commit(d, None, "update", "transactions", f"Edited transaction {old.get('note') or old.get('category')} (amount/account unchanged)", old, dict(tx[idx]))
                elif method == "DELETE":
                    msg = f"Deleted transaction {php(old['amount'])} {old.get('note') or old.get('category')}"
                    if to_bool(body.get("restore")) and old.get("account"):
                        a = next((a for a in d["accounts"] if a["name"] == old["account"]), None)
                        if a: a["balance"] += old["amount"] if old["type"] == "expense" or old["type"] == "bill_payment" else -old["amount"]; msg += f"; restored to {a['name']}"
                    tx.pop(idx); commit(d, None, "delete", "transactions", msg, old, None)
            return state(load())
        if entity not in SPEC: raise ApiError("unknown entity", 404)
        lst = d[entity]
        if method == "POST":
            rec = parse(entity, body, True)
            if any(x["name"].lower() == rec["name"].lower() for x in lst): raise ApiError(f"'{rec['name']}' already exists")
            if entity in ("bills", "debts"): rec["status"] = {}
            if entity == "bills" and rec.get("amount_usd"): rec["amount"] = round(rec["amount_usd"] * d["usd_php_rate"]); rec["estimate"] = True
            if entity == "goals": rec.setdefault("saved", 0)
            if entity == "debts":
                rec.setdefault("payments_made", 0); rec.setdefault("payments_remaining", 0); rec.setdefault("paid_log", [])
                rec["total_payments"] = rec.get("total_payments") or rec["payments_made"] + rec["payments_remaining"]
            clean_none(rec); lst.append(rec); commit(d, None, "create", entity, f"Added {entity[:-1] if entity!='income' else 'income source'} '{rec['name']}'", None, rec)
        else:
            if idx is None or not 0 <= idx < len(lst): raise ApiError("not found", 404)
            old = json.loads(json.dumps(lst[idx]))
            if method == "PUT":
                rec = parse(entity, body, False)
                if "name" in rec and any(i != idx and x["name"].lower() == rec["name"].lower() for i, x in enumerate(lst)): raise ApiError(f"'{rec['name']}' already exists")
                if entity == "bills" and "amount_usd" in rec and rec["amount_usd"]: rec["amount"] = round(rec["amount_usd"] * d["usd_php_rate"]); rec["estimate"] = True
                lst[idx].update(rec)
                for k in list(lst[idx].keys()):
                    if k in ("amount_usd", "payments_remaining", "start_date", "pay_weekday") and lst[idx][k] is None: lst[idx].pop(k)
                if entity == "bills" and "amount_usd" not in rec and "amount_usd" in lst[idx] and "amount" in rec and "amount_usd" not in body: pass
                commit(d, None, "update", entity, f"Updated '{lst[idx]['name']}'", old, lst[idx])
            elif method == "DELETE":
                lst.pop(idx); commit(d, None, "delete", entity, f"Deleted '{old['name']}'", old, None)
            else: raise ApiError("unsupported", 405)
        return state(load())

def cycle_action(body):
    with LOCK:
        d = load(); kind = body.get("kind"); action = body.get("action", "paid")
        if kind not in ("bill", "debt"): raise ApiError("kind must be bill or debt")
        lst = d["bills"] if kind == "bill" else d["debts"]; idx = to_int(body.get("idx"), "idx", 0, req=True)
        if idx >= len(lst): raise ApiError("not found", 404)
        rec = lst[idx]; key = to_str(body.get("key"), "key", True)
        try: y, m = int(key[:4]), int(key[5:7]); assert key[4] == "-" and 1 <= m <= 12
        except Exception: raise ApiError("key must be YYYY-MM")
        t = today(); before = json.loads(json.dumps(rec)); beforeB = [dict(a) for a in d["accounts"]]
        it = next(i for i in my_items(d) if i["kind"] == kind and i["idx"] == idx); amount = it["amount"]
        if action == "paid":
            if rec["status"].get(key) == "paid": raise ApiError("Already marked paid")
            if body.get("amount") not in (None, ""): amount = to_num(body["amount"], "amount")
            acct = to_str(body.get("account"), "account") or None; msg = f"Marked '{rec['name']}' paid for {key} ({php(amount)})"
            if acct:
                a = next((a for a in d["accounts"] if a["name"].lower() == acct.lower()), None)
                if not a: raise ApiError(f"Unknown account {acct}")
                acct = a["name"]; a["balance"] -= amount; msg += f"; deducted from {acct}, balance {php(a['balance'])}"
            else: msg += " (no account deducted)"
            rec["status"][key] = "paid"
            if kind == "debt":
                rec["payments_made"] = int(rec.get("payments_made") or 0) + 1
                rec["payments_remaining"] = max(int(rec.get("payments_remaining") or 0) - 1, 0)
                rec.setdefault("paid_log", []).append(dict(date=str(t), amount=amount, confirmed=True, cycle=key))
            elif rec.get("payments_remaining") not in (None, ""): rec["payments_remaining"] = max(int(rec["payments_remaining"]) - 1, 0)
            d["transactions"].append(dict(date=str(t), type="bill_payment", amount=amount, category=kind, note=rec["name"], account=acct, cycle=key))
            commit(d, None, "mark_paid", kind + "s", msg, before, rec)
        elif action == "unpay":
            if rec["status"].get(key) != "paid": raise ApiError("That cycle is not marked paid")
            rec["status"].pop(key); msg = f"Reverted paid status of '{rec['name']}' for {key}"
            tx = next((x for x in reversed(d["transactions"]) if x.get("type") == "bill_payment" and x.get("note") == rec["name"] and x.get("cycle", key) == key), None)
            if tx:
                if tx.get("account"):
                    a = next((a for a in d["accounts"] if a["name"] == tx["account"]), None)
                    if a: a["balance"] += tx["amount"]; msg += f"; refunded {php(tx['amount'])} to {a['name']}"
                d["transactions"].remove(tx)
            if kind == "debt":
                rec["payments_made"] = max(int(rec.get("payments_made") or 0) - 1, 0); rec["payments_remaining"] = int(rec.get("payments_remaining") or 0) + 1
                pl = rec.get("paid_log") or []
                for e in reversed(pl):
                    if e.get("cycle") == key: pl.remove(e); break
            elif rec.get("payments_remaining") not in (None, ""): rec["payments_remaining"] = int(rec["payments_remaining"]) + 1
            commit(d, None, "unpay", kind + "s", msg, before, rec)
        else: raise ApiError("action must be paid or unpay")
        return state(load())

# ---------- HTTP ----------
class H(BaseHTTPRequestHandler):
    server_version = "BossFinance/1.0"
    def log_message(self, *a): pass
    def _send(self, code, obj=None, raw=None, ctype="application/json; charset=utf-8"):
        body = raw if raw is not None else json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store"); self.send_header("X-Content-Type-Options", "nosniff"); self.end_headers()
        if self.command != "HEAD": self.wfile.write(body)
    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 1_000_000: raise ApiError("too large", 413)
        if not n: return {}
        try: v = json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception: raise ApiError("invalid JSON")
        if not isinstance(v, dict): raise ApiError("JSON object expected")
        return v
    def _host_ok(self):
        h = (self.headers.get("Host") or "").split(":")[0].lower()
        return h in ("localhost", "127.0.0.1", "[::1]", "")
    def handle_any(self):
        try:
            if not self._host_ok(): return self._send(403, {"error": "forbidden host"})
            u = urlparse(self.path); p = u.path; q = parse_qs(u.query)
            if p.startswith("/api/"):
                if self.command != "GET":
                    o = self.headers.get("Origin")
                    if o and urlparse(o).hostname not in ("localhost", "127.0.0.1", "::1"): return self._send(403, {"error": "bad origin"})
                return self._send(200, self.api(p[5:].strip("/"), q))
            if self.command not in ("GET", "HEAD"): return self._send(405, {"error": "method"})
            if p == "/": p = "/index.html"
            fp = os.path.normpath(os.path.join(STATIC, p.lstrip("/")))
            if not fp.startswith(STATIC + os.sep) or not os.path.isfile(fp): return self._send(404, {"error": "not found"})
            ct = mimetypes.guess_type(fp)[0] or "application/octet-stream"
            if fp.endswith(".js"): ct = "application/javascript"
            if fp.endswith(".woff2"): ct = "font/woff2"
            with open(fp, "rb") as f: raw = f.read()
            self.send_response(200); self.send_header("Content-Type", ct + ("; charset=utf-8" if ct.startswith("text") or "javascript" in ct else ""))
            self.send_header("Content-Length", str(len(raw))); self.send_header("Cache-Control", "no-cache"); self.end_headers()
            if self.command != "HEAD": self.wfile.write(raw)
        except ApiError as e: self._send(e.code, {"error": str(e)})
        except Exception as e:
            import traceback; traceback.print_exc(); self._send(500, {"error": "server error: " + str(e)})
    do_GET = do_POST = do_PUT = do_DELETE = do_HEAD = handle_any
    def api(self, route, q):
        parts = route.split("/"); m = self.command
        if m == "GET":
            d = load()
            if route == "state": return state(d)
            if route == "dashboard": return dashboard(d)
            if route == "calendar": return calendar_view(d, (q.get("month") or [""])[0])
            if route == "projection":
                days = max(7, min(int((q.get("days") or ["90"])[0]), 365)); return projection(d, days, None)
            if route == "analytics": return analytics(d)
            if route == "changes":
                ch = read_json(CHG, []); return dict(changes=ch[::-1][:int((q.get("limit") or ["200"])[0])], total=len(ch), file=CHG)
            if route == "notes": return dict(notes=read_json(NOTES, [])[::-1])
            if route in ("bills", "debts"): return item_views(d, route[:-1])
            if route in ("accounts", "income", "goals", "transactions"): return d[route]
            if route == "export": return d
            raise ApiError("not found", 404)
        body = self._body() if m != "DELETE" else (self._body() if int(self.headers.get("Content-Length") or 0) else {})
        if route == "projection" and m == "POST":
            d = load()
            days = max(7, min(int((q.get("days") or ["90"])[0]), 365))
            return projection(d, days, body.get("hypotheticals", []))
        if route == "cycle" and m == "POST": return cycle_action(body)
        ent = parts[0]; idx = None
        if len(parts) > 1:
            try: idx = int(parts[1])
            except ValueError: raise ApiError("bad index")
        if (m == "POST" and idx is not None) or (m in ("PUT", "DELETE") and idx is None and ent not in ("settings", "savings", "business")): raise ApiError("bad route")
        return crud(ent, m, idx, body)

def free_port(start):
    for p in range(start, start + 30):
        s = socket.socket()
        try: s.bind(("127.0.0.1", p)); s.close(); return p
        except OSError: s.close()
    raise SystemExit("no free port")
if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    port = free_port(int(args[0]) if args else 8851)
    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    url = f"http://localhost:{port}"
    print(f"Boss Finance dashboard running at {url}  (Ctrl+C to stop)", flush=True)
    if "--no-browser" not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try: srv.serve_forever()
    except KeyboardInterrupt: pass
