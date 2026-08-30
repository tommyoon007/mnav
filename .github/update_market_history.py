import json
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests


# =========================================================
# FILES
# =========================================================

DATA_FILE = Path("data.json")
HISTORY_FILE = Path("history.json")


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
# COMMON
# =========================================================

HEADERS = {
    "User-Agent":
        "tommyoon007-mnav-history/8.0 "
        "(investment dashboard)",
    "Accept":
        "application/json,text/html"
}

TIMEOUT = 20


# =========================================================
# JSON
# =========================================================

def load_json(path, default):

    if not path.exists():
        return default

    try:

        return json.loads(
            path.read_text(
                encoding="utf-8"
            )
        )

    except Exception as error:

        print(
            f"WARNING: Failed to read "
            f"{path}: {error}"
        )

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


# =========================================================
# HTTP
# =========================================================

def get_response(
    url,
    headers=None
):

    response = requests.get(
        url,
        headers=headers or HEADERS,
        timeout=TIMEOUT
    )

    response.raise_for_status()

    return response


def get_json(url):

    return get_response(url).json()


# =========================================================
# SEC HELPERS
# =========================================================

def sec_get_text(url):

    response = requests.get(
        url,
        headers={
            "User-Agent":
                "tommyoon007-mnav-history/8.0 "
                "(investment dashboard)"
        },
        timeout=TIMEOUT
    )

    response.raise_for_status()

    return response.text


def normalize_number(text):

    if text is None:
        return None

    text = (
        str(text)
        .replace(",", "")
        .replace("$", "")
        .replace(" ", "")
        .strip()
    )

    try:

        return float(text)

    except Exception:

        return None


def find_number(
    patterns,
    text
):

    for pattern in patterns:

        match = re.search(
            pattern,
            text,
            re.IGNORECASE |
            re.DOTALL
        )

        if not match:
            continue

        value = normalize_number(
            match.group(1)
        )

        if value is not None:
            return value

    return None


# =========================================================
# SEC RECENT 8-K
# =========================================================

def get_latest_8k_filings():

    data = get_json(
        SEC_SUBMISSIONS_URL
    )

    recent = (
        data
        .get("filings", {})
        .get("recent", {})
    )

    forms = recent.get(
        "form",
        []
    )

    accession_numbers = recent.get(
        "accessionNumber",
        []
    )

    primary_documents = recent.get(
        "primaryDocument",
        []
    )

    filing_dates = recent.get(
        "filingDate",
        []
    )

    results = []

    for i, form in enumerate(forms):

        if form != "8-K":
            continue

        if i >= len(accession_numbers):
            continue

        accession = (
            accession_numbers[i]
        )

        document = (
            primary_documents[i]
            if i < len(primary_documents)
            else None
        )

        filing_date = (
            filing_dates[i]
            if i < len(filing_dates)
            else None
        )

        if not document:
            continue

        results.append({
            "accession": accession,
            "document": document,
            "filingDate": filing_date
        })

    return results


# =========================================================
# SEC DOCUMENT
# =========================================================

def get_8k_document(
    accession,
    document
):

    accession_clean = (
        accession.replace(
            "-",
            ""
        )
    )

    return sec_get_text(
        SEC_ARCHIVES_URL
        +
        accession_clean
        +
        "/"
        +
        document
    )


# =========================================================
# FIND INVESTOR BRIEFING
# =========================================================

def find_investor_briefing():

    filings = (
        get_latest_8k_filings()
    )

    for filing in filings[:15]:

        try:

            html = get_8k_document(
                filing["accession"],
                filing["document"]
            )

        except Exception as error:

            print(
                "WARNING: SEC filing failed:",
                error
            )

            continue


        # -------------------------------------------------
        # Primary document
        # -------------------------------------------------

        if (
            "MSTR INVESTOR BRIEFING"
            in html.upper()
        ):

            return (
                html,
                filing
            )


        # -------------------------------------------------
        # Exhibits
        # -------------------------------------------------

        links = re.findall(
            r'href=["\']([^"\']+\.htm[^"\']*)',
            html,
            re.IGNORECASE
        )

        for link in links:

            link = link.split("#")[0]

            if (
                link.startswith(
                    "http://"
                )
                or
                link.startswith(
                    "https://"
                )
            ):

                url = link

            else:

                url = (
                    SEC_ARCHIVES_URL
                    +
                    filing["accession"]
                    .replace("-", "")
                    +
                    "/"
                    +
                    link.lstrip("/")
                )

            try:

                exhibit = sec_get_text(
                    url
                )

            except Exception:

                continue

            if (
                "MSTR INVESTOR BRIEFING"
                in exhibit.upper()
            ):

                return (
                    exhibit,
                    filing
                )


    return None, None


# =========================================================
# STRATEGY CAPITAL DATA
# =========================================================

def get_strategy_capital_data():

    html, filing = (
        find_investor_briefing()
    )

    if not html:

        raise RuntimeError(
            "Latest Strategy Investor "
            "Briefing could not be found"
        )


    text = re.sub(
        r"<[^>]+>",
        " ",
        html
    )

    text = (
        text
        .replace(
            "&nbsp;",
            " "
        )
        .replace(
            "&#160;",
            " "
        )
    )

    text = re.sub(
        r"\s+",
        " ",
        text
    )


    # -----------------------------------------------------
    # BTC HOLDINGS
    # -----------------------------------------------------

    btc_holdings = find_number(
        [

            r"BTC holdings.*?"
            r"([0-9]{3,3}(?:,[0-9]{3})+)"
            r"\s*BTC",

            r"Aggregate BTC Holdings.*?"
            r"([0-9]{3,3}(?:,[0-9]{3})+)",

            r"([0-9]{3,3}(?:,[0-9]{3})+)"
            r"\s*BTC"
        ],
        text
    )


    # -----------------------------------------------------
    # USD RESERVE
    # -----------------------------------------------------

    usd_reserve = find_number(
        [

            r"USD Reserve.*?"
            r"\$?\s*([0-9]+(?:\.[0-9]+)?)"
            r"\s*B",

            r"USD Reserve.*?"
            r"([0-9]+\.[0-9]+)"
            r"\s*billion"
        ],
        text
    )


    # -----------------------------------------------------
    # USD CASH
    # -----------------------------------------------------

    usd_cash = find_number(
        [

            r"USD Cash.*?"
            r"\$?\s*([0-9]+(?:\.[0-9]+)?)"
            r"\s*B",

            r"USD Cash.*?"
            r"([0-9]+\.[0-9]+)"
            r"\s*billion"
        ],
        text
    )


    # -----------------------------------------------------
    # USD ASSETS
    # -----------------------------------------------------

    usd_assets = find_number(
        [

            r"USD Assets.*?"
            r"\$?\s*([0-9]+(?:\.[0-9]+)?)"
            r"\s*B",

            r"USD Assets.*?"
            r"([0-9]+\.[0-9]+)"
            r"\s*billion"
        ],
        text
    )


    # -----------------------------------------------------
    # DEBT
    # -----------------------------------------------------

    debt = find_number(
        [

            r"Debt.*?"
            r"\$?\s*([0-9]+(?:\.[0-9]+)?)"
            r"\s*B"
            r".{0,100}"
            r"notional",

            r"Debt.*?"
            r"\$?\s*([0-9]+\.[0-9]+)"
            r"\s*billion"
        ],
        text
    )


    # -----------------------------------------------------
    # PREFERRED
    # -----------------------------------------------------

    preferred = find_number(
        [

            r"Preferred stock.*?"
            r"\$?\s*([0-9]+(?:\.[0-9]+)?)"
            r"\s*B"
            r".{0,100}"
            r"notional",

            r"Preferred stock.*?"
            r"\$?\s*([0-9]+\.[0-9]+)"
            r"\s*billion"
        ],
        text
    )


    # -----------------------------------------------------
    # FDSO
    # -----------------------------------------------------

    fdso = find_number(
        [

            r"([0-9]+\.[0-9]+)M"
            r"\s*FDSO",

            r"([0-9]+\.[0-9]+)\s*M"
            r"\s*FDSO",

            r"([0-9]+\.[0-9]+)M"
            r"\s*fully diluted shares"
        ],
        text
    )


    # -----------------------------------------------------
    # VALIDATION
    # -----------------------------------------------------

    if btc_holdings is None:

        raise RuntimeError(
            "SEC parser could not find BTC holdings"
        )

    if debt is None:

        raise RuntimeError(
            "SEC parser could not find debt"
        )

    if preferred is None:

        raise RuntimeError(
            "SEC parser could not find preferred stock"
        )

    if fdso is None:

        raise RuntimeError(
            "SEC parser could not find FDSO"
        )


    # -----------------------------------------------------
    # USD ASSET FALLBACK
    # -----------------------------------------------------

    if usd_assets is None:

        if (
            usd_reserve is not None
            and
            usd_cash is not None
        ):

            usd_assets = (
                usd_reserve
                +
                usd_cash
            )


    if usd_assets is None:

        raise RuntimeError(
            "SEC parser could not find USD Assets"
        )


    return {

        "btcHoldings":
            int(
                round(
                    btc_holdings
                )
            ),

        "usdAssetsUsdB":
            round(
                usd_assets,
                3
            ),

        "debtUsdB":
            round(
                debt,
                3
            ),

        "preferredUsdB":
            round(
                preferred,
                3
            ),

        "fdso":
            round(
                fdso * 1_000_000,
                0
            ),

        "source":
            "Strategy Investor Briefing / SEC Form 8-K",

        "asOf":
            filing["filingDate"]
            if filing
            else None
    }


# =========================================================
# UPDATE DATA.JSON
# =========================================================

def update_data_json():

    old_data = load_json(
        DATA_FILE,
        {}
    )

    try:

        latest = (
            get_strategy_capital_data()
        )


        if isinstance(
            old_data,
            dict
        ):

            old_data.update(
                latest
            )

            data = old_data

        else:

            data = latest


        save_json(
            DATA_FILE,
            data
        )


        print(
            "SEC capital data updated."
        )

        print(
            "BTC holdings:",
            data["btcHoldings"]
        )

        print(
            "USD assets:",
            data["usdAssetsUsdB"],
            "B"
        )

        print(
            "Debt:",
            data["debtUsdB"],
            "B"
        )

        print(
            "Preferred:",
            data["preferredUsdB"],
            "B"
        )

        print(
            "FDSO:",
            data["fdso"]
        )

        print(
            "SEC date:",
            data.get("asOf")
        )

        return data


    except Exception as error:

        print(
            "WARNING: Automatic SEC "
            "capital update failed:"
        )

        print(error)

        print(
            "Keeping existing data.json."
        )

        return old_data


# =========================================================
# BTC PRICE
# =========================================================

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


# =========================================================
# MSTR PRICE
# =========================================================

def get_mstr_price():

    data = get_json(
        YAHOO_URL
    )

    result = (
        data
        .get("chart", {})
        .get("result", [None])[0]
    )

    if not result:

        raise ValueError(
            "Yahoo returned no MSTR data"
        )

    price = (
        result
        .get("meta", {})
        .get("regularMarketPrice")
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


# =========================================================
# BINANCE
# =========================================================

def get_binance_oi():

    data = get_json(
        BINANCE_OI_URL
    )

    oi_btc = float(
        data["openInterest"]
    )

    if oi_btc < 0:

        raise ValueError(
            "Invalid Binance OI"
        )

    return oi_btc


def get_binance_funding():

    data = get_json(
        BINANCE_FUNDING_URL
    )

    if not data:

        raise ValueError(
            "No Binance funding data"
        )

    rate = float(
        data[0]["fundingRate"]
    )

    return rate * 100.0


# =========================================================
# BYBIT
# =========================================================

def get_bybit_data():

    data = get_json(
        BYBIT_TICKER_URL
    )

    rows = (
        data
        .get("result", {})
        .get("list", [])
    )

    if not rows:

        raise ValueError(
            "No Bybit BTCUSDT ticker"
        )

    row = rows[0]

    oi_usd = float(
        row["openInterestValue"]
    )

    funding = (
        float(
            row["fundingRate"]
        )
        * 100.0
    )

    if oi_usd <= 0:

        raise ValueError(
            "Invalid Bybit OI"
        )

    return (
        oi_usd,
        funding
    )


# =========================================================
# OKX
# =========================================================

def get_okx_oi():

    data = get_json(
        OKX_OI_URL
    )

    rows = data.get(
        "data",
        []
    )

    if not rows:

        raise ValueError(
            "No OKX OI data"
        )

    oi_usd = float(
        rows[0]["oiUsd"]
    )

    if oi_usd <= 0:

        raise ValueError(
            "Invalid OKX OI"
        )

    return oi_usd


def get_okx_funding():

    data = get_json(
        OKX_FUNDING_URL
    )

    rows = data.get(
        "data",
        []
    )

    if not rows:

        raise ValueError(
            "No OKX funding data"
        )

    funding = (
        float(
            rows[0]["fundingRate"]
        )
        * 100.0
    )

    return funding


# =========================================================
# mNAV
# =========================================================

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

    usd_assets = (
        float(
            company["usdAssetsUsdB"]
        )
        * 1e9
    )

    debt = (
        float(
            company["debtUsdB"]
        )
        * 1e9
    )

    preferred = (
        float(
            company["preferredUsdB"]
        )
        * 1e9
    )


    # -----------------------------------------------------
    # BTC value
    # -----------------------------------------------------

    btc_value = (
        holdings *
        btc_price
    )


    # -----------------------------------------------------
    # Net reserve
    # -----------------------------------------------------

    net_reserve = (
        btc_value
        +
        usd_assets
        -
        debt
        -
        preferred
    )


    # -----------------------------------------------------
    # Per share
    # -----------------------------------------------------

    gross_bps = (
        btc_value /
        fdso
    )

    net_bps = (
        net_reserve /
        fdso
    )


    # -----------------------------------------------------
    # BTC per share
    # -----------------------------------------------------

    btc_per_share = (
        holdings /
        fdso
    )


    if net_bps <= 0:

        raise ValueError(
            "Invalid Net BPS"
        )

    if gross_bps <= 0:

        raise ValueError(
            "Invalid Gross BPS"
        )


    # -----------------------------------------------------
    # mNAV
    # -----------------------------------------------------

    mnav = (
        mstr_price /
        net_bps
    )

    gross_mnav = (
        mstr_price /
        gross_bps
    )


    return {

        "btcValueUsd":
            btc_value,

        "netReserveUsd":
            net_reserve,

        "grossBpsUsd":
            gross_bps,

        "netBpsUsd":
            net_bps,

        "btcPerShare":
            btc_per_share,

        "mnav":
            mnav,

        "grossMnav":
            gross_mnav
    }


# =========================================================
# PREVIOUS RECORD
# =========================================================

def get_previous_record(
    history,
    days_back
):

    if not history:

        return None


    target = (
        datetime.now(
            timezone.utc
        ).date()
        -
        timedelta(
            days=days_back
        )
    )


    target_key = (
        target.strftime(
            "%Y-%m-%d"
        )
    )


    candidates = [

        item

        for item in history

        if item.get(
            "date",
            ""
        ) <= target_key
    ]


    if not candidates:

        return None


    candidates.sort(
        key=lambda x:
        x.get(
            "date",
            ""
        )
    )


    return candidates[-1]


# =========================================================
# PERCENTAGE CHANGE
# =========================================================

def percentage_change(
    current,
    previous
):

    try:

        current = float(
            current
        )

        previous = float(
            previous
        )

    except Exception:

        return None


    if previous <= 0:

        return None


    return (
        (
            current /
            previous
        )
        -
        1
    ) * 100.0


# =========================================================
# mNAV PERCENTILE
# =========================================================

def calculate_mnav_percentile(
    current_mnav,
    history
):

    try:

        current = float(
            current_mnav
        )

    except Exception:

        return None


    values = []


    for item in history:

        try:

            value = float(
                item.get(
                    "mnav"
                )
            )

            if (
                value > 0
                and
                value == value
            ):

                values.append(
                    value
                )

        except Exception:

            continue


    if len(values) < 5:

        return None


    values.sort()


    below_or_equal = sum(

        1

        for value in values

        if value <= current
    )


    return (
        below_or_equal /
        len(values)
    ) * 100.0


# =========================================================
# RISK SCORE
# =========================================================

def calculate_risk_score(
    mnav_percentile,
    funding_rate,
    oi_change_1d,
    oi_change_7d,
    btc_change_7d
):

    score = 0.0


    # -----------------------------------------------------
    # mNAV
    # -----------------------------------------------------

    if mnav_percentile is not None:

        if mnav_percentile >= 95:

            score += 35

        elif mnav_percentile >= 85:

            score += 28

        elif mnav_percentile >= 70:

            score += 20

        elif mnav_percentile >= 50:

            score += 10


    # -----------------------------------------------------
    # Funding
    # -----------------------------------------------------

    if funding_rate is not None:

        funding = abs(
            float(
                funding_rate
            )
        )


        if funding >= 0.08:

            score += 30

        elif funding >= 0.05:

            score += 23

        elif funding >= 0.03:

            score += 15

        elif funding >= 0.015:

            score += 7


    # -----------------------------------------------------
    # OI 1D
    # -----------------------------------------------------

    if oi_change_1d is not None:

        oi1 = float(
            oi_change_1d
        )


        if oi1 >= 10:

            score += 15

        elif oi1 >= 6:

            score += 11

        elif oi1 >= 3:

            score += 6


    # -----------------------------------------------------
    # OI 7D
    # -----------------------------------------------------

    if oi_change_7d is not None:

        oi7 = float(
            oi_change_7d
        )


        if oi7 >= 20:

            score += 15

        elif oi7 >= 12:

            score += 11

        elif oi7 >= 7:

            score += 6


    # -----------------------------------------------------
    # BTC 7D
    # -----------------------------------------------------

    if btc_change_7d is not None:

        btc7 = float(
            btc_change_7d
        )


        if btc7 >= 15:

            score += 10

        elif btc7 >= 10:

            score += 7

        elif btc7 >= 5:

            score += 4


    # -----------------------------------------------------
    # Limit
    # -----------------------------------------------------

    score = min(
        100.0,
        max(
            0.0,
            score
        )
    )


    # -----------------------------------------------------
    # Level
    # -----------------------------------------------------

    if score < 25:

        level = "SAFE"

    elif score < 50:

        level = "CAUTION"

    elif score < 75:

        level = "OVERHEATED"

    else:

        level = "EXTREME"


    return (
        round(
            score,
            1
        ),
        level
    )


# =========================================================
# MAIN
# =========================================================

def main():

    print()

    print(
        "======================================"
    )

    print(
        "MSTR Market History Update v8.0"
    )

    print(
        "======================================"
    )


    # =====================================================
    # STEP 1
    # SEC
    # =====================================================

    company = (
        update_data_json()
    )


    if not company:

        raise RuntimeError(
            "No company data available"
        )


    # =====================================================
    # STEP 2
    # MARKET
    # =====================================================

    btc_price = (
        get_btc_price()
    )

    mstr_price = (
        get_mstr_price()
    )


    # =====================================================
    # STEP 3
    # mNAV
    # =====================================================

    result = calculate_mnav(
        btc_price,
        mstr_price,
        company
    )


    # =====================================================
    # STEP 4
    # HISTORY
    # =====================================================

    history = load_json(
        HISTORY_FILE,
        []
    )


    if not isinstance(
        history,
        list
    ):

        history = []


    # =====================================================
    # STEP 5
    # OI / FUNDING
    # =====================================================

    oi_values = []

    funding_values = []


    # =====================================================
    # BINANCE
    # =====================================================

    try:

        binance_oi_btc = (
            get_binance_oi()
        )


        binance_oi_usd = (
            binance_oi_btc *
            btc_price
        )


        if binance_oi_usd > 0:

            oi_values.append(
                (
                    "Binance",
                    binance_oi_usd
                )
            )


            try:

                binance_funding = (
                    get_binance_funding()
                )


                funding_values.append(
                    (
                        "Binance",
                        binance_funding,
                        binance_oi_usd
                    )
                )


            except Exception as error:

                print(
                    "WARNING: Binance funding failed:",
                    error
                )


    except Exception as error:

        print(
            "WARNING: Binance OI failed:",
            error
        )


    # =====================================================
    # BYBIT
    # =====================================================

    try:

        (
            bybit_oi_usd,
            bybit_funding
        ) = get_bybit_data()


        if bybit_oi_usd > 0:

            oi_values.append(
                (
                    "Bybit",
                    bybit_oi_usd
                )
            )


            funding_values.append(
                (
                    "Bybit",
                    bybit_funding,
                    bybit_oi_usd
                )
            )


    except Exception as error:

        print(
            "WARNING: Bybit failed:",
            error
        )


    # =====================================================
    # OKX
    # =====================================================

    okx_oi_usd = None


    try:

        okx_oi_usd = (
            get_okx_oi()
        )


        if okx_oi_usd > 0:

            oi_values.append(
                (
                    "OKX",
                    okx_oi_usd
                )
            )


    except Exception as error:

        print(
            "WARNING: OKX OI failed:",
            error
        )


    try:

        okx_funding = (
            get_okx_funding()
        )


        if (
            okx_oi_usd is not None
            and
            okx_oi_usd > 0
        ):

            funding_values.append(
                (
                    "OKX",
                    okx_funding,
                    okx_oi_usd
                )
            )


    except Exception as error:

        print(
            "WARNING: OKX funding failed:",
            error
        )


    # =====================================================
    # STEP 6
    # AGGREGATE OI
    # =====================================================

    aggregate_oi_usd = None

    aggregate_oi_btc = None


    if oi_values:

        aggregate_oi_usd = sum(

            value

            for _, value

            in oi_values
        )


        aggregate_oi_btc = (
            aggregate_oi_usd /
            btc_price
        )


    # =====================================================
    # STEP 7
    # WEIGHTED FUNDING
    # =====================================================

    aggregate_funding = None


    if funding_values:

        total_weight = sum(

            oi

            for _, _, oi

            in funding_values

            if oi > 0
        )


        if total_weight > 0:

            aggregate_funding = (

                sum(

                    rate * oi

                    for _, rate, oi

                    in funding_values

                )

                /

                total_weight
            )


    # =====================================================
    # STEP 8
    # PREVIOUS DATA
    # =====================================================

    previous_1d = (
        get_previous_record(
            history,
            1
        )
    )


    previous_7d = (
        get_previous_record(
            history,
            7
        )
    )


    # =====================================================
    # STEP 9
    # CHANGES
    # =====================================================

    oi_change_1d = None

    oi_change_7d = None

    btc_change_1d = None

    btc_change_7d = None

    mnav_change_1d = None

    mnav_change_7d = None

    btc_yield_1d = None

    btc_yield_7d = None


    # -----------------------------------------------------
    # 1 DAY
    # -----------------------------------------------------

    if previous_1d:

        if aggregate_oi_btc is not None:

            oi_change_1d = (
                percentage_change(
                    aggregate_oi_btc,
                    previous_1d.get(
                        "oiBtc"
                    )
                )
            )


        btc_change_1d = (
            percentage_change(
                btc_price,
                previous_1d.get(
                    "btc"
                )
            )
        )


        mnav_change_1d = (
            percentage_change(
                result["mnav"],
                previous_1d.get(
                    "mnav"
                )
            )
        )


        btc_yield_1d = (
            percentage_change(
                result["btcPerShare"],
                previous_1d.get(
                    "btcPerShare"
                )
            )
        )


    # -----------------------------------------------------
    # 7 DAY
    # -----------------------------------------------------

    if previous_7d:

        if aggregate_oi_btc is not None:

            oi_change_7d = (
                percentage_change(
                    aggregate_oi_btc,
                    previous_7d.get(
                        "oiBtc"
                    )
                )
            )


        btc_change_7d = (
            percentage_change(
                btc_price,
                previous_7d.get(
                    "btc"
                )
            )
        )


        mnav_change_7d = (
            percentage_change(
                result["mnav"],
                previous_7d.get(
                    "mnav"
                )
            )
        )


        btc_yield_7d = (
            percentage_change(
                result["btcPerShare"],
                previous_7d.get(
                    "btcPerShare"
                )
            )
        )


    # =====================================================
    # STEP 10
    # mNAV PERCENTILE
    # =====================================================

    mnav_percentile = (
        calculate_mnav_percentile(
            result["mnav"],
            history
        )
    )


    # =====================================================
    # STEP 11
    # RISK
    # =====================================================

    (
        risk_score,
        risk_level
    ) = calculate_risk_score(

        mnav_percentile,

        aggregate_funding,

        oi_change_1d,

        oi_change_7d,

        btc_change_7d
    )


    # =====================================================
    # STEP 12
    # DATE
    # =====================================================

    now = datetime.now(
        timezone.utc
    )


    date_key = now.strftime(
        "%Y-%m-%d"
    )


    # =====================================================
    # STEP 13
    # RECORD
    # =====================================================

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

        "btcValueUsd":
            round(
                result["btcValueUsd"],
                2
            ),

        "grossBpsUsd":
            round(
                result["grossBpsUsd"],
                2
            ),

        "netBpsUsd":
            round(
                result["netBpsUsd"],
                2
            ),

        "btcPerShare":
            round(
                result["btcPerShare"],
                10
            ),

        "mnav":
            round(
                result["mnav"],
                4
            ),

        "grossMnav":
            round(
                result["grossMnav"],
                4
            ),

        "oiBtc":
            (
                round(
                    aggregate_oi_btc,
                    2
                )
                if aggregate_oi_btc
                is not None
                else None
            ),

        "oiUsd":
            (
                round(
                    aggregate_oi_usd,
                    2
                )
                if aggregate_oi_usd
                is not None
                else None
            ),

        "fundingRate":
            (
                round(
                    aggregate_funding,
                    5
                )
                if aggregate_funding
                is not None
                else None
            ),

        "oiChange1dPct":
            (
                round(
                    oi_change_1d,
                    2
                )
                if oi_change_1d
                is not None
                else None
            ),

        "oiChange7dPct":
            (
                round(
                    oi_change_7d,
                    2
                )
                if oi_change_7d
                is not None
                else None
            ),

        "btcChange1dPct":
            (
                round(
                    btc_change_1d,
                    2
                )
                if btc_change_1d
                is not None
                else None
            ),

        "btcChange7dPct":
            (
                round(
                    btc_change_7d,
                    2
                )
                if btc_change_7d
                is not None
                else None
            ),

        "mnavChange1dPct":
            (
                round(
                    mnav_change_1d,
                    2
                )
                if mnav_change_1d
                is not None
                else None
            ),

        "mnavChange7dPct":
            (
                round(
                    mnav_change_7d,
                    2
                )
                if mnav_change_7d
                is not None
                else None
            ),

        "btcYield1dPct":
            (
                round(
                    btc_yield_1d,
                    2
                )
                if btc_yield_1d
                is not None
                else None
            ),

        "btcYield7dPct":
            (
                round(
                    btc_yield_7d,
                    2
                )
                if btc_yield_7d
                is not None
                else None
            ),

        "mnavPercentile":
            (
                round(
                    mnav_percentile,
                    2
                )
                if mnav_percentile
                is not None
                else None
            ),

        "riskScore":
            risk_score,

        "riskLevel":
            risk_level,

        "oiSources":
            [
                name
                for name, _
                in oi_values
            ],

        "fundingSources":
            [
                name
                for name, _, _
                in funding_values
            ],

        "capitalDataDate":
            company.get(
                "asOf"
            )
    }


    # =====================================================
    # STEP 14
    # REPLACE TODAY
    # =====================================================

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


    # =====================================================
    # STEP 15
    # SORT
    # =====================================================

    history.sort(
        key=lambda x:
        x.get(
            "date",
            ""
        )
    )


    # =====================================================
    # STEP 16
    # SAVE
    # =====================================================

    save_json(
        HISTORY_FILE,
        history
    )


    # =====================================================
    # CONSOLE
    # =====================================================

    print()

    print(
        "======================================"
    )

    print(
        "SEC CAPITAL DATA"
    )

    print(
        "BTC holdings:",
        company.get(
            "btcHoldings"
        )
    )

    print(
        "USD Assets:",
        company.get(
            "usdAssetsUsdB"
        ),
        "B"
    )

    print(
        "Debt:",
        company.get(
            "debtUsdB"
        ),
        "B"
    )

    print(
        "Preferred:",
        company.get(
            "preferredUsdB"
        ),
        "B"
    )

    print(
        "FDSO:",
        company.get(
            "fdso"
        )
    )

    print(
        "SEC date:",
        company.get(
            "asOf"
        )
    )

    print(
        "--------------------------------------"
    )

    print(
        "BTC:",
        btc_price
    )

    print(
        "MSTR:",
        mstr_price
    )

    print(
        "Gross BPS:",
        result["grossBpsUsd"]
    )

    print(
        "Net BPS:",
        result["netBpsUsd"]
    )

    print(
        "Gross mNAV:",
        result["grossMnav"]
    )

    print(
        "Net mNAV:",
        result["mnav"]
    )

    print(
        "BTC / share:",
        result["btcPerShare"]
    )

    print(
        "--------------------------------------"
    )

    print(
        "Aggregate OI BTC:",
        aggregate_oi_btc
    )

    print(
        "Aggregate OI USD:",
        aggregate_oi_usd
    )

    print(
        "Funding:",
        aggregate_funding
    )

    print(
        "OI 1D:",
        oi_change_1d
    )

    print(
        "OI 7D:",
        oi_change_7d
    )

    print(
        "BTC 7D:",
        btc_change_7d
    )

    print(
        "BTC Yield 1D:",
        btc_yield_1d
    )

    print(
        "BTC Yield 7D:",
        btc_yield_7d
    )

    print(
        "mNAV percentile:",
        mnav_percentile
    )

    print(
        "Risk Score:",
        risk_score
    )

    print(
        "Risk Level:",
        risk_level
    )

    print(
        "--------------------------------------"
    )

    print(
        "OI sources:",
        ", ".join(
            name
            for name, _
            in oi_values
        )
        if oi_values
        else "NONE"
    )

    print(
        "Funding sources:",
        ", ".join(
            name
            for name, _, _
            in funding_values
        )
        if funding_values
        else "NONE"
    )

    print(
        "History records:",
        len(history)
    )

    print(
        "======================================"
    )


# =========================================================
# RUN
# =========================================================

if __name__ == "__main__":

    main()
