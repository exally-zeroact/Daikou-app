// ============================================================
// osrm-client.js
// MM-6 (2026-05-08): OSRM /match API クライアント
//
// 用途:
//   GPS トレースを 30 秒バッファして OSRM /match に POST し、
//   各 leg の実距離を「教師信号」として Viterbi の transition score に反映する。
//   結果は HMM の補正のみに使用・mm_distance_m への直接代入は禁止。
//
// 設計:
//   - タイムアウト 8 秒（即フォールバック・リトライなし）
//   - navigator.onLine === false なら即スキップ
//   - 失敗時は { ok:false, reason } を返す（throw しない）
//   - Worker / main 両方で動作（self / window 双方に export）
//
// API:
//   OsrmClient.setEndpoint(url)         エンドポイント設定（既定 router.project-osrm.org）
//   OsrmClient.getEndpoint()            現在のエンドポイント取得
//   OsrmClient.matchBatch(coords)       coords: [{lat,lng,timestamp,accuracy?}...]
//                                       → Promise<{ ok, legs?, tracepoints?, reason? }>
//
// OSRM /match レスポンス仕様（参考）:
//   {
//     code: "Ok",
//     matchings: [{ legs: [{distance, duration, ...}], geometry, ...}],
//     tracepoints: [{matchings_index, waypoint_index, location, ...}, ...]
//   }
// ============================================================

(function (_global) {
  'use strict';

  // ★設計変更宣言 (2026-05-12): Web Worker 内で動作するため main thread の
  //   OSRM_ENDPOINT 定数 (debug-config.js) は直接参照不可。
  //   実運用では index.html の configOsrm postMessage で起動直後に setEndpoint() が
  //   呼ばれる (worker 起動の数 ms 以内) ため、この初期値は実質的には使われない fallback。
  //   何らかの理由で configOsrm 未受信のまま matchBatch が呼ばれた場合の保険として
  //   最小限の値を保持。Step 5 サーバー構築後は configOsrm 経由で自動切替されるため
  //   ここを書き換える必要はない (main 側 OSRM_ENDPOINT を 1 行直すだけ)。
  let _endpoint = 'https://router.project-osrm.org';
  const TIMEOUT_MS = 8000;
  const MIN_COORDS = 2;
  const MAX_COORDS = 100; // OSRM の 1 リクエスト座標上限

  function setEndpoint(url) {
    if (typeof url === 'string' && url.length > 0) {
      _endpoint = url.replace(/\/+$/, ''); // trailing slash 除去
    }
  }
  function getEndpoint() {
    return _endpoint;
  }

  // 座標リストを OSRM URL 形式に整形
  function _formatCoords(coords) {
    return coords.map((c) => c.lng + ',' + c.lat).join(';');
  }
  function _formatRadiuses(coords) {
    // accuracy ベースの探索半径・最低 10m
    return coords.map((c) => Math.max(10, Math.round(c.accuracy || 20))).join(';');
  }

  function matchBatch(coords) {
    if (!coords || !Array.isArray(coords))
      return Promise.resolve({ ok: false, reason: 'invalid coords' });
    if (coords.length < MIN_COORDS) return Promise.resolve({ ok: false, reason: 'too few coords' });

    // オフライン時は即スキップ
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return Promise.resolve({ ok: false, reason: 'offline' });
    }

    // 100 点上限まで間引く（最新を残す方針）
    const trimmed = coords.length > MAX_COORDS ? coords.slice(coords.length - MAX_COORDS) : coords;

    const url =
      _endpoint +
      '/match/v1/driving/' +
      _formatCoords(trimmed) +
      '?overview=false&geometries=geojson&annotations=distance' +
      '&radiuses=' +
      _formatRadiuses(trimmed);

    let abortCtrl = null,
      timer = null;
    if (typeof AbortController !== 'undefined') {
      abortCtrl = new AbortController();
      timer = setTimeout(() => {
        try {
          abortCtrl.abort();
        } catch (e) {}
      }, TIMEOUT_MS);
    }

    const fetchOpts = abortCtrl ? { signal: abortCtrl.signal } : {};
    return fetch(url, fetchOpts)
      .then((r) => {
        if (timer) clearTimeout(timer);
        if (!r.ok) return { ok: false, reason: 'http ' + r.status };
        return r.json().then((json) => {
          if (!json || json.code !== 'Ok') {
            return { ok: false, reason: 'osrm ' + (json && json.code) };
          }
          if (!json.matchings || !json.matchings.length) {
            return { ok: false, reason: 'no matchings' };
          }
          // 各 matching の legs を flatten して distance だけ取り出す
          const legs = [];
          for (let m = 0; m < json.matchings.length; m++) {
            const matching = json.matchings[m];
            if (matching && matching.legs) {
              for (let l = 0; l < matching.legs.length; l++) {
                const leg = matching.legs[l];
                if (leg && typeof leg.distance === 'number') {
                  legs.push(leg.distance);
                }
              }
            }
          }
          return {
            ok: true,
            legs: legs,
            tracepoints: json.tracepoints || null,
            coordsLen: trimmed.length,
          };
        });
      })
      .catch((err) => {
        if (timer) clearTimeout(timer);
        const msg = err && err.message ? err.message : 'unknown';
        return { ok: false, reason: 'error: ' + msg };
      });
  }

  const api = { setEndpoint, getEndpoint, matchBatch };

  // 両環境（main / Worker）に公開
  if (typeof self !== 'undefined') self.OsrmClient = api;
  if (typeof window !== 'undefined') window.OsrmClient = api;
})(
  typeof window !== 'undefined'
    ? window
    : typeof self !== 'undefined'
      ? self
      : typeof globalThis !== 'undefined'
        ? globalThis
        : this
);
