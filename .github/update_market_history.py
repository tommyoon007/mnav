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

# BTCUSDT perpetual futures
BINANCE_OI_URL = (
    "https://fapi.binance.com/fapi/v1/openInterest"
    "?symbol=BTCUSDT"
)

BINANCE_FUNDING_URL = (
    "https://fapi.binance.com/fapi/v1/fundingRate"
    "?symbol=BTCUSDT&limit=1"
)

HEADERS = {
    "User-Agent": "tommyoon007-mnav-history/2.0"
}

TIMEOUT = 20


def load_json(path, default):

    if not path.exists():
        return default

    try:
        return json.loads(
            path.read_text(
                encoding="utf-8"
            )
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


def get_json(url):

    response = requests.get(
        url,
        headers=HEADERS,
        timeout=TIMEOUT
    )

    response.raise_for_status()

    return response.json()


def get_btc_price():

    data = get_json(
        COINGECKO_URL
    )

    price = float(
        data["bitcoin"]["usd"]
    )

    if price <= 0:
        raise ValueError(
            "Invalid BTC price"
        )

    return price


def get_mstr_price():

    data = get_json(
        YAHOO_URL
    )

    result = (
        data["chart"]
        ["result"][0]
    )

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


def get_open_interest():

    data = get_json(
        BINANCE_OI_URL
    )

    oi_btc = float(
        data["openInterest"]
    )

    if oi_btc < 0:
        raise ValueError(
            "Invalid BTC open interest"
        )

    return oi_btc


def get_funding_rate():

    data = get_json(
        BINANCE_FUNDING_URL
    )

    if not data:
        raise ValueError(
            "No funding rate returned"
        )

    rate_decimal = float(
        data[0]["fundingRate"]
    )

    # 0.0001 = +0.01%
    funding_percent = (
        rate_decimal * 100
    )

    return funding_percent


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
        "netReserveUsd":
            net_reserve,

        "netBpsUsd":
            net_bps,

        "mnav":
            mnav
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

    # --------------------------------
    # 기본 시장 데이터
    # --------------------------------

    btc_price = (
        get_btc_price()
    )

    mstr_price = (
        get_mstr_price()
    )

    result = calculate_mnav(
        btc_price,
        mstr_price,
        company
    )

    # --------------------------------
    # OI
    # --------------------------------

    oi_btc = None
    oi_usd = None

    try:

        oi_btc = (
            get_open_interest()
        )

        oi_usd = (
            oi_btc *
            btc_price
        )

    except Exception as error:

        print(
            "WARNING: "
            f"OI unavailable: {error}"
        )

    # --------------------------------
    # Funding
    # --------------------------------

    funding_rate = None

    try:

        funding_rate = (
            get_funding_rate()
        )

    except Exception as error:

        print(
            "WARNING: "
            f"Funding unavailable: "
            f"{error}"
        )

    # --------------------------------
    # 날짜
    # --------------------------------

    now = datetime.now(
        timezone.utc
    )

    date_key = now.strftime(
        "%Y-%m-%d"
    )

    # --------------------------------
    # 기존 history
    # --------------------------------

    history = load_json(
        HISTORY_FILE,
        []
    )

    if not isinstance(
        history,
        list
    ):
        history = []

    # --------------------------------
    # 새 기록
    # --------------------------------

    record = {

        "date":
            date_key,

        "timestamp":
            now.isoformat(),

        "btc":
            round(
                btc_price,
                2
            ),

        "mstr":
            round(
                mstr_price,
                2
            ),

        "mnav":
            round(
                result["mnav"],
                4
            ),

        "netBpsUsd":
            round(
                result["netBpsUsd"],
                2
            ),

        "oiBtc":
            (
                round(
                    oi_btc,
                    2
                )
                if oi_btc is not None
                else None
            ),

        "oiUsd":
            (
                round(
                    oi_usd,
                    2
                )
                if oi_usd is not None
                else None
            ),

        "fundingRate":
            (
                round(
                    funding_rate,
                    5
                )
                if funding_rate is not None
                else None
            )
    }

    # --------------------------------
    # 같은 날짜 데이터 교체
    # --------------------------------

    history = [

        item

        for item in history

        if item.get(
            "date"
        ) != date_key
    ]

    history.append(
        record
    )

    history.sort(
        key=lambda x:
            x.get(
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
        "History records: "
        f"{len(history)}"
    )


if __name__ == "__main__":
    main()
