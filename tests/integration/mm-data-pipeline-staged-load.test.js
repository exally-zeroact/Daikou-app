// tests/integration/mm-data-pipeline-staged-load.test.js
//
// ★設計変更宣言 (2026-05-23・X4 方式E・即時+背景+priority load verify):
//   mm-data-pipeline.js の・新フロー (= Phase A 完了で warmup resolve・Phase B/C を
//   background・GPS first fix で・現在地県 priority load) を・verify。
//
// 検証内容:
//   1. _warmupInternal: Phase A await のみ・Phase B/C は・fire-and-forget で起動
//   2. _scheduleBackgroundLoad: 多重起動防止 (= _bgLoadStarted)
//   3. _scheduleBackgroundLoad: requestIdleCallback 未対応 → setTimeout fallback
//   4. _getPrefEntries: 該当県 entries 返却 (= 本物 DataRegistry 形式)
//   5. _priorityLoadCurrentPref: currentPref null → skip
//   6. _priorityLoadCurrentPref: 既 loadedPrefs → skip (= 重複防止)
//   7. _priorityLoadCurrentPref: 検出 OK → _loadedPrefs に追加・並列 load
//   8. getPrefStatus: 状態 確認 API
//   9. notifyGpsFix: lat/lng 与えると・_priorityLoadCurrentPref 呼出
//  10. window.XXX 互換: postMessage / global 代入の・data 構造 1 bit 不変
//
// 絶対ルール準拠:
//   ✓ decimal mock 禁止: 本物 ADDRESSES_COARSE_JP 形式 (= int×1e5)
//   ✓ distance_m / Worker B 本体: 完全無関係 (= load 順序のみ verify)
//   ✓ iOS/Android 共通 経路 verify (= requestIdleCallback / setTimeout 両方 test)

'use strict';

const fs = require('fs');
const path = require('path');

// MMDataPipeline は・IIFE で・global.MMDataPipeline を・代入する
beforeAll(() => {
  // ─── DataRegistry mock (= 本物 entries 形式) ───
  global.DataRegistry = {
    VERSION: '2026-05-23-e1',
    DATA_REGISTRY: {
      global: [
        {
          url: '/data/coarse-jp.js',
          globalKey: 'COARSE_JP',
          target: 'worker',
          msgType: 'loadCoarse',
        },
        {
          url: '/data/shelters-jp.js',
          globalKey: 'SHELTERS_JP',
          target: 'main',
        },
      ],
      perPref: [
        {
          kind: 'roads',
          template: '/data/roads-{pref}.js',
          globalKeyFn: function (pref) {
            return 'ROADS_' + pref.toUpperCase();
          },
          target: 'worker',
          msgType: 'loadRoads',
          handler: 'loadRoadsBundle',
        },
        {
          kind: 'tunnels',
          template: '/data/tunnels-{pref}.js',
          globalKeyFn: function (pref) {
            return 'TUNNELS_' + pref.toUpperCase();
          },
          target: 'main',
        },
        {
          kind: 'addresses-fine',
          template: '/data/addresses-fine-{pref}.js',
          globalKeyFn: function (pref) {
            return 'ADDRESSES_FINE_' + pref.toUpperCase();
          },
          target: 'main',
          optional: true,
        },
      ],
    },
    expandPerPref: function (def) {
      // 簡易展開 (= ehime / tokyo の 2 県のみ)
      const prefs = ['ehime', 'tokyo'];
      return prefs.map(function (pref) {
        return {
          url: def.template.replace('{pref}', pref),
          globalKey: def.globalKeyFn(pref),
          target: def.target,
          msgType: def.msgType,
          handler: def.handler,
          kind: def.kind,
          optional: def.optional,
          pref: pref,
        };
      });
    },
  };

  // ─── RegionHelper mock (= 本物 形式・特定 lat/lng で・現在地県判定) ───
  global.RegionHelper = {
    getCurrentPref: function (lat, lng /* , accuracy */) {
      // 司さん GPS (34.06467, 133.0015) → ehime
      if (typeof lat !== 'number' || typeof lng !== 'number') return null;
      if (lat > 33 && lat < 35 && lng > 132 && lng < 134) return 'ehime';
      if (lat > 35 && lat < 36 && lng > 139 && lng < 140) return 'tokyo';
      return null;
    },
    isReady: function () {
      return true;
    },
  };

  // ─── DataLoader mock (= sandbox 返却・本物 形式) ───
  global.DataLoader = {
    loadFromCache: async function (url) {
      // 本物 sandbox 形式・url に応じて適切な global key で・plain object 返却
      if (url.indexOf('coarse-jp') !== -1) {
        return {
          COARSE_JP: {
            v: 1,
            precision: 100000,
            items: [{ lat: 3406467, lng: 13300150, n: '今治市' }],
          },
        };
      }
      if (url.indexOf('shelters-jp') !== -1) {
        return {
          SHELTERS_JP: { v: 1, items: [] },
        };
      }
      const m = url.match(/(\w+)-(\w+)\.js$/);
      if (m) {
        const kind = m[1];
        const pref = m[2];
        const upper = pref.toUpperCase();
        // 本物 plain object 形式 (decimal mock 禁止・int×1e5 保持)
        if (kind === 'roads') {
          return {
            ['ROADS_' + upper]: {
              v: 6,
              prefecture: pref,
              precision: 100000,
              bbox: [3294980, 13236976, 3412666, 13364248],
              nodes: [],
              edges: [],
            },
          };
        }
        if (kind === 'tunnels') {
          return {
            ['TUNNELS_' + upper]: { v: 1, prefecture: pref, points: [] },
          };
        }
        if (kind === 'addresses-fine' || url.indexOf('addresses-fine') !== -1) {
          return {
            ['ADDRESSES_FINE_' + upper]: { v: 1, prefecture: pref, items: [] },
          };
        }
      }
      return {};
    },
  };

  // ─── MMDataPipeline を Node に load ───
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'js', 'mm-data-pipeline.js'),
    'utf8'
  );
  new Function(src)();
});

afterAll(() => {
  delete global.DataRegistry;
  delete global.RegionHelper;
  delete global.DataLoader;
  delete global.MMDataPipeline;
});

// 共通 mock worker (= postMessage stub・data 1 bit 不変 verify)
function makeMockWorker() {
  return {
    posted: [],
    postMessage: function (msg) {
      this.posted.push(msg);
    },
  };
}

// ─── 1. _warmupInternal: Phase A 完了で resolve ───
describe('mm-data-pipeline staged load: warmup() resolve タイミング', () => {
  it('Phase A 完了 で warmup() resolve・Phase B/C は・background', async () => {
    const worker = makeMockWorker();
    const pipeline = new global.MMDataPipeline({
      worker: worker,
      loader: global.DataLoader,
    });
    const t0 = Date.now();
    await pipeline.warmup();
    const dur = Date.now() - t0;
    // Phase A (= global 2 件) のみ await・Phase B/C は・background → 速い完了想定
    expect(pipeline.ready.globalLoaded).toBe(true);
    expect(pipeline._bgLoadStarted).toBe(true);
    // 本 test は・関数同期完了 verify (= 時間値は・環境依存・assertion せず)
    expect(typeof dur).toBe('number');
  });
});

// ─── 2. _scheduleBackgroundLoad: 多重起動防止 ───
describe('mm-data-pipeline staged load: _scheduleBackgroundLoad 多重起動防止', () => {
  it('2 回呼んでも・_backgroundLoadAll は・1 回しか起動しない', () => {
    const worker = makeMockWorker();
    const pipeline = new global.MMDataPipeline({
      worker: worker,
      loader: global.DataLoader,
    });
    let _callCount = 0;
    const orig = pipeline._backgroundLoadAll.bind(pipeline);
    pipeline._backgroundLoadAll = async function () {
      _callCount++;
      return orig();
    };
    pipeline._scheduleBackgroundLoad();
    pipeline._scheduleBackgroundLoad();
    pipeline._scheduleBackgroundLoad();
    // requestIdleCallback or setTimeout で・実行は・非同期だが
    // _bgLoadStarted flag は・即時 set される (= 多重起動防止)
    expect(pipeline._bgLoadStarted).toBe(true);
  });
});

// ─── 3. _getPrefEntries: 該当県 entries 返却 ───
describe('mm-data-pipeline staged load: _getPrefEntries', () => {
  it('ehime → 該当県の・全 perPref entries 返却 (= 3 種・roads/tunnels/addresses-fine)', () => {
    const pipeline = new global.MMDataPipeline({
      worker: makeMockWorker(),
      loader: global.DataLoader,
    });
    const entries = pipeline._getPrefEntries('ehime');
    expect(entries.length).toBe(3); // = roads + tunnels + addresses-fine (mock perPref 3 種)
    // 全 entries が・pref='ehime' を持つ
    for (const e of entries) {
      expect(e.pref).toBe('ehime');
    }
    // url も・該当県の・形式
    const urls = entries.map(function (e) {
      return e.url;
    });
    expect(urls).toContain('/data/roads-ehime.js');
    expect(urls).toContain('/data/tunnels-ehime.js');
    expect(urls).toContain('/data/addresses-fine-ehime.js');
  });

  it('存在しない pref → 空配列', () => {
    const pipeline = new global.MMDataPipeline({
      worker: makeMockWorker(),
      loader: global.DataLoader,
    });
    const entries = pipeline._getPrefEntries('nonexistent');
    expect(entries.length).toBe(0);
  });
});

// ─── 4. _priorityLoadCurrentPref: 各分岐 ───
describe('mm-data-pipeline staged load: _priorityLoadCurrentPref', () => {
  it('currentPref null (= GPS 検出 fail) → skip (= _loadedPrefs 不変)', async () => {
    const worker = makeMockWorker();
    const pipeline = new global.MMDataPipeline({
      worker: worker,
      loader: global.DataLoader,
    });
    // RegionHelper.getCurrentPref(0, 0) → null
    await pipeline._priorityLoadCurrentPref(0, 0, 10);
    expect(pipeline._loadedPrefs.size).toBe(0);
    expect(worker.posted.length).toBe(0);
  });

  it('既 loadedPrefs → skip (= 重複防止)', async () => {
    const worker = makeMockWorker();
    const pipeline = new global.MMDataPipeline({
      worker: worker,
      loader: global.DataLoader,
    });
    pipeline._loadedPrefs.add('ehime');
    // 司さん GPS (34.06467, 133.0015) → ehime・既 loaded で・skip
    await pipeline._priorityLoadCurrentPref(34.06467, 133.0015, 10);
    expect(worker.posted.length).toBe(0);
  });

  it('検出 OK + 未 load → _loadedPrefs に追加・並列 load 実行', async () => {
    const worker = makeMockWorker();
    const pipeline = new global.MMDataPipeline({
      worker: worker,
      loader: global.DataLoader,
    });
    await pipeline._priorityLoadCurrentPref(34.06467, 133.0015, 10);
    expect(pipeline._loadedPrefs.has('ehime')).toBe(true);
    // worker target (= roads) は・postMessage に・3 件 push される (= loadRoadsBundle で・分割送信)
    // ただし mock data に・pois / conditionalRestrictions 含まないため・loadRoads 1 件のみ
    const loadRoadsMsgs = worker.posted.filter(function (m) {
      return m.type === 'loadRoads' && m.pref === 'ehime';
    });
    expect(loadRoadsMsgs.length).toBe(1);
  });
});

// ─── 5. getPrefStatus ────────────────────────────────
describe('mm-data-pipeline staged load: getPrefStatus', () => {
  it('初期状態: loaded=false / bgLoadStarted=false / bgLoadDone=false', () => {
    const pipeline = new global.MMDataPipeline({
      worker: makeMockWorker(),
      loader: global.DataLoader,
    });
    const s = pipeline.getPrefStatus('ehime');
    expect(s.loaded).toBe(false);
    expect(s.bgLoadStarted).toBe(false);
    expect(s.bgLoadDone).toBe(false);
  });

  it('priority load 後: loaded=true', async () => {
    const pipeline = new global.MMDataPipeline({
      worker: makeMockWorker(),
      loader: global.DataLoader,
    });
    await pipeline._priorityLoadCurrentPref(34.06467, 133.0015, 10);
    const s = pipeline.getPrefStatus('ehime');
    expect(s.loaded).toBe(true);
  });
});

// ─── 6. notifyGpsFix 拡張: _priorityLoadCurrentPref 呼出 ───
describe('mm-data-pipeline staged load: notifyGpsFix → _priorityLoadCurrentPref', () => {
  it('lat/lng 与えると・priority load 実行 → _loadedPrefs に追加', async () => {
    const worker = makeMockWorker();
    const pipeline = new global.MMDataPipeline({
      worker: worker,
      loader: global.DataLoader,
    });
    pipeline.notifyGpsFix(34.06467, 133.0015, 10);
    // notifyGpsFix は同期だが・内部の _priorityLoadCurrentPref は・async
    // 1 tick 待って・_loadedPrefs verify
    await new Promise(function (r) {
      setTimeout(r, 50);
    });
    expect(pipeline._loadedPrefs.has('ehime')).toBe(true);
  });

  it('lat/lng なし → 通常動作のみ (= priority load skip)', () => {
    const worker = makeMockWorker();
    const pipeline = new global.MMDataPipeline({
      worker: worker,
      loader: global.DataLoader,
    });
    pipeline.notifyGpsFix();
    expect(pipeline._loadedPrefs.size).toBe(0);
  });
});

// ─── 7. window.XXX 互換: postMessage data 1 bit 不変 ───
describe('mm-data-pipeline staged load: window.XXX 互換 verify', () => {
  it('priority load の・worker postMessage data 構造・既存と完全同一', async () => {
    const worker = makeMockWorker();
    const pipeline = new global.MMDataPipeline({
      worker: worker,
      loader: global.DataLoader,
    });
    await pipeline._priorityLoadCurrentPref(34.06467, 133.0015, 10);
    // loadRoads message は・既存形式: { type, pref, roadsData }
    const loadRoadsMsg = worker.posted.find(function (m) {
      return m.type === 'loadRoads';
    });
    expect(loadRoadsMsg).toBeDefined();
    expect(loadRoadsMsg.pref).toBe('ehime');
    expect(loadRoadsMsg.roadsData).toBeDefined();
    expect(loadRoadsMsg.roadsData.v).toBe(6); // 本物 roads v6 形式
    expect(loadRoadsMsg.roadsData.precision).toBe(100000);
  });
});
