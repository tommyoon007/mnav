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

DAILY_PERIODS = [20, 50, 120, 150, 200, 300, 365]
WEEKLY_PERIODS = [50, 100, 120, 150, 200, 300, 365]

RANGE_YEARS = 10
TIMEOUT = 30
RETRIES = 3

# MVRV Z-Score (Explore21 공개 API, CC BY 4.0) — 실패해도 이평선 갱신은 계속한다.
MVRV_URL = "https://data.explore21.com/v1/metrics/bitcoin-mvrv-z-score"
MVRV_TIMEOUT = 20
MVRV_SLOPE_DAYS = 5
MVRV_DEFAULT_SLOPE = 3.0e-5
MVRV_HISTORY_LOWS = [
    {"label": "2015", "z": -0.57},
    {"label": "2018", "z": -0.47},
    {"label": "2022", "z": -0.34},
]

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


# =========================================================
# MVRV Z-SCORE
# =========================================================

def estimate_mvrv_slope(rows, days=MVRV_SLOPE_DAYS):
    """최근 days일의 (BTC 종가, Z-Score)로 dZ/dBTC 기울기를 단순 선형회귀로 구한다.

    브라우저가 실시간 BTC 가격만큼 Z-Score 를 밀어 볼 때 쓰는 값이라,
    가격이 오르면 Z 도 오르는 정상 방향의 기울기만 인정한다.
    """
    points = []
    for row in rows[-days:]:
        try:
            price = float(row.get("btc_close_usd"))
            z_score = float(row.get("mvrv_z_score"))
        except (TypeError, ValueError):
            continue
        if price > 0:
            points.append((price, z_score))

    if len(points) < 2:
        return None

    count = len(points)
    mean_x = sum(point[0] for point in points) / count
    mean_y = sum(point[1] for point in points) / count
    var_x = sum((point[0] - mean_x) ** 2 for point in points)
    if var_x <= 0:
        return None

    cov = sum((point[0] - mean_x) * (point[1] - mean_y) for point in points)
    slope = cov / var_x
    if not slope > 0:
        return None
    return slope


def previous_mvrv():
    """기존 ma.json 의 mvrvZ 를 읽어 둔다 (API 장애 시 마지막 정상값 유지용)."""
    try:
        data = json.loads(MA_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    value = data.get("mvrvZ")
    return value if isinstance(value, dict) and value.get("zScore") is not None else None


def build_mvrv():
    """Explore21 MVRV Z-Score 로 mvrvZ 객체를 만든다. 실패하면 None."""
    last_error = None

    for attempt in range(1, RETRIES + 1):
        try:
            res = SESSION.get(MVRV_URL, timeout=MVRV_TIMEOUT)
            res.raise_for_status()
            payload = res.json()

            rows = [
                row for row in (payload.get("data") or [])
                if row.get("mvrv_z_score") is not None and row.get("btc_close_usd")
            ]
            if len(rows) < 2:
                raise RuntimeError("MVRV Z-Score 행이 부족합니다")

            rows.sort(key=lambda row: str(row.get("date")))
            latest = rows[-1]
            z_score = float(latest["mvrv_z_score"])
            btc_close = float(latest["btc_close_usd"])

            slope = estimate_mvrv_slope(rows)
            used_default = slope is None
            if used_default:
                slope = MVRV_DEFAULT_SLOPE

            return {
                "date": str(latest["date"]),
                "zScore": round(z_score, 4),
                "btcClose": round(btc_close, 2),
                # 실시간 BTC 가격 1달러당 Z-Score 변화량 (dZ/dBTC)
                "slope": float(f"{slope:.6g}"),
                "slopeBasis": "기본값" if used_default else f"최근 {MVRV_SLOPE_DAYS}일 회귀",
                # Z = 0 이 되는 가격 = 추정 평균 매수단가(실현가격)
                "realizedPrice": round(btc_close - z_score / slope, 2),
                "historyLows": MVRV_HISTORY_LOWS,
                "source": "Explore21 (CC BY 4.0)",
            }
        except Exception as error:  # noqa: BLE001 - 어떤 실패든 이평선 갱신은 계속한다
            last_error = error
            print(f"  WARNING: MVRV Z-Score 실패 ({attempt}/{RETRIES}): {error}")
            time.sleep(1.0 + attempt)

    print(f"  WARNING: MVRV Z-Score 를 받지 못했습니다: {last_error}")
    return None


def main():
    generated_at = datetime.now(timezone.utc)
    symbols = {}

    for symbol, name in SYMBOLS:
        print(f"== {symbol} ({name})")
        symbols[symbol] = build_symbol(symbol, name)

    print("== MVRV Z-Score")
    mvrv = build_mvrv()
    if mvrv is None:
        # 일시적인 API 장애로 카드가 비지 않도록 마지막 정상값을 그대로 쓴다.
        mvrv = previous_mvrv()
        if mvrv:
            mvrv = dict(mvrv, carriedOver=True)
            print("  기존 ma.json 의 MVRV Z-Score 값을 유지합니다.")

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

    if mvrv:
        payload["mvrvZ"] = mvrv

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

    if mvrv:
        try:
            summary = (
                f"  MVRV Z: {mvrv.get('date')} {mvrv.get('zScore')} @ ${float(mvrv.get('btcClose')):,.2f} / "
                f"slope {mvrv.get('slope')} / 실현가격 ${float(mvrv.get('realizedPrice')):,.2f}"
            )
        except (TypeError, ValueError):
            summary = f"  MVRV Z: {mvrv.get('date')} {mvrv.get('zScore')}"
        print(summary)


if __name__ == "__main__":
    main()
