  // ★★ダイコメの 表を 読む 時は この 会社だけに 絞る★★ 2026-10-17
  //   前は 会社で 絞らず 読んでいた（設定は limit=1）＝会社を 2つ 持つ 人は 別の 会社の 歩合・人・売上が 混ざる
  //   （今は テスト・本番とも 0人＝害は 0）。dk_ の 表だけ（請求の 表 meisai 等には 足さない）
  function kaishaDake(p) {
    if (!COMPANY || !/^dk_/.test(p) || /[?&]company_id=/.test(p)) return p;
    return (
      p +
      (p.indexOf('?') < 0 ? '?' : '&') +
      'company_id=eq.' +
      encodeURIComponent(COMPANY.company_id)
    );
  }
  function soft(path) {
    return DKSession.softList(SESS, kaishaDake(path), LOAD);
  }
  var SET_YOMI = { tried: 0, failed: 0 };
  // ★期の 計算が 転んだ★（対立役 2回目 直す-2：読み終えの 印が 下りず「読み込み中です」の 断りが 終わらなかった）
  var KEISAN_NG_JI = '画面の計算で問題が出ました。画面を読み込み直してください。';
  var KEISAN_NG = false;
  // ★計算が 転んだ 間は 描かない・書かない★（対立役 4回目 直す-A・直す-B：名前で 選ぶ・日の 帯 は render を 通らずに
  //   前の 期の 明細・日の 欄を 描き、そこから 車の 時間・売上・手当を 送れた）
  function keisanNgNara() {
    if (!KEISAN_NG) return false;
    showErr(KEISAN_NG_JI);
    return true;
  }
  function afterLoad(retry) {
    DKSession.showUnknownBar(LOAD, retry);
  }
  // ★書いている 最中の 物★ 2026-10-16（「← 会社設定へ 戻る」は これが 済んでから 移る）
  var KAKI_CHU = [];
  function kakiNoseru(p) {
    KAKI_CHU.push(p);
    var owari = function () {
      var i = KAKI_CHU.indexOf(p);
      if (i >= 0) KAKI_CHU.splice(i, 1);
    };
    p.then(owari, owari);
    return p;
  }
  (function kakiWoMiru() {
    var S = window.DKSession;
    if (S && S.rest) {
      var r0 = S.rest;
      S.rest = function (s, p, o) {
        var x = r0.apply(this, arguments);
        return o && o.method && o.method !== 'GET' && x && x.then ? kakiNoseru(x) : x;
      };
    }
    var f0 = window.fetch;
    if (f0)
      window.fetch = function (u, o) {
        var x = f0.apply(this, arguments);
        // ★GET と HEAD は 数えない★（帯の 部品が 新しい 版を 見る HEAD を 書きかけに 数え、圏外で 偽の「保存できなかった」に なる・対立役 注A2）
        return o && o.method && o.method !== 'GET' && o.method !== 'HEAD' && x && x.then
          ? kakiNoseru(x)
          : x;
      };
  })();
  // 欄を 離れた 時の 保存も 拾う ため 先に 欄を 離し、書き終わって（最長 10 秒）から 移る
  // ★書けなかった 物が 1つでも 在れば 移らない★ 2026-10-16（指示役・対立役：待った 後に 移ると 赤字が 消え、
  //   事務所の 人が 直した 設定が 倉庫に 入っていないのに「保存できた」に 見えた）。10 秒で 終わらない 時も 移らない
  function kakiOwattekara(go, tomaru) {
    var a = document.activeElement;
    if (a && a.blur) a.blur();
    setTimeout(function () {
      var owari = false;
      var kimeru = function (yoi) {
        if (owari) return;
        owari = true;
        yoi ? go() : tomaru();
      };
      Promise.all(
        KAKI_CHU.slice().map(function (p) {
          return p.then(
            function (r) {
              return !(r && r.ok === false);
            },
            function () {
              return false;
            }
          );
        })
      ).then(function (kekka) {
        kimeru(kekka.every(Boolean));
      });
      setTimeout(function () {
        kimeru(false);
      }, 10000);
    }, 0);
  }
