import json
import re
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup

DATA_FILE = "data.json"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) "
        "AppleWebKit/537.36 Chrome/131 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

TIMEOUT = 30


def get_page(url):
    r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    return r.text


def number_from_text(text):
    if text is None:
        return None

    text = text.replace(",", "").replace("$", "").strip()

    m = re.search(r"-?\d+(?:\.\d+)?", text)
    if not m:
        return None

    return float(m.group())


def find_value(text, label):
    """
    Strategy 페이지의 'label ... value' 형태에서 숫자를 찾는다.
    """
    pattern = rf"{re.escape(label)}\s*([₿$()]?\s*[\d,]+(?:\.\d+)?)"
    m = re.search(pattern, text, re.IGNORECASE)

    if not m:
        return None

    value = m.group(1).replace(",", "").replace("$", "").strip()

    if value.startswith("(") and value.endswith(")"):
        value = "-" + value[1:-1]

    return number_from_text(value)


def get_strategy_btc_data():
    html = get_page("https://www.strategy.com/btc")
    soup = BeautifulSoup(html, "html.parser")

    text = soup.get_text(" ", strip=True)

    result = {}

    # Strategy BTC dashboard
    result["btcHoldings"] = find_value(text, "Net BTC")
    result["usdReserve"] = find_value(text, "BTC Reserve")

    # 페이지의 명시적인 BTC Reserve가 USD Reserve가 아닐 수 있으므로
    # USD Reserve는 shares 페이지/공시에서 별도로 확인한다.
    return result


def get_strategy_shares():
    html = get_page("https://www.strategy.com/shares")
    soup = BeautifulSoup(html, "html.parser")

    text = soup.get_text(" ", strip=True)

    result = {}

    # 현재 Strategy 페이지의 Total BTC
    m = re.search(
        r"Total BTC\s+.*?(\d{1,3}(?:,\d{3})+)",
        text,
        re.IGNORECASE,
    )

    if m:
        result["btcHoldings"] = float(m.group(1).replace(",", ""))

    # ADSO / FDSO 행
    m = re.search(
        r"ADSO.*?FDSO.*?"
        r"(\d{1,3}(?:,\d{3})+)\s*$",
        text,
        re.IGNORECASE,
    )

    # 현재 페이지 구조가 바뀔 수 있으므로
    # 명확한 427,308 패턴도 보조적으로 탐색
    if not m:
        m = re.search(r"\b(\d{3},\d{3})\b", text)

    # ADSO는 Strategy가 페이지에서 직접 제공하는 값 우선
    adso_candidates = re.findall(r"\b\d{3},\d{3}\b", text)

    # 현재 공식 페이지의 마지막 ADSO 값은 427,308
    if adso_candidates:
        result["assumedShares"] = (
            float(adso_candidates[-1].replace(",", "")) / 1000
        )

    return result


def get_strategy_ledger():
    """
    Bitcoin Ledger에서 가장 최근 BTC/ADSO 데이터를 가져온다.
    """
    html = get_page("https://www.strategy.com/ledger")
    soup = BeautifulSoup(html, "html.parser")

    text = soup.get_text(" ", strip=True)

    result = {}

    # 최신 BTC 보유량
    m = re.search(
        r"₿\s*([0-9]{3}(?:,[0-9]{3})*)",
        text
    )

    if m:
        result["btcHoldings"] = float(m.group(1).replace(",", ""))

    # 최신 ADSO
    m = re.search(
        r"([0-9]{3},[0-9]{3})\s+\(",
        text
    )

    if m:
        result["assumedShares"] = (
            float(m.group(1).replace(",", "")) / 1000
        )

    return result


def get_fallback_data():
    """
    외부 데이터 파싱에 실패했을 때 기존 data.json 값을 보존한다.
    잘못된 0을 넣는 것보다 훨씬 안전하다.
    """
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {
            "updatedAt": None,
            "source": "Strategy",
            "btcHoldings": 0,
            "assumedShares": 0,
            "fullyDilutedShares": 0,
            "otmDebt": 0,
            "preferred": 0,
            "usdReserve": 0,
        }


def main():
    data = get_fallback_data()

    # ---------------------------------------------------------
    # 1. Strategy Shares
    # ---------------------------------------------------------
    try:
        shares = get_strategy_shares()

        if shares.get("btcHoldings"):
            data["btcHoldings"] = shares["btcHoldings"]

        if shares.get("assumedShares"):
            data["assumedShares"] = shares["assumedShares"]

    except Exception as e:
        print("Shares page failed:", e)

    # ---------------------------------------------------------
    # 2. Strategy Ledger
    # ---------------------------------------------------------
    try:
        ledger = get_strategy_ledger()

        if ledger.get("btcHoldings"):
            data["btcHoldings"] = ledger["btcHoldings"]

        if ledger.get("assumedShares"):
            data["assumedShares"] = ledger["assumedShares"]

    except Exception as e:
        print("Ledger failed:", e)

    # ---------------------------------------------------------
    # 3. Strategy BTC dashboard
    # ---------------------------------------------------------
    try:
        btc = get_strategy_btc_data()

        if btc.get("btcHoldings"):
            data["btcHoldings"] = btc["btcHoldings"]

    except Exception as e:
        print("BTC dashboard failed:", e)

    # ---------------------------------------------------------
    # IMPORTANT
    #
    # FDSO / OTM Debt / Preferred / USD Reserve는
    # 현재 이 스크립트에서 임의로 0으로 덮어쓰지 않는다.
    #
    # 공식 데이터가 확실하게 파싱되지 않으면 기존 값을 유지한다.
    # ---------------------------------------------------------

    data["source"] = "Strategy"
    data["updatedAt"] = datetime.now(timezone.utc).isoformat()

    # 숫자 검증
    required = [
        "btcHoldings",
        "assumedShares",
    ]

    for key in required:
        if not isinstance(data.get(key), (int, float)) or data[key] <= 0:
            raise RuntimeError(
                f"Invalid Strategy data: {key}={data.get(key)}"
            )

    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print("===================================")
    print("MSTR mNAV data updated")
    print("BTC Holdings :", data["btcHoldings"])
    print("ADSO         :", data["assumedShares"])
    print("FDSO         :", data["fullyDilutedShares"])
    print("OTM Debt     :", data["otmDebt"])
    print("Preferred    :", data["preferred"])
    print("USD Reserve  :", data["usdReserve"])
    print("Updated      :", data["updatedAt"])
    print("===================================")


if __name__ == "__main__":
    main()
