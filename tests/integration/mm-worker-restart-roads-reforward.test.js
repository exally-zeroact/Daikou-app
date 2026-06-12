// tests/integration/mm-worker-restart-roads-reforward.test.js
// ★しまなみ SE 距離フリーズ根治の回帰ガード (2026-06-05)★
//
// 実機バグ(司さん・しまなみ海道 34km): iOS で画面ロック → Worker B suspend →
//   visibility ping watchdog が新 Worker を作り直す → ★新 Worker に道路を再 load しない★
//   (loaded=0県/0本) → 全 snap 失敗で distance 永久フリーズ (34km走行で 1.6km=−95%)。
// 修正: MMDataPipeline.reforwardToWorker(newWorker) が load 済 pref の roads を新 Worker へ再送。
//
// 本 test = pipeline を vm で実体化し、pref load 済状態から worker を差し替え、
//   reforwardToWorker が新 worker に loadRoads を再 post することを検証する。
// 絶対ルール準拠: distance_m / calcFare には触れない (= データ層の reforward 検証のみ)。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MM_DP_PATH = path.join(__dirname, '..', '..', 'js', 'mm-data-pipeline.js');

function makeWorker() {
  const msgs = [];
  return {
    msgs,
    postMessage(m) {
      msgs.push(m);
    },
  };
}

// pipeline を vm context で実体化し global.MMDataPipeline を取り出す
function loadPipelineClass(ctx) {
  const src = fs.readFileSync(MM_DP_PATH, 'utf8');
  const sandbox = Object.assign(
    { setTimeout, clearTimeout, console, Promise, Set, Map, Date },
    ctx
  );
  sandbox.global = sandbox; // IIFE は (function(global){...})(self||global) 形式
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'mm-data-pipeline.js' });
  return { MMDataPipeline: sandbox.MMDataPipeline, sandbox };
}

describe('Worker B 再起動時の roads 再 forward (しまなみ SE フリーズ根治)', () => {
  // 最小の DataRegistry スタブ: ehime の roads entry を 1 件
  const ROADS_VALUE = {
    prefecture: 'ehime',
    roadsData: 'X',
    pois: [],
    conditionalRestrictions: [],
  };
  function buildStubs() {
    const DataRegistry = {
      DATA_REGISTRY: {
        global: [],
        perPref: [{ kind: 'roads' }],
      },
      expandPerPref(def) {
        if (def.kind === 'roads') {
          return [
            {
              pref: 'ehime',
              kind: 'roads',
              url: 'roads-ehime.js',
              globalKey: 'ROADS_EHIME',
              target: 'worker',
              handler: 'loadRoadsBundle',
            },
          ];
        }
        return [];
      },
    };
    const loader = {
      async loadFromCache() {
        return { ROADS_EHIME: ROADS_VALUE };
      },
    };
    return { DataRegistry, loader };
  }

  it('reforwardToWorker が新 worker に loadRoads を再 post する', async () => {
    const { DataRegistry, loader } = buildStubs();
    const { MMDataPipeline } = loadPipelineClass({ DataRegistry });
    const oldWorker = makeWorker();
    const pipe = new MMDataPipeline({ worker: oldWorker, loader });
    // しまなみ前: ehime を load 済とマーク (priority load 完了状態を再現)
    pipe._loadedPrefs.add('ehime');

    const newWorker = makeWorker();
    const res = await pipe.reforwardToWorker(newWorker);

    // 新 worker に loadRoads が届いている
    const loadRoadsMsgs = newWorker.msgs.filter(
      (m) => m && m.type === 'loadRoads' && m.pref === 'ehime'
    );
    expect(loadRoadsMsgs.length).toBeGreaterThanOrEqual(1);
    // pipeline の worker 参照が新 worker に差し替わっている
    expect(pipe.worker).toBe(newWorker);
    expect(res.ok).toBeGreaterThanOrEqual(1);
  });

  it('load 済 pref が無ければ loadRoads は送られない (空 reforward 安全)', async () => {
    const { DataRegistry, loader } = buildStubs();
    const { MMDataPipeline } = loadPipelineClass({ DataRegistry });
    const pipe = new MMDataPipeline({ worker: makeWorker(), loader });
    const newWorker = makeWorker();
    await pipe.reforwardToWorker(newWorker);
    const loadRoadsMsgs = newWorker.msgs.filter((m) => m && m.type === 'loadRoads');
    expect(loadRoadsMsgs.length).toBe(0);
  });

  it('reforwardToWorker メソッドが存在する (= 配線の静的保証)', () => {
    expect(typeof MMDataPipeline_proto_has('reforwardToWorker')).toBe('boolean');
    expect(MMDataPipeline_proto_has('reforwardToWorker')).toBe(true);
  });
});

// index.html 再起動経路が reforwardToWorker を呼ぶことの静的ガード
const INDEX_PATH = path.join(__dirname, '..', '..', 'index.html');
describe('index.html _setupMmWorker 再起動経路の配線', () => {
  it("reason !== 'init' で reforwardToWorker を呼ぶ", () => {
    const src = fs.readFileSync(INDEX_PATH, 'utf8');
    expect(/reforwardToWorker/.test(src)).toBe(true);
    expect(/reason\s*!==\s*'init'[\s\S]{0,400}reforwardToWorker/.test(src)).toBe(true);
  });
});

function MMDataPipeline_proto_has(name) {
  const src = fs.readFileSync(MM_DP_PATH, 'utf8');
  return new RegExp('\\b' + name + '\\s*\\(').test(src);
}
