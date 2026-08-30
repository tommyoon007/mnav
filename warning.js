/* =========================================
   MSTR / BTC Derivatives Warning System
   SAFE / CAUTION / OVERHEATED / EXTREME
========================================= */

(function () {

  const WARNING_ID = "mnavWarningSection";
  const HISTORY_URL =
    "history.json?ts=" + Date.now();

  let latest = null;


  /* ---------------------------------------
     STYLE
  --------------------------------------- */

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
      }

      .warning-box {
        margin-top: 15px;
        padding: 20px 24px;
        border-radius: 12px;
        background: #101620;
        border: 1px solid
          rgba(255,255,255,.08);
      }

      .warning-main {
        display: flex;
        align-items: center;
        gap: 16px;
      }

      .warning-light {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        flex-shrink: 0;
        box-shadow:
          0 0 18px currentColor;
      }

      .warning-title {
        font-size: 22px;
        font-weight: 900;
        letter-spacing: .5px;
      }

      .warning-score {
        margin-top: 3px;
        font-size: 12px;
        color: #7f8b9c;
      }

      .warning-message {
        margin-top: 15px;
        padding-top: 14px;
        border-top:
          1px solid
          rgba(255,255,255,.07);
        color: #b9c2cf;
        font-size: 13px;
        line-height: 1.6;
      }

      .warning-grid {
        display: grid;
        grid-template-columns:
          repeat(4, 1fr);
        gap: 10px;
        margin-top: 14px;
      }

      .warning-card {
        padding: 12px;
        border-radius: 9px;
        background: #0d131c;
        border:
          1px solid
          rgba(255,255,255,.06);
      }

      .warning-label {
        font-size: 10px;
        color: #738093;
      }

      .warning-value {
        margin-top: 5px;
        font-size: 14px;
        font-weight: 800;
      }

      .warning-note {
        margin-top: 13px;
        font-size: 11px;
        color: #667386;
        line-height: 1.5;
      }

      @media (max-width: 700px) {

        .warning-grid {
          grid-template-columns:
            repeat(2, 1fr);
        }

      }

      @media (max-width: 600px) {

        .warning-box {
          padding: 18px;
        }

        .warning-title {
          font-size: 19px;
        }

      }

    `;

    document.head.appendChild(style);
  }


  /* ---------------------------------------
     SECTION
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
      document.createElement("section");

    section.id =
      WARNING_ID;

    section.innerHTML = `

      <h2>
        🚦 BTC 레버리지 경고등
      </h2>

      <div
        id="warningContent"
        class="warning-box">

        데이터를 불러오는 중...

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
     NUMBER
  --------------------------------------- */

  function number(value) {

    const n = Number(value);

    return Number.isFinite(n)
      ? n
      : null;
  }


  function fmt(value, digits = 2) {

    const n = number(value);

    if (n === null) {
      return "—";
    }

    return n.toLocaleString(
      "en-US",
      {
        maximumFractionDigits: digits
      }
    );
  }


  /* ---------------------------------------
     CHANGE
  --------------------------------------- */

  function calculateChange(
    history,
    key,
    days
  ) {

    if (
      !Array.isArray(history) ||
      !history.length
    ) {
      return null;
    }

    const latestIndex =
      history.length - 1;

    const latestValue =
      number(
        history[
          latestIndex
        ][key]
      );

    if (
      latestValue === null
    ) {
      return null;
    }

    const targetDate =
      new Date(
        history[
          latestIndex
        ].date
      );

    targetDate.setDate(
      targetDate.getDate() -
      days
    );

    let previous = null;

    for (
      let i = latestIndex - 1;
      i >= 0;
      i--
    ) {

      const item =
        history[i];

      const date =
        new Date(
          item.date
        );

      if (
        date <= targetDate
      ) {

        const value =
          number(
            item[key]
          );

        if (
          value !== null
        ) {

          previous = value;
          break;

        }

      }

    }

    if (
      previous === null ||
      previous === 0
    ) {
      return null;
    }

    return (
      (
        latestValue /
        previous
      ) - 1
    ) * 100;
  }


  /* ---------------------------------------
     RISK CALCULATION
  --------------------------------------- */

  function calculateRisk(
    item,
    history
  ) {

    let score = 0;

    const funding =
      number(
        item.fundingRate
      );

    const oi =
      number(
        item.oiBtc
      );

    const oi1d =
      number(
        item.oiChange1dPct
      );

    const oi7d =
      number(
        item.oiChange7dPct
      );

    const btc1d =
      number(
        item.btcChange1dPct
      );

    const btc7d =
      number(
        item.btcChange7dPct
      );

    const mnav =
      number(
        item.mnav
      );


    /* -----------------------------------
       Funding
    ----------------------------------- */

    if (
      funding !== null
    ) {

      if (
        funding >= 0.10
      ) {

        score += 4;

      } else if (
        funding >= 0.06
      ) {

        score += 3;

      } else if (
        funding >= 0.03
      ) {

        score += 2;

      } else if (
        funding >= 0.015
      ) {

        score += 1;

      }

    }


    /* -----------------------------------
       OI 1D
    ----------------------------------- */

    if (
      oi1d !== null
    ) {

      if (
        oi1d >= 8
      ) {

        score += 4;

      } else if (
        oi1d >= 5
      ) {

        score += 3;

      } else if (
        oi1d >= 2.5
      ) {

        score += 2;

      } else if (
        oi1d >= 1
      ) {

        score += 1;

      }

    }


    /* -----------------------------------
       OI 7D
    ----------------------------------- */

    if (
      oi7d !== null
    ) {

      if (
        oi7d >= 15
      ) {

        score += 3;

      } else if (
        oi7d >= 10
      ) {

        score += 2;

      } else if (
        oi7d >= 5
      ) {

        score += 1;

      }

    }


    /* -----------------------------------
       BTC 상승 + OI 증가
    ----------------------------------- */

    if (
      btc1d !== null &&
      oi1d !== null
    ) {

      if (
        btc1d >= 3 &&
        oi1d >= 5
      ) {

        score += 3;

      } else if (
        btc1d >= 2 &&
        oi1d >= 2.5
      ) {

        score += 2;

      }

    }


    /* -----------------------------------
       BTC 7D 상승
    ----------------------------------- */

    if (
      btc7d !== null
    ) {

      if (
        btc7d >= 15
      ) {

        score += 3;

      } else if (
        btc7d >= 10
      ) {

        score += 2;

      } else if (
        btc7d >= 5
      ) {

        score += 1;

      }

    }


    /* -----------------------------------
       mNAV
    ----------------------------------- */

    if (
      mnav !== null
    ) {

      if (
        mnav >= 2.5
      ) {

        score += 3;

      } else if (
        mnav >= 2.0
      ) {

        score += 2;

      } else if (
        mnav >= 1.5
      ) {

        score += 1;

      }

    }


    /* -----------------------------------
       LEVEL
    ----------------------------------- */

    let level;
    let symbol;
    let color;
    let message;


    if (
      score >= 13
    ) {

      level =
        "EXTREME";

      symbol =
        "🔴";

      color =
        "#ff4d5a";

      message =
        "레버리지와 투기적 포지션이 동시에 과열된 구간입니다. 급격한 롱 청산과 변동성 확대 위험을 매우 높게 봐야 합니다.";

    } else if (
      score >= 9
    ) {

      level =
        "OVERHEATED";

      symbol =
        "🟠";

      color =
        "#ff9f43";

      message =
        "Funding과 OI를 중심으로 레버리지 과열 신호가 나타나고 있습니다. 추격매수는 조심하는 구간입니다.";

    } else if (
      score >= 5
    ) {

      level =
        "CAUTION";

      symbol =
        "🟡";

      color =
        "#f3c64e";

      message =
        "레버리지 시장에 부담이 조금씩 쌓이고 있습니다. 방향성이 강해지면 과열 단계로 빠르게 이동할 수 있습니다.";

    } else {

      level =
        "SAFE";

      symbol =
        "🟢";

      color =
        "#5ee6a8";

      message =
        "현재 확인되는 Funding, OI, BTC 가격 흐름에서는 뚜렷한 레버리지 과열 신호가 강하지 않습니다.";

    }


    return {
      score,
      level,
      symbol,
      color,
      message
    };

  }


  /* ---------------------------------------
     DRAW
  --------------------------------------- */

  function draw(
    history
  ) {

    const content =
      document.getElementById(
        "warningContent"
      );

    if (
      !content
    ) {
      return;
    }

    if (
      !Array.isArray(history) ||
      !history.length
    ) {

      content.innerHTML = `
        <div style="
          text-align:center;
          padding:20px;
          color:#788496;
        ">
          아직 데이터가 없습니다.
        </div>
      `;

      return;
    }


    const item =
      history[
        history.length - 1
      ];

    latest = item;


    const risk =
      calculateRisk(
        item,
        history
      );


    content.innerHTML = `

      <div class="warning-main">

        <div
          class="warning-light"
          style="
            color:${risk.color};
            background:${risk.color};
          ">
        </div>

        <div>

          <div
            class="warning-title"
            style="
              color:${risk.color};
            ">

            ${risk.symbol}
            ${risk.level}

          </div>

          <div
            class="warning-score">

            Risk Score:
            ${risk.score}

          </div>

        </div>

      </div>


      <div class="warning-message">

        ${risk.message}

      </div>


      <div class="warning-grid">

        <div
          class="warning-card">

          <div
            class="warning-label">
            Funding Rate
          </div>

          <div
            class="warning-value"
            style="color:#5ee6a8">

            ${
              number(
                item.fundingRate
              ) !== null
                ? fmt(
                    item.fundingRate,
                    4
                  ) + "%"
                : "—"
            }

          </div>

        </div>


        <div
          class="warning-card">

          <div
            class="warning-label">
            BTC OI
          </div>

          <div
            class="warning-value"
            style="color:#b56cff">

            ${
              number(
                item.oiBtc
              ) !== null
                ? fmt(
                    item.oiBtc
                  ) + " BTC"
                : "—"
            }

          </div>

        </div>


        <div
          class="warning-card">

          <div
            class="warning-label">
            OI 1D
          </div>

          <div
            class="warning-value">

            ${
              number(
                item.oiChange1dPct
              ) !== null
                ? (
                    item.oiChange1dPct >= 0
                      ? "+"
                      : ""
                  ) +
                  fmt(
                    item.oiChange1dPct,
                    1
                  ) + "%"
                : "—"
            }

          </div>

        </div>


        <div
          class="warning-card">

          <div
            class="warning-label">
            BTC 1D
          </div>

          <div
            class="warning-value">

            ${
              number(
                item.btcChange1dPct
              ) !== null
                ? (
                    item.btcChange1dPct >= 0
                      ? "+"
                      : ""
                  ) +
                  fmt(
                    item.btcChange1dPct,
                    1
                  ) + "%"
                : "—"
            }

          </div>

        </div>

      </div>


      <div class="warning-note">

        ※ 경고등은 단일 지표가 아니라
        Funding + OI + BTC 가격 모멘텀 +
        mNAV를 종합한 참고용 위험도입니다.
        투자 신호 자체는 아닙니다.

      </div>

    `;
  }


  /* ---------------------------------------
     LOAD
  --------------------------------------- */

  async function load() {

    try {

      const response =
        await fetch(
          HISTORY_URL,
          {
            cache: "no-store"
          }
        );

      if (
        !response.ok
      ) {

        throw new Error(
          "history.json " +
          response.status
        );

      }

      const history =
        await response.json();

      draw(history);

    } catch (error) {

      console.error(
        "Warning error:",
        error
      );

      const content =
        document.getElementById(
          "warningContent"
        );

      if (content) {

        content.innerHTML = `
          <div style="
            padding:20px;
            color:#788496;
          ">
            경고 데이터를 불러오지 못했습니다.
          </div>
        `;

      }

    }

  }


  /* ---------------------------------------
     START
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
