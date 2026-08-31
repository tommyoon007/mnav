import json
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from html import unescape

import requests


# =========================================================
# PATHS & CONFIGS
# =========================================================

DATA_FILE = Path("data.json")
HISTORY_FILE = Path("history.json")

STRATEGY_HOME_URL = "https://www.strategy.com/"
STRATEGY_BTC_URL = "https://www.strategy.com/btc"
STRATEGY_LEDGER_URL = "https://www.strategy.com/ledger"
STRATEGY_SHARES_URL = "https://www.strategy.com/shares"

SEC_XBRL_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK0001050446.json"

YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/MSTR?range=1d&interval=1d"
YAHOO_URL_ALT = "https://query2.finance.yahoo.com/v8/finance/chart/MSTR?range=1d&interval=1d"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
}

SEC_HEADERS = {
    "User-Agent": "MNAV-Dashboard/11.0 (contact@mnav.app)",
    "Accept": "application/json",
}

TIMEOUT = 25
SESSION = requests.Session()
SESSION.headers.update(HEADERS)


# =========================================================
# UTILS
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


def clean_text(text):
    if text is None:
        return ""
    text = unescape(str(text))
    text = text.replace("\xa0", " ").replace("\u202f", " ").replace("\u2009", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def html_to_text(html):
    html = re.sub(r"<script\b[^>]*>.*?</script>", " ", html, flags=re.I | re.S)
    html = re.sub(r"<style\b[^>]*>.*?</style>", " ", html, flags=re.I | re.S)
    html = re.sub(r"<[^>]+>", " ", html)
    return clean_text(html)


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


def fetch_page(url, headers=None):
    res = SESSION.get(url, headers=headers, timeout=TIMEOUT)
    res.raise_for_status()
    return res.text


def fetch_json(url, headers=None):
    res = SESSION.get(url, headers=headers, timeout=TIMEOUT)
    res.raise_for_status()
    return res.json()


def find_number_near_label(text, labels, window=500):
    if not text:
        return None
    lower_text = text.lower()
    for label in labels:
        label_lower = label.lower()
        start = 0
        while True:
            pos = lower_text.find(label_lower, start)
            if pos < 0:
                break
            fragment = text[pos: pos + window]
            matches = re.findall(r"(?<![\w.])\$?\s*-?\d+(?:,\d{3})*(?:\.\d+)?(?![\w.])", fragment)
            for raw in matches:
                val = number_from_text(raw)
                if val is not None:
                    return val
            start = pos + len(label)
    return None


# =========================================================
# CAPITAL DATA (STRATEGY.COM & SEC FALLBACK)
# =========================================================

def get_strategy_data():
    ledger_html = fetch_page(STRATEGY_LEDGER_URL)
    ledger_text = html_to_text(ledger_html)
    
    btc_candidates = re.findall(r"₿\s*([0-9]{3}(?:,[0-9]{3})+)", ledger_text)
    btc_holdings = None
    if btc_candidates:
        vals = [int(number_from_text(v)) for v in btc_candidates if number_from_text(v)]
        vals = [v for v in vals if 100_000 <= v <= 2_000_000]
        if vals:
            btc_holdings = max(vals)

    adso_val = find_number_near_label(ledger_text, ["ADSO", "Shares Outstanding"], 150)
    if adso_val and adso_val > 10000:
        adso_val = adso_val / 1000.0

    shares_html = fetch_page(STRATEGY_SHARES_URL)
    shares_text = html_to_text(shares_html)
    
    basic = find_number_near_label(shares_text, ["Basic Shares Outstanding"], 800)
    options = find_number_near_label(shares_text, ["Options Outstanding"], 800)
    rsu = find_number_near_label(shares_text, ["RSU/PSU Unvested", "RSU/PSU"], 800)
    
    fdso_val = None
    if basic is not None:
        basic_m = basic / 1000.0 if basic > 10000 else basic
        opts_m = (options / 1000.0) if options and options > 10000 else (options or 0)
        rsu_m = (rsu / 1000.0) if rsu and rsu > 10000 else (rsu or 0)
        fdso_calc = basic_m + opts_m + rsu_m
        if 300 <= fdso_calc <= 600:
            fdso_val = round(fdso_calc, 3)

    home_text = html_to_text(fetch_page(STRATEGY_HOME_URL))
    debt_m = find_number_near_label(home_text, ["Debt ($M)", "Debt"], 120)
    pref_m = find_number_near_label(home_text, ["Pref ($M)", "Pref"], 120)
    reserve_m = find_number_near_label(home_text, ["USD Reserve ($M)", "USD Reserve"], 120)

    if not btc_holdings or not fdso_val:
        raise RuntimeError("Strategy.com parsing incomplete")

    return {
        "btcHoldings": btc_holdings,
        "adso": adso_val,
        "fdso": fdso_val,
        "usdAssetsUsdB": round(reserve_m / 1000.0, 6) if reserve_m else 6.690,
        "debtUsdB": round(debt_m / 1000.0, 6) if debt_m else 6.754,
        "preferredUsdB": round(pref_m / 1000.0, 6) if pref_m else 14.966,
        "source": "Strategy.com",
        "asOf": datetime.now(timezone.utc).strftime("%Y-%m-%d")
    }


def get_sec_xbrl_fallback(existing):
    try:
        facts = fetch_json(SEC_XBRL_URL, headers=SEC_HEADERS)
        us_gaap = facts.get("facts", {}).get("us-gaap", {})

        # Basic Shares (ADSO)
        shares_units = us_gaap.get("CommonStockSharesOutstanding", {}).get("units", {}).get("shares", [])
        adso_val = None
        if shares_units:
            latest = max(shares_units, key=lambda x: x.get("filed", ""))
            raw_val = latest.get("val")
            if raw_val:
                adso_val = round(raw_val / 1_000_000, 3) if raw_val > 10000 else round(raw_val, 3)

        # Diluted Shares (FDSO)
        diluted_units = us_gaap.get("WeightedAverageNumberOfDilutedSharesOutstanding", {}).get("units", {}).get("shares", [])
        fdso_val = None
        if diluted_units:
            latest_d = max(diluted_units, key=lambda x: x.get("filed", ""))
            raw_d = latest_d.get("val")
            if raw_d:
                fdso_val = round(raw_d / 1_000_000, 3) if raw_d > 10000 else round(raw_d, 3)

        return {
            "btcHoldings": existing.get("btcHoldings") or 845050,
            "adso": adso_val or existing.get("adso") or 424.479,
            "fdso": fdso_val or existing.get("fdso") or 424.479,
            "usdAssetsUsdB": existing.get("usdAssetsUsdB") or 6.690,
            "debtUsdB": existing.get("debtUsdB") or 6.754,
            "preferredUsdB": existing.get("preferredUsdB") or 14.966,
            "source": "SEC XBRL API Fallback",
            "asOf": datetime.now(timezone.utc).strftime("%Y-%m-%d")
        }
    except Exception as e:
        print(f"WARNING: SEC XBRL Fallback failed: {e}")
        return existing


def update_company_data():
    existing = load_json(DATA_FILE, {})
    try:
        data = get_strategy_data()
        save_json(DATA_FILE, data)
        return data
    except Exception as e:
        print(f"WARNING: Strategy.com failed: {e}")

    sec_data = get_sec_xbrl_fallback(existing)
    save_json(DATA_FILE, sec_data)
    return sec_data


# =========================================================
# MARKET PRICES
# =========================================================

def get_btc_price():
    endpoints = [
        "https://api.coinbase.com/v2/prices/spot?currency=USD",
        "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
        "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
    ]
    for url in endpoints:
        try:
            res = fetch_json(url)
            if "data" in res:
                return float(res["data"]["amount"])
            if "price" in res:
                return float(res["price"])
            if "bitcoin" in res:
                return float(res["bitcoin"]["usd"])
        except Exception:
            continue
    raise RuntimeError("Failed to fetch BTC price")


def get_mstr_price():
    for url in [YAHOO_URL, YAHOO_URL_ALT]:
        try:
            data = fetch_json(url)
            return float(data["chart"]["result"][0]["meta"]["regularMarketPrice"])
        except Exception:
            continue
    raise RuntimeError("Failed to fetch MSTR price")


# =========================================================
# MAIN EXECUTION
# =========================================================

def main():
    print("Running MSTR Market History Update...")
    company = update_company_data()
    
    btc = get_btc_price()
    mstr = get_mstr_price()

    holdings = float(company["btcHoldings"])
    fdso_shares = float(company["fdso"]) * 1_000_000
    usd_assets = float(company["usdAssetsUsdB"]) * 1_000_000_000
    debt = float(company["debtUsdB"]) * 1_000_000_000
    preferred = float(company["preferredUsdB"]) * 1_000_000_000

    btc_val = holdings * btc
    gross_bps = btc_val / fdso_shares
    net_reserve = btc_val + usd_assets - debt - preferred
    net_bps = net_reserve / fdso_shares
    btc_per_share = holdings / fdso_shares
    mnav = mstr / net_bps

    now = datetime.now(timezone.utc)
    date_key = now.strftime("%Y-%m-%d")

    history = load_json(HISTORY_FILE, [])
    history = [i for i in history if isinstance(i, dict) and i.get("date") != date_key]

    record = {
        "date": date_key,
        "timestamp": now.isoformat(),
        "btc": round(btc, 2),
        "mstr": round(mstr, 2),
        "btcValueUsd": round(btc_val, 2),
        "grossBpsUsd": round(gross_bps, 4),
        "netBpsUsd": round(net_bps, 4),
        "btcPerShare": round(btc_per_share, 10),
        "mnav": round(mnav, 4),
        "adso": company.get("adso"),
        "fdso": company.get("fdso"),
        "capitalDataSource": company.get("source"),
        "capitalDataDate": company.get("asOf")
    }

    history.append(record)
    history.sort(key=lambda x: x.get("date", ""))
    save_json(HISTORY_FILE, history)
    print(f"Successfully updated history.json for {date_key} (mNAV: {mnav:.4f}, ADSO: {company.get('adso')}, FDSO: {company.get('fdso')})")


if __name__ == "__main__":
    main()
