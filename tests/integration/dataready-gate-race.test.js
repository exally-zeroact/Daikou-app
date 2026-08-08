'use strict';
// ============================================================
// ★準備ゲートが「閉じたまま二度と開かない」を作らないこと★ 2026-08-08
//
//   ★掴んだ実バグ★
//     _markerOk() は 保存した印の版と window.DataRegistry.VERSION を比べる。
//     ★DataRegistry がまだ読めていないと 比べる相手が '0' になり「版が違う」と判定★し、
//     ゲートが閉じる。閉じたゲートを開けるのは _bgLoadDone だけなので、
//     道データが既に揃っている起動（warm start）では ★二度と開かない★。
//     ＝ データは正常なのに、起動のタイミングだけで 代行開始が押せなくなる。
//     実測: 画面テストで20回に1回ほど再現（2026-08-07）。
//
//   ★直す形★
//     ① 決める前に DataRegistry が来るのを待つ（来るまで判定しない）
//     ② 閉じたあとも、印が合った時点で開ける（＝遅れて来ても復帰する）
//     ★保留中/閉じている間は「📥 初回データ準備中」が出る＝押せない理由が見える★
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// DataReadyGate の即時実行関数を切り出して、その場で動かす
function extractGate() {
  const i = HTML.indexOf('(function setupDataReadyGate() {');
  if (i < 0) throw new Error('setupDataReadyGate が見つからない');
  const end = HTML.indexOf('\n      })();', i);
  if (end < 0) throw new Error('終わりが見つからない');
  return HTML.slice(i, end + 12);
}

// 偽の環境（時計は手回し）
function makeEnv(opts) {
  const o = { standalone: true, marker: null, dataRegistry: null, bgLoadDone: false, ...opts };
  const timers = [];
  const els = {};
  const mkEl = () => ({
    disabled: false,
    style: {},
    classList: {
      _s: new Set(),
      add(c) {
        this._s.add(c);
      },
      remove(c) {
        this._s.delete(c);
      },
      contains(c) {
        return this._s.has(c);
      },
    },
    textContent: '',
  });
  ['btnSensorPermission', 'btnResumeFromStart', 'btnMain', 'dataReadyHint'].forEach(
    (id) => (els[id] = mkEl())
  );
  const listEls = [mkEl(), mkEl()];

  const store = {};
  if (o.marker !== null) store['daikome_warmup_v1'] = JSON.stringify(o.marker);

  const win = {
    navigator: { standalone: o.standalone },
    matchMedia: () => ({ matches: o.standalone }),
    get DataRegistry() {
      return o.dataRegistry;
    },
    get _mmPipeline() {
      return o.pipeline;
    },
  };
  const ctx = {
    window: win,
    navigator: win.navigator,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => (store[k] = String(v)),
      removeItem: (k) => delete store[k],
    },
    document: {
      readyState: 'complete',
      addEventListener: () => {},
      getElementById: (id) => els[id] || null,
      querySelectorAll: () => listEls,
    },
    setInterval: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearInterval: (id) => {
      if (timers[id - 1]) timers[id - 1].dead = true;
    },
    setTimeout: () => 0,
    JSON,
    Math,
    dlog: () => {},
  };
  return {
    o,
    els,
    listEls,
    ctx,
    tick(n = 1) {
      for (let k = 0; k < n; k++) timers.filter((t) => !t.dead).forEach((t) => t.fn());
    },
    押せる: () => !els.btnMain.disabled,
    案内: () => (els.dataReadyHint.style.display === 'none' ? '' : els.dataReadyHint.textContent),
  };
}

function run(env) {
  // eslint-disable-next-line no-new-func
  new Function('ctx', `with (ctx) { ${extractGate()} }`)(env.ctx);
  return env;
}

const REG = { VERSION: '2026-05-23-e1' };

describe('★準備ゲート: 閉じたまま二度と開かない を作らない★', () => {
  it('印が合っていて DataRegistry もある → 最初から押せる（普段の起動）', () => {
    const env = makeEnv({ marker: { version: REG.VERSION }, dataRegistry: REG, pipeline: {} });
    run(env);
    env.tick(3);
    expect(env.押せる(), '★普段の起動なのに押せない★').toBe(true);
  });

  it('★DataRegistry が遅れて来る → 来た時点で押せるようになる★（二度と開かない を作らない）', () => {
    const env = makeEnv({ marker: { version: REG.VERSION }, dataRegistry: null, pipeline: {} });
    run(env);
    env.tick(40); // まだ来ない間
    // 遅れて到着
    env.o.dataRegistry = REG;
    env.tick(5);
    expect(env.押せる(), '★DataRegistry が来ても閉じたまま＝二度と開かない★').toBe(true);
  });

  it('★閉じている間は 押せない理由が画面に出る★', () => {
    const env = makeEnv({ marker: null, dataRegistry: REG, pipeline: {} });
    run(env);
    env.tick(3);
    expect(env.押せる(), '準備できていないのに押せる').toBe(false);
    expect(env.案内(), '★押せない理由が出ていない★').toContain('準備中');
  });

  it('道データの用意が終われば開く（今までどおり）', () => {
    const env = makeEnv({ marker: null, dataRegistry: REG, pipeline: { _bgLoadDone: false } });
    run(env);
    env.tick(3);
    expect(env.押せる()).toBe(false);
    env.o.pipeline._bgLoadDone = true;
    env.tick(3);
    expect(env.押せる(), '★準備が終わったのに開かない★').toBe(true);
  });

  it('ブラウザのタブ（ホーム画面アプリでない）では ゲートを掛けない', () => {
    const env = makeEnv({ standalone: false, marker: null, dataRegistry: null, pipeline: {} });
    run(env);
    env.tick(5);
    expect(env.押せる()).toBe(true);
  });
});
