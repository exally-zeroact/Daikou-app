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
  // ★★並びは 司さんの 決め★★ 2026-09-05「月と給料 入れ替えて」
  //   前 … 給料／売上表／月次集計／料金表／会社設定
  //   後 … ★月次集計★／売上表／★給料★／料金表／会社設定
  const SAKI = [
    { f: 'shukei.html', ic: '🧾', na: '月次集計' },
    { f: 'uriage.html', ic: '📊', na: '売上表' },
    // ★★入力（フッターに 1枚）★★ 2026-09-07
    //   ★司さん★「フッターに作れってこやろがぼけ」
    //   ⇒ 毎日 打つ 物（電子決済・高速代・橋代…）は ★ここ 1か所★。
    //   ★飲み屋（Castally）の ✍️入力 と 同じ 場所・同じ 印★
    { f: 'nyuryoku.html', ic: '✍️', na: '入力' },
    { f: 'kyuryo.html', ic: '💰', na: '給料' },
    // ★★料金表の 札は 消しました★★ 2026-09-08
    //   ★司さん★「そもそも料金表タブは消してここに窓作って見せるべきでは？」
    //   ⇒ ★会社設定 →「料金」の 中に 窓で 出す★（1画面 減る）
    //   画面（ryokinhyou.html）は 残します＝紙で 出す 時に 使う。
    { f: 'dashboard.html', ic: '⚙️', na: '会社設定' },
  ];

  // ★★帯を 出す 画面★★ 2026-09-08
  //   札(SAKI)に 無くても ★事務所の 画面なら 帯は 出す★。
  //   ＝料金表を 単体で 開いた 時（紙で 出す 時）に 行き止まりに しない。
  const DASU = SAKI.map(function (x) {
    return x.f;
  }).concat(['ryokinhyou.html']);

  // ★★会社設定の チップ（ここ 1か所）★★ 2026-11-04（司さん「赤丸の所のボタン 訳分からん仕組み・
  //   ボタン押してからの動きに統一感ないし」）
  //   ★前★ 5つが 3通り＝会社・実費は その場／料金は 窓（iframe）／車・従業員は 別の 画面へ 移り 列が 消え、帯は「給料」が 光った
  //   ★今★ どれを 押しても 同じ＝★列は 残る・押した 物が 光る・下に その 中身★。帯は「会社設定」が 光る
  //   同じ 画面の 中（会社↔実費）は その場で 替える（打ちかけの 欄を 消さない・対立役 注A3）
  const CHIP = [
    { k: 'kaisha', na: '会社', href: 'dashboard.html?p=kaisha' },
    { k: 'kuruma', na: '車', href: 'kyuryo.html?henshu=1#kuruma' },
    { k: 'ryokin', na: '料金', href: 'ryokinhyou.html?henshu=1' },
    { k: 'hito', na: '従業員', href: 'kyuryo.html?henshu=1#emp' },
    { k: 'jippi', na: '実費', href: 'dashboard.html?p=jippi' },
  ];
  const DASH_PANE = { kaisha: 1, jippi: 1 };
  const CHIP_KEY = 'dk_dash_chip';

  function ima() {
    const p = location.pathname.split('/').pop() || 'dashboard.html';
    return p;
  }
  function henshu() {
    try {
      return new URLSearchParams(location.search).get('henshu') === '1';
    } catch (_) {
      return false;
    }
  }
  // ★今 居る 所★＝名前だけで 決めない（kyuryo?henshu=1 は 会社設定の 中・対立役 止2）
  function basho() {
    const f = ima();
    if (f === 'dashboard.html' || f === 'ryokinhyou.html') return 'dashboard.html';
    if (f === 'kyuryo.html' && henshu()) return 'dashboard.html';
    return f;
  }
  // ★今 光らせる チップ★（URL から 決める）
  function imaChip() {
    const f = ima();
    if (f === 'dashboard.html') {
      let p = null;
      try {
        p = new URLSearchParams(location.search).get('p');
      } catch (_) {
        p = null;
      }
      if (p && DASH_PANE[p]) return p;
      try {
        const v = localStorage.getItem(CHIP_KEY);
        if (v && DASH_PANE[v]) return v;
      } catch (_) {
        /* 覚えられなくても 動く */
      }
      return 'kaisha';
    }
    if (f === 'ryokinhyou.html') return 'ryokin';
    if (f === 'kyuryo.html') return (location.hash || '') === '#emp' ? 'hito' : 'kuruma';
    return null;
  }
  // ★チップを 出す 画面★＝会社設定・車/従業員の 決める 画面・料金の 決める 画面（見るだけの 料金表・給料の 明細には 出さない・注C1）
  function chipWoDasu() {
    const f = ima();
    if (f === 'dashboard.html') return true;
    return (f === 'kyuryo.html' || f === 'ryokinhyou.html') && henshu();
  }

  // ============================================================
  // ★★移る 前の 門（チップと 帯の 両方が 通る）★★ 2026-11-04（対立役 止1・止3）
  //   画面が window.DKUtsuruMae を 置く＝() → Promise<{ ok:true } | { ok:false, ji:'訳', suteru:true? }>
  //   ★書いている 最中の 物★は 書き終わるまで 待つ（最長 10 秒）。★書けなかった・保存していない★ なら 移らず 知らせる。
  //   suteru:true の 時は「変えた所を 捨てて 移る」を 出す（料金の 画面に 閉じ込めない・対立役 止A1）
  // ============================================================
  let MATSU = false;
  function oshiBotan() {
    return Array.prototype.slice.call(document.querySelectorAll('[data-dkgo],[data-dkchip]'));
  }
  function tomeru(on) {
    oshiBotan().forEach(function (b) {
      b.disabled = !!on;
    });
  }
  function shiraseBako() {
    let m = document.getElementById('dkUtsuruMsg');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'dkUtsuruMsg';
    m.className = 'dk-utsuru-msg noprint';
    m.setAttribute('role', 'alert');
    const chips = document.getElementById('dkChipRow');
    if (chips && chips.parentNode) chips.parentNode.insertBefore(m, chips.nextSibling);
    else {
      const top = document.querySelector('.top');
      if (top && top.parentNode) top.parentNode.insertBefore(m, top.nextSibling);
      else document.body.insertBefore(m, document.body.firstChild);
    }
    return m;
  }
  function shirase(ji, iki) {
    const m = shiraseBako();
    m.textContent = ji || '';
    m.style.display = ji ? '' : 'none';
    if (ji && iki) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dk-suteru';
      b.textContent = '変えた所を 捨てて 移る';
      b.onclick = function () {
        iku(iki);
      };
      m.appendChild(document.createElement('br'));
      m.appendChild(b);
    }
  }
  function mon() {
    const f = window.DKUtsuruMae;
    if (typeof f !== 'function') return Promise.resolve({ ok: true });
    return new Promise(function (yoi) {
      let owari = false;
      const kimeru = function (r) {
        if (owari) return;
        owari = true;
        yoi(r);
      };
      setTimeout(function () {
        kimeru({
          ok: false,
          ji: '保存が 10秒 で 終わらなかったので、画面を 移りませんでした。通信を 確かめて もう一度 押してください。',
        });
      }, 10000);
      try {
        Promise.resolve(f()).then(
          function (r) {
            kimeru(r && r.ok === false ? r : { ok: true });
          },
          function () {
            kimeru({ ok: false, ji: '保存を 確かめられなかったので、画面を 移りませんでした。' });
          }
        );
      } catch (_) {
        kimeru({ ok: false, ji: '保存を 確かめられなかったので、画面を 移りませんでした。' });
      }
    });
  }
  function utsuru(iki, btn, sonoba) {
    if (MATSU) return;
    // 欄を 離れた 時の 保存（車の 名前 等）を 先に 出す
    const a = document.activeElement;
    if (a && a.blur && a !== document.body) a.blur();
    shirase('');
    // ★同じ 画面の 中★は 門を 通さずに その場で 替える（書いた 物は 消えない）
    if (sonoba) {
      sonoba();
      return;
    }
    MATSU = true;
    tomeru(true);
    const lb = btn ? btn.querySelector('.dk-foot-lb') || btn : null;
    const moto = lb ? lb.textContent : '';
    if (lb) lb.textContent = '保存を 待っています…';
    // 欄を 離れた 時の 保存が 走り出すのを 1拍 待つ
    setTimeout(function () {
      mon().then(function (r) {
        if (r.ok) {
          iku(iki);
          return;
        }
        MATSU = false;
        tomeru(false);
        if (lb) lb.textContent = moto;
        shirase(
          r.ji || '保存できなかった 物が あるので、画面を 移りませんでした。',
          r.suteru ? iki : null
        );
      });
    }, 0);
  }
  // ★iPhone の 戻るで 画面ごと 戻った 時★に「待っています」の 字と 止めが 残らない（注A5）
  window.addEventListener('pageshow', function () {
    MATSU = false;
    tomeru(false);
    const n = document.getElementById('dkFooter');
    if (n)
      Array.prototype.forEach.call(n.querySelectorAll('[data-dkgo]'), function (b) {
        const x = SAKI.filter(function (s) {
          return s.f === b.getAttribute('data-dkgo');
        })[0];
        const lb = b.querySelector('.dk-foot-lb');
        if (x && lb) lb.textContent = x.na;
      });
    Array.prototype.forEach.call(document.querySelectorAll('[data-dkchip]'), function (b) {
      const x = CHIP.filter(function (s) {
        return s.k === b.getAttribute('data-dkchip');
      })[0];
      if (x) b.textContent = x.na;
    });
  });
  // ★★移る★★ # の 後ろ だけ 違う 行き先（kyuryo の #kuruma ↔ #emp）は location.href では 読み直さず、
  //   # だけ 替わって 止めが 残り 画面が 固まった（対立役 2026-11-04 止1）＝その時は 読み直す
  function iku(iki) {
    let u = null;
    try {
      u = new URL(iki, location.href);
    } catch (_) {
      u = null;
    }
    const hashDake =
      u &&
      u.hash !== '' &&
      u.pathname === location.pathname &&
      u.search === location.search &&
      u.hash !== location.hash;
    if (hashDake) {
      // 履歴を 増やさない＝端末の「戻る」で # だけ 戻り 画面と 食い違う 形を 作らない（対立役 止A）
      try {
        history.replaceState(null, '', iki);
      } catch (_) {
        location.href = iki;
      }
      location.reload();
      return;
    }
    location.href = iki;
  }
  // ★kyuryo の 会社設定（?henshu=1）で # だけ 替わったら 読み直す★（端末の 戻る・手で # を 替えた 時も 中身と 光る 物を 合わせる・対立役 止A）
  if (ima() === 'kyuryo.html' && henshu()) {
    window.addEventListener('hashchange', function () {
      location.reload();
    });
  }
  function onajiUrl(href) {
    try {
      const u = new URL(href, location.href);
      return u.pathname + u.search + u.hash === location.pathname + location.search + location.hash;
    } catch (_) {
      return false;
    }
  }

  function chipWoTsukuru() {
    if (!chipWoDasu()) return;
    if (document.getElementById('dkChipRow')) return;
    const oki = document.getElementById('dkChips');
    if (!oki) return;
    const now = imaChip();
    const row = document.createElement('div');
    row.id = 'dkChipRow';
    row.className = 'dk-chips noprint';
    row.setAttribute('role', 'tablist');
    row.innerHTML = CHIP.map(function (c) {
      const koko = c.k === now;
      return (
        '<button type="button" role="tab" class="dk-chip' +
        (koko ? ' on' : '') +
        '" data-dkchip="' +
        c.k +
        '"' +
        (koko ? ' aria-selected="true"' : ' aria-selected="false"') +
        '>' +
        c.na +
        '</button>'
      );
    }).join('');
    oki.appendChild(row);
    function hikaru(k) {
      Array.prototype.forEach.call(row.querySelectorAll('[data-dkchip]'), function (b) {
        const on = b.getAttribute('data-dkchip') === k;
        b.className = 'dk-chip' + (on ? ' on' : '');
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }
    row.addEventListener('click', function (ev) {
      let t = ev.target;
      while (t && t !== row && !(t.getAttribute && t.getAttribute('data-dkchip'))) t = t.parentNode;
      const k = t && t.getAttribute && t.getAttribute('data-dkchip');
      if (!k) return;
      const c = CHIP.filter(function (x) {
        return x.k === k;
      })[0];
      if (!c) return;
      if (k === imaChip() && onajiUrl(c.href)) return;
      // 会社設定の 中（会社↔実費）は その場で（画面が window.DKPaneKae を 置く）
      const sonoba =
        ima() === 'dashboard.html' && DASH_PANE[k] && typeof window.DKPaneKae === 'function'
          ? function () {
              window.DKPaneKae(k);
              hikaru(k);
              try {
                history.replaceState(null, '', 'dashboard.html?p=' + k);
              } catch (_) {
                /* 書き替えられなくても 動く */
              }
            }
          : null;
      utsuru(c.href, t, sonoba);
    });
  }
  // 車の 画面の「従業員 →」なども 同じ 道を 通る
  window.DKChipNi = function (k) {
    const b = document.querySelector('[data-dkchip="' + k + '"]');
    if (b) b.click();
  };

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
    if (DASU.indexOf(ima()) < 0) {
      return;
    }
    // ★★窓の 中（?embed=1）では 出さない★★ 2026-09-08
    try {
      if (new URLSearchParams(location.search).get('embed') === '1') return;
    } catch (e) {
      /* 古い端末でも 落とさない */
    }
    if (document.getElementById('dkFooter')) return;

    const now = basho();
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
      // ★今 居る 画面と 同じ 所★だけ 動かない（kyuryo?henshu=1 で「給料」を 押すと 給料の 明細へ 移る・対立役 止2）
      if (onajiUrl(go)) return;
      // 会社設定に 居る 時（?p=kaisha / ?p=jippi も）は 光っている「会社設定」を 押しても 読み直さない
      //   （読み直すと 保存ボタンで 書く 欄の 打ちかけが 黙って 消えた・対立役 2026-11-04 止2）
      if (go === 'dashboard.html' && ima() === 'dashboard.html') return;
      utsuru(go, t);
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
      // ★会社設定の チップ（3画面 同じ 形）★
      '.dk-chips{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 12px}' +
      //   形は 前の 会社設定の チップと 同じ（3画面とも 同じ 変数 --line/--muted/--blue）
      '.dk-chip{background:#fff;border:1px solid var(--line,#dbe7f7);border-radius:999px;padding:7px 14px;' +
      'font-size:13px;font-weight:700;color:var(--muted,#5a6b82);cursor:pointer;font-family:inherit}' +
      '.dk-chip.on{background:var(--blue,#007aff);border-color:var(--blue,#007aff);color:#fff}' +
      '.dk-chip:disabled,.dk-foot-i:disabled{opacity:.6;cursor:default}' +
      '.dk-utsuru-msg{color:#c62828;font-weight:700;margin:0 0 10px;font-size:14px;line-height:1.6}' +
      '.dk-suteru{margin-top:6px;background:#fff;border:1px solid #c62828;color:#c62828;border-radius:999px;' +
      "padding:6px 14px;font-weight:700;font-size:13px;cursor:pointer;font-family:'Noto Sans JP',sans-serif}" +
      // ★帯に 隠れないように 下を 空ける★
      'body{padding-bottom:62px}' +
      '@media print{.dk-foot,.dk-chips,.dk-utsuru-msg{display:none!important}body{padding-bottom:0}}';
    document.head.appendChild(css);
    document.body.appendChild(nav);
    chipWoTsukuru();

    // ★★頭の「← 戻る」は 消しました★★ 2026-11-04（司さん「左上に意味わからん戻るボタンもあるし」）
    //   ★前★ 6画面 全部の 頭に 置き、history.back()＝「前に 見た 画面」へ 戻るだけ（下の 帯と 食い違う）。
    //     車・従業員・料金を 変える では「← 会社設定へ 戻る」と 2つ 並んでいた。
    //   ★今★ 移るのは ★下の 帯 と 会社設定の チップ だけ★（飲み屋 Castally と 同じ＝頭に 戻るは 無い）
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tsukuru);
  } else {
    tsukuru();
  }

  // ============================================================
  // ★★戻ってきた時に 新しく する★★ 2026-09-18
  //   ★司さん★「開いただけではアップデートされんやないか
  //             タスクキルして初めてアップデートされるけどなんでどぼけ」
  //
  //   ★訳（実測 2026-09-18）★
  //     ・事務所の 5枚は ★サービスワーカーを 1つも 登録していない★
  //       （メーター index.html だけ controllerchange→reload を 持っている）
  //     ・ホーム画面に 入れた iPhone の アプリは
  //       ★画面を 記憶に 持ったまま 復帰する★＝★取りに 行かない★
  //     ⇒ ★アプリを 切る まで 古いまま★ だった。
  //
  //   ★直し方＝ETag（配信物の 指紋）を 見る★
  //     ・実測 … 事務所/メーター どちらの 入口でも 同じ ETag が 返る
  //       Cache-Control: public, max-age=0, must-revalidate ＝★毎回 確かめる 設定★
  //     ・戻ってきた時に ★頭だけ（HEAD）★ 取りに 行き、
  //       指紋が 変わっていたら ★読み直す★。
  //   ★新しい ファイルを 作らない★＝事務所の 中継の 名簿（office-host/vercel.json）を
  //     ★2つの repo で 直す★ 羽目に なる。だから 5枚が 既に 読む この 1本に 入れる。
  // ============================================================
  let SHIMON = null; // 開いた 時の 指紋
  let YONDA = false; // ★1回の 変わり目で 1回だけ 読み直す★（輪に しない）

  function shimonWoToru() {
    try {
      return fetch(window.location.href, { method: 'HEAD', cache: 'no-store' })
        .then(function (r) {
          return r.ok ? r.headers.get('ETag') || r.headers.get('Last-Modified') : null;
        })
        .catch(function () {
          return null; // ★圏外でも 何も しない★（仕事を 止めない）
        });
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  function uchikondeiruka() {
    // ★打っている 最中は 読み直さない★（打ちかけの 数字を 消さない）
    const a = document.activeElement;
    if (!a) return false;
    const t = (a.tagName || '').toLowerCase();
    return t === 'input' || t === 'textarea' || t === 'select' || a.isContentEditable === true;
  }

  function mitekuru() {
    if (YONDA || document.visibilityState !== 'visible') return;
    shimonWoToru().then(function (ima) {
      if (!ima || !SHIMON) return;
      if (ima === SHIMON) return;
      if (uchikondeiruka()) return; // ★次に 戻ってきた 時に また 見る★
      YONDA = true;
      window.location.reload();
    });
  }

  shimonWoToru().then(function (x) {
    SHIMON = x;
  });
  document.addEventListener('visibilitychange', mitekuru);
  window.addEventListener('pageshow', mitekuru);

  // ★選ぶ欄の板・キーボードを閉じた後に 見える枠が ずれたまま 残るのを 戻す★ 2026-10-23
  //   iPhone の ホーム画面アプリで 月の 選ぶ欄を 閉じた 後、下の 帯が 画面の 途中に 浮き・上に 空白が 出た（司さんの 写真）。
  //   ずれた 量（約 337px）が 板の 高さに 近い。今の 位置へ 巻き直すと 枠が 戻る（位置は 変えない）。
  //   ★webkit の 試験では 再現 できない★（iOS の 板を 持たない）＝見立ての 手当て
  //   ★欄から 欄へ 移る 時は 巻き直さない★（対立役 10-23：「次へ」で iOS が 次の 欄へ 巻く 途中を
  //   scrollTo が 止め、次の 欄が キーボードの 裏に 残った＝webkit 1309／正しくは 2997）
  const RAN = /^(SELECT|INPUT|TEXTAREA)$/;
  function ranNiIru() {
    const a = document.activeElement;
    return !!(a && RAN.test(a.tagName));
  }
  function wakuWoModosu(mamoru) {
    setTimeout(function () {
      if (mamoru && ranNiIru()) return;
      window.scrollTo(window.scrollX, window.scrollY);
    }, 60);
  }
  document.addEventListener('focusout', function (ev) {
    const t = ev.target;
    if (!t || !RAN.test(t.tagName)) return;
    if (ev.relatedTarget && RAN.test(ev.relatedTarget.tagName)) return;
    wakuWoModosu(true);
  });
  // 選ぶ欄は 板を 閉じても 欄に 居続ける ことが ある＝選んだ 時は 守りなしで 戻す（巻きの 途中ではない）
  document.addEventListener('change', function (ev) {
    if (ev.target && ev.target.tagName === 'SELECT') wakuWoModosu(false);
  });
})();
