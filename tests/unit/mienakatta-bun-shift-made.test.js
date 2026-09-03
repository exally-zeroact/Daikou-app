// ============================================================
// ★★「見えなかった分」を 業務の 履歴まで 運ぶ★★ 2026-09-03
//
//   ★ここが 最後の 1本でした★（[[mienai-souko-made]] の ④）
//     ①数える … 出来ている（js/pipeline-distance.js mienakattaBun）
//     ②上げる口 … 出来ている（js/job-sync.js が shift.mienai_* を そのまま 上げる）
//     ③倉庫の列/関数 … 出来ている（本番・テスト 両方 当て済）
//     ④★数えた値を ②へ 渡す★ … ★これを 入れます★
//
//   ★設計（なぜ この形か）★
//     ・数えているのは ★課金の Worker の 中★（map-matcher → pipeline-distance）。
//       ⇒ Worker は ★読むだけ★＝`tk.mienakattaBun()` を メッセージに 載せるだけ。
//         ★距離の 数字には 1mmも 触りません★（calibStatus と 同じ 形）。
//     ・Worker の 数は ★業務をまたいで 積み上がる★（業務ごとに 作り直されない）。
//       ⇒ ★引き算は 本体側で やる★＝業務開始で 基準を控え、終了で 今の値との 差を出す。
//     ・★取れない時は null★（★0 と 書かない★＝「本当に 0 だった」と 読まれる）
//     ・★Worker が 作り直されて 数が 巻き戻る事が ある★（configVehicle で tracker を 捨てる）
//       ⇒ 今の値 < 基準 なら ★今の値 そのもの★を使う（★マイナスにも 二重にも しない★）
//
//   ★お金への影響★ ★無し★。距離も 料金も 1つも 触りません（数える・運ぶだけ）。
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-03 実測）★★
//     ①引き算を やめる（積み上がりを そのまま 入れる）… ★9本中 2本 赤★
//     ②取れない時に 0 を 書く ………………………………… ★9本中 2本 赤★
//     ③開き直しで 基準を 捨てる ……………………………… ★9本中 1本 赤★
//     ④Worker が メッセージに 載せるのを やめる ………… ★9本中 1本 赤★
//     戻した後 … ★9本とも 緑★
//     ⇒★4通り 全部で 赤に なった＝この試験は 空振りでは ありません★
//       （★壊しても 赤に ならない時は まず 自分の 壊し方を 疑う★＝2026-09-01 の 教訓）
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BUSINESS_JS = fs.readFileSync(path.join(ROOT, 'js', 'business.js'), 'utf8');

function makeLocalStorage() {
  const store = Object.create(null);
  return {
    getItem(k) {
      return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
    },
    setItem(k, v) {
      store[k] = String(v);
    },
    removeItem(k) {
      delete store[k];
    },
    clear() {
      for (const k of Object.keys(store)) delete store[k];
    },
    key(i) {
      return Object.keys(store)[i] || null;
    },
    get length() {
      return Object.keys(store).length;
    },
    _raw: store,
  };
}

function makeMeter() {
  return {
    getState: () => ({ distance_m: 0, business_distance_m: 0, running: true }),
    setDistance: () => {},
    setBusinessDistance: () => {},
    setBusinessActive: () => {},
    getNearestAddress: () => 'mock',
    isAddressDataReady: () => true,
  };
}

function load() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.Meter = makeMeter();
  sandbox.localStorage = makeLocalStorage();
  sandbox.dlog = () => {};
  sandbox.console = console;
  const fn = new Function(
    'window',
    'Meter',
    'localStorage',
    'dlog',
    'console',
    BUSINESS_JS + '\n;return window.Business;'
  );
  const Business = fn(sandbox, sandbox.Meter, sandbox.localStorage, sandbox.dlog, sandbox.console);
  return { Business, sandbox };
}

// ★Worker が 出す 形（pipeline-distance.mienakattaBun の 返り）★
const mie = (kaisuu, byou, meter) => ({
  kaisuu,
  byou,
  meter,
  nagasugi: 0,
  hayasugi: 0,
  sonota: 0,
  umeta: 0,
});

describe('★「見えなかった分」を 業務の 履歴まで 運ぶ★', () => {
  it('★① 業務ごとの 差が 入る（積み上がった数を そのまま 入れない）★', () => {
    const { Business, sandbox } = load();
    sandbox.window._lastMienai = mie(1, 5, 10); // 前の業務までの 積み上がり
    Business.start();
    sandbox.window._lastMienai = mie(4, 20, 35); // この業務で 3回 / 15秒 / 25m 増えた
    const r = Business.end();
    expect(r.mienai_kaisuu, '★回数が 業務ごとの 差に なっていません★').toBe(3);
    expect(r.mienai_byou, '★秒数が 業務ごとの 差に なっていません★').toBe(15);
    expect(r.mienai_m, '★距離が 業務ごとの 差に なっていません★').toBe(25);
  });

  it('★★② 取れない時は null（★0 と 書かない★）★★', () => {
    const { Business, sandbox } = load();
    delete sandbox.window._lastMienai;
    Business.start();
    const r = Business.end();
    expect(r.mienai_kaisuu, '★取れないのに 0 と 書いています★').toBeNull();
    expect(r.mienai_byou, '★取れないのに 0 と 書いています★').toBeNull();
    expect(r.mienai_m, '★取れないのに 0 と 書いています★').toBeNull();
  });

  it('★③ 途中で 取れなくなっても null（★基準だけ あって 今が 無い★）★', () => {
    const { Business, sandbox } = load();
    sandbox.window._lastMienai = mie(1, 5, 10);
    Business.start();
    delete sandbox.window._lastMienai;
    const r = Business.end();
    expect(r.mienai_kaisuu).toBeNull();
    expect(r.mienai_m).toBeNull();
  });

  it('★④ Worker が 作り直されて 数が 巻き戻っても マイナスに しない★', () => {
    const { Business, sandbox } = load();
    sandbox.window._lastMienai = mie(10, 100, 500); // 業務開始の 基準
    Business.start();
    sandbox.window._lastMienai = mie(2, 20, 60); // 作り直された（巻き戻り）
    const r = Business.end();
    expect(r.mienai_kaisuu, '★マイナスに なっています★').toBe(2);
    expect(r.mienai_byou).toBe(20);
    expect(r.mienai_m).toBe(60);
  });

  it('★⑤ 業務を 再開しても 基準は 業務開始のまま（途中で 0 に 戻さない）★', () => {
    const { Business, sandbox } = load();
    sandbox.window._lastMienai = mie(0, 0, 0);
    Business.start();
    sandbox.window._lastMienai = mie(2, 10, 20);
    Business.end();
    Business.resume();
    sandbox.window._lastMienai = mie(5, 30, 70);
    const r = Business.end();
    expect(r.mienai_kaisuu, '★再開で 基準が 動きました★').toBe(5);
    expect(r.mienai_m).toBe(70);
  });

  it('★⑥ 履歴（送る元）にも 入っている★', () => {
    const { Business, sandbox } = load();
    sandbox.window._lastMienai = mie(0, 0, 0);
    Business.start();
    sandbox.window._lastMienai = mie(3, 12, 45);
    Business.end();
    const list = JSON.parse(sandbox.localStorage.getItem('daikou_business_history') || '[]');
    expect(list.length, '★履歴に 積まれていません★').toBeGreaterThan(0);
    expect(list[0].mienai_kaisuu, '★履歴に 回数が ありません★').toBe(3);
    expect(list[0].mienai_byou).toBe(12);
    expect(list[0].mienai_m, '★履歴に 距離が ありません★').toBe(45);
  });

  it('★⑦ アプリを 開き直しても 基準が 消えない（load で 拾う）★', () => {
    const { Business, sandbox } = load();
    sandbox.window._lastMienai = mie(7, 70, 700);
    Business.start();
    // ★タスクキル相当★ … 同じ localStorage で 読み直す
    const nokori = sandbox.localStorage._raw;
    const b2 = load();
    Object.keys(nokori).forEach((k) => b2.sandbox.localStorage.setItem(k, nokori[k]));
    b2.Business.load();
    b2.sandbox.window._lastMienai = mie(9, 90, 900);
    const r = b2.Business.end();
    expect(r.mienai_kaisuu, '★開き直すと 基準が 消えています（差が 出せない）★').toBe(2);
    expect(r.mienai_m).toBe(200);
  });

  // ─── 配線（★ここは 中身を 読むだけ＝実機OKでは ない★・既存の
  //      autocalibk-degraded-wiring.test.js と 同じ 断り書き） ───
  it('★⑧ Worker が 数を メッセージに 載せている（読むだけ）★', () => {
    const mm = fs.readFileSync(path.join(ROOT, 'js', 'map-matcher.js'), 'utf8');
    expect(mm, '★mienakattaBun を 呼んでいません★').toMatch(
      /_lastMienai\s*=\s*typeof\s+tk\.mienakattaBun\s*===\s*'function'\s*\?\s*tk\.mienakattaBun\(\)\s*:\s*null/
    );
    expect(mm, '★メッセージに 載せていません★').toMatch(/mienai:\s*_lastMienai/);
  });

  it('★⑨ 画面が 受け取って 置いている（読むだけ）★', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    expect(html, '★window._lastMienai に 入れていません★').toMatch(
      /window\._lastMienai\s*=\s*m\.mienai\s*\|\|\s*null/
    );
  });
});
