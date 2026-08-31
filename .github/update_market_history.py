import json
import math
import re

from datetime import datetime, timezone, timedelta
from pathlib import Path
from html import unescape

import requests


# =========================================================
# MSTR MARKET HISTORY UPDATE
# FINAL VERSION
#
# SOURCE PRIORITY
#
# 1. Strategy.com
# 2. SEC
# 3. Existing data.json
# 4. Verified fallback
#
#
# data.json units
#
# btcHoldings      = BTC
# adso             = MILLIONS of shares
# fdso             = MILLIONS of shares
# usdAssetsUsdB    = USD billions
# debtUsdB         = USD billions
# preferredUsdB    = USD billions
#
#
# history.json units
#
# btcPerShare      = BTC/share
# grossBpsUsd      = USD/share
# netBpsUsd        = USD/share
# mnav             = multiple
#
#
# IMPORTANT
#
# Strategy.com is the primary company-data source.
# SEC is only a secondary fallback.
#
# SEC 403 MUST NOT break the workflow.
# =========================================================


# =========================================================
# FILES
# =========================================================

DATA_FILE = Path("data.json")
HISTORY_FILE = Path("history.json")


# =========================================================
# STRATEGY.COM
# =========================================================

STRATEGY_HOME_URL = (
    "https://www.strategy.com/"
)

STRATEGY_BTC_URL = (
    "https://www.strategy.com/btc"
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

YAHOO_MSTR_URL = (
    "https://query1.finance.yahoo.com/v8/finance/chart/"
    "MSTR?range=1d&interval=1d"
)

YAHOO_BTC_URL = (
    "https://query1.finance.yahoo.com/v8/finance/chart/"
    "BTC-USD?range=1d&interval=1d"
)

COINGECKO_URL = (
    "https://api.coingecko.com/api/v3/simple/price"
    "?ids=bitcoin&vs_currencies=usd"
)


# =========================================================
# BINANCE
# =========================================================

BINANCE_PRICE_URL = (
    "https://api.binance.com/api/v3/ticker/price"
    "?symbol=BTCUSDT"
)

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
    "Accept-Language": (
        "en-US,en;q=0.9"
    ),
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
}

SEC_HEADERS = {
    "User-Agent": (
        "tommyoon007-mnav/11.0 "
        "(investment dashboard; "
        "+https://tommyoon007.github.io/mnav/)"
    ),
    "Accept": (
        "text/html,application/json"
    ),
}

TIMEOUT = 25

SESSION = requests.Session()
SESSION.headers.update(HEADERS)


# =========================================================
# VERIFIED FALLBACK
#
# Last known verified Strategy snapshot.
#
# IMPORTANT:
# data.json uses M shares and USD billions.
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
# NUMBER SAFETY
# =========================================================

def is_finite_number(value):

    try:

        return math.isfinite(
            float(value)
        )

    except Exception:

        return False


def safe_float(value):

    try:

        number = float(value)

        if not math.isfinite(number):
            return None

        return number

    except Exception:

        return None


def number_from_text(value):

    if value is None:
        return None

    text = str(value)

    match = re.search(
        r"-?\d+(?:,\d{3})*(?:\.\d+)?",
        text
    )

    if not match:
        return None

    try:

        number = float(
            match.group(0)
            .replace(",", "")
        )

        if not math.isfinite(number):
            return None

        return number

    except Exception:

        return None


# =========================================================
# TEXT
# =========================================================

def clean_text(text):

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

    return clean_text(
        html
    )


# =========================================================
# HTML TABLE PARSER
# =========================================================

def extract_table_rows(html):

    rows = []

    matches = re.findall(
        r"<tr\b[^>]*>(.*?)</tr>",
        html,
        flags=re.I | re.S
    )

    for raw_row in matches:

        cells = re.findall(
            r"<t[dh]\b[^>]*>(.*?)</t[dh]>",
            raw_row,
            flags=re.I | re.S
        )

        cleaned = [
            html_to_text(cell)
            for cell in cells
        ]

        cleaned = [
            cell
            for cell in cleaned
            if cell != ""
        ]

        if cleaned:
            rows.append(cleaned)

    return rows


# =========================================================
# HTTP
# =========================================================

def fetch_page(
    url,
    headers=None
):

    last_error = None

    for attempt in range(3):

        try:

            response = SESSION.get(
                url,
                headers=headers,
                timeout=TIMEOUT
            )

            response.raise_for_status()

            return response.text

        except Exception as error:

            last_error = error

            if attempt < 2:
                continue

    raise RuntimeError(
        f"HTTP request failed: "
        f"{url} -> {last_error}"
    )


def fetch_json(url, headers=None):

    last_error = None

    for attempt in range(3):

        try:

            response = SESSION.get(
                url,
                headers=headers,
                timeout=TIMEOUT
            )

            response.raise_for_status()

            return response.json()

        except Exception as error:

            last_error = error

            if attempt < 2:
                continue

    raise RuntimeError(
        f"JSON request failed: "
        f"{url} -> {last_error}"
    )


# =========================================================
# GENERIC LABEL SEARCH
# =========================================================

def find_label_number(
    text,
    labels,
    window=250,
    minimum=None,
    maximum=None
):

    if not text:
        return None

    for label in labels:

        start = 0

        while True:

            index = text.lower().find(
                label.lower(),
                start
            )

            if index < 0:
                break

            fragment = text[
                index + len(label):
                index + len(label) + window
            ]

            matches = re.findall(
                r"-?\d+(?:,\d{3})*(?:\.\d+)?",
                fragment
            )

            for raw in matches:

                value = number_from_text(
                    raw
                )

                if value is None:
                    continue

                if (
                    minimum is not None
                    and value < minimum
                ):
                    continue

                if (
                    maximum is not None
                    and value > maximum
                ):
                    continue

                return value

            start = (
                index
                +
                len(label)
            )

    return None


# =========================================================
# STRATEGY BTC PAGE
#
# Primary source for:
#
# - mNAV
# - Net BTC Per Share ($)
# - BTC Per Share ($)
# - BTC holdings
# - BTC reserve
#
# Strategy's current dashboard defines mNAV as:
#
# MSTR Price / Net BTC Per Share ($)
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
        find_label_number(
            text,
            [
                "MSTR Price"
            ],
            120,
            20,
            1000
        )
    )

    result["mnav"] = (
        find_label_number(
            text,
            [
                "mNAV Updated",
                "mNAV"
            ],
            120,
            0.05,
            20
        )
    )

    result["netBpsUsd"] = (
        find_label_number(
            text,
            [
                "Net BTC Per Share ($)",
                "Net BPS ($)"
            ],
            180,
            1,
            1000
        )
    )

    result["grossBpsUsd"] = (
        find_label_number(
            text,
            [
                "BTC Per Share ($)",
                "BPS ($)"
            ],
            180,
            1,
            1000
        )
    )

    result["btcReserveM"] = (
        find_label_number(
            text,
            [
                "BTC Reserve ($M)",
                "Reserve ($M)"
            ],
            150,
            0,
            100000
        )
    )

    result["netReserveM"] = (
        find_label_number(
            text,
            [
                "Net Reserve ($M)"
            ],
            150,
            0,
            100000
        )
    )

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
# STRATEGY HOME
#
# Secondary Strategy source.
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
        find_label_number(
            text,
            ["MSTR Price"],
            120,
            20,
            1000
        )
    )

    result["mnav"] = (
        find_label_number(
            text,
            [
                "mNAV Updated",
                "mNAV"
            ],
            120,
            0.05,
            20
        )
    )

    result["netBpsUsd"] = (
        find_label_number(
            text,
            [
                "Net BTC Per Share ($)",
                "Net BPS ($)"
            ],
            180,
            1,
            1000
        )
    )

    result["grossBpsUsd"] = (
        find_label_number(
            text,
            [
                "BTC Per Share ($)",
                "BPS ($)"
            ],
            180,
            1,
            1000
        )
    )

    result["openInterestM"] = (
        find_label_number(
            text,
            [
                "Open Interest ($M)",
                "Open Interest"
            ],
            120,
            0,
            100000
        )
    )

    result["debtM"] = (
        find_label_number(
            text,
            [
                "Debt ($M)"
            ],
            120,
            0,
            100000
        )
    )

    result["preferredM"] = (
        find_label_number(
            text,
            [
                "Pref ($M)"
            ],
            120,
            0,
            100000
        )
    )

    result["usdReserveM"] = (
        find_label_number(
            text,
            [
                "USD Reserve ($M)"
            ],
            120,
            0,
            100000
        )
    )

    result["usdCashM"] = (
        find_label_number(
            text,
            [
                "USD Cash ($M)"
            ],
            120,
            0,
            100000
        )
    )

    result["btcReserveM"] = (
        find_label_number(
            text,
            [
                "BTC Reserve ($M)"
            ],
            120,
            0,
            100000
        )
    )

    result["netReserveM"] = (
        find_label_number(
            text,
            [
                "Net Reserve ($M)"
            ],
            120,
            0,
            100000
        )
    )

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

    candidates = re.findall(
        r"₿\s*"
        r"([0-9]{3}(?:,[0-9]{3})+)",
        text
    )

    if candidates:

        numbers = []

        for item in candidates:

            value = number_from_text(
                item
            )

            if value is None:
                continue

            if (
                100_000
                <=
                value
                <=
                2_000_000
            ):

                numbers.append(
                    int(value)
                )

        if numbers:

            result[
                "btcHoldings"
            ] = max(numbers)

    # -----------------------------------------------------
    # ADSO ('000)
    #
    # The first/current ledger row normally contains
    # the latest ADSO.
    # -----------------------------------------------------

    match = re.search(
        r"₿\s*"
        r"[0-9]{3}(?:,[0-9]{3})+"
        r".{0,300}?"
        r"([0-9]{3}(?:,\d{3})?)",
        text,
        re.I | re.S
    )

    if match:

        adso_raw = number_from_text(
            match.group(1)
        )

        if (
            adso_raw is not None
            and
            250_000
            <=
            adso_raw
            <=
            700_000
        ):

            result[
                "adso"
            ] = adso_raw / 1000.0

    return result


# =========================================================
# STRATEGY SHARES
#
# FDSO is based on:
#
# Basic shares
# + all options
# + all RSU/PSU
# + only ITM convertible instruments
# + only ITM STRK conversion shares
#
# This is consistent with Strategy's published definition.
# =========================================================

def get_strategy_shares_data(
    mstr_price=None
):

    html = fetch_page(
        STRATEGY_SHARES_URL
    )

    rows = extract_table_rows(
        html
    )

    result = {}

    # -----------------------------------------------------
    # Locate important rows
    # -----------------------------------------------------

    row_map = {}

    for row in rows:

        if not row:
            continue

        label = clean_text(
            row[0]
        ).lower()

        row_map[label] = row

    # -----------------------------------------------------
    # Helper:
    #
    # Find the most recent numeric value in a row.
    # The shares table's final historical column is the
    # latest reported date.
    # -----------------------------------------------------

    def latest_numeric(row):

        if not row:
            return None

        for cell in reversed(
            row[1:]
        ):

            value = number_from_text(
                cell
            )

            if value is not None:
                return value

        return None

    # -----------------------------------------------------
    # Basic Shares
    # -----------------------------------------------------

    basic_row = None

    for key, row in row_map.items():

        if (
            "basic shares outstanding"
            in key
        ):

            basic_row = row
            break

    if basic_row:

        result[
            "basicSharesM"
        ] = (
            latest_numeric(
                basic_row
            )
            / 1000.0
        )

    # -----------------------------------------------------
    # Options
    # -----------------------------------------------------

    options_row = None

    for key, row in row_map.items():

        if (
            "options outstanding"
            in key
        ):

            options_row = row
            break

    if options_row:

        result[
            "optionsM"
        ] = (
            latest_numeric(
                options_row
            )
            / 1000.0
        )

    # -----------------------------------------------------
    # RSU / PSU
    # -----------------------------------------------------

    rsu_row = None

    for key, row in row_map.items():

        if (
            "rsu/psu unvested"
            in key
        ):

            rsu_row = row
            break

    if rsu_row:

        result[
            "rsuM"
        ] = (
            latest_numeric(
                rsu_row
            )
            / 1000.0
        )

    # -----------------------------------------------------
    # Parse convertible rows
    # -----------------------------------------------------

    convertible_rows = []

    for key, row in row_map.items():

        if "convert shares" in key:

            match = re.search(
                r"@\s*\$?([\d,.]+)",
                row[0]
            )

            if not match:
                continue

            conversion_price = (
                number_from_text(
                    match.group(1)
                )
            )

            shares = (
                latest_numeric(
                    row
                )
            )

            if (
                conversion_price is None
                or
                shares is None
            ):

                continue

            convertible_rows.append(
                {
                    "conversionPrice":
                        conversion_price,
                    "sharesM":
                        shares / 1000.0,
                    "label":
                        row[0]
                }
            )

    # -----------------------------------------------------
    # STRK
    # -----------------------------------------------------

    strk_rows = []

    for key, row in row_map.items():

        if (
            "strk convert shares"
            in key
        ):

            match = re.search(
                r"@\s*\$?([\d,.]+)",
                row[0]
            )

            if not match:
                continue

            conversion_price = (
                number_from_text(
                    match.group(1)
                )
            )

            shares = (
                latest_numeric(
                    row
                )
            )

            if (
                conversion_price is None
                or
                shares is None
            ):
                continue

            strk_rows.append(
                {
                    "conversionPrice":
                        conversion_price,
                    "sharesM":
                        shares / 1000.0
                }
            )

    # -----------------------------------------------------
    # Calculate ITM conversion shares
    # -----------------------------------------------------

    itm_convert_m = 0.0

    if (
        mstr_price is not None
        and
        is_finite_number(
            mstr_price
        )
    ):

        for item in (
            convertible_rows
        ):

            if (
                mstr_price
                >=
                item[
                    "conversionPrice"
                ]
            ):

                itm_convert_m += (
                    item["sharesM"]
                )

        for item in strk_rows:

            if (
                mstr_price
                >=
                item[
                    "conversionPrice"
                ]
            ):

                itm_convert_m += (
                    item["sharesM"]
                )

    result[
        "itmConvertM"
    ] = itm_convert_m

    # -----------------------------------------------------
    # Direct ADSO / FDSO row
    #
    # If direct FDSO is available, use it.
    # Otherwise calculate.
    # -----------------------------------------------------

    diluted_row = None

    for key, row in row_map.items():

        if (
            "adso" in key
            and
            "fdso" in key
        ):

            diluted_row = row
            break

    if diluted_row:

        numeric_values = []

        for cell in diluted_row[1:]:

            value = number_from_text(
                cell
            )

            if value is not None:

                numeric_values.append(
                    value / 1000.0
                )

        if numeric_values:

            # Latest numeric value is normally ADSO.
            result[
                "adsoM"
            ] = numeric_values[-1]

    # -----------------------------------------------------
    # Calculated ADSO
    #
    # Basic + all convertibles + options + RSU/PSU
    # -----------------------------------------------------

    basic = result.get(
        "basicSharesM"
    )

    options = result.get(
        "optionsM"
    )

    rsu = result.get(
        "rsuM"
    )

    if basic is not None:

        calculated_adso = basic

        if options is not None:
            calculated_adso += options

        if rsu is not None:
            calculated_adso += rsu

        for item in (
            convertible_rows
        ):

            calculated_adso += (
                item["sharesM"]
            )

        for item in strk_rows:

            calculated_adso += (
                item["sharesM"]
            )

        result[
            "calculatedAdsoM"
        ] = calculated_adso

    # -----------------------------------------------------
    # Calculated FDSO
    # -----------------------------------------------------

    if basic is not None:

        calculated_fdso = basic

        if options is not None:
            calculated_fdso += options

        if rsu is not None:
            calculated_fdso += rsu

        calculated_fdso += (
            itm_convert_m
        )

        result[
            "calculatedFdsoM"
        ] = calculated_fdso

    return result


# =========================================================
# BUILD COMPANY DATA
# =========================================================

def get_strategy_capital_data(
    existing_data
):

    btc_page = {}
    home = {}
    ledger = {}
    shares = {}

    errors = []

    # -----------------------------------------------------
    # 1. Strategy BTC page
    # -----------------------------------------------------

    try:

        btc_page = (
            get_strategy_btc_data()
        )

    except Exception as error:

        errors.append(
            f"btc: {error}"
        )

        print(
            "WARNING: Strategy BTC page failed:",
            error
        )

    # -----------------------------------------------------
    # 2. Strategy home
    # -----------------------------------------------------

    try:

        home = (
            get_strategy_home_data()
        )

    except Exception as error:

        errors.append(
            f"home: {error}"
        )

        print(
            "WARNING: Strategy homepage failed:",
            error
        )

    # -----------------------------------------------------
    # 3. Merge direct Strategy metrics
    # -----------------------------------------------------

    combined = {
        **home,
        **btc_page
    }

    # -----------------------------------------------------
    # 4. MSTR price
    #
    # Strategy first.
    # Yahoo later if necessary.
    # -----------------------------------------------------

    strategy_price = (
        combined.get(
            "mstrPrice"
        )
    )

    if (
        strategy_price is None
        or
        not (
            20
            <=
            strategy_price
            <=
            1000
        )
    ):

        try:

            strategy_price = (
                get_mstr_price()
            )

        except Exception:

            strategy_price = None

    # -----------------------------------------------------
    # 5. Ledger
    # -----------------------------------------------------

    try:

        ledger = (
            get_strategy_ledger_data()
        )

    except Exception as error:

        errors.append(
            f"ledger: {error}"
        )

        print(
            "WARNING: Strategy ledger failed:",
            error
        )

    # -----------------------------------------------------
    # 6. Shares
    # -----------------------------------------------------

    try:

        shares = (
            get_strategy_shares_data(
                strategy_price
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
    # BTC holdings
    # -----------------------------------------------------

    btc_holdings = (
        combined.get(
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

    adso = (
        ledger.get(
            "adso"
        )
    )

    if adso is None:

        adso = (
            shares.get(
                "adsoM"
            )
        )

    # -----------------------------------------------------
    # FDSO
    # -----------------------------------------------------

    fdso = (
        shares.get(
            "calculatedFdsoM"
        )
    )

    if (
        fdso is None
        and
        isinstance(
            existing_data,
            dict
        )
    ):

        fdso = (
            existing_data.get(
                "fdso"
            )
        )

    # -----------------------------------------------------
    # Debt
    # -----------------------------------------------------

    debt_m = (
        home.get(
            "debtM"
        )
    )

    # -----------------------------------------------------
    # Preferred
    # -----------------------------------------------------

    pref_m = (
        home.get(
            "preferredM"
        )
    )

    # -----------------------------------------------------
    # USD Reserve + USD Cash
    # -----------------------------------------------------

    reserve_m = (
        home.get(
            "usdReserveM"
        )
    )

    cash_m = (
        home.get(
            "usdCashM"
        )
    )

    # -----------------------------------------------------
    # Existing fallbacks
    # -----------------------------------------------------

    if (
        debt_m is None
        and
        isinstance(
            existing_data,
            dict
        )
    ):

        old_debt = safe_float(
            existing_data.get(
                "debtUsdB"
            )
        )

        if old_debt is not None:

            debt_m = (
                old_debt
                *
                1000.0
            )

    if (
        pref_m is None
        and
        isinstance(
            existing_data,
            dict
        )
    ):

        old_pref = safe_float(
            existing_data.get(
                "preferredUsdB"
            )
        )

        if old_pref is not None:

            pref_m = (
                old_pref
                *
                1000.0
            )

    # -----------------------------------------------------
    # USD assets
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

    elif (
        isinstance(
            existing_data,
            dict
        )
    ):

        old_assets = safe_float(
            existing_data.get(
                "usdAssetsUsdB"
            )
        )

        if old_assets is not None:

            usd_assets_m = (
                old_assets
                *
                1000.0
            )

    # -----------------------------------------------------
    # Validation
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
            f"Invalid Strategy FDSO: {fdso}"
        )

    if (
        debt_m is None
        or
        not (
            0
            <=
            debt_m
            <=
            100_000
        )
    ):

        raise RuntimeError(
            "Strategy.com Debt unavailable"
        )

    if (
        pref_m is None
        or
        not (
            0
            <=
            pref_m
            <=
            100_000
        )
    ):

        raise RuntimeError(
            "Strategy.com Preferred unavailable"
        )

    if (
        usd_assets_m is None
        or
        not (
            0
            <=
            usd_assets_m
            <=
            100_000
        )
    ):

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
                debt_m / 1000.0,
                6
            ),

        "preferredUsdB":
            round(
                pref_m / 1000.0,
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
            combined.get(
                "mnav"
            ),

        "strategyNetBpsUsd":
            combined.get(
                "netBpsUsd"
            ),

        "strategyGrossBpsUsd":
            combined.get(
                "grossBpsUsd"
            ),

        "strategyMstrPrice":
            strategy_price,

        "strategyOpenInterestM":
            home.get(
                "openInterestM"
            ),

        "strategyBtcReserveM":
            combined.get(
                "btcReserveM"
            ),

        "strategyNetReserveM":
            combined.get(
                "netReserveM"
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

    filings = fetch_json(
        SEC_SUBMISSIONS_URL,
        headers=SEC_HEADERS
    )

    recent = (
        filings
        .get(
            "filings",
            {}
        )
        .get(
            "recent",
            {}
        )
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

    for i, form in enumerate(
        forms
    ):

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
                "SEC Form 8-K fallback",

            "asOf":
                (
                    dates[i]
                    if i < len(dates)
                    else existing_data.get(
                        "asOf"
                    )
                )
        }

    raise RuntimeError(
        "SEC Investor Briefing unavailable"
    )


# =========================================================
# NORMALIZE COMPANY DATA
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

    btc = safe_float(
        data.get(
            "btcHoldings"
        )
    )

    if (
        btc is not None
        and
        100_000
        <=
        btc
        <=
        2_000_000
    ):

        data[
            "btcHoldings"
        ] = int(
            round(
                btc
            )
        )

    else:

        data[
            "btcHoldings"
        ] = None

    # -----------------------------------------------------
    # ADSO
    # -----------------------------------------------------

    adso = safe_float(
        data.get(
            "adso"
        )
    )

    if adso is not None:

        if adso >= 100_000:

            adso /= 1_000_000

        elif adso >= 1000:

            adso /= 1000

        data[
            "adso"
        ] = adso

    else:

        data[
            "adso"
        ] = None

    # -----------------------------------------------------
    # FDSO
    #
    # M shares
    # -----------------------------------------------------

    fdso = safe_float(
        data.get(
            "fdso"
        )
    )

    if fdso is not None:

        if fdso >= 100_000_000:

            fdso /= 1_000_000

        elif fdso >= 100_000:

            fdso /= 1_000_000

        elif fdso >= 1000:

            fdso /= 1000

        data[
            "fdso"
        ] = fdso

    else:

        data[
            "fdso"
        ] = None

    # -----------------------------------------------------
    # USD fields
    # -----------------------------------------------------

    for key in (
        "usdAssetsUsdB",
        "debtUsdB",
        "preferredUsdB"
    ):

        value = safe_float(
            data.get(
                key
            )
        )

        data[key] = (
            value
            if value is not None
            else None
        )

    # -----------------------------------------------------
    # Range
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

        data[
            "fdso"
        ] = None

    if (
        data.get(
            "adso"
        ) is not None
        and
        not (
            250
            <=
            data["adso"]
            <=
            700
        )
    ):

        data[
            "adso"
        ] = None

    return data


# =========================================================
# UPDATE DATA.JSON
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

        latest = (
            get_sec_capital_data(
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
# BTC PRICE
# =========================================================

def get_btc_price():

    # -----------------------------------------------------
    # 1. CoinGecko
    # -----------------------------------------------------

    try:

        data = fetch_json(
            COINGECKO_URL
        )

        price = safe_float(
            data[
                "bitcoin"
            ][
                "usd"
            ]
        )

        if (
            price is not None
            and
            price > 0
        ):

            return price

    except Exception as error:

        print(
            "WARNING: CoinGecko BTC price:",
            error
        )

    # -----------------------------------------------------
    # 2. Binance
    # -----------------------------------------------------

    try:

        data = fetch_json(
            BINANCE_PRICE_URL
        )

        price = safe_float(
            data.get(
                "price"
            )
        )

        if (
            price is not None
            and
            price > 0
        ):

            return price

    except Exception as error:

        print(
            "WARNING: Binance BTC price:",
            error
        )

    # -----------------------------------------------------
    # 3. Yahoo
    # -----------------------------------------------------

    try:

        data = fetch_json(
            YAHOO_BTC_URL
        )

        result = (
            data
            .get("chart", {})
            .get("result", [])
        )

        if result:

            price = safe_float(
                result[0]
                .get("meta", {})
                .get(
                    "regularMarketPrice"
                )
            )

            if (
                price is not None
                and
                price > 0
            ):

                return price

    except Exception as error:

        print(
            "WARNING: Yahoo BTC price:",
            error
        )

    raise RuntimeError(
        "All BTC price sources failed"
    )


# =========================================================
# MSTR PRICE
# =========================================================

def get_mstr_price():

    data = fetch_json(
        YAHOO_MSTR_URL
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

    price = safe_float(
        result[0]
        .get("meta", {})
        .get(
            "regularMarketPrice"
        )
    )

    if (
        price is None
        or
        price <= 0
    ):

        raise RuntimeError(
            "Yahoo MSTR price unavailable"
        )

    return price


# =========================================================
# BINANCE
# =========================================================

def get_binance_oi():

    data = fetch_json(
        BINANCE_OI_URL
    )

    value = safe_float(
        data.get(
            "openInterest"
        )
    )

    if (
        value is None
        or
        value <= 0
    ):

        raise RuntimeError(
            "Invalid Binance OI"
        )

    return value


def get_binance_funding():

    data = fetch_json(
        BINANCE_FUNDING_URL
    )

    if not data:

        raise RuntimeError(
            "No Binance funding"
        )

    value = safe_float(
        data[0].get(
            "fundingRate"
        )
    )

    if value is None:

        raise RuntimeError(
            "Invalid Binance funding"
        )

    return value * 100.0


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

    oi = safe_float(
        row.get(
            "openInterestValue"
        )
    )

    funding = safe_float(
        row.get(
            "fundingRate"
        )
    )

    if (
        oi is None
        or
        oi <= 0
    ):

        raise RuntimeError(
            "Invalid Bybit OI"
        )

    if funding is None:

        raise RuntimeError(
            "Invalid Bybit funding"
        )

    return (
        oi,
        funding * 100.0
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

    value = safe_float(
        rows[0].get(
            "oiUsd"
        )
    )

    if (
        value is None
        or
        value <= 0
    ):

        raise RuntimeError(
            "Invalid OKX OI"
        )

    return value


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

    value = safe_float(
        rows[0].get(
            "fundingRate"
        )
    )

    if value is None:

        raise RuntimeError(
            "Invalid OKX funding"
        )

    return value * 100.0


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

    # -----------------------------------------------------
    # ADSO
    #
    # Gross BTC/share should use ADSO.
    # This matches Strategy's BPS methodology.
    # -----------------------------------------------------

    adso_m = safe_float(
        company.get(
            "adso"
        )
    )

    if (
        adso_m is None
        or
        not (
            250
            <=
            adso_m
            <=
            700
        )
    ):

        adso_m = fdso_m

    adso_shares = (
        adso_m
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

    btc_value = (
        holdings
        *
        btc_price
    )

    # -----------------------------------------------------
    # Gross BPS
    #
    # BTC Reserve / ADSO
    # -----------------------------------------------------

    gross_bps = (
        btc_value
        /
        adso_shares
    )

    # -----------------------------------------------------
    # Conservative calculated Net Reserve
    #
    # When all convertible instruments are OTM,
    # total debt + total preferred is a valid
    # conservative approximation.
    #
    # Strategy direct Net BPS is preferred whenever
    # available.
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
        adso_shares
    )

    if gross_bps <= 0:

        raise RuntimeError(
            "Gross BPS <= 0"
        )

    if net_bps <= 0:

        raise RuntimeError(
            "Calculated Net BPS <= 0"
        )

    calculated_mnav = (
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

    # -----------------------------------------------------
    # Strategy direct values
    # -----------------------------------------------------

    strategy_net_bps = safe_float(
        company.get(
            "strategyNetBpsUsd"
        )
    )

    strategy_mnav = safe_float(
        company.get(
            "strategyMnav"
        )
    )

    strategy_gross_bps = safe_float(
        company.get(
            "strategyGrossBpsUsd"
        )
    )

    # -----------------------------------------------------
    # Prefer official Strategy values.
    #
    # IMPORTANT:
    # NaN / infinity / absurd values are rejected.
    # -----------------------------------------------------

    if (
        strategy_net_bps is not None
        and
        1
        <
        strategy_net_bps
        <
        1000
    ):

        final_net_bps = (
            strategy_net_bps
        )

    else:

        final_net_bps = (
            net_bps
        )

    if (
        strategy_gross_bps is not None
        and
        1
        <
        strategy_gross_bps
        <
        1000
    ):

        final_gross_bps = (
            strategy_gross_bps
        )

    else:

        final_gross_bps = (
            gross_bps
        )

    if (
        strategy_mnav is not None
        and
        0.05
        <
        strategy_mnav
        <
        20
    ):

        final_mnav = (
            strategy_mnav
        )

    else:

        final_mnav = (
            mstr_price
            /
            final_net_bps
        )

    return {

        "btcValueUsd":
            btc_value,

        "netReserveUsd":
            net_reserve,

        "grossBpsUsd":
            final_gross_bps,

        "netBpsUsd":
            final_net_bps,

        "btcPerShare":
            btc_per_share,

        "mnav":
            final_mnav,

        "grossMnav":
            (
                mstr_price
                /
                final_gross_bps
            ),

        "calculatedGrossBpsUsd":
            gross_bps,

        "calculatedNetBpsUsd":
            net_bps,

        "calculatedMnav":
            calculated_mnav,

        "usedStrategyNetBps":
            (
                strategy_net_bps is not None
                and
                1
                <
                strategy_net_bps
                <
                1000
            ),

        "usedStrategyMnav":
            (
                strategy_mnav is not None
                and
                0.05
                <
                strategy_mnav
                <
                20
            )
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

    current = safe_float(
        current
    )

    previous = safe_float(
        previous
    )

    if (
        current is None
        or
        previous is None
        or
        previous == 0
    ):

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

    value = safe_float(
        item.get(
            "btcPerShare"
        )
    )

    if value is not None:

        if value > 1:

            value /= 1_000_000

        item[
            "btcPerShare"
        ] = value

    # -----------------------------------------------------
    # BPS
    # -----------------------------------------------------

    for key in (
        "grossBpsUsd",
        "netBpsUsd"
    ):

        value = safe_float(
            item.get(
                key
            )
        )

        if value is not None:

            if value > 1_000_000:

                value /= 1_000_000

            item[key] = value

    # -----------------------------------------------------
    # mNAV
    # -----------------------------------------------------

    mnav = safe_float(
        item.get(
            "mnav"
        )
    )

    net_bps = safe_float(
        item.get(
            "netBpsUsd"
        )
    )

    mstr = safe_float(
        item.get(
            "mstr"
        )
    )

    if (
        (
            mnav is None
            or
            mnav <= 0
        )
        and
        net_bps is not None
        and
        net_bps > 0
        and
        mstr is not None
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

    # -----------------------------------------------------
    # Gross mNAV
    # -----------------------------------------------------

    gross_mnav = safe_float(
        item.get(
            "grossMnav"
        )
    )

    gross_bps = safe_float(
        item.get(
            "grossBpsUsd"
        )
    )

    if (
        (
            gross_mnav is None
            or
            gross_mnav <= 0
        )
        and
        gross_bps is not None
        and
        gross_bps > 0
        and
        mstr is not None
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

    return item


# =========================================================
# mNAV PERCENTILE
# =========================================================

def calculate_mnav_percentile(
    current,
    history
):

    current = safe_float(
        current
    )

    if (
        current is None
        or
        current <= 0
    ):

        return None

    values = []

    for item in history:

        value = safe_float(
            item.get(
                "mnav"
            )
        )

        if (
            value is not None
            and
            value > 0
            and
            value < 100
        ):

            values.append(
                value
            )

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

    # -----------------------------------------------------
    # mNAV
    # -----------------------------------------------------

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

    # -----------------------------------------------------
    # Funding
    # -----------------------------------------------------

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

    # -----------------------------------------------------
    # OI 1D
    # -----------------------------------------------------

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

    # -----------------------------------------------------
    # OI 7D
    # -----------------------------------------------------

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

    # -----------------------------------------------------
    # BTC 7D
    # -----------------------------------------------------

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
        "MSTR Market History Update FINAL v11"
    )
    print(
        "======================================"
    )

    # -----------------------------------------------------
    # 1. COMPANY DATA
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

    btc_price = (
        get_btc_price()
    )

    strategy_price = safe_float(
        company.get(
            "strategyMstrPrice"
        )
    )

    if (
        strategy_price is not None
        and
        20
        <=
        strategy_price
        <=
        1000
    ):

        mstr_price = (
            strategy_price
        )

    else:

        mstr_price = (
            get_mstr_price()
        )

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
    # 7. AGGREGATE FUNDING
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
    # 9. CHANGES
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
    # 10. PERCENTILE
    # -----------------------------------------------------

    percentile = (
        calculate_mnav_percentile(
            result["mnav"],
            history
        )
    )

    # -----------------------------------------------------
    # 11. RISK
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
    # 12. DATE
    # -----------------------------------------------------

    now = datetime.now(
        timezone.utc
    )

    date_key = now.strftime(
        "%Y-%m-%d"
    )

    # -----------------------------------------------------
    # 13. RECORD
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
            ),

        "adso":
            company.get(
                "adso"
            ),

        "fdso":
            company.get(
                "fdso"
            ),

        "strategyMnav":
            company.get(
                "strategyMnav"
            ),

        "strategyNetBpsUsd":
            company.get(
                "strategyNetBpsUsd"
            ),

        "usedStrategyMnav":
            result.get(
                "usedStrategyMnav"
            ),

        "usedStrategyNetBps":
            result.get(
                "usedStrategyNetBps"
            )
    }

    # -----------------------------------------------------
    # 14. REPLACE TODAY
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
    # 15. SORT
    # -----------------------------------------------------

    history.sort(
        key=lambda item:
        item.get(
            "date",
            ""
        )
    )

    # -----------------------------------------------------
    # 16. SAVE
    # -----------------------------------------------------

    save_json(
        HISTORY_FILE,
        history
    )

    # -----------------------------------------------------
    # 17. FINAL CHECK
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
        "Strategy direct mNAV:",
        company.get(
            "strategyMnav"
        )
    )

    print(
        "Strategy direct Net BPS:",
        company.get(
            "strategyNetBpsUsd"
        )
    )

    print(
        "Used Strategy mNAV:",
        result[
            "usedStrategyMnav"
        ]
    )

    print(
        "Used Strategy Net BPS:",
        result[
            "usedStrategyNetBps"
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
