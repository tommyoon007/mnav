/* =========================================
   MSTR Advanced Metrics
   - mNAV percentile
   - BTC per share
   - BTC Yield
   - Risk Score
========================================= */

(function () {

  const HISTORY_URL =
    "history.json?ts=" + Date.now();

  const DATA_URL =
    "data.json?ts=" + Date.now();

  let history = [];
  let company = {};


  /* ---------------------------------------
     스타일
  --------------------------------------- */

  function injectStyle() {

    if (
      document.getElementById(
        "advancedMetricsStyle"
      )
    ) {
      return;
    }

    const style =
      document.createElement("style");

    style.id =
      "advancedMetricsStyle";

    style.textContent = `

      #advancedMetricsSection {
        margin-top: 22px;
      }

      .advanced-grid {
        display: grid;
        grid-template-columns:
          repeat(4, 1fr);
        gap: 10px;
        padding:
          18px 24px 24px;
      }

      .advanced-card {
        padding: 15px;
        border-radius: 10px;
        background: #101620;
        border:
          1px solid
          rgba(255,255,255,.07);
      }

      .advanced-label {
        font-size: 11px;
        color: #7f8b9c;
      }

      .advanced-value {
        margin-top: 6px;
        font-size: 18px;
        font-weight: 800;
      }

      .advanced-note {
        margin-top: 5px;
        font-size: 11px;
        color: #788496;
      }

      .risk-box {
        margin:
          0 24px 22px;
        padding: 18px;
        border-radius: 10px;
        background: #101620;
        border:
          1px solid
          rgba(255,255,255,.08);
      }

      .risk-title {
        font-size: 12px;
        color: #7f8b9c;
      }

      .risk-value {
        margin-top: 6px;
        font-size: 25px;
        font-weight: 900;
      }

      .risk-bar {
        margin-top: 12px;
        height: 8px;
        border-radius: 999px;
        background: #202936;
        overflow: hidden;
      }

      .risk-fill {
        height: 100%;
        width: 0%;
        border-radius: 999px;
      }

      @media (max-width: 800px) {

        .advanced-grid {
          grid-template-columns:
            repeat(2, 1fr);
        }

      }

      @media (max-width: 500px) {

        .advanced-grid {
          padding-left: 18px;
          padding-right: 18px;
        }

        .risk-box {
          margin-left: 18px;
          margin-right: 18px;
        }

      }

    `;

    document.head.appendChild(style);
  }


  /* ---------------------------------------
     영역 생성
  --------------------------------------- */

  function createSection() {

    if (
      document.getElementById(
        "advancedMetricsSection"
      )
    ) {
      return;
    }

    const section =
      document.createElement("section");

    section.id =
      "advancedMetricsSection";

    section.innerHTML = `

      <h2>
        🧠 MSTR 투자 보조지표
      </h2>

      <div class="advanced-grid">

        <div class="advanced-card">

          <div class="advanced-label">
            BTC / 주식
          </div>

          <div
            id="btcPerShare"
            class="advanced-value">
            —
          </div>

          <div class="advanced-note">
            보유 BTC ÷ 희석주식수
          </div>

        </div>


        <div class="advanced-card">

          <div class="advanced-label">
            BTC Yield
          </div>

          <div
            id="btcYield"
            class="advanced-value">
            —
          </div>

          <div class="advanced-note">
            최근 데이터 기준
          </div>

        </div>


        <div class="advanced-card">

          <div class="advanced-label">
            mNAV Percentile
          </div>

          <div
            id="mnavPercentile"
            class="advanced-value">
            —
          </div>

          <div class="advanced-note">
            역사적 위치
          </div>

        </div>


        <div class="advanced-card">

          <div class="advanced-label">
            Risk Score
          </div>

          <div
            id="riskScore"
            class="advanced-value">
            —
          </div>

          <div class="advanced-note">
            0 = 낮음 / 100 = 높음
          </div>

        </div>

      </div>


      <div class="risk-box">

        <div class="risk-title">
          종합 위험도
        </div>

        <div
          id="riskLabel"
          class="risk-value">
          계산 중...
        </div>

        <div class="risk-bar">

          <div
            id="riskFill"
            class="risk-fill">
          </div>

        </div>

      </div>

    `;

    const historySection =
      document.getElementById(
        "mnavHistorySection"
      );

    if (historySection) {

      historySection.parentNode.insertBefore(
        section,
        historySection
      );

    } else {

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

  }


  /* ---------------------------------------
     JSON
  --------------------------------------- */

  async function loadJSON(
    url
  ) {

    const response =
      await fetch(
        url,
        {
          cache: "no-store"
        }
      );

    if (!response.ok) {

      throw new Error(
        url +
        " " +
        response.status
      );

    }

    return response.json();

  }


  /* ---------------------------------------
     Percentile
  --------------------------------------- */

  function calculatePercentile(
    value,
    values
  ) {

    const valid =
      values
        .map(Number)
        .filter(
          Number.isFinite
        );

    if (
      !valid.length ||
      !Number.isFinite(
        Number(value)
      )
    ) {
      return null;
    }

    const below =
      valid.filter(
        x =>
          x <= Number(value)
      ).length;

    return (
      below /
      valid.length
    ) * 100;

  }


  /* ---------------------------------------
     BTC / Share
  --------------------------------------- */

  function calculateBTCPerShare() {

    const holdings =
      Number(
        company.btcHoldings
      );

    const fdso =
      Number(
        company.fdso
      );

    if (
      !Number.isFinite(holdings) ||
      !Number.isFinite(fdso) ||
      fdso <= 0
    ) {
      return null;
    }

    return (
      holdings /
      (fdso * 1e6)
    );

  }


  /* ---------------------------------------
     BTC Yield
  --------------------------------------- */

  function calculateBTCYield() {

    if (
      history.length < 2
    ) {
      return null;
    }

    const first =
      history[0];

    const latest =
      history[
        history.length - 1
      ];

    const firstBtc =
      Number(
        first.btc
      );

    const latestBtc =
      Number(
        latest.btc
      );

    if (
      !Number.isFinite(
        firstBtc
      ) ||
      !Number.isFinite(
        latestBtc
      ) ||
      firstBtc <= 0
    ) {
      return null;
    }

    return (
      (
        latestBtc /
        firstBtc
      ) - 1
    ) * 100;

  }


  /* ---------------------------------------
     Risk Score
  --------------------------------------- */

  function calculateRisk() {

    if (
      !history.length
    ) {
      return null;
    }

    const latest =
      history[
        history.length - 1
      ];

    let score = 0;


    /* mNAV */

    const mnav =
      Number(
        latest.mnav
      );

    if (
      Number.isFinite(mnav)
    ) {

      if (mnav >= 2.5) {

        score += 35;

      } else if (mnav >= 2.0) {

        score += 25;

      } else if (mnav >= 1.5) {

        score += 15;

      } else if (mnav >= 1.2) {

        score += 8;

      }

    }


    /* Funding */

    const funding =
      Number(
        latest.fundingRate
      );

    if (
      Number.isFinite(funding)
    ) {

      const absoluteFunding =
        Math.abs(funding);

      if (
        absoluteFunding >= 0.06
      ) {

        score += 35;

      } else if (
        absoluteFunding >= 0.03
      ) {

        score += 25;

      } else if (
        absoluteFunding >= 0.01
      ) {

        score += 15;

      } else if (
        absoluteFunding >= 0.005
      ) {

        score += 8;

      }

    }


    /* OI */

    if (
      history.length >= 2
    ) {

      const previous =
        Number(
          history[
            history.length - 2
          ].oiBtc
        );

      const current =
        Number(
          latest.oiBtc
        );

      if (
        Number.isFinite(previous) &&
        Number.isFinite(current) &&
        previous > 0
      ) {

        const oiChange =
          (
            current /
            previous
          ) - 1;

        if (
          oiChange >= 0.10
        ) {

          score += 30;

        } else if (
          oiChange >= 0.05
        ) {

          score += 20;

        } else if (
          oiChange >= 0.02
        ) {

          score += 10;

        }

      }

    }


    return Math.min(
      100,
      Math.round(score)
    );

  }


  /* ---------------------------------------
     Risk Label
  --------------------------------------- */

  function getRiskLabel(
    score
  ) {

    if (
      score === null
    ) {

      return {
        label: "DATA UNAVAILABLE",
        className: "neutral"
      };

    }

    if (
      score >= 75
    ) {

      return {
        label: "🔴 EXTREME",
        className: "extreme"
      };

    }

    if (
      score >= 50
    ) {

      return {
        label: "🟠 OVERHEATED",
        className: "overheated"
      };

    }

    if (
      score >= 25
    ) {

      return {
        label: "🟡 CAUTION",
        className: "caution"
      };

    }

    return {
      label: "🟢 SAFE",
      className: "safe"
    };

  }


  /* ---------------------------------------
     화면 업데이트
  --------------------------------------- */

  function render() {

    if (
      !history.length
    ) {
      return;
    }

    const latest =
      history[
        history.length - 1
      ];


    /* BTC / Share */

    const btcPerShare =
      calculateBTCPerShare();

    const btcPerShareElement =
      document.getElementById(
        "btcPerShare"
      );

    if (
      btcPerShareElement
    ) {

      btcPerShareElement.textContent =
        btcPerShare !== null
          ? btcPerShare.toFixed(
              6
            ) + " BTC"
          : "—";

    }


    /* BTC Yield */

    const btcYield =
      calculateBTCYield();

    const btcYieldElement =
      document.getElementById(
        "btcYield"
      );

    if (
      btcYieldElement
    ) {

      btcYieldElement.textContent =
        btcYield !== null
          ? (
              btcYield >= 0
                ? "+"
                : ""
            ) +
            btcYield.toFixed(
              2
            ) +
            "%"
          : "—";

    }


    /* mNAV percentile */

    const mnavPercentile =
      calculatePercentile(
        latest.mnav,
        history.map(
          item =>
            item.mnav
        )
      );

    const percentileElement =
      document.getElementById(
        "mnavPercentile"
      );

    if (
      percentileElement
    ) {

      percentileElement.textContent =
        mnavPercentile !== null
          ? mnavPercentile.toFixed(
              0
            ) + " percentile"
          : "—";

    }


    /* Risk */

    const score =
      calculateRisk();

    const risk =
      getRiskLabel(
        score
      );

    const scoreElement =
      document.getElementById(
        "riskScore"
      );

    const labelElement =
      document.getElementById(
        "riskLabel"
      );

    const fillElement =
      document.getElementById(
        "riskFill"
      );


    if (
      scoreElement
    ) {

      scoreElement.textContent =
        score !== null
          ? score + " / 100"
          : "—";

    }


    if (
      labelElement
    ) {

      labelElement.textContent =
        risk.label;

    }


    if (
      fillElement &&
      score !== null
    ) {

      fillElement.style.width =
        score + "%";

    }

  }


  /* ---------------------------------------
     실행
  --------------------------------------- */

  async function init() {

    injectStyle();

    createSection();

    try {

      const results =
        await Promise.all([
          loadJSON(
            HISTORY_URL
          ),
          loadJSON(
            DATA_URL
          )
        ]);

      history =
        Array.isArray(
          results[0]
        )
          ? results[0]
          : [];

      company =
        results[1] || {};

      render();

    } catch (error) {

      console.error(
        "Advanced metrics error:",
        error
      );

      const label =
        document.getElementById(
          "riskLabel"
        );

      if (label) {

        label.textContent =
          "DATA UNAVAILABLE";

      }

    }

  }


  if (
    document.readyState ===
    "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      init
    );

  } else {

    init();

  }

})();
