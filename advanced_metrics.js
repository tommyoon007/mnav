
import json
from datetime import datetime, timezone
from pathlib import Path

DATA_FILE = Path("data.json")
HISTORY_FILE = Path("history.json")
ADVANCED_FILE = Path("advanced_history.json")


def load_json(path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:
        print(f"WARNING: failed to read {path}: {error}")
        return default


def save_json(path, data):
    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8"
    )


def number(value):
    try:
        value = float(value)
        return value if value == value else None
    except (TypeError, ValueError):
        return None


def find_previous(records, latest_date, days_min=6, days_max=10):
    latest_dt = datetime.fromisoformat(
        latest_date + "T00:00:00+00:00"
    )
    candidate = None

    for item in records:
        if item.get("date") == latest_date:
            continue

        try:
            dt = datetime.fromisoformat(
                item["date"] + "T00:00:00+00:00"
            )
            diff = (latest_dt - dt).days

            if days_min <= diff <= days_max:
                candidate = item

        except Exception:
            continue

    return candidate


def percentile(values, current):
    values = [
        v for v in values
        if number(v) is not None
    ]

    if not values or current is None:
        return None

    count = sum(
        1 for v in values
        if float(v) <= current
    )

    return round(
        (count / len(values)) * 100,
        1
    )


def level_from_score(score):
    if score < 25:
        return "SAFE"

    if score < 50:
        return "CAUTION"

    if score < 75:
        return "OVERHEATED"

    return "EXTREME"


def funding_points(rate):
    if rate is None or rate <= 0.01:
        return 0

    if rate < 0.03:
        return 8

    if rate < 0.05:
        return 18

    return 25


def oi_points(change):
    if change is None or change <= 5:
        return 0

    if change < 10:
        return 8

    if change < 20:
        return 15

    return 20


def btc_points(change):
    if change is None or change <= 5:
        return 0

    if change < 10:
        return 8

    return 10


def balance_points(ratio):
    if ratio is None or ratio <= 0.25:
        return 0

    if ratio <= 0.40:
        return 4

    if ratio <= 0.60:
        return 7

    return 10


def mnav_points(mnav):
    if mnav is None or mnav <= 1.5:
        return 0

    if mnav < 2.0:
        return 2

    if mnav < 3.0:
        return 4

    return 5


def main():

    company = load_json(
        DATA_FILE,
        {}
    )

    history = load_json(
        HISTORY_FILE,
        []
    )

    advanced = load_json(
        ADVANCED_FILE,
        []
    )

    if not company:
        raise RuntimeError(
            "data.json not found"
        )

    if not isinstance(history, list) or not history:
        raise RuntimeError(
            "history.json has no data"
        )

    if not isinstance(advanced, list):
        advanced = []

    latest = history[-1]

    date_key = latest.get("date")

    if not date_key:
        raise RuntimeError(
            "Latest history record has no date"
        )

    btc_price = number(
        latest.get("btc")
    )

    mnav = number(
        latest.get("mnav")
    )

    oi_btc = number(
        latest.get("oiBtc")
    )

    funding = number(
        latest.get("fundingRate")
    )

    holdings = number(
        company.get("btcHoldings")
    )

    fdso_m = number(
        company.get("fdso")
    )

    debt_b = number(
        company.get("debtUsdB")
    ) or 0

    preferred_b = number(
        company.get("preferredUsdB")
    ) or 0

    usd_assets_b = number(
        company.get("usdAssetsUsdB")
    ) or 0

    if (
        holdings is None
        or fdso_m is None
        or fdso_m <= 0
    ):
        raise RuntimeError(
            "Invalid BTC holdings or FDSO"
        )

    # BTC / share in sats
    btc_per_share_sats = (
        holdings *
        1e8 /
        (fdso_m * 1e6)
    )

    # 7-day comparison
    previous7 = find_previous(
        history,
        date_key,
        6,
        10
    )

    oi_change_7d = None
    btc_change_7d = None

    if previous7:

        old_oi = number(
            previous7.get("oiBtc")
        )

        old_btc = number(
            previous7.get("btc")
        )

        if (
            old_oi
            and old_oi > 0
            and oi_btc is not None
        ):
            oi_change_7d = (
                oi_btc /
                old_oi -
                1
            ) * 100

        if (
            old_btc
            and old_btc > 0
            and btc_price is not None
        ):
            btc_change_7d = (
                btc_price /
                old_btc -
                1
            ) * 100

    # BTC Yield requires a previous BTC/share snapshot.
    previous_advanced = find_previous(
        advanced,
        date_key,
        6,
        10
    )

    btc_yield_7d = None

    if previous_advanced:

        old_bps = number(
            previous_advanced.get(
                "btcPerShareSats"
            )
        )

        if (
            old_bps
            and old_bps > 0
        ):
            btc_yield_7d = (
                btc_per_share_sats /
                old_bps -
                1
            ) * 100

    # Historical mNAV percentile
    mnav_values = [
        number(item.get("mnav"))
        for item in history
    ]

    mnav_percentile = percentile(
        mnav_values,
        mnav
    )

    # Balance sheet risk
    btc_asset_b = None

    if btc_price is not None:
        btc_asset_b = (
            holdings *
            btc_price /
            1e9
        )

    senior_b = (
        debt_b +
        preferred_b
    )

    balance_ratio = None

    if (
        btc_asset_b is not None
        and btc_asset_b > 0
    ):
        balance_ratio = (
            senior_b /
            (
                btc_asset_b +
                usd_assets_b
            )
        )

    # Composite risk score.
    # Only available components are used,
    # then normalized back to 0-100.
    components = []

    if mnav_percentile is not None:
        components.append(
            (
                mnav_percentile * 0.30,
                30
            )
        )

    if funding is not None:
        components.append(
            (
                funding_points(funding),
                25
            )
        )

    if oi_change_7d is not None:
        components.append(
            (
                oi_points(oi_change_7d),
                20
            )
        )

    if btc_change_7d is not None:
        components.append(
            (
                btc_points(btc_change_7d),
                10
            )
        )

    if balance_ratio is not None:
        components.append(
            (
                balance_points(balance_ratio),
                10
            )
        )

    if mnav is not None:
        components.append(
            (
                mnav_points(mnav),
                5
            )
        )

    if components:

        raw_score = sum(
            item[0]
            for item in components
        )

        available_weight = sum(
            item[1]
            for item in components
        )

        risk_score = round(
            (
                raw_score /
                available_weight
            ) * 100,
            1
        )

    else:
        risk_score = None

    record = {

        "date":
            date_key,

        "timestamp":
            datetime.now(
                timezone.utc
            ).isoformat(),

        "mnav":
            mnav,

        "mnavPercentile":
            mnav_percentile,

        "btcPerShareSats":
            round(
                btc_per_share_sats,
                2
            ),

        "btcYield7d":
            (
                round(
                    btc_yield_7d,
                    3
                )
                if btc_yield_7d is not None
                else None
            ),

        "oiBtc":
            oi_btc,

        "fundingRate":
            funding,

        "oiChange7d":
            (
                round(
                    oi_change_7d,
                    2
                )
                if oi_change_7d is not None
                else None
            ),

        "btcChange7d":
            (
                round(
                    btc_change_7d,
                    2
                )
                if btc_change_7d is not None
                else None
            ),

        "balanceSheetRatio":
            (
                round(
                    balance_ratio * 100,
                    2
                )
                if balance_ratio is not None
                else None
            ),

        "riskScore":
            risk_score,

        "riskLevel":
            (
                level_from_score(
                    risk_score
                )
                if risk_score is not None
                else "DATA"
            )
    }

    # Replace today's record.
    advanced = [
        item
        for item in advanced
        if item.get("date") != date_key
    ]

    advanced.append(record)

    advanced.sort(
        key=lambda x:
        x.get("date", "")
    )

    save_json(
        ADVANCED_FILE,
        advanced
    )

    print("======================================")
    print("MSTR Advanced Metrics Updated")
    print("======================================")
    print("mNAV percentile:", mnav_percentile)
    print("BTC/share sats:", btc_per_share_sats)
    print("BTC Yield 7d:", btc_yield_7d)
    print("OI 7d:", oi_change_7d)
    print("BTC 7d:", btc_change_7d)
    print("Balance sheet ratio:", balance_ratio)
    print("Risk score:", risk_score)
    print(
        "Risk level:",
        record["riskLevel"]
    )
    print(
        "Advanced records:",
        len(advanced)
    )
    print("======================================")


if __name__ == "__main__":
    main()
