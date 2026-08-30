import json
import re
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup


DATA_FILE = Path("data.json")

SEC_SUBMISSIONS = (
    "https://data.sec.gov/submissions/"
    "CIK0001050446.json"
)

HEADERS = {
    "User-Agent":
        "tommyoon007-mnav/2.0 contact: github"
}

TIMEOUT = 30
MAX_8K_SCAN = 30


def load_data():

    if DATA_FILE.exists():

        try:
            return json.loads(
                DATA_FILE.read_text(
                    encoding="utf-8"
                )
            )

        except Exception as exc:

            print(
                "WARNING: Could not read "
                f"data.json: {exc}"
            )

    return {

        "updatedAt": None,

        "source":
            "Strategy / SEC",

        "btcHoldings":
            840447,

        "adso":
            427.308,

        "fdso":
            419.9,

        "btcReserveUsdB":
            64.718,

        "usdReserveUsdB":
            5.10,

        "usdCashUsdB":
            1.59,

        "usdAssetsUsdB":
            6.69,

        "debtUsdB":
            6.754,

        "preferredUsdB":
            14.966,

        "netReserveUsdB":
            49.683,

        "notes":
            ""
    }


def sec_json(url):

    response = requests.get(
        url,
        headers=HEADERS,
        timeout=TIMEOUT
    )

    response.raise_for_status()

    return response.json()


def sec_text(url):

    response = requests.get(
        url,
        headers=HEADERS,
        timeout=TIMEOUT
    )

    response.raise_for_status()

    return response.text


def get_recent_8k_filings():

    data = sec_json(
        SEC_SUBMISSIONS
    )

    recent = (
        data[
            "filings"
        ][
            "recent"
        ]
    )

    filings = []

    for i, form in enumerate(
        recent["form"]
    ):

        if form != "8-K":
            continue

        filings.append({

            "accession":
                recent[
                    "accessionNumber"
                ][i],

            "primaryDocument":
                recent[
                    "primaryDocument"
                ][i],

            "filingDate":
                recent[
                    "filingDate"
                ][i]

        })

        if len(filings) >= MAX_8K_SCAN:
            break

    return filings


def filing_url(filing):

    accession = (
        filing["accession"]
        .replace("-", "")
    )

    return (
        "https://www.sec.gov/Archives/"
        "edgar/data/"
        f"1050446/{accession}/"
        f"{filing['primaryDocument']}"
    )


def clean_number(value):

    return float(
        value
        .replace(",", "")
        .replace("$", "")
        .strip()
    )


def first_match(
    text,
    patterns
):

    for pattern in patterns:

        match = re.search(
            pattern,
            text,
            re.IGNORECASE |
            re.DOTALL
        )

        if match:

            return clean_number(
                match.group(1)
            )

    return None


def parse_8k_text(filing):

    html = sec_text(
        filing_url(filing)
    )

    soup = BeautifulSoup(
        html,
        "html.parser"
    )

    text = soup.get_text(
        " ",
        strip=True
    )


    # -----------------------------------------
    # BTC Holdings
    # -----------------------------------------

    btc = first_match(
        text,
        [

            r"Aggregate BTC Holdings\s*"
            r"[:\-]?\s*([\d,]+)",

            r"BTC Holdings\s*"
            r"[:\-]?\s*([\d,]+)",

            r"holds\s+([\d,]+)\s+bitcoin",

            r"hold(?:s|ing)\s+"
            r"([\d,]+)\s+bitcoin"

        ]
    )


    # -----------------------------------------
    # USD Assets
    # -----------------------------------------

    usd_assets = first_match(
        text,
        [

            r"\$([\d.]+)\s*billion\s+"
            r"of\s+USD\s+Assets",

            r"USD\s+Assets[^$]{0,120}"
            r"\$([\d.]+)\s*billion",

            r"USD\s+assets[^$]{0,120}"
            r"\$([\d.]+)\s*billion"

        ]
    )


    # -----------------------------------------
    # Debt
    # -----------------------------------------

    debt = first_match(
        text,
        [

            r"deducting\s+"
            r"\$([\d.]+)\s*billion\s+"
            r"of\s+debt",

            r"\$([\d.]+)\s*billion\s+"
            r"of\s+debt(?:\s+and|,)",

            r"debt[^$]{0,120}"
            r"\$([\d.]+)\s*billion"

        ]
    )


    # -----------------------------------------
    # Preferred Stock
    # -----------------------------------------

    preferred = first_match(
        text,
        [

            r"deducting\s+"
            r"\$([\d.]+)\s*billion\s+"
            r"of\s+preferred\s+stock",

            r"\$([\d.]+)\s*billion\s+"
            r"of\s+preferred\s+stock",

            r"preferred\s+stock[^$]{0,120}"
            r"\$([\d.]+)\s*billion"

        ]
    )


    # -----------------------------------------
    # Net Reserve
    # -----------------------------------------

    net_reserve = first_match(
        text,
        [

            r"\$([\d.]+)\s*billion\s+"
            r"of\s+Net\s+Reserve",

            r"Net\s+Reserve[^$]{0,120}"
            r"\$([\d.]+)\s*billion"

        ]
    )


    return {

        "btcHoldings":
            btc,

        "usdAssetsUsdB":
            usd_assets,

        "debtUsdB":
            debt,

        "preferredUsdB":
            preferred,

        "netReserveUsdB":
            net_reserve,

        "filingDate":
            filing["filingDate"],

        "accession":
            filing["accession"],

        "document":
            filing["primaryDocument"]

    }


def update_from_sec(data):

    filings = (
        get_recent_8k_filings()
    )

    capital_stack = None

    btc_source = None


    for filing in filings:

        try:

            parsed = parse_8k_text(
                filing
            )

        except Exception as exc:

            print(
                "WARNING: Failed to parse "
                "SEC 8-K",
                filing["accession"],
                exc
            )

            continue


        # -------------------------------------
        # BTC
        # -------------------------------------

        btc = (
            parsed.get(
                "btcHoldings"
            )
        )

        if (

            btc is not None

            and
            700000 <
            btc <
            1000000

            and
            btc_source is None

        ):

            btc_source = parsed


        # -------------------------------------
        # Capital Stack
        #
        # IMPORTANT:
        # 네 가지 값이 같은 SEC filing에서
        # 모두 발견됐을 때만 교체한다.
        # -------------------------------------

        if (

            parsed.get(
                "usdAssetsUsdB"
            ) is not None

            and

            parsed.get(
                "debtUsdB"
            ) is not None

            and

            parsed.get(
                "preferredUsdB"
            ) is not None

            and

            parsed.get(
                "netReserveUsdB"
            ) is not None

            and

            capital_stack is None

        ):

            capital_stack = parsed


        if (
            btc_source
            and
            capital_stack
        ):

            break


    # -----------------------------------------
    # BTC 저장
    # -----------------------------------------

    if btc_source:

        data["btcHoldings"] = (
            btc_source[
                "btcHoldings"
            ]
        )

        data[
            "lastSecBtcFilingDate"
        ] = btc_source[
            "filingDate"
        ]

        data[
            "lastSecBtcAccession"
        ] = btc_source[
            "accession"
        ]


    # -----------------------------------------
    # Capital Stack 저장
    # -----------------------------------------

    if capital_stack:

        data[
            "usdAssetsUsdB"
        ] = capital_stack[
            "usdAssetsUsdB"
        ]

        data[
            "debtUsdB"
        ] = capital_stack[
            "debtUsdB"
        ]

        data[
            "preferredUsdB"
        ] = capital_stack[
            "preferredUsdB"
        ]

        data[
            "netReserveUsdB"
        ] = capital_stack[
            "netReserveUsdB"
        ]

        data[
            "capitalStackFilingDate"
        ] = capital_stack[
            "filingDate"
        ]

        data[
            "capitalStackAccession"
        ] = capital_stack[
            "accession"
        ]

        print(
            "Capital stack refreshed "
            "from SEC 8-K:",
            capital_stack[
                "filingDate"
            ]
        )

    else:

        print(
            "WARNING: No single recent "
            "SEC 8-K contained a complete "
            "capital-stack snapshot. "
            "Existing capital-stack "
            "values were kept."
        )


def main():

    data = load_data()


    # -----------------------------------------
    # SEC Update
    # -----------------------------------------

    try:

        update_from_sec(
            data
        )

    except Exception as exc:

        print(
            "SEC update failed:",
            exc
        )


    # -----------------------------------------
    # Metadata
    # -----------------------------------------

    data["updatedAt"] = (
        datetime.now(
            timezone.utc
        ).isoformat()
    )

    data["source"] = (
        "Strategy / SEC"
    )

    data["notes"] = (
        "BTC holdings and, when available, "
        "the complete capital-stack snapshot "
        "(USD Assets, Debt, Preferred Stock "
        "and Net Reserve) are refreshed from "
        "recent Strategy SEC 8-K filings. "
        "Capital-stack values are only replaced "
        "when all four figures are found in the "
        "same filing, preventing mixed-date data."
    )


    # -----------------------------------------
    # Sanity Check
    # -----------------------------------------

    if not (

        isinstance(
            data.get(
                "btcHoldings"
            ),
            (int, float)
        )

        and

        700000 <
        data[
            "btcHoldings"
        ] <
        1000000

    ):

        raise RuntimeError(
            "Invalid BTC holdings: "
            f"{data.get('btcHoldings')}"
        )


    for key in (

        "usdAssetsUsdB",

        "debtUsdB",

        "preferredUsdB"

    ):

        value = data.get(
            key
        )

        if not (

            isinstance(
                value,
                (int, float)
            )

            and

            value >= 0

        ):

            raise RuntimeError(
                f"Invalid {key}: "
                f"{value}"
            )


    # -----------------------------------------
    # Save
    # -----------------------------------------

    DATA_FILE.write_text(

        json.dumps(
            data,
            indent=2,
            ensure_ascii=False
        )

        + "\n",

        encoding="utf-8"
    )


    print(
        json.dumps(
            data,
            indent=2,
            ensure_ascii=False
        )
    )


if __name__ == "__main__":
    main()
