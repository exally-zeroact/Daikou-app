  //   「明細の期間のやり方がまったく理解できない」）
  //   ★前★ 3つが 同じ 重さで 並び、どれが どれに 効くか 見えなかった
  //     （月3回なら「何日から」も「日数」も 使わないのに 出ていた）
  //   ★今★ 払い方を 選ぶ ⇒ ★その 払い方に 要る 欄だけ★ 出す ＋ 今の 区切りを 字で 出す
  // ★★画面の 欄 → 締めの 形（period_shime）★★ 2026-10-07
  //   月3回は null（昔の 列 period_end_mode='thirds' の まま＝今の 本番の 1社と 同じ 読み）
  // ★28・29・30日締めは「締めた 日の 月の 分」で 書く★（読む 側 seiki と 同じ・司さん 10-19）
  function nijuhachiShime(k) {
    //   28〜30 を 1つでも 含めば（seiki と 同じ。31・末＝0 は 末日締め＝何月分は 要らない）
    var nijuhachi = (k.hi || []).some(function (h) {
      return Number(h) >= 28 && Number(h) <= 30;
    });
    return nijuhachi ? Object.assign({}, k, { nazuke: 'shime' }) : k;
  }
  function shimeKataYomu() {
    var m = ($('pMode') || {}).value || '';
    var nz = ($('pNazuke') || {}).value || undefined;
    if (m === 'thirds') return { kata: null };
    if (m === 'tsuki2') return { kata: { kind: 'tsuki', hi: [15, 0] } };
    if (m === 'matsu') return { kata: { kind: 'tsuki', hi: [0] } };
    if (m === 'tsuki1') {
      var dTxt = String(($('pShimeHi') || {}).value || '').trim();
      // ★空は 0（末日）に しない★（対立役 ③）
      if (!dTxt) return { dame: '何日に 締めるかを 入れてください' };
      var d = Number(dTxt);
      return { kata: nijuhachiShime({ kind: 'tsuki', hi: [d], nazuke: nz }) };
    }
    if (m === 'narabe') {
      var hi = String(($('pNarabe') || {}).value || '')
        .split(/[,、，\s]+/)
        .filter(function (x) {
          return x !== '';
        })
        .map(function (x) {
          return x === '末' || x === '末日' ? 0 : Number(x);
        });
      return { kata: nijuhachiShime({ kind: 'tsuki', hi: hi, nazuke: nz }) };
    }
    if (m === 'shuu')
      return { kata: { kind: 'shuu', youbi: Number(($('pYoubi') || {}).value), nazuke: nz } };
    if (m === 'hi') return { kata: { kind: 'hi' } };
    return { dame: '払い方を 選んでください' };
  }
