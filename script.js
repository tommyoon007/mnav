const state = {
  data: null
};

const $ = (id) => document.getElementById(id);

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
      "자동 회사 데이터 불러오기 실패";
  }
}


/* =========================
   실시간 가격
========================= */

async function loadPrices() {

  let btcPrice = NaN;
  let mstrPrice = NaN;


  /* BTC */

  try {

    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      {
        cache: "no-store"
      }
    );

    if (!response.ok) {
      throw new Error("CoinGecko error");
    }

    const data =
      await response.json();

    btcPrice =
      Number(data?.bitcoin?.usd);

  } catch (error) {

    console.error(
      "BTC price error:",
      error
    );
  }


  /* MSTR */

  try {

    const response = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/MSTR?range=1d&interval=1m",
      {
        cache: "no-store"
      }
    );

    if (!response.ok) {
      throw new Error("Yahoo Finance error");
    }

    const data =
      await response.json();

    mstrPrice =
      Number(
        data?.chart?.result?.[0]
          ?.meta?.regularMarketPrice
      );

  } catch (error) {

    console.error(
      "MSTR price error:",
      error
    );
  }


  if (Number.isFinite(btcPrice)) {

    $("btcPrice").value =
      btcPrice;
  }

  if (Number.isFinite(mstrPrice)) {

    $("mstrPrice").value =
      mstrPrice;
  }

  calculate();
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
    Number(state.data.btcHoldings);

  const adso =
    Number(state.data.adso);

  const fdso =
    Number(state.data.fdso);

  const usdAssetsUsdB =
    Number(state.data.usdAssetsUsdB);

  const debtUsdB =
    Number(state.data.debtUsdB);

  const preferredUsdB =
    Number(state.data.preferredUsdB);


  if (
    !Number.isFinite(btcPrice) ||
    btcPrice <= 0 ||
    !Number.isFinite(holdings) ||
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
     Senior Claims
  ========================= */

  const debt =
    debtUsdB *
    1e9;

  const preferred =
    preferredUsdB *
    1e9;


  const seniorClaims =
    debt +
    preferred;


  /* =========================
     Net Reserve
     
     BTC + USD Assets
     - OTM Debt
     - OTM Preferred
  ========================= */

  const netReserveUsd =
    btcValue +
    usdAssets -
    seniorClaims;


  /* =========================
     BTC / Share
  ========================= */

  const grossBpsSats =
    holdings *
    1e8 /
    (adso * 1e6);


  const netBtc =
    netReserveUsd /
    btcPrice;


  const netBpsSats =
    netBtc *
    1e8 /
    (fdso * 1e6);


  /* =========================
     USD / Share
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
      ? mstrPrice / netBpsUsd
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
      seniorClaims / 1e9
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
   목표 BTC 가격 계산
========================= */

function calculateNetBpsAtBtcPrice(
  targetBtcPrice
) {

  const holdings =
    Number(state.data.btcHoldings);

  const fdso =
    Number(state.data.fdso);

  const usdAssets =
    Number(state.data.usdAssetsUsdB) *
    1e9;

  const debt =
    Number(state.data.debtUsdB) *
    1e9;

  const preferred =
    Number(state.data.preferredUsdB) *
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
   시나리오 테이블
========================= */

function buildScenarioTable() {

  const tbody =
    $("scenarioTable");

  if (!state.data) {
    return;
  }


  const mnavs =
    [1, 1.25, 1.5, 2, 2.5, 3];


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
      가격은 60초마다 갱신
    */

    setInterval(
      loadPrices,
      60000
    );
  }
);
