// ============================================================
// js/dk-env-badge.js
// ★★テスト環境の帯（本番と 見間違えない為の1本）★★ 2026-08-28
//
//   ▼何を守るか
//     ★守るのは「★どの倉庫のデータを 触っているか★」であって「どのURLで開いたか」では ありません。★
//     配り先(URL)は 引っ越しで 変わりますが、★本番かテストかは 接続先1本で 決まります★。
//     ⇒ 判定は ★自分の側の名札（DKConfig.ENV）だけ★。
//       ・★ホスト名を 見ない★（引っ越したら 嘘になる）
//       ・★倉庫のIDを 見ない★（差し替えたら 嘘になる）
//       ・★repo名の -test を 証拠にしない★（名前は 中身の証明に ならない）
//
//   ▼迷ったら 出さない
//     名札が ★無い／知らない値★ なら ★何も出しません★。
//     ＝★本番に「テスト環境」と 出る★ という ★一番 高い事故★だけは ★構造上 起こしません★。
//     （逆に「テストなのに 出ない」は 見張りが 赤にして 気づけます）
//
//   ▼なぜ「起きた事」
//     2026-08-21 … 司さんの3台に ★テスト版が 入っていた★。画面のどこにも 本番/テストが出ず、
//     見分けが ★版の字 1行だけ★だった。そのまま働くと ★売上・給料・請求に 1件も 入らない★。
//     その時の帯は ★HTMLに 直に 書いてあり、本番では 手で 消す★形でした
//     （＝★写し忘れ1回で 本番に「テスト用」が 出ます★）。ここを 名札で 決まる形に 直しました。
//
//   ▼書き方の決まり（うちが 踏んだ型）
//     ・★文を flex / grid の箱に 入れない★（★1文字ずつ 縦に 割れます★・2回 踏んだ）
//     ・★帯の高さを 測ってから 中身を 下げる★（決め打ちの数字を 置かない）
//     ・★上に貼り付く物（position:fixed / sticky）も 同じ分 下げる★
//
//   見張り: tests/unit/env-badge.test.js（両repoで 同じ物が 回ります）
// ============================================================
(function (global) {
  'use strict';

  const ID = 'dkEnvBadge';
  // ★知っている名札は この2つだけ★（増やす時は 見張りも 直す）
  const SHITTERU = { test: true, prod: true };

  function nafuda() {
    try {
      const c = global && global.DKConfig;
      return c && typeof c.ENV === 'string' ? c.ENV : null;
    } catch (_) {
      return null;
    }
  }

  // ★出すか どうか＝名札だけで 決める★
  function dasuka(env) {
    if (!env) return false; // 名札が 無い → 出さない
    if (!SHITTERU[env]) return false; // 知らない値 → 出さない
    return env === 'test'; // 'prod' は 出さない
  }

  // ★戻り先は「読み込む側が 明示した時」だけ★（<script src=... data-modoru="office">）
  function modoruSaki() {
    try {
      const d = global.document;
      const tag = d.querySelector('script[data-modoru]');
      if (!tag) return null;
      const kind = tag.getAttribute('data-modoru');
      const c = global.DKConfig;
      if (!c) return null;
      if (kind === 'office' && typeof c.PROD_OFFICE_BASE === 'string') return c.PROD_OFFICE_BASE;
      return null;
    } catch (_) {
      return null;
    }
  }

  function tsukuru() {
    const d = global.document;
    const band = d.createElement('div');
    band.id = ID;
    // ★flex/grid を 使わない★（文が 1文字ずつ 縦に 割れた事が 2回 在ります）
    band.setAttribute(
      'style',
      'position:fixed;top:0;left:0;right:0;z-index:99999;' +
        'display:block;text-align:center;white-space:nowrap;' +
        'background:#c0392b;color:#ffffff;opacity:.95;' +
        "font-family:'Noto Sans JP',sans-serif;font-size:12px;font-weight:700;" +
        'line-height:1.4;padding:3px 6px;pointer-events:none;'
    );
    band.appendChild(d.createTextNode('テスト用（本番ではありません）'));
    // ★戻り先のボタン★（★判定材料では ありません★・出す/出さないは 名札で もう決まっている）
    //   ・住所は ★DKConfig から 受け取る★＝この file に ホスト名を 書かない
    //   ・出すのは ★読み込む側が data-modoru="office" と 明示した画面だけ★
    //     （2026-08-25 司さん「ユーザーは本番前提やのに 引っ越すとか出てくるな」＝
    //       ★メーターの帯には 押す物を 出さない★）
    const modoru = modoruSaki();
    if (modoru) {
      const a = d.createElement('a');
      a.setAttribute('href', modoru);
      // ★帯は pointer-events:none★（下の画面を 押せるようにする為）。
      //   ★中のボタンは auto に 戻さないと DOM に在るのに 永久に 押せない★（2026-08-21 実際に 踏んだ）
      a.setAttribute(
        'style',
        'pointer-events:auto;display:inline-block;margin-left:8px;padding:1px 8px;' +
          'background:#ffffff;color:#c0392b;border-radius:999px;text-decoration:none;font-weight:700;'
      );
      a.appendChild(d.createTextNode('本番を開く'));
      band.appendChild(a);
    }
    return band;
  }

  // ★高さを 測ってから 下げる★（決め打ちの数字を 置かない）
  function sageru(band) {
    const d = global.document;
    const h = band.getBoundingClientRect().height;
    if (!(h > 0)) return 0;
    const b = d.body;
    const moto = global.getComputedStyle ? global.getComputedStyle(b).paddingTop : '';
    const motoPx = parseFloat(moto) || 0;
    b.style.paddingTop = motoPx + h + 'px';
    // ★上に貼り付く物も 同じ分 下げる★（帯に 隠れると 押せなくなる）
    try {
      const all = d.querySelectorAll('body *');
      for (let i = 0; i < all.length; i++) {
        const e = all[i];
        if (e.id === ID) continue;
        const st = global.getComputedStyle(e);
        if (st.position !== 'fixed' && st.position !== 'sticky') continue;
        if (st.top === 'auto' || st.top === '') continue;
        const t = parseFloat(st.top);
        if (!isFinite(t)) continue;
        e.style.top = t + h + 'px';
      }
    } catch (_) {
      /* 下げられなくても 帯は 出す */
    }
    return h;
  }

  function dasu() {
    try {
      const d = global.document;
      if (!d || !d.body) return null;
      if (d.getElementById(ID)) return d.getElementById(ID); // 二重に 出さない
      const env = nafuda();
      if (!dasuka(env)) return null;
      const band = tsukuru();
      d.body.insertBefore(band, d.body.firstChild);
      sageru(band);
      return band;
    } catch (_) {
      return null; // ★帯のせいで 画面を 壊さない★
    }
  }

  function init() {
    try {
      const d = global.document;
      if (!d) return;
      if (d.readyState === 'loading') {
        d.addEventListener('DOMContentLoaded', dasu);
      } else {
        dasu();
      }
    } catch (_) {
      /* noop */
    }
  }

  const api = { ID: ID, dasuka: dasuka, dasu: dasu, init: init };
  if (global) {
    global.DKEnvBadge = api;
    init();
  }
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
