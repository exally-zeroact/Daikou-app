// region-helper.js
//
// ★設計変更宣言 (2026-05-16・Step6・現在地県判定 API):
//   main thread で「現在地の県 (ローマ字 perPref 命名)」を判定するヘルパ。
//   データソース: window.ADDRESSES_COARSE_JP のみ (SW PRECACHE 済・オフライン動作可)
//
//   設計判断:
//     ・呼出側: Step7 mm-data-pipeline (cache miss 検知)・将来の他用途
//     ・既存 Meter.getNearestAddress 内にも同等の県判定ロジックあり
//       → DRY のため将来 Meter 側を本ヘルパに置換する選択肢あり (本コミットでは触らない)
//     ・本ヘルパは新規追加のみ・既存コードは無変更 (= 副作用ゼロ)
//
//   オフライン準拠:
//     ・window.ADDRESSES_COARSE_JP は sw.js PRECACHE_FILES に含まれており
//       SW install 完了時点で必ず cache 済 (= オフラインでも動作)
//     ・全 47 県 1,919 件で約 220 KB・SW PRECACHE で確実取得
//     ・代行運転士の運用 (深夜・山間部・トンネル多発) でもオフライン動作維持
//
//   絶対ルール準拠:
//     ・距離計算には関与しない (= 県判定のみ)
//     ・distance_m / fare_yen / business_distance_m に触れない
//     ・iOS/Android 共通 (window 経由・platform 分岐なし)
//
// API:
//   RegionHelper.getCurrentPref(lat, lng[, accuracy])  → ローマ字 pref 名 ('ehime' 等) or null
//   RegionHelper.isReady()                              → ADDRESSES_COARSE_JP load 済か
//
// ─────────────────────────────────────────────────────────────────────

(function (global) {
  'use strict';

  // JIS X 0401 都道府県コード (2 桁文字列) → ローマ字 pref 名 (perPref 命名規則)
  // build-address.js / data-registry.js / addresses-fine-split.js と同一表
  const _JIS_TO_PREF = {
    '01': 'hokkaido',
    '02': 'aomori',
    '03': 'iwate',
    '04': 'miyagi',
    '05': 'akita',
    '06': 'yamagata',
    '07': 'fukushima',
    '08': 'ibaraki',
    '09': 'tochigi',
    10: 'gunma',
    11: 'saitama',
    12: 'chiba',
    13: 'tokyo',
    14: 'kanagawa',
    15: 'niigata',
    16: 'toyama',
    17: 'ishikawa',
    18: 'fukui',
    19: 'yamanashi',
    20: 'nagano',
    21: 'gifu',
    22: 'shizuoka',
    23: 'aichi',
    24: 'mie',
    25: 'shiga',
    26: 'kyoto',
    27: 'osaka',
    28: 'hyogo',
    29: 'nara',
    30: 'wakayama',
    31: 'tottori',
    32: 'shimane',
    33: 'okayama',
    34: 'hiroshima',
    35: 'yamaguchi',
    36: 'tokushima',
    37: 'kagawa',
    38: 'ehime',
    39: 'kochi',
    40: 'fukuoka',
    41: 'saga',
    42: 'nagasaki',
    43: 'kumamoto',
    44: 'oita',
    45: 'miyazaki',
    46: 'kagoshima',
    47: 'okinawa',
  };
  function _jisToPref(jis) {
    if (typeof jis !== 'string' && typeof jis !== 'number') return null;
    const key = String(jis);
    return _JIS_TO_PREF[key] || _JIS_TO_PREF[Number(key)] || null;
  }

  // ハバーサイン (m 単位) - 距離計算は表示用ではなく「最近傍検索」のみで使用
  function _haversineM(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLng = (lng2 - lng1) * toRad;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // 現在地から最近傍の市区町村を coarse から探し、JIS2 桁 → ローマ字 pref 名を返す
  //
  // 仕様:
  //   1. lat/lng が無効 → null
  //   2. accuracy > 50m (= 任意・GPS 精度低) → null
  //   3. ADDRESSES_COARSE_JP 未 load → null
  //   4. 半径 50 km 内の最近傍 coarse item を探す
  //   5. item.c (JIS5 桁市区町村コード) の先頭 2 桁 → ローマ字 pref 名
  //   6. 半径外 / 県コード解析不能 → null
  //
  // 戻り値: 'ehime' / 'tokyo' 等 ローマ字 pref 名 (失敗時 null)
  function getCurrentPref(lat, lng, accuracy) {
    if (typeof lat !== 'number' || typeof lng !== 'number' || !isFinite(lat) || !isFinite(lng)) {
      return null;
    }
    if (typeof accuracy === 'number' && isFinite(accuracy) && accuracy > 50) {
      return null;
    }
    if (
      typeof global === 'undefined' ||
      !global.ADDRESSES_COARSE_JP ||
      !Array.isArray(global.ADDRESSES_COARSE_JP.items)
    ) {
      return null;
    }

    const items = global.ADDRESSES_COARSE_JP.items;
    // 半径 50km プレフィルタ範囲 (bbox は緯度方向 1.111 m/単位の概算で広めに取る)
    const targetLatI = Math.round(lat * 100000);
    const targetLngI = Math.round(lng * 100000);
    const RANGE_I = 50000; // ~55 km 余裕

    let best = null;
    let bestDistM = Infinity;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const dLatI = it.lat - targetLatI;
      if (dLatI > RANGE_I || dLatI < -RANGE_I) continue;
      const dLngI = it.lng - targetLngI;
      if (dLngI > RANGE_I || dLngI < -RANGE_I) continue;
      const itemLat = it.lat / 100000;
      const itemLng = it.lng / 100000;
      const distM = _haversineM(lat, lng, itemLat, itemLng);
      if (distM < bestDistM) {
        bestDistM = distM;
        best = it;
      }
    }

    if (!best || bestDistM > 50000) return null;
    if (typeof best.c !== 'string' || best.c.length < 2) return null;

    return _jisToPref(best.c.substring(0, 2));
  }

  function isReady() {
    return Boolean(
      typeof global !== 'undefined' &&
        global.ADDRESSES_COARSE_JP &&
        Array.isArray(global.ADDRESSES_COARSE_JP.items) &&
        global.ADDRESSES_COARSE_JP.items.length > 0
    );
  }

  global.RegionHelper = {
    getCurrentPref: getCurrentPref,
    isReady: isReady,
  };
})(
  typeof window !== 'undefined'
    ? window
    : typeof self !== 'undefined'
      ? self
      : typeof globalThis !== 'undefined'
        ? globalThis
        : this
);
