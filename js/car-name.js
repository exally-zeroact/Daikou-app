// ============================================================
// js/car-name.js
// ★画面に出す車の名前を1箇所で決める★ 2026-08-04
//
//   ★司さん「売上1の横の英語のやつ邪魔でしょうがない」★
//     給料明細に  売上1(7e1919ef-4aaa-411e-8db0-ba0424…)  と出ていた。
//     dk_device_labels が0件なので、端末ID(UUID)がそのまま画面に出ていた。
//
//   ★決まり★
//     1. 名前が付いていれば ★その名前★（司さんの呼び方＝4987 / 1466 / 1173）
//     2. 付いていなければ ★「車1」「車2」…★（短い仮名）
//     3. ★UUIDは画面に出さない★
//
//   仮名の番号は「端末IDの並び順」で決める。
//   ★同じ会社の中では毎回同じ番号になる★（画面を開くたびに車1と車2が入れ替わらない）。
//
//   ▼距離・料金・集計の数字には一切触らない。★見せ方だけ★。
// ============================================================
(function (global) {
  'use strict';

  // UUIDの形（8-4-4-4-12）。画面に出ていたら赤にするために使う。
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  function _str(v) {
    return typeof v === 'string' ? v : '';
  }
  function _arr(v) {
    return Array.isArray(v) ? v : [];
  }

  // dk_device_labels の行から「端末ID → 名前」を作る
  function labelMap(labels) {
    const m = {};
    _arr(labels).forEach(function (l) {
      if (!l) return;
      const id = _str(l.device_id);
      const name = _str(l.label || l.name).trim();
      if (id && name) m[id] = name;
    });
    return m;
  }

  // ★画面に出す名前を作る★
  //   deviceIds … その会社の端末ID全部（仮名の番号を決めるのに要る）
  //   labels    … dk_device_labels の行
  //   返り値: 端末ID → 出す名前
  function nameMap(deviceIds, labels) {
    const named = labelMap(labels);
    const ids = _arr(deviceIds)
      .map(_str)
      .filter(Boolean)
      .filter(function (v, i, a) {
        return a.indexOf(v) === i;
      })
      .sort(); // ★並べてから番号を振る＝毎回同じ番号になる★

    const out = {};
    let n = 0;
    ids.forEach(function (id) {
      if (named[id]) {
        out[id] = named[id];
      } else {
        n += 1;
        out[id] = '車' + n; // ★UUIDは出さない★
      }
    });
    return out;
  }

  // 1件だけ欲しい時
  function nameOf(deviceId, deviceIds, labels) {
    const m = nameMap(deviceIds, labels);
    const id = _str(deviceId);
    return m[id] || '車';
  }

  // ★画面に出す文字にUUIDが混ざっていないか★（テストと自己点検で使う）
  function hasUuid(text) {
    return UUID_RE.test(String(text == null ? '' : text));
  }

  const api = {
    UUID_RE: UUID_RE,
    labelMap: labelMap,
    nameMap: nameMap,
    nameOf: nameOf,
    hasUuid: hasUuid,
  };

  if (global) global.CarName = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
