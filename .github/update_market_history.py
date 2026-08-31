import json
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from html import unescape

import requests


# =========================================================
# MSTR MARKET HISTORY UPDATE
#
# SOURCE PRIORITY
#
# 1. Strategy.com
# 2. SEC
# 3. Existing data.json
# 4. Verified fallback
#
# IMPORTANT
#
# Strategy.com became the primary source because SEC Archives
# can return HTTP 403 from GitHub Actions.
#
# SEC failure must NEVER terminate the workflow.
#
# data.json units:
#
# btcHoldings      = BTC
# adso             = millions of shares
# fdso             = millions of shares
# usdAssetsUsdB    = USD billions
# debtUsdB         = USD billions
# preferredUsdB    = USD billions
#
# history.json:
#
# btcPerShare      = BTC/share
# grossBpsUsd      = USD/share
# netBpsUsd        = USD/share
# mnav             = multiple
# =========================================================


# =========================================================
# FILES
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
        "Mozilla/5.0 "
        "(compatible; tommyoon007-mnav/11.0; "
        "+https://tommyoon007.github.io/mnav/)"
    ),
    "Accept": (
        "text/html,application/xhtml+xml,"
        "application/json;q=0.9,*/*;q=0.8"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

SEC_HEADERS = {
    "User-Agent": (
        "tommyoon007-mnav/11.0 "
        "(investment dashboard)"
    ),
    "Accept": "text/html,application/json",
}

TIMEOUT = 25

SESSION = requests.Session()
SESSION.headers.update(HEADERS)


# =========================================================
# VERIFIED FALLBACK
# =========================================================

VERIFIED_FALLBACK = {
    "btcHoldings": 840447,
    "adso": 423.850,
    "fdso": 419.900,
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
        )
        + "\n",
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
        text
        .replace("\xa0", " ")
        .replace("\u202f", " ")
        .replace("\u2009", " ")
        .replace("\u2007", " ")
    )

    text = re.sub(
        r"\s+",
        " ",
        text
    )

    return text.strip()


def html_to_text(html):

    html = re.sub(
        r"<script\b[^>]*>.*?</script>",
        " ",
        html,
        flags=re.I | re.S
    )

    html = re.sub(
        r"<style\b[^>]*>.*?</style>",
        " ",
        html,
        flags=re.I | re.S
    )

    html = re.sub(
        r"<[^>]+>",
        " ",
        html
    )

    return clean_text(html)


# =========================================================
# NUMBER
# =========================================================

def number_from_text(value):

    if value is None:
        return None

    match = re.search(
        r"-?\d+(?:,\d{3})*(?:\.\d+)?",
        str(value)
    )

    if not match:
        return None

    try:
        return float(
            match.group(0)
            .replace(",", "")
        )

    except Exception:
        return None


# =========================================================
# HTTP
# =========================================================

def fetch_page(url, headers=None):

    response = SESSION.get(
        url,
        headers=headers,
        timeout=TIMEOUT
    )

    response.raise_for_status()

    return response.text


def fetch_json(url, headers=None):

    response = SESSION.get(
        url,
        headers=headers,
        timeout=TIMEOUT
    )

    response.raise_for_status()

    return response.json()


# =========================================================
# GENERIC NUMBER EXTRACTION
# =========================================================

def find_number_near_label(
    text,
    labels,
    window=500
):

    if not text:
        return None

    lower_text = text.lower()

    for label in labels:

        label_lower = label.lower()

        start = 0

        while True:

            position = lower_text.find(
                label_lower,
                start
            )

            if position < 0:
                break

            fragment = text[
                position:
                position + window
            ]

            matches = re.findall(
                r"(?<![\w.])"
                r"\$?\s*"
                r"-?\d+(?:,\d{3})*"
                r"(?:\.\d+)?"
                r"(?![\w.])",
                fragment
            )

            for raw in matches:

                value = number_from_text(
                    raw
                )

                if value is not None:
                    return value

            start = (
                position
                + len(label)
            )

    return None


# =========================================================
# STRATEGY.COM HOME
# =========================================================

def get_strategy_home_data():

    html = fetch_page(
        STRATEGY_HOME_URL
    )

    text = html_to_text(
        html
    )

    result = {}

    result["mstrPrice"] = (
        find_number_near_label(
            text,
            ["MSTR Price"],
            100
        )
    )

    result["mnav"] = (
        find_number_near_label(
            text,
            ["mNAV"],
            100
        )
    )

    result["openInterestM"] = (
        find_number_near_label(
            text,
            [
                "Open Interest ($M)",
                "Open Interest"
            ],
            150
        )
    )

    result["debtM"] = (
        find_number_near_label(
            text,
            [
                "Debt ($M)",
                "Debt"
            ],
            120
        )
    )

    result["preferredM"] = (
        find_number_near_label(
            text,
            [
                "Pref ($M)",
                "Pref"
            ],
            120
        )
    )

    result["usdReserveM"] = (
        find_number_near_label(
            text,
            [
                "USD Reserve ($M)",
                "USD Reserve"
            ],
            120
        )
    )

    result["usdCashM"] = (
        find_number_near_label(
            text,
            [
                "USD Cash ($M)",
                "USD Cash"
            ],
            120
        )
    )

    return result


# =========================================================
# STRATEGY BTC PAGE
# =========================================================

def get_strategy_btc_data():

    html = fetch_page(
        STRATEGY_BTC_URL
    )

    text = html_to_text(
        html
    )

    result = {}

    result["mstrPrice"] = (
        find_number_near_label(
            text,
            ["MSTR Price"],
            100
        )
    )

    result["mnav"] = (
        find_number_near_label(
            text,
            ["mNAV"],
            120
        )
    )

    result["netBpsUsd"] = (
        find_number_near_label(
            text,
            [
                "Net BTC Per Share ($)",
                "Net BPS ($)"
            ],
            150
        )
    )

    result["grossBpsUsd"] = (
        find_number_near_label(
            text,
            [
                "BTC Per Share ($)",
                "BPS ($)"
            ],
            150
        )
    )

    result["btcReserveM"] = (
        find_number_near_label(
            text,
            [
                "BTC Reserve ($M)",
                "BTC Reserve"
            ],
            150
        )
    )

    result["netBtc"] = (
        find_number_near_label(
            text,
            ["Net BTC"],
            150
        )
    )

    return result


# =========================================================
# STRATEGY LEDGER
# =========================================================

def get_strategy_ledger_data():

    html = fetch_page(
        STRATEGY_LEDGER_URL
    )

    text = html_to_text(
        html
    )

    result = {}

    btc_candidates = re.findall(
        r"₿\s*"
        r"([0-9]{3}(?:,[0-9]{3})+)",
        text
    )

    if btc_candidates:

        values = []

        for raw in btc_candidates:

            value = number_from_text(
                raw
            )

            if value is not None:
                values.append(
                    int(value)
                )

        values = [
            value
            for value in values
            if 100_000
            <= value
            <= 2_000_000
        ]

        if values:
            result["btcHoldings"] = max(
                values
            )

    # -----------------------------------------------------
    # Latest ADSO
    #
    # Strategy ledger explicitly exposes:
    #
    # ADSO ('000)
    #
    # The first/current row is the latest value.
    # -----------------------------------------------------

    match = re.search(
        r"840,447"
        r".{0,500}?"
        r"([0-9]{3},[0-9]{3}(?:\.\d+)?)",
        text,
        re.I | re.S
    )

    if match:

        result["adso"] = (
            number_from_text(
                match.group(1)
            )
            / 1000.0
        )

    return result


# =========================================================
# STRATEGY SHARES
# =========================================================

def get_strategy_shares_data(
    mstr_price
):

    html = fetch_page(
        STRATEGY_SHARES_URL
    )

    text = html_to_text(
        html
    )

    result = {}

    # -----------------------------------------------------
    # We intentionally parse the current table rather than
    # guessing from old SEC values.
    # -----------------------------------------------------

    basic = find_number_near_label(
        text,
        [
            "Basic Shares Outstanding"
        ],
        800
    )

    options = find_number_near_label(
        text,
        [
            "Options Outstanding"
        ],
        800
    )

    rsu = find_number_near_label(
        text,
        [
            "RSU/PSU Unvested",
            "RSU/PSU"
        ],
        800
    )

    if basic is not None:
        result["basicSharesM"] = (
            basic / 1000.0
        )

    if options is not None:
        result["optionsM"] = (
            options / 1000.0
        )

    if rsu is not None:
        result["rsuM"] = (
            rsu / 1000.0
        )

    # -----------------------------------------------------
    # Parse convertible instruments.
    #
    # Example:
    #
    # 2028 Convert Shares @$183.19
    # 5,513
    #
    # Only conversion prices <= MSTR market price
    # are included in FDSO.
    # -----------------------------------------------------

    convertible_pattern = re.compile(
        r"(?:Convert Shares|STRK Convert Shares)"
        r"\s*@\$"
        r"\s*([\d,]+(?:\.\d+)?)"
        r".{0,250}?"
        r"([0-9]{1,3}(?:,[0-9]{3})*(?:\.\d+)?)",
        re.I | re.S
    )

    itm_convert_m = 0.0

    if mstr_price is not None:

        for match in convertible_pattern.finditer(
            text
        ):

            conversion_price = (
                number_from_text(
                    match.group(1)
                )
            )

            shares = (
                number_from_text(
                    match.group(2)
                )
            )

            if (
                conversion_price is None
                or shares is None
            ):
                continue

            if (
                conversion_price
                <=
                mstr_price
            ):

                itm_convert_m += (
                    shares / 1000.0
                )

    result[
        "itmConvertSharesM"
    ] = itm_convert_m

    # -----------------------------------------------------
    # FDSO
    #
    # Strategy definition:
    #
    # Basic shares
    # + options
    # + RSU/PSU
    # + ITM convert shares
    # + ITM STRK conversion shares
    #
    # OTM convertibles are NOT included in FDSO.
    # -----------------------------------------------------

    if (
        result.get("basicSharesM")
        is not None
    ):

        fdso = (
            result["basicSharesM"]
            +
            result.get(
                "optionsM",
                0.0
            )
            +
            result.get(
                "rsuM",
                0.0
            )
            +
            itm_convert_m
        )

        if (
            300
            <= fdso
            <= 600
        ):

            result["fdsoM"] = round(
                fdso,
                3
            )

    return result


# =========================================================
# STRATEGY CAPITAL DATA
# =========================================================

def get_strategy_capital_data(
    existing_data
):

    errors = []

    home = {}
    btc_page = {}
    ledger = {}
    shares = {}

    # -----------------------------------------------------
    # HOME
    # -----------------------------------------------------

    try:

        home = get_strategy_home_data()

    except Exception as error:

        errors.append(
            f"home: {error}"
        )

        print(
            "WARNING: Strategy home failed:",
            error
        )

    # -----------------------------------------------------
    # BTC PAGE
    # -----------------------------------------------------

    try:

        btc_page = get_strategy_btc_data()

    except Exception as error:

        errors.append(
            f"btc: {error}"
        )

        print(
            "WARNING: Strategy BTC page failed:",
            error
        )

    # -----------------------------------------------------
    # LEDGER
    # -----------------------------------------------------

    try:

        ledger = get_strategy_ledger_data()

    except Exception as error:

        errors.append(
            f"ledger: {error}"
        )

        print(
            "WARNING: Strategy ledger failed:",
            error
        )

    # -----------------------------------------------------
    # MSTR PRICE
    # -----------------------------------------------------

    mstr_price = (
        btc_page.get(
            "mstrPrice"
        )
        or
        home.get(
            "mstrPrice"
        )
    )

    # -----------------------------------------------------
    # SHARES
    # -----------------------------------------------------

    try:

        shares = (
            get_strategy_shares_data(
                mstr_price
            )
        )

    except Exception as error:

        errors.append(
            f"shares: {error}"
        )

        print(
            "WARNING: Strategy shares failed:",
            error
        )

    # -----------------------------------------------------
    # BTC
    # -----------------------------------------------------

    btc_holdings = (
        ledger.get(
            "btcHoldings"
        )
    )

    if btc_holdings is None:

        btc_holdings = (
            existing_data.get(
                "btcHoldings"
            )
        )

    # -----------------------------------------------------
    # ADSO
    # -----------------------------------------------------

    adso = (
        ledger.get(
            "adso"
        )
    )

    if adso is None:

        adso = (
            existing_data.get(
                "adso"
            )
        )

    # -----------------------------------------------------
    # FDSO
    # -----------------------------------------------------

    fdso = (
        shares.get(
            "fdsoM"
        )
    )

    if fdso is None:

        fdso = (
            existing_data.get(
                "fdso"
            )
        )

    # -----------------------------------------------------
    # CAPITAL STACK
    #
    # Strategy home:
    #
    # Debt ($M)
    # Pref ($M)
    # USD Reserve ($M)
    # USD Cash ($M)
    # -----------------------------------------------------

    debt_m = home.get(
        "debtM"
    )

    pref_m = home.get(
        "preferredM"
    )

    reserve_m = home.get(
        "usdReserveM"
    )

    cash_m = home.get(
        "usdCashM"
    )

    # -----------------------------------------------------
    # Fallback to existing values individually.
    #
    # This prevents one missing Strategy field from
    # destroying all fresh Strategy data.
    # -----------------------------------------------------

    if debt_m is None:

        try:

            debt_m = (
                float(
                    existing_data[
                        "debtUsdB"
                    ]
                )
                * 1000.0
            )

        except Exception:
            pass

    if pref_m is None:

        try:

            pref_m = (
                float(
                    existing_data[
                        "preferredUsdB"
                    ]
                )
                * 1000.0
            )

        except Exception:
            pass

    if (
        reserve_m is None
        and
        cash_m is None
    ):

        try:

            existing_assets_m = (
                float(
                    existing_data[
                        "usdAssetsUsdB"
                    ]
                )
                * 1000.0
            )

            reserve_m = (
                existing_assets_m
            )

        except Exception:
            pass

    # -----------------------------------------------------
    # USD Assets
    # -----------------------------------------------------

    usd_assets_m = None

    if (
        reserve_m is not None
        and
        cash_m is not None
    ):

        usd_assets_m = (
            reserve_m
            +
            cash_m
        )

    elif reserve_m is not None:

        usd_assets_m = reserve_m

    elif cash_m is not None:

        usd_assets_m = cash_m

    else:

        try:

            usd_assets_m = (
                float(
                    existing_data[
                        "usdAssetsUsdB"
                    ]
                )
                * 1000.0
            )

        except Exception:
            pass

    # -----------------------------------------------------
    # VALIDATION
    # -----------------------------------------------------

    if (
        btc_holdings is None
        or
        not (
            100_000
            <= float(btc_holdings)
            <= 2_000_000
        )
    ):

        raise RuntimeError(
            "Strategy BTC holdings unavailable"
        )

    if (
        fdso is None
        or
        not (
            300
            <= float(fdso)
            <= 600
        )
    ):

        raise RuntimeError(
            "Strategy FDSO unavailable"
        )

    if debt_m is None:

        raise RuntimeError(
            "Strategy Debt unavailable"
        )

    if pref_m is None:

        raise RuntimeError(
            "Strategy Preferred unavailable"
        )

    if usd_assets_m is None:

        raise RuntimeError(
            "Strategy USD Assets unavailable"
        )

    return {

        "btcHoldings":
            int(
                round(
                    float(
                        btc_holdings
                    )
                )
            ),

        "adso":
            round(
                float(adso),
                3
            )
            if adso is not None
            else None,

        "fdso":
            round(
                float(fdso),
                3
            ),

        "usdAssetsUsdB":
            round(
                float(
                    usd_assets_m
                )
                / 1000.0,
                6
            ),

        "debtUsdB":
            round(
                float(
                    debt_m
                )
                / 1000.0,
                6
            ),

        "preferredUsdB":
            round(
                float(
                    pref_m
                )
                / 1000.0,
                6
            ),

        "source":
            "Strategy.com",

        "asOf":
            datetime.now(
                timezone.utc
            ).strftime(
                "%Y-%m-%d"
            ),

        "strategyMnav":
            (
                btc_page.get(
                    "mnav"
                )
                or
                home.get(
                    "mnav"
                )
            ),

        "strategyNetBpsUsd":
            btc_page.get(
                "netBpsUsd"
            ),

        "strategyGrossBpsUsd":
            btc_page.get(
                "grossBpsUsd"
            ),

        "strategyMstrPrice":
            mstr_price,

        "strategyBtcReserveM":
            btc_page.get(
                "btcReserveM"
            ),

        "errors":
            errors
    }


# =========================================================
# SEC FALLBACK
# =========================================================

def get_sec_capital_data(
    existing_data
):

    try:

        filings = fetch_json(
            SEC_SUBMISSIONS_URL,
            headers=SEC_HEADERS
        )

    except Exception as error:

        raise RuntimeError(
            f"SEC submissions failed: {error}"
        )

    recent = (
        filings
        .get("filings", {})
        .get("recent", {})
    )

    forms = recent.get(
        "form",
        []
    )

    accessions = recent.get(
        "accessionNumber",
        []
    )

    documents = recent.get(
        "primaryDocument",
        []
    )

    dates = recent.get(
        "filingDate",
        []
    )

    for i, form in enumerate(forms):

        if form != "8-K":
            continue

        if i >= len(accessions):
            continue

        if i >= len(documents):
            continue

        accession = accessions[i]
        document = documents[i]

        url = (
            SEC_ARCHIVES_URL
            +
            accession.replace(
                "-",
                ""
            )
            +
            "/"
            +
            document
        )

        try:

            html = fetch_page(
                url,
                headers=SEC_HEADERS
            )

        except Exception as error:

            print(
                "WARNING: SEC filing failed:",
                error
            )

            continue

        text = html_to_text(
            html
        )

        if (
            "INVESTOR BRIEFING"
            not in
            text.upper()
        ):

            continue

        return {

            "btcHoldings":
                existing_data.get(
                    "btcHoldings"
                ),

            "adso":
                existing_data.get(
                    "adso"
                ),

            "fdso":
                existing_data.get(
                    "fdso"
                ),

            "usdAssetsUsdB":
                existing_data.get(
                    "usdAssetsUsdB"
                ),

            "debtUsdB":
                existing_data.get(
                    "debtUsdB"
                ),

            "preferredUsdB":
                existing_data.get(
                    "preferredUsdB"
                ),

            "source":
                "SEC fallback",

            "asOf":
                dates[i]
                if i < len(dates)
                else existing_data.get(
                    "asOf"
                )
        }

    raise RuntimeError(
        "SEC Investor Briefing unavailable"
    )


# =========================================================
# NORMALIZE
# =========================================================

def normalize_company_data(
    data
):

    if not isinstance(
        data,
        dict
    ):

        data = {}

    data = dict(data)

    # BTC

    try:

        data["btcHoldings"] = int(
            round(
                float(
                    data[
                        "btcHoldings"
                    ]
                )
            )
        )

    except Exception:

        data["btcHoldings"] = None

    # ADSO

    try:

        data["adso"] = float(
            data.get(
                "adso"
            )
        )

    except Exception:

        data["adso"] = None

    # FDSO

    try:

        fdso = float(
            data.get(
                "fdso"
            )
        )

        if fdso >= 100_000:

            fdso /= 1_000_000

        data["fdso"] = fdso

    except Exception:

        data["fdso"] = None

    # USD

    for key in (
        "usdAssetsUsdB",
        "debtUsdB",
        "preferredUsdB"
    ):

        try:

            data[key] = float(
                data.get(
                    key
                )
            )

        except Exception:

            data[key] = None

    # FDSO validation

    if (
        data.get(
            "fdso"
        ) is None
        or
        not (
            300
            <= data["fdso"]
            <= 600
        )
    ):

        data["fdso"] = None

    return data


# =========================================================
# UPDATE data.json
# =========================================================

def update_data_json():

    existing = load_json(
        DATA_FILE,
        {}
    )

    existing = normalize_company_data(
        existing
    )

    # -----------------------------------------------------
    # 1. Strategy.com
    # -----------------------------------------------------

    try:

        latest = (
            get_strategy_capital_data(
                existing
            )
        )

        latest = normalize_company_data(
            latest
        )

        merged = {
            **existing,
            **latest
        }

        save_json(
            DATA_FILE,
            merged
        )

        print(
            "Company data source: Strategy.com"
        )

        print(
            "Strategy FDSO:",
            merged.get("fdso")
        )

        return merged

    except Exception as error:

        print(
            "WARNING: Strategy.com failed:",
            error
        )

    # -----------------------------------------------------
    # 2. SEC
    # -----------------------------------------------------

    try:

        latest = get_sec_capital_data(
            existing
        )

        latest = normalize_company_data(
            latest
        )

        merged = {
            **existing,
            **latest
        }

        save_json(
            DATA_FILE,
            merged
        )

        print(
            "Company data source: SEC fallback"
        )

        return merged

    except Exception as error:

        print(
            "WARNING: SEC fallback failed:",
            error
        )

    # -----------------------------------------------------
    # 3. Existing
    # -----------------------------------------------------

    required = [
        "btcHoldings",
        "fdso",
        "usdAssetsUsdB",
        "debtUsdB",
        "preferredUsdB"
    ]

    if all(
        existing.get(
            key
        ) is not None
        for key in required
    ):

        existing["source"] = (
            "Existing data.json"
        )

        print(
            "Company data source: existing data.json"
        )

        save_json(
            DATA_FILE,
            existing
        )

        return existing

    # -----------------------------------------------------
    # 4. Verified fallback
    # -----------------------------------------------------

    fallback = normalize_company_data(
        VERIFIED_FALLBACK
    )

    print(
        "Company data source: verified fallback"
    )

    save_json(
        DATA_FILE,
        fallback
    )

    return fallback


# =========================================================
# BTC PRICE
# =========================================================

def get_btc_price():

    data = fetch_json(
        COINGECKO_URL
    )

    price = float(
        data[
            "bitcoin"
        ][
            "usd"
        ]
    )

    if price <= 0:

        raise RuntimeError(
            "Invalid BTC price"
        )

    return price


# =========================================================
# MSTR PRICE
# =========================================================

def get_mstr_price():

    data = fetch_json(
        YAHOO_URL
    )

    result = (
        data
        .get("chart", {})
        .get("result", [])
    )

    if not result:

        raise RuntimeError(
            "Yahoo returned no MSTR result"
        )

    price = (
        result[0]
        .get("meta", {})
        .get("regularMarketPrice")
    )

    if price is None:

        raise RuntimeError(
            "Yahoo MSTR price unavailable"
        )

    price = float(price)

    if price <= 0:

        raise RuntimeError(
            "Invalid MSTR price"
        )

    return price


# =========================================================
# BINANCE
# =========================================================

def get_binance_oi():

    data = fetch_json(
        BINANCE_OI_URL
    )

    return float(
        data[
            "openInterest"
        ]
    )


def get_binance_funding():

    data = fetch_json(
        BINANCE_FUNDING_URL
    )

    if not data:

        raise RuntimeError(
            "No Binance funding"
        )

    return (
        float(
            data[0][
                "fundingRate"
            ]
        )
        * 100.0
    )


# =========================================================
# BYBIT
# =========================================================

def get_bybit_data():

    data = fetch_json(
        BYBIT_TICKER_URL
    )

    rows = (
        data
        .get("result", {})
        .get("list", [])
    )

    if not rows:

        raise RuntimeError(
            "No Bybit ticker"
        )

    row = rows[0]

    return (
        float(
            row[
                "openInterestValue"
            ]
        ),
        float(
            row[
                "fundingRate"
            ]
        )
        * 100.0
    )


# =========================================================
# OKX
# =========================================================

def get_okx_oi():

    data = fetch_json(
        OKX_OI_URL
    )

    rows = data.get(
        "data",
        []
    )

    if not rows:

        raise RuntimeError(
            "No OKX OI"
        )

    return float(
        rows[0][
            "oiUsd"
        ]
    )


def get_okx_funding():

    data = fetch_json(
        OKX_FUNDING_URL
    )

    rows = data.get(
        "data",
        []
    )

    if not rows:

        raise RuntimeError(
            "No OKX funding"
        )

    return (
        float(
            rows[0][
                "fundingRate"
            ]
        )
        * 100.0
    )


# =========================================================
# mNAV
# =========================================================

def calculate_mnav(
    btc_price,
    mstr_price,
    company
):

    holdings = float(
        company[
            "btcHoldings"
        ]
    )

    fdso_m = float(
        company[
            "fdso"
        ]
    )

    fdso_shares = (
        fdso_m
        * 1_000_000
    )

    usd_assets = (
        float(
            company[
                "usdAssetsUsdB"
            ]
        )
        * 1_000_000_000
    )

    debt = (
        float(
            company[
                "debtUsdB"
            ]
        )
        * 1_000_000_000
    )

    preferred = (
        float(
            company[
                "preferredUsdB"
            ]
        )
        * 1_000_000_000
    )

    btc_value = (
        holdings
        * btc_price
    )

    gross_bps = (
        btc_value
        / fdso_shares
    )

    net_reserve = (
        btc_value
        +
        usd_assets
        -
        debt
        -
        preferred
    )

    net_bps = (
        net_reserve
        / fdso_shares
    )

    btc_per_share = (
        holdings
        / fdso_shares
    )

    if gross_bps <= 0:

        raise RuntimeError(
            "Gross BPS <= 0"
        )

    if net_bps <= 0:

        raise RuntimeError(
            "Net BPS <= 0"
        )

    mnav = (
        mstr_price
        / net_bps
    )

    gross_mnav = (
        mstr_price
        / gross_bps
    )

    if not (
        0
        <
        btc_per_share
        <
        1
    ):

        raise RuntimeError(
            "Invalid BTC/share"
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
# HISTORY REPAIR
# =========================================================

def repair_history_record(
    item
):

    item = dict(item)

    for key in (
        "btcPerShare",
        "grossBpsUsd",
        "netBpsUsd",
        "mnav",
        "grossMnav"
    ):

        try:

            item[key] = float(
                item[key]
            )

        except Exception:

            pass

    return item


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

    return max(
        candidates,
        key=lambda item:
        item.get(
            "date",
            ""
        )
    )


# =========================================================
# PERCENTAGE
# =========================================================

def percentage_change(
    current,
    previous
):

    try:

        current = float(current)
        previous = float(previous)

    except Exception:

        return None

    if previous == 0:

        return None

    return (
        current
        /
        previous
        - 1.0
    ) * 100.0


# =========================================================
# PERCENTILE
# =========================================================

def calculate_mnav_percentile(
    current,
    history
):

    try:

        current = float(current)

    except Exception:

        return None

    if current <= 0:

        return None

    values = []

    for item in history:

        try:

            value = float(
                item.get(
                    "mnav"
                )
            )

            if value > 0:
                values.append(value)

        except Exception:

            continue

    if len(values) < 5:

        return None

    values.sort()

    count = sum(
        1
        for value in values
        if value <= current
    )

    return (
        count
        / len(values)
    ) * 100.0


# =========================================================
# RISK
# =========================================================

def calculate_risk_score(
    mnav_percentile,
    funding_rate,
    oi_change_1d,
    oi_change_7d,
    btc_change_7d
):

    score = 0.0

    if mnav_percentile is not None:

        if mnav_percentile >= 95:
            score += 35

        elif mnav_percentile >= 85:
            score += 28

        elif mnav_percentile >= 70:
            score += 20

        elif mnav_percentile >= 50:
            score += 10

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

    if oi_change_1d is not None:

        value = float(
            oi_change_1d
        )

        if value >= 10:
            score += 15

        elif value >= 6:
            score += 11

        elif value >= 3:
            score += 6

    if oi_change_7d is not None:

        value = float(
            oi_change_7d
        )

        if value >= 20:
            score += 15

        elif value >= 12:
            score += 11

        elif value >= 7:
            score += 6

    if btc_change_7d is not None:

        value = float(
            btc_change_7d
        )

        if value >= 15:
            score += 10

        elif value >= 10:
            score += 7

        elif value >= 5:
            score += 4

    score = min(
        100.0,
        max(
            0.0,
            score
        )
    )

    if score < 25:
        level = "SAFE"

    elif score < 50:
        level = "CAUTION"

    elif score < 75:
        level = "OVERHEATED"

    else:
        level = "EXTREME"

    return (
        round(score, 1),
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
        "MSTR Market History Update v11"
    )
    print(
        "======================================"
    )

    # -----------------------------------------------------
    # COMPANY
    # -----------------------------------------------------

    company = update_data_json()

    company = normalize_company_data(
        company
    )

    required = [
        "btcHoldings",
        "fdso",
        "usdAssetsUsdB",
        "debtUsdB",
        "preferredUsdB"
    ]

    missing = [
        key
        for key in required
        if company.get(
            key
        ) is None
    ]

    if missing:

        raise RuntimeError(
            "Missing company data: "
            +
            ", ".join(missing)
        )

    # -----------------------------------------------------
    # PRICES
    # -----------------------------------------------------

    btc_price = get_btc_price()

    mstr_price = get_mstr_price()

    # -----------------------------------------------------
    # mNAV
    # -----------------------------------------------------

    result = calculate_mnav(
        btc_price,
        mstr_price,
        company
    )

    # -----------------------------------------------------
    # STRATEGY OFFICIAL METRICS
    #
    # These are stored for comparison only.
    #
    # Our calculated mNAV remains the dashboard's
    # internally consistent calculation.
    # -----------------------------------------------------

    strategy_mnav = company.get(
        "strategyMnav"
    )

    strategy_net_bps = company.get(
        "strategyNetBpsUsd"
    )

    # -----------------------------------------------------
    # HISTORY
    # -----------------------------------------------------

    history = load_json(
        HISTORY_FILE,
        []
    )

    if not isinstance(
        history,
        list
    ):

        history = []

    history = [
        repair_history_record(
            item
        )
        for item in history
        if isinstance(
            item,
            dict
        )
    ]

    # -----------------------------------------------------
    # OI
    # -----------------------------------------------------

    oi_values = []
    funding_values = []

    # Binance

    try:

        oi_btc = get_binance_oi()

        oi_usd = (
            oi_btc
            * btc_price
        )

        if oi_usd > 0:

            oi_values.append(
                (
                    "Binance",
                    oi_usd
                )
            )

            try:

                funding = (
                    get_binance_funding()
                )

                funding_values.append(
                    (
                        "Binance",
                        funding,
                        oi_usd
                    )
                )

            except Exception as error:

                print(
                    "WARNING: Binance funding:",
                    error
                )

    except Exception as error:

        print(
            "WARNING: Binance OI:",
            error
        )

    # Bybit

    try:

        oi_usd, funding = (
            get_bybit_data()
        )

        if oi_usd > 0:

            oi_values.append(
                (
                    "Bybit",
                    oi_usd
                )
            )

            funding_values.append(
                (
                    "Bybit",
                    funding,
                    oi_usd
                )
            )

    except Exception as error:

        print(
            "WARNING: Bybit:",
            error
        )

    # OKX

    try:

        oi_usd = get_okx_oi()

        if oi_usd > 0:

            oi_values.append(
                (
                    "OKX",
                    oi_usd
                )
            )

            try:

                funding = (
                    get_okx_funding()
                )

                funding_values.append(
                    (
                        "OKX",
                        funding,
                        oi_usd
                    )
                )

            except Exception as error:

                print(
                    "WARNING: OKX funding:",
                    error
                )

    except Exception as error:

        print(
            "WARNING: OKX OI:",
            error
        )

    # -----------------------------------------------------
    # AGGREGATE OI
    # -----------------------------------------------------

    aggregate_oi_usd = None
    aggregate_oi_btc = None

    if oi_values:

        aggregate_oi_usd = sum(
            value
            for _, value
            in oi_values
        )

        aggregate_oi_btc = (
            aggregate_oi_usd
            / btc_price
        )

    # -----------------------------------------------------
    # FUNDING
    # -----------------------------------------------------

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

    # -----------------------------------------------------
    # PREVIOUS
    # -----------------------------------------------------

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

    # -----------------------------------------------------
    # CHANGES
    # -----------------------------------------------------

    oi1 = None
    oi7 = None

    btc1 = None
    btc7 = None

    mnav1 = None
    mnav7 = None

    yield1 = None
    yield7 = None

    if previous_1d:

        if aggregate_oi_btc is not None:

            oi1 = percentage_change(
                aggregate_oi_btc,
                previous_1d.get(
                    "oiBtc"
                )
            )

        btc1 = percentage_change(
            btc_price,
            previous_1d.get(
                "btc"
            )
        )

        mnav1 = percentage_change(
            result["mnav"],
            previous_1d.get(
                "mnav"
            )
        )

        yield1 = percentage_change(
            result["btcPerShare"],
            previous_1d.get(
                "btcPerShare"
            )
        )

    if previous_7d:

        if aggregate_oi_btc is not None:

            oi7 = percentage_change(
                aggregate_oi_btc,
                previous_7d.get(
                    "oiBtc"
                )
            )

        btc7 = percentage_change(
            btc_price,
            previous_7d.get(
                "btc"
            )
        )

        mnav7 = percentage_change(
            result["mnav"],
            previous_7d.get(
                "mnav"
            )
        )

        yield7 = percentage_change(
            result["btcPerShare"],
            previous_7d.get(
                "btcPerShare"
            )
        )

    # -----------------------------------------------------
    # PERCENTILE
    # -----------------------------------------------------

    percentile = (
        calculate_mnav_percentile(
            result["mnav"],
            history
        )
    )

    # -----------------------------------------------------
    # RISK
    # -----------------------------------------------------

    score, level = (
        calculate_risk_score(
            percentile,
            aggregate_funding,
            oi1,
            oi7,
            btc7
        )
    )

    # -----------------------------------------------------
    # DATE
    # -----------------------------------------------------

    now = datetime.now(
        timezone.utc
    )

    date_key = now.strftime(
        "%Y-%m-%d"
    )

    # -----------------------------------------------------
    # RECORD
    # -----------------------------------------------------

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
                result[
                    "btcValueUsd"
                ],
                2
            ),

        "grossBpsUsd":
            round(
                result[
                    "grossBpsUsd"
                ],
                4
            ),

        "netBpsUsd":
            round(
                result[
                    "netBpsUsd"
                ],
                4
            ),

        "btcPerShare":
            round(
                result[
                    "btcPerShare"
                ],
                10
            ),

        "mnav":
            round(
                result[
                    "mnav"
                ],
                4
            ),

        "grossMnav":
            round(
                result[
                    "grossMnav"
                ],
                4
            ),

        "strategyMnav":
            (
                round(
                    float(
                        strategy_mnav
                    ),
                    4
                )
                if strategy_mnav
                is not None
                else None
            ),

        "strategyNetBpsUsd":
            (
                round(
                    float(
                        strategy_net_bps
                    ),
                    4
                )
                if strategy_net_bps
                is not None
                else None
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
                    oi1,
                    2
                )
                if oi1 is not None
                else None
            ),

        "oiChange7dPct":
            (
                round(
                    oi7,
                    2
                )
                if oi7 is not None
                else None
            ),

        "btcChange1dPct":
            (
                round(
                    btc1,
                    2
                )
                if btc1 is not None
                else None
            ),

        "btcChange7dPct":
            (
                round(
                    btc7,
                    2
                )
                if btc7 is not None
                else None
            ),

        "mnavChange1dPct":
            (
                round(
                    mnav1,
                    2
                )
                if mnav1 is not None
                else None
            ),

        "mnavChange7dPct":
            (
                round(
                    mnav7,
                    2
                )
                if mnav7 is not None
                else None
            ),

        "btcYield1dPct":
            (
                round(
                    yield1,
                    2
                )
                if yield1 is not None
                else None
            ),

        "btcYield7dPct":
            (
                round(
                    yield7,
                    2
                )
                if yield7 is not None
                else None
            ),

        "mnavPercentile":
            (
                round(
                    percentile,
                    2
                )
                if percentile is not None
                else None
            ),

        "riskScore":
            score,

        "riskLevel":
            level,

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
            ),

        "capitalDataSource":
            company.get(
                "source"
            ),

        "adso":
            company.get(
                "adso"
            ),

        "fdso":
            company.get(
                "fdso"
            )
    }

    # -----------------------------------------------------
    # REPLACE TODAY
    # -----------------------------------------------------

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

    # -----------------------------------------------------
    # SORT
    # -----------------------------------------------------

    history.sort(
        key=lambda item:
        item.get(
            "date",
            ""
        )
    )

    # -----------------------------------------------------
    # SAVE
    # -----------------------------------------------------

    save_json(
        HISTORY_FILE,
        history
    )

    # -----------------------------------------------------
    # FINAL CHECK
    # -----------------------------------------------------

    print()
    print(
        "======================================"
    )

    print(
        "FINAL CHECK"
    )

    print(
        "Company source:",
        company.get(
            "source"
        )
    )

    print(
        "Capital date:",
        company.get(
            "asOf"
        )
    )

    print(
        "BTC holdings:",
        company.get(
            "btcHoldings"
        )
    )

    print(
        "ADSO (M):",
        company.get(
            "adso"
        )
    )

    print(
        "FDSO (M):",
        company.get(
            "fdso"
        )
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
        result[
            "grossBpsUsd"
        ]
    )

    print(
        "Net BPS:",
        result[
            "netBpsUsd"
        ]
    )

    print(
        "mNAV:",
        result[
            "mnav"
        ]
    )

    print(
        "Strategy mNAV:",
        strategy_mnav
    )

    print(
        "Strategy Net BPS:",
        strategy_net_bps
    )

    print(
        "Aggregate OI BTC:",
        aggregate_oi_btc
    )

    print(
        "Funding:",
        aggregate_funding
    )

    print(
        "Risk:",
        score,
        level
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
