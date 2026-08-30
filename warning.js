/* =========================================
   MSTR / BTC / mNAV
   OI / Funding
   4-Level Risk Warning
========================================= */

(function () {

  const WARNING_ID =
    "mnavRiskWarning";

  const HISTORY_URL =
    "history.json?ts=" +
    Date.now();


  /* ---------------------------------------
     Style
  --------------------------------------- */

  function injectStyle() {

    if (
      document.getElementById(
        "mnavRiskWarningStyle"
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "mnavRiskWarningStyle";

    style.textContent = `

      #${WARNING_ID} {
        margin-top: 20px;
        padding: 20px 24px;
        border-radius: 12px;
        background: #101620;
        border:
          1px solid
          rgba(255,255,255,.08);
      }

      .risk-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 16px;
      }

      .risk-title {
        font-size: 18px;
        font-weight: 900;
        color: #e8edf3;
      }

      .risk-light {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 14px;
        border-radius: 999px;
        background: #151c28;
        font-size: 13px;
        font-weight: 900;
      }

      .risk-bulb {
        width: 13px;
        height: 13px;
        border-radius: 50%;
        display: inline-block;
      }

      .risk-grid {
        display: grid;
        grid-template-columns:
          repeat(4, 1fr);
        gap: 10px;
      }

      .risk-card {
        padding: 13px;
        border-radius: 9px;
        background: #151c28;
        border:
          1px solid
          rgba(255,255,255,.06);
      }

      .risk-label {
        font-size: 11px;
        color: #7f8b9c;
      }

      .risk-value {
        margin-top: 5px;
        font-size: 16px;
        font-weight: 900;
        color: #e8edf3;
      }

      .risk-explanation {
        margin-top: 14px;
        padding: 12px 14px;
        border-radius: 8px;
        background: #151c28;
        color: #aeb8c7;
        font-size: 12px;
        line-height: 1.6;
      }

      @media (max-width: 700px) {

        #${WARNING_ID} {
          padding: 18px;
        }

        .risk-grid {
          grid-template-columns:
            repeat(2, 1fr);
        }

        .risk-header {
          align-items: flex-start;
          flex-direction: column;
        }

      }
    `;

    document.head.appendChild(
      style
    );
  }


  /* ---------------------------------------
     Create
  --------------------------------------- */

  function createSection() {

    if (
      document.getElementById(
        WARNING_ID
      )
    ) {
      return;
    }

    const section =
      document.createElement(
        "section"
      );

    section.id =
      WARNING_ID;

    section.innerHTML = `

      <div class="risk-header">

        <div class="risk-title">
          🚦 BTC / MSTR 시장 위험도
        </div>

        <div
          id="riskLight"
          class="risk-light">

          <span
            id="riskBulb"
            class="risk-bulb">
          </span>

          <span
            id="riskLevel">
            분석 중...
          </span>

        </div>

      </div>

      <div
        id="riskGrid"
        class="risk-grid">
      </div>

      <div
        id="riskExplanation"
        class="risk-explanation">
        데이터를 분석하고 있습니다...
      </div>

    `;


    /*
      기존 앱 위쪽에 삽입.
      적당한 위치를 찾지 못하면 body 끝에 추가.
    */

    const target =
      document.querySelector(
        "main"
      ) ||
      document.querySelector(
        ".container"
      ) ||
      document.body;

    target.appendChild(
      section
    );
  }


  /* ---------------------------------------
     Helpers
  --------------------------------------- */

  function number(
    value
  ) {

    const n =
      Number(value);

    return Number.isFinite(n)
      ? n
      : null;
  }


  function format(
    value,
    digits = 2
  ) {

    const n =
      number(value);

    if (n === null) {
      return "—";
    }

    return n.toLocaleString(
      "en-US",
      {
        maximumFractionDigits:
          digits
      }
    );
  }


  /* ---------------------------------------
     Risk
  --------------------------------------- */

  function calculateRisk(
    latest
  ) {

    let score = 0;


    /*
      mNAV
      ------------------------------------
      역사적으로 높은 valuation일수록
      위험 점수를 올린다.
    */

    const mnavPct =
      number(
        latest.mnavPercentile
      );

    if (mnavPct !== null) {

      if (mnavPct >= 95) {
        score += 35;
      }

      else if (mnavPct >= 85) {
        score += 28;
      }

      else if (mnavPct >= 70) {
        score += 20;
      }

      else if (mnavPct >= 50) {
        score += 10;
      }
    }


    /*
      Funding
      ------------------------------------
      양(+)의 funding이 지나치게 높으면
      롱 포지션 과열로 판단.
    */

    const funding =
      number(
        latest.fundingRate
      );

    if (funding !== null) {

      if (funding >= 0.08) {
        score += 30;
      }

      else if (funding >= 0.05) {
        score += 23;
      }

      else if (funding >= 0.03) {
        score += 15;
      }

      else if (funding >= 0.015) {
        score += 7;
      }

    }


    /*
      OI 1D
    */

    const oi1d =
      number(
        latest.oiChange1dPct
      );

    if (oi1d !== null) {

      if (oi1d >= 10) {
        score += 15;
      }

      else if (oi1d >= 6) {
        score += 11;
      }

      else if (oi1d >= 3) {
        score += 6;
      }
    }


    /*
      OI 7D
    */

    const oi7d =
      number(
        latest.oiChange7dPct
      );

    if (oi7d !== null) {

      if (oi7d >= 20) {
        score += 15;
      }

      else if (oi7d >= 12) {
        score += 11;
      }

      else if (oi7d >= 7) {
        score += 6;
      }
    }


    /*
      BTC 7D
    */

    const btc7d =
      number(
        latest.btcChange7dPct
      );

    if (btc7d !== null) {

      if (btc7d >= 15) {
        score += 10;
      }

      else if (btc7d >= 10) {
        score += 7;
      }

      else if (btc7d >= 5) {
        score += 4;
      }
    }


    score =
      Math.min(
        100,
        Math.max(
          0,
          score
        )
      );


    let level;


    if (score < 25) {
      level = "SAFE";
    }

    else if (score < 50) {
      level = "CAUTION";
    }

    else if (score < 75) {
      level = "OVERHEATED";
    }

    else {
      level = "EXTREME";
    }


    return {
      score,
      level
    };
  }


  /* ---------------------------------------
     Level UI
  --------------------------------------- */

  function applyLevel(
    result
  ) {

    const bulb =
      document.getElementById(
        "riskBulb"
      );

    const level =
      document.getElementById(
        "riskLevel"
      );

    if (!bulb || !level) {
      return;
    }


    let color;
    let text;


    if (
      result.level ===
      "SAFE"
    ) {

      color = "#42d392";
      text =
        "SAFE";

    }

    else if (
      result.level ===
      "CAUTION"
    ) {

      color = "#f3c64e";
      text =
        "CAUTION";

    }

    else if (
      result.level ===
      "OVERHEATED"
    ) {

      color = "#ff9f43";
      text =
        "OVERHEATED";

    }

    else {

      color = "#ff4d5a";
      text =
        "EXTREME";
    }


    bulb.style.background =
      color;

    bulb.style.boxShadow =
      `0 0 12px ${color}`;

    level.textContent =
      text;

    level.style.color =
      color;
  }


  /* ---------------------------------------
     Grid
  --------------------------------------- */

  function renderGrid(
    latest
  ) {

    const grid =
      document.getElementById(
        "riskGrid"
      );

    if (!grid) {
      return;
    }


    const items = [

      {
        label: "Risk Score",
        value:
          number(
            latest.riskScore
          ) !== null
            ? format(
                latest.riskScore,
                0
              ) + " / 100"
            : "—"
      },

      {
        label: "mNAV",
        value:
          number(
            latest.mnav
          ) !== null
            ? Number(
                latest.mnav
              ).toFixed(2) + "×"
            : "—"
      },

      {
        label: "BTC Funding",
        value:
          number(
            latest.fundingRate
          ) !== null
            ? Number(
                latest.fundingRate
              ).toFixed(4) + "%"
            : "—"
      },

      {
        label: "BTC OI",
        value:
          number(
            latest.oiBtc
          ) !== null
            ? format(
                latest.oiBtc
              ) + " BTC"
            : "—"
      }

    ];


    grid.innerHTML =
      items.map(
        item => `
          <div
            class="risk-card">

            <div
              class="risk-label">
              ${item.label}
            </div>

            <div
              class="risk-value">
              ${item.value}
            </div>

          </div>
        `
      ).join("");
  }


  /* ---------------------------------------
     Explanation
  --------------------------------------- */

  function renderExplanation(
    latest,
    result
  ) {

    const box =
      document.getElementById(
        "riskExplanation"
      );

    if (!box) {
      return;
    }


    const messages = [];


    const funding =
      number(
        latest.fundingRate
      );

    const oi7d =
      number(
        latest.oiChange7dPct
      );

    const mnavPct =
      number(
        latest.mnavPercentile
      );

    const btc7d =
      number(
        latest.btcChange7dPct
      );


    if (
      funding !== null &&
      funding >= 0.03
    ) {

      messages.push(
        "Funding이 높아 롱 포지션이 몰리고 있습니다."
      );
    }


    if (
      oi7d !== null &&
      oi7d >= 7
    ) {

      messages.push(
        "BTC OI가 빠르게 증가하고 있습니다."
      );
    }


    if (
      mnavPct !== null &&
      mnavPct >= 85
    ) {

      messages.push(
        "MSTR mNAV가 역사적으로 높은 구간입니다."
      );
    }


    if (
      btc7d !== null &&
      btc7d >= 10
    ) {

      messages.push(
        "BTC가 최근 7일 동안 강한 상승 모멘텀을 보이고 있습니다."
      );
    }


    if (!messages.length) {

      messages.push(
        "현재 주요 과열 신호가 강하게 나타나지 않습니다."
      );
    }


    box.innerHTML =
      `
      <strong>
        ${result.level}
      </strong>
      · 위험 점수
      <strong>
        ${result.score.toFixed(0)}
      </strong>
      / 100

      <br>

      ${messages.join(" ")}
      `;
  }


  /* ---------------------------------------
     Load
  --------------------------------------- */

  async function load() {

    try {

      const response =
        await fetch(
          HISTORY_URL,
          {
            cache:
              "no-store"
          }
        );

      if (!response.ok) {
        throw new Error(
          "history.json " +
          response.status
        );
      }


      const history =
        await response.json();


      if (
        !Array.isArray(
          history
        ) ||
        !history.length
      ) {

        throw new Error(
          "No history data"
        );
      }


      const latest =
        history[
          history.length - 1
        ];


      /*
        Python에서 계산한
        riskLevel / riskScore가 있으면
        그것을 우선 사용한다.

        없으면 JS에서 다시 계산한다.
      */

      let result;


      if (
        number(
          latest.riskScore
        ) !== null &&
        latest.riskLevel
      ) {

        result = {

          score:
            number(
              latest.riskScore
            ),

          level:
            latest.riskLevel

        };

      }

      else {

        result =
          calculateRisk(
            latest
          );
      }


      applyLevel(
        result
      );

      renderGrid(
        latest
      );

      renderExplanation(
        latest,
        result
      );


    } catch (error) {

      console.error(
        "Risk warning error:",
        error
      );


      const level =
        document.getElementById(
          "riskLevel"
        );

      if (level) {

        level.textContent =
          "DATA ERROR";

      }

    }
  }


  /* ---------------------------------------
     Start
  --------------------------------------- */

  document.addEventListener(
    "DOMContentLoaded",
    () => {

      injectStyle();

      createSection();

      load();

    }
  );

})();
