  // ★★札（24時間 パスワード 無しで 見る）★★ 2026-10-21 司さん
  //   「パスワードなしで入れる時間を設けてそれこしたら再度パスワード入れ直しは分かるけど
  //     決めるところからはじまるのはイライラする」
  //   決め（司さん）＝24時間・会社の 倉庫が 札を 出す（携帯には 期限つきの 札だけ・4桁は 置かない）
  //   ・パスワードが 合ったら 倉庫の dk_kyuryo_fuda が 札（48桁）と 期限を 返す → この 端末に 置く
  //   ・開いた 時に 期限内の 札が 在れば 入れる 画面を 出さない（dk_kyuryo_get に 'fuda:'＋札 で 取る）
  //   ・札を 消すのは 倉庫が fuda_kire を 返した 時だけ（電波が 弱い だけで 毎回 訊かない・対立役 N3）
  //   ・作り直すと 倉庫の 札は 消える（apply-kyuryo-haifu.sql の device_tokens = '{}'）
  //   ★名前と 字は 関数の 中に 置く★（honninStart は この 行より 先に 走る＝var は まだ undefined）
  function hnFudaKey() {
    return 'dkKyuFuda:' + HONNIN.token;
  }
  function hnFudaYomu() {
    try {
      var v = JSON.parse(localStorage.getItem(hnFudaKey()) || 'null');
      if (v && /^[0-9a-f]{48}$/.test(String(v.fuda)) && Number(v.kigen) > Date.now()) return v;
      if (v) hnFudaKesu();
    } catch (_) {
      /* 読めない 端末＝札 無し */
    }
    return null;
  }
  function hnFudaOku(r) {
    if (!r || !/^[0-9a-f]{48}$/.test(String(r.fuda)) || !(Number(r.kigen) > Date.now())) return;
    try {
      localStorage.setItem(
        hnFudaKey(),
        JSON.stringify({ fuda: String(r.fuda), kigen: Number(r.kigen) })
      );
    } catch (_) {
      /* 置けない 端末（非公開の タブ 等）＝次も パスワード */
    }
  }
  function hnFudaKesu() {
    try {
      localStorage.removeItem(hnFudaKey());
    } catch (_) {
      /* 消せない 端末 */
    }
  }
  // ★期限の 切れた 札（作り直された 古い リンクの 分も）を 掃く★（対立役 軽6）
  function hnFudaSouji() {
    try {
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var k = localStorage.key(i);
        if (!k || k.indexOf('dkKyuFuda:') !== 0) continue;
        var v = null;
        try {
          v = JSON.parse(localStorage.getItem(k) || 'null');
        } catch (_) {
          v = null;
        }
        if (!v || !(Number(v.kigen) > Date.now())) localStorage.removeItem(k);
      }
    } catch (_) {
      /* 読めない 端末 */
    }
  }
  // ★パスワードを 照らして 札を もらう★（倉庫に 札の 関数が まだ 無い 時は 今の verify に 落とす）
  //   落とすのは PGRST202（関数が 無い）の 時だけ＝他の 失敗で 2回 照らすと 間違いを 2回 数える（対立役 N3）
  function hnIreru(pw) {
    return honninRpc('dk_kyuryo_fuda', { p_token: HONNIN.token, p_pw: pw }).then(function (r) {
      if (r && r.code === 'PGRST202')
        return honninRpc('dk_kyuryo_verify', { p_token: HONNIN.token, p_pw: pw });
      if (r && r.ok === true) hnFudaOku(r);
      return r;
    });
  }
  function honninStart() {
    // ★出してよい 物★ … 画面の 頭／小見出し／明細の 置き場 だけ
    var DASU_WRAP = { topBar: 1, sub: 1, paneSlip: 1 };
    var DASU_SLIP = { slips: 1, hnBar: 1 }; // hnBar＝月・期間・印刷 / 送る（2026-10-29）
    var wrap = document.querySelector('.wrap');
    if (wrap)
      Array.prototype.forEach.call(wrap.children, function (el) {
        if (!DASU_WRAP[el.id]) el.style.display = 'none';
      });
    var ps = document.getElementById('paneSlip');
    if (ps) {
      ps.style.display = '';
      Array.prototype.forEach.call(ps.children, function (el) {
        el.style.display = DASU_SLIP[el.id] ? '' : 'none';
      });
    }
    // 頭の 中の 事務所行き（ログアウト等）も 出さない
    var jl = document.getElementById('jimushoLinks');
    if (jl) jl.style.display = 'none';
    var lo = document.getElementById('btnLogout');
    if (lo) lo.style.display = 'none';
    var sb = document.getElementById('sub');
    if (sb) sb.textContent = '自分の 給料明細';

    // ★入口の 箱（パスワード）の 間は 上の 並び（月・期間・印刷 / 送る）を 隠す★ 2026-10-30（本番前の 対立役 止2：
    //   札が 切れた 後の パスワードの 画面で 月を 替えると p_pw 無しで 倉庫を 呼び「作り直されました」と 嘘が 出た）
    //   ＝読み終わり（honninTsuki）で hnBarKaku が 出し直す
    var hnBarK = document.getElementById('hnBar');
    if (hnBarK) {
      hnBarK.hidden = true;
      hnBarK.innerHTML = '';
    }
    // ★入口の 箱（パスワード）★
    var box = document.getElementById('slips');
    if (!box) return;
    // ★★期限内の 札が 在れば パスワードを 訊かずに 明細へ★★ 2026-10-21（A の 探りより 先）
    if (!HONNIN.pw && !HONNIN.fuda) {
      hnFudaSouji();
      var fd = hnFudaYomu();
      if (fd) {
        HONNIN.fuda = fd.fuda;
        HONNIN.init = '';
        return honninMiru();
      }
    }
    // ★★もう 決めた 人を「はじめて」に しない★★ 2026-10-21 司さん「パスワードを決めてからホーム画面に保存…
    //   またパスワードを決めるがでる…決めるところからはじまるのはイライラする」
    //   ホーム画面は 配った リンク（c= 付き）の まま 開く＝c= だけで 見ると 毎回「はじめて」。
    //   ★開く 前に 倉庫に 訊く★：パスワードを 空（null）で 送ると、決めた 人には 形を 見る 前に already_set、
    //   まだの 人には pw_4keta を 返す（どちらも 倉庫に 何も 書かない＝apply-kyuryo-honnin-kansuu.sql の 43〜54行）。
    if (HONNIN.init && !HONNIN.sagutta) {
      HONNIN.sagutta = true;
      box.innerHTML = '<div class="card"><div class="msg">読み込み中…</div></div>';
      // ★返って 来ない 時は 5秒で 打ち切って 今までの「はじめて」の 画面★（電波が 弱い 時に 欄が 出ないまま に しない・対立役）
      var kaetta = false;
      var uchikiri = setTimeout(function () {
        if (kaetta) return;
        kaetta = true;
        honninStart();
      }, 5000);
      honninRpc('dk_kyuryo_pw_set', {
        p_token: HONNIN.token,
        p_init: HONNIN.init,
        p_pw: null, // ★鍵ごと 省かない★（省くと 引数 2つの 関数を 探して 落ちる）
      }).then(function (r) {
        if (kaetta) return; // 打ち切った 後に 来た 答えでは 描き直さない
        kaetta = true;
        clearTimeout(uchikiri);
        if (r && r.reason === 'no_token') return honninTomeru(HONNIN_TSUKURINAOSHI_BUN);
        if (r && r.reason === 'already_set') HONNIN.init = '';
        // それ以外（pw_4keta・bad_init・つながらない・ok）は 今までの「はじめて」の 画面
        honninStart();
      });
      return;
    }
    var hajimete = !!HONNIN.init;
    box.innerHTML =
      '<div class="card"><div class="title" style="font-weight:800;margin-bottom:6px">' +
      (hajimete ? 'はじめての 方' : '自分の 給料明細を 見る') +
      '</div><div class="note" style="margin:0 0 10px">' +
      (hajimete
        ? '自分の パスワード（数字 4桁）を 決めてください。銀行などの 暗証番号と 同じに しないでください。<br />次からは この パスワードだけで 見られます。'
        : 'パスワードを 入れてください。<br />忘れた／漏れた ときは 会社に「作り直し」を 頼んでください。') +
      '</div>' +
      '<input id="hnPw" type="password" autocomplete="' +
      (hajimete ? 'new-password' : 'current-password') +
      // ★はじめては 数字 4桁★ 2026-10-20（2回目は 絞らない＝古い 8文字の 人も 打てる・対立役 N2）
      (hajimete ? '" inputmode="numeric" maxlength="4' : '') +
      '" placeholder="' +
      (hajimete ? 'パスワード（数字 4桁）' : 'パスワード') +
      '" style="width:100%;font-size:16px;padding:10px;border:1px solid var(--line);border-radius:10px" />' +
      (hajimete
        ? '<input id="hnPw2" type="password" autocomplete="new-password" inputmode="numeric" maxlength="4" placeholder="パスワード（確認）" style="width:100%;font-size:16px;padding:10px;border:1px solid var(--line);border-radius:10px;margin-top:8px" />'
        : '') +
      '<div class="err" id="hnErr" style="display:none"></div>' +
      '<button class="btn" id="hnGo" style="margin-top:10px">' +
      (hajimete ? 'パスワードを 決める' : '見る') +
      '</button></div>';

    var err = function (t) {
      var e = document.getElementById('hnErr');
      if (!e) return;
      e.style.display = t ? '' : 'none';
      e.textContent = t || '';
    };
    // ★全角の 数字は 半角に 直してから 送る★（決める・入れる 両方で 同じ＝合っているのに 違う、に しない）
    var hankaku = function (v) {
      return String(v || '')
        .trim()
        .replace(/[０-９]/g, function (c) {
          return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
        });
    };
    document.getElementById('hnGo').onclick = function () {
      var pw = hankaku(document.getElementById('hnPw').value);
      if (hajimete) {
        var pw2 = hankaku(document.getElementById('hnPw2').value);
        // ★数字 4桁★ 2026-10-20 司さん「パスワードは 4桁に しろ」
        if (!/^[0-9]{4}$/.test(pw)) return err('パスワードは 数字 4桁に してください。');
        if (pw !== pw2) return err('2つの パスワードが 違います。');
        err('');
        return honninRpc('dk_kyuryo_pw_set', {
          p_token: HONNIN.token,
          p_init: HONNIN.init,
          p_pw: pw,
        }).then(function (r) {
          if (!r || r.ok !== true) {
            // ★もう 決めた 人は 2回目の 画面へ 回す★ 2026-10-20（前は「もう一度 開いて」で 同じ リンクを 回り続けた・対立役 k1）
            if (r && r.reason === 'already_set') {
              HONNIN.init = '';
              honninStart();
              return honninErr('もう パスワードを 決めてあります。パスワードを 入れてください。');
            }
            if (r && r.reason === 'no_token') return honninTomeru(HONNIN_TSUKURINAOSHI_BUN);
            return err(
              r && r.reason === 'bad_init'
                ? 'このリンクが 古いようです。会社に 作り直しを 頼んでください。'
                : r && r.reason === 'pw_4keta'
                  ? 'パスワードは 数字 4桁に してください。'
                  : 'できませんでした。もう一度 お試しください。'
            );
          }
          HONNIN.pw = pw;
          // 決めた 時も 札を もらう（もらえなくても 明細は 出す＝次に 開いた 時に パスワードを 訊くだけ）
          return hnIreru(pw).then(function () {
            honninMiru();
          });
        });
      }
      if (!pw) return err('パスワードを 入れてください。');
      err('');
      return hnIreru(pw).then(function (r) {
        // ★3回 続けて 間違えたら 止める★ 2026-10-20（止まった・作り直された 時は 打ち続けさせない）
        if (r && r.reason === 'tomatta') return honninTomeru(HONNIN_TOMATTA_BUN);
        if (r && r.reason === 'no_token') return honninTomeru(HONNIN_TSUKURINAOSHI_BUN);
        if (!r || r.ok !== true)
          return err(
            r && r.reason === 'bad_pw' && r.nokori > 0
              ? 'パスワードが 違います（あと ' + r.nokori + '回 間違えると 止まります）。'
              : 'パスワードが 違います。'
          );
        HONNIN.pw = pw;
        HONNIN.name = r.name || '';
        honninMiru();
      });
    };
  }

