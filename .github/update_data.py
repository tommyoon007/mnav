"""Strategy(MSTR)의 주간 8-K·대시보드 수치를 읽어 data.json 을 최신화한다.

이 스크립트는 GitHub Actions(.github/workflows/update-mnav-data.yml)에서 매일 실행되며,
Strategy가 주간 8-K를 제출하면 다음 실행에서 data.json 이 자동으로 갱신된다.
화면(script.js)은 시작할 때 data.json 을 읽어 기초지표를 채우므로, 배포만 되면
사용자의 휴대폰에도 별도 조작 없이 최신 수치가 반영된다.

수집 우선순위
  1) Strategy.com 대시보드 API (api.strategy.com) — 6개 값 모두
     · debt / pref / usdAssets(= USD Reserve + USD Cash) / USD Reserve / USD Cash
     · btcHoldings, ADSO, FDSO (sats/share·net BTC/share 로부터 역산해 교차검증)
  2) SEC EDGAR 8-K (CIK 1050446) — btcHoldings, USD Reserve + USD Cash, 제출일
     (API가 막혔을 때 최소한 BTC 보유량과 USD 자산은 계속 전진시킨다)
  3) FALLBACK — 위 두 소스가 모두 실패해도 절대 옛 값(6.69 / 6.754 / 14.966)으로
     되돌아가지 않도록 고정해 둔 최신 확인값 (2026-11-18 Strategy.com 기준)

주의: adso = Assumed Diluted Shares Outstanding(≈457.244M), fdso = Fully Diluted
Shares Outstanding(≈431.632M) 이다. 두 값을 서로 바꾸거나 같은 값으로 쓰면
Strategy.com 과 다른 Net BPS·mNAV 가 나온다.
"""

import json
import re
from datetime import date, datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

DATA_FILE = Path("data.json")

# data.json 스키마 버전. 1 → 2 로 올리면서 잘못된 주식수(adso=424.479 / fdso=303.986)와
# 옛 재무값(6.69 / 6.754 / 14.966)을 FALLBACK 값으로 한 번 교체한다.
DATA_VERSION = 2

# Strategy.com 대시보드에서 확인한 최신 값 (2026-11-18).
# 어떤 소스도 값을 못 줬을 때 이 값이 쓰인다.
FALLBACK = {
    "btcHoldings": 850849,
    "adso": 457.244,        # Assumed Diluted Shares Outstanding (M)
    "fdso": 431.632,        # Fully Diluted Shares Outstanding (M)
    "usdAssetsUsdB": 4.900,   # USD Reserve 4,749 + USD Cash 151
    "debtUsdB": 6.714,
    "preferredUsdB": 12.709,
    "usdReserveUsdB": 4.749,
    "usdCashUsdB": 0.151,
    "asOf": "2026-11-18",
}
FALLBACK_SOURCE = "Strategy.com dashboard (verified fallback)"

SEC_SUBMISSIONS = "https://data.sec.gov/submissions/CIK0001050446.json"

SEC_HEADERS = {
    "User-Agent": "MNAV-Dashboard/2.0 (contact@mnav.app)",
    "Accept-Encoding": "gzip, deflate",
    "Host": "data.sec.gov",
}
SEC_ARCHIVE_HEADERS = {
    "User-Agent": "MNAV-Dashboard/2.0 (contact@mnav.app)",
    "Accept-Encoding": "gzip, deflate",
}

# Strategy.com 대시보드가 쓰는 공개 JSON API (인증 없음, CORS 허용).
# mstrKpiData: debt / pref / usdAssets / usdReserve / usdCash
# bitcoinKpis: btcHoldings / satsPerShare / netBtcPerShareUsd / netBtcReserve
STRATEGY_API_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; MNAV-Dashboard/2.0)",
    "Accept": "application/json",
    "Origin": "https://www.strategy.com",
}
STRATEGY_MSTR_API = "https://api.strategy.com/btc/mstrKpiData"
STRATEGY_BTC_API = "https://api.strategy.com/btc/bitcoinKpis"

TIMEOUT = 30
MAX_8K_SCAN = 30

FIELDS = (
    "btcHoldings",
    "adso",
    "fdso",
    "usdAssetsUsdB",
    "debtUsdB",
    "preferredUsdB",
)


def log(message):
    print(message, flush=True)


def to_number(value):
    """'6,714' / '$4.75 billion' 같은 문자열에서 숫자만 뽑는다."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    cleaned = str(value).replace(",", "").replace("$", "").strip()
    try:
        return float(cleaned)
    except ValueError:
        return None


# ──────────────────────────────────────────────────────────────
# data.json 읽기 / 검증
# ──────────────────────────────────────────────────────────────
def valid_fundamentals(data):
    """6개 값이 모두 숫자이고 현실적인 범위 안에 있는지 본다."""
    try:
        btc = float(data["btcHoldings"])
        adso = float(data["adso"])
        fdso = float(data["fdso"])
        usd = float(data["usdAssetsUsdB"])
        debt = float(data["debtUsdB"])
        pref = float(data["preferredUsdB"])
    except (KeyError, TypeError, ValueError):
        return False

    return (
        500_000 < btc < 2_000_000
        and 200 < adso < 800
        and 200 < fdso < 800
        and 0 <= usd < 200
        and 0 <= debt < 200
        and 0 <= pref < 200
    )


def load_data():
    """기존 data.json 을 읽어 이어 쓸 기반을 만든다.

    스키마 버전이 다르거나 필수 값이 깨져 있으면 FALLBACK 값으로 새로 시작한다.
    (예전 파일의 adso 424.479 / fdso 303.986, usdAssets 6.69 / debt 6.754 /
     preferred 14.966 같은 값이 그대로 남아 되돌아가는 일을 막는다.)
    """
    data = {}
    if DATA_FILE.exists():
        try:
            loaded = json.loads(DATA_FILE.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                data = loaded
            else:
                log(f"WARNING: data.json 형식이 dict 가 아님: {type(loaded).__name__}")
        except Exception as exc:
            log(f"WARNING: data.json 을 읽지 못했습니다: {exc}")

    if data.get("dataVersion") != DATA_VERSION or not valid_fundamentals(data):
        if data:
            log("data.json 이 예전 스키마이거나 값이 깨져 있어 FALLBACK 값으로 초기화합니다.")
        merged = dict(FALLBACK)
        merged.update({
            "source": FALLBACK_SOURCE,
            "updatedAt": data.get("updatedAt"),
        })
        return merged

    for key in FIELDS:
        data[key] = float(data[key])
    return data


# ──────────────────────────────────────────────────────────────
# 1) Strategy.com 대시보드 API
# ──────────────────────────────────────────────────────────────
def get_json(url, headers, timeout=TIMEOUT):
    response = requests.get(url, headers=headers, timeout=timeout)
    response.raise_for_status()
    return response.json()


def fetch_strategy_api():
    """Strategy.com 대시보드 API 에서 6개 값을 모두 가져온다. 실패하면 None."""
    mstr_rows = get_json(STRATEGY_MSTR_API, STRATEGY_API_HEADERS)
    if isinstance(mstr_rows, dict):
        mstr_rows = [mstr_rows]
    mstr = next((row for row in mstr_rows if row.get("company") == "MSTR"), None)
    if not mstr:
        log("WARNING: mstrKpiData 에 MSTR 행이 없습니다.")
        return None

    btc_body = get_json(STRATEGY_BTC_API, STRATEGY_API_HEADERS)
    btc = btc_body.get("results", btc_body) if isinstance(btc_body, dict) else {}

    debt_m = to_number(mstr.get("debt"))
    pref_m = to_number(mstr.get("pref"))
    usd_assets_m = to_number(mstr.get("usdAssets"))
    usd_reserve_m = to_number(mstr.get("usdReserve"))
    usd_cash_m = to_number(mstr.get("usdCash"))

    btc_holdings = to_number(btc.get("btcHoldings"))
    sats_per_share = to_number(btc.get("satsPerShare"))
    net_btc_per_share_usd = to_number(btc.get("netBtcPerShareUsd"))
    net_btc_reserve_usd = to_number(btc.get("netBtcReserve"))

    missing = [
        name for name, value in (
            ("debt", debt_m),
            ("pref", pref_m),
            ("usdAssets", usd_assets_m),
            ("btcHoldings", btc_holdings),
            ("satsPerShare", sats_per_share),
            ("netBtcPerShareUsd", net_btc_per_share_usd),
            ("netBtcReserve", net_btc_reserve_usd),
        ) if value is None
    ]
    if missing:
        log(f"WARNING: Strategy API 응답에 값이 없습니다: {', '.join(missing)}")
        return None

    if not sats_per_share or not net_btc_per_share_usd:
        log("WARNING: Strategy API 의 주당 지표가 0 입니다.")
        return None

    # 주식수 역산
    #   sats/share      = btcHoldings / ADSO(M) * 100
    #   net BTC/share($)= netBtcReserve / FDSO(M) / 1e6
    adso_m = btc_holdings * 100 / sats_per_share
    fdso_m = net_btc_reserve_usd / net_btc_per_share_usd / 1e6

    result = {
        "btcHoldings": int(round(btc_holdings)),
        "adso": round(adso_m, 3),
        "fdso": round(fdso_m, 3),
        "usdAssetsUsdB": round(usd_assets_m / 1000, 3),
        "debtUsdB": round(debt_m / 1000, 3),
        "preferredUsdB": round(pref_m / 1000, 3),
        "usdReserveUsdB": round((usd_reserve_m or 0) / 1000, 3),
        "usdCashUsdB": round((usd_cash_m or 0) / 1000, 3),
    }

    # 교차검증: USD 자산 = USD Reserve + USD Cash (반올림 오차 3백만 달러 허용)
    if usd_reserve_m is not None and usd_cash_m is not None:
        if usd_assets_m is not None and abs(usd_assets_m - (usd_reserve_m + usd_cash_m)) > 3:
            log(
                "WARNING: USD Assets 와 (USD Reserve + USD Cash) 가 "
                f"{usd_assets_m:,.0f} vs {usd_reserve_m + usd_cash_m:,.0f} 로 어긋납니다."
            )

    # 교차검증: 역산한 주식수로 다시 계산한 주당 값이 대시보드 값과 맞는지
    if abs(btc_holdings / adso_m * 100 - sats_per_share) / sats_per_share > 0.001:
        log("WARNING: 역산 ADSO 가 sats/share 와 맞지 않습니다.")
    if abs(net_btc_reserve_usd / (fdso_m * 1e6) - net_btc_per_share_usd) / net_btc_per_share_usd > 0.001:
        log("WARNING: 역산 FDSO 가 net BTC/share 와 맞지 않습니다.")

    if not valid_fundamentals(result):
        log(f"WARNING: Strategy API 값이 범위를 벗어났습니다: {result}")
        return None

    result["timestamp"] = btc_body.get("timestamp") if isinstance(btc_body, dict) else None
    return result


# ──────────────────────────────────────────────────────────────
# 2) SEC EDGAR 8-K
# ──────────────────────────────────────────────────────────────
def sec_json(url):
    response = requests.get(url, headers=SEC_HEADERS, timeout=TIMEOUT)
    response.raise_for_status()
    return response.json()


def sec_text(url):
    response = requests.get(url, headers=SEC_ARCHIVE_HEADERS, timeout=TIMEOUT)
    response.raise_for_status()
    return response.text


def get_recent_8k_filings():
    data = sec_json(SEC_SUBMISSIONS)
    recent = data["filings"]["recent"]
    filings = []
    for i, form in enumerate(recent["form"]):
        if form != "8-K":
            continue
        filings.append({
            "accession": recent["accessionNumber"][i],
            "primaryDocument": recent["primaryDocument"][i],
            "filingDate": recent["filingDate"][i],
        })
        if len(filings) >= MAX_8K_SCAN:
            break
    return filings


def filing_url(filing):
    accession = filing["accession"].replace("-", "")
    return (
        "https://www.sec.gov/Archives/edgar/data/"
        f"1050446/{accession}/{filing['primaryDocument']}"
    )


def clean_number(value):
    return float(value.replace(",", "").replace("$", "").strip())


def first_match(text, patterns):
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
        if match:
            try:
                return clean_number(match.group(1))
            except ValueError:
                continue
    return None


def parse_8k_text(filing):
    html = sec_text(filing_url(filing))
    soup = BeautifulSoup(html, "html.parser")
    text = re.sub(r"\s+", " ", soup.get_text(" ", strip=True))

    # BTC 보유량 — "Aggregate BTC Holdings ... 850,849"
    btc = first_match(text, [
        r"Aggregate BTC Holdings(?:\s*\(1\))?\s*[:$\-]?\s*([\d,]+)",
        r"BTC Holdings\s*[:\-]?\s*([\d,]+)",
        r"holds\s+([\d,]+)\s+bitcoin",
        r"hold(?:s|ing)\s+([\d,]+)\s+bitcoin",
    ])

    # USD Reserve / USD Cash — "the balances of the USD Reserve and USD Cash were
    # $4.75 billion and $151.2 million, respectively."
    usd_reserve = first_match(text, [
        r"USD Reserve and USD Cash were \$([\d.]+)\s*billion",
        r"USD Reserve[^$]{0,200}\$([\d.]+)\s*billion",
    ])
    usd_cash = first_match(text, [
        r"USD Reserve and USD Cash were \$[\d.]+\s*billion and \$([\d.]+)\s*million",
        r"USD Cash[^$]{0,200}\$([\d.]+)\s*million",
    ])

    usd_assets = first_match(text, [
        r"\$([\d.]+)\s*billion\s+of\s+USD\s+Assets",
        r"USD\s+Assets[^$]{0,120}\$([\d.]+)\s*billion",
        r"USD\s+assets[^$]{0,120}\$([\d.]+)\s*billion",
    ])
    if usd_assets is None and usd_reserve is not None:
        usd_assets = usd_reserve + (usd_cash or 0) / 1000

    debt = first_match(text, [
        r"deducting\s+\$([\d.]+)\s*billion\s+of\s+debt",
        r"\$([\d.]+)\s*billion\s+of\s+debt(?:\s+and|,)",
        r"Debt\s*\(?(?:\$M)?\)?\s*\$?\s*([\d,]+(?:\.\d+)?)\s*million",
    ])

    preferred = first_match(text, [
        r"deducting\s+\$([\d.]+)\s*billion\s+of\s+preferred\s+stock",
        r"\$([\d.]+)\s*billion\s+of\s+preferred\s+stock",
        r"Preferred(?:\s+Stock)?\s*\(?(?:\$M)?\)?\s*\$?\s*([\d,]+(?:\.\d+)?)\s*million",
    ])

    net_reserve = first_match(text, [
        r"\$([\d.]+)\s*billion\s+of\s+Net\s+Reserve",
        r"Net\s+Reserve[^$]{0,120}\$([\d.]+)\s*billion",
    ])

    # 주식수 — 8-K 에 실려 오는 경우에만 채운다(요즘 8-K에는 없다).
    adso = first_match(text, [
        r"Assumed\s+Diluted\s+Shares(?:\s+Outstanding)?[^\d]{0,40}([\d,]+(?:\.\d+)?)\s*(?:million|M)\b",
        r"ADSO[^\d]{0,40}([\d,]+(?:\.\d+)?)\s*(?:million|M)\b",
    ])
    fdso = first_match(text, [
        r"Fully\s+Diluted\s+Shares(?:\s+Outstanding)?[^\d]{0,40}([\d,]+(?:\.\d+)?)\s*(?:million|M)\b",
        r"FDSO[^\d]{0,40}([\d,]+(?:\.\d+)?)\s*(?:million|M)\b",
    ])

    return {
        "btcHoldings": btc,
        "usdReserveUsdB": usd_reserve,
        "usdCashUsdB": usd_cash / 1000 if usd_cash is not None else None,
        "usdAssetsUsdB": usd_assets,
        "debtUsdB": debt,
        "preferredUsdB": preferred,
        "netReserveUsdB": net_reserve,
        "adso": adso,
        "fdso": fdso,
        "filingDate": filing["filingDate"],
        "accession": filing["accession"],
        "document": filing["primaryDocument"],
    }


def fetch_sec_8k():
    """최근 8-K 중 BTC 보유량과 USD 자산이 실린 가장 최근 문서를 읽는다."""
    filings = get_recent_8k_filings()
    btc_source = None
    usd_source = None

    for filing in filings:
        try:
            parsed = parse_8k_text(filing)
        except Exception as exc:
            log(f"WARNING: 8-K 파싱 실패 {filing['accession']}: {exc}")
            continue

        btc = parsed.get("btcHoldings")
        if btc_source is None and btc is not None and 500_000 < btc < 2_000_000:
            btc_source = parsed

        usd = parsed.get("usdAssetsUsdB")
        if usd_source is None and usd is not None and 0 < usd < 200:
            usd_source = parsed

        if btc_source and usd_source:
            break

    return {"btc": btc_source, "usd": usd_source, "filings": filings[:1]}


# ──────────────────────────────────────────────────────────────
# 3) 병합 / 저장
# ──────────────────────────────────────────────────────────────
def merge(data):
    sources = []

    # (1) Strategy.com API
    api = None
    try:
        api = fetch_strategy_api()
    except Exception as exc:
        log(f"Strategy API 실패: {exc}")

    if api:
        for key in FIELDS:
            data[key] = api[key]
        for key in ("usdReserveUsdB", "usdCashUsdB"):
            if api.get(key) is not None:
                data[key] = api[key]
        sources.append("Strategy.com API")
        log(f"Strategy.com API 로 6개 값 갱신 (데이터 시각 {api.get('timestamp')})")
    else:
        log("WARNING: Strategy.com API 를 쓰지 못했습니다. SEC 8-K 와 기존 값으로 진행합니다.")

    # (2) SEC 8-K — API에서 못 받은 값만 보완하고, 제출일을 asOf 로 남긴다.
    try:
        sec = fetch_sec_8k()
    except Exception as exc:
        log(f"SEC 8-K 조회 실패: {exc}")
        sec = None

    if sec:
        btc_source = sec.get("btc")
        usd_source = sec.get("usd")

        if btc_source and (api is None):
            data["btcHoldings"] = int(round(btc_source["btcHoldings"]))
            log(f"SEC 8-K {btc_source['filingDate']}: BTC 보유량 {data['btcHoldings']:,}")

        if usd_source and (api is None or not api.get("usdAssetsUsdB")):
            data["usdAssetsUsdB"] = round(float(usd_source["usdAssetsUsdB"]), 3)
            if usd_source.get("usdReserveUsdB") is not None:
                data["usdReserveUsdB"] = round(float(usd_source["usdReserveUsdB"]), 3)
            if usd_source.get("usdCashUsdB") is not None:
                data["usdCashUsdB"] = round(float(usd_source["usdCashUsdB"]), 3)
            log(f"SEC 8-K {usd_source['filingDate']}: USD 자산 {data['usdAssetsUsdB']:.3f}B")

        for key in ("debtUsdB", "preferredUsdB", "adso", "fdso"):
            filled = None
            for candidate in (btc_source, usd_source):
                if candidate and candidate.get(key) is not None:
                    filled = candidate[key]
                    break
            if filled is not None and (api is None or not api.get(key)):
                data[key] = round(float(filled), 3)
                log(f"SEC 8-K 에서 {key} = {data[key]} 반영")

        if sec.get("filings"):
            latest = sec["filings"][0]
            data["last8K"] = {
                "filingDate": latest["filingDate"],
                "accession": latest["accession"],
                "document": latest["primaryDocument"],
            }
            data["asOf"] = latest["filingDate"]
        if btc_source or usd_source:
            sources.append("SEC 8-K")
    else:
        data.setdefault("asOf", FALLBACK["asOf"])

    if not sources:
        # 외부 소스가 모두 실패하면 data.json 의 기존 값(load_data 가 FALLBACK 이상으로
        # 보장한 값)을 그대로 둔다. 옛 값(6.69 / 6.754 / 14.966)으로 되돌아가지 않는다.
        log(
            "WARNING: 외부 소스가 모두 실패했습니다. "
            "기존 data.json 값을 그대로 유지합니다."
        )

    return data, sources


def main():
    data = load_data()
    previous = {key: data.get(key) for key in FIELDS}
    previous_updated_at = data.get("updatedAt")
    data, sources = merge(data)

    if sources:
        data["source"] = " + ".join(dict.fromkeys(sources))
    data.setdefault("asOf", date.today().isoformat())
    data["dataVersion"] = DATA_VERSION

    # updatedAt 은 '숫자가 실제로 바뀐 시각'만 기록한다.
    # (매일 도는 워크플로가 같은 값으로 updatedAt 만 바꿔 커밋하면, 앱이 그걸
    #  '새 8-K' 로 오인해 사용자가 직접 고친 값을 매일 덮어쓸 수 있다.)
    now = datetime.now(timezone.utc).isoformat()
    values_changed = any(
        previous.get(key) is None or abs(float(previous[key]) - float(data[key])) > 1e-9
        for key in FIELDS
    )
    data["updatedAt"] = now if (values_changed or not previous_updated_at) else previous_updated_at
    log("6개 값 변경:" + (" 있음 → updatedAt 갱신" if values_changed else " 없음 → updatedAt 유지"))
    data["notes"] = (
        "btcHoldings / ADSO / FDSO / USD Assets / Debt / Preferred 는 Strategy.com 대시보드 "
        "(주간 8-K 로 갱신) 기준. USD Assets = USD Reserve + USD Cash."
    )

    if not valid_fundamentals(data):
        raise RuntimeError(f"Sanity check 실패: {({k: data.get(k) for k in FIELDS})}")
    for key in FIELDS:
        data[key] = float(data[key])
    data["btcHoldings"] = int(round(data["btcHoldings"]))

    # 시세에 따라 매번 달라지는 파생값은 파일에 남기지 않는다(불필요한 커밋 방지).
    data.pop("netReserveUsdB", None)

    # 파일 안 키 순서를 보기 좋게 정리한다.
    ordered = {}
    for key in FIELDS:
        ordered[key] = data[key]
    for key in (
        "usdReserveUsdB", "usdCashUsdB",
        "asOf", "updatedAt", "dataVersion", "source", "last8K", "notes",
    ):
        if key in data:
            ordered[key] = data[key]
    for key, value in data.items():
        if key not in ordered:
            ordered[key] = value

    DATA_FILE.write_text(
        json.dumps(ordered, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(ordered, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
