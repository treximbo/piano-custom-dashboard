#!/usr/bin/env python3
from __future__ import annotations

import os
from pathlib import Path
import io
import zipfile
from typing import Any, Dict

from flask import Flask, jsonify, request, send_file
from flask import send_from_directory
import datetime as dt

from piano_lib import (
    DEFAULT_BASE_URL,
    build_all_csvs,
    build_action_cards_csvs,
    fetch_conversion_report,
)
from brands import BRAND_TO_AID, resolve_aid

app = Flask(__name__, static_url_path="", static_folder="static")
# Simple in-memory cache for trends slice aggregates
_SLICE_CACHE: Dict[tuple, tuple[float, dict]] = {}
_CACHE_TTL_SECONDS = int(os.environ.get("TRENDS_CACHE_TTL", "300"))  # 5 minutes default


@app.get("/")
def index():
    return app.send_static_file("index.html")

@app.get("/sampleData.json")
def sample_data():
    # Serve sampleData.json from project root to support the UI's "Load sample" button
    root = Path(__file__).resolve().parent
    return send_from_directory(directory=str(root), path="sampleData.json", mimetype="application/json")

@app.get("/api/brands")
def api_brands():
    return jsonify({"ok": True, "brands": BRAND_TO_AID})


@app.post("/api/report")
def api_report():
    body: Dict[str, Any] = request.get_json(silent=True) or {}
    exp_id = body.get("expId") or os.environ.get("PIANO_EXP_ID", "EXCTYT87DM0F")
    # Resolve AID from brand if provided; otherwise fall back to explicit aid or env var
    brand = body.get("brand")
    aid = resolve_aid(brand) or body.get("aid") or os.environ.get("PIANO_AID", "N8sydUSDcX")
    locale = "en_US"
    from_date = body.get("from")
    to_date = body.get("to")
    base_url = body.get("baseUrl") or DEFAULT_BASE_URL

    # Bearer can be passed in body or use env var
    bearer = body.get("bearer") or os.environ.get("PIANO_BEARER")
    if not bearer:
        return jsonify({"error": "Missing bearer token"}), 400

    try:
        data = fetch_conversion_report(
            base_url=base_url,
            exp_id=exp_id,
            aid=aid,
            locale=locale,
            from_date=from_date,
            to_date=to_date,
            bearer=bearer,
            timeout=30,
        )
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502

    return jsonify({"ok": True, "data": data})


@app.post("/api/csv")
def api_csv():
    body: Dict[str, Any] = request.get_json(silent=True) or {}
    data = body.get("data")
    if not isinstance(data, dict):
        return jsonify({"error": "Missing data"}), 400

    csv_map = build_all_csvs(data)
    csv_map.update(build_action_cards_csvs(data))
    return jsonify({"ok": True, "files": csv_map})


def _daterange_days(start: dt.date, end: dt.date):
    cur = start
    delta = dt.timedelta(days=1)
    while cur <= end:
        yield cur, cur
        cur += delta


def _daterange_weeks(start: dt.date, end: dt.date):
    # 7-day windows starting at 'start'
    cur = start
    while cur <= end:
        to = min(cur + dt.timedelta(days=6), end)
        yield cur, to
        cur = to + dt.timedelta(days=1)


def _daterange_months(start: dt.date, end: dt.date):
    # Month windows starting first day of month
    cur = start.replace(day=1)
    while cur <= end:
        if cur.month == 12:
            next_month = dt.date(cur.year + 1, 1, 1)
        else:
            next_month = dt.date(cur.year, cur.month + 1, 1)
        to = min(next_month - dt.timedelta(days=1), end)
        yield cur, to
        cur = next_month


@app.post("/api/trends")
def api_trends():
    body: Dict[str, Any] = request.get_json(silent=True) or {}
    exp_id = body.get("expId") or os.environ.get("PIANO_EXP_ID", "EXCTYT87DM0F")
    brand = body.get("brand")
    aid = resolve_aid(brand) or body.get("aid") or os.environ.get("PIANO_AID", "N8sydUSDcX")
    bearer = body.get("bearer") or os.environ.get("PIANO_BEARER")
    if not bearer:
        return jsonify({"error": "Missing bearer token"}), 400
    from_date = body.get("from")
    to_date = body.get("to")
    cadence = (body.get("cadence") or "days").lower()
    action_ids = body.get("actionCardIds") or []
    base_url = body.get("baseUrl") or DEFAULT_BASE_URL

    try:
        start = dt.date.fromisoformat(from_date)
        end = dt.date.fromisoformat(to_date)
    except Exception:
        return jsonify({"error": "Invalid from/to date"}), 400

    if cadence == "days":
        slices = list(_daterange_days(start, end))
    elif cadence == "weeks":
        slices = list(_daterange_weeks(start, end))
    elif cadence == "months":
        slices = list(_daterange_months(start, end))
    else:
        return jsonify({"error": "Invalid cadence"}), 400

    extended = bool(body.get("extended"))
    truncated = False
    if cadence == "days" and len(slices) > 14 and not extended:
        slices = slices[-14:]
        truncated = True

    labels = [s.isoformat() for s, _ in slices]
    # Prepare series dicts
    by_action = {ac_id: [0] * len(slices) for ac_id in action_ids}
    terms_by_action: Dict[str, Dict[str, list[int]]] = {ac_id: {} for ac_id in action_ids}

    # Iterate slices and fetch
    for idx, (s, e) in enumerate(slices):
        cache_key = (base_url, exp_id, aid, s.isoformat(), e.isoformat())
        now_ts = dt.datetime.utcnow().timestamp()
        cached = _SLICE_CACHE.get(cache_key)
        if cached and (now_ts - cached[0]) < _CACHE_TTL_SECONDS:
            agg = cached[1]
            max_exposure_per_action = agg.get("max_exposure_per_action", {})  # type: ignore
            term_conversions_per_action = agg.get("term_conversions_per_action", {})  # type: ignore
        else:
            try:
                data = fetch_conversion_report(
                    base_url=base_url,
                    exp_id=exp_id,
                    aid=aid,
                    locale="en_US",
                    from_date=s.isoformat(),
                    to_date=e.isoformat(),
                    bearer=bearer,
                    timeout=30,
                )
            except Exception as exc:
                return jsonify({"error": f"fetch failed for slice {s}..{e}: {exc}"}), 502

            rows = data.get("rows") or []
            # Build max exposures per action for the slice to avoid double counting
            # And sum conversions per (action, term) for the slice
            max_exposure_per_action: Dict[str, float] = {}
            term_conversions_per_action: Dict[tuple[str, str], int] = {}
            for r in rows:
                meta = r.get("conversionSetMetadata") or {}
                ac_id = (meta.get("actionCard") or {}).get("id")
                if not ac_id:
                    continue
                exp = r.get("exposures") or 0
                cur = max_exposure_per_action.get(ac_id) or 0
                if exp > cur:
                    max_exposure_per_action[ac_id] = exp
                # per term conversions (sum)
                term = ((meta.get("term") or {}).get("name") or (meta.get("term") or {}).get("id") or "").strip()
                if term and ac_id in action_ids:
                    key = (ac_id, term)
                    term_conversions_per_action[key] = (term_conversions_per_action.get(key) or 0) + int(r.get("conversions") or 0)

            _SLICE_CACHE[cache_key] = (now_ts, {
                "max_exposure_per_action": max_exposure_per_action,
                "term_conversions_per_action": term_conversions_per_action,
            })

        for ac_id in action_ids:
            by_action[ac_id][idx] = int(max_exposure_per_action.get(ac_id) or 0)
        # fill term series (conversions)
        for (ac_id, term), conv in term_conversions_per_action.items():
            if ac_id not in terms_by_action:
                continue
            series = terms_by_action[ac_id].get(term)
            if series is None:
                series = [0] * len(slices)
                terms_by_action[ac_id][term] = series
            series[idx] = int(conv or 0)

    return jsonify({
        "ok": True,
        "cadence": cadence,
        "labels": labels,
        "actions": by_action,
        "terms": terms_by_action,
        "truncated": truncated,
    })


@app.post("/api/experiences")
def api_experiences():
    body: Dict[str, Any] = request.get_json(silent=True) or {}
    brand = body.get("brand")
    # Resolve AID: prefer explicit 'aid', else try brand as AID, else brand name mapping, else env default
    cand_aid = body.get("aid")
    if not cand_aid and brand:
        # If brand looks like an AID or we have a per-AID token env for it, treat as AID
        env_key = f"PIANO_API_TOKEN_{brand}"
        looks_like_aid = isinstance(brand, str) and len(brand) >= 8 and brand.isalnum()
        if env_key in os.environ or looks_like_aid:
            cand_aid = brand
    aid = cand_aid or (resolve_aid(brand) if brand else None) or os.environ.get("PIANO_AID")
    if not aid:
        return jsonify({"error": "Missing aid"}), 400
    # Load .env (if present) for local dev
    try:
        from dotenv import load_dotenv  # type: ignore
        load_dotenv()
    except Exception:
        pass
    # Resolve API token precedence: body.apiToken > PIANO_API_TOKEN_<AID> > PIANO_API_TOKEN
    api_token = (
        body.get("apiToken")
        or os.environ.get(f"PIANO_API_TOKEN_{aid}")
        or os.environ.get("PIANO_API_TOKEN")
    )
    bearer = body.get("bearer") or os.environ.get("PIANO_BEARER")
    if not api_token and not bearer:
        return jsonify({"error": "Provide apiToken (recommended) or bearer"}), 400

    base_url = body.get("baseUrl") or "https://api.piano.io/api/v3"
    url = f"{base_url.rstrip('/')}/publisher/experience/metadata/list"
    try:
        import requests
        headers = {"Accept": "application/json"}
        params = {"aid": aid}
        if api_token:
            params["api_token"] = api_token
        # Support optional pagination if provided in body
        if body.get("limit"):
            params["limit"] = body.get("limit")
        if body.get("offset") is not None:
            params["offset"] = body.get("offset")
        # Prefer GET with query params as per provided example
        resp = requests.get(url, params=params, headers=headers, timeout=30)
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        return jsonify({"error": f"Experiences fetch failed: {exc}"}), 502

    def extract_items(obj: Dict[str, Any]):
        for key in ("experiences", "items", "data", "list", "records"):
            val = obj.get(key)
            if isinstance(val, list):
                return val
            if isinstance(val, dict) and isinstance(val.get("items"), list):
                return val["items"]
        if isinstance(obj, list):
            return obj
        return []

    items = extract_items(data)
    now = dt.datetime.utcnow()
    groups = {"active": [], "scheduled": [], "inactive": []}

    def parse_dt(val: Any):
        if not val:
            return None
        try:
            if isinstance(val, (int, float)):
                # epoch seconds or ms
                ts = val/1000.0 if val > 1e12 else val
                return dt.datetime.utcfromtimestamp(ts)
            # ISO
            return dt.datetime.fromisoformat(str(val).replace("Z", "+00:00")).astimezone(dt.timezone.utc).replace(tzinfo=None)
        except Exception:
            return None

    for it in items:
        raw_status = (it.get("status") or it.get("state") or "").strip()
        norm_status = raw_status.upper()
        start = parse_dt(it.get("start") or it.get("startDate") or it.get("start_time"))
        end = parse_dt(it.get("end") or it.get("endDate") or it.get("end_time"))
        # If schedule is provided as JSON string with intervals, derive start/end
        sched_raw = it.get("schedule")
        if not start and sched_raw:
            try:
                import json as _json
                sched = _json.loads(sched_raw) if isinstance(sched_raw, str) else sched_raw
                intervals = sched.get("intervals") or []
                if intervals:
                    s_ms = intervals[0].get("startDate")
                    e_ms = intervals[0].get("endDate")
                    start = parse_dt(s_ms)
                    end = parse_dt(e_ms) if e_ms else end
            except Exception:
                pass
        # Map known API statuses to our groups
        status_map = {
            "LIVE": "active",
            "SCHEDULED": "scheduled",
            "OFFLINE": "inactive",
            # Back-compat if API ever returns these
            "ACTIVE": "active",
            "INACTIVE": "inactive",
        }
        mapped = status_map.get(norm_status)
        if mapped in groups:
            groups[mapped].append(it)
            continue
        if start and end:
            if start <= now <= end:
                groups["active"].append(it)
            elif now < start:
                groups["scheduled"].append(it)
            else:
                groups["inactive"].append(it)
        elif start and now < start:
            groups["scheduled"].append(it)
        else:
            groups["inactive"].append(it)

    return jsonify({"ok": True, "aid": aid, "groups": groups, "count": len(items)})


@app.get("/download/extension.zip")
def download_extension_zip():
    """Package the browser extension directory into a zip and return it."""
    root = Path(__file__).resolve().parent
    ext_dir = root / "extension"
    if not ext_dir.exists():
        return jsonify({"error": "Extension directory not found"}), 404
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in ext_dir.rglob("*"):
            if path.is_file():
                zf.write(path, arcname=str(path.relative_to(ext_dir)))
    buf.seek(0)
    return send_file(
        buf,
        mimetype="application/zip",
        as_attachment=True,
        download_name="piano_composer_extension.zip",
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
