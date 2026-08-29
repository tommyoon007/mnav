const state = {
  data: null,
  live: null
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

    if ($("btcHoldings")) {
      $("btcHoldings").value =
        state.data.btcHoldings ?? "";
      $("btcHoldings").readOnly = true;
    }

    if ($("assumedShares")) {
      $("assumedShares").value =
        state.data.adso ?? "";
      $("assumedShares").readOnly = true;
    }

    if ($("fullyDilutedShares")) {
      $("fullyDilutedShares").value =
        state.data.fdso ?? "";
      $("fullyDilutedShares").readOnly = true;
    }

    if ($("dataStatus")) {
      const companyTime =
        state.data.updatedAt
          ? new Date(
              state.data.updatedAt
            ).toLocaleString("ko-KR")
          : "정보 없음";

      $("dataStatus").textContent =
        "회사 데이터: " + companyTime;
    }

  } catch (error) {
    console.error(error);

    if ($("dataStatus")) {
      $("dataStatus").textContent =
        "회사 데이터 불러오기 실패";
    }
  }
}


/* =========================
   실시간 가격
========================= */

async function loadLivePrices() {
  try {
    const response = await fetch(
      "live.json?ts=" + Date.now(),
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error(
        "live.json " + response.status
      );
    }

    state.live = await response.json();

    const btcPrice =
      Number(state.live.btcPrice);

    const mstrPrice =
      Number(state.live.mstrPrice);

    if (
      Number.isFinite(btcPrice) &&
      btcPrice > 0 &&
      $("btcPrice")
    ) {
      $("btcPrice").value =
        btcPrice;
      $("btcPrice").readOnly = true;
    }

    if (
      Number.isFinite(mstrPrice) &&
      mstrPrice > 0 &&
      $("mstrPrice")
    ) {
      $("mstrPrice").value =
        mstrPrice;
      $("mstrPrice").readOnly = true;
    }

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


/* =========================
   가격 상태
========================= */

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
      $("btcPrice")?.value
    );

  const mstrPrice =
    parseFloat(
      $("mstrPrice")?.value
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


  if ($("grossBpsSats")) {
    $("grossBpsSats").textContent =
      sats(grossBpsSats);
  }

  if ($("netBpsSats")) {
    $("netBpsSats").textContent =
      sats(netBpsSats);
  }

  if ($("netBpsUsd")) {
    $("netBpsUsd").textContent =
      money(netBpsUsd);
  }

  if ($("mnavMultiple")) {
    $("mnavMultiple").textContent =
      Number.isFinite(mnav)
        ? mnav.toFixed(2) + "×"
        : "-";
  }

  if ($("premium")) {
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
  }

  if ($("btcTotalValue")) {
    $("btcTotalValue").textContent =
      moneyB(btcValue / 1e9);
  }

  if ($("seniorClaims")) {
    $("seniorClaims").textContent =
      moneyB(
        (debt + preferred) / 1e9
      );
  }

  if ($("reserveValue")) {
    $("reserveValue").textContent =
      moneyB(usdAssets / 1e9);
  }

  if ($("netBtc")) {
    $("netBtc").textContent =
      btc(netBtc);
  }

  if ($("grossBpsUsd")) {
    $("grossBpsUsd").textContent =
      money(grossBpsUsd);
  }

  if ($("fdsoDisplay")) {
    $("fdsoDisplay").textContent =
      fdso.toLocaleString(
        "en-US",
        {
          maximumFractionDigits: 3
        }
      ) + "M";
  }

  updateSignal(mnav);

  buildScenarioTable();
}


/* =========================
   mNAV 시그널
========================= */

function updateSignal(mnav) {

  const element =
    $("signal");

  if (!element) return;

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
   목표값 저장
========================= */

function loadSavedTargets() {

  const savedBtc =
    localStorage.getItem(
      "mnav_target_btc"
    );

  const savedMnav =
    localStorage.getItem(
      "mnav_target_mnav"
    );

  if (
    savedBtc !== null &&
    $("targetBtcPrice")
  ) {
    $("targetBtcPrice").value =
      savedBtc;
  }

  if (
    savedMnav !== null &&
    $("targetMnav")
  ) {
    $("targetMnav").value =
      savedMnav;
  }

  targetPrice();
}


function saveTargetBtc() {

  const value =
    $("targetBtcPrice")?.value;

  if (value !== undefined) {

    localStorage.setItem(
      "mnav_target_btc",
      value
    );
  }

  targetPrice();
}


function saveTargetMnav() {

  const value =
    $("targetMnav")?.value;

  if (value !== undefined) {

    localStorage.setItem(
      "mnav_target_mnav",
      value
    );
  }

  targetPrice();
}


/* =========================
   목표 BTC 가격 계산
========================= */

function calculateNetBpsAtBtcPrice(
  targetBtcPrice
) {

  if (!state.data) {
    return NaN;
  }

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

  if (
    !$("targetBtcPrice") ||
    !$("targetMnav")
  ) {
    return;
  }

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

  if ($("predictedMstrPrice")) {
    $("predictedMstrPrice").textContent =
      money(predicted);
  }

  if ($("predictedNetBps")) {
    $("predictedNetBps").textContent =
      `BTC ${money(targetBtc)} → Net BPS ${money(netBps)} × ${targetMnav.toFixed(2)}×`;
  }
}


/* =========================
   시나리오
========================= */

function buildScenarioTable() {

  const tbody =
    $("scenarioTable");

  if (!tbody || !state.data) {
    return;
  }

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
   빠른 시나리오 버튼
========================= */

function scenario(btcPrice) {

  const targetBtc =
    $("targetBtcPrice");

  const targetMnav =
    $("targetMnav");

  if (!targetBtc || !targetMnav) {
    return;
  }

  /* BTC 목표가격 자동 입력 */
  targetBtc.value =
    btcPrice;

  /* 목표 mNAV가 비어 있으면 1.5 */
  const currentMnav =
    parseFloat(
      targetMnav.value
    );

  if (
    !Number.isFinite(currentMnav) ||
    currentMnav <= 0
  ) {
    targetMnav.value = "1.5";
  }

  /* 저장 */
  localStorage.setItem(
    "mnav_target_btc",
    targetBtc.value
  );

  localStorage.setItem(
    "mnav_target_mnav",
    targetMnav.value
  );

  /* 계산 */
  targetPrice();

  /* 화면 이동 */
  const section =
    document.querySelector(
      ".quick-calc-section"
    );

  if (section) {

    window.scrollTo({
      top:
        section.offsetTop - 15,
      behavior: "smooth"
    });
  }
}


/* =========================
   시작
========================= */

document.addEventListener(
  "DOMContentLoaded",
  async () => {

    await loadCompanyData();

    await loadLivePrices();

    /* 목표값 자동 저장 */

    $("targetBtcPrice")
      ?.addEventListener(
        "input",
        saveTargetBtc
      );

    $("targetMnav")
      ?.addEventListener(
        "input",
        saveTargetMnav
      );

    /* 저장된 목표값 불러오기 */

    loadSavedTargets();

    /* 1분마다 실시간 가격 확인 */

    setInterval(
      loadLivePrices,
      60000
    );
  }
);
