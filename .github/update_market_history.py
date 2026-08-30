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
        "tommyoon007-mnav-history/7.0 "
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

def get_response(url, headers=None):

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
# SEC
# =========================================================

def sec_get_text(url):

    response = requests.get(
        url,
        headers=HEADERS,
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


def find_number(patterns, text):

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
# SEC SUBMISSIONS
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

            link = (
                link
                .split("#")[0]
            )

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
# SEC TEXT CLEANUP
# =========================================================

def clean_sec_text(html):

    text = re.sub(
        r"<[^>]+>",
        " ",
        html
    )

    text = (
        text
        .replace("&nbsp;", " ")
        .replace("&#160;", " ")
        .replace("&amp;", "&")
    )

    text = re.sub(
        r"\s+",
        " ",
        text
    )

    return text


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

    text = clean_sec_text(
        html
    )


    # =====================================================
    # BTC HOLDINGS
    # =====================================================

    btc_holdings = find_number(
        [

            r"BTC holdings.*?"
            r"([0-9]{3,3}(?:,[0-9]{3})+)"
            r"\s*BTC",

            r"Aggregate BTC Holdings.*?"
            r"([0-9]{3,3}(?:,[0-9]{3})+)"
            r"\s*BTC",

            r"([0-9]{3,3}(?:,[0-9]{3})+)"
            r"\s*BTC"
        ],
        text
    )


    # =====================================================
    # USD RESERVE
    # =====================================================

    usd_reserve = find_number(
        [

            r"USD Reserve.*?"
            r"\$?\s*([0-9]+(?:\.[0-9]+)?)"
            r"\s*B",

            r"USD Reserve.*?"
            r"([0-9]+(?:\.[0-9]+)?)"
            r"\s*billion"
        ],
        text
    )


    # =====================================================
    # USD CASH
    # =====================================================

    usd_cash = find_number(
        [

            r"USD Cash.*?"
            r"\$?\s*([0-9]+(?:\.[0-9]+)?)"
            r"\s*B",

            r"USD Cash.*?"
            r"([0-9]+(?:\.[0-9]+)?)"
            r"\s*billion"
        ],
        text
    )


    # =====================================================
    # USD ASSETS
    # =====================================================

    usd_assets = find_number(
        [

            r"USD Assets.*?"
            r"\$?\s*([0-9]+(?:\.[0-9]+)?)"
            r"\s*B",

            r"USD Assets.*?"
            r"([0-9]+(?:\.[0-9]+)?)"
            r"\s*billion"
        ],
        text
    )


    # =====================================================
    # DEBT
    # =====================================================

    debt = find_number(
        [

            r"Debt.*?"
            r"\$?\s*([0-9]+(?:\.[0-9]+)?)"
            r"\s*B"
            r".{0,150}"
            r"notional",

            r"Debt.*?"
            r"\$?\s*([0-9]+(?:\.[0-9]+)?)"
            r"\s*billion"
        ],
        text
    )


    # =====================================================
    # PREFERRED
    # =====================================================

    preferred = find_number(
        [

            r"Preferred stock.*?"
            r"\$?\s*([0-9]+(?:\.[0-9]+)?)"
            r"\s*B"
            r".{0,150}"
            r"notional",

            r"Preferred.*?"
            r"\$?\s*([0-9]+(?:\.[0-9]+)?)"
            r"\s*B"
        ],
        text
    )


    # =====================================================
    # ADSO
    #
    # IMPORTANT:
    # Stored in millions.
    # Example:
    # 427.308 means 427.308 million shares.
    # =====================================================

    adso = find_number(
        [

            r"([0-9]+\.[0-9]+)\s*M"
            r"\s*.*?"
            r"average diluted",

            r"([0-9]+\.[0-9]+)\s*M"
            r"\s*ADSO",

            r"ADSO.*?"
            r"([0-9]+\.[0-9]+)\s*M"
        ],
        text
    )


    # =====================================================
    # FDSO
    #
    # IMPORTANT:
    # Stored in millions.
    # Example:
    # 419.9 means 419.9 million shares.
    # =====================================================

    fdso = find_number(
        [

            r"([0-9]+\.[0-9]+)\s*M"
            r"\s*FDSO",

            r"([0-9]+\.[0-9]+)\s*M"
            r"\s*fully diluted shares",

            r"FDSO.*?"
            r"([0-9]+\.[0-9]+)\s*M"
        ],
        text
    )


    # =====================================================
    # FALLBACK FDSO
    #
    # If SEC briefing does not expose FDSO in the exact
    # expected format, keep existing valid FDSO.
    # =====================================================

    old_data = load_json(
        DATA_FILE,
        {}
    )

    if fdso is None:

        existing_fdso = (
            old_data.get(
                "fdso"
            )
            if isinstance(
                old_data,
                dict
            )
            else None
        )

        try:

            existing_fdso = float(
                existing_fdso
            )

            if (
                existing_fdso > 0
                and
                existing_fdso < 10000
            ):

                fdso = existing_fdso

        except Exception:

            fdso = None


    # =====================================================
    # FALLBACK ADSO
    # =====================================================

    if adso is None:

        existing_adso = (
            old_data.get(
                "adso"
            )
            if isinstance(
                old_data,
                dict
            )
            else None
        )

        try:

            existing_adso = float(
                existing_adso
            )

            if (
                existing_adso > 0
                and
                existing_adso < 10000
            ):

                adso = existing_adso

        except Exception:

            adso = None


    # =====================================================
    # VALIDATION
    # =====================================================

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
            "SEC parser could not determine FDSO"
        )


    # =====================================================
    # USD ASSETS FALLBACK
    # =====================================================

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


    # =====================================================
    # RESULT
    # =====================================================

    result = {

        "btcHoldings":
            int(
                round(
                    btc_holdings
                )
            ),

        "fdso":
            round(
                fdso,
                3
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

        "source":
            "Strategy Investor Briefing / SEC Form 8-K",

        "asOf":
            filing.get(
                "filingDate"
            )
            if filing
            else None
    }


    # Preserve ADSO if available

    if adso is not None:

        result["adso"] = round(
            adso,
            3
        )


    return result


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

            data = dict(
                old_data
            )

            data.update(
                latest
            )

        else:

            data = latest


        # -------------------------------------------------
        # SAFETY CHECK
        #
        # FDSO MUST be in millions.
        # If something accidentally returns a raw share
        # count such as 419900000, reject it.
        # -------------------------------------------------

        fdso = float(
            data["fdso"]
        )

        if fdso >= 10000:

            raise RuntimeError(
                "FDSO unit error detected. "
                "Expected millions, received "
                f"{fdso}"
            )


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
            "ADSO:",
            data.get(
                "adso"
            )
        )

        print(
            "FDSO:",
            data["fdso"],
            "M"
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
            "SEC date:",
            data.get(
                "asOf"
            )
        )

        return data


    except Exception as error:

        print(
            "WARNING: Automatic SEC "
            "capital update failed:"
        )

        print(
            error
        )

        print(
            "Keeping existing data.json."
        )

        return old_data


# =========================================================
# BTC
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
# MSTR
# =========================================================

def get_mstr_price():

    data = get_json(
        YAHOO_URL
    )

    result = (
        data
        ["chart"]
        ["result"][0]
    )

    price = result[
        "meta"
    ].get(
        "regularMarketPrice"
    )

    if price is None:

        raise ValueError(
            "Yahoo did not return MSTR price"
        )

    price = float(
        price
    )

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

    oi = float(
        data["openInterest"]
    )

    if oi < 0:

        raise ValueError(
            "Invalid Binance OI"
        )

    return oi


def get_binance_funding():

    data = get_json(
        BINANCE_FUNDING_URL
    )

    if not data:

        raise ValueError(
            "No Binance funding data"
        )

    return (
        float(
            data[0]["fundingRate"]
        )
        * 100
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
        .get(
            "result",
            {}
        )
        .get(
            "list",
            []
        )
    )

    if not rows:

        raise ValueError(
            "No Bybit BTCUSDT ticker"
        )

    row = rows[0]

    oi_usd = float(
        row[
            "openInterestValue"
        ]
    )

    funding = (
        float(
            row[
                "fundingRate"
            ]
        )
        * 100
    )

    if oi_usd < 0:

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

    oi = float(
        rows[0]["oiUsd"]
    )

    if oi < 0:

        raise ValueError(
            "Invalid OKX OI"
        )

    return oi


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

    return (
        float(
            rows[0]["fundingRate"]
        )
        * 100
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
        company["btcHoldings"]
    )

    # FDSO is stored in MILLIONS.
    # Convert to actual shares.

    fdso_millions = float(
        company["fdso"]
    )

    fdso = (
        fdso_millions
        * 1_000_000
    )


    usd_assets = (
        float(
            company[
                "usdAssetsUsdB"
            ]
        )
        * 1e9
    )

    debt = (
        float(
            company[
                "debtUsdB"
            ]
        )
        * 1e9
    )

    preferred = (
        float(
            company[
                "preferredUsdB"
            ]
        )
        * 1e9
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
    # GROSS / NET RESERVE
    # -----------------------------------------------------

    gross_reserve = (
        btc_value
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


    # -----------------------------------------------------
    # PER SHARE
    # -----------------------------------------------------

    gross_bps = (
        gross_reserve
        /
        fdso
    )

    net_bps = (
        net_reserve
        /
        fdso
    )

    btc_per_share = (
        holdings
        /
        fdso
    )


    if (
        gross_bps <= 0
        or
        net_bps <= 0
    ):

        raise ValueError(
            "Invalid BPS"
        )


    # -----------------------------------------------------
    # mNAV
    # -----------------------------------------------------

    gross_mnav = (
        mstr_price
        /
        gross_bps
    )

    mnav = (
        mstr_price
        /
        net_bps
    )


    return {

        "btcValueUsd":
            btc_value,

        "grossReserveUsd":
            gross_reserve,

        "netReserveUsd":
            net_reserve,

        "grossBpsUsd":
            gross_bps,

        "netBpsUsd":
            net_bps,

        "btcPerShare":
            btc_per_share,

        "grossMnav":
            gross_mnav,

        "mnav":
            mnav
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
    ) * 100


# =========================================================
# MAIN
# =========================================================

def main():

    print()

    print(
        "======================================"
    )

    print(
        "MSTR Market History Update"
    )

    print(
        "======================================"
    )


    # =====================================================
    # STEP 1
    # SEC AUTO UPDATE
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
    # MARKET DATA
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
                    "WARNING: Binance "
                    "funding failed:",
                    error
                )


    except Exception as error:

        print(
            "WARNING: Binance OI failed:",
            error
        )


    # -----------------------------------------------------
    # BYBIT
    # -----------------------------------------------------

    try:

        (
            oi_usd,
            funding
        ) = get_bybit_data()


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
            "WARNING: Bybit failed:",
            error
        )


    # -----------------------------------------------------
    # OKX
    # -----------------------------------------------------

    okx_oi = None


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


    except Exception as error:

        print(
            "WARNING: OKX OI failed:",
            error
        )


    try:

        funding = (
            get_okx_funding()
        )


        if (
            okx_oi
            is not None
            and
            okx_oi > 0
        ):

            funding_values.append(
                (
                    "OKX",
                    funding,
                    okx_oi
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
            aggregate_oi_usd
            /
            btc_price
        )


    # =====================================================
    # STEP 7
    # FUNDING
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


        else:

            aggregate_funding = (
                sum(
                    rate
                    for _, rate, _
                    in funding_values
                )
                /
                len(
                    funding_values
                )
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
    # DATE
    # =====================================================

    now = datetime.now(
        timezone.utc
    )

    date_key = (
        now.strftime(
            "%Y-%m-%d"
        )
    )


    # =====================================================
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

        "grossMnav":
            round(
                result[
                    "grossMnav"
                ],
                4
            ),

        "mnav":
            round(
                result[
                    "mnav"
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
        "FINAL RESULT"
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
        "BTC holdings:",
        company["btcHoldings"]
    )

    print(
        "FDSO:",
        company["fdso"],
        "M"
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
