/* ==========================================================================
   js/pdf-okuru.js — PDF を 送る（iPhone・iPad は 共有の 画面に PDF と 字だけ 渡す）
   ★2026-11-06 司さんの 答え「B」★（11-04「LINE で PDF と 一緒に 開けない blob:https://… の URL も 届く・
     どの アプリでも ならない 様に」）
     ・直す 前＝PDF を blob の URL で 開き、その 画面の 共有から 送っていた
       ＝iPhone は ★開いている 頁の URL（blob:https://…）も 一緒に 渡す★ → LINE に 開けない URL が 届いた。
     ・直した 後＝navigator.share に ★files と text だけ★（url・title は 付けない）。
       司さんの 実機（テスト線 share-test.html の B）で LINE に 字と PDF の 両方が 届いた。
     ・★files だけ（A）には 戻さない★＝10-25・10-30 に Daikou-app で 入れて「LINE ないやないか」（共有の 画面に LINE が 並ばない）。
     ・Android・パソコン＝今まで 通り（呼ぶ 側の 道）。共有が 使えない・ほかの エラー＝今まで 通り。
     ・iPhone は PDF を 作る 数秒の 間に「押した」扱いが 切れて 断る 事が ある（NotAllowedError）
       ＝今の 道に 落とすと URL が 付く 道に 戻る ⇒ 画面に「送る・印刷する」の 帯を 出し、押した 時に 同じ 共有を 開く。
   ★写し元＝代行請求書 daikou-seikyu の lib/pdf-okuru.js（本番 bdecd29）★ 違いは 2つだけ：
     ①添える 字＝namaeJi（紙の 名前）。請求書の seikyuJi は 使わない
     ②帯を 出す 時に 印刷よけの style を 1回 足す（各 頁の CSS に 書かずに 済む・printOne の 印刷の 保険で 帯が 載らない）
   公開：window.PdfOkuru（Node では module.exports）
   ========================================================================== */
(function (root) {
  'use strict';

  // ★指で 触る Apple の 端末★（iPhone・iPod・iPad。iPadOS の Safari は Mac の 名乗り＋触れる 点）
  function appleTouch(nav) {
    nav = nav || {};
    const ua = String(nav.userAgent || '');
    if (/iPhone|iPad|iPod/.test(ua)) return true;
    return nav.platform === 'MacIntel' && Number(nav.maxTouchPoints) > 1;
  }

  // ★共有が 使える Apple の 端末か★（その 場で 分かる 分だけ＝share と canShare が 在る）
  //   呼ぶ 側が「押した 手の 中で 保存する」道を 守る 為（共有が 無い iPhone で okuru の 約束を 待つと 保存が 手の 外に 出る）
  function tsukaeru(nav) {
    return !!(
      nav &&
      appleTouch(nav) &&
      typeof nav.share === 'function' &&
      typeof nav.canShare === 'function'
    );
  }

  // ★共有に 添える 字★ 紙の 名前（"給料明細_2026-10_山田" ⇒ "給料明細 2026-10 山田"）
  function namaeJi(namae) {
    return String(namae || '')
      .replace(/.pdf$/i, '')
      .replace(/_/g, ' ')
      .trim();
  }

  // ★帯は 印刷に 載せない★（請求書は 頁の @media print に 書いた・こちらは 頁が 3つ＝js で 1回だけ 足す）
  function insatsuYoke(doc) {
    if (!doc.getElementById || doc.getElementById('pdfOkuruInsatsu')) return;
    const st = doc.createElement('style');
    st.id = 'pdfOkuruInsatsu';
    st.textContent = '@media print{#pdfOkuruObi{display:none !important}}';
    (doc.head || doc.body).appendChild(st);
  }

  function fileOf(env, bytes, filename) {
    try {
      const B = env.Blob,
        F = env.File;
      if (typeof F !== 'function') return null;
      const data = typeof B === 'function' ? new B([bytes], { type: 'application/pdf' }) : bytes;
      return new F([data], filename, { type: 'application/pdf' });
    } catch {
      return null;
    }
  }

  // ★帯を 消す★ 画面を 移った・次の 紙を 作る 時（古い 紙を 送らない・対立役 注3）
  //   ★消した 回数（KAI）を 数える★（Daikou-app の 足し・見本 okuruKawatta の 代わり 2026-11-06 設計前 対立役 止3）
  //   押した 時に kesu() の 返す 数を 控え（opt.kai）、共有の 前と 断られた 後に 比べる＝
  //   間に 月・紙・人を 選び直した／窓を 開いた（＝その 所で kesu を 呼ぶ）なら 送らない・帯も 出さない
  let KAI = 0;
  function hazusu(doc) {
    const old = doc && doc.getElementById && doc.getElementById('pdfOkuruObi');
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }
  function kesu(env) {
    env = env || root || {};
    hazusu(env.document);
    KAI += 1;
    return KAI;
  }
  function kai() {
    return KAI;
  }
  function kawatta(opt) {
    return !!(opt && opt.kai != null && opt.kai !== KAI);
  }

  // ★知らせの 字★（how ごと・見本 exportInvoicePDF の toast と 同じ 字）。null＝呼ぶ 側の 今の 字
  //   chui＝出せない 字（〓）の 知らせ（共有した 時も 落とさない・設計前 対立役 注3）
  function bun(how, chui) {
    if (how === 'share') return chui ? 'PDFを渡しました（' + chui + '）' : 'PDFを渡しました';
    if (how === 'cancel') return '送るのを やめました';
    if (how === 'need-tap')
      return 'PDF が できました。下の 帯の「送る・印刷する」を 押してください';
    if (how === 'kawatta')
      return '紙を 選び直したので 送るのを 止めました（もう一度 押してください）';
    return null;
  }

  // ★帯の ボタンの 見た目は 帯が 持つ★（uriage に .btn が 無い・shukei/kyuryo の .btn は 全部 青＝設計前 対立役 注2）
  const BOTAN_KATA =
    'font:inherit;font-size:15px;min-height:40px;padding:8px 14px;border-radius:10px;cursor:pointer;';
  const OMO_KATA =
    BOTAN_KATA + 'background:#1d4ed8;color:#fff;border:1px solid #1d4ed8;font-weight:700;';
  const SOE_KATA = BOTAN_KATA + 'background:#fff;color:#222;border:1px solid #c9d6cf;';

  // ★帯★（共有は 押した その 時にしか 開けない）＝どの 紙か 名前を 出す
  //   opt.chui＝出せない 字（〓）の 知らせ（toast は 帯の 下に 隠れる＝帯の 字に 入れる・注2）
  //   opt.hiraku＝今の 道（PDF を 開く）。帯でも 断られたら 出す（行き止まりに しない・注1）
  function obi(env, go, filename, opt) {
    const doc = env.document;
    if (!doc || !doc.body) return;
    hazusu(doc); // ★帯の 出し直しは 数えない★（数えると 自分で「変わった」に なる）
    insatsuYoke(doc);
    const bar = doc.createElement('div');
    bar.id = 'pdfOkuruObi';
    bar.setAttribute('role', 'dialog');
    // ★下の ナビの 上★（iPhone の ホームの 棒に 被らない・今の 帯と 同じ 置き方・注6）
    bar.style.cssText =
      'position:fixed;left:12px;right:12px;bottom:calc(var(--nav-h, 56px) + env(safe-area-inset-bottom) + 8px);' +
      'z-index:100000;background:#fff;border:1px solid #c9d6cf;border-radius:14px;padding:12px;' +
      'box-shadow:0 6px 24px rgba(0,0,0,.18);display:flex;gap:8px;align-items:center;flex-wrap:wrap;';
    const msg = doc.createElement('div');
    msg.id = 'pdfOkuruMsg';
    msg.style.cssText = 'flex:1 1 160px;font-size:14px;';
    const chui = opt && opt.chui ? '　' + opt.chui : '';
    msg.textContent = 'PDF が できました（' + filename + '）' + chui;
    const b = doc.createElement('button');
    b.type = 'button';
    b.id = 'pdfOkuruGo';
    b.style.cssText = OMO_KATA;
    b.textContent = '送る・印刷する';
    const x = doc.createElement('button');
    x.type = 'button';
    x.id = 'pdfOkuruTojiru';
    x.style.cssText = SOE_KATA;
    x.textContent = '閉じる';
    function close() {
      if (bar.parentNode) bar.parentNode.removeChild(bar);
    }
    let hirakuAru = false;
    function hirakuDasu() {
      if (hirakuAru || !(opt && typeof opt.hiraku === 'function')) return;
      hirakuAru = true;
      const h = doc.createElement('button');
      h.type = 'button';
      h.id = 'pdfOkuruHiraku';
      h.style.cssText = SOE_KATA;
      h.textContent = 'PDF を 開く';
      h.onclick = function () {
        close();
        opt.hiraku();
      };
      bar.insertBefore ? bar.insertBefore(h, x) : bar.appendChild(h);
    }
    b.onclick = function () {
      let p;
      try {
        p = go();
      } catch (e) {
        p = Promise.reject(e);
      }
      return Promise.resolve(p).then(close, function (e) {
        if (e && e.name === 'AbortError') return close();
        msg.textContent =
          '送れませんでした（' +
          ((e && e.name) || '不明') +
          '）。「PDF を 開く」から 開いて、その 画面の 共有で 送るか 印刷してください。';
        hirakuDasu();
      });
    };
    x.onclick = close;
    bar.appendChild(msg);
    bar.appendChild(b);
    bar.appendChild(x);
    doc.body.appendChild(bar);
    // ★帯の 高さを 画面へ 渡す★（知らせ toast を 帯の 上へ 逃がす 為・呼ぶ 側の CSS が 使う）
    try {
      if (doc.documentElement && doc.documentElement.style && bar.offsetHeight)
        doc.documentElement.style.setProperty('--pdf-obi-h', bar.offsetHeight + 'px');
    } catch {
      /* 測れない 端末＝CSS の 既定（72px） */
    }
  }

  // ★送る★ → Promise<{how:'share'|'cancel'|'need-tap'|'none'}>
  //   'none' の 時だけ 呼ぶ 側が 今までの 道（PC は 窓・スマホは 保存）
  //   opt＝{ chui: 出せない 字の 知らせ, hiraku: 今の 道（帯で 断られた 時の 逃げ道） }
  function okuru(bytes, filename, text, env, opt) {
    env = env || root || {};
    const nav = env.navigator;
    if (!nav || !appleTouch(nav)) return Promise.resolve({ how: 'none' });
    // ★share も canShare も 要る★（無い 端末＝今の 道・紙と 中身を 揃えた 任4）
    if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function')
      return Promise.resolve({ how: 'none' });
    const file = fileOf(env, bytes, filename);
    if (!file) return Promise.resolve({ how: 'none' });
    const data = { files: [file], text: String(text || '') }; // ★files と text だけ（url・title は 付けない）★
    try {
      if (!nav.canShare(data)) return Promise.resolve({ how: 'none' });
    } catch {
      return Promise.resolve({ how: 'none' });
    }
    // ★押した 後に 紙が 変わった＝送らない★（共有の 前）
    if (kawatta(opt)) return Promise.resolve({ how: 'kawatta' });
    function go() {
      return nav.share({ files: [file], text: data.text });
    }
    let p;
    try {
      p = go();
    } catch (e) {
      p = Promise.reject(e);
    }
    return Promise.resolve(p).then(
      function () {
        return { how: 'share' };
      },
      function (e) {
        const nm = e && e.name;
        if (nm === 'AbortError') return { how: 'cancel' };
        if (nm === 'NotAllowedError') {
          if (kawatta(opt)) return { how: 'kawatta' }; // ★断られる 間に 選び直した＝帯を 出さない★
          obi(env, go, filename, opt);
          return { how: 'need-tap' };
        }
        return { how: 'none' };
      }
    );
  }

  const api = {
    appleTouch: appleTouch,
    tsukaeru: tsukaeru,
    namaeJi: namaeJi,
    okuru: okuru,
    kesu: kesu,
    kai: kai,
    bun: bun,
  };
  if (root) root.PdfOkuru = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
