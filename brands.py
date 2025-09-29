from __future__ import annotations

from typing import Dict, Optional

# Canonical brand name -> AID mapping
BRAND_TO_AID: Dict[str, str] = {
    "Accounting Today": "BOmg9kapee",
    "American Banker": "XUnXNMUrFF",
    "Digital Insurance": "N8sydUSDcX",
    "Employee Benefit News": "t7vpsMsOZy",
    "Financial Planning": "RXUl28joTX",
    "National Mortgage News": "DqBrRoNVmq",
    "Bond Buyer": "x2vmB6Jdyn",
}

# Lowercased alias mapping for flexible lookup
_ALIASES: Dict[str, str] = {
    k.lower(): v for k, v in BRAND_TO_AID.items()
}


def resolve_aid(brand: Optional[str]) -> Optional[str]:
    if not brand:
        return None
    return _ALIASES.get(brand.strip().lower())
