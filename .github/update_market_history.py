import json
from datetime import datetime, timezone
from pathlib import Path

import requests


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
    "User-Agent": "tommyoon007-mnav-history/5.0",
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

    oi_usd = float(
        row["openInterestValue"]
    )

    funding = float(
        row["fundingRate"]
    ) * 100.0

    if oi_usd < 0:
        raise ValueError(
            "Invalid Bybit OI"
        )

    return oi_usd, funding


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

    funding = float(
        rows[0]["fundingRate"]
    ) * 100.0

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

    return {
        "netReserveUsd":
            net_reserve,

        "netBpsUsd":
            net_bps,

        "mnav":
            mnav
    }


# =========================================================
# RISK CALCULATION
# =========================================================
#
# Funding + OI 증가를 함께 판단한다.
#
# fundingRate 단위:
# %
#
# 예:
# 0.01 = +0.01%
# 0.05 = +0.05%
# 0.10 = +0.10%
#
# OI 변화:
# 최근 데이터 대비 증가율
#
# =========================================================

def calculate_risk(
    funding_rate,
    current_oi_usd,
    history
):

    if (
        funding_rate is None or
        current_oi_usd is None
    ):

        return {
            "riskLevel": "UNKNOWN",
            "riskScore": None,
            "fundingSignal": "UNKNOWN",
            "oiSignal": "UNKNOWN"
        }


    # -----------------------------------------------------
    # Funding score
    # -----------------------------------------------------

    funding_abs = abs(
        float(funding_rate)
    )

    funding_score = 0

    if funding_abs >= 0.10:

        funding_score = 3

    elif funding_abs >= 0.05:

        funding_score = 2

    elif funding_abs >= 0.03:

        funding_score = 1


    # -----------------------------------------------------
    # Funding 방향
    # -----------------------------------------------------

    if funding_rate >= 0.10:

        funding_signal = "EXTREME_LONG"

    elif funding_rate >= 0.05:

        funding_signal = "HIGH_LONG"

    elif funding_rate >= 0.03:

        funding_signal = "ELEVATED_LONG"

    elif funding_rate <= -0.10:

        funding_signal = "EXTREME_SHORT"

    elif funding_rate <= -0.05:

        funding_signal = "HIGH_SHORT"

    elif funding_rate <= -0.03:

        funding_signal = "ELEVATED_SHORT"

    else:

        funding_signal = "NORMAL"


    # -----------------------------------------------------
    # OI 변화
    # -----------------------------------------------------

    previous_oi = None

    if isinstance(history, list):

        valid = [
            item
            for item in history
            if item.get("oiUsd") is not None
        ]

        if valid:

            # 가장 최근 저장값
            previous_oi = float(
                valid[-1]["oiUsd"]
            )


    oi_change = None
    oi_score = 0

    if (
        previous_oi is not None and
        previous_oi > 0
    ):

        oi_change = (
            (
                current_oi_usd /
                previous_oi
            ) - 1
        ) * 100

        if oi_change >= 10:

            oi_score = 2

        elif oi_change >= 5:

            oi_score = 1


    # -----------------------------------------------------
    # OI signal
    # -----------------------------------------------------

    if oi_change is None:

        oi_signal = "UNKNOWN"

    elif oi_change >= 10:

        oi_signal = "RAPID_RISE"

    elif oi_change >= 5:

        oi_signal = "RISING"

    elif oi_change <= -10:

        oi_signal = "RAPID_FALL"

    elif oi_change <= -5:

        oi_signal = "FALLING"

    else:

        oi_signal = "STABLE"


    # -----------------------------------------------------
    # Risk score
    # -----------------------------------------------------

    risk_score = (
        funding_score +
        oi_score
    )


    # -----------------------------------------------------
    # 특별히 Funding + OI가 동시에 증가하면
    # 한 단계 더 위험하게 판단
    # -----------------------------------------------------

    if (
        funding_rate >= 0.05 and
        oi_change is not None and
        oi_change >= 5
    ):

        risk_score += 1


    # -----------------------------------------------------
    # Level
    # -----------------------------------------------------

    if risk_score >= 5:

        risk_level = "EXTREME"

    elif risk_score >= 3:

        risk_level = "OVERHEATED"

    elif risk_score >= 1:

        risk_level = "CAUTION"

    else:

        risk_level = "SAFE"


    return {

        "riskLevel":
            risk_level,

        "riskScore":
            risk_score,

        "fundingSignal":
            funding_signal,

        "oiSignal":
            oi_signal,

        "oiChangePct":
            (
                round(
                    oi_change,
                    2
                )
                if oi_change is not None
                else None
            )
    }


# =========================================================
# MAIN
# =========================================================

def main():

    company = load_json(
        DATA_FILE,
        {}
    )

    if not company:

        raise RuntimeError(
            "data.json not found"
        )


    # -----------------------------------------------------
    # BTC / MSTR / mNAV
    # -----------------------------------------------------

    btc_price = (
        get_btc_price()
    )

    mstr_price = (
        get_mstr_price()
    )

    result = calculate_mnav(
        btc_price,
        mstr_price,
        company
    )


    # -----------------------------------------------------
    # OI / FUNDING
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
            oi_btc *
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
                f"Funding failed: {error}"
            )

    except Exception as error:

        print(
            "WARNING: Binance OI "
            f"failed: {error}"
        )


    # -----------------------------------------------------
    # Bybit
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
            "WARNING: Bybit failed: "
            f"{error}"
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
            "WARNING: OKX OI failed: "
            f"{error}"
        )


    try:

        okx_funding = (
            get_okx_funding()
        )

        if (
            okx_oi is not None and
            okx_oi > 0
        ):

            funding_values.append(
                (
                    "OKX",
                    okx_funding,
                    okx_oi
                )
            )

    except Exception as error:

        print(
            "WARNING: OKX Funding "
            f"failed: {error}"
        )


    # -----------------------------------------------------
    # Aggregate OI
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
            aggregate_oi_usd /
            btc_price
        )


    # -----------------------------------------------------
    # Aggregate Funding
    # OI weighted
    # -----------------------------------------------------

    aggregate_funding = None

    if funding_values:

        total_weight = sum(
            item[2]
            for item in funding_values
            if item[2] > 0
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
                    item[1]
                    for item in funding_values
                )
                /
                len(funding_values)
            )


    # -----------------------------------------------------
    # Date
    # -----------------------------------------------------

    now = datetime.now(
        timezone.utc
    )

    date_key = now.strftime(
        "%Y-%m-%d"
    )


    # -----------------------------------------------------
    # Load history
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


    # -----------------------------------------------------
    # Risk
    # -----------------------------------------------------

    risk = calculate_risk(
        aggregate_funding,
        aggregate_oi_usd,
        history
    )


    # -----------------------------------------------------
    # Record
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

        "mnav":
            round(
                result["mnav"],
                4
            ),

        "netBpsUsd":
            round(
                result["netBpsUsd"],
                2
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

        # -------------------------------------------------
        # NEW RISK DATA
        # -------------------------------------------------

        "riskLevel":
            risk["riskLevel"],

        "riskScore":
            risk["riskScore"],

        "fundingSignal":
            risk["fundingSignal"],

        "oiSignal":
            risk["oiSignal"],

        "oiChangePct":
            risk["oiChangePct"]
    }


    # -----------------------------------------------------
    # Replace today's record
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
    # Sort
    # -----------------------------------------------------

    history.sort(
        key=lambda x:
        x.get(
            "date",
            ""
        )
    )


    # -----------------------------------------------------
    # Save
    # -----------------------------------------------------

    save_json(
        HISTORY_FILE,
        history
    )


    # -----------------------------------------------------
    # Console
    # -----------------------------------------------------

    print()
    print(
        "======================================"
    )

    print(
        "MSTR Historical Data Updated"
    )

    print(
        "======================================"
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
        "mNAV:",
        result["mnav"]
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
        "OI Change:",
        risk["oiChangePct"]
    )

    print(
        "Funding Signal:",
        risk["fundingSignal"]
    )

    print(
        "OI Signal:",
        risk["oiSignal"]
    )

    print(
        "Risk Level:",
        risk["riskLevel"]
    )

    print(
        "Risk Score:",
        risk["riskScore"]
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


if __name__ == "__main__":
    main()
