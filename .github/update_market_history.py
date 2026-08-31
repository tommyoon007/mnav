import json
import re
from datetime import datetime, timezone, timedelta
from html import unescape
from html.parser import HTMLParser
from pathlib import Path

import requests


# =========================================================
# MSTR HISTORY UPDATE
# Version 10
#
# DATA SOURCE PRIORITY
#
# 1. Strategy.com
# 2. SEC
# 3. Existing data.json
#
# IMPORTANT INTERNAL UNITS
#
# btcHoldings       = BTC
# fdso              = actual number of shares
# usdAssetsUsdB     = USD billions
# debtUsdB          = USD billions
# preferredUsdB     = USD billions
# btcPerShare       = BTC/share
# grossBpsUsd       = USD/share
# netBpsUsd         = USD/share
# mnav              = multiple
# fundingRate       = percentage
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
STRATEGY_SHARES_URL = "https://www.strategy.com/shares"


# =========================================================
# SEC FALLBACK
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
# SESSION
# =========================================================

SESSION = requests.Session()

SESSION.headers.update(
    HEADERS
)


# =========================================================
# HTML PARSER
# =========================================================

class TableParser(HTMLParser):

    def __init__(self):

        super().__init__(
            convert_charrefs=True
        )

        self.rows = []
        self.current_row = None
        self.current_cell = None
        self.current_text = []

    def handle_starttag(
        self,
        tag,
        attrs
    ):

        tag = tag.lower()

        if tag == "tr":

            self.current_row = []
            self.current_cell = None

        elif tag in (
            "td",
            "th"
        ):

            if self.current_row is None:

                self.current_row = []

            self.current_cell = []
            self.current_text = []

    def handle_data(
        self,
        data
    ):

        if self.current_cell is not None:

            self.current_text.append(
                data
            )

    def handle_endtag(
        self,
        tag
    ):

        tag = tag.lower()

        if tag in (
            "td",
            "th"
        ):

            if self.current_row is not None:

                text = " ".join(
                    self.current_text
                )

                text = clean_text(
                    text
                )

                self.current_row.append(
                    text
                )

            self.current_cell = None
            self.current_text = []

        elif tag == "tr":

            if (
                self.current_row
                and
                any(
                    self.current_row
                )
            ):

                self.rows.append(
                    self.current_row
                )

            self.current_row = None


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
# NUMBER HELPERS
# =========================================================

def normalize_number(
    value
):

    if value is None:

        return None

    text = clean_text(
        value
    )

    text = (
        text
        .replace(",", "")
        .replace("$", "")
        .replace("₿", "")
        .replace("%", "")
        .replace("x", "")
        .strip()
    )

    try:

        return float(
            text
        )

    except Exception:

        return None


def parse_money_millions(
    value
):

    if value is None:

        return None

    text = clean_text(
        value
    )

    text = (
        text
        .replace(",", "")
        .replace("$", "")
        .strip()
    )

    multiplier = 1.0

    if re.search(
        r"\bB\b|billion",
        text,
        re.I
    ):

        multiplier = 1000.0

    number = re.search(
        r"-?\d+(?:\.\d+)?",
        text
    )

    if not number:

        return None

    try:

        return (
            float(
                number.group(0)
            )
            *
            multiplier
        )

    except Exception:

        return None


def first_number(
    text
):

    if not text:

        return None

    match = re.search(
        r"-?\d+(?:,\d{3})*(?:\.\d+)?",
        text
    )

    if not match:

        return None

    return normalize_number(
        match.group(0)
    )


# =========================================================
# HTTP
# =========================================================

def get_response(
    url,
    headers=None
):

    response = SESSION.get(
        url,
        headers=headers,
        timeout=TIMEOUT
    )

    response.raise_for_status()

    return response


def get_json(
    url
):

    response = get_response(
        url
    )

    return response.json()


# =========================================================
# STRATEGY.COM FETCH
# =========================================================

def get_strategy_page(
    url
):

    response = get_response(
        url,
        headers=HEADERS
    )

    return response.text


# =========================================================
# FIND LABEL VALUE
# =========================================================

def find_label_value(
    text,
    label,
    window=500
):

    if not text:

        return None

    pattern = (
        re.escape(label)
        +
        r".{0,"
        +
        str(window)
        +
        r"}?"
        r"(\$?\s*-?"
        r"\d+(?:,\d{3})*"
        r"(?:\.\d+)?)"
    )

    match = re.search(
        pattern,
        text,
        re.I | re.S
    )

    if not match:

        return None

    return first_number(
        match.group(1)
    )


# =========================================================
# STRATEGY METRICS
# =========================================================

def parse_strategy_metrics(
    html
):

    text = html_to_text(
        html
    )

    result = {}

    # -----------------------------------------------------
    # MSTR PRICE
    # -----------------------------------------------------

    result["mstrPrice"] = (
        find_label_value(
            text,
            "MSTR Price"
        )
    )

    # -----------------------------------------------------
    # DEBT
    # -----------------------------------------------------

    result["debtM"] = (
        find_label_value(
            text,
            "Debt ($M)"
        )
    )

    if result["debtM"] is None:

        result["debtM"] = (
            find_label_value(
                text,
                "Debt"
            )
        )

    # -----------------------------------------------------
    # PREFERRED
    # -----------------------------------------------------

    result["preferredM"] = (
        find_label_value(
            text,
            "Pref ($M)"
        )
    )

    if result["preferredM"] is None:

        result["preferredM"] = (
            find_label_value(
                text,
                "Pref"
            )
        )

    # -----------------------------------------------------
    # USD RESERVE
    # -----------------------------------------------------

    result["usdReserveM"] = (
        find_label_value(
            text,
            "USD Reserve ($M)"
        )
    )

    if result["usdReserveM"] is None:

        result["usdReserveM"] = (
            find_label_value(
                text,
                "USD Reserve"
            )
        )

    # -----------------------------------------------------
    # USD CASH
    # -----------------------------------------------------

    result["usdCashM"] = (
        find_label_value(
            text,
            "USD Cash ($M)"
        )
    )

    if result["usdCashM"] is None:

        result["usdCashM"] = (
            find_label_value(
                text,
                "USD Cash"
            )
        )

    # -----------------------------------------------------
    # OPEN INTEREST
    # -----------------------------------------------------

    result["strategyOiM"] = (
        find_label_value(
            text,
            "Open Interest ($M)"
        )
    )

    # -----------------------------------------------------
    # STRATEGY BTC
    # -----------------------------------------------------

    btc_match = re.search(
        r"\bBTC\b.{0,1000}?"
        r"[₿]?\s*"
        r"([0-9]{3}(?:,[0-9]{3})+)",
        text,
        re.I | re.S
    )

    if btc_match:

        result["btcHoldings"] = int(
            first_number(
                btc_match.group(1)
            )
        )

    # -----------------------------------------------------
    # NET BTC PER SHARE
    # -----------------------------------------------------

    result["netBpsDirect"] = (
        find_label_value(
            text,
            "Net BTC Per Share ($)"
        )
    )

    # -----------------------------------------------------
    # GROSS BTC PER SHARE
    # -----------------------------------------------------

    result["grossBpsDirect"] = (
        find_label_value(
            text,
            "BTC Per Share ($)"
        )
    )

    # -----------------------------------------------------
    # mNAV
    # -----------------------------------------------------

    result["mnavDirect"] = (
        find_label_value(
            text,
            "mNAV"
        )
    )

    # -----------------------------------------------------
    # NET RESERVE
    # -----------------------------------------------------

    result["netReserveM"] = (
        find_label_value(
            text,
            "Net Reserve ($M)"
        )
    )

    # -----------------------------------------------------
    # RESERVE
    # -----------------------------------------------------

    result["reserveM"] = (
        find_label_value(
            text,
            "Reserve ($M)"
        )
    )

    return result


# =========================================================
# STRATEGY SHARES TABLE
# =========================================================

def parse_strategy_shares(
    html
):

    parser = TableParser()

    parser.feed(
        html
    )

    rows = parser.rows

    data = {}

    for row in rows:

        if not row:

            continue

        label = clean_text(
            row[0]
        )

        if not label:

            continue

        data[
            label
        ] = row[1:]

    return data


# =========================================================
# PARSE SHARE COUNT
# =========================================================

def parse_shares_value(
    row,
    index=-1
):

    if not row:

        return None

    values = []

    for value in row:

        number = first_number(
            value
        )

        if number is not None:

            values.append(
                number
            )

    if not values:

        return None

    try:

        return values[index]

    except Exception:

        return None


# =========================================================
# GET FDSO FROM STRATEGY SHARES PAGE
#
# Strategy's FDSO definition:
#
# Basic shares
# + stock options
# + RSU/PSU
# + in-the-money convertibles
# + in-the-money STRK
#
# The Strategy Shares page provides the underlying
# historical rows.
# =========================================================

def get_strategy_fdso(
    mstr_price
):

    html = get_strategy_page(
        STRATEGY_SHARES_URL
    )

    rows = parse_strategy_shares(
        html
    )

    # -----------------------------------------------------
    # BASIC SHARES
    # -----------------------------------------------------

    basic = parse_shares_value(
        rows.get(
            "Basic Shares Outstanding"
        )
    )

    # -----------------------------------------------------
    # OPTIONS
    # -----------------------------------------------------

    options = parse_shares_value(
        rows.get(
            "Options Outstanding"
        )
    )

    # -----------------------------------------------------
    # RSU / PSU
    # -----------------------------------------------------

    rsu = parse_shares_value(
        rows.get(
            "RSU/PSU Unvested"
        )
    )

    if basic is None:

        raise RuntimeError(
            "Strategy Shares page: "
            "Basic Shares Outstanding not found"
        )

    if options is None:

        options = 0.0

    if rsu is None:

        rsu = 0.0

    # -----------------------------------------------------
    # CONVERTIBLE NOTES
    #
    # We inspect rows such as:
    #
    # 2028 Convert Shares @$183.19
    # 2029 Convert Shares @$672.40
    # 2030 A Convert Shares @$149.77
    #
    # Only in-the-money convertibles are included
    # in FDSO.
    # -----------------------------------------------------

    convertible_shares = 0.0

    for label, values in rows.items():

        if (
            "Convert Shares @" not
            in label
        ):

            continue

        price_match = re.search(
            r"@\s*\$?\s*"
            r"([0-9]+(?:\.[0-9]+)?)",
            label
        )

        if not price_match:

            continue

        conversion_price = float(
            price_match.group(1)
        )

        shares = parse_shares_value(
            values
        )

        if shares is None:

            continue

        if (
            mstr_price is not None
            and
            mstr_price >= conversion_price
        ):

            convertible_shares += (
                shares
            )

    # -----------------------------------------------------
    # STRK
    # -----------------------------------------------------

    strk_shares = 0.0

    for label, values in rows.items():

        if (
            "STRK Convert Shares @"
            not in label
        ):

            continue

        price_match = re.search(
            r"@\s*\$?\s*"
            r"([0-9]+(?:\.[0-9]+)?)",
            label
        )

        if not price_match:

            continue

        conversion_price = float(
            price_match.group(1)
        )

        shares = parse_shares_value(
            values
        )

        if shares is None:

            continue

        if (
            mstr_price is not None
            and
            mstr_price >= conversion_price
        ):

            strk_shares += (
                shares
            )

    # -----------------------------------------------------
    # TOTAL FDSO
    #
    # Values in the Strategy Shares table are
    # expressed in thousands.
    #
    # Therefore:
    #
    # 419,900
    # ->
    # 419,900,000 shares
    # -----------------------------------------------------

    fdso_thousands = (
        basic
        +
        options
        +
        rsu
        +
        convertible_shares
        +
        strk_shares
    )

    fdso = (
        fdso_thousands
        *
        1000
    )

    if not (
        100_000_000
        <=
        fdso
        <=
        1_000_000_000
    ):

        raise RuntimeError(
            f"Suspicious Strategy FDSO: "
            f"{fdso}"
        )

    return int(
        round(
            fdso
        )
    )


# =========================================================
# STRATEGY CAPITAL DATA
# =========================================================

def get_strategy_capital_data():

    errors = []

    # -----------------------------------------------------
    # HOME PAGE
    # -----------------------------------------------------

    metrics = {}

    try:

        html = get_strategy_page(
            STRATEGY_HOME_URL
        )

        metrics = parse_strategy_metrics(
            html
        )

        print(
            "Strategy.com metrics loaded."
        )

    except Exception as error:

        errors.append(
            f"Strategy homepage: {error}"
        )

        print(
            "WARNING: Strategy.com homepage "
            "failed:",
            error
        )

    # -----------------------------------------------------
    # BTC PAGE
    # -----------------------------------------------------

    btc_page_metrics = {}

    try:

        html = get_strategy_page(
            STRATEGY_BTC_URL
        )

        btc_page_metrics = (
            parse_strategy_metrics(
                html
            )
        )

        print(
            "Strategy.com BTC page loaded."
        )

    except Exception as error:

        errors.append(
            f"Strategy BTC page: {error}"
        )

        print(
            "WARNING: Strategy.com BTC page "
            "failed:",
            error
        )

    # -----------------------------------------------------
    # MERGE
    # -----------------------------------------------------

    merged = {}

    merged.update(
        metrics
    )

    for key, value in (
        btc_page_metrics.items()
    ):

        if (
            value is not None
            and
            merged.get(key) is None
        ):

            merged[key] = value

    # -----------------------------------------------------
    # MSTR PRICE
    # -----------------------------------------------------

    mstr_price = (
        merged.get(
            "mstrPrice"
        )
    )

    # -----------------------------------------------------
    # BTC HOLDINGS
    # -----------------------------------------------------

    btc_holdings = (
        merged.get(
            "btcHoldings"
        )
    )

    # -----------------------------------------------------
    # FDSO
    # -----------------------------------------------------

    fdso = None

    try:

        fdso = get_strategy_fdso(
            mstr_price
        )

        print(
            "Strategy FDSO calculated:",
            fdso
        )

    except Exception as error:

        errors.append(
            f"Strategy shares: {error}"
        )

        print(
            "WARNING: Strategy FDSO failed:",
            error
        )

    # -----------------------------------------------------
    # DEBT
    # -----------------------------------------------------

    debt_m = (
        merged.get(
            "debtM"
        )
    )

    # -----------------------------------------------------
    # PREFERRED
    # -----------------------------------------------------

    preferred_m = (
        merged.get(
            "preferredM"
        )
    )

    # -----------------------------------------------------
    # USD RESERVE
    # -----------------------------------------------------

    usd_reserve_m = (
        merged.get(
            "usdReserveM"
        )
    )

    # -----------------------------------------------------
    # USD CASH
    # -----------------------------------------------------

    usd_cash_m = (
        merged.get(
            "usdCashM"
        )
    )

    # -----------------------------------------------------
    # USD ASSETS
    # -----------------------------------------------------

    usd_assets_m = None

    if (
        usd_reserve_m is not None
        and
        usd_cash_m is not None
    ):

        usd_assets_m = (
            usd_reserve_m
            +
            usd_cash_m
        )

    # -----------------------------------------------------
    # STRATEGY DIRECT NET BPS
    # -----------------------------------------------------

    net_bps_direct = (
        merged.get(
            "netBpsDirect"
        )
    )

    # -----------------------------------------------------
    # DIRECT BTC RESERVE
    # -----------------------------------------------------

    reserve_m = (
        merged.get(
            "reserveM"
        )
    )

    # -----------------------------------------------------
    # VALIDATE
    # -----------------------------------------------------

    missing = []

    if btc_holdings is None:

        missing.append(
            "BTC holdings"
        )

    if debt_m is None:

        missing.append(
            "Debt"
        )

    if preferred_m is None:

        missing.append(
            "Preferred"
        )

    if usd_assets_m is None:

        missing.append(
            "USD Assets"
        )

    if fdso is None:

        missing.append(
            "FDSO"
        )

    # -----------------------------------------------------
    # FAILURE
    # -----------------------------------------------------

    if missing:

        raise RuntimeError(
            "Strategy.com missing: "
            +
            ", ".join(
                missing
            )
            +
            " | "
            +
            "; ".join(
                errors
            )
        )

    # -----------------------------------------------------
    # DATE
    # -----------------------------------------------------

    as_of = (
        datetime.now(
            timezone.utc
        ).strftime(
            "%Y-%m-%d"
        )
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
                preferred_m / 1000.0,
                6
            ),

        "fdso":
            int(
                fdso
            ),

        "source":
            "Strategy.com",

        "asOf":
            as_of,

        "strategyMstrPrice":
            mstr_price,

        "strategyNetBpsUsd":
            net_bps_direct,

        "strategyReserveUsdB":
            (
                reserve_m / 1000.0
                if reserve_m is not None
                else None
            )
    }


# =========================================================
# SEC FALLBACK
# =========================================================

def sec_get_text(
    url
):

    response = requests.get(
        url,
        headers=SEC_HEADERS,
        timeout=TIMEOUT
    )

    response.raise_for_status()

    return response.text


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

    accessions = recent.get(
        "accessionNumber",
        []
    )

    documents = recent.get(
        "primaryDocument",
        []
    )

    filing_dates = recent.get(
        "filingDate",
        []
    )

    results = []

    for i, form in enumerate(
        forms
    ):

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

        results.append({

            "accession":
                accessions[i],

            "document":
                documents[i],

            "filingDate":
                (
                    filing_dates[i]
                    if i < len(
                        filing_dates
                    )
                    else None
                )
        })

    return results


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

    url = (
        SEC_ARCHIVES_URL
        +
        accession_clean
        +
        "/"
        +
        document
    )

    return sec_get_text(
        url
    )


def get_sec_capital_data():

    filings = (
        get_latest_8k_filings()
    )

    for filing in filings[:20]:

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

        text = html_to_text(
            html
        )

        if (
            "INVESTOR BRIEFING"
            not in text.upper()
        ):

            continue

        # -------------------------------------------------
        # BTC
        # -------------------------------------------------

        btc = None

        patterns = [

            r"BTC\s+holdings.{0,300}?"
            r"([0-9]{3}(?:,[0-9]{3})+)",

            r"Aggregate\s+BTC\s+Holdings.{0,300}?"
            r"([0-9]{3}(?:,[0-9]{3})+)",

            r"([0-9]{3}(?:,[0-9]{3})+)"
            r"\s+BTC"
        ]

        for pattern in patterns:

            match = re.search(
                pattern,
                text,
                re.I | re.S
            )

            if match:

                btc = first_number(
                    match.group(1)
                )

                break

        # -------------------------------------------------
        # MONEY
        # -------------------------------------------------

        def money(
            label
        ):

            value = find_label_value(
                text,
                label,
                250
            )

            if value is None:

                return None

            return value

        debt_m = money(
            "Debt"
        )

        preferred_m = money(
            "Preferred stock"
        )

        usd_reserve_m = money(
            "USD Reserve"
        )

        usd_cash_m = money(
            "USD Cash"
        )

        # -------------------------------------------------
        # USD ASSETS
        # -------------------------------------------------

        usd_assets_m = None

        if (
            usd_reserve_m is not None
            and
            usd_cash_m is not None
        ):

            usd_assets_m = (
                usd_reserve_m
                +
                usd_cash_m
            )

        # -------------------------------------------------
        # FDSO
        # -------------------------------------------------

        fdso_match = re.search(
            r"([0-9]+(?:\.[0-9]+)?)"
            r"\s*M"
            r".{0,80}?"
            r"(?:FDSO|Fully Diluted)",
            text,
            re.I | re.S
        )

        fdso = None

        if fdso_match:

            fdso = (
                first_number(
                    fdso_match.group(1)
                )
                *
                1_000_000
            )

        # -------------------------------------------------
        # VALIDATE
        # -------------------------------------------------

        if (
            btc is None
            or
            debt_m is None
            or
            preferred_m is None
            or
            usd_assets_m is None
            or
            fdso is None
        ):

            continue

        return {

            "btcHoldings":
                int(
                    round(
                        btc
                    )
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
                    preferred_m / 1000.0,
                    6
                ),

            "fdso":
                int(
                    round(
                        fdso
                    )
                ),

            "source":
                "SEC Form 8-K",

            "asOf":
                filing.get(
                    "filingDate"
                )
        }

    raise RuntimeError(
        "SEC Investor Briefing unavailable"
    )


# =========================================================
# VALIDATE / REPAIR CAPITAL DATA
# =========================================================

def normalize_company_data(
    data
):

    if not isinstance(
        data,
        dict
    ):

        return {}

    data = dict(
        data
    )

    # -----------------------------------------------------
    # FDSO
    #
    # Broken:
    # 419.9
    #
    # Correct:
    # 419,900,000
    # -----------------------------------------------------

    fdso = data.get(
        "fdso"
    )

    try:

        fdso = float(
            fdso
        )

        if (
            100
            <=
            fdso
            <
            1_000_000
        ):

            fdso *= 1_000_000

        data["fdso"] = int(
            round(
                fdso
            )
        )

    except Exception:

        pass

    # -----------------------------------------------------
    # VALID FDSO RANGE
    # -----------------------------------------------------

    if (
        not isinstance(
            data.get(
                "fdso"
            ),
            int
        )
        or
        not (
            100_000_000
            <=
            data["fdso"]
            <=
            1_000_000_000
        )
    ):

        data["fdso"] = None

    return data


# =========================================================
# UPDATE DATA.JSON
# =========================================================

def update_data_json():

    old_data = load_json(
        DATA_FILE,
        {}
    )

    old_data = normalize_company_data(
        old_data
    )

    # -----------------------------------------------------
    # 1. STRATEGY.COM
    # -----------------------------------------------------

    try:

        latest = (
            get_strategy_capital_data()
        )

        latest = normalize_company_data(
            latest
        )

        old_data.update(
            latest
        )

        save_json(
            DATA_FILE,
            old_data
        )

        print(
            "======================================"
        )

        print(
            "PRIMARY SOURCE: Strategy.com"
        )

        print(
            "BTC holdings:",
            old_data.get(
                "btcHoldings"
            )
        )

        print(
            "USD assets:",
            old_data.get(
                "usdAssetsUsdB"
            ),
            "B"
        )

        print(
            "Debt:",
            old_data.get(
                "debtUsdB"
            ),
            "B"
        )

        print(
            "Preferred:",
            old_data.get(
                "preferredUsdB"
            ),
            "B"
        )

        print(
            "FDSO:",
            old_data.get(
                "fdso"
            )
        )

        print(
            "Source:",
            old_data.get(
                "source"
            )
        )

        print(
            "======================================"
        )

        return old_data

    except Exception as error:

        print(
            "WARNING: Strategy.com update failed:",
            error
        )

    # -----------------------------------------------------
    # 2. SEC
    # -----------------------------------------------------

    try:

        latest = (
            get_sec_capital_data()
        )

        latest = normalize_company_data(
            latest
        )

        old_data.update(
            latest
        )

        save_json(
            DATA_FILE,
            old_data
        )

        print(
            "SEC fallback succeeded."
        )

        return old_data

    except Exception as error:

        print(
            "WARNING: SEC fallback failed:",
            error
        )

    # -----------------------------------------------------
    # 3. EXISTING DATA
    # -----------------------------------------------------

    old_data = normalize_company_data(
        old_data
    )

    required = [
        "btcHoldings",
        "usdAssetsUsdB",
        "debtUsdB",
        "preferredUsdB",
        "fdso"
    ]

    missing = [
        key
        for key in required
        if old_data.get(
            key
        ) is None
    ]

    if missing:

        raise RuntimeError(
            "No valid capital data available. "
            "Missing: "
            +
            ", ".join(
                missing
            )
        )

    print(
        "WARNING: Using existing data.json."
    )

    save_json(
        DATA_FILE,
        old_data
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

        raise RuntimeError(
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
        .get("result", [])
    )

    if not result:

        raise RuntimeError(
            "Yahoo returned no MSTR data"
        )

    meta = result[0].get(
        "meta",
        {}
    )

    price = meta.get(
        "regularMarketPrice"
    )

    if price is None:

        raise RuntimeError(
            "Yahoo MSTR price missing"
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

    data = get_json(
        BINANCE_OI_URL
    )

    return float(
        data["openInterest"]
    )


def get_binance_funding():

    data = get_json(
        BINANCE_FUNDING_URL
    )

    if not data:

        raise RuntimeError(
            "No Binance funding"
        )

    return (
        float(
            data[0]["fundingRate"]
        )
        *
        100.0
    )


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

        raise RuntimeError(
            "No Bybit data"
        )

    row = rows[0]

    oi_usd = float(
        row["openInterestValue"]
    )

    funding = (
        float(
            row["fundingRate"]
        )
        *
        100.0
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

        raise RuntimeError(
            "No OKX OI"
        )

    return float(
        rows[0]["oiUsd"]
    )


def get_okx_funding():

    data = get_json(
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
            rows[0]["fundingRate"]
        )
        *
        100.0
    )


# =========================================================
# mNAV
# =========================================================

def calculate_mnav(
    btc_price,
    mstr_price,
    company
):

    btc_holdings = float(
        company["btcHoldings"]
    )

    fdso = float(
        company["fdso"]
    )

    usd_assets = (
        float(
            company["usdAssetsUsdB"]
        )
        *
        1_000_000_000
    )

    debt = (
        float(
            company["debtUsdB"]
        )
        *
        1_000_000_000
    )

    preferred = (
        float(
            company["preferredUsdB"]
        )
        *
        1_000_000_000
    )

    # -----------------------------------------------------
    # BTC RESERVE
    # -----------------------------------------------------

    btc_value = (
        btc_holdings
        *
        btc_price
    )

    # -----------------------------------------------------
    # GROSS BPS
    # -----------------------------------------------------

    gross_bps = (
        btc_value
        /
        fdso
    )

    # -----------------------------------------------------
    # NET RESERVE
    #
    # Strategy methodology:
    #
    # BTC Reserve
    # - Debt
    # - Preferred
    # + USD Assets
    # -----------------------------------------------------

    net_reserve = (
        btc_value
        -
        debt
        -
        preferred
        +
        usd_assets
    )

    # -----------------------------------------------------
    # NET BPS
    # -----------------------------------------------------

    net_bps = (
        net_reserve
        /
        fdso
    )

    # -----------------------------------------------------
    # BTC / SHARE
    # -----------------------------------------------------

    btc_per_share = (
        btc_holdings
        /
        fdso
    )

    # -----------------------------------------------------
    # mNAV
    # -----------------------------------------------------

    if net_bps > 0:

        mnav = (
            mstr_price
            /
            net_bps
        )

    else:

        mnav = None

    if gross_bps > 0:

        gross_mnav = (
            mstr_price
            /
            gross_bps
        )

    else:

        gross_mnav = None

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
        if (
            isinstance(
                item,
                dict
            )
            and
            item.get(
                "date",
                ""
            )
            <=
            target_key
        )
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

def normalize_history_record(
    item
):

    if not isinstance(
        item,
        dict
    ):

        return item

    item = dict(
        item
    )

    # -----------------------------------------------------
    # Broken BTC/share
    #
    # 2001.5408
    # ->
    # 0.00200154
    # -----------------------------------------------------

    try:

        value = float(
            item.get(
                "btcPerShare"
            )
        )

        if value > 1:

            item[
                "btcPerShare"
            ] = (
                value
                /
                1_000_000
            )

    except Exception:

        pass

    # -----------------------------------------------------
    # Broken BPS
    #
    # 155,641,817
    # ->
    # 155.64
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

                item[key] = (
                    value
                    /
                    1_000_000
                )

        except Exception:

            pass

    # -----------------------------------------------------
    # Broken mNAV
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

            item["mnav"] = (
                mstr
                /
                net_bps
            )

    except Exception:

        pass

    # -----------------------------------------------------
    # Broken gross mNAV
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

            item["grossMnav"] = (
                mstr
                /
                gross_bps
            )

    except Exception:

        pass

    # -----------------------------------------------------
    # Remove impossible -100% caused by broken mNAV
    # -----------------------------------------------------

    if (
        item.get(
            "mnavChange1dPct"
        )
        ==
        -100.0
    ):

        item[
            "mnavChange1dPct"
        ] = None

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
        "MSTR Market History Update v10"
    )

    print(
        "======================================"
    )

    # -----------------------------------------------------
    # 1. CAPITAL DATA
    # -----------------------------------------------------

    company = (
        update_data_json()
    )

    company = normalize_company_data(
        company
    )

    required = [
        "btcHoldings",
        "usdAssetsUsdB",
        "debtUsdB",
        "preferredUsdB",
        "fdso"
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
            "Invalid capital data. "
            "Missing: "
            +
            ", ".join(
                missing
            )
        )

    # -----------------------------------------------------
    # 2. MARKET
    # -----------------------------------------------------

    btc_price = (
        get_btc_price()
    )

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

    if (
        result["netBpsUsd"]
        is None
        or
        result["netBpsUsd"]
        <= 0
    ):

        raise RuntimeError(
            "Net BPS is zero or negative. "
            "mNAV cannot be calculated."
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
        normalize_history_record(
            item
        )
        for item in history
        if isinstance(
            item,
            dict
        )
    ]

    # -----------------------------------------------------
    # 5. OI
    # -----------------------------------------------------

    oi_values = []
    funding_values = []

    # -----------------------------------------------------
    # BINANCE
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
    # BYBIT
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

        okx_oi = (
            get_okx_oi()
        )

        if okx_oi > 0:

            oi_values.append(
                (
                    "OKX",
                    okx_oi
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
                        okx_oi
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
    # 9. CHANGES
    # -----------------------------------------------------

    oi_change_1d = None
    oi_change_7d = None

    btc_change_1d = None
    btc_change_7d = None

    mnav_change_1d = None
    mnav_change_7d = None

    btc_yield_1d = None
    btc_yield_7d = None

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

    # -----------------------------------------------------
    # 10. PERCENTILE
    # -----------------------------------------------------

    mnav_percentile = (
        calculate_mnav_percentile(
            result["mnav"],
            history
        )
    )

    # -----------------------------------------------------
    # 11. RISK
    # -----------------------------------------------------

    risk_score, risk_level = (
        calculate_risk_score(
            mnav_percentile,
            aggregate_funding,
            oi_change_1d,
            oi_change_7d,
            btc_change_7d
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
            ),

        "capitalDataSource":
            company.get(
                "source"
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
    # 17. CONSOLE
    # -----------------------------------------------------

    print()
    print(
        "======================================"
    )

    print(
        "MSTR HISTORY UPDATE COMPLETE"
    )

    print(
        "======================================"
    )

    print(
        "Capital source:",
        company.get(
            "source"
        )
    )

    print(
        "BTC holdings:",
        company.get(
            "btcHoldings"
        )
    )

    print(
        "FDSO:",
        company.get(
            "fdso"
        )
    )

    print(
        "USD assets:",
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
        "BTC/share:",
        result["btcPerShare"]
    )

    print(
        "mNAV:",
        result["mnav"]
    )

    print(
        "Gross mNAV:",
        result["grossMnav"]
    )

    print(
        "OI BTC:",
        aggregate_oi_btc
    )

    print(
        "OI USD:",
        aggregate_oi_usd
    )

    print(
        "Funding:",
        aggregate_funding
    )

    print(
        "mNAV percentile:",
        mnav_percentile
    )

    print(
        "Risk score:",
        risk_score
    )

    print(
        "Risk level:",
        risk_level
    )

    print(
        "History records:",
        len(history)
    )

    print(
        "======================================"
    )


if __name__ == "__main__":

    main()
