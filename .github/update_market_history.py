import json
from datetime import datetime, timezone
from pathlib import Path

import requests


DATA_FILE = Path("data.json")
HISTORY_FILE = Path("history.json")


# =========================================================
# MSTR / BTC
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


HEADERS = {
    "User-Agent": "tommyoon007-mnav-history/3.0",
    "Accept": "application/json"
}

TIMEOUT = 20


# =========================================================
# 공통
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
            f"WARNING: "
            f"Failed to read {path}: "
            f"{error}"
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

    data = response.json()

    return data


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
# BINANCE DATA
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

    rate_decimal = float(
        data[0]["fundingRate"]
    )

    # 예:
    # 0.0001 = 0.01%
    return rate_decimal * 100.0


# =========================================================
# BYBIT DATA
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

    # Bybit은 BTCUSDT linear의
    # openInterestValue를 USD로 제공
    oi_usd = float(
        row["openInterestValue"]
    )

    # fundingRate는 decimal fraction
    # 예: 0.0001 = 0.01%
    funding_pct = (
        float(row["fundingRate"]) *
        100.0
    )

    if oi_usd < 0:
        raise ValueError(
            "Invalid Bybit OI"
        )

    return (
        oi_usd,
        funding_pct
    )


# =========================================================
# OKX DATA
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

    row = rows[0]

    # OKX가 USD 기준 OI를 직접 제공
    oi_usd = float(
        row["oiUsd"]
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

    row = rows[0]

    funding_pct = (
        float(
            row["fundingRate"]
        ) *
        100.0
    )

    return funding_pct


# =========================================================
# M NAV
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
    # BTC / MSTR
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
    # OI / Funding
    # -----------------------------------------------------

    oi_sources = []
    funding_sources = []

    oi_usd_total = 0.0

    weighted_funding_sum = 0.0

    weighted_funding_oi = 0.0


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

        oi_usd_total += (
            binance_oi_usd
        )

        oi_sources.append(
            "Binance"
        )

        print(
            "Binance OI USD:",
            binance_oi_usd
        )


        try:

            binance_funding = (
                get_binance_funding()
            )

            weighted_funding_sum += (
                binance_funding *
                binance_oi_usd
            )

            weighted_funding_oi += (
                binance_oi_usd
            )

            funding_sources.append(
                "Binance"
            )

            print(
                "Binance Funding:",
                binance_funding
            )

        except Exception as error:

            print(
                "WARNING: "
                f"Binance funding failed: "
                f"{error}"
            )

    except Exception as error:

        print(
            "WARNING: "
            f"Binance OI failed: "
            f"{error}"
        )


    # =====================================================
    # BYBIT
    # =====================================================

    try:

        (
            bybit_oi_usd,
            bybit_funding
        ) = get_bybit_data()


        oi_usd_total += (
            bybit_oi_usd
        )

        oi_sources.append(
            "Bybit"
        )

        print(
            "Bybit OI USD:",
            bybit_oi_usd
        )


        weighted_funding_sum += (
            bybit_funding *
            bybit_oi_usd
        )

        weighted_funding_oi += (
            bybit_oi_usd
        )

        funding_sources.append(
            "Bybit"
        )

        print(
            "Bybit Funding:",
            bybit_funding
        )


    except Exception as error:

        print(
            "WARNING: "
            f"Bybit failed: "
            f"{error}"
        )


    # =====================================================
    # OKX OI
    # =====================================================

    okx_oi_usd = None

    try:

        okx_oi_usd = (
            get_okx_oi()
        )

        oi_usd_total += (
            okx_oi_usd
        )

        oi_sources.append(
            "OKX"
        )

        print(
            "OKX OI USD:",
            okx_oi_usd
        )


    except Exception as error:

        print(
            "WARNING: "
            f"OKX OI failed: "
            f"{error}"
        )


    # =====================================================
    # OKX Funding
    # =====================================================

    try:

        okx_funding = (
            get_okx_funding()
        )

        # 가능하면 OKX OI로 가중
        if (
            okx_oi_usd is not None and
            okx_oi_usd > 0
        ):

            weighted_funding_sum += (
                okx_funding *
                okx_oi_usd
            )

            weighted_funding_oi += (
                okx_oi_usd
            )

        else:

            # OI를 못 가져왔을 경우
            # 단순 평균용으로 작은 weight
            weighted_funding_sum += (
                okx_funding
            )

        funding_sources.append(
            "OKX"
        )

        print(
            "OKX Funding:",
            okx_funding
        )

    except Exception as error:

        print(
            "WARNING: "
            f"OKX funding failed: "
            f"{error}"
        )


    # =====================================================
    # 최종 OI
    # =====================================================

    aggregate_oi_usd = None
    aggregate_oi_btc = None

    if (
        oi_usd_total > 0
    ):

        aggregate_oi_usd = (
            oi_usd_total
        )

        aggregate_oi_btc = (
            oi_usd_total /
            btc_price
        )


    # =====================================================
    # 최종 Funding
    # =====================================================

    aggregate_funding = None

    if (
        weighted_funding_oi > 0
    ):

        aggregate_funding = (
            weighted_funding_sum /
            weighted_funding_oi
        )

    elif funding_sources:

        # OI 가중치가 없는 경우
        # 수집 가능한 Funding 단순 평균
        # 을 위해 다시 조회
        funding_values = []


        try:

            funding_values.append(
                get_binance_funding()
            )

        except Exception:
            pass


        try:

            (
                _,
                bybit_funding_value
            ) = get_bybit_data()

            funding_values.append(
                bybit_funding_value
            )

        except Exception:
            pass


        try:

            funding_values.append(
                get_okx_funding()
            )

        except Exception:
            pass


        if funding_values:

            aggregate_funding = (
                sum(funding_values) /
                len(funding_values)
            )


    # =====================================================
    # 날짜
    # =====================================================

    now = datetime.now(
        timezone.utc
    )

    date_key = now.strftime(
        "%Y-%m-%d"
    )


    # =====================================================
    # 기존 history
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
    # 기록
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
                if aggregate_oi_btc is not None
                else None
            ),

        "oiUsd":
            (
                round(
                    aggregate_oi_usd,
                    2
                )
                if aggregate_oi_usd is not None
                else None
            ),

        "fundingRate":
            (
                round(
                    aggregate_funding,
                    5
                )
                if aggregate_funding is not None
                else None
            ),

        "oiSources":
            oi_sources,

        "fundingSources":
            funding_sources
    }


    # =====================================================
    # 같은 날짜 교체
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


    history.sort(
        key=lambda x:
            x.get(
                "date",
                ""
            )
    )


    save_json(
        HISTORY_FILE,
        history
    )


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
        "OI Sources:",
        ", ".join(oi_sources)
        if oi_sources
        else "NONE"
    )

    print(
        "Funding Sources:",
        ", ".join(funding_sources)
        if funding_sources
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
