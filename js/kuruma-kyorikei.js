// ============================================================
// js/kuruma-kyorikei.js
// ★★車の 距離計が 読めるかを 1分で 見る★★ 2026-08-30
//
//   ★なぜ 要るか★
//     点が 10秒より 長く 来ない間、距離は ★位置の 直線★で 埋めています（2026-08-30 に 直した）。
//     ★車が 自分で 積んでいる 距離（距離計）が 読めるなら、それが 一番 確かです★
//     （コードが 自分で こう 書いています: 「ECU自身が 車速パルスを 積算した距離
//       ＝メーター機(随伴車)と 同じ物＝★真距離の 参照★」js/obd-client.js 65-67行）。
//     ★でも 車種で 読めたり 読めなかったり します★（手元の走行データは 1,087点 全部 −1＝未対応）。
//     ⇒★司さんの 車で 読めるかを、車に 繋いで 1分で 見る★のが この部品です。
//
//   ★新しく 作っていません★（うちの決まり: 作る前に 探す）
//     ・調べる 仕組みは ★既に 在ります★＝js/obd-client.js の `_probe()`
//       （接続時に 1回だけ 自動で 走る・★read-only・車に影響ゼロ★）
//     ・結果は ★window.OBD_PROBE_RESULT★ に 入っています
//     ⇒★この部品は「その結果を 読んで 3つに まとめる」だけ★です。★車には 何も 送りません★
//
//   ★出す物は 3つだけ★
//     ①車の 距離計（01A6・0.1km刻み）… 読めたか／読めたら 値
//     ②ECUの 走行距離（0131・1km刻み）… 同じ
//     ③読めなかった時の ★理由と 次に する事★
//
//   ★決まりを 守っています★
//     ・★alert は 使いません★（画面が 固まるので うちでは 禁止）
//     ・★色だけで 判らせません★（字でも 書きます）
//     ・★出来ていない物の ボタンは 出しません★
//     ・★距離にも 料金にも 1文字も 触りません★（読むだけ）
// ============================================================
(function (global) {
  'use strict';

  // ★読めなかった時の 理由★（★次に 何を すれば よいかまで 書く★）
  const RIYUU = {
    mi_setsuzoku: {
      midashi: 'OBDに つながっていません',
      tsugi: '青い OBD の印を 押して つないでから、もう一度 見てください',
    },
    mi_probe: {
      midashi: 'まだ 調べていません',
      tsugi: 'OBDに つないだ 直後に 自動で 調べます。10秒ほど 待ってから 見てください',
    },
    mi_taiou: {
      midashi: 'この車は 対応していません',
      tsugi: 'この車では 距離計を 読めません。別の車で 試してください',
    },
  };

  function _probeKekka() {
    try {
      return global && global.OBD_PROBE_RESULT ? global.OBD_PROBE_RESULT : null;
    } catch (_) {
      return null;
    }
  }

  function _tsunagatteruka() {
    try {
      const c = global && global.OBDClient;
      if (!c) return false;
      if (typeof c.isConnected === 'function') return !!c.isConnected();
      if (typeof c.getSpeed === 'function') {
        const s = c.getSpeed();
        return !!(s && s.mps >= 0);
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  // ★1つぶんの 見出し（読めた／読めない）を 作る★
  function _hitotsu(namae, tanni, yometa, atai) {
    return {
      namae: namae, // 何の 距離か
      tanni: tanni, // 刻み（0.1km など）
      yometa: yometa === true, // ★色だけで 判らせない為に 字も 持たせる★
      moji: yometa === true ? '読めました' : '読めません',
      atai: yometa === true && typeof atai === 'number' && atai >= 0 ? atai : null,
      ataiMoji:
        yometa === true && typeof atai === 'number' && atai >= 0 ? atai.toFixed(1) + ' km' : '—',
    };
  }

  // ★★これを 呼ぶと 3つが 返ります★★（★読むだけ・車には 何も 送りません★）
  function shirabe() {
    const p = _probeKekka();
    const tsunagatteru = _tsunagatteruka();

    if (!p) {
      const riyuu = tsunagatteru ? RIYUU.mi_probe : RIYUU.mi_setsuzoku;
      return {
        wakatta: false,
        riyuu: riyuu,
        kyorikei: _hitotsu('車の 距離計', '0.1km きざみ', false, null),
        ecu: _hitotsu('ECUの 走行距離', '1km きざみ', false, null),
      };
    }

    const d = (p && p.decoded) || {};
    const odoOk = d.odometer_supported === true;
    const distOk = d.dist_since_clear_supported === true;
    const kyorikei = _hitotsu('車の 距離計', '0.1km きざみ', odoOk, d.odometer_km);
    const ecu = _hitotsu('ECUの 走行距離', '1km きざみ', distOk, d.dist_since_clear_km);

    return {
      wakatta: true, // ★調べ終わっている★（読めた とは 別）
      dochiraka: odoOk || distOk, // ★どちらか 1つでも 読めたか★
      riyuu: odoOk || distOk ? null : RIYUU.mi_taiou,
      kyorikei: kyorikei,
      ecu: ecu,
      shirabetaToki: p.ts || null,
    };
  }

  // ★字だけで 読める形★（★色が 見えない人・白黒でも 分かる★）
  function moji() {
    const r = shirabe();
    const gyou = [];
    gyou.push('■ 車の 距離計（0.1km きざみ）… ' + r.kyorikei.moji + '　' + r.kyorikei.ataiMoji);
    gyou.push('■ ECUの 走行距離（1km きざみ）… ' + r.ecu.moji + '　' + r.ecu.ataiMoji);
    if (r.riyuu) {
      gyou.push('');
      gyou.push('▲ ' + r.riyuu.midashi);
      gyou.push('　 ' + r.riyuu.tsugi);
    }
    return gyou.join('\n');
  }

  const api = { shirabe: shirabe, moji: moji, RIYUU: RIYUU };
  if (global) global.KurumaKyorikei = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
