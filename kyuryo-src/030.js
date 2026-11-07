  // ============================================================
  // ★★本人モード（従業員が 自分の 給料明細だけ 見る）★★ 2026-09-03
  //
  //   ★司さんの言葉★
  //     「Rakunallyみたいに 従業員ごとに QRコードや URLを 配って
  //       個人が 勝手に 確認できるようにも しろやぼけ」
  //
  //   ★なぜ 同じ画面に 足すか（別画面を 作らない）★
  //     明細の 組み立ては ★この画面の 中★に 在ります（司さんが 何度も 直させた 並び）。
  //     別画面に 書き写すと ★2か所に なって 片方だけ 直る★＝うちで 何度も 起きた 事故。
  //     ⇒ ★同じ画面の 入口だけ 分ける★＝出る 明細は ★事務所と 1文字も 同じ★。
  //
  //   ★入口★ kyuryo.html?t=<token>（&c=<初回コード> は QR に 埋めてある）
  //   ★守り★
  //     ・材料は ★倉庫の 関数（dk_kyuryo_get）だけ★から 取る＝★自分の分だけ★
  //     ・事務所の 読み込み（loadCompany / loadMasters）は ★1度も 呼ばない★
  //     ・タブ・印刷（全員）・会社に残る分・設定は ★出さない★
  //   ★事務所側の 流れは 1文字も 変えていません★（下の else が 元のまま）
  // ============================================================
  var HONNIN = (function () {
    try {
      var q = new URLSearchParams(location.search);
      var t = (q.get('t') || '').trim();
      if (!t) return null;
      return { token: t, init: (q.get('c') || '').trim(), pw: null, name: '' };
    } catch (_) {
      return null;
    }
  })();

  // ---------- 起動 ----------
  // ★月の 読みの 番号★（古い 月の 返事が 後から 来ても 捨てる・対立役 止3）＝本人の 画面は すぐ 下で 始まる＝その 前に 決める（後で 決めると 始めた 読みの 番号が 消える）
  var HN_YOMI_NO = 0;
  // 範囲：'tsuki'＝その 月の 期間 全部／数＝期間の 番号（PIDX と 同じ）。全体で 1つの 変数（描き直しで 戻さない）
  var HN_HANI = 0;
  // ★もう 配った リンク（印 openExternalBrowser=1 が 無い）も LINE の 中で 開かない★ 2026-11-01
  //   新しい リンクは haifuUrl が 印を 付ける。前に 配った リンクは 印が 無い＝LINE の 中の ブラウザで 開き、
  //   PDF の 保存（blob の a download）が 効かない 端末が 在る。LINE の 中（UA に Line/）で 印が 無ければ
  //   印を 足して 開き直す（LINE が 外の ブラウザへ 渡す＝実機では 未測定・見立て）。
  //   ★渡す 間は 倉庫も ログインも 呼ばない★（else の goLogin へ 落ちると login.html に 飛ぶ・設計前 対立役 止1）
  //   ★LINE が 頁を 替えない 時の 逃げ道★「ここで 見る」で その 場で honninStart（空の 画面に しない・止2）
  //   ★2回目は 渡さない★（印が どこかで 落ちても 回り続けない・注B2）。URL は URL の 型で 組む（#・c・henshu を 残す・注B1）
  function hnGaibuWatasu() {
    try {
      if (!/\bLine\//.test(String(navigator.userAgent || ''))) return false;
      var u = new URL(location.href);
      if (u.searchParams.get('openExternalBrowser') === '1') return false;
      try {
        if (sessionStorage.getItem('dkHnGaibu') === '1') return false;
        sessionStorage.setItem('dkHnGaibu', '1');
      } catch (_) {
        // 札が 置けない 端末は 印だけで 止める
      }
      u.searchParams.set('openExternalBrowser', '1');
      if (window.PdfOkuru) PdfOkuru.kesu(); // ★窓の 上に 帯を 残さない★
      var box = document.createElement('div');
      box.id = 'hnGaibu';
      box.style.cssText =
        'position:fixed;inset:0;z-index:9999;background:#fff;padding:24px 16px;text-align:center;font-size:15px;line-height:1.7';
      box.textContent =
        'Safari／Chrome で 開いています。開かない 時は 下を 押すと ここで 見られます（ここでは PDF の 保存が できない 端末が あります）';
      var b = document.createElement('button');
      b.id = 'hnGaibuKoko';
      b.type = 'button';
      b.textContent = 'ここで 見る';
      b.style.cssText = 'display:block;margin:16px auto 0;padding:10px 24px;font-size:15px';
      b.addEventListener('click', function () {
        if (box.parentNode) box.parentNode.removeChild(box);
        honninStart();
      });
      box.appendChild(b);
      document.body.appendChild(box);
      location.replace(u.href);
      return true;
    } catch (_) {
      return false;
    }
  }
  if (HONNIN) {
    if (!hnGaibuWatasu()) honninStart();
  } else {
    DKSession.ensure().then(function (s) {
      if (!s) return DKSession.goLogin();
      SESS = s;
      loadCompany();
    });
  }

  // ============================================================
  // ★本人モードの 中身★ 2026-09-03
  //   ①パスワードを 決める／入れる（倉庫の 関数が 照合）
  //   ②材料を 倉庫の 関数から 取る（★自分の分だけ★）
  //   ③明細は ★事務所と 同じ 組み立て★（renderSlips）で 出す
  // ============================================================
  function honninRpc(fn, args) {
    // ★ログインしていない 人でも 呼べる★（token＋パスワードが 守り）
    return DKSession.rest(null, 'rpc/' + fn, {
      method: 'POST',
      body: JSON.stringify(args),
    })
      .then(function (r) {
        return r.json();
      })
      .catch(function () {
        return { ok: false, reason: 'tsunagaranai' };
      });
  }

