import json
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from html import unescape

import requests


# =========================================================
# MSTR MARKET HISTORY UPDATE
# FINAL ARCHITECTURE
#
# SOURCE PRIORITY
#
# 1. Strategy.com
# 2. SEC
# 3. Existing data.json
#
#
# INTERNAL data.json UNITS
#
# btcHoldings      = BTC
# adso             = MILLIONS of shares
# fdso             = MILLIONS of shares
# usdAssetsUsdB    = USD billions
# debtUsdB         = USD billions
# preferredUsdB    = USD billions
#
#
# history.json UNITS
#
# btcPerShare      = BTC/share
# grossBpsUsd      = USD/share
# netBpsUsd        = USD/share
# mnav             = multiple
#
# IMPORTANT
#
# data.json keeps the original app-compatible M units.
# We convert to actual shares ONLY during calculations.
# =========================================================


# =========================================================
# FILES
# =========================================================

DATA_FILE = Path("data.json")
HISTORY_FILE = Path("history.json")


# =========================================================
# URLS
# =========================================================

STRATEGY_HOME_URL = (
    "https://www.strategy.com/"
)

STRATEGY_LEDGER_URL = (
    "https://www.strategy.com/ledger"
)

STRATEGY_SHARES_URL = (
    "https://www.strategy.com/shares"
)


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
        "(compatible; tommyoon007-mnav/10.0; "
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
        "tommyoon007-mnav/10.0 "
        "(investment dashboard)"
    ),
    "Accept": "text/html,application/json",
}

TIMEOUT = 25


# =========================================================
# VERIFIED FALLBACK
#
# Last known verified snapshot supplied/confirmed
# during the current project.
#
# NOTE:
# data.json uses M shares.
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
# SESSION
# =========================================================

SESSION = requests.Session()

SESSION.headers.update(
    HEADERS
)


# =========================================================
# JSON
# =========================================================

def load_json(
    path,
    default
):

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


def save_json(
    path,
    data
):

    path.write_text(
        json.dumps(
            data,
            indent=2,
            ensure_ascii=False
        )
        +
        "\n",
        encoding="utf-8"
    )


# =========================================================
# TEXT
# =========================================================

def clean_text(
    text
):

    if text is None:

        return ""

    text = unescape(
        str(text)
    )

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


def html_to_text(
    html
):

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

    return clean_text(
        html
    )


# =========================================================
# NUMBER
# =========================================================

def number_from_text(
    value
):

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


def to_billions(
    value,
    unit_hint=""
):

    if value is None:

        return None

    n = float(
        value
    )

    unit = clean_text(
        unit_hint
    ).lower()

    if (
        unit in
        (
            "b",
            "bn",
            "billion",
            "$b",
            "$bn"
        )
    ):

        return n

    if (
        unit in
        (
            "m",
            "mm",
            "million",
            "$m",
            "$mm"
        )
    ):

        return n / 1000.0

    # When no explicit unit exists:
    #
    # Large values are usually USD absolute.
    #
    if n >= 1_000_000:

        return n / 1_000_000_000

    return n


# =========================================================
# HTTP
# =========================================================

def fetch_page(
    url,
    headers=None
):

    response = SESSION.get(
        url,
        headers=headers,
        timeout=TIMEOUT
    )

    response.raise_for_status()

    return response.text


def fetch_json(
    url
):

    response = SESSION.get(
        url,
        timeout=TIMEOUT
    )

    response.raise_for_status()

    return response.json()


# =========================================================
# GENERIC LABEL SEARCH
# =========================================================

def find_label_number(
    text,
    labels,
    window=300
):

    if not text:

        return None

    for label in labels:

        pattern = (
            re.escape(label)
            +
            rf".{{0,{window}}}}?"
            r"(-?\d+(?:,\d{3})*(?:\.\d+)?)"
        )

        match = re.search(
            pattern,
            text,
            re.I | re.S
        )

        if match:

            value = number_from_text(
                match.group(1)
            )

            if value is not None:

                return value

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

    # -----------------------------------------------------
    # Direct metrics visible on Strategy.com
    # -----------------------------------------------------

    result["mstrPrice"] = (
        find_label_number(
            text,
            [
                "MSTR Price"
            ],
            80
        )
    )

    result["mnav"] = (
        find_label_number(
            text,
            [
                "mNAV"
            ],
            80
        )
    )

    result["openInterestM"] = (
        find_label_number(
            text,
            [
                "Open Interest ($M)",
                "Open Interest"
            ],
            80
        )
    )

    result["debtM"] = (
        find_label_number(
            text,
            [
                "Debt ($M)",
                "Debt"
            ],
            80
        )
    )

    result["preferredM"] = (
        find_label_number(
            text,
            [
                "Pref ($M)",
                "Pref"
            ],
            80
        )
    )

    result["usdReserveM"] = (
        find_label_number(
            text,
            [
                "USD Reserve ($M)",
                "USD Reserve"
            ],
            80
        )
    )

    result["usdCashM"] = (
        find_label_number(
            text,
            [
                "USD Cash ($M)",
                "USD Cash"
            ],
            80
        )
    )

    result["netBpsUsd"] = (
        find_label_number(
            text,
            [
                "Net BTC Per Share ($)",
                "Net BPS ($)"
            ],
            120
        )
    )

    result["btcReserveM"] = (
        find_label_number(
            text,
            [
                "BTC Reserve ($M)",
                "BTC Reserve"
            ],
            100
        )
    )

    # -----------------------------------------------------
    # BTC holdings from visible homepage text
    # -----------------------------------------------------

    btc_match = re.search(
        r"₿\s*"
        r"([0-9]{3}(?:,[0-9]{3})+)",
        text
    )

    if btc_match:

        result["btcHoldings"] = int(
            number_from_text(
                btc_match.group(1)
            )
        )

    return result


# =========================================================
# STRATEGY.COM LEDGER
# =========================================================

def get_strategy_ledger_data():

    html = fetch_page(
        STRATEGY_LEDGER_URL
    )

    text = html_to_text(
        html
    )

    result = {}

    # -----------------------------------------------------
    # Current BTC holdings
    #
    # Search near the top of the ledger for the latest
    # cumulative BTC figure.
    # -----------------------------------------------------

    candidates = re.findall(
        r"₿\s*"
        r"([0-9]{3}(?:,[0-9]{3})+)",
        text
    )

    if candidates:

        numbers = [
            int(
                number_from_text(
                    item
                )
            )
            for item in candidates
        ]

        numbers = [
            n
            for n in numbers
            if 100_000 <= n <= 2_000_000
        ]

        if numbers:

            result[
                "btcHoldings"
            ] = max(
                numbers
            )

    # -----------------------------------------------------
    # ADSO ('000)
    # -----------------------------------------------------

    match = re.search(
        r"ADSO\s*\('000\)"
        r".{0,1200}?"
        r"([0-9]{2,6}(?:\.[0-9]+)?)",
        text,
        re.I | re.S
    )

    if match:

        result["adso"] = float(
            match.group(1)
        )

    return result


# =========================================================
# STRATEGY.COM SHARES
# =========================================================

def get_strategy_shares_data():

    html = fetch_page(
        STRATEGY_SHARES_URL
    )

    text = html_to_text(
        html
    )

    result = {}

    # -----------------------------------------------------
    # Basic Shares
    # -----------------------------------------------------

    result[
        "basicSharesM"
    ] = find_label_number(
        text,
        [
            "Basic Shares Outstanding"
        ],
        500
    )

    # -----------------------------------------------------
    # Options
    # -----------------------------------------------------

    result[
        "optionsM"
    ] = find_label_number(
        text,
        [
            "Options Outstanding"
        ],
        500
    )

    # -----------------------------------------------------
    # RSU / PSU
    # -----------------------------------------------------

    result[
        "rsuM"
    ] = find_label_number(
        text,
        [
            "RSU/PSU Unvested",
            "RSU/PSU"
        ],
        500
    )

    # -----------------------------------------------------
    # FDSO direct
    # -----------------------------------------------------

    result[
        "fdsoM"
    ] = find_label_number(
        text,
        [
            "FDSO",
            "Fully Diluted Shares"
        ],
        300
    )

    return result


# =========================================================
# BUILD FDSO
# =========================================================

def calculate_strategy_fdso(
    shares_data,
    existing_fdso
):

    # -----------------------------------------------------
    # First preference: direct FDSO
    # -----------------------------------------------------

    direct = shares_data.get(
        "fdsoM"
    )

    if (
        direct is not None
        and
        300 <= direct <= 700
    ):

        return round(
            direct,
            3
        )

    # -----------------------------------------------------
    # Second preference:
    #
    # Basic + Options + RSU/PSU
    #
    # This does NOT attempt to invent ITM
    # convertible calculations when Strategy's
    # page doesn't expose enough structured data.
    # -----------------------------------------------------

    basic = shares_data.get(
        "basicSharesM"
    )

    options = shares_data.get(
        "optionsM"
    )

    rsu = shares_data.get(
        "rsuM"
    )

    if (
        basic is not None
        and
        300 <= basic <= 500
    ):

        total = basic

        if options is not None:
            total += options

        if rsu is not None:
            total += rsu

        if 300 <= total <= 700:

            return round(
                total,
                3
            )

    # -----------------------------------------------------
    # Existing data.json
    # -----------------------------------------------------

    if (
        existing_fdso is not None
        and
        300 <= float(existing_fdso) <= 700
    ):

        return round(
            float(existing_fdso),
            3
        )

    return None


# =========================================================
# STRATEGY CAPITAL SNAPSHOT
# =========================================================

def get_strategy_capital_data(
    existing_data
):

    home = {}
    ledger = {}
    shares = {}

    errors = []

    # -----------------------------------------------------
    # Home
    # -----------------------------------------------------

    try:

        home = get_strategy_home_data()

    except Exception as error:

        errors.append(
            f"home: {error}"
        )

        print(
            "WARNING: Strategy homepage failed:",
            error
        )

    # -----------------------------------------------------
    # Ledger
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
    # Shares
    # -----------------------------------------------------

    try:

        shares = get_strategy_shares_data()

    except Exception as error:

        errors.append(
            f"shares: {error}"
        )

        print(
            "WARNING: Strategy shares failed:",
            error
        )

    # -----------------------------------------------------
    # Merge BTC holdings
    # -----------------------------------------------------

    btc_holdings = (
        home.get(
            "btcHoldings"
        )
    )

    if btc_holdings is None:

        btc_holdings = (
            ledger.get(
                "btcHoldings"
            )
        )

    # -----------------------------------------------------
    # ADSO
    # -----------------------------------------------------

    adso = ledger.get(
        "adso"
    )

    # -----------------------------------------------------
    # FDSO
    # -----------------------------------------------------

    existing_fdso = (
        existing_data.get(
            "fdso"
        )
        if isinstance(
            existing_data,
            dict
        )
        else None
    )

    fdso = calculate_strategy_fdso(
        shares,
        existing_fdso
    )

    # -----------------------------------------------------
    # Capital stack
    #
    # Strategy homepage displays values as $M.
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
    # Existing values may be used only where Strategy
    # did not expose the value directly.
    # -----------------------------------------------------

    if (
        debt_m is None
        and
        isinstance(
            existing_data,
            dict
        )
    ):

        debt_m = (
            float(
                existing_data.get(
                    "debtUsdB",
                    0
                )
            )
            *
            1000
        )

    if (
        pref_m is None
        and
        isinstance(
            existing_data,
            dict
        )
    ):

        pref_m = (
            float(
                existing_data.get(
                    "preferredUsdB",
                    0
                )
            )
            *
            1000
        )

    if (
        reserve_m is None
        and
        isinstance(
            existing_data,
            dict
        )
    ):

        # Existing field contains Reserve + Cash.
        # Keep that as fallback USD assets rather than
        # pretending it is specifically USD Reserve.
        existing_assets_m = (
            float(
                existing_data.get(
                    "usdAssetsUsdB",
                    0
                )
            )
            *
            1000
        )

        reserve_m = existing_assets_m

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

    elif (
        isinstance(
            existing_data,
            dict
        )
        and
        existing_data.get(
            "usdAssetsUsdB"
        ) is not None
    ):

        usd_assets_m = (
            float(
                existing_data[
                    "usdAssetsUsdB"
                ]
            )
            *
            1000
        )

    # -----------------------------------------------------
    # Validate
    # -----------------------------------------------------

    if (
        btc_holdings is None
        or
        not (
            100_000
            <=
            btc_holdings
            <=
            2_000_000
        )
    ):

        raise RuntimeError(
            "Strategy.com BTC holdings unavailable"
        )

    if (
        fdso is None
        or
        not (
            300
            <=
            fdso
            <=
            700
        )
    ):

        raise RuntimeError(
            "Strategy.com FDSO unavailable"
        )

    if debt_m is None:

        raise RuntimeError(
            "Strategy.com Debt unavailable"
        )

    if pref_m is None:

        raise RuntimeError(
            "Strategy.com Preferred unavailable"
        )

    if usd_assets_m is None:

        raise RuntimeError(
            "Strategy.com USD Assets unavailable"
        )

    return {

        "btcHoldings":
            int(
                round(
                    btc_holdings
                )
            ),

        "adso":
            (
                round(
                    float(adso),
                    3
                )
                if adso is not None
                else (
                    existing_data.get(
                        "adso"
                    )
                    if isinstance(
                        existing_data,
                        dict
                    )
                    else None
                )
            ),

        "fdso":
            round(
                float(fdso),
                3
            ),

        "usdAssetsUsdB":
            round(
                usd_assets_m / 1000.0,
                6
            ),

        "debtUsdB":
            round(
                float(debt_m) / 1000.0,
                6
            ),

        "preferredUsdB":
            round(
                float(pref_m) / 1000.0,
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
            home.get(
                "mnav"
            ),

        "strategyNetBpsUsd":
            home.get(
                "netBpsUsd"
            ),

        "strategyMstrPrice":
            home.get(
                "mstrPrice"
            ),

        "strategyOpenInterestM":
            home.get(
                "openInterestM"
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

    # -----------------------------------------------------
    # SEC is intentionally secondary.
    #
    # GitHub Actions has shown 403 responses against
    # SEC Archives. Therefore a SEC failure must NEVER
    # destroy a valid existing dataset.
    # -----------------------------------------------------

    filings = fetch_json(
        SEC_SUBMISSIONS_URL
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

        if i >= len(
            accessions
        ):

            continue

        if i >= len(
            documents
        ):

            continue

        accession = accessions[i]
        document = documents[i]

        try:

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
                "SEC Form 8-K fallback",

            "asOf":
                dates[i]
                if i < len(
                    dates
                )
                else existing_data.get(
                    "asOf"
                )
        }

    raise RuntimeError(
        "SEC Investor Briefing unavailable"
    )


# =========================================================
# COMPANY DATA NORMALIZATION
# =========================================================

def normalize_company_data(
    data
):

    if not isinstance(
        data,
        dict
    ):

        data = {}

    data = dict(
        data
    )

    # -----------------------------------------------------
    # BTC
    # -----------------------------------------------------

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

    # -----------------------------------------------------
    # ADSO
    #
    # Always MILLIONS in data.json.
    # -----------------------------------------------------

    if data.get(
        "adso"
    ) is not None:

        try:

            data["adso"] = float(
                data["adso"]
            )

        except Exception:

            data["adso"] = None

    # -----------------------------------------------------
    # FDSO
    #
    # Always MILLIONS in data.json.
    #
    # This automatically repairs:
    #
    # 419.9 -> 419.9
    #
    # 419900000 -> 419.9
    # -----------------------------------------------------

    try:

        fdso = float(
            data.get(
                "fdso"
            )
        )

        if fdso >= 100_000:

            fdso /= 1_000_000

        elif fdso >= 100_000:

            fdso /= 1_000_000

        data["fdso"] = fdso

    except Exception:

        data["fdso"] = None

    # -----------------------------------------------------
    # USD fields
    # -----------------------------------------------------

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

    # -----------------------------------------------------
    # FDSO range
    # -----------------------------------------------------

    if (
        data.get(
            "fdso"
        ) is None
        or
        not (
            300
            <=
            data["fdso"]
            <=
            700
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
    # 3. Existing data
    # -----------------------------------------------------

    existing = normalize_company_data(
        existing
    )

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

    save_json(
        DATA_FILE,
        fallback
    )

    print(
        "Company data source: verified fallback"
    )

    return fallback


# =========================================================
# BTC
# =========================================================

def get_btc_price():

    data = fetch_json(
        COINGECKO_URL
    )

    price = float(
        data["bitcoin"]["usd"]
    )

    if price <= 0:

        raise RuntimeError(
            "Invalid BTC price"
        )

    return price


# =========================================================
# MSTR
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

    price = float(
        price
    )

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
        data["openInterest"]
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
        *
        100.0
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
        *
        100.0
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
        *
        100.0
    )


# =========================================================
# mNAV CALCULATION
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

    # data.json stores FDSO in millions.
    fdso_m = float(
        company[
            "fdso"
        ]
    )

    fdso_shares = (
        fdso_m
        *
        1_000_000
    )

    usd_assets = (
        float(
            company[
                "usdAssetsUsdB"
            ]
        )
        *
        1_000_000_000
    )

    debt = (
        float(
            company[
                "debtUsdB"
            ]
        )
        *
        1_000_000_000
    )

    preferred = (
        float(
            company[
                "preferredUsdB"
            ]
        )
        *
        1_000_000_000
    )

    # -----------------------------------------------------
    # BTC VALUE
    # -----------------------------------------------------

    btc_value = (
        holdings
        *
        btc_price
    )

    # -----------------------------------------------------
    # Gross BPS
    # -----------------------------------------------------

    gross_bps = (
        btc_value
        /
        fdso_shares
    )

    # -----------------------------------------------------
    # Current fallback net reserve
    #
    # This remains compatible with the existing dashboard
    # until Strategy direct Net BPS is available.
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

    net_bps = (
        net_reserve
        /
        fdso_shares
    )

    btc_per_share = (
        holdings
        /
        fdso_shares
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
        /
        net_bps
    )

    gross_mnav = (
        mstr_price
        /
        gross_bps
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

    key = target.strftime(
        "%Y-%m-%d"
    )

    candidates = [
        item
        for item in history
        if item.get(
            "date",
            ""
        ) <= key
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

        current = float(
            current
        )

        previous = float(
            previous
        )

    except Exception:

        return None

    if previous == 0:

        return None

    return (
        (
            current
            /
            previous
        )
        -
        1
    ) * 100.0


# =========================================================
# REPAIR HISTORY
# =========================================================

def repair_history_record(
    item
):

    item = dict(
        item
    )

    # -----------------------------------------------------
    # BTC/share
    # -----------------------------------------------------

    try:

        value = float(
            item.get(
                "btcPerShare"
            )
        )

        if value > 1:

            value /= 1_000_000

        item[
            "btcPerShare"
        ] = value

    except Exception:

        pass

    # -----------------------------------------------------
    # BPS
    # -----------------------------------------------------

    for key in (
        "grossBpsUsd",
        "netBpsUsd"
    ):

        try:

            value = float(
                item.get(
                    key
                )
            )

            if value > 1_000_000:

                value /= 1_000_000

            item[key] = value

        except Exception:

            pass

    # -----------------------------------------------------
    # mNAV
    # -----------------------------------------------------

    try:

        mnav = float(
            item.get(
                "mnav"
            )
        )

        net_bps = float(
            item.get(
                "netBpsUsd"
            )
        )

        mstr = float(
            item.get(
                "mstr"
            )
        )

        if (
            mnav <= 0
            and
            net_bps > 0
            and
            mstr > 0
        ):

            item[
                "mnav"
            ] = (
                mstr
                /
                net_bps
            )

    except Exception:

        pass

    # -----------------------------------------------------
    # Gross mNAV
    # -----------------------------------------------------

    try:

        gross_mnav = float(
            item.get(
                "grossMnav"
            )
        )

        gross_bps = float(
            item.get(
                "grossBpsUsd"
            )
        )

        mstr = float(
            item.get(
                "mstr"
            )
        )

        if (
            gross_mnav <= 0
            and
            gross_bps > 0
            and
            mstr > 0
        ):

            item[
                "grossMnav"
            ] = (
                mstr
                /
                gross_bps
            )

    except Exception:

        pass

    return item


# =========================================================
# mNAV PERCENTILE
# =========================================================

def calculate_mnav_percentile(
    current,
    history
):

    try:

        current = float(
            current
        )

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

                values.append(
                    value
                )

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
        /
        len(values)
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

    if (
        mnav_percentile
        is not None
    ):

        if mnav_percentile >= 95:

            score += 35

        elif mnav_percentile >= 85:

            score += 28

        elif mnav_percentile >= 70:

            score += 20

        elif mnav_percentile >= 50:

            score += 10

    if (
        funding_rate
        is not None
    ):

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

    if (
        oi_change_1d
        is not None
    ):

        value = float(
            oi_change_1d
        )

        if value >= 10:

            score += 15

        elif value >= 6:

            score += 11

        elif value >= 3:

            score += 6

    if (
        oi_change_7d
        is not None
    ):

        value = float(
            oi_change_7d
        )

        if value >= 20:

            score += 15

        elif value >= 12:

            score += 11

        elif value >= 7:

            score += 6

    if (
        btc_change_7d
        is not None
    ):

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
        "MSTR Market History Update FINAL"
    )
    print(
        "======================================"
    )

    # -----------------------------------------------------
    # 1. COMPANY
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
            ", ".join(
                missing
            )
        )

    # -----------------------------------------------------
    # 2. PRICES
    # -----------------------------------------------------

    btc_price = get_btc_price()

    mstr_price = get_mstr_price()

    # -----------------------------------------------------
    # 3. mNAV
    # -----------------------------------------------------

    result = calculate_mnav(
        btc_price,
        mstr_price,
        company
    )

    # -----------------------------------------------------
    # 4. HISTORY
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
    # 5. OI / FUNDING
    # -----------------------------------------------------

    oi_values = []

    funding_values = []

    # -----------------------------------------------------
    # Binance
    # -----------------------------------------------------

    try:

        oi_btc = (
            get_binance_oi()
        )

        oi_usd = (
            oi_btc
            *
            btc_price
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

    # -----------------------------------------------------
    # Bybit
    # -----------------------------------------------------

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

    # -----------------------------------------------------
    # OKX
    # -----------------------------------------------------

    try:

        oi_usd = (
            get_okx_oi()
        )

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
    # 6. AGGREGATE OI
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
            /
            btc_price
        )

    # -----------------------------------------------------
    # 7. FUNDING
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
    # 8. PREVIOUS
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
    # 9. PERCENTILE
    # -----------------------------------------------------

    percentile = (
        calculate_mnav_percentile(
            result["mnav"],
            history
        )
    )

    # -----------------------------------------------------
    # 10. RISK
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
    # 11. DATE
    # -----------------------------------------------------

    now = datetime.now(
        timezone.utc
    )

    date_key = now.strftime(
        "%Y-%m-%d"
    )

    # -----------------------------------------------------
    # 12. RECORD
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
                2
            ),

        "netBpsUsd":
            round(
                result[
                    "netBpsUsd"
                ],
                2
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
            )
    }

    # -----------------------------------------------------
    # 13. REPLACE TODAY
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
    # 14. SORT
    # -----------------------------------------------------

    history.sort(
        key=lambda item:
        item.get(
            "date",
            ""
        )
    )

    # -----------------------------------------------------
    # 15. SAVE
    # -----------------------------------------------------

    save_json(
        HISTORY_FILE,
        history
    )

    # -----------------------------------------------------
    # 16. CONSOLE
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
        company[
            "btcHoldings"
        ]
    )

    print(
        "ADSO (M):",
        company.get(
            "adso"
        )
    )

    print(
        "FDSO (M):",
        company[
            "fdso"
        ]
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
        "BTC/share:",
        result[
            "btcPerShare"
        ]
    )

    print(
        "mNAV:",
        result[
            "mnav"
        ]
    )

    print(
        "Gross mNAV:",
        result[
            "grossMnav"
        ]
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
        "mNAV percentile:",
        percentile
    )

    print(
        "Risk score:",
        score
    )

    print(
        "Risk level:",
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
