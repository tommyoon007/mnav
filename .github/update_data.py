import json
import re
from datetime import datetime, timezone
from pathlib import Path

import requests

DATA_FILE = Path("data.json")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; MSTR-mNAV-AutoUpdater/1.0)"
}

# Strategy 공식 페이지
SHARES_URL = "https://www.strategy.com/shares"
NOTES_URL = "https://www.strategy.com/notes"
DEBT_URL = "https://www.strategy.com/debt"


def get_page(url):
    response = requests.get(url, headers=HEADERS, timeout=30)
    response.raise_for_status()
    return response.text


def number_from_text(text, pattern):
    match = re.search(pattern, text, re.I)
    if not match:
        return None

    value = match.group(1)
    value = value.replace(",", "")
    return float(value)


def load_existing():
    if DATA_FILE.exists():
        try:
            return json.loads(DATA_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass

    return {
        "updatedAt": None,
        "source": "Strategy",
        "btcHoldings": 0,
        "assumedShares": 0,
        "fullyDilutedShares": 0,
        "otmDebt": 0,
        "preferred": 0,
        "usdReserve": 0,
        "notes": ""
    }


def main():
    data = load_existing()

    shares_page = get_page(SHARES_URL)

    # Strategy Shares 페이지에서 BTC 보유량 탐색
    btc = number_from_text(
        shares_page,
        r"(?:Bitcoin|BTC)[^0-9]{0,100}([0-9]{3,7}(?:\.[0-9]+)?)"
    )

    if btc:
        data["btcHoldings"] = btc

    # ADS / assumed diluted shares
    adso = number_from_text(
        shares_page,
        r"(?:Assumed Diluted Shares|ADSO)[^0-9]{0,100}"
        r"([0-9]{2,4}(?:\.[0-9]+)?)"
    )

    if adso:
        data["assumedShares"] = adso

    # Fully Diluted Shares
    fdso = number_from_text(
        shares_page,
        r"(?:Fully Diluted Shares|FDSO)[^0-9]{0,100}"
        r"([0-9]{2,4}(?:\.[0-9]+)?)"
    )

    if fdso:
        data["fullyDilutedShares"] = fdso

    # 현재 시각
    data["updatedAt"] = datetime.now(
        timezone.utc
    ).isoformat()

    data["source"] = "Strategy"

    data["notes"] = (
        "Automatically updated from Strategy official pages. "
        "If a value cannot be reliably detected, the previous value is retained."
    )

    DATA_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8"
    )

    print(json.dumps(data, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
