import json
from datetime import datetime, timezone
from pathlib import Path

import requests


LIVE_FILE = Path("live.json")

YAHOO_URL = (
    "https://query1.finance.yahoo.com/v8/finance/chart/"
    "MSTR?range=1d&interval=1m"
)

COINGECKO_URL = (
    "https://api.coingecko.com/api/v3/simple/price"
    "?ids=bitcoin&vs_currencies=usd"
)

HEADERS = {
    "User-Agent": "mnav-market-updater/1.0"
}

TIMEOUT = 20


def load_previous():
    if LIVE_FILE.exists():
        try:
            return json.loads(
                LIVE_FILE.read_text(
                    encoding="utf-8"
                )
            )
        except Exception:
            pass

    return {
        "btcPrice": None,
        "mstrPrice": None,
        "updatedAt": None,
        "btcSource": None,
        "mstrSource": None
    }


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

    price = result[
        "meta"
    ].get(
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


def main():

    previous =
        load_previous()

    now =
        datetime.now(
            timezone.utc
        ).isoformat()


    # BTC
    try:
        btc_price =
            get_btc_price()

        previous["btcPrice"] =
            btc_price

        previous["btcSource"] =
            "CoinGecko"

        print(
            "BTC:",
            btc_price
        )

    except Exception as exc:

        print(
            "BTC price failed:",
            exc
        )


    # MSTR
    try:
        mstr_price =
            get_mstr_price()

        previous["mstrPrice"] =
            mstr_price

        previous["mstrSource"] =
            "Yahoo Finance"

        print(
            "MSTR:",
            mstr_price
        )

    except Exception as exc:

        print(
            "MSTR price failed:",
            exc
        )


    if (
        previous.get("btcPrice") is None
        or
        previous.get("mstrPrice") is None
    ):
        raise RuntimeError(
            "No valid market price available"
        )


    previous["updatedAt"] =
        now


    LIVE_FILE.write_text(
        json.dumps(
            previous,
            indent=2,
            ensure_ascii=False
        ) + "\n",
        encoding="utf-8"
    )


    print(
        json.dumps(
            previous,
            indent=2,
            ensure_ascii=False
        )
    )


if __name__ == "__main__":
    main()
