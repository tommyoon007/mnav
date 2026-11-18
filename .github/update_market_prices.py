import json
import os
import re
from datetime import datetime, timezone, timedelta
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

HTML_HEADERS = {
    **HEADERS,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

TIMEOUT = 15
HTML_TIMEOUT = 25

# Yahoo 주간거래(Blue Ocean ATS): 미국 동부시각 20:00 ~ 04:00 (일~목 밤)
OVERNIGHT_START_HOUR = 20
OVERNIGHT_END_HOUR = 4


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


def et_now():
    """미국 동부(뉴욕) 현재 시각. zoneinfo 가 없으면 고정 오프셋으로 대체한다."""
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/New_York"))
    except Exception:
        # DST 판단이 불가능한 환경용 안전장치 (동부 표준시 기준)
        return datetime.now(timezone.utc) - timedelta(hours=5)


def is_overnight_session(now=None):
    """지금이 주간거래(Overnight, Blue Ocean ATS) 시간대인지.
    일 20:00 ~ 금 04:00 사이의 밤 시간대만 해당한다 (금요일 밤·토요일 제외)."""
    now = now or et_now()
    # weekday(): 월=0 ... 일=6
    weekday = now.weekday()
    hour = now.hour

    if hour >= OVERNIGHT_START_HOUR:
        # 20:00 이후: 일~목요일 밤에만 주간거래가 열린다
        return weekday in (6, 0, 1, 2, 3)
    if hour < OVERNIGHT_END_HOUR:
        # 04:00 이전: 월~금 새벽에만 주간거래가 열린다
        return weekday in (0, 1, 2, 3, 4)
    return False


def _num(value):
    # Yahoo quote JSON 은 {"raw": 98.0, "fmt": "98.00"} 형태로 값을 준다.
    if isinstance(value, dict):
        value = value.get("raw")
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    return num if num > 0 else None


def _ts(value):
    if isinstance(value, dict):
        value = value.get("raw")
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def _candidate(price, when, session, source, synthetic=False):
    price = _num(price)
    if price is None:
        return None
    return {
        "price": price,
        "time": _ts(when),
        "session": session,
        "source": source,
        "synthetic": synthetic,
    }


def yahoo_chart_candidates():
    """v8/finance/chart meta 에서 정규장·프리마켓·애프터마켓·(주간거래) 후보를 모은다."""
    candidates = []
    meta = None

    for host in ("query1", "query2"):
        try:
            url = f"https://{host}.finance.yahoo.com/v8/finance/chart/MSTR?range=1d&interval=1m&includePrePost=true"
            res = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
            res.raise_for_status()
            meta = res.json()["chart"]["result"][0]["meta"]
            break
        except Exception:
            continue

    if not meta:
        return candidates

    for price_key, time_key, session in (
        ("regularMarketPrice", "regularMarketTime", "정규장"),
        ("postMarketPrice", "postMarketTime", "애프터마켓"),
        ("preMarketPrice", "preMarketTime", "프리마켓"),
    ):
        cand = _candidate(meta.get(price_key), meta.get(time_key), session, "Yahoo Finance (v8)")
        if cand:
            candidates.append(cand)

    # 차트 API meta 는 주간거래 가격을 overnightMarketPrice 로 주지 않지만,
    # fulldayPrice 는 주간거래를 포함한 가장 최근 체결가를 담고 있다.
    # 주간거래 시간대일 때만 이 값을 주간거래 후보로 쓴다 (정규장·프리마켓·애프터마켓 우선 원칙 유지).
    if is_overnight_session():
        cand = _candidate(
            meta.get("fulldayPrice"),
            int(datetime.now(timezone.utc).timestamp()),
            "주간거래(Overnight)",
            "Yahoo Finance (Overnight/Blue Ocean)",
            synthetic=True,
        )
        if cand:
            candidates.append(cand)

    return candidates


def _extract_yahoo_quote(html):
    """finance.yahoo.com/quote/MSTR/ HTML 안에 심어진 quote JSON(MSTR)을 꺼낸다."""
    blocks = re.findall(
        r'<script[^>]*type="application/json"[^>]*>(.*?)</script>',
        html,
        re.S,
    )

    for block in blocks:
        if "overnightMarketPrice" not in block or "MSTR" not in block:
            continue
        try:
            outer = json.loads(block)
        except Exception:
            continue
        body = outer.get("body") if isinstance(outer, dict) else None
        if not isinstance(body, str):
            continue
        try:
            data = json.loads(body)
        except Exception:
            continue

        results = (data.get("quoteResponse") or {}).get("result") or []
        for item in results:
            if isinstance(item, dict) and item.get("symbol") == "MSTR":
                return item

    return None


def yahoo_quote_page_candidates():
    """quote 페이지에서 주간거래 가격(Blue Ocean)과 각 장의 시각을 함께 꺼낸다."""
    candidates = []
    try:
        res = requests.get(
            "https://finance.yahoo.com/quote/MSTR/",
            headers=HTML_HEADERS,
            timeout=HTML_TIMEOUT,
        )
        res.raise_for_status()
        item = _extract_yahoo_quote(res.text)
    except Exception:
        item = None

    if not item:
        return candidates

    for price_key, time_key, session in (
        ("regularMarketPrice", "regularMarketTime", "정규장"),
        ("postMarketPrice", "postMarketTime", "애프터마켓"),
        ("preMarketPrice", "preMarketTime", "프리마켓"),
        ("overnightMarketPrice", "overnightMarketTime", "주간거래(Overnight)"),
    ):
        source = "Yahoo Finance (Overnight/Blue Ocean)" if session.startswith("주간거래") else "Yahoo Finance (quote)"
        cand = _candidate(item.get(price_key), item.get(time_key), session, source)
        if cand:
            candidates.append(cand)

    return candidates


def finnhub_candidate():
    """(선택) 저장소 시크릿 FINNHUB_KEY 가 있을 때만 사용한다. 키는 로그에 남기지 않는다."""
    finnhub_key = os.environ.get("FINNHUB_KEY", "").strip()
    if not finnhub_key:
        return None

    try:
        url = "https://finnhub.io/api/v1/quote"
        res = requests.get(
            url,
            params={"symbol": "MSTR"},
            headers={**HEADERS, "X-Finnhub-Token": finnhub_key},
            timeout=TIMEOUT
        )
        res.raise_for_status()
        data = res.json()
        return _candidate(data.get("c"), data.get("t"), "Finnhub 현재가", "Finnhub")
    except Exception as exc:
        print(f"Finnhub 조회 실패({type(exc).__name__}) — 다른 시세 경로로 넘어갑니다.")
        return None


def get_mstr_price():
    """정규장 / 프리마켓 / 애프터마켓 / 주간거래 후보 중 '가장 최근 시각'의 가격을 쓴다.
    (프리마켓·애프터마켓·정규장이 더 최신이면 그 가격이 그대로 우선한다)"""
    candidates = []
    candidates.extend(yahoo_quote_page_candidates())
    candidates.extend(yahoo_chart_candidates())
    finnhub = finnhub_candidate()
    if finnhub:
        candidates.append(finnhub)

    if not candidates:
        raise RuntimeError("모든 MSTR 주가 API 조회 실패")

    # 주간거래 가격이 실제 시각과 함께 확인되면, 시각을 알 수 없는(fulldayPrice 기반)
    # 추정 후보는 버려서 실제 체결 시각을 기록한다.
    real_overnight = [c for c in candidates if not c["synthetic"] and c["session"].startswith("주간거래")]
    if real_overnight:
        candidates = [c for c in candidates if not c["synthetic"]]

    for c in candidates:
        print(f"  후보: {c['session']} ${c['price']} @ {c['time']} ({c['source']})")

    # 시각이 가장 최근인 후보를 고른다. 시각이 같으면 뒤에 온(차트 API) 값을 쓴다.
    best = max(candidates, key=lambda c: (c["time"], c["price"]))
    return best["price"], best["source"], best["session"], best["time"]


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
        mstr_price, mstr_source, mstr_session, mstr_time = get_mstr_price()
        previous["mstrPrice"] = mstr_price
        previous["mstrSource"] = mstr_source
        previous["mstrSession"] = mstr_session
        previous["mstrQuoteTime"] = (
            datetime.fromtimestamp(mstr_time, timezone.utc).isoformat()
            if mstr_time else None
        )
        print(f"MSTR ({mstr_session} / {mstr_source}): {mstr_price}")
    except Exception as exc:
        print("MSTR 주가 업데이트 실패:", exc)

    if previous.get("btcPrice") is None and previous.get("mstrPrice") is None:
        # 시세를 하나도 못 받아도 워크플로를 실패시키지 않는다. live.json 은 그대로 둔다.
        print("경고: 유효한 시장 가격을 확보하지 못했습니다. live.json 을 수정하지 않고 종료합니다.")
        return

    previous["updatedAt"] = now

    LIVE_FILE.write_text(
        json.dumps(previous, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8"
    )

    print(json.dumps(previous, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
