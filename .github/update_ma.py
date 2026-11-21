#!/usr/bin/env python3
"""
이동평균선(SMA) 데이터 생성 — ma.json

ma.html 이 실시간 가격으로 이동평균선을 다시 계산할 수 있도록,
"확정된 봉" 기준의 재료만 저장한다.

- Yahoo Finance 차트 API 에서 BTC-USD / MSTR 의 일봉(1d)·주봉(1wk) 10년치를 받아온다.
  (period1/period2 를 직접 지정하지 않으면 Yahoo 가 장기 구간에서 월봉으로 낮춰 버리므로 반드시 지정한다)
- 기간(N)마다 확정 봉 N-1개의 종가 합(prevSum)과, 확정 봉만 쓴 N기간 SMA(closedSma)를 저장한다.
- ma.html: 실시간 SMA = (prevSum + 실시간가) / N , 이격도 = (실시간가 - 실시간SMA) / 실시간SMA * 100
- 진행 중인 봉(오늘 일봉, 이번 주 주봉)은 확정 봉에서 제외한다. 그 자리는 실시간가가 대신한다.
"""

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import requests

# =========================================================
# CONFIG
# =========================================================

MA_FILE = Path("ma.json")

SYMBOLS = [
    ("BTC-USD", "비트코인 (BTC-USD)"),
    ("MSTR", "MSTR (Strategy)"),
]

DAILY_PERIODS = [20, 50, 120, 200, 300, 365]
WEEKLY_PERIODS = [50, 100, 120, 200, 300, 365]

RANGE_YEARS = 10
TIMEOUT = 30
RETRIES = 3

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json,text/plain,*/*",
}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)


# =========================================================
# YAHOO CHART
# =========================================================

def fetch_bars(symbol, interval):
    """Yahoo 차트 API 에서 봉 목록을 받아온다. [{ts, date, close}, ...] (오래된 순)"""
    now = int(time.time())
    period1 = now - int(RANGE_YEARS * 365.25 * 86400)
    last_error = None

    for attempt in range(RETRIES):
        for host in ("query1", "query2"):
            url = (
                f"https://{host}.finance.yahoo.com/v8/finance/chart/{quote(symbol)}"
                f"?period1={period1}&period2={now}&interval={interval}"
                "&events=history&includeAdjustedClose=true"
            )
            try:
                res = SESSION.get(url, timeout=TIMEOUT)
                res.raise_for_status()
                payload = res.json()

                chart = payload.get("chart") or {}
                result = chart.get("result") or []
                if not result:
                    raise RuntimeError(f"empty chart result: {chart.get('error')}")

                node = result[0]
                timestamps = node.get("timestamp") or []
                quote_node = ((node.get("indicators") or {}).get("quote") or [{}])[0]
                closes = quote_node.get("close") or []
                adj = ((node.get("indicators") or {}).get("adjclose") or [{}])[0].get("adjclose") or []

                bars = []
                for index, (stamp, close) in enumerate(zip(timestamps, closes)):
                    value = close
                    if value is None and index < len(adj):
                        value = adj[index]
                    if value is None:
                        continue
                    try:
                        value = float(value)
                    except (TypeError, ValueError):
                        continue
                    if value <= 0:
                        continue
                    bars.append({
                        "ts": int(stamp),
                        "date": datetime.fromtimestamp(stamp, timezone.utc).date(),
                        "close": value,
                    })

                if len(bars) < 400:
                    raise RuntimeError(f"too few bars: {len(bars)}")

                return bars

            except Exception as error:  # noqa: BLE001 - 어떤 실패든 다음 경로로 넘어간다
                last_error = error
                print(f"  WARNING: {symbol} {interval} {host} 실패: {error}")
                time.sleep(1.0)

    raise RuntimeError(f"{symbol} {interval} 데이터를 받지 못했습니다: {last_error}")


def to_weekly(bars):
    """일봉을 ISO 주 단위로 묶어 주봉을 만든다.

    Yahoo 의 1wk 응답은 같은 주를 두 번(월요일 시작 봉 + 그 주 마지막 봉) 주는 경우가 있어
    주 단위로 중복을 제거하고, 그 주의 가장 마지막 봉 종가를 주봉 종가로 쓴다.
    """
    buckets = {}
    order = []

    for bar in bars:
        year, week, _ = bar["date"].isocalendar()
        key = (year, week)
        if key not in buckets:
            order.append(key)
        buckets[key] = bar

    return [buckets[key] for key in order]


def drop_current_week(bars):
    """진행 중인 이번 주 봉을 확정 봉에서 제외한다."""
    today = datetime.now(timezone.utc).date()
    current = today.isocalendar()[:2]
    return [bar for bar in bars if bar["date"].isocalendar()[:2] != current]


def build_periods(closed_bars, periods):
    """확정 봉 기준 기간별 SMA·이전 (N-1)봉 종가 합을 만든다."""
    result = {}
    count = len(closed_bars)

    for period in periods:
        if count < period:
            result[str(period)] = {
                "available": False,
                "need": period,
                "have": count,
            }
            continue

        window = closed_bars[-period:]
        previous = closed_bars[-(period - 1):] if period > 1 else []
        closed_sma = sum(bar["close"] for bar in window) / period
        prev_sum = sum(bar["close"] for bar in previous)

        result[str(period)] = {
            "available": True,
            # 확정 봉만으로 계산한 값 (마지막 확정 봉까지의 SMA)
            "closedSma": round(closed_sma, 4),
            # 실시간 SMA 계산용: 확정 봉 N-1개 종가 합
            "prevSum": round(prev_sum, 6),
            "from": window[0]["date"].isoformat(),
            "to": window[-1]["date"].isoformat(),
        }

    return result


def build_symbol(symbol, name):
    daily_raw = fetch_bars(symbol, "1d")
    weekly_raw = fetch_bars(symbol, "1wk")

    # 일봉: 진행 중인 오늘 봉은 확정 봉에서 제외
    today = datetime.now(timezone.utc).date()
    closed_daily = [bar for bar in daily_raw if bar["date"] < today]

    # 주봉: Yahoo 1wk 응답을 주 단위로 정리한 뒤 이번 주 봉은 제외
    closed_weekly = drop_current_week(to_weekly(weekly_raw))

    if not closed_daily or not closed_weekly:
        raise RuntimeError(f"{symbol}: 확정 봉이 없습니다")

    last_daily = closed_daily[-1]
    last_weekly = closed_weekly[-1]

    return {
        "name": name,
        "currency": "USD",
        # 마지막 확정 봉 (실시간 시세를 못 받았을 때의 대체 현재가)
        "lastPrice": round(last_daily["close"], 4),
        "lastDailyDate": last_daily["date"].isoformat(),
        "lastWeeklyDate": last_weekly["date"].isoformat(),
        "dailyBars": len(closed_daily),
        "weeklyBars": len(closed_weekly),
        "daily": build_periods(closed_daily, DAILY_PERIODS),
        "weekly": build_periods(closed_weekly, WEEKLY_PERIODS),
    }


def main():
    generated_at = datetime.now(timezone.utc)
    symbols = {}

    for symbol, name in SYMBOLS:
        print(f"== {symbol} ({name})")
        symbols[symbol] = build_symbol(symbol, name)

    payload = {
        "updatedAt": generated_at.isoformat(timespec="seconds"),
        "source": "Yahoo Finance chart API (1d / 1wk, 10년)",
        "note": (
            "prevSum = 확정 봉 N-1개 종가 합. 실시간 SMA = (prevSum + 실시간가) / N. "
            "진행 중인 오늘 일봉·이번 주 주봉은 확정 봉에서 제외."
        ),
        "periods": {
            "daily": DAILY_PERIODS,
            "weekly": WEEKLY_PERIODS,
        },
        "symbols": symbols,
    }

    MA_FILE.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(f"ma.json 저장 완료 ({MA_FILE.stat().st_size:,} bytes)")
    for symbol, data in symbols.items():
        sample = data["daily"].get("365", {})
        weekly_sample = data["weekly"].get("365", {})
        print(
            f"  {symbol}: 최근 확정 일봉 {data['lastDailyDate']} ${data['lastPrice']:,.2f} / "
            f"SMA365D ${sample.get('closedSma', float('nan')):,.2f} / "
            f"SMA365W ${weekly_sample.get('closedSma', float('nan')):,.2f}"
        )


if __name__ == "__main__":
    main()
