  // ★明細の 箱に PDF と 同じ 紙を 入れる★（本人の 画面 honninKami と 同じ 縮め方）2026-10-05
  // ★★PDF の 字体（DKKami）が 入ったら 画面の 紙を 組み直す★★ 2026-10-07（対立役 C）
  //   画面の 紙は 控えの 字体で 測って 組む。PDF（明細・給料表 どちらでも）を 押して DKKami が 入ると
  //   字の 幅・高さが 変わり 組んだ 紙が 切れ得た ⇒ js/kami-egaku.js が 字体を 足した 直後に 出す 合図で 組み直す
  window.addEventListener('dkkami-yonda', function () {
    // ★測る canvas を 作り直す★ 2026-10-08（対立役：WebKit は 使い回した canvas が 字体を 足す 前の 幅を 返した）
    _measCtx = null;
    try {
      if (!HONNIN) kamiMadoNuru();
    } catch (_) {
      /* 組み直せなくても PDF は 止めない */
    }
  });
  function kamiMadoNuru() {
    if (!window.__paper) return;
    if (_kamiRO) _kamiRO.disconnect(); // ★前に 描いた 箱は 見張らない★
    // ★組み直す 間は 箱の 高さを 保つ★ 2026-10-23（字体が 入った 時の 組み直しでも 巻いた 位置を 詰めない）
    //   renderSlips から 来た 時は もう 保って いる（入れ替える 前の 高さ）＝ここでは 測らない
    var slipsBox = $('slips');
    var jibunDeTamotsu = !!slipsBox && !slipsBox.style.minHeight;
    if (jibunDeTamotsu && slipsBox.offsetHeight)
      slipsBox.style.minHeight = slipsBox.offsetHeight + 'px';
    Array.prototype.forEach.call(document.querySelectorAll('#slips .kami-mado'), function (mado) {
      var ei = Number(mado.getAttribute('data-ei'));
      mado.innerHTML = ''; // ★組み直す 時に 2束 並べない★（対立役 10-07 B）
      // ★手当・控除が 紙に 入りきらない 人は 画面にも 知らせる★（明細の PDF は 作らない）
      if (window.__paper.maisu(ei).hamidasu) {
        var tsuchi = document.createElement('div');
        tsuchi.className = 'err';
        tsuchi.style.display = 'block';
        tsuchi.textContent =
          '手当・控除が 多すぎて 明細の 紙に 入りません（下が 切れます）。手当・控除を まとめてください。';
        mado.appendChild(tsuchi);
      }
      // ★★PDF と 同じ 紙の 束★★ 2026-10-07（対立役：日だけで 分けて 車が 多いと 下が 切れた）
      var taba = window.__paper.sheets(ei);
      var haba = mado.clientWidth || 360;
      // ★紙 1枚が 画面に 全部 入る 大きさ★（見切れさせない・司さん 10-05「見切れてめちゃくちゃ」）
      //   細かい 字は ★押すと 開く PDF★で 見る（代行請求書の 請求書ページと 同じ）
      var empId = String(window.__paper.emp(ei).employee_id);
      for (var i = 0; i < taba.length; i++) {
        var el = taba[i];
        el.style.position = 'static';
        el.style.left = 'auto';
        el.style.top = 'auto';
        el.style.transformOrigin = 'top left';
        el.style.width = kamiWH(el).w + 'px'; // 縦の 紙は 794
        var waku = document.createElement('div');
        waku.className = 'hn-kami-waku kami-oseru';
        waku.title = '押すと PDF で 開きます';
        waku.setAttribute('role', 'button');
        waku.onclick = (function (id) {
          return function () {
            printAll([id]); // ★押すと その人の PDF★（印刷と 同じ 作り方）
          };
        })(empId);
        waku.appendChild(el);
        kamiNobasu(waku, haba);
        mado.appendChild(waku);
      }
      // 縮めた 時の 幅（縮め直しは この 幅より 狭く なった 時だけ）
      mado.setAttribute('data-sc', String(haba));
      if (_kamiRO) _kamiRO.observe(mado);
    });
    // ★紙を 全部 入れた 後で 幅を 測り直す★ 2026-10-20（本人の 画面 honninKami の 止2 と 同じ 穴）
    //   PC で 人が 少ないと 紙を 入れる 前は ページが 短く 巻き棒が 無い＝入れた 後に 縦の 巻き棒が 出て 幅が 縮む
    //   （resize は 起きない）＝1人・1000×900 で 紙の 右が 14px 切れた
    Array.prototype.forEach.call(document.querySelectorAll('#slips .kami-mado'), kamiChijimeru);
    if (slipsBox) {
      if (jibunDeTamotsu) slipsBox.style.minHeight = '';
      slipsBox.setAttribute('data-haba', String(slipsBox.clientWidth));
    }
  }
  // ★紙を 入れた 後に ページが 伸びても（下の 帯・知らせ が 後から 出る）縮め直す★（対立役：1000×1340〜1400 で 15px 切れた）
  //   縮める 向きだけ（広げると 巻き棒が 消えて また 出る＝描き直しが 回り続ける）。
  //   ★縮めた 後に 巻き棒が 消える 境目の 高さ（1人・1000×1400 等）では 右に 16px の 隙間が 残る★（切れは しない・対立役）
  //   窓の 大きさを 変えると たいてい 描き直して 戻るが、境目の 高さでは 描き直しても また 同じ 隙間に なる
  function kamiChijimeru(mado) {
    var haba2 = mado.clientWidth;
    var haba1 = Number(mado.getAttribute('data-sc')) || 0;
    if (!haba2 || !haba1) return;
    if (haba2 >= haba1) return;
    mado.setAttribute('data-sc', String(haba2));
    Array.prototype.forEach.call(mado.querySelectorAll('.hn-kami-waku'), function (w) {
      kamiNobasu(w, haba2);
    });
  }
  var _kamiRO =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(function (ents) {
          // ★縮め直しは 次の 絵で★（見張りの 中で 箱の 高さを 変えると「ResizeObserver loop completed with
          //   undelivered notifications」が window の error に 出た・対立役 14/184形）
          requestAnimationFrame(function () {
            ents.forEach(function (e) {
              kamiChijimeru(e.target);
            });
          });
        })
      : null;

  // ── 従業員 ─────────────────────────────
  function roleNames() {
    var st = PayrollDaily.normSettings(SET, RAW.shimeRireki);
    return Object.keys(st.roles);
  }

