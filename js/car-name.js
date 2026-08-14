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

  // ★並び (2026-08-05・司さん「並べ変えや名前を決めれるようにしたら楽」)★
  //   dk_device_labels.sort_order。決めていない車は★後ろ★に回す。
  //   ★1つも決めていなければ今までどおり（端末IDの順）＝今の見え方は変わらない★
  function orderMap(labels) {
    const m = {};
    _arr(labels).forEach(function (l) {
      if (!l) return;
      const id = _str(l.device_id);
      const v = l.sort_order;
      const n = typeof v === 'number' ? v : parseFloat(v);
      if (id && isFinite(n)) m[id] = n;
    });
    return m;
  }

  // ★上下に動かして並べ替える (2026-08-09・司さん「ここで名前の変更と並べかえで
  //   上にある順から売上とかも一緒の並びになるように」)★
  //   ・動いたら ★全部に連番を振り直す★（虫食いを残さない＝次に動かした時にズレない）
  //   ・端は動かない（一番上で▲、一番下で▼は 何も起きない）
  //   ・返す rows を そのまま dk_device_labels に保存すれば、
  //     売上・給料・請求書 全部が この順になる（sortIds が同じ物を見ているため）
  function reorder(ids, index, dir) {
    const list = _arr(ids).map(_str).filter(Boolean);
    const i = typeof index === 'number' ? index : -1;
    const d = dir === 1 ? 1 : dir === -1 ? -1 : 0;
    const j = i + d;
    if (!d || i < 0 || i >= list.length || j < 0 || j >= list.length) {
      return { order: list, rows: [], changed: false };
    }
    const out = list.slice();
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
    return {
      order: out,
      rows: out.map(function (id, k) {
        return { device_id: id, sort_order: k + 1 };
      }),
      changed: true,
    };
  }
  // 並べる（決めた順 → 決めていない物は端末IDの順で後ろ）
  function sortIds(ids, labels) {
    const ord = orderMap(labels);
    return _arr(ids)
      .map(_str)
      .filter(Boolean)
      .filter(function (v, i, a) {
        return a.indexOf(v) === i;
      })
      .sort(function (a, b) {
        const oa = ord[a] === undefined ? Infinity : ord[a];
        const ob = ord[b] === undefined ? Infinity : ord[b];
        if (oa !== ob) return oa - ob;
        return a < b ? -1 : a > b ? 1 : 0; // ★同じなら端末IDの順＝毎回同じ★
      });
  }

  // ★画面に出す名前を作る★
  //   deviceIds … その会社の端末ID全部（仮名の番号を決めるのに要る）
  //   labels    … dk_device_labels の行
  //   返り値: 端末ID → 出す名前
  function nameMap(deviceIds, labels) {
    const named = labelMap(labels);
    // ★並べてから番号を振る＝毎回同じ番号になる★
    //   並びを決めていれば その順。決めていなければ端末IDの順（今までどおり）。
    const ids = sortIds(deviceIds, labels);

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
    orderMap: orderMap,
    sortIds: sortIds,
    reorder,
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
