/* =========================================
   MSTR BTC Derivatives Warning Light
   SAFE / CAUTION / OVERHEATED / EXTREME
========================================= */

(function () {

  const HISTORY_URL =
    "history.json?ts=" + Date.now();

  const WARNING_ID =
    "mstrDerivativesWarning";

  /* ---------------------------------------
     스타일
  --------------------------------------- */

  function injectStyle() {

    if (
      document.getElementById(
        "mstrWarningStyle"
      )
    ) {
      return;
    }

    const style =
      document.createElement("style");

    style.id =
      "mstrWarningStyle";

    style.textContent = `

      #${WARNING_ID} {
        margin-top: 18px;
        padding: 20px 24px;
        border-radius: 14px;
        background: #101620;
        border: 1px solid rgba(255,255,255,.08);
        box-shadow: 0 10px 30px rgba(0,0,0,.25);
      }

      .warning-title {
        font-size: 17px;
        font-weight: 900;
        color: #e8edf3;
        margin-bottom: 15px;
      }

      .warning-status {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 16px;
        border-radius: 12px;
        background: #151c28;
        border: 1px solid rgba(255,255,255,.08);
      }

      .warning-light {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        flex-shrink: 0;
        box-shadow: 0 0 16px currentColor;
      }

      .warning-name {
        font-size: 21px;
        font-weight: 950;
        letter-spacing: .5px;
      }

      .warning-description {
        margin-top: 3px;
        font-size: 12px;
        color: #8c98a8;
      }

      .warning-grid {
        display: grid;
        grid-template-columns:
          repeat(3, 1fr);
        gap: 10px;
        margin-top: 12px;
      }

      .warning-card {
        padding: 13px;
        border-radius: 10px;
        background: #0d131c;
        border: 1px solid rgba(255,255,255,.06);
      }

      .warning-label {
        font-size: 11px;
        color: #788496;
      }

      .warning-value {
        margin-top: 5px;
        font-size: 16px;
        font-weight: 850;
        color: #e8edf3;
      }

      .warning-note {
        margin-top: 13px;
        font-size: 11px;
        line-height: 1.6;
        color: #778496;
      }

      @media (max-width: 650px) {

        #${WARNING_ID} {
          padding: 18px;
        }

        .warning-grid {
          grid-template-columns:
            1fr;
        }

      }

    `;

    document.head.appendChild(style);
  }


  /* ---------------------------------------
     화면 생성
  --------------------------------------- */

  function createWarningSection() {

    if (
      document.getElementById(
        WARNING_ID
      )
    ) {
      return;
    }

    const section =
      document.createElement("section");

    section.id =
      WARNING_ID;

    section.innerHTML = `

      <div class="warning-title">
        ⚡ BTC 선물 과열 경고등
      </div>

      <div
        id="warningStatus"
        class="warning-status">

        <div
          class="warning-light">
        </div>

        <div>

          <div
            id="warningName"
            class="warning-name">
            분석 중...
          </div>

          <div
            id="warningDescription"
            class="warning-description">
            BTC OI와 Funding Rate를 분석하고 있습니다.
          </div>

        </div>

      </div>

      <div
        id="warningGrid"
        class="warning-grid">
      </div>

      <div
        class="warning-note">

        ※ 이 경고등은 BTC 선물시장의
        OI와 Funding Rate를 이용한
        과열도 참고 지표입니다.
        MSTR 매수·매도의 단독 신호가 아닙니다.

      </div>

    `;

    const history =
      document.getElementById(
        "mnavHistorySection"
      );

    if (history) {

      history.parentNode.insertBefore(
        section,
        history
      );

    } else {

      document.body.appendChild(
        section
      );

    }
  }


  /* ---------------------------------------
     데이터
  --------------------------------------- */

  async function loadData() {

    try {

      const response =
        await fetch(
          HISTORY_URL,
          {
            cache: "no-store"
          }
        );

      if (!response.ok) {
        throw new Error(
          "history.json " +
          response.status
        );
      }

      const data =
        await response.json();

      if (
        !Array.isArray(data) ||
        !data.length
      ) {
        throw new Error(
          "No history data"
        );
      }

      const latest =
        data[data.length - 1];

      updateWarning(latest);

    } catch (error) {

      console.error(
        "Warning error:",
        error
      );

      const name =
        document.getElementById(
          "warningName"
        );

      if (name) {
        name.textContent =
          "DATA UNAVAILABLE";
      }

    }

  }


  /* ---------------------------------------
     숫자
  --------------------------------------- */

  function number(value) {

    const n =
      Number(value);

    return Number.isFinite(n)
      ? n
      : null;

  }


  /* ---------------------------------------
     경고등 계산
  --------------------------------------- */

  function calculateWarning(
    oiBtc,
    fundingRate
  ) {

    /*
      Funding Rate:
      0.01% 이하 → 비교적 정상
      0.01~0.03% → 주의
      0.03~0.06% → 과열
      0.06% 이상 → 극단적 과열

      OI:
      절대값만으로 과열을 판단하지 않고
      Funding과 함께 사용한다.

      따라서 OI 단독으로 EXTREME을
      발생시키지 않는다.
    */


    const funding =
      Math.abs(
        fundingRate
      );

    let score = 0;


    /* Funding */

    if (
      funding >= 0.06
    ) {

      score += 3;

    } else if (
      funding >= 0.03
    ) {

      score += 2;

    } else if (
      funding >= 0.01
    ) {

      score += 1;

    }


    /*
      OI는 현재값 자체보다
      데이터 존재 여부를 확인한다.

      장기적으로는 OI 변화율까지
      추가하면 더 정교해질 수 있다.
    */

    if (
      oiBtc !== null &&
      oiBtc > 0
    ) {

      score += 0;

    }


    if (
      score >= 3
    ) {

      return {
        level: "EXTREME",
        description:
          "Funding이 매우 높습니다. 레버리지 포지션 과열 위험이 큽니다.",
        glow: "#ff3658"
      };

    }

    if (
      score >= 2
    ) {

      return {
        level: "OVERHEATED",
        description:
          "Funding이 높은 편입니다. 단기 과열 가능성을 주의하세요.",
        glow: "#ff8a3d"
      };

    }

    if (
      score >= 1
    ) {

      return {
        level: "CAUTION",
        description:
          "레버리지 수요가 증가하고 있습니다. 추격 매수는 주의하세요.",
        glow: "#f3c64e"
      };

    }

    return {
      level: "SAFE",
      description:
        "Funding이 비교적 안정적입니다. 선물시장 과열 신호는 낮습니다.",
      glow: "#5ee6a8"
    };

  }


  /* ---------------------------------------
     화면 업데이트
  --------------------------------------- */

  function updateWarning(
    latest
  ) {

    const oi =
      number(
        latest.oiBtc
      );

    const funding =
      number(
        latest.fundingRate
      );


    if (
      oi === null ||
      funding === null
    ) {

      const name =
        document.getElementById(
          "warningName"
        );

      const description =
        document.getElementById(
          "warningDescription"
        );

      if (name) {
        name.textContent =
          "DATA UNAVAILABLE";
      }

      if (description) {
        description.textContent =
          "OI 또는 Funding 데이터를 가져오지 못했습니다.";
      }

      return;
    }


    const warning =
      calculateWarning(
        oi,
        funding
      );


    const status =
      document.getElementById(
        "warningStatus"
      );

    const light =
      status
        ? status.querySelector(
            ".warning-light"
          )
        : null;


    const name =
      document.getElementById(
        "warningName"
      );

    const description =
      document.getElementById(
        "warningDescription"
      );


    if (light) {

      light.style.color =
        warning.glow;

      light.style.background =
        warning.glow;

    }


    if (name) {

      name.textContent =
        warning.level;

      name.style.color =
        warning.glow;

    }


    if (description) {

      description.textContent =
        warning.description;

    }


    const grid =
      document.getElementById(
        "warningGrid"
      );


    if (grid) {

      grid.innerHTML = `

        <div class="warning-card">

          <div class="warning-label">
            BTC OI
          </div>

          <div class="warning-value">
            ${oi.toLocaleString(
              "en-US",
              {
                maximumFractionDigits: 0
              }
            )} BTC
          </div>

        </div>


        <div class="warning-card">

          <div class="warning-label">
            Funding Rate
          </div>

          <div class="warning-value">
            ${funding >= 0 ? "+" : ""}
            ${funding.toFixed(4)}%
          </div>

        </div>


        <div class="warning-card">

          <div class="warning-label">
            Updated
          </div>

          <div class="warning-value">
            ${latest.date || "—"}
          </div>

        </div>

      `;

    }

  }


  /* ---------------------------------------
     실행
  --------------------------------------- */

  document.addEventListener(
    "DOMContentLoaded",
    () => {

      injectStyle();

      createWarningSection();

      loadData();

    }
  );

})();
