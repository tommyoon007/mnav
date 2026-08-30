import json
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests


# =========================================================
# FILES
# =========================================================

DATA_FILE = Path("data.json")
HISTORY_FILE = Path("history.json")


# =========================================================
# URL
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
    "User-Agent": "tommyoon007-mnav-history/6.0",
    "Accept": "application/json"
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

def get_json(url):

    response = requests.get(
        url,
        headers=HEADERS,
        timeout=TIMEOUT
    )

    response.raise_for_status()

    return response.json()


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
        data["chart"]
        ["result"][0]
    )

    price = result["meta"].get(
        "regularMarketPrice"
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

    # -----------------------------------------------------
    # IMPORTANT
    #
    # Bybit official API:
    #
    # openInterestValue =
    # OI value for BOTH sides
    #
    # singleOpenInterestValue =
    # OI value for SINGLE side
    #
    # We use openInterestValue because this script
    # aggregates total OI across exchanges.
    # -----------------------------------------------------

    oi_raw = row.get(
        "openInterestValue"
    )

    if oi_raw in (
        None,
        ""
    ):

        raise ValueError(
            "No Bybit OI value"
        )

    oi_usd = float(
        oi_raw
    )

    # -----------------------------------------------------
    # Funding
    # -----------------------------------------------------

    funding_raw = row.get(
        "fundingRate"
    )

    if funding_raw in (
        None,
        ""
    ):

        raise ValueError(
            "No Bybit funding rate"
        )

    funding = (
        float(
            funding_raw
        ) * 100.0
    )

    # -----------------------------------------------------
    # Validation
    # -----------------------------------------------------

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

    oi_usd = float(
        rows[0]["oiUsd"]
    )

    if oi_usd < 0:

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
        ) * 100.0
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

    usd_assets = float(
        company["usdAssetsUsdB"]
    ) * 1e9

    debt = float(
        company["debtUsdB"]
    ) * 1e9

    preferred = float(
        company["preferredUsdB"]
    ) * 1e9

    btc_value = (
        holdings *
        btc_price
    )

    net_reserve = (
        btc_value +
        usd_assets -
        debt -
        preferred
    )

    net_bps = (
        net_reserve /
        (fdso * 1e6)
    )

    if net_bps <= 0:

        raise ValueError(
            "Invalid Net BPS"
        )

    mnav = (
        mstr_price /
        net_bps
    )

    # BTC per diluted share
    btc_per_share = (
        holdings /
        (fdso * 1e6)
    )

    return {

        "netReserveUsd":
            net_reserve,

        "netBpsUsd":
            net_bps,

        "mnav":
            mnav,

        "btcPerShare":
            btc_per_share
    }


# =========================================================
# PREVIOUS RECORD
# =========================================================

def get_previous_record(
    history,
    days_back=1
):

    if not history:

        return None

    target_date = (
        datetime.now(
            timezone.utc
        ).date()
        -
        timedelta(
            days=days_back
        )
    )

    target_key = (
        target_date.strftime(
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

    except (
        TypeError,
        ValueError
    ):

        return None

    if (
        current <= 0 or
        previous <= 0
    ):

        return None

    return (
        (
            current /
            previous
        ) - 1
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

    except (
        TypeError,
        ValueError
    ):

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
                value > 0 and
                value == value
            ):

                values.append(
                    value
                )

        except (
            TypeError,
            ValueError
        ):

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


    # =====================================================
    # mNAV VALUATION
    # =====================================================

    if mnav_percentile is not None:

        if mnav_percentile >= 95:

            score += 35

        elif mnav_percentile >= 85:

            score += 28

        elif mnav_percentile >= 70:

            score += 20

        elif mnav_percentile >= 50:

            score += 10


    # =====================================================
    # FUNDING
    #
    # IMPORTANT:
    #
    # Only POSITIVE funding contributes to long-side
    # overheating risk.
    #
    # Negative funding is NOT converted to positive
    # risk by abs().
    # =====================================================

    if funding_rate is not None:

        funding = float(
            funding_rate
        )

        if funding >= 0.08:

            score += 30

        elif funding >= 0.05:

            score += 23

        elif funding >= 0.03:

            score += 15

        elif funding >= 0.015:

            score += 7


    # =====================================================
    # OI 1D
    # =====================================================

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


    # =====================================================
    # OI 7D
    # =====================================================

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


    # =====================================================
    # BTC 7D MOMENTUM
    # =====================================================

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


    # =====================================================
    # COMBINED LEVERAGE SIGNAL
    #
    # BTC 상승 + OI 증가 + positive funding
    # = stronger long leverage overheating
    # =====================================================

    if (
        btc_change_7d is not None and
        oi_change_7d is not None and
        funding_rate is not None
    ):

        btc7 = float(
            btc_change_7d
        )

        oi7 = float(
            oi_change_7d
        )

        funding = float(
            funding_rate
        )

        if (
            btc7 >= 10 and
            oi7 >= 10 and
            funding >= 0.03
        ):

            score += 10

        elif (
            btc7 >= 5 and
            oi7 >= 7 and
            funding >= 0.015
        ):

            score += 5


    # =====================================================
    # CAP
    # =====================================================

    score = min(
        100.0,
        max(
            0.0,
            score
        )
    )


    # =====================================================
    # LEVEL
    # =====================================================

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
        "MSTR Market History Update"
    )

    print(
        "======================================"
    )


    # =====================================================
    # COMPANY DATA
    # =====================================================

    company = load_json(
        DATA_FILE,
        {}
    )

    if not company:

        raise RuntimeError(
            "data.json not found"
        )


    # =====================================================
    # BTC / MSTR
    # =====================================================

    btc_price = (
        get_btc_price()
    )

    mstr_price = (
        get_mstr_price()
    )

    mnav_result = (
        calculate_mnav(
            btc_price,
            mstr_price,
            company
        )
    )


    # =====================================================
    # LOAD HISTORY
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
            okx_oi_usd is not None and
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
    # AGGREGATE FUNDING
    # OI WEIGHTED
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
                len(funding_values)
            )


    # =====================================================
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


    if (
        previous_1d and
        aggregate_oi_btc is not None
    ):

        oi_change_1d = (
            percentage_change(
                aggregate_oi_btc,
                previous_1d.get(
                    "oiBtc"
                )
            )
        )


    if (
        previous_7d and
        aggregate_oi_btc is not None
    ):

        oi_change_7d = (
            percentage_change(
                aggregate_oi_btc,
                previous_7d.get(
                    "oiBtc"
                )
            )
        )


    if previous_1d:

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
                mnav_result["mnav"],
                previous_1d.get(
                    "mnav"
                )
            )
        )


    if previous_7d:

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
                mnav_result["mnav"],
                previous_7d.get(
                    "mnav"
                )
            )
        )


    # =====================================================
    # mNAV PERCENTILE
    # =====================================================

    mnav_percentile = (
        calculate_mnav_percentile(
            mnav_result["mnav"],
            history
        )
    )


    # =====================================================
    # RISK
    # =====================================================

    risk_score, risk_level = (
        calculate_risk_score(
            mnav_percentile,
            aggregate_funding,
            oi_change_1d,
            oi_change_7d,
            btc_change_7d
        )
    )


    # =====================================================
    # DATE
    # =====================================================

    now = datetime.now(
        timezone.utc
    )

    date_key = now.strftime(
        "%Y-%m-%d"
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

        "mnav":
            round(
                mnav_result["mnav"],
                4
            ),

        "netBpsUsd":
            round(
                mnav_result[
                    "netBpsUsd"
                ],
                2
            ),

        "btcPerShare":
            round(
                mnav_result[
                    "btcPerShare"
                ],
                10
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
            ]
    }


    # =====================================================
    # BTC YIELD PROXY
    #
    # Change in BTC per diluted share.
    # =====================================================

    if previous_1d:

        btcps_change_1d = (
            percentage_change(
                record[
                    "btcPerShare"
                ],
                previous_1d.get(
                    "btcPerShare"
                )
            )
        )

        record[
            "btcYield1dPct"
        ] = (
            round(
                btcps_change_1d,
                2
            )
            if btcps_change_1d
            is not None
            else None
        )

    else:

        record[
            "btcYield1dPct"
        ] = None


    if previous_7d:

        btcps_change_7d = (
            percentage_change(
                record[
                    "btcPerShare"
                ],
                previous_7d.get(
                    "btcPerShare"
                )
            )
        )

        record[
            "btcYield7dPct"
        ] = (
            round(
                btcps_change_7d,
                2
            )
            if btcps_change_7d
            is not None
            else None
        )

    else:

        record[
            "btcYield7dPct"
        ] = None


    # =====================================================
    # REPLACE TODAY'S RECORD
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
        "BTC:",
        btc_price
    )

    print(
        "MSTR:",
        mstr_price
    )

    print(
        "mNAV:",
        mnav_result["mnav"]
    )

    print(
        "BTC / diluted share:",
        mnav_result[
            "btcPerShare"
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
        "Funding Rate:",
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
        "OI Sources:",
        ", ".join(
            name
            for name, _
            in oi_values
        )
        if oi_values
        else "NONE"
    )

    print(
        "Funding Sources:",
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
# START
# =========================================================

if __name__ == "__main__":

    main()
