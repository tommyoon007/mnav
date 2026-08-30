/* =========================================
   MSTR / BTC Derivatives Warning System
   SAFE / CAUTION / OVERHEATED / EXTREME

   판단 요소
   1. Funding Rate
   2. OI 변화율
   3. Funding + OI 동시 과열
========================================= */

(function () {

  const WARNING_ID = "mnavWarningSection";
  const HISTORY_URL =
    "history.json?ts=" + Date.now();


  /* =========================================
     STYLE
  ========================================= */

  function injectStyle() {

    if (
      document.getElementById(
        "mnavWarningStyle"
      )
    ) {
      return;
    }

    const style =
      document.createElement("style");

    style.id =
      "mnavWarningStyle";

    style.textContent = `

      #${WARNING_ID} {
        margin-top: 22px;
        margin-bottom: 22px;
      }

      .warning-card {
        padding: 22px 24px;
        border-radius: 12px;
        background: #101620;
        border: 1px solid
          rgba(255,255,255,.08);
      }

      .warning-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 15px;
        flex-wrap: wrap;
      }

      .warning-title {
        font-size: 18px;
        font-weight: 900;
        color: #e8edf3;
      }

      .warning-light {
        display: inline-flex;
        align-items: center;
        gap: 9px;
        padding: 8px 14px;
        border-radius: 999px;
        font-size: 13px;
        font-weight: 900;
      }

      .warning-light-dot {
        width: 11px;
        height: 11px;
        border-radius: 50%;
      }

      .warning-description {
        margin-top: 10px;
        color: #8d99aa;
        font-size: 12px;
        line-height: 1.6;
      }

      .warning-grid {
        display: grid;
        grid-template-columns:
          repeat(3, 1fr);
        gap: 10px;
        margin-top: 18px;
      }

      .warning-metric {
        padding: 13px;
        border-radius: 9px;
        background: #151c28;
        border: 1px solid
          rgba(255,255,255,.06);
      }

      .warning-label {
        font-size: 11px;
        color: #7f8b9c;
      }

      .warning-value {
        margin-top: 5px;
        font-size: 17px;
        font-weight: 900;
      }

      .warning-score {
        margin-top: 15px;
        font-size: 11px;
        color: #7f8b9c;
      }

      .warning-bar {
        margin-top: 7px;
        height: 7px;
        border-radius: 99px;
        background: #202938;
        overflow: hidden;
      }

      .warning-bar-fill {
        height: 100%;
        width: 0%;
        transition: width .4s ease;
      }

      @media (max-width: 700px) {

        .warning-grid {
          grid-template-columns:
            1fr;
        }

      }

      @media (max-width: 600px) {

        .warning-card {
          padding: 18px;
        }

      }

    `;

    document.head.appendChild(style);
  }


  /* =========================================
     SECTION
  ========================================= */

  function createSection() {

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

      <div class="warning-card">

        <div class="warning-header">

          <div class="warning-title">
            🚦 BTC 레버리지 과열 경고
          </div>

          <div
            id="warningLight"
            class="warning-light">

            <i
              id="warningDot"
              class="warning-light-dot">
            </i>

            <span
              id="warningLevel">
              계산 중...
            </span>

          </div>

        </div>


        <div
          id="warningDescription"
          class="warning-description">
          Funding Rate와 OI 변화를
          분석하고 있습니다.
        </div>


        <div class="warning-grid">


          <div class="warning-metric">

            <div class="warning-label">
              Funding Rate
            </div>

            <div
              id="warningFunding"
              class="warning-value">
              —
            </div>

          </div>


          <div class="warning-metric">

            <div class="warning-label">
              BTC OI
            </div>

            <div
              id="warningOI"
              class="warning-value">
              —
            </div>

          </div>


          <div class="warning-metric">

            <div class="warning-label">
              OI 변화
            </div>

            <div
              id="warningOIChange"
              class="warning-value">
              —
            </div>

          </div>

        </div>


        <div class="warning-score">

          과열 점수

          <span
            id="warningScoreText">
            —
          </span>

        </div>


        <div class="warning-bar">

          <div
            id="warningBar"
            class="warning-bar-fill">
          </div>

        </div>

      </div>

    `;


    const footer =
      document.querySelector("footer");


    if (footer) {

      footer.parentNode.insertBefore(
        section,
        footer
      );

    } else {

      document.body.appendChild(
        section
      );

    }
  }


  /* =========================================
     JSON
  ========================================= */

  async function loadHistory() {

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

      const history =
        await response.json();


      if (
        !Array.isArray(history) ||
        history.length === 0
      ) {

        throw new Error(
          "No history data"
        );

      }


      calculateWarning(history);

    } catch (error) {

      console.error(
        "Warning error:",
        error
      );

      setWarning(
        "CAUTION",
        "데이터를 불러오지 못했습니다.",
        null,
        null,
        null,
        null
      );

    }

  }


  /* =========================================
     NUMBER
  ========================================= */

  function number(value) {

    const n =
      Number(value);

    return Number.isFinite(n)
      ? n
      : null;
  }


  /* =========================================
     WARNING CALCULATION
  ========================================= */

  function calculateWarning(history) {

    const latest =
      history[
        history.length - 1
      ];

    const previous =
      history.length >= 2
        ? history[
            history.length - 2
          ]
        : null;


    const funding =
      number(
        latest.fundingRate
      );

    const oi =
      number(
        latest.oiBtc
      );


    let oiChange = null;


    /*
      매우 중요:

      오늘 데이터가 같은 날짜에
      여러 번 저장되는 구조라면
      단순히 바로 이전 record와
      비교하면 변화율이 0%가 될 수 있다.

      따라서 날짜가 다른 가장 최근
      데이터를 찾아 비교한다.
    */

    if (previous) {

      let previousDifferentDay =
        null;

      for (
        let i =
          history.length - 2;
        i >= 0;
        i--
      ) {

        if (
          history[i].date !==
          latest.date
        ) {

          previousDifferentDay =
            history[i];

          break;
        }

      }


      if (
        previousDifferentDay
      ) {

        const previousOI =
          number(
            previousDifferentDay
              .oiBtc
          );

        if (
          previousOI !== null &&
          previousOI > 0 &&
          oi !== null
        ) {

          oiChange =
            (
              (
                oi /
                previousOI
              ) - 1
            ) * 100;

        }

      }

    }


    /*
      점수
    */

    let score = 0;


    /* ---------------------------------------
       Funding 점수

       대략적인 BTC 시장 과열 기준

       < 0.01%      정상
       0.01~0.03%   주의
       0.03~0.06%   과열
       > 0.06%      극단
    --------------------------------------- */

    if (
      funding !== null
    ) {

      const absFunding =
        Math.abs(funding);

      if (
        absFunding >= 0.06
      ) {

        score += 4;

      } else if (
        absFunding >= 0.03
      ) {

        score += 3;

      } else if (
        absFunding >= 0.01
      ) {

        score += 1;

      }

    }


    /* ---------------------------------------
       OI 변화 점수

       하루 OI 변화

       < 3%        정상
       3~5%        주의
       5~10%       과열
       > 10%       극단
    --------------------------------------- */

    if (
      oiChange !== null
    ) {

      const absOI =
        Math.abs(
          oiChange
        );

      if (
        absOI >= 10
      ) {

        score += 4;

      } else if (
        absOI >= 5
      ) {

        score += 3;

      } else if (
        absOI >= 3
      ) {

        score += 1;

      }

    }


    /*
      Funding + OI 동시 상승은
      레버리지 과열 신호로 판단.

      특히 Funding이 양수이고
      OI도 증가하면 롱 레버리지
      과열 가능성이 커진다.
    */

    if (
      funding !== null &&
      oiChange !== null
    ) {

      if (
        funding >= 0.03 &&
        oiChange >= 5
      ) {

        score += 2;

      }

      if (
        funding >= 0.06 &&
        oiChange >= 10
      ) {

        score += 2;

      }

    }


    /*
      최대 점수 제한
    */

    score =
      Math.min(
        score,
        10
      );


    /* ---------------------------------------
       Level
    --------------------------------------- */

    let level;


    if (
      score <= 1
    ) {

      level = "SAFE";

    } else if (
      score <= 3
    ) {

      level = "CAUTION";

    } else if (
      score <= 6
    ) {

      level = "OVERHEATED";

    } else {

      level = "EXTREME";

    }


    /* ---------------------------------------
       설명
    --------------------------------------- */

    let description;


    if (
      level === "SAFE"
    ) {

      description =
        "BTC 선물 레버리지 시장이 비교적 안정적입니다.";

    } else if (
      level === "CAUTION"
    ) {

      description =
        "레버리지 부담이 조금 증가했습니다. 추격 매수는 주의하세요.";

    } else if (
      level === "OVERHEATED"
    ) {

      description =
        "Funding과 OI가 높아지고 있습니다. 단기 조정 위험이 커집니다.";

    } else {

      description =
        "레버리지 과열이 매우 강합니다. 급격한 롱 청산 위험을 경계하세요.";

    }


    setWarning(
      level,
      description,
      funding,
      oi,
      oiChange,
      score
    );

  }


  /* =========================================
     DISPLAY
  ========================================= */

  function setWarning(
    level,
    description,
    funding,
    oi,
    oiChange,
    score
  ) {

    const light =
      document.getElementById(
        "warningLight"
      );

    const dot =
      document.getElementById(
        "warningDot"
      );

    const levelText =
      document.getElementById(
        "warningLevel"
      );

    const desc =
      document.getElementById(
        "warningDescription"
      );

    const fundingEl =
      document.getElementById(
        "warningFunding"
      );

    const oiEl =
      document.getElementById(
        "warningOI"
      );

    const oiChangeEl =
      document.getElementById(
        "warningOIChange"
      );

    const scoreText =
      document.getElementById(
        "warningScoreText"
      );

    const bar =
      document.getElementById(
        "warningBar"
      );


    if (
      !light ||
      !dot ||
      !levelText
    ) {
      return;
    }


    const colors = {

      SAFE: "#5ee6a8",

      CAUTION: "#f3c64e",

      OVERHEATED: "#ff9f43",

      EXTREME: "#ff4d5a"

    };


    const color =
      colors[level] ||
      "#9ca8b8";


    light.style.background =
      color + "18";

    light.style.color =
      color;

    light.style.border =
      "1px solid " +
      color +
      "44";


    dot.style.background =
      color;

    dot.style.boxShadow =
      "0 0 10px " +
      color;


    levelText.textContent =
      level;


    desc.textContent =
      description;


    if (
      funding !== null
    ) {

      fundingEl.textContent =
        funding.toFixed(4) +
        "%";

      fundingEl.style.color =
        funding >= 0
          ? color
          : "#7fb8ff";

    } else {

      fundingEl.textContent =
        "—";

    }


    if (
      oi !== null
    ) {

      oiEl.textContent =
        oi.toLocaleString(
          "en-US",
          {
            maximumFractionDigits: 0
          }
        ) +
        " BTC";

      oiEl.style.color =
        "#b56cff";

    } else {

      oiEl.textContent =
        "—";

    }


    if (
      oiChange !== null
    ) {

      oiChangeEl.textContent =
        (
          oiChange >= 0
            ? "+"
            : ""
        ) +
        oiChange.toFixed(2) +
        "%";

      oiChangeEl.style.color =
        oiChange >= 0
          ? color
          : "#7fb8ff";

    } else {

      oiChangeEl.textContent =
        "—";

    }


    if (
      score !== null
    ) {

      scoreText.textContent =
        score +
        " / 10";

      bar.style.width =
        (
          score * 10
        ) +
        "%";

      bar.style.background =
        color;

    } else {

      scoreText.textContent =
        "—";

      bar.style.width =
        "0%";

    }

  }


  /* =========================================
     RUN
  ========================================= */

  document.addEventListener(
    "DOMContentLoaded",
    () => {

      injectStyle();

      createSection();

      loadHistory();

    }
  );

})();
