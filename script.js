const state = {
  data: null,
  live: null
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

async function loadCompanyData() {
  try {
    const response = await fetch(
      "data.json?ts=" + Date.now(),
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error("data.json " + response.status);
    }

    state.data = await response.json();

    $("btcHoldings").value =
      state.data.btcHoldings ?? "";

    $("assumedShares").value =
      state.data.adso ?? "";

    $("fullyDilutedShares").value =
      state.data.fdso ?? "";

    $("btcHoldings").readOnly = true;
    $("assumedShares").readOnly = true;
    $("fullyDilutedShares").readOnly = true;

    const companyTime =
      state.data.updatedAt
        ? new Date(state.data.updatedAt)
            .toLocaleString("ko-KR")
        : "정보 없음";

    $("dataStatus").textContent =
      "회사 데이터: " + companyTime;

  } catch (error) {
    console.error(error);

    $("dataStatus").textContent =
      "회사 데이터 불러오기 실패";
  }
}


/* =========================
   실시간에 가까운 가격 데이터
   live.json은 GitHub Actions가 생성
========================= */

async function loadLivePrices() {
  try {
    const response = await fetch(
      "live.json?ts=" + Date.now(),
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error("live.json " + response.status);
    }

    state.live = await response.json();

    const btcPrice =
      Number(state.live.btcPrice);

    const mstrPrice =
      Number(state.live.mstrPrice);

    if (
      Number.isFinite(btcPrice) &&
      btcPrice > 0
    ) {
      $("btcPrice").value = btcPrice;
    }

    if (
      Number.isFinite(mstrPrice) &&
      mstrPrice > 0
    ) {
      $("mstrPrice").value = mstrPrice;
    }

    $("btcPrice").readOnly = true;
    $("mstrPrice").readOnly = true;

    updatePriceStatus();

    calculate();

  } catch (error) {
    console.error(
      "Live price error:",
      error
    );

    updatePriceStatus(true);
    calculate();
  }
}


function updatePriceStatus(error = false) {

  let element =
    $("priceStatus");

  if (!element) {

    element =
      document.createElement("div");

    element.id =
      "priceStatus";

    element.className =
      "small";

    element.style.marginTop =
      "8px";

    const mstrInput =
      $("mstrPrice");

    if (
      mstrInput &&
      mstrInput.parentElement
    ) {
      mstrInput.parentElement
        .appendChild(element);
    }
  }

  if (error) {
    element.textContent =
      "가격 자동 업데이트 실패 — 마지막 데이터 사용";
    return;
  }

  const updated =
    state.live?.updatedAt
      ? new Date(
          state.live.updatedAt
        ).toLocaleString("ko-KR")
      : "정보 없음";

  const source =
    state.live?.mstrSource
      ? " · " + state.live.mstrSource
      : "";

  element.textContent =
    "가격 업데이트: " +
    updated +
    source;
}


/* =========================
   핵심 계산
========================= */

function calculate() {

  if (!state.data) return;

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


  const btcValue =
    holdings * btcPrice;

  const usdAssets =
    usdAssetsUsdB * 1e9;

  const debt =
    debtUsdB * 1e9;

  const preferred =
    preferredUsdB * 1e9;

  const netReserveUsd =
    btcValue +
    usdAssets -
    debt -
    preferred;

  const netBtc =
    netReserveUsd /
    btcPrice;

  const grossBpsSats =
    holdings *
    1e8 /
    (adso * 1e6);

  const netBpsSats =
    netBtc *
    1e8 /
    (fdso * 1e6);

  const grossBpsUsd =
    btcValue /
    (adso * 1e6);

  const netBpsUsd =
    netReserveUsd /
    (fdso * 1e6);

  const mnav =
    Number.isFinite(mstrPrice) &&
    mstrPrice > 0 &&
    netBpsUsd > 0
      ? mstrPrice / netBpsUsd
      : NaN;


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
    moneyB(btcValue / 1e9);

  $("seniorClaims").textContent =
    moneyB(
      (debt + preferred) / 1e9
    );

  $("reserveValue").textContent =
    moneyB(usdAssets / 1e9);

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
   mNAV 시그널
========================= */

function updateSignal(mnav) {

  const element =
    $("signal");

  if (!Number.isFinite(mnav)) {
    element.textContent =
      "MSTR 가격 데이터를 기다리는 중";
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
    ) * 1e9;

  const debt =
    Number(
      state.data.debtUsdB
    ) * 1e9;

  const preferred =
    Number(
      state.data.preferredUsdB
    ) * 1e9;

  const btcValue =
    holdings * targetBtcPrice;

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
    netBps * targetMnav;

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

  if (!state.data) return;

  const mnavs =
    [1, 1.25, 1.5, 2, 2.5, 3];

  const prices =
    [70000, 80000, 90000, 100000, 120000, 150000];

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

    await loadCompanyData();

    await loadLivePrices();

    $("targetBtcPrice")
      ?.addEventListener(
        "input",
        targetPrice
      );

    $("targetMnav")
      ?.addEventListener(
        "input",
        targetPrice
      );

    /*
      live.json은 5분마다 GitHub Actions가
      새로 생성하지만, 앱은 1분마다 확인한다.
    */

    setInterval(
      loadLivePrices,
      60000
    );
  }
);
