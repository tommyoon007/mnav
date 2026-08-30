/* =========================================
   BTC Leverage Warning System
   SAFE / CAUTION / OVERHEATED / EXTREME
========================================= */

(function () {

  const DATA_URL =
    "history.json?ts=" + Date.now();

  const WARNING_ID =
    "btcLeverageWarning";

  /* ---------------------------------------
     CSS
  --------------------------------------- */

  function injectStyle() {

    if (
      document.getElementById(
        "btcWarningStyle"
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "btcWarningStyle";

    style.textContent = `

      #${WARNING_ID} {
        margin: 22px 0;
        padding: 20px 22px;
        border-radius: 14px;
        background:
          linear-gradient(
            135deg,
            #111722,
            #0d121b
          );
        border:
          1px solid
          rgba(255,255,255,.08);
        box-shadow:
          0 12px 35px
          rgba(0,0,0,.25);
      }

      .btc-warning-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 15px;
        margin-bottom: 16px;
      }

      .btc-warning-title {
        font-size: 16px;
        font-weight: 800;
        color: #e8edf3;
      }

      .btc-warning-status {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 7px 13px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 900;
        letter-spacing: .4px;
      }

      .btc-warning-light {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        display: inline-block;
        box-shadow:
          0 0 10px currentColor;
      }

      .btc-warning-grid {
        display: grid;
        grid-template-columns:
          repeat(3, 1fr);
        gap: 10px;
      }

      .btc-warning-card {
        padding: 12px;
        border-radius: 10px;
        background: #101620;
        border:
          1px solid
          rgba(255,255,255,.06);
      }

      .btc-warning-label {
        font-size: 11px;
        color: #7f8b9c;
      }

      .btc-warning-value {
        margin-top: 5px;
        font-size: 17px;
        font-weight: 800;
      }

      .btc-warning-note {
        margin-top: 14px;
        font-size: 12px;
        line-height: 1.6;
        color: #8f9bab;
      }

      .btc-warning-building {
        color: #f3c64e;
      }

      @media (max-width: 650px) {

        .btc-warning-grid {
          grid-template-columns:
            1fr;
        }

        .btc-warning-header {
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
     Section
  --------------------------------------- */

  function createWarning() {

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

      <div class="btc-warning-header">

        <div class="btc-warning-title">
          ⚡ BTC 레버리지 위험도
        </div>

        <div
          id="btcWarningStatus"
          class="btc-warning-status">
        </div>

      </div>

      <div
        id="btcWarningGrid"
        class="btc-warning-grid">
      </div>

      <div
        id="btcWarningNote"
        class="btc-warning-note">
      </div>

    `;


    /*
      핵심 결과 바로 아래에 삽입
    */

    const resultSection =
      document.querySelector(
        ".result-section"
      );

    if (resultSection) {

      resultSection.parentNode.insertBefore(
        section,
        resultSection.nextSibling
      );

    } else {

      const header =
        document.querySelector(
          "header"
        );

      if (header) {

        header.parentNode.insertBefore(
          section,
          header.nextSibling
        );

      } else {

        document.body.prepend(
          section
        );
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
     최근 7일 기준값
  --------------------------------------- */

  function getPrevious7Day(
    history
  ) {

    if (
      history.length < 2
    ) {
      return null;
    }

    const latest =
      history[
        history.length - 1
      ];

    const latestDate =
      new Date(
        latest.date
      );

    let candidate = null;

    for (
      let i = 0;
      i < history.length - 1;
      i++
    ) {

      const item =
        history[i];

      const date =
        new Date(
          item.date
        );

      const diff =
        (
          latestDate -
          date
        ) /
        86400000;

      if (
        diff >= 6 &&
        diff <= 10
      ) {

        candidate = item;
      }
    }

    return candidate;
  }


  /* ---------------------------------------
     변화율
  --------------------------------------- */

  function changePercent(
    latest,
    previous,
    key
  ) {

    const a =
      number(
        previous &&
        previous[key]
      );

    const b =
      number(
        latest &&
        latest[key]
      );

    if (
      a === null ||
      b === null ||
      a === 0
    ) {
      return null;
    }

    return (
      (
        b / a
      ) - 1
    ) * 100;
  }


  /* ---------------------------------------
     Funding 위험 단계
  --------------------------------------- */

  function fundingLevel(
    funding
  ) {

    /*
      Funding은 % 단위

      < 0.01%
      SAFE

      0.01 ~ 0.03%
      CAUTION

      0.03 ~ 0.05%
      OVERHEATED

      >= 0.05%
      EXTREME
    */

    if (
      funding === null ||
      funding < 0.01
    ) {
      return 0;
    }

    if (
      funding < 0.03
    ) {
      return 1;
    }

    if (
      funding < 0.05
    ) {
      return 2;
    }

    return 3;
  }


  /* ---------------------------------------
     OI 위험 단계
     7일 증가율
  --------------------------------------- */

  function oiLevel(
    oiChange
  ) {

    if (
      oiChange === null ||
      oiChange < 5
    ) {
      return 0;
    }

    if (
      oiChange < 10
    ) {
      return 1;
    }

    if (
      oiChange < 20
    ) {
      return 2;
    }

    return 3;
  }


  /* ---------------------------------------
     상태
  --------------------------------------- */

  function getStatus(
    funding,
    oiChange,
    btcChange
  ) {

    const f =
      fundingLevel(
        funding
      );

    const o =
      oiLevel(
        oiChange
      );

    let level =
      Math.max(
        f,
        o
      );


    /*
      BTC가 급등하면서
      Funding + OI가 동시에 증가하면
      한 단계 더 주의한다.
    */

    if (
      funding !== null &&
      oiChange !== null &&
      btcChange !== null
    ) {

      if (
        funding >= 0.03 &&
        oiChange >= 10 &&
        btcChange >= 5
      ) {

        level =
          Math.min(
            3,
            level + 1
          );
      }
    }


    const statuses = [

      {
        name: "SAFE",
        icon: "🟢",
        color: "#5ee6a8",
        background:
          "rgba(94,230,168,.10)"
      },

      {
        name: "CAUTION",
        icon: "🟡",
        color: "#f3c64e",
        background:
          "rgba(243,198,78,.10)"
      },

      {
        name: "OVERHEATED",
        icon: "🟠",
        color: "#ff9f43",
        background:
          "rgba(255,159,67,.10)"
      },

      {
        name: "EXTREME",
        icon: "🔴",
        color: "#ff4d5a",
        background:
          "rgba(255,77,90,.10)"
      }

    ];

    return statuses[level];
  }


  /* ---------------------------------------
     Format
  --------------------------------------- */

  function fmt(
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
     Render
  --------------------------------------- */

  function render(
    history
  ) {

    const status =
      document.getElementById(
        "btcWarningStatus"
      );

    const grid =
      document.getElementById(
        "btcWarningGrid"
      );

    const note =
      document.getElementById(
        "btcWarningNote"
      );

    if (
      !status ||
      !grid ||
      !note
    ) {
      return;
    }


    if (
      !Array.isArray(history) ||
      history.length === 0
    ) {

      status.innerHTML =
        `<span>⚪</span> DATA`;

      grid.innerHTML =
        "";

      note.textContent =
        "아직 데이터가 없습니다.";

      return;
    }


    const latest =
      history[
        history.length - 1
      ];


    const previous7 =
      getPrevious7Day(
        history
      );


    const funding =
      number(
        latest.fundingRate
      );


    const oiChange =
      changePercent(
        latest,
        previous7,
        "oiBtc"
      );


    const btcChange =
      changePercent(
        latest,
        previous7,
        "btc"
      );


    /*
      7일 데이터가 아직 부족하면
      Funding만으로 임시 판정
    */

    const enoughHistory =
      previous7 !== null &&
      oiChange !== null;


    const statusData =
      getStatus(
        funding,
        oiChange,
        btcChange
      );


    status.style.color =
      statusData.color;

    status.style.background =
      statusData.background;

    status.innerHTML = `
      <span>
        ${statusData.icon}
      </span>
      ${statusData.name}
    `;


    grid.innerHTML = `

      <div
        class="btc-warning-card">

        <div
          class="btc-warning-label">
          Funding Rate
        </div>

        <div
          class="btc-warning-value"
          style="
            color:${funding !== null
              ? statusData.color
              : "#788496"};
          ">

          ${
            funding !== null
              ? fmt(
                  funding,
                  4
                ) + "%"
              : "—"
          }

        </div>

      </div>


      <div
        class="btc-warning-card">

        <div
          class="btc-warning-label">
          BTC OI 7일 변화
        </div>

        <div
          class="btc-warning-value"
          style="
            color:${
              oiChange !== null
                ? (
                    oiChange >= 0
                      ? "#b56cff"
                      : "#5ee6a8"
                  )
                : "#788496"
            };
          ">

          ${
            oiChange !== null
              ? (
                  oiChange >= 0
                    ? "+"
                    : ""
                ) +
                oiChange.toFixed(
                  1
                ) +
                "%"
              : "데이터 축적 중"
          }

        </div>

      </div>


      <div
        class="btc-warning-card">

        <div
          class="btc-warning-label">
          BTC 7일 변화
        </div>

        <div
          class="btc-warning-value"
          style="
            color:${
              btcChange !== null
                ? (
                    btcChange >= 0
                      ? "#4d9cff"
                      : "#ff4d5a"
                  )
                : "#788496"
            };
          ">

          ${
            btcChange !== null
              ? (
                  btcChange >= 0
                    ? "+"
                    : ""
                ) +
                btcChange.toFixed(
                  1
                ) +
                "%"
              : "데이터 축적 중"
          }

        </div>

      </div>

    `;


    if (
      !enoughHistory
    ) {

      note.innerHTML =
        `
        ⚠️ <strong>
        초기 데이터 축적 중
        </strong><br>
        현재 Funding을 기준으로
        임시 위험도를 표시합니다.
        OI 7일 데이터가 쌓이면
        정식 SAFE / CAUTION /
        OVERHEATED / EXTREME 판정으로
        자동 전환됩니다.
        `;

    } else {

      note.innerHTML =
        `
        Funding + OI 7일 변화 + BTC 7일 변화를
        함께 사용한 레버리지 위험도입니다.
        <br>
        이 신호는 매매 신호가 아니라
        레버리지 과열 정도를 판단하기 위한
        보조지표입니다.
        `;
    }
  }


  /* ---------------------------------------
     Load
  --------------------------------------- */

  async function load() {

    try {

      const response =
        await fetch(
          DATA_URL,
          {
            cache:
              "no-store"
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

      const data =
        await response.json();

      render(data);

    } catch (error) {

      console.error(
        "BTC warning error:",
        error
      );

      const status =
        document.getElementById(
          "btcWarningStatus"
        );

      if (status) {

        status.innerHTML =
          "⚪ DATA ERROR";

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

      createWarning();

      load();

    }
  );

})();
