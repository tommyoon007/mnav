import json
import re
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

DATA_FILE = Path("data.json")

SEC_SUBMISSIONS = "https://data.sec.gov/submissions/CIK0001050446.json"

HEADERS = {
    "User-Agent": "tommyoon007-mnav/1.0 contact: github"
}


def load_data():
    if DATA_FILE.exists():
        try:
            return json.loads(DATA_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass

    return {
        "updatedAt": None,
        "source": "Strategy / SEC",
        "btcHoldings": 840447,
        "adso": 427.308,
        "fdso": 419.9,
        "btcReserveUsdB": 64.718,
        "usdReserveUsdB": 5.10,
        "usdCashUsdB": 1.59,
        "debtUsdB": 6.754,
        "preferredUsdB": 14.966,
        "netReserveUsdB": 49.683,
        "notes": ""
    }


def sec_get(url):
    response = requests.get(
        url,
        headers=HEADERS,
        timeout=30
    )
    response.raise_for_status()
    return response.text


def get_latest_strategy_8k():
    response = requests.get(
        SEC_SUBMISSIONS,
        headers=HEADERS,
        timeout=30
    )
    response.raise_for_status()

    data = response.json()
    recent = data["filings"]["recent"]

    for i, form in enumerate(recent["form"]):
        if form == "8-K":
            return {
                "accession": recent["accessionNumber"][i],
                "primaryDocument": recent["primaryDocument"][i],
                "filingDate": recent["filingDate"][i]
            }

    return None


def clean_number(value):
    return float(
        value
        .replace(",", "")
        .replace("$", "")
        .strip()
    )


def extract_btc(text):
    patterns = [
        r"Aggregate BTC Holdings\s+([\d,]+)",
        r"BTC Holdings\s+([\d,]+)",
        r"holds\s+([\d,]+)\s+bitcoin",
        r"hold(?:s|ing)\s+([\d,]+)\s+bitcoin"
    ]

    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return clean_number(match.group(1))

    return None


def parse_sec_8k(filing):
    accession = filing["accession"].replace("-", "")
    document = filing["primaryDocument"]

    url = (
        f"https://www.sec.gov/Archives/edgar/data/"
        f"1050446/{accession}/{document}"
    )

    html = sec_get(url)
    soup = BeautifulSoup(html, "html.parser")

    text = soup.get_text(" ", strip=True)

    return {
        "btcHoldings": extract_btc(text),
        "filingDate": filing["filingDate"]
    }


def main():
    data = load_data()

    try:
        filing = get_latest_strategy_8k()

        if filing:
            print("Latest SEC 8-K:", filing)

            parsed = parse_sec_8k(filing)

            if (
                parsed.get("btcHoldings")
                and 700000 < parsed["btcHoldings"] < 1000000
            ):
                data["btcHoldings"] = parsed["btcHoldings"]

            data["lastSecFilingDate"] = parsed["filingDate"]

    except Exception as exc:
        print("SEC update failed:", exc)

    data["updatedAt"] = datetime.now(
        timezone.utc
    ).isoformat()

    data["source"] = "Strategy / SEC"

    data["notes"] = (
        "BTC holdings are refreshed from the latest Strategy SEC 8-K "
        "when available. Capital-stack values remain at the last "
        "verified Strategy baseline until independently parsed."
    )

    # Final sanity check.
    if not (
        isinstance(data.get("btcHoldings"), (int, float))
        and 700000 < data["btcHoldings"] < 1000000
    ):
        raise RuntimeError(
            f"Invalid BTC holdings: {data.get('btcHoldings')}"
        )

    DATA_FILE.write_text(
        json.dumps(
            data,
            indent=2,
            ensure_ascii=False
        ) + "\n",
        encoding="utf-8"
    )

    print(json.dumps(data, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
