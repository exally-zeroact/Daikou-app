'use strict';
// ============================================================
// ★★紙（A4）の 中身を 組む — ★型は この1本★★★ 2026-09-25
//
//   ★司さん★「ユーザーごとに対応できるようにしとんか？」
//   ⇒ ★焼き付けを 0 に する★＝会社名・実費の名前・給料の区切り・積立の率・
//     電子決済の有無・車の台数・人数・月の日数 は ★全部 呼ぶ側が 渡す★。
//
//   ★司さんが 決めた 事（2026-09-25）★
//     ・売上表は ★お金の 欄だけ★（現金／請求書／電子決済／経費）
//       「回数とか距離とか1時間あたりとか売上表とかに出せってゆうてなかろが」
//     ・★回数と 距離は 別の 紙★「回数や距離はまた別項目で作れや」
//     ・日付の 横に ★曜日★／★日曜の 列だけ 薄い 赤★（土曜は 色を 付けない）
//     ・金額は ★円のまま★「そのままでやれや銀行やないんど」（千円は やめ）
//
//   ★★給料の 日ごとは「日付が ★上★」★★ 2026-09-25（司さん 差し戻し）
//     「上に日付持ってきて前半後半やなかったか？」「時間の方も金額のように前半後半に分けて」
//     ⇒ 行＝従業員／列＝日付（曜日つき）／★日曜の 列★ が 薄い 赤。
//     ⇒ 金額の 紙 と 時間の 紙 の ★2枚★（1組）。
//
//   ★★列の 幅★★（司さん「自動調整は名前しか言うてなかろが」）
//     ・日の 列と 計の 列 … ★決め打ちの 同じ 幅★（中身で 伸び縮みさせない）
//     ・名前の 列 ………… ★ここだけ 中身の 長さで 決める★（js/kami-hyou.js の naHabaOf）
//     ・入らない 数は ★切らずに 折り返す★（桁が 消える 方が 危ない）
//
//   ★1枚に 入る 数（2026-09-25 実測・はみ出し0で 確かめた）★
//     給料 日ごと … A4横で ★1組 9人まで★（10人以上は 組を 分ける／9人で 縦 697px）
//     車ごと … 7台以上は 2列に 割る（12台で 234px はみ出した）
//
//   ★見張り★ tests/unit/kami-kumu.test.js
// ============================================================

(function (global) {
  const YOUBI = ['月', '火', '水', '木', '金', '土', '日'];
  const HITO_1MAI = 9; // ★給料 日ごと＝1枚 9人まで★（実測）
  const KURUMA_2RETSU = 7; // ★車ごと＝7台以上は 2列★（実測）

  function n(v) {
    const x = Number(v);
    return isFinite(x) ? x : 0;
  }
  function en(v) {
    if (v === null || v === undefined) return '<span class="z">—</span>';
    return n(v) === 0 ? '<span class="z">0</span>' : Number(n(v)).toLocaleString('ja-JP');
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function matsubi(y, m) {
    return new Date(y, m, 0).getDate();
  }
  // ★曜日は 日付から 出す★（倉庫の 時刻では ない＝時間帯の ずれが 出ない）
  function youbi(y, m, d) {
    return (new Date(y, m - 1, d).getDay() + 6) % 7; // 0=月 … 6=日
  }
  function nichiyo(y, m, d) {
    return youbi(y, m, d) === 6;
  }

  // ★給料の 払う回の 区切り＝会社設定から★（1〜10日… の 焼き付けを やめる）
  function kikan(y, m, s) {
    const hajime = n((s && s.period_start_day) || 1) || 1;
    const haba = n((s && s.period_days) || 10) || 10;
    const last = matsubi(y, m);
    const out = [];
    for (let d = hajime; d <= last; ) {
      const e = Math.min(d + haba - 1, last);
      out.push(e < last ? d + '〜' + e + '日' : d + '日〜末日');
      d = e + 1;
    }
    return out;
  }

  const CSS = [
    '*{box-sizing:border-box;margin:0;padding:0}',
    ".dk-kami{background:#fff;padding:27px 30px;color:#14243d;display:flex;flex-direction:column;font-family:'Hiragino Kaku Gothic ProN','Noto Sans JP',system-ui,sans-serif;font-variant-numeric:tabular-nums}",
    '.dk-kami .hd{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;border-bottom:2.5px solid #0a5fd0;padding-bottom:9px}',
    '.dk-kami .co{font-size:24px;font-weight:800;min-width:0;flex:1 1 auto;line-height:1.25;word-break:break-word}',
    '.dk-kami .co small{display:block;font-size:13px;font-weight:400;color:#5a6b82;margin-top:3px}',
    '.dk-kami .ttl{text-align:right;flex:0 0 auto}',
    '.dk-kami .ttl b{font-size:20px;color:#0a5fd0}',
    '.dk-kami .ttl span{display:block;font-size:14px;color:#5a6b82;margin-top:3px}',
    '.dk-kami h2{font-size:14.5px;margin:14px 0 6px;padding-left:9px;border-left:4px solid #0a5fd0;line-height:1.5}',
    '.dk-kami table{width:100%;border-collapse:collapse;font-size:13.5px}',
    '.dk-kami th,.dk-kami td{border:1px solid #c8d6e8;padding:4px 7px;text-align:right}',
    '.dk-kami th{background:#eef4fc;font-size:12px;color:#43536b;font-weight:700}',
    // ★先頭の列は ★中身の 長さで 自動★（width:1% + nowrap ＝収まる 最小幅）
    //   ★司さん 2026-09-25★「名前はもう少し余白いることないか？
    //     文字数多いとか配慮して自動で幅も調整しろよ」
    //   ⇒ 幅は 元から 自動（長い 名前の 分だけ 伸びる）。★足りなかったのは 余白★。
    //   ★実測（2026-09-25）★「山田 太郎」で 左右の 隙間 7px/6px ⇒ 枠に くっついて 見えた。
    //   ⇒ 左 11px / 右 18px に し、短い 名前でも 見出しが 潰れないよう 最小幅を 置く。
    '.dk-kami th:first-child,.dk-kami td:first-child{text-align:left;width:1%;white-space:nowrap;padding:4px 18px 4px 11px;min-width:78px}',
    '.dk-kami tr.sum td{font-weight:800;background:#f4f9ff}',
    '.dk-kami .z{color:#b9c6d8}',
    '.dk-kami .futatsu,.dk-kami .nibun{display:flex;gap:12px;align-items:flex-start}',
    '.dk-kami .futatsu>div,.dk-kami .nibun>div{flex:1;min-width:0}',
    '.dk-kami .futatsu h2{margin-top:0}',
    '.dk-kami .nibun table{font-size:12px}',
    '.dk-kami .nibun th,.dk-kami .nibun td{padding:1.5px 6px;line-height:1.3}',
    '.dk-kami .nibun th{font-size:11px}',
    // ★★日付を 上に 並べる 表（前半／後半）★★ 2026-09-25
    //   15〜16列 並ぶので 字を 小さくして 余白を 削る（A4横）。
    //   ★先頭の 名前の 列だけは 余白を 残す★（上の first-child が 効く）
    // ★日ごとの 列は ★決め打ちの 同じ 幅★（司さん「自動調整は名前しか言うてなかろが」）
    //   table-layout:fixed ➕ <colgroup> で 幅を 固める。
    //   ★th:first-child の width:1% を ここだけ 打ち消す★（fixed では 先頭行が colgroup より 強い）
    '.dk-kami .hiyoko table{font-size:11px;table-layout:fixed}',
    '.dk-kami .hiyoko th:first-child,.dk-kami .hiyoko td:first-child{width:auto}',
    // ★桁を 落とすより 2行に なる 方が まし★（画面の 表 table.kami と 同じ 決め）
    //   ★実測 2026-09-25★ 31日の 月 ➕ 長い 名前だと 日の 列は 53px。
    //     overflow:hidden だと「108,000」が ★黙って 切られた★（12マス・e2e が 赤に した）。
    //   ⇒ ★幅は 固定のまま、入らない 数は 折り返す★
    //     （黙って 切れるより 背が 伸びる 方が 安全。はみ出しは e2e が 見ている）
    '.dk-kami .hiyoko th,.dk-kami .hiyoko td{padding:2px 3px;line-height:1.35;white-space:normal;word-break:break-all;overflow:visible}',
    '.dk-kami .hiyoko th{font-size:10px}',
    // ★名前の 列だけ 余白を 残し、折り返さない★
    '.dk-kami .hiyoko th:first-child,.dk-kami .hiyoko td:first-child{padding:2px 14px 2px 9px;white-space:nowrap;word-break:normal}',
    '.dk-kami .hiyoko+h2{margin-top:11px}',
    // ★列が 少ない 表を A4横いっぱいに 伸ばさない★（右が 丸ごと 空く）
    '.dk-kami .hanbun{max-width:560px}',
    '.dk-kami .big{display:flex;gap:12px;margin-top:14px}',
    '.dk-kami .big>div{flex:1;border:1.5px solid #dbe7f7;border-radius:8px;padding:9px 12px;background:#f7fbff}',
    '.dk-kami .big .k{font-size:13px;color:#5a6b82;font-weight:700}',
    '.dk-kami .big .v{font-size:24px;font-weight:800;margin-top:3px;letter-spacing:-.5px}',
    '.dk-kami .big .aka{background:#eaf3ff;border-color:#bcd8ff}',
    '.dk-kami .big .aka .v{color:#0a5fd0}',
    // ★日曜だけ 薄い 赤★（司さん「色は日曜だけでええ」）
    '.dk-kami .nichi{background:#fdeaea!important}',
    '.dk-kami th.nichi{background:#fbdcdc!important;color:#a33!important}',
    '.dk-kami .yb{font-size:.82em;opacity:.75;margin-left:1px}',
    '.dk-kami .ft{margin-top:auto;padding-top:9px;border-top:1px solid #dbe7f7;font-size:11.5px;color:#8494a8;display:flex;justify-content:space-between}',
  ].join('');

  function ita(muki, naka) {
    const d = document.createElement('div');
    d.className = 'dk-kami';
    d.innerHTML = '<style>' + CSS + '</style>' + naka;
    return d;
  }

  function atama(k, dai, sub) {
    return (
      '<div class="hd"><div class="co">' +
      esc(k.name || '') +
      '<small>ダイコメ</small></div><div class="ttl"><b>' +
      esc(dai) +
      '</b><span>' +
      esc(sub) +
      '</span></div></div>'
    );
  }
  // ★★紙の 下に 要らない 物を 出さない★★ 2026-09-25
  //   ★司さん★「Castallyや代行請求書のようにPDFの下に要らんものは表示されんようにしろよ」
  //   ★代行請求書の 実物★（Exally-test/invoice-pdf.js）を 読んだ：
  //     紙の 下に 在るのは ★自社の 情報だけ★。★ページ番号も 説明書きも 無い★。
  //   ★私が 勝手に 足していた 物（全部 やめる）★
  //     ・「日曜は 薄い赤」「点は 勤務なし」等の ★説明書き★
  //     ・「売上＝メーターの合計 − 選んだ実費」等の ★注記★
  //     ・「1 / 1」の ★ページ番号★（1枚しか 無い 時も 出していた）
  //   ★残す のは 何枚に 分かれた 時の「2 / 3枚」だけ★
  //     ＝どれが 抜けたか 分からないと 困る（代行請求書も 複数ページの 時だけ 出す）。
  //     1枚の 時は ★何も 出さない★。
  function ashi(k, dai, sub, memo, mai, zen) {
    void k;
    void dai;
    void sub;
    void memo; // ★受け取るが 出さない★（呼ぶ側を 直さずに 済ませる）
    if (!zen || zen <= 1) return '';
    return '<div class="ft"><span></span><span>' + (mai || 1) + ' / ' + zen + '</span></div>';
  }
  function hyou(ths, rows, sum) {
    return (
      '<table><thead><tr>' +
      ths.join('') +
      '</tr></thead><tbody>' +
      rows.join('') +
      (sum || '') +
      '</tbody></table>'
    );
  }
  function thHi(y, m, d) {
    const c = nichiyo(y, m, d) ? ' class="nichi"' : '';
    return '<th' + c + '>' + d + '<span class="yb">' + YOUBI[youbi(y, m, d)] + '</span></th>';
  }
  function tdHi(y, m, d, naka) {
    return '<td' + (nichiyo(y, m, d) ? ' class="nichi"' : '') + '>' + naka + '</td>';
  }
  function box(k, v, aka) {
    return (
      '<div' +
      (aka ? ' class="aka"' : '') +
      '><div class="k">' +
      esc(k) +
      '</div><div class="v">' +
      v +
      '</div></div>'
    );
  }

  const api = {
    YOUBI: YOUBI,
    HITO_1MAI: HITO_1MAI,
    KURUMA_2RETSU: KURUMA_2RETSU,
    CSS: CSS,
    en: en,
    esc: esc,
    matsubi: matsubi,
    youbi: youbi,
    nichiyo: nichiyo,
    kikan: kikan,
    ita: ita,
    atama: atama,
    ashi: ashi,
    hyou: hyou,
    thHi: thHi,
    tdHi: tdHi,
    box: box,
  };
  if (typeof global !== 'undefined') global.KamiKumu = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
