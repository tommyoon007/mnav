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

async function loadData() {
  try {
    const response = await fetch(
      "data.json?ts=" + Date.now(),
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error("data.json load failed");
    }

    state.data = await response.json();

    $("btcHoldings").value = state.data.btcHoldings;
    $("assumedShares").value = state.data.adso;
    $("fullyDilutedShares").value = state.data.fdso;

    $("dataStatus").textContent =
      "자동 데이터 업데이트: " +
      (
        state.data.updatedAt
          ? new Date(state.data.updatedAt).toLocaleString("ko-KR")
          : "정보 없음"
      );

    await loadPrices();

  } catch (error) {
    console.error(error);

    $("dataStatus").textContent =
      "자동 데이터 불러오기 실패";
  }
}

async function loadPrices() {

  let btcPrice = NaN;
  let mstrPrice = NaN;

  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      { cache: "no-store" }
    );

    const data = await response.json();

    btcPrice = data?.bitcoin?.usd;

  } catch (error) {
    console.error("BTC price error", error);
  }

  try {
    const response = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/MSTR?range=1d&interval=1m",
      { cache: "no-store" }
    );

    const data = await response.json();

    mstrPrice =
      data?.chart?.result?.[0]?.meta?.regularMarketPrice;

  } catch (error) {
    console.error("MSTR price error", error);
  }

  $("btcPrice").value =
    Number.isFinite(btcPrice) ? btcPrice : "";

  $("mstrPrice").value =
    Number.isFinite(mstrPrice) ? mstrPrice : "";

  calculate();
}

function calculate() {

  if (!state.data) return;

  const btcPrice = parseFloat($("btcPrice").value);
  const mstrPrice = parseFloat($("mstrPrice").value);

  const holdings = Number(state.data.btcHoldings);
  const adso = Number(state.data.adso);
  const fdso = Number(state.data.fdso);
  const netReserveUsdB = Number(state.data.netReserveUsdB);

  if (
    !Number.isFinite(btcPrice) ||
    !Number.isFinite(holdings) ||
    !Number.isFinite(fdso) ||
    !Number.isFinite(netReserveUsdB)
  ) {
    return;
  }

  const btcReserveUsd =
    Number(state.data.btcReserveUsdB) * 1e9;

  const netReserveUsd =
    netReserveUsdB * 1e9;

  const grossBpsSats =
    holdings * 1e8 /
    (adso * 1e6);

  const netBpsSats =
    (netReserveUsd / btcPrice) * 1e8 /
    (fdso * 1e6);

  const grossBpsUsd =
    btcReserveUsd /
    (adso * 1e6);

  const netBpsUsd =
    netReserveUsd /
    (fdso * 1e6);

  const mnav =
    Number.isFinite(mstrPrice) && mstrPrice > 0
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
        ).toFixed(1) + "% " +
        (mnav >= 1
          ? "프리미엄"
          : "디스카운트")
      : "-";

  $("btcTotalValue").textContent =
    moneyB(btcReserveUsd / 1e9);

  $("seniorClaims").textContent =
    moneyB(
      (
        Number(state.data.debtUsdB) +
        Number(state.data.preferredUsdB)
      )
    );

  $("reserveValue").textContent =
    moneyB(state.data.usdReserveUsdB);

  $("netBtc").textContent =
    btc(netReserveUsd / btcPrice);

  $("grossBpsUsd").textContent =
    money(grossBpsUsd);

  $("fdsoDisplay").textContent =
    fdso.toLocaleString("en-US", {
      maximumFractionDigits: 3
    }) + "M";

  updateSignal(mnav);
  buildScenarioTable();
}

function updateSignal(mnav) {

  const element = $("signal");

  if (!Number.isFinite(mnav)) {
    element.textContent = "MSTR 주가 데이터를 기다리는 중";
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

function targetPrice() {

  const targetBtc =
    parseFloat($("targetBtcPrice").value);

  const targetMnav =
    parseFloat($("targetMnav").value);

  if (
    !Number.isFinite(targetBtc) ||
    !Number.isFinite(targetMnav)
  ) {
    return;
  }

  const netReserveUsd =
    Number(state.data.netReserveUsdB) * 1e9;

  const netBpsUsd =
    netReserveUsd /
    (
      Number(state.data.fdso) * 1e6
    );

  const predicted =
    netBpsUsd * targetMnav;

  $("predictedMstrPrice").textContent =
    money(predicted);

  $("predictedNetBps").textContent =
    `Net BPS ${money(netBpsUsd)} × ${targetMnav.toFixed(2)}×`;
}

function buildScenarioTable() {

  const tbody = $("scenarioTable");

  if (!state.data) return;

  const mnavs =
    [1, 1.25, 1.5, 2, 2.5, 3];

  const prices =
    [70000, 80000, 90000, 100000, 120000, 150000];

  const fdso =
    Number(state.data.fdso);

  const netReserveUsd =
    Number(state.data.netReserveUsdB) * 1e9;

  tbody.innerHTML =
    prices.map((btcPrice) => {

      const netBps =
        netReserveUsd /
        (fdso * 1e6);

      return `
        <tr>
          <td><strong>$${(btcPrice / 1000).toFixed(0)}K</strong></td>
          ${mnavs.map((mnav) =>
            `<td>${money(netBps * mnav)}</td>`
          ).join("")}
        </tr>
      `;

    }).join("");
}

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

    setInterval(loadPrices, 60000);
  }
);
