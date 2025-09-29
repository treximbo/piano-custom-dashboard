#!/usr/bin/env python3
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict

from flask import Flask, jsonify, request, send_file
from flask import send_from_directory

from piano_lib import (
    DEFAULT_BASE_URL,
    build_all_csvs,
    build_action_cards_csvs,
    fetch_conversion_report,
)
from brands import BRAND_TO_AID, resolve_aid

app = Flask(__name__, static_url_path="", static_folder="static")


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


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
