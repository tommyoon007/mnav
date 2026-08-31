import json
from datetime import datetime, timezone
from pathlib import Path

import requests


LIVE_FILE = Path("live.json")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
}

TIMEOUT = 15


def load_previous():
    if LIVE_FILE.exists():
        try:
            return json.loads(
                LIVE_FILE.read_text(encoding="utf-8")
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
    # 1. Coinbase API
    try:
        url = "https://api.coinbase.com/v2/prices/spot?currency=USD"
        res = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        res.raise_for_status()
        price = float(res.json()["data"]["amount"])
        if price > 0:
            return price, "Coinbase"
    except Exception:
        pass

    # 2. Binance API
    try:
        url = "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT"
        res = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        res.raise_for_status()
        price = float(res.json()["price"])
        if price > 0:
            return price, "Binance"
    except Exception:
        pass

    # 3. CoinGecko API
    try:
        url = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
        res = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        res.raise_for_status()
        price = float(res.json()["bitcoin"]["usd"])
        if price > 0:
            return price, "CoinGecko"
    except Exception:
        pass

    raise RuntimeError("모든 BTC 가격 API 조회 실패")


def get_mstr_price():
    # 1. Yahoo Finance query1
    try:
        url = "https://query1.finance.yahoo.com/v8/finance/chart/MSTR?range=1d&interval=1m"
        res = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        res.raise_for_status()
        price = float(res.json()["chart"]["result"][0]["meta"]["regularMarketPrice"])
        if price > 0:
            return price, "Yahoo Finance (v8)"
    except Exception:
        pass

    # 2. Yahoo Finance query2
    try:
        url = "https://query2.finance.yahoo.com/v8/finance/chart/MSTR?range=1d&interval=1m"
        res = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        res.raise_for_status()
        price = float(res.json()["chart"]["result"][0]["meta"]["regularMarketPrice"])
        if price > 0:
            return price, "Yahoo Finance (v2)"
    except Exception:
        pass

    raise RuntimeError("모든 MSTR 주가 API 조회 실패")


def main():
    previous = load_previous()
    now = datetime.now(timezone.utc).isoformat()

    # BTC 가격 수집
    try:
        btc_price, btc_source = get_btc_price()
        previous["btcPrice"] = btc_price
        previous["btcSource"] = btc_source
        print(f"BTC ({btc_source}): {btc_price}")
    except Exception as exc:
        print("BTC 가격 업데이트 실패:", exc)

    # MSTR 주가 수집
    try:
        mstr_price, mstr_source = get_mstr_price()
        previous["mstrPrice"] = mstr_price
        previous["mstrSource"] = mstr_source
        print(f"MSTR ({mstr_source}): {mstr_price}")
    except Exception as exc:
        print("MSTR 주가 업데이트 실패:", exc)

    if previous.get("btcPrice") is None or previous.get("mstrPrice") is None:
        raise RuntimeError("유효한 시장 가격을 확보하지 못했습니다.")

    previous["updatedAt"] = now

    LIVE_FILE.write_text(
        json.dumps(previous, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8"
    )

    print(json.dumps(previous, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
