from __future__ import annotations

import csv
import io
import json
from typing import Any, Dict, Iterable, List, Tuple

import requests

DEFAULT_BASE_URL = "https://prod-ai-report-api.piano.io/report/composer/conversion"


def fetch_conversion_report(*, base_url: str, exp_id: str, aid: str, locale: str, from_date: str, to_date: str, bearer: str, timeout: int = 30) -> Dict[str, Any]:
    params = {
        "expId": exp_id,
        "aid": aid,
        "ln": locale,
        "from": from_date,
        "to": to_date,
    }
    headers = {
        "Authorization": f"Bearer {bearer}",
        "Accept": "application/json",
        "User-Agent": "piano-data-scraper/1.0",
    }
    resp = requests.get(base_url, params=params, headers=headers, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def _as_number(value: Any) -> Any:
    return "" if value is None else value


# ---------- CSV building helpers (in-memory)

def _write_csv_to_string(rows: Iterable[Dict[str, Any]], fieldnames: List[str]) -> str:
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for row in rows:
        writer.writerow({k: row.get(k) for k in fieldnames})
    return output.getvalue()


def build_summary_totals_csvs(data: Dict[str, Any]) -> Tuple[str, str, str]:
    totals = data.get("totals", {}) or {}
    # summary_totals.csv
    summary_rows = [{
        "conversions": _as_number(data.get("conversions")),
        "exposures": _as_number(data.get("exposures")),
        "totals_conversions": _as_number(totals.get("conversions")),
        "totals_exposures": _as_number(totals.get("exposures")),
    }]
    summary_csv = _write_csv_to_string(summary_rows, ["conversions", "exposures", "totals_conversions", "totals_exposures"])

    # totals_by_source.csv
    tbs = (totals.get("totalsBySource") or {})
    by_source_rows = [{"source": k, "conversions": _as_number(v)} for k, v in tbs.items()]
    by_source_csv = _write_csv_to_string(by_source_rows, ["source", "conversions"]) if by_source_rows else _write_csv_to_string([], ["source", "conversions"])  # empty table with headers

    # totals_by_category.csv
    tbc = (totals.get("totalsByCategory") or {})
    by_category_rows = [{"category": k, "conversions": _as_number(v)} for k, v in tbc.items()]
    by_category_csv = _write_csv_to_string(by_category_rows, ["category", "conversions"]) if by_category_rows else _write_csv_to_string([], ["category", "conversions"])  # empty table with headers

    return summary_csv, by_source_csv, by_category_csv


def build_totals_by_periods_csvs(data: Dict[str, Any]) -> Dict[str, str]:
    tbp = data.get("totalsByPeriods", {}) or {}
    out: Dict[str, str] = {}
    for period in ["days", "weeks", "months", "quarters", "years"]:
        rows = tbp.get(period) or []
        if not isinstance(rows, list):
            rows = []
        fieldnames = ["date", "exposures", "conversions", "conversionRate"]
        norm_rows = []
        for r in rows:
            if not isinstance(r, dict):
                continue
            norm_rows.append({
                "date": r.get("date"),
                "exposures": _as_number(r.get("exposures")),
                "conversions": _as_number(r.get("conversions")),
                "conversionRate": _as_number(r.get("conversionRate")),
            })
        out[period] = _write_csv_to_string(norm_rows, fieldnames)
    return out


def build_rows_csv(data: Dict[str, Any]) -> str:
    rows = data.get("rows") or []
    if not isinstance(rows, list):
        rows = []

    def get_in(dct: Dict[str, Any], path: List[str]) -> Any:
        cur: Any = dct
        for key in path:
            if not isinstance(cur, dict):
                return None
            cur = cur.get(key)
        return cur

    flattened: List[Dict[str, Any]] = []
    for r in rows:
        meta = r.get("conversionSetMetadata") or {}
        flattened.append({
            "category.id": get_in(meta, ["category", "id"]),
            "category.vxId": get_in(meta, ["category", "vxId"]),
            "category.interaction": get_in(meta, ["category", "interaction"]),
            "source.id": get_in(meta, ["source", "id"]),
            "offer": get_in(meta, ["offer"]),
            "term.id": get_in(meta, ["term", "id"]),
            "term.name": get_in(meta, ["term", "name"]),
            "term.link": get_in(meta, ["term", "link"]),
            "template.id": get_in(meta, ["template", "id"]),
            "template.variantId": get_in(meta, ["template", "variantId"]),
            "template.name": get_in(meta, ["template", "name"]),
            "template.variantName": get_in(meta, ["template", "variantName"]),
            "actionCard.id": get_in(meta, ["actionCard", "id"]),
            "actionCard.name": get_in(meta, ["actionCard", "name"]),
            "meta.currency": get_in(meta, ["currency"]),
            "splitTest": get_in(meta, ["splitTest"]),
            "customName": get_in(meta, ["customName"]),
            "row.exposures": _as_number(r.get("exposures")),
            "row.conversions": _as_number(r.get("conversions")),
            "row.value": _as_number(r.get("value")),
            "row.currency": r.get("currency"),
            "row.changed": r.get("changed"),
            "row.isCounted": r.get("isCounted"),
            "row.conversionRate": _as_number(r.get("conversionRate")),
        })

    fieldnames = [
        "category.id",
        "category.vxId",
        "category.interaction",
        "source.id",
        "offer",
        "term.id",
        "term.name",
        "term.link",
        "template.id",
        "template.variantId",
        "template.name",
        "template.variantName",
        "actionCard.id",
        "actionCard.name",
        "meta.currency",
        "splitTest",
        "customName",
        "row.exposures",
        "row.conversions",
        "row.value",
        "row.currency",
        "row.changed",
        "row.isCounted",
        "row.conversionRate",
    ]

    return _write_csv_to_string(flattened, fieldnames)


def build_all_csvs(data: Dict[str, Any]) -> Dict[str, str]:
    summary_csv, by_source_csv, by_category_csv = build_summary_totals_csvs(data)
    periods_csvs = build_totals_by_periods_csvs(data)
    rows_csv = build_rows_csv(data)

    out: Dict[str, str] = {
        "summary_totals.csv": summary_csv,
        "totals_by_source.csv": by_source_csv,
        "totals_by_category.csv": by_category_csv,
        "rows.csv": rows_csv,
    }
    for period, csv_text in periods_csvs.items():
        out[f"totals_by_periods_{period}.csv"] = csv_text
    return out


# -----------------------
# Action card CSVs
# -----------------------

def build_action_cards_csvs(data: Dict[str, Any]) -> Dict[str, str]:
    """Return two CSV texts:
    - action_cards.csv: one row per actionCard.id with name and exposures (not aggregated)
    - action_card_terms.csv: per (actionCard.id, term.id/term.name) aggregated conversions
    """
    rows = data.get("rows") or []
    if not isinstance(rows, list):
        rows = []

    def get_in(dct: Dict[str, Any], path: List[str]) -> Any:
        cur: Any = dct
        for key in path:
            if not isinstance(cur, dict):
                return None
            cur = cur.get(key)
        return cur

    # exposures per action card (choose max seen, do NOT sum)
    ac_info: Dict[str, Dict[str, Any]] = {}
    # conversions aggregated per (actionCard.id, term.id or name)
    term_conv: Dict[Tuple[str, str, str], float] = {}

    for r in rows:
        meta = r.get("conversionSetMetadata") or {}
        ac_id = get_in(meta, ["actionCard", "id"]) or ""
        ac_name = get_in(meta, ["actionCard", "name"]) or ""
        exposures = r.get("exposures") or 0

        if ac_id:
            entry = ac_info.get(ac_id)
            if not entry:
                ac_info[ac_id] = {"actionCard.id": ac_id, "actionCard.name": ac_name, "row.exposures": exposures}
            else:
                # keep max exposures seen to avoid accidental aggregation
                try:
                    entry["row.exposures"] = max(entry.get("row.exposures") or 0, exposures or 0)
                except Exception:
                    entry["row.exposures"] = exposures

        term_id = get_in(meta, ["term", "id"]) or ""
        term_name = get_in(meta, ["term", "name"]) or ""
        if ac_id and (term_id or term_name):
            key = (ac_id, term_id, term_name)
            conv = r.get("conversions") or 0
            term_conv[key] = (term_conv.get(key) or 0) + conv

    # Build CSVs
    ac_rows = sorted(ac_info.values(), key=lambda x: (x["actionCard.name"], x["actionCard.id"]))
    action_cards_csv = _write_csv_to_string(ac_rows, ["actionCard.id", "actionCard.name", "row.exposures"])

    term_rows: List[Dict[str, Any]] = []
    for (ac_id, term_id, term_name), conv in sorted(term_conv.items(), key=lambda x: (x[0][0], x[0][2])):
        ac_name = ac_info.get(ac_id, {}).get("actionCard.name", "")
        term_rows.append({
            "actionCard.id": ac_id,
            "actionCard.name": ac_name,
            "term.id": term_id,
            "term.name": term_name,
            "row.conversions": conv,
        })
    action_card_terms_csv = _write_csv_to_string(term_rows, ["actionCard.id", "actionCard.name", "term.id", "term.name", "row.conversions"])

    return {
        "action_cards.csv": action_cards_csv,
        "action_card_terms.csv": action_card_terms_csv,
    }
