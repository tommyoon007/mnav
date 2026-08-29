const state = {
  data: null,
  lastBtcPrice: NaN,
  lastMstrPrice: NaN,
  lastPriceUpdate: null
};

const $ = (id) => document.getElementById(id);


/* =========================
   표시 함수
========================= */

function money(value) {
  if (!Number.isFinite(value)) return "-";

  return "$" + value.toLocaleString("en-US", {
    maximumFractionDigits: 2
  });
}

function moneyB(value) {
  if (!Number.isFinite(value)) return "-";

  return "$" + value.toLocaleString("en-US", {
    maximumFractionDigits: 3
  }) + "B";
}

function sats(value) {
  if (!Number.isFinite(value)) return "-";

  return Math.round(value).toLocaleString("en-US") + " sats";
}

function btc(value) {
  if (!Number.isFinite(value)) return "-";

  return value.toLocaleString("en-US", {
    maximumFractionDigits: 2
  }) + " BTC";
}


/* =========================
   회사 데이터
========================= */

async function loadData() {

  try {

    const response = await fetch(
      "data.json?ts=" + Date.now(),
      {
        cache: "no-store"
      }
    );

    if (!response.ok) {
      throw new Error("data.json load failed");
    }

    state.data = await response.json();

    $("btcHoldings").value =
      state.data.btcHoldings;

    $("assumedShares").value =
      state.data.adso;

    $("fullyDilutedShares").value =
      state.data.fdso;

    $("dataStatus").textContent =
      "회사 데이터 업데이트: " +
      (
        state.data.updatedAt
          ? new Date(
              state.data.updatedAt
            ).toLocaleString("ko-KR")
          : "정보 없음"
      );

    await loadPrices();

  } catch (error) {

    console.error(
      "Company data error:",
      error
    );

    $("dataStatus").textContent =
      "회사 데이터 불러오기 실패";
  }
}


/* =========================
   BTC 가격
========================= */

async function getBtcPrice() {

  try {

    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      {
        cache: "no-store"
      }
    );

    if (!response.ok) {
      throw new Error("CoinGecko HTTP " + response.status);
    }

    const data =
      await response.json();

    const price =
      Number(data?.bitcoin?.usd);

    if (
      !Number.isFinite(price) ||
      price <= 0
    ) {
      throw new Error("Invalid BTC price");
    }

    return price;

  } catch (error) {

    console.error(
      "BTC price error:",
      error
    );

    return NaN;
  }
}


/* =========================
   MSTR 가격
   1순위: Nasdaq
   2순위: Yahoo
========================= */

async function getMstrPrice() {


  /* -------------------------
     1. Nasdaq
  ------------------------- */

  try {

    const url =
      "https://api.nasdaq.com/api/quote/MSTR/info?assetclass=stocks";

    const response =
      await fetch(
        url,
        {
          cache: "no-store"
        }
      );

    if (!response.ok) {
      throw new Error(
        "Nasdaq HTTP " +
        response.status
      );
    }

    const json =
      await response.json();

    const raw =
      json?.data?.primaryData?.lastSalePrice;

    if (raw) {

      const price =
        Number(
          String(raw)
            .replace("$", "")
            .replace(",", "")
            .trim()
        );

      if (
        Number.isFinite(price) &&
        price > 0
      ) {

        console.log(
          "MSTR price source: Nasdaq"
        );

        return price;
      }
    }

  } catch (error) {

    console.warn(
      "Nasdaq MSTR price failed:",
      error
    );
  }


  /* -------------------------
     2. Yahoo Finance
  ------------------------- */

  try {

    const url =
      "https://query1.finance.yahoo.com/v8/finance/chart/MSTR?range=1d&interval=1m&_=" +
      Date.now();

    const response =
      await fetch(
        url,
        {
          cache: "no-store"
        }
      );

    if (!response.ok) {
      throw new Error(
        "Yahoo HTTP " +
        response.status
      );
    }

    const json =
      await response.json();

    const price =
      Number(
        json?.chart?.result?.[0]
          ?.meta?.regularMarketPrice
      );

    if (
      Number.isFinite(price) &&
      price > 0
    ) {

      console.log(
        "MSTR price source: Yahoo"
      );

      return price;
    }

  } catch (error) {

    console.warn(
      "Yahoo MSTR price failed:",
      error
    );
  }


  return NaN;
}


/* =========================
   실시간 가격 갱신
========================= */

async function loadPrices() {

  const btcPrice =
    await getBtcPrice();

  const mstrPrice =
    await getMstrPrice();


  /* -------------------------
     BTC
  ------------------------- */

  if (
    Number.isFinite(btcPrice)
  ) {

    state.lastBtcPrice =
      btcPrice;

    $("btcPrice").value =
      btcPrice;
  }


  /* -------------------------
     MSTR
  ------------------------- */

  if (
    Number.isFinite(mstrPrice)
  ) {

    state.lastMstrPrice =
      mstrPrice;

    $("mstrPrice").value =
      mstrPrice;
  }


  state.lastPriceUpdate =
    new Date();


  /* -------------------------
     상태 표시
  ------------------------- */

  updatePriceStatus();

  calculate();
}


function updatePriceStatus() {

  const existing =
    $("priceStatus");


  if (!existing) {

    const element =
      document.createElement("div");

    element.id =
      "priceStatus";

    element.className =
      "small";

    element.style.marginTop =
      "8px";

    $("mstrPrice")
      .parentElement
      .appendChild(element);
  }


  const text =
    state.lastPriceUpdate
      ? "가격 자동 업데이트: " +
        state.lastPriceUpdate.toLocaleTimeString(
          "ko-KR"
        )
      : "가격 업데이트 대기 중";

  $("priceStatus").textContent =
    text;
}


/* =========================
   핵심 계산
========================= */

function calculate() {

  if (!state.data) {
    return;
  }


  const btcPrice =
    parseFloat(
      $("btcPrice").value
    );

  const mstrPrice =
    parseFloat(
      $("mstrPrice").value
    );


  const holdings =
    Number(
      state.data.btcHoldings
    );

  const adso =
    Number(
      state.data.adso
    );

  const fdso =
    Number(
      state.data.fdso
    );

  const usdAssetsUsdB =
    Number(
      state.data.usdAssetsUsdB
    );

  const debtUsdB =
    Number(
      state.data.debtUsdB
    );

  const preferredUsdB =
    Number(
      state.data.preferredUsdB
    );


  if (
    !Number.isFinite(btcPrice) ||
    btcPrice <= 0 ||
    !Number.isFinite(holdings) ||
    !Number.isFinite(adso) ||
    !Number.isFinite(fdso)
  ) {

    return;
  }


  /* =========================
     BTC 총 가치
  ========================= */

  const btcValue =
    holdings *
    btcPrice;


  /* =========================
     USD Assets
  ========================= */

  const usdAssets =
    usdAssetsUsdB *
    1e9;


  /* =========================
     Debt
  ========================= */

  const debt =
    debtUsdB *
    1e9;


  /* =========================
     Preferred
  ========================= */

  const preferred =
    preferredUsdB *
    1e9;


  /* =========================
     Net Reserve
     
     BTC
     + USD Assets
     - Debt
     - Preferred
  ========================= */

  const netReserveUsd =
    btcValue +
    usdAssets -
    debt -
    preferred;


  /* =========================
     Net BTC
  ========================= */

  const netBtc =
    netReserveUsd /
    btcPrice;


  /* =========================
     Gross BPS
  ========================= */

  const grossBpsSats =
    holdings *
    1e8 /
    (adso * 1e6);


  /* =========================
     Net BPS
  ========================= */

  const netBpsSats =
    netBtc *
    1e8 /
    (fdso * 1e6);


  /* =========================
     USD BPS
  ========================= */

  const grossBpsUsd =
    btcValue /
    (adso * 1e6);


  const netBpsUsd =
    netReserveUsd /
    (fdso * 1e6);


  /* =========================
     mNAV
  ========================= */

  const mnav =
    Number.isFinite(mstrPrice) &&
    mstrPrice > 0 &&
    netBpsUsd > 0
      ? mstrPrice /
        netBpsUsd
      : NaN;


  /* =========================
     화면 출력
  ========================= */

  $("grossBpsSats").textContent =
    sats(grossBpsSats);


  $("netBpsSats").textContent =
    sats(netBpsSats);


  $("netBpsUsd").textContent =
    money(netBpsUsd);


  $("mnavMultiple").textContent =
    Number.isFinite(mnav)
      ? mnav.toFixed(2) + "×"
      : "-";


  $("premium").textContent =
    Number.isFinite(mnav)
      ? (
          (mnav - 1) * 100
        ).toFixed(1) +
        "% " +
        (
          mnav >= 1
            ? "프리미엄"
            : "디스카운트"
        )
      : "-";


  $("btcTotalValue").textContent =
    moneyB(
      btcValue / 1e9
    );


  $("seniorClaims").textContent =
    moneyB(
      (
        debt +
        preferred
      ) / 1e9
    );


  $("reserveValue").textContent =
    moneyB(
      usdAssets / 1e9
    );


  $("netBtc").textContent =
    btc(netBtc);


  $("grossBpsUsd").textContent =
    money(grossBpsUsd);


  $("fdsoDisplay").textContent =
    fdso.toLocaleString(
      "en-US",
      {
        maximumFractionDigits: 3
      }
    ) + "M";


  updateSignal(mnav);

  buildScenarioTable();
}


/* =========================
   mNAV 신호
========================= */

function updateSignal(mnav) {

  const element =
    $("signal");


  if (!Number.isFinite(mnav)) {

    element.textContent =
      "MSTR 주가 데이터를 기다리는 중";

    return;
  }


  if (mnav >= 3) {

    element.textContent =
      "🔴 3× 이상 — 매우 높은 프리미엄";

  } else if (mnav >= 2) {

    element.textContent =
      "🟠 2–3× — 높은 프리미엄";

  } else if (mnav >= 1.5) {

    element.textContent =
      "🟡 1.5–2× — 중간 프리미엄";

  } else if (mnav >= 1) {

    element.textContent =
      "🟢 1–1.5× — 비교적 낮은 프리미엄";

  } else {

    element.textContent =
      "🔵 1× 미만 — Net BTC 가치보다 낮음";
  }
}


/* =========================
   목표 BTC 가격
========================= */

function calculateNetBpsAtBtcPrice(
  targetBtcPrice
) {

  const holdings =
    Number(
      state.data.btcHoldings
    );

  const fdso =
    Number(
      state.data.fdso
    );

  const usdAssets =
    Number(
      state.data.usdAssetsUsdB
    ) *
    1e9;

  const debt =
    Number(
      state.data.debtUsdB
    ) *
    1e9;

  const preferred =
    Number(
      state.data.preferredUsdB
    ) *
    1e9;


  const btcValue =
    holdings *
    targetBtcPrice;


  const netReserve =
    btcValue +
    usdAssets -
    debt -
    preferred;


  return netReserve /
    (fdso * 1e6);
}


/* =========================
   목표 MSTR 가격
========================= */

function targetPrice() {

  const targetBtc =
    parseFloat(
      $("targetBtcPrice").value
    );

  const targetMnav =
    parseFloat(
      $("targetMnav").value
    );


  if (
    !Number.isFinite(targetBtc) ||
    targetBtc <= 0 ||
    !Number.isFinite(targetMnav) ||
    targetMnav <= 0
  ) {

    return;
  }


  const netBps =
    calculateNetBpsAtBtcPrice(
      targetBtc
    );


  const predicted =
    netBps *
    targetMnav;


  $("predictedMstrPrice").textContent =
    money(predicted);


  $("predictedNetBps").textContent =
    `BTC ${money(targetBtc)} → Net BPS ${money(netBps)} × ${targetMnav.toFixed(2)}×`;
}


/* =========================
   시나리오
========================= */

function buildScenarioTable() {

  const tbody =
    $("scenarioTable");

  if (!state.data) {
    return;
  }


  const mnavs =
    [
      1,
      1.25,
      1.5,
      2,
      2.5,
      3
    ];


  const prices =
    [
      70000,
      80000,
      90000,
      100000,
      120000,
      150000
    ];


  tbody.innerHTML =
    prices.map(
      (btcPrice) => {

        const netBps =
          calculateNetBpsAtBtcPrice(
            btcPrice
          );


        return `
          <tr>
            <td>
              <strong>
                $${(
                  btcPrice / 1000
                ).toFixed(0)}K
              </strong>
            </td>

            ${mnavs.map(
              (mnav) =>
                `<td>${money(
                  netBps * mnav
                )}</td>`
            ).join("")}

          </tr>
        `;
      }
    ).join("");
}


/* =========================
   시작
========================= */

document.addEventListener(
  "DOMContentLoaded",
  async () => {

    await loadData();


    $("btcPrice").addEventListener(
      "input",
      calculate
    );


    $("mstrPrice").addEventListener(
      "input",
      calculate
    );


    $("targetBtcPrice").addEventListener(
      "input",
      targetPrice
    );


    $("targetMnav").addEventListener(
      "input",
      targetPrice
    );


    /*
      60초마다 가격 갱신
    */

    setInterval(
      loadPrices,
      60000
    );
  }
);
