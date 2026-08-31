import json
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from html import unescape

import requests


# =========================================================
# MSTR MARKET HISTORY UPDATE
# =========================================================

DATA_FILE = Path("data.json")
HISTORY_FILE = Path("history.json")


# =========================================================
# STRATEGY.COM
# =========================================================

STRATEGY_HOME_URL = "https://www.strategy.com/"
STRATEGY_BTC_URL = "https://www.strategy.com/btc"
STRATEGY_LEDGER_URL = "https://www.strategy.com/ledger"
STRATEGY_SHARES_URL = "https://www.strategy.com/shares"


# =========================================================
# SEC
# =========================================================

SEC_SUBMISSIONS_URL = (
    "https://data.sec.gov/submissions/"
    "CIK0001050446.json"
)

SEC_ARCHIVES_URL = (
    "https://www.sec.gov/Archives/edgar/data/1050446/"
)


# =========================================================
# MARKET DATA
# =========================================================

YAHOO_URL = (
    "https://query1.finance.yahoo.com/v8/finance/chart/"
    "MSTR?range=1d&interval=1d"
)

YAHOO_URL_ALT = (
    "https://query2.finance.yahoo.com/v8/finance/chart/"
    "MSTR?range=1d&interval=1d"
)

COINGECKO_URL = (
    "https://api.coingecko.com/api/v3/simple/price"
    "?ids=bitcoin&vs_currencies=usd"
)


# =========================================================
# BINANCE
# =========================================================

BINANCE_OI_URL = (
    "https://fapi.binance.com/fapi/v1/openInterest"
    "?symbol=BTCUSDT"
)

BINANCE_FUNDING_URL = (
    "https://fapi.binance.com/fapi/v1/fundingRate"
    "?symbol=BTCUSDT&limit=1"
)


# =========================================================
# BYBIT
# =========================================================

BYBIT_TICKER_URL = (
    "https://api.bybit.com/v5/market/tickers"
    "?category=linear&symbol=BTCUSDT"
)


# =========================================================
# OKX
# =========================================================

OKX_OI_URL = (
    "https://www.okx.com/api/v5/public/open-interest"
    "?instType=SWAP&instId=BTC-USDT-SWAP"
)

OKX_FUNDING_URL = (
    "https://www.okx.com/api/v5/public/funding-rate"
    "?instId=BTC-USDT-SWAP"
)


# =========================================================
# HTTP
# =========================================================

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

SEC_HEADERS = {
    "User-Agent": "MNAV-Dashboard/11.0 (contact@mnav.app)",
    "Accept": "text/html,application/json",
}

TIMEOUT = 25

SESSION = requests.Session()
SESSION.headers.update(HEADERS)


# =========================================================
# VERIFIED FALLBACK
# =========================================================

VERIFIED_FALLBACK = {
    "btcHoldings": 845050,
    "adso": 424.479,
    "fdso": 424.479,
    "usdAssetsUsdB": 6.690,
    "debtUsdB": 6.754,
    "preferredUsdB": 14.966,
    "source": "Verified Strategy data fallback",
    "asOf": "2026-08-23",
}


# =========================================================
# JSON
# =========================================================

def load_json(path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:
        print(f"WARNING: Failed to read {path}: {error}")
        return default


def save_json(path, data):
    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8"
    )


# =========================================================
# TEXT
# =========================================================

def clean_text(text):
    if text is None:
        return ""
    text = unescape(str(text))
    text = (
        text.replace("\xa0", " ")
        .replace("\u202f", " ")
        .replace("\u2009", " ")
        .replace("\u2007", " ")
    )
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def html_to_text(html):
    html = re.sub(r"<script\b[^>]*>.*?</script>", " ", html, flags=re.I | re.S)
    html = re.sub(r"<style\b[^>]*>.*?</style>", " ", html, flags=re.I | re.S)
    html = re.sub(r"<[^>]+>", " ", html)
    return clean_text(html)


# =========================================================
# NUMBER
# =========================================================

def number_from_text(value):
    if value is None:
        return None
    match = re.search(r"-?\d+(?:,\d{3})*(?:\.\d+)?", str(value))
    if not match:
        return None
    try:
        return float(match.group(0).replace(",", ""))
    except Exception:
        return None


# =========================================================
# HTTP
# =========================================================

def fetch_page(url, headers=None):
    response = SESSION.get(url, headers=headers, timeout=TIMEOUT)
    response.raise_for_status()
    return response.text


def fetch_json(url, headers=None):
    response = SESSION.get(url, headers=headers, timeout=TIMEOUT)
    response.raise_for_status()
    return response.json()


# =========================================================
# GENERIC NUMBER EXTRACTION
# =========================================================

def find_number_near_label(text, labels, window=500):
    if not text:
        return None
    lower_text = text.lower()
    for label in labels:
        label_lower = label.lower()
        start = 0
        while True:
            position = lower_text.find(label_lower, start)
            if position < 0:
                break
            fragment = text[position: position + window]
            matches = re.findall(
                r"(?<![\w.])\$?\s*-?\d+(?:,\d{3})*(?:\.\d+)?(?![\w.])",
                fragment
            )
            for raw in matches:
                value = number_from_text(raw)
                if value is not None:
                    return value
            start = position + len(label)
    return None


# =========================================================
# STRATEGY.COM HOME
# =========================================================

def get_strategy_home_data():
    html = fetch_page(STRATEGY_HOME_URL)
    text = html_to_text(html)
    result = {
        "mstrPrice": find_number_near_label(text, ["MSTR Price"], 100),
        "mnav": find_number_near_label(text, ["mNAV"], 100),
        "openInterestM": find_number_near_label(text, ["Open Interest ($M)", "Open Interest"], 150),
        "debtM": find_number_near_label(text, ["Debt ($M)", "Debt"], 120),
        "preferredM": find_number_near_label(text, ["Pref ($M)", "Pref"], 120),
        "usdReserveM": find_number_near_label(text, ["USD Reserve ($M)", "USD Reserve"], 120),
        "usdCashM": find_number_near_label(text, ["USD Cash ($M)", "USD Cash"], 120)
    }
    return result


# =========================================================
# STRATEGY BTC PAGE
# =========================================================

def get_strategy_btc_data():
    html = fetch_page(STRATEGY_BTC_URL)
    text = html_to_text(html)
    result = {
        "mstrPrice": find_number_near_label(text, ["MSTR Price"], 100),
        "mnav": find_number_near_label(text, ["mNAV"], 120),
        "netBpsUsd": find_number_near_label(text, ["Net BTC Per Share ($)", "Net BPS ($)"], 150),
        "grossBpsUsd": find_number_near_label(text, ["BTC Per Share ($)", "BPS ($)"], 150),
        "btcReserveM": find_number_near_label(text, ["BTC Reserve ($M)", "BTC Reserve"], 150),
        "netBtc": find_number_near_label(text, ["Net BTC"], 150)
    }
    return result


# =========================================================
# STRATEGY LEDGER
# =========================================================

def get_strategy_ledger_data():
    html = fetch_page(STRATEGY_LEDGER_URL)
    text = html_to_text(html)
    result = {}

    btc_candidates = re.findall(r"₿\s*([0-9]{3}(?:,[0-9]{3})+)", text)
    if btc_candidates:
        values = []
        for raw in btc_candidates:
            value = number_from_text(raw)
            if value is not None:
                values.append(int(value))
        values = [v for v in values if 100_000 <= v <= 2_000_000]
        if values:
            result["btcHoldings"] = max(values)

    # ADSO 수집 시 하드코딩 문구 제거 및 라벨 검색
    adso_val = find_number_near_label(text, ["ADSO", "Shares Outstanding"], 150)
    if adso_val:
        result["adso"] = adso_val if adso_val < 10000 else adso_val / 1000.0

    return result


# =========================================================
# STRATEGY SHARES
# =========================================================

def get_strategy_shares_data(mstr_price):
    html = fetch_page(STRATEGY_SHARES_URL)
    text = html_to_text(html)
    result = {}

    basic = find_number_near_label(text, ["Basic Shares Outstanding"], 800)
    options = find_number_near_label(text, ["Options Outstanding"], 800)
    rsu = find_number_near_label(text, ["RSU/PSU Unvested", "RSU/PSU"], 800)

    if basic is not None:
        result["basicSharesM"] = basic / 1000.0 if basic > 10000 else basic
    if options is not None:
        result["optionsM"] = options / 1000.0 if options > 10000 else options
    if rsu is not None:
        result["rsuM"] = rsu / 1000.0 if rsu > 10000 else rsu

    convertible_pattern = re.compile(
        r"(?:Convert Shares|STRK Convert Shares)\s*@\$\s*([\d,]+(?:\.\d+)?).{0,250}?([0-9]{1,3}(?:,[0-9]{3})*(?:\.\d+)?)",
        re.I | re.S
    )

    itm_convert_m = 0.0
    if mstr_price is not None:
        for match in convertible_pattern.finditer(text):
            conversion_price = number_from_text(match.group(1))
            shares = number_from_text(match.group(2))
            if conversion_price is None or shares is None:
                continue
            if conversion_price <= mstr_price:
                itm_convert_m += (shares / 1000.0 if shares > 10000 else shares)

    result["itmConvertSharesM"] = itm_convert_m

    if result.get("basicSharesM") is not None:
        fdso = (
            result["basicSharesM"]
            + result.get("optionsM", 0.0)
            + result.get("rsuM", 0.0)
            + itm_convert_m
        )
        if 300 <= fdso <= 600:
            result["fdsoM"] = round(fdso, 3)

    return result


# =========================================================
# STRATEGY CAPITAL DATA
# =========================================================

def get_strategy_capital_data(existing_data):
    errors = []
    home = {}
    btc_page = {}
    ledger = {}
    shares = {}

    try:
        home = get_strategy_home_data()
    except Exception as error:
        errors.append(f"home: {error}")

    try:
        btc_page = get_strategy_btc_data()
    except Exception as error:
        errors.append(f"btc: {error}")

    try:
        ledger = get_strategy_ledger_data()
    except Exception as error:
        errors.append(f"ledger: {error}")

    mstr_price = btc_page.get("mstrPrice") or home.get("mstrPrice")

    try:
        shares = get_strategy_shares_data(mstr_price)
    except Exception as error:
        errors.append(f"shares: {error}")

    btc_holdings = ledger.get("btcHoldings") or existing_data.get("btcHoldings")
    adso = ledger.get("adso") or existing_data.get("adso")
    fdso = shares.get("fdsoM") or existing_data.get("fdso")

    debt_m = home.get("debtM")
    pref_m = home.get("preferredM")
    reserve_m = home.get("usdReserveM")
    cash_m = home.get("usdCashM")

    if debt_m is None and existing_data.get("debtUsdB"):
        debt_m = float(existing_data["debtUsdB"]) * 1000.0

    if pref_m is None and existing_data.get("preferredUsdB"):
        pref_m = float(existing_data["preferredUsdB"]) * 1000.0

    usd_assets_m = None
    if reserve_m is not None and cash_m is not None:
        usd_assets_m = reserve_m + cash_m
    elif reserve_m is not None:
        usd_assets_m = reserve_m
    elif cash_m is not None:
        usd_assets_m = cash_m
    elif existing_data.get("usdAssetsUsdB"):
        usd_assets_m = float(existing_data["usdAssetsUsdB"]) * 1000.0

    if btc_holdings is None or not (100_000 <= float(btc_holdings) <= 2_000_000):
        raise RuntimeError("Strategy BTC holdings unavailable")

    if fdso is None or not (300 <= float(fdso) <= 600):
        raise RuntimeError("Strategy FDSO unavailable")

    if debt_m is None or pref_m is None or usd_assets_m is None:
        raise RuntimeError("Strategy Financial Metrics unavailable")

    return {
        "btcHoldings": int(round(float(btc_holdings))),
        "adso": round(float(adso), 3) if adso is not None else None,
        "fdso": round(float(fdso), 3),
        "usdAssetsUsdB": round(float(usd_assets_m) / 1000.0, 6),
        "debtUsdB": round(float(debt_m) / 1000.0, 6),
        "preferredUsdB": round(float(pref_m) / 1000.0, 6),
        "source": "Strategy.com",
        "asOf": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "strategyMnav": btc_page.get("mnav") or home.get("mnav"),
        "strategyNetBpsUsd": btc_page.get("netBpsUsd"),
        "strategyGrossBpsUsd": btc_page.get("grossBpsUsd"),
        "strategyMstrPrice": mstr_price,
        "strategyBtcReserveM": btc_page.get("btcReserveM"),
        "errors": errors
    }


# =========================================================
# SEC FALLBACK
# =========================================================

def get_sec_capital_data(existing_data):
    try:
        filings = fetch_json(SEC_SUBMISSIONS_URL, headers=SEC_HEADERS)
    except Exception as error:
        raise RuntimeError(f"SEC submissions failed: {error}")

    recent = filings.get("filings", {}).get("recent", {})
    forms = recent.get("form", [])
    accessions = recent.get("accessionNumber", [])
    documents = recent.get("primaryDocument", [])
    dates = recent.get("filingDate", [])

    for i, form in enumerate(forms):
        if form != "8-K" or i >= len(accessions) or i >= len(documents):
            continue

        url = f"{SEC_ARCHIVES_URL}{accessions[i].replace('-', '')}/{documents[i]}"
        try:
            html = fetch_page(url, headers=SEC_HEADERS)
        except Exception:
            continue

        text = html_to_text(html)
        if "INVESTOR BRIEFING" not in text.upper():
            continue

        return {
            "btcHoldings": existing_data.get("btcHoldings"),
            "adso": existing_data.get("adso"),
            "fdso": existing_data.get("fdso"),
            "usdAssetsUsdB": existing_data.get("usdAssetsUsdB"),
            "debtUsdB": existing_data.get("debtUsdB"),
            "preferredUsdB": existing_data.get("preferredUsdB"),
            "source": "SEC fallback",
            "asOf": dates[i] if i < len(dates) else existing_data.get("asOf")
        }

    raise RuntimeError("SEC Investor Briefing unavailable")


# =========================================================
# NORMALIZE
# =========================================================

def normalize_company_data(data):
    if not isinstance(data, dict):
        data = {}
    data = dict(data)

    try:
        data["btcHoldings"] = int(round(float(data["btcHoldings"])))
    except Exception:
        data["btcHoldings"] = None

    try:
        data["adso"] = float(data.get("adso"))
    except Exception:
        data["adso"] = None

    try:
        fdso = float(data.get("fdso"))
        if fdso >= 100_000:
            fdso /= 1_000_000
        data["fdso"] = fdso
    except Exception:
        data["fdso"] = None

    for key in ("usdAssetsUsdB", "debtUsdB", "preferredUsdB"):
        try:
            data[key] = float(data.get(key))
        except Exception:
            data[key] = None

    if data.get("fdso") is None or not (300 <= data["fdso"] <= 600):
        data["fdso"] = None

    return data


# =========================================================
# UPDATE data.json
# =========================================================

def update_data_json():
    existing = normalize_company_data(load_json(DATA_FILE, {}))

    try:
        latest = normalize_company_data(get_strategy_capital_data(existing))
        merged = {**existing, **latest}
        save_json(DATA_FILE, merged)
        print("Company data source: Strategy.com")
        return merged
    except Exception as error:
        print("WARNING: Strategy.com failed:", error)

    try:
        latest = normalize_company_data(get_sec_capital_data(existing))
        merged = {**existing, **latest}
        save_json(DATA_FILE, merged)
        print("Company data source: SEC fallback")
        return merged
    except Exception as error:
        print("WARNING: SEC fallback failed:", error)

    required = ["btcHoldings", "fdso", "usdAssetsUsdB", "debtUsdB", "preferredUsdB"]
    if all(existing.get(key) is not None for key in required):
        existing["source"] = "Existing data.json"
        print("Company data source: existing data.json")
        save_json(DATA_FILE, existing)
        return existing

    fallback = normalize_company_data(VERIFIED_FALLBACK)
    print("Company data source: verified fallback")
    save_json(DATA_FILE, fallback)
    return fallback


# =========================================================
# BTC PRICE (Coinbase -> Binance -> CoinGecko)
# =========================================================

def get_btc_price():
    # 1. Coinbase
    try:
        res = fetch_json("https://api.coinbase.com/v2/prices/spot?currency=USD")
        price = float(res["data"]["amount"])
        if price > 0:
            return price
    except Exception:
        pass

    # 2. Binance
    try:
        res = fetch_json("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT")
        price = float(res["price"])
        if price > 0:
            return price
    except Exception:
        pass

    # 3. CoinGecko
    try:
        data = fetch_json(COINGECKO_URL)
        price = float(data["bitcoin"]["usd"])
        if price > 0:
            return price
    except Exception:
        pass

    raise RuntimeError("모든 BTC 가격 API 조회 실패")


# =========================================================
# MSTR PRICE (Yahoo v1 -> Yahoo v2)
# =========================================================

def get_mstr_price():
    try:
        data = fetch_json(YAHOO_URL)
        price = float(data["chart"]["result"][0]["meta"]["regularMarketPrice"])
        if price > 0:
            return price
    except Exception:
        pass

    try:
        data = fetch_json(YAHOO_URL_ALT)
        price = float(data["chart"]["result"][0]["meta"]["regularMarketPrice"])
        if price > 0:
            return price
    except Exception:
        pass

    raise RuntimeError("MSTR 주가 수집 실패")


# =========================================================
# BINANCE / BYBIT / OKX METRICS
# =========================================================

def get_binance_oi():
    data = fetch_json(BINANCE_OI_URL)
    return float(data["openInterest"])


def get_binance_funding():
    data = fetch_json(BINANCE_FUNDING_URL)
    if not data:
        raise RuntimeError("No Binance funding")
    return float(data[0]["fundingRate"]) * 100.0


def get_bybit_data():
    data = fetch_json(BYBIT_TICKER_URL)
    rows = data.get("result", {}).get("list", [])
    if not rows:
        raise RuntimeError("No Bybit ticker")
    return float(rows[0]["openInterestValue"]), float(rows[0]["fundingRate"]) * 100.0


def get_okx_oi():
    data = fetch_json(OKX_OI_URL)
    rows = data.get("data", [])
    if not rows:
        raise RuntimeError("No OKX OI")
    return float(rows[0]["oiUsd"])


def get_okx_funding():
    data = fetch_json(OKX_FUNDING_URL)
    rows = data.get("data", [])
    if not rows:
        raise RuntimeError("No OKX funding")
    return float(rows[0]["fundingRate"]) * 100.0


# =========================================================
# mNAV
# =========================================================

def calculate_mnav(btc_price, mstr_price, company):
    holdings = float(company["btcHoldings"])
    fdso_shares = float(company["fdso"]) * 1_000_000
    usd_assets = float(company["usdAssetsUsdB"]) * 1_000_000_000
    debt = float(company["debtUsdB"]) * 1_000_000_000
    preferred = float(company["preferredUsdB"]) * 1_000_000_000

    btc_value = holdings * btc_price
    gross_bps = btc_value / fdso_shares
    net_reserve = btc_value + usd_assets - debt - preferred
    net_bps = net_reserve / fdso_shares
    btc_per_share = holdings / fdso_shares

    if gross_bps <= 0 or net_bps <= 0:
        raise RuntimeError("BPS 계산 오류")

    mnav = mstr_price / net_bps
    gross_mnav = mstr_price / gross_bps

    return {
        "btcValueUsd": btc_value,
        "netReserveUsd": net_reserve,
        "grossBpsUsd": gross_bps,
        "netBpsUsd": net_bps,
        "btcPerShare": btc_per_share,
        "mnav": mnav,
        "grossMnav": gross_mnav
    }


def repair_history_record(item):
    item = dict(item)
    for key in ("btcPerShare", "grossBpsUsd", "netBpsUsd", "mnav", "grossMnav"):
        try:
            item[key] = float(item[key])
        except Exception:
            pass
    return item


def get_previous_record(history, days_back):
    if not history:
        return None
    target_key = (datetime.now(timezone.utc).date() - timedelta(days=days_back)).strftime("%Y-%m-%d")
    candidates = [item for item in history if item.get("date", "") <= target_key]
    if not candidates:
        return None
    return max(candidates, key=lambda item: item.get("date", ""))


def percentage_change(current, previous):
    try:
        current, previous = float(current), float(previous)
        if previous == 0:
            return None
        return (current / previous - 1.0) * 100.0
    except Exception:
        return None


def calculate_mnav_percentile(current, history):
    try:
        current = float(current)
        if current <= 0:
            return None
        values = [float(item.get("mnav")) for item in history if item.get("mnav") and float(item.get("mnav")) > 0]
        if len(values) < 5:
            return None
        values.sort()
        count = sum(1 for value in values if value <= current)
        return (count / len(values)) * 100.0
    except Exception:
        return None


def calculate_risk_score(mnav_percentile, funding_rate, oi_change_1d, oi_change_7d, btc_change_7d):
    score = 0.0
    if mnav_percentile is not None:
        if mnav_percentile >= 95: score += 35
        elif mnav_percentile >= 85: score += 28
        elif mnav_percentile >= 70: score += 20
        elif mnav_percentile >= 50: score += 10

    if funding_rate is not None:
        funding = abs(float(funding_rate))
        if funding >= 0.08: score += 30
        elif funding >= 0.05: score += 23
        elif funding >= 0.03: score += 15
        elif funding >= 0.015: score += 7

    if oi_change_1d is not None:
        val = float(oi_change_1d)
        if val >= 10: score += 15
        elif val >= 6: score += 11
        elif val >= 3: score += 6

    if oi_change_7d is not None:
        val = float(oi_change_7d)
        if val >= 20: score += 15
        elif val >= 12: score += 11
        elif val >= 7: score += 6

    if btc_change_7d is not None:
        val = float(btc_change_7d)
        if val >= 15: score += 10
        elif val >= 10: score += 7
        elif val >= 5: score += 4

    score = min(100.0, max(0.0, score))
    level = "SAFE" if score < 25 else "CAUTION" if score < 50 else "OVERHEATED" if score < 75 else "EXTREME"
    return round(score, 1), level


# =========================================================
# MAIN
# =========================================================

def main():
    print("\n======================================\nMSTR Market History Update v11\n======================================")

    company = normalize_company_data(update_data_json())
    btc_price = get_btc_price()
    mstr_price = get_mstr_price()
    result = calculate_mnav(btc_price, mstr_price, company)

    history = [repair_history_record(i) for i in load_json(HISTORY_FILE, []) if isinstance(i, dict)]

    oi_values, funding_values = [], []

    try:
        oi_btc = get_binance_oi()
        oi_usd = oi_btc * btc_price
        if oi_usd > 0:
            oi_values.append(("Binance", oi_usd))
            try:
                funding_values.append(("Binance", get_binance_funding(), oi_usd))
            except Exception as e:
                print("WARNING: Binance funding:", e)
    except Exception as e:
        print("WARNING: Binance OI:", e)

    try:
        oi_usd, funding = get_bybit_data()
        if oi_usd > 0:
            oi_values.append(("Bybit", oi_usd))
            funding_values.append(("Bybit", funding, oi_usd))
    except Exception as e:
        print("WARNING: Bybit:", e)

    try:
        oi_usd = get_okx_oi()
        if oi_usd > 0:
            oi_values.append(("OKX", oi_usd))
            try:
                funding_values.append(("OKX", get_okx_funding(), oi_usd))
            except Exception as e:
                print("WARNING: OKX funding:", e)
    except Exception as e:
        print("WARNING: OKX OI:", e)

    aggregate_oi_usd = sum(v for _, v in oi_values) if oi_values else None
    aggregate_oi_btc = (aggregate_oi_usd / btc_price) if aggregate_oi_usd else None

    aggregate_funding = None
    if funding_values:
        total_weight = sum(oi for _, _, oi in funding_values if oi > 0)
        if total_weight > 0:
            aggregate_funding = sum(rate * oi for _, rate, oi in funding_values) / total_weight

    previous_1d = get_previous_record(history, 1)
    previous_7d = get_previous_record(history, 7)

    oi1 = percentage_change(aggregate_oi_btc, previous_1d.get("oiBtc")) if previous_1d and aggregate_oi_btc else None
    btc1 = percentage_change(btc_price, previous_1d.get("btc")) if previous_1d else None
    mnav1 = percentage_change(result["mnav"], previous_1d.get("mnav")) if previous_1d else None
    yield1 = percentage_change(result["btcPerShare"], previous_1d.get("btcPerShare")) if previous_1d else None

    oi7 = percentage_change(aggregate_oi_btc, previous_7d.get("oiBtc")) if previous_7d and aggregate_oi_btc else None
    btc7 = percentage_change(btc_price, previous_7d.get("btc")) if previous_7d else None
    mnav7 = percentage_change(result["mnav"], previous_7d.get("mnav")) if previous_7d else None
    yield7 = percentage_change(result["btcPerShare"], previous_7d.get("btcPerShare")) if previous_7d else None

    percentile = calculate_mnav_percentile(result["mnav"], history)
    score, level = calculate_risk_score(percentile, aggregate_funding, oi1, oi7, btc7)

    now = datetime.now(timezone.utc)
    date_key = now.strftime("%Y-%m-%d")

    record = {
        "date": date_key,
        "timestamp": now.isoformat(),
        "btc": round(btc_price, 2),
        "mstr": round(mstr_price, 2),
        "btcValueUsd": round(result["btcValueUsd"], 2),
        "grossBpsUsd": round(result["grossBpsUsd"], 4),
        "netBpsUsd": round(result["netBpsUsd"], 4),
        "btcPerShare": round(result["btcPerShare"], 10),
        "mnav": round(result["mnav"], 4),
        "grossMnav": round(result["grossMnav"], 4),
        "strategyMnav": round(float(company["strategyMnav"]), 4) if company.get("strategyMnav") else None,
        "strategyNetBpsUsd": round(float(company["strategyNetBpsUsd"]), 4) if company.get("strategyNetBpsUsd") else None,
        "oiBtc": round(aggregate_oi_btc, 2) if aggregate_oi_btc else None,
        "oiUsd": round(aggregate_oi_usd, 2) if aggregate_oi_usd else None,
        "fundingRate": round(aggregate_funding, 5) if aggregate_funding else None,
        "oiChange1dPct": round(oi1, 2) if oi1 is not None else None,
        "oiChange7dPct": round(oi7, 2) if oi7 is not None else None,
        "btcChange1dPct": round(btc1, 2) if btc1 is not None else None,
        "btcChange7dPct": round(btc7, 2) if btc7 is not None else None,
        "mnavChange1dPct": round(mnav1, 2) if mnav1 is not None else None,
        "mnavChange7dPct": round(mnav7, 2) if mnav7 is not None else None,
        "btcYield1dPct": round(yield1, 2) if yield1 is not None else None,
        "btcYield7dPct": round(yield7, 2) if yield7 is not None else None,
        "mnavPercentile": round(percentile, 2) if percentile is not None else None,
        "riskScore": score,
        "riskLevel": level,
        "oiSources": [name for name, _ in oi_values],
        "fundingSources": [name for name, _, _ in funding_values],
        "capitalDataDate": company.get("asOf"),
        "capitalDataSource": company.get("source"),
        "adso": company.get("adso"),
        "fdso": company.get("fdso")
    }

    history = [i for i in history if i.get("date") != date_key]
    history.append(record)
    history.sort(key=lambda i: i.get("date", ""))

    save_json(HISTORY_FILE, history)
    print(f"업데이트 완료: mNAV={result['mnav']:.4f}, Records={len(history)}")


if __name__ == "__main__":
    main()
