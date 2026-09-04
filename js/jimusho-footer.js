'use strict';
// ============================================================
// ★★事務所の 下の 帯（各ページへ 飛ぶ）★★ 2026-09-04（司さん）
//
//   ★司さんの言葉★
//     「★この事務所だけ 他の アプリと 違う 型式なんを 同じに しろや★」
//     「★フッター 作って 各ページに 飛ぶようにしろ★」
//     「★分かりにくいって 前から いやろが★」
//
//   ★実測（2026-09-04・直す前）★
//     ・下の 帯 … ★5枚とも 0個★
//       （飲み屋 Castally には 在る … 📊集計 🧾請求書 ✍️入力 📋一覧 💰給料 🧰締め）
//     ・行き先が ★画面ごとに バラバラ★
//         dashboard  → ★どこへも 行けない（行き止まり）★
//         kyuryo     → 売上表・月次集計・会社設定
//         uriage     → 給料・月次集計・会社設定
//         shukei     → 売上表・給料・会社設定
//         ryokinhyou → 売上表・給料・月次集計・会社設定
//     ・料金表へ 入る 口 … ★1枚からも 無い★
//     ・今 どこに 居るかの 印 … ★無い★
//
//   ★この 部品の 決まり★
//     ・★行き先は ここ 1か所★（画面ごとに 手書きしない＝バラバラに ならない）
//     ・★今の 画面は 色を 変える★（どこに 居るか 分かる）
//     ・★紙には 出さない★（noprint）
//     ・★本人モード（?t=）では 出さない★＝従業員に 事務所の 画面は 見せない
//     ・見た目は ★飲み屋（Castally）の bottom-nav と 同じ 作り★
// ============================================================

(function () {
  // ★行き先は ここだけ★
  const SAKI = [
    { f: 'kyuryo.html', ic: '💰', na: '給料' },
    { f: 'uriage.html', ic: '📊', na: '売上表' },
    { f: 'shukei.html', ic: '🧾', na: '月次集計' },
    { f: 'ryokinhyou.html', ic: '💴', na: '料金表' },
    { f: 'dashboard.html', ic: '⚙️', na: '会社設定' },
  ];

  function ima() {
    const p = location.pathname.split('/').pop() || 'dashboard.html';
    return p;
  }

  function tsukuru() {
    // ★本人モード（?t=）では 出さない★
    try {
      if (new URLSearchParams(location.search).get('t')) return;
    } catch (e) {
      /* 古い端末でも 落とさない */
    }
    // ★★ログイン画面には 出さない★★ 2026-09-04
    //   ★dashboard は ログインしていないと login.html へ 飛ばします★。
    //     その ★飛ぶ 前の 一瞬★ に 帯が 出ていました（絵で 気づいた）。
    //   ⇒ ★事務所の 画面（下の 名簿に 在る 物）でだけ 出す★
    if (
      !SAKI.some(function (x) {
        return x.f === ima();
      })
    ) {
      return;
    }
    if (document.getElementById('dkFooter')) return;

    const now = ima();
    const nav = document.createElement('nav');
    nav.id = 'dkFooter';
    nav.className = 'dk-foot noprint';
    nav.innerHTML = SAKI.map(function (x) {
      const koko = x.f === now;
      return (
        '<button type="button" class="dk-foot-i' +
        (koko ? ' on' : '') +
        '" data-dkgo="' +
        x.f +
        '"' +
        (koko ? ' aria-current="page"' : '') +
        '><span class="dk-foot-ic">' +
        x.ic +
        '</span><span class="dk-foot-lb">' +
        x.na +
        '</span></button>'
      );
    }).join('');

    nav.addEventListener('click', function (ev) {
      let t = ev.target;
      while (t && t !== nav && !(t.getAttribute && t.getAttribute('data-dkgo'))) t = t.parentNode;
      const go = t && t.getAttribute && t.getAttribute('data-dkgo');
      if (!go) return;
      if (go === ima()) return; // ★今 居る所は 押しても 動かない★
      location.href = go;
    });

    const css = document.createElement('style');
    css.textContent =
      '.dk-foot{position:fixed;bottom:0;left:0;right:0;z-index:60;background:#fff;' +
      'border-top:1px solid #d7e3f5;display:flex;justify-content:space-around;' +
      'box-shadow:0 -2px 8px rgba(30,80,140,.06);padding-bottom:env(safe-area-inset-bottom)}' +
      '.dk-foot-i{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;' +
      'padding:8px 2px 7px;background:none;border:none;cursor:pointer;color:#5b6b80;' +
      "font-family:'Noto Sans JP',sans-serif}" +
      '.dk-foot-i.on{color:#1e6bff}' +
      '.dk-foot-ic{font-size:18px;line-height:1}' +
      '.dk-foot-lb{font-size:10px;font-weight:700;white-space:nowrap}' +
      // ★帯に 隠れないように 下を 空ける★
      'body{padding-bottom:62px}' +
      '@media print{.dk-foot{display:none!important}body{padding-bottom:0}}';
    document.head.appendChild(css);
    document.body.appendChild(nav);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tsukuru);
  } else {
    tsukuru();
  }
})();
