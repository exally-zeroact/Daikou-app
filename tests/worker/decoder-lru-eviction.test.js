// tests/worker/decoder-lru-eviction.test.js
//
// ★古スマホ対応 ① (2026-05-30・decoder メモリ LRU eviction) の振る舞い検証★
//
// 検証対象 (js/map-matcher.js):
//   - decoders Map が LRU 上限 (DECODER_LRU_CAP = 4) を超えると最古の県を evict する。
//   - evict された県を再 loadRoads すると「already loaded」早期 return ではなく
//     ★再 decode 経路★ を通る (= roadsLoaded ok:true・_reason に 'already loaded' なし)。
//   - 常駐中の県を再 loadRoads すると「already loaded」早期 return になる (= 再 decode しない)。
//
// 観測手段: decoders / loadedPrefs / _decoderRecency は vm script スコープの const で
//   ctx から直接読めないため、loadRoads が返す roadsLoaded メッセージの _reason で
//   eviction を間接観測する (= 実 prod 経路の出力で判定・捏造なし)。

'use strict';

const { createMapMatcherWorker, loadPrefRoadsData } = require('../replay-mm-worker/worker-sim');

// 小さい県ファイル順 (= load 高速・CI 時間節約)。CAP=4 を超える 6 県を順に load。
const PREFS = ['wakayama', 'tokushima', 'tottori', 'kochi', 'kyoto', 'fukui'];

function loadAndCapture(worker, pref) {
  const data = loadPrefRoadsData(pref);
  let result = null;
  const handler = (e) => {
    const m = e.data;
    if (m && m.type === 'roadsLoaded' && m.pref === pref) result = m;
  };
  worker.on(handler);
  worker.sendMessage({ type: 'loadRoads', pref: pref, roadsData: data });
  worker.off(handler);
  return result;
}

describe('decoder LRU eviction (古スマホ対応 ① / map-matcher.js decoders Map)', () => {
  it('CAP 超過で最古県が evict され、再 load は再 decode 経路 (already loaded ではない) を通る', () => {
    const worker = createMapMatcherWorker({ debug: false });

    // 6 県を順に load (CAP=4 のため先頭 2 県 wakayama/tokushima が evict されるはず)。
    for (const pref of PREFS) {
      const r = loadAndCapture(worker, pref);
      expect(r, 'roadsLoaded ' + pref).toBeTruthy();
      expect(r.ok, pref + ' ok').toBe(true);
      // 初回 load は必ず再 decode (= already loaded ではない)。
      expect(r._reason).not.toBe('already loaded');
    }

    // 直近 load した fukui は常駐中 → 再 load は「already loaded」早期 return。
    const stillResident = loadAndCapture(worker, 'fukui');
    expect(stillResident.ok).toBe(true);
    expect(stillResident._reason).toBe('already loaded');

    // 最古の wakayama は evict 済 → 再 load は ★再 decode★ (= already loaded ではない)。
    //   ★県跨ぎ on-demand 再 load の動作実証★。
    const evictedReload = loadAndCapture(worker, 'wakayama');
    expect(evictedReload.ok).toBe(true);
    expect(evictedReload._reason).not.toBe('already loaded');
    // 再 decode で numRoads を返せている (= 再構築成功・decode 結果不変の前提)。
    expect(typeof evictedReload.numRoads).toBe('number');
    expect(evictedReload.numRoads).toBeGreaterThan(0);
  });

  it('CAP 以内 (4 県) では evict されず、全県の再 load が already loaded になる', () => {
    const worker = createMapMatcherWorker({ debug: false });
    const four = PREFS.slice(0, 4); // wakayama, tokushima, tottori, kochi
    for (const pref of four) {
      const r = loadAndCapture(worker, pref);
      expect(r.ok).toBe(true);
    }
    // CAP=4 ちょうど → 全県常駐 → 全て already loaded。
    for (const pref of four) {
      const r = loadAndCapture(worker, pref);
      expect(r.ok, pref + ' resident').toBe(true);
      expect(r._reason, pref + ' should be resident').toBe('already loaded');
    }
  });
});
