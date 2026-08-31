const state = {
  data: null,
  live: null,
  dataLoadFailed: false
};

const $ = (id) => document.getElementById(id);

/* =========================
   표시 포맷 함수
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
   계산 상태 메시지
========================= */

function setCalcStatus(message) {
  let element = $("calcStatus");

  if (!element) {
    element = document.createElement("div");
    element.id = "calcStatus";
    element.className = "small";
    element.style.marginTop = "8px";
    element.style.color = "#c0392b";

    const resultSection = document.querySelector(".result-section");
    if (resultSection) {
      resultSection.appendChild(element);
    }
  }

  element.textContent = message || "";
  element.style.display = message ? "block" : "none";
}

/* =========================
   회사 데이터 (data.json)
========================= */

const DATA_RETRY_DELAY_MS = 10000;
let dataRetryTimer = null;

async function loadCompanyData() {
  try {
    const response = await fetch(
      "data.json?ts=" + Date.now(),
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error("data.json " + response.status);
    }

    const json = await response.json();

    const requiredNumericFields = ["btcHoldings", "adso", "fdso"];
    const missingRequired = requiredNumericFields.filter(
      (key) => !Number.isFinite(Number(json?.[key]))
    );

    if (missingRequired.length > 0) {
      throw new Error(
        "data.json 필수 필드 누락: " + missingRequired.join(", ")
      );
    }

    state.data = json;
    state.dataLoadFailed = false;

    if (dataRetryTimer) {
      clearInterval(dataRetryTimer);
      dataRetryTimer = null;
    }

    if ($("btcHoldings")) {
      $("btcHoldings").value = state.data.btcHoldings ?? "";
      $("btcHoldings").readOnly = true;
    }

    if ($("assumedShares")) {
      $("assumedShares").value = state.data.adso ?? "";
      $("assumedShares").readOnly = true;
    }

    if ($("fullyDilutedShares")) {
      $("fullyDilutedShares").value = state.data.fdso ?? "";
      $("fullyDilutedShares").readOnly = true;
    }

    if ($("dataStatus")) {
      const companyTime = state.data.updatedAt
        ? new Date(state.data.updatedAt).toLocaleString("ko-KR")
        : "정보 없음";

      $("dataStatus").textContent = "회사 데이터: " + companyTime;
    }

    calculate();

  } catch (error) {
    console.error(error);
    state.dataLoadFailed = true;

    if ($("dataStatus")) {
      $("dataStatus").textContent =
        "회사 데이터 불러오기 실패 — " + (DATA_RETRY_DELAY_MS / 1000) + "초마다 재시도 중";
    }

    setCalcStatus(
      "⚠️ 회사 데이터(data.json)를 불러오지 못해 mNAV를 계산할 수 없습니다. 재시도 중입니다."
    );

    if (!dataRetryTimer) {
      dataRetryTimer = setInterval(loadCompanyData, DATA_RETRY_DELAY_MS);
    }
  }
}

/* =========================
   실시간 가격 (live.json)
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

    const btcPrice = Number(state.live.btcPrice);
    const mstrPrice = Number(state.live.mstrPrice);

    if (Number.isFinite(btcPrice) && btcPrice > 0 && $("btcPrice")) {
      $("btcPrice").value = btcPrice;
      $("btcPrice").readOnly = true;
    }

    if (Number.isFinite(mstrPrice) && mstrPrice > 0 && $("mstrPrice")) {
      $("mstrPrice").value = mstrPrice;
      $("mstrPrice").readOnly = true;
    }

    updatePriceStatus();
    calculate();

  } catch (error) {
    console.error("Live price error:", error);

    if ($("btcPrice")) $("btcPrice").readOnly = false;
    if ($("mstrPrice")) $("mstrPrice").readOnly = false;

    updatePriceStatus(true);
    calculate();
  }
}

/* =========================
   가격 상태 표시
========================= */

function updatePriceStatus(error = false) {
  let element = $("priceStatus");

  if (!element) {
    element = document.createElement("div");
    element.id = "priceStatus";
    element.className = "small";
    element.style.marginTop = "8px";

    const mstrInput = $("mstrPrice");
    if (mstrInput && mstrInput.parentElement) {
      mstrInput.parentElement.appendChild(element);
    }
  }

  if (error) {
    element.textContent = "가격 자동 업데이트 실패 — 수동 입력 가능";
    return;
  }

  const updated = state.live?.updatedAt
    ? new Date(state.live.updatedAt).toLocaleString("ko-KR")
    : "정보 없음";

  const source = state.live?.mstrSource ? " · " + state.live.mstrSource : "";
  element.textContent = "가격 업데이트: " + updated + source;
}

/* =========================
   핵심 계산
========================= */

function calculate() {
  if (!state.data) return;

  const btcPrice = parseFloat($("btcPrice")?.value);
  const mstrPrice = parseFloat($("mstrPrice")?.value);

  const holdings = Number(state.data.btcHoldings);
  const adso = Number(state.data.adso);
  const fdso = Number(state.data.fdso);

  const usdAssetsRaw = state.data.usdAssetsUsdB;
  const debtRaw = state.data.debtUsdB;
  const preferredRaw = state.data.preferredUsdB;

  const optionalFieldWarnings = [];

  const usdAssetsUsdB = Number.isFinite(Number(usdAssetsRaw))
    ? Number(usdAssetsRaw)
    : (optionalFieldWarnings.push("현금성 자산"), 0);

  const debtUsdB = Number.isFinite(Number(debtRaw))
    ? Number(debtRaw)
    : (optionalFieldWarnings.push("부채"), 0);

  const preferredUsdB = Number.isFinite(Number(preferredRaw))
    ? Number(preferredRaw)
    : (optionalFieldWarnings.push("우선주"), 0);

  if (
    !Number.isFinite(btcPrice) || btcPrice <= 0 ||
    !Number.isFinite(holdings) ||
    !Number.isFinite(adso) || adso <= 0 ||
    !Number.isFinite(fdso) || fdso <= 0
  ) {
    setCalcStatus(
      "⚠️ BTC 가격과 회사 데이터(보유량/주식수)가 설정되어야 계산됩니다."
    );
    return;
  }

  if (optionalFieldWarnings.length > 0) {
    setCalcStatus(
      "ℹ️ data.json에 " + optionalFieldWarnings.join(", ") + " 값이 없어 0으로 처리했습니다."
    );
  } else {
    setCalcStatus("");
  }

  const btcValue = holdings * btcPrice;
  const usdAssets = usdAssetsUsdB * 1e9;
  const debt = debtUsdB * 1e9;
  const preferred = preferredUsdB * 1e9;

  const netReserveUsd = btcValue + usdAssets - debt - preferred;
  const netBtc = netReserveUsd / btcPrice;

  const grossBpsSats = (holdings * 1e8) / (adso * 1e6);
  const netBpsSats = (netBtc * 1e8) / (fdso * 1e6);

  const grossBpsUsd = btcValue / (adso * 1e6);
  const netBpsUsd = netReserveUsd / (fdso * 1e6);

  const mnav =
    Number.isFinite(mstrPrice) && mstrPrice > 0 && netBpsUsd > 0
      ? mstrPrice / netBpsUsd
      : NaN;

  if ($("grossBpsSats")) $("grossBpsSats").textContent = sats(grossBpsSats);
  if ($("netBpsSats")) $("netBpsSats").textContent = sats(netBpsSats);
  if ($("netBpsUsd")) $("netBpsUsd").textContent = money(netBpsUsd);

  if ($("mnavMultiple")) {
    $("mnavMultiple").textContent = Number.isFinite(mnav)
      ? mnav.toFixed(2) + "×"
      : "-";
  }

  if ($("premium")) {
    $("premium").textContent = Number.isFinite(mnav)
      ? ((mnav - 1) * 100).toFixed(1) + "% " + (mnav >= 1 ? "프리미엄" : "디스카운트")
      : "-";
  }

  if ($("btcTotalValue")) $("btcTotalValue").textContent = moneyB(btcValue / 1e9);
  if ($("seniorClaims")) $("seniorClaims").textContent = moneyB((debt + preferred) / 1e9);
  if ($("reserveValue")) $("reserveValue").textContent = moneyB(usdAssets / 1e9);
  if ($("netBtc")) $("netBtc").textContent = btc(netBtc);
  if ($("grossBpsUsd")) $("grossBpsUsd").textContent = money(grossBpsUsd);

  if ($("fdsoDisplay")) {
    $("fdsoDisplay").textContent =
      fdso.toLocaleString("en-US", { maximumFractionDigits: 3 }) + "M";
  }

  updateSignal(mnav);
  buildScenarioTable();
  targetPrice();
}

/* =========================
   mNAV 시그널
========================= */

function updateSignal(mnav) {
  const element = $("signal");
  if (!element) return;

  if (!Number.isFinite(mnav)) {
    element.textContent = "MSTR 가격 데이터를 기다리는 중";
    return;
  }

  if (mnav >= 3) {
    element.textContent = "🔴 3× 이상 — 매우 높은 프리미엄";
  } else if (mnav >= 2) {
    element.textContent = "🟠 2–3× — 높은 프리미엄";
  } else if (mnav >= 1.5) {
    element.textContent = "🟡 1.5–2× — 중간 프리미엄";
  } else if (mnav >= 1) {
    element.textContent = "🟢 1–1.5× — 비교적 낮은 프리미엄";
  } else {
    element.textContent = "🔵 1× 미만 — Net BTC 가치보다 낮음";
  }
}

/* =========================
   목표값 로드/저장
========================= */

function loadSavedTargets() {
  const savedBtc = localStorage.getItem("mnav_target_btc");
  const savedMnav = localStorage.getItem("mnav_target_mnav");

  if (savedBtc !== null && $("targetBtcPrice")) {
    $("targetBtcPrice").value = savedBtc;
  }

  if (savedMnav !== null && $("targetMnav")) {
    $("targetMnav").value = savedMnav;
  }

  targetPrice();
}

function saveTargetBtc() {
  const value = $("targetBtcPrice")?.value;
  if (value !== undefined) {
    localStorage.setItem("mnav_target_btc", value);
  }
  targetPrice();
}

function saveTargetMnav() {
  const value = $("targetMnav")?.value;
  if (value !== undefined) {
    localStorage.setItem("mnav_target_mnav", value);
  }
  targetPrice();
}

/* =========================
   목표 BTC 가격 계산
========================= */

function calculateNetBpsAtBtcPrice(targetBtcPrice) {
  if (!state.data) return NaN;

  const holdings = Number(state.data.btcHoldings);
  const fdso = Number(state.data.fdso);

  if (!Number.isFinite(fdso) || fdso <= 0) return NaN;

  const usdAssets = Number.isFinite(Number(state.data.usdAssetsUsdB))
    ? Number(state.data.usdAssetsUsdB) * 1e9
    : 0;

  const debt = Number.isFinite(Number(state.data.debtUsdB))
    ? Number(state.data.debtUsdB) * 1e9
    : 0;

  const preferred = Number.isFinite(Number(state.data.preferredUsdB))
    ? Number(state.data.preferredUsdB) * 1e9
    : 0;

  const btcValue = holdings * targetBtcPrice;
  const netReserve = btcValue + usdAssets - debt - preferred;

  return netReserve / (fdso * 1e6);
}

/* =========================
   목표 MSTR 가격 예측
========================= */

function targetPrice() {
  if (!$("targetBtcPrice") || !$("targetMnav")) return;

  const targetBtc = parseFloat($("targetBtcPrice").value);
  const targetMnav = parseFloat($("targetMnav").value);

  if (
    !Number.isFinite(targetBtc) || targetBtc <= 0 ||
    !Number.isFinite(targetMnav) || targetMnav <= 0
  ) {
    return;
  }

  const netBps = calculateNetBpsAtBtcPrice(targetBtc);

  if (!Number.isFinite(netBps)) {
    if ($("predictedMstrPrice")) $("predictedMstrPrice").textContent = "-";
    return;
  }

  const predicted = netBps * targetMnav;

  if ($("predictedMstrPrice")) {
    $("predictedMstrPrice").textContent = money(predicted);
  }

  if ($("predictedNetBps")) {
    $("predictedNetBps").textContent =
      `BTC ${money(targetBtc)} → Net BPS ${money(netBps)} × ${targetMnav.toFixed(2)}×`;
  }
}

/* =========================
   시나리오 테이블
========================= */

function buildScenarioTable() {
  const tbody = $("scenarioTable");
  if (!tbody || !state.data) return;

  const mnavs = [1, 1.25, 1.5, 2, 2.5, 3];
  const prices = [70000, 80000, 90000, 100000, 120000, 150000];

  tbody.innerHTML = prices.map((btcPrice) => {
    const netBps = calculateNetBpsAtBtcPrice(btcPrice);

    return `
      <tr>
        <td><strong>$${(btcPrice / 1000).toFixed(0)}K</strong></td>
        ${mnavs.map((mnav) =>
          `<td>${Number.isFinite(netBps) ? money(netBps * mnav) : "-"}</td>`
        ).join("")}
      </tr>
    `;
  }).join("");
}

/* =========================
   초기화 및 이벤트 연결
========================= */

document.addEventListener("DOMContentLoaded", async () => {
  await loadCompanyData();
  await loadLivePrices();

  $("targetBtcPrice")?.addEventListener("input", saveTargetBtc);
  $("targetMnav")?.addEventListener("input", saveTargetMnav);

  $("btcPrice")?.addEventListener("input", calculate);
  $("mstrPrice")?.addEventListener("input", calculate);

  loadSavedTargets();

  setInterval(loadLivePrices, 60000);
});
