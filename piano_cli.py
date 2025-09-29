#!/usr/bin/env python3
"""
Piano Conversion Report fetcher and parser.

Features:
- Fetch JSON from Piano composer/conversion endpoint with a Bearer token
- Or parse an existing local JSON file (e.g., sampleData.json)
- Export tidy CSVs:
  - summary_totals.csv (high-level counts)
  - totals_by_source.csv
  - totals_by_category.csv
  - totals_by_periods_days.csv|weeks.csv|months.csv|quarters.csv|years.csv
  - rows.csv (flattened conversionSetMetadata + metrics)

Bearer token discovery order:
1) --bearer CLI value
2) file from --bearer-file (default: bearer.txt)
3) env var PIANO_BEARER

Defaults:
- base URL: https://prod-ai-report-api.piano.io/report/composer/conversion
- locale: en_US
- date range: last 30 days (inclusive of today as 'to')

Usage examples:
  python piano_cli.py --input sampleData.json --out-dir out
  python piano_cli.py --exp-id EXCTYT87DM0F --aid N8sydUSDcX --from 2025-08-24 --to 2025-09-23 --bearer "<paste token>" --save-json --out-dir out
  python piano_cli.py --exp-id EXCTYT87DM0F --aid N8sydUSDcX --bearer-file bearer.txt --out-dir out
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

try:
    import requests
except ImportError as exc:  # pragma: no cover
    print("Missing dependency: requests. Run 'pip install -r requirements.txt'", file=sys.stderr)
    raise
try:
    from brands import resolve_aid
except Exception:
    resolve_aid = lambda brand: None  # fallback if brands.py not found

# Optional: action card CSV builders from web library
try:
    from piano_lib import build_action_cards_csvs
except Exception:
    build_action_cards_csvs = None  # type: ignore

DEFAULT_BASE_URL = "https://prod-ai-report-api.piano.io/report/composer/conversion"
DEFAULT_LOCALE = "en_US"
DEFAULT_BEARER_ENV = "PIANO_BEARER"

# -----------------------
# Utility helpers
# -----------------------

def iso_date(s: str) -> str:
    """Validate yyyy-mm-dd and return it (argparse type)."""
    try:
        dt.date.fromisoformat(s)
    except ValueError as exc:  # pragma: no cover
        raise argparse.ArgumentTypeError(f"Invalid date: {s}; expected YYYY-MM-DD") from exc
    return s


def default_dates() -> tuple[str, str]:
    """Return default (from_date, to_date) as last 30 days inclusive of today."""
    today = dt.date.today()
    start = today - dt.timedelta(days=30)
    return (start.isoformat(), today.isoformat())


def ensure_out_dir(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)


def write_csv(path: Path, rows: Iterable[Dict[str, Any]], fieldnames: List[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k) for k in fieldnames})


def save_json(path: Path, data: Dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# -----------------------
# Bearer resolution
# -----------------------

def resolve_bearer(token_arg: Optional[str], bearer_file: Optional[Path], env_var: str = DEFAULT_BEARER_ENV) -> Optional[str]:
    """Resolve bearer token from CLI arg, file, or env var in that order."""
    if token_arg:
        return token_arg.strip()
    if bearer_file and bearer_file.exists():
        content = bearer_file.read_text(encoding="utf-8").strip()
        if content:
            return content
    env_val = os.environ.get(env_var)
    if env_val:
        return env_val.strip()
    return None


# -----------------------
# Network fetch
# -----------------------

def fetch_conversion_report(
    *,
    base_url: str,
    exp_id: str,
    aid: str,
    locale: str,
    from_date: str,
    to_date: str,
    bearer: str,
    timeout: int = 30,
) -> Dict[str, Any]:
    """Fetch report JSON from Piano API."""
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
    try:
        resp.raise_for_status()
    except requests.HTTPError as exc:  # pragma: no cover
        details = None
        try:
            details = resp.json()
        except Exception:
            details = resp.text
        raise RuntimeError(f"HTTP {resp.status_code} error: {details}") from exc
    return resp.json()


# -----------------------
# Parsing and CSV export
# -----------------------

def _as_number(value: Any) -> Any:
    """Return value unchanged except convert None to empty string for CSV readability."""
    return "" if value is None else value


def export_summary_totals(data: Dict[str, Any], out_dir: Path) -> None:
    totals_path = out_dir / "summary_totals.csv"
    totals = data.get("totals", {}) or {}
    rows = [{
        "conversions": _as_number(data.get("conversions")),
        "exposures": _as_number(data.get("exposures")),
        "totals_conversions": _as_number(totals.get("conversions")),
        "totals_exposures": _as_number(totals.get("exposures")),
    }]
    write_csv(totals_path, rows, ["conversions", "exposures", "totals_conversions", "totals_exposures"])

    # totals_by_source
    tbs = (totals.get("totalsBySource") or {})
    by_source_rows = [{"source": k, "conversions": _as_number(v)} for k, v in tbs.items()]
    write_csv(out_dir / "totals_by_source.csv", by_source_rows, ["source", "conversions"])

    # totals_by_category
    tbc = (totals.get("totalsByCategory") or {})
    by_category_rows = [{"category": k, "conversions": _as_number(v)} for k, v in tbc.items()]
    write_csv(out_dir / "totals_by_category.csv", by_category_rows, ["category", "conversions"])


def export_totals_by_periods(data: Dict[str, Any], out_dir: Path) -> None:
    tbp = data.get("totalsByPeriods", {}) or {}
    for period in ["days", "weeks", "months", "quarters", "years"]:
        rows = tbp.get(period) or []
        if not isinstance(rows, list):
            rows = []
        path = out_dir / f"totals_by_periods_{period}.csv"
        fieldnames = ["date", "exposures", "conversions", "conversionRate"]
        # normalize
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
        write_csv(path, norm_rows, fieldnames)


def export_rows(data: Dict[str, Any], out_dir: Path) -> None:
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
            # Metadata
            "category.id": get_in(meta, ["category", "id"]),
            "category.vxId": get_in(meta, ["category", "vxId"]),
            "category.interaction": get_in(meta, ["category", "interaction"]),
            "source.id": get_in(meta, ["source", "id"]),
            "offer": get_in(meta, ["offer"]) ,
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
            # Row metrics
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

    write_csv(out_dir / "rows.csv", flattened, fieldnames)


def export_all(data: Dict[str, Any], out_dir: Path) -> None:
    export_summary_totals(data, out_dir)
    export_totals_by_periods(data, out_dir)
    export_rows(data, out_dir)
    # Write action card reports if available
    if build_action_cards_csvs is not None:
        try:
            action_csvs = build_action_cards_csvs(data)  # type: ignore
            for name, content in action_csvs.items():
                (out_dir / name).write_text(content, encoding="utf-8")
        except Exception:
            pass


# -----------------------
# CLI
# -----------------------

def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Fetch and parse Piano conversion report")

    # Input modes
    parser.add_argument("--input", "-i", type=Path, help="Parse from existing JSON file instead of fetching")

    # API params
    from_default, to_default = default_dates()
    parser.add_argument("--exp-id", default=os.environ.get("PIANO_EXP_ID", "EXCTYT87DM0F"), help="Experience ID (expId)")
    parser.add_argument("--aid", default=os.environ.get("PIANO_AID", "N8sydUSDcX"), help="Application ID (aid)")
    parser.add_argument("--brand", help="Brand name to resolve aid (overrides --aid if matched)")
    # Locale always en_US; flag removed
    parser.add_argument("--from", dest="from_date", type=iso_date, default=from_default, help=f"Start date YYYY-MM-DD (default {from_default})")
    parser.add_argument("--to", dest="to_date", type=iso_date, default=to_default, help=f"End date YYYY-MM-DD (default {to_default})")

    # Bearer token options
    parser.add_argument("--bearer", "-b", help="Bearer token value")
    parser.add_argument("--bearer-file", "-bf", type=Path, default=Path("bearer.txt"), help="Path to file containing Bearer token")

    # Output
    parser.add_argument("--out-dir", type=Path, default=Path("out"), help="Directory to write CSVs")
    parser.add_argument("--save-json", action="store_true", help="Also save raw JSON to out/raw.json")

    # Advanced
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help="Override base URL if needed")
    parser.add_argument("--timeout", type=int, default=30, help="HTTP timeout seconds")

    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    out_dir: Path = args.out_dir
    ensure_out_dir(out_dir)

    if args.input:
        # Local parse mode
        try:
            with args.input.open("r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as exc:  # pragma: no cover
            print(f"Failed to read JSON from {args.input}: {exc}", file=sys.stderr)
            return 1
        export_all(data, out_dir)
        print(f"Parsed {args.input} -> CSVs in {out_dir}")
        return 0

    # Fetch mode
    bearer = resolve_bearer(args.bearer, args.bearer_file, DEFAULT_BEARER_ENV)
    if not bearer:  # pragma: no cover
        print("Bearer token not provided. Use --bearer, --bearer-file, or set PIANO_BEARER.", file=sys.stderr)
        return 2

    try:
        data = fetch_conversion_report(
            base_url=args.base_url,
            exp_id=args.exp_id,
            aid=resolve_aid(args.brand) or args.aid,
            locale=DEFAULT_LOCALE,
            from_date=args.from_date,
            to_date=args.to_date,
            bearer=bearer,
            timeout=args.timeout,
        )
    except Exception as exc:  # pragma: no cover
        print(f"Fetch failed: {exc}", file=sys.stderr)
        return 3

    if args.save_json:
        save_json(out_dir / "raw.json", data)

    export_all(data, out_dir)
    print(f"Fetched and exported CSVs to {out_dir}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
