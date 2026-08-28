import json
import os
from datetime import datetime, timezone

import requests

DATA_FILE = "data.json"

# GitHub Actions에서 접근 가능한 공개 API
COINGECKO_URL = (
    "https://api.coingecko.com/api/v3/simple/price"
    "?ids=bitcoin&vs_currencies=usd"
)

HEADERS = {
    "User-Agent": "mNAV-data-updater/1.0"
}


def load_existing():
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {
            "updatedAt": None,
            "source": "Strategy",
            "btcHoldings": 840447,
            "assumedShares": 427.308,
            "fullyDilutedShares": 401.697,
            "otmDebt": 0,
            "preferred": 0,
            "usdReserve": 3.75
        }


def get_btc_price():
    r = requests.get(
        COINGECKO_URL,
        headers=HEADERS,
        timeout=30
    )
    r.raise_for_status()

    data = r.json()
    price = data["bitcoin"]["usd"]

    if not isinstance(price, (int, float)) or price <= 0:
        raise ValueError("Invalid BTC price")

    return float(price)


def main():
    data = load_existing()

    print("Loading existing Strategy data...")
    print("BTC Holdings:", data.get("btcHoldings"))
    print("ADSO:", data.get("assumedShares"))
    print("FDSO:", data.get("fullyDilutedShares"))

    # BTC 가격은 앱에서 실시간 CoinGecko를 사용하므로
    # 여기서는 데이터 검증만 한다.
    try:
        btc_price = get_btc_price()
        print("Current BTC price:", btc_price)
    except Exception as e:
        print("BTC price API failed:", e)

    # 중요:
    # Strategy 웹페이지를 GitHub Actions에서 직접 크롤링하지 않는다.
    #
    # 현재 확인되지 않은 Debt / Preferred / Reserve 값을
    # 임의로 0으로 바꾸지 않는다.
    #
    # 따라서 기존의 검증된 값을 유지한다.

    required = [
        "btcHoldings",
        "assumedShares",
        "fullyDilutedShares"
    ]

    for key in required:
        value = data.get(key)

        if not isinstance(value, (int, float)) or value <= 0:
            raise ValueError(
                f"Invalid required value: {key}={value}"
            )

    data["source"] = "Strategy"
    data["updatedAt"] = datetime.now(
        timezone.utc
    ).isoformat()

    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(
            data,
            f,
            indent=2,
            ensure_ascii=False
        )

    print("")
    print("===================================")
    print("MSTR mNAV data update completed")
    print("===================================")
    print("BTC Holdings :", data["btcHoldings"])
    print("ADSO         :", data["assumedShares"])
    print("FDSO         :", data["fullyDilutedShares"])
    print("OTM Debt     :", data["otmDebt"])
    print("Preferred    :", data["preferred"])
    print("USD Reserve  :", data["usdReserve"])
    print("Updated      :", data["updatedAt"])
    print("===================================")


if __name__ == "__main__":
    main()
