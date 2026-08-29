import json
from datetime import datetime, timezone
from pathlib import Path

import requests


DATA_FILE = Path("data.json")
HISTORY_FILE = Path("history.json")

YAHOO_URL = (
    "https://query1.finance.yahoo.com/v8/finance/chart/"
    "MSTR?range=1d&interval=1d"
)

COINGECKO_URL = (
    "https://api.coingecko.com/api/v3/simple/price"
    "?ids=bitcoin&vs_currencies=usd"
)

HEADERS = {
    "User-Agent": "tommyoon007-mnav-history/1.0"
}

TIMEOUT = 20


def load_json(path, default):
    if not path.exists():
        return default

    try:
        return json.loads(
            path.read_text(encoding="utf-8")
        )
    except Exception:
        return default


def save_json(path, data):
    path.write_text(
        json.dumps(
            data,
            indent=2,
            ensure_ascii=False
        ) + "\n",
        encoding="utf-8"
    )


def get_btc_price():
    response = requests.get(
        COINGECKO_URL,
        headers=HEADERS,
        timeout=TIMEOUT
    )

    response.raise_for_status()

    data = response.json()

    price = float(
        data["bitcoin"]["usd"]
    )

    if price <= 0:
        raise ValueError(
            "Invalid BTC price"
        )

    return price


def get_mstr_price():
    response = requests.get(
        YAHOO_URL,
        headers=HEADERS,
        timeout=TIMEOUT
    )

    response.raise_for_status()

    data = response.json()

    result = data["chart"]["result"][0]

    price = result["meta"].get(
        "regularMarketPrice"
    )

    if price is None:
        raise ValueError(
            "Yahoo did not return MSTR price"
        )

    price = float(price)

    if price <= 0:
        raise ValueError(
            "Invalid MSTR price"
        )

    return price


def calculate_mnav(
    btc_price,
    mstr_price,
    company
):
    holdings = float(
        company["btcHoldings"]
    )

    fdso = float(
        company["fdso"]
    )

    usd_assets = float(
        company["usdAssetsUsdB"]
    ) * 1e9

    debt = float(
        company["debtUsdB"]
    ) * 1e9

    preferred = float(
        company["preferredUsdB"]
    ) * 1e9

    btc_value = (
        holdings *
        btc_price
    )

    net_reserve = (
        btc_value +
        usd_assets -
        debt -
        preferred
    )

    net_bps = (
        net_reserve /
        (fdso * 1e6)
    )

    if net_bps <= 0:
        raise ValueError(
            "Invalid Net BPS"
        )

    mnav = (
        mstr_price /
        net_bps
    )

    return {
        "netReserveUsd": net_reserve,
        "netBpsUsd": net_bps,
        "mnav": mnav
    }


def main():

    company = load_json(
        DATA_FILE,
        {}
    )

    if not company:
        raise RuntimeError(
            "data.json not found"
        )

    btc_price = get_btc_price()

    mstr_price = get_mstr_price()

    result = calculate_mnav(
        btc_price,
        mstr_price,
        company
    )

    now = datetime.now(
        timezone.utc
    )

    date_key = now.strftime(
        "%Y-%m-%d"
    )

    history = load_json(
        HISTORY_FILE,
        []
    )

    if not isinstance(history, list):
        history = []

    record = {
        "date": date_key,
        "timestamp": now.isoformat(),
        "btc": round(
            btc_price,
            2
        ),
        "mstr": round(
            mstr_price,
            2
        ),
        "mnav": round(
            result["mnav"],
            4
        ),
        "netBpsUsd": round(
            result["netBpsUsd"],
            2
        )
    }

    # 같은 날짜 데이터가 이미 있으면 교체
    history = [
        item
        for item in history
        if item.get("date") != date_key
    ]

    history.append(record)

    # 날짜순 정렬
    history.sort(
        key=lambda x: x.get(
            "date",
            ""
        )
    )

    save_json(
        HISTORY_FILE,
        history
    )

    print(
        json.dumps(
            record,
            indent=2,
            ensure_ascii=False
        )
    )

    print(
        f"History records: {len(history)}"
    )


if __name__ == "__main__":
    main()
