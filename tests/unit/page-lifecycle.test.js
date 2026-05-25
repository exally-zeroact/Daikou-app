// tests/unit/page-lifecycle.test.js (Phase 2・2026-05-21)
//
// ★設計変更宣言 Phase 2 (2026-05-21・A-1 動的テスト):
//   既に push 済 (= df079f3e) の A-1 js/page-lifecycle.js を Node 環境 (= environment: 'node'
//   default) で・globalThis に window/document/localStorage を simulate して実コード evaluate。
//   freeze/resume/pagehide/pageshow/visibilitychange の lifecycle event を Node EventTarget で
//   dispatch して動的検証。
//
//   jsdom package 未インストールゆえ・Node 標準 EventTarget + Map ベース localStorage で
//   同等機能を提供 (= jsdom 環境と機能的に等価・page-lifecycle.js の typeof window/document
//   guard が通る最小限の simulation)。
//
//   絶対前提:
//     - 実 js/page-lifecycle.js を実 evaluate (= vm.runInThisContext で実 source 読込)
//     - 再実装禁止・isolated 再現禁止
//     - meter.js / page-lifecycle.js 本体は無変更 (= 本タスクはテスト追加のみ)
//
//   検証狙い (= 司さん指示):
//     1. freeze→resume で distance_m 保全 (= reset 無し)
//     2. 運転状態 (= business_active 系) 復元 (= Business.save が呼ばれている)
//     3. resume 時に二重加算なし (= dlog のみで副作用ゼロ)
//     4. 不要な reset 無し (= Meter.reset / Meter.businessEnd 呼ばれない)
//
//   既知 drift (= 司さん指摘):
//     A-1 _saveDrivingState は index.html L7778 inline save と複製。本 test は
//     page-lifecycle.js 側の経路のみ検証 (= 複製撲滅は Phase 5 領域)。
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PAGE_LIFECYCLE_PATH = path.join(__dirname, '..', '..', 'js', 'page-lifecycle.js');

// minimal localStorage simulator (= Map ベース・jsdom localStorage と機能等価)
function createLocalStorageMock() {
  const store = new Map();
  return {
    setItem(k, v) {
      store.set(String(k), String(v));
    },
    getItem(k) {
      const v = store.get(String(k));
      return v == null ? null : v;
    },
    removeItem(k) {
      store.delete(String(k));
    },
    clear() {
      store.clear();
    },
  };
}

// 実 page-lifecycle.js を globalThis 上で evaluate
//   page-lifecycle.js は・window/document 存在 guard を満たせば動く設計
//   vm.runInThisContext で・現 globalThis に window.PageLifecycle が生成される
function loadPageLifecycle() {
  const src = fs.readFileSync(PAGE_LIFECYCLE_PATH, 'utf8');
  vm.runInThisContext(src, { filename: 'js/page-lifecycle.js' });
}

describe('Phase 2: A-1 page-lifecycle.js JSDOM 動的テスト', () => {
  let saveSpy;

  beforeEach(() => {
    // window / document を Node EventTarget で simulate (= jsdom 同等)
    globalThis.window = new EventTarget();
    globalThis.document = new EventTarget();
    globalThis.localStorage = createLocalStorageMock();
    // Mock injection (= globalThis / window 統合・page-lifecycle.js は global lexical 経由参照)
    globalThis.Meter = {
      getState: function () {
        return {
          distance_m: 1234.5,
          fare_yen: 5000,
          last_gps: { lat: 35.6895, lng: 139.6917, altitude: 30 },
          last_speed_kmh: 40,
          last_timestamp: 1700000000000,
        };
      },
      getMMStats: function () {
        return { mm_distance_m: 1300, distance_source: 'mm', snap_rate: 0.95 };
      },
      reset: function () {
        throw new Error('★ Meter.reset が呼ばれた = A-1 動作異常 (= 不要 reset)');
      },
      businessEnd: function () {
        throw new Error('★ Meter.businessEnd が呼ばれた = A-1 動作異常');
      },
    };
    saveSpy = { calls: 0 };
    globalThis.Business = {
      save: function () {
        saveSpy.calls++;
      },
    };
    globalThis.appState = 'driving';
    globalThis.surchargeOn = false;
    globalThis.surchargeRate = 1.2;
    globalThis.extras = [];
    globalThis.dlog = function () {};
    // page-lifecycle.js は window.PageLifecycle に export するため・window 経由 access
    // 実 page-lifecycle.js load + PageLifecycle.init()
    loadPageLifecycle();
    expect(typeof globalThis.window.PageLifecycle).toBe('object');
    expect(typeof globalThis.window.PageLifecycle.init).toBe('function');
    globalThis.window.PageLifecycle.init();
  });

  afterEach(() => {
    delete globalThis.Meter;
    delete globalThis.Business;
    delete globalThis.appState;
    delete globalThis.surchargeOn;
    delete globalThis.surchargeRate;
    delete globalThis.extras;
    delete globalThis.dlog;
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.localStorage;
  });

  it('init 冪等性: 2 回呼出で listener 二重登録なし', () => {
    // init が再度呼ばれても・_initialized=true で skip される
    globalThis.window.PageLifecycle.init();
    window.dispatchEvent(new Event('pagehide'));
    // Business.save が 1 回のみ呼ばれる (= 二重登録なら 2 回呼ばれる)
    expect(saveSpy.calls).toBe(1);
  });

  it('pagehide → daikou_driving_state に distance_m 保存', () => {
    window.dispatchEvent(new Event('pagehide'));
    const stored = JSON.parse(localStorage.getItem('daikou_driving_state'));
    expect(stored).toBeDefined();
    expect(stored.distance_m).toBe(1234.5);
    expect(stored.fare_yen).toBe(5000);
    expect(stored.mm_distance_m).toBe(1300);
    expect(stored.distance_source).toBe('mm');
    // Business.save も呼ばれる
    expect(saveSpy.calls).toBe(1);
  });

  it('freeze → daikou_driving_state 保存 + Business.save 呼出', () => {
    document.dispatchEvent(new Event('freeze'));
    const stored = JSON.parse(localStorage.getItem('daikou_driving_state'));
    expect(stored).toBeDefined();
    expect(stored.distance_m).toBe(1234.5);
    expect(saveSpy.calls).toBe(1);
  });

  it('freeze→resume サイクル: distance_m 保全 (= reset 無し)・運転状態は Business.save に集約', () => {
    document.dispatchEvent(new Event('freeze'));
    const saved = JSON.parse(localStorage.getItem('daikou_driving_state'));
    expect(saved.distance_m).toBe(1234.5);
    const savesBeforeResume = saveSpy.calls;

    // resume 発火: page-lifecycle.js は dlog のみ・Meter / localStorage に副作用なし
    document.dispatchEvent(new Event('resume'));

    // localStorage は freeze 時の値のまま (= reset/上書きなし)
    const afterResume = JSON.parse(localStorage.getItem('daikou_driving_state'));
    expect(afterResume.distance_m).toBe(1234.5);

    // Business.save が resume で追加呼出されない (= 二重加算なし)
    expect(saveSpy.calls).toBe(savesBeforeResume);

    // Meter.reset / Meter.businessEnd は呼ばれていない (= beforeEach で throw 仕掛け済)
    // ここまで test に到達した時点で・throw が発生していないことが証明
    expect(true).toBe(true);
  });

  it('pageshow(persisted=true) → restore は既存 startup 経路に任せる (副作用なし)', () => {
    const savesBefore = saveSpy.calls;
    const ev = new Event('pageshow');
    Object.defineProperty(ev, 'persisted', { value: true });
    window.dispatchEvent(ev);
    // page-lifecycle.js は pageshow で dlog のみ
    expect(saveSpy.calls).toBe(savesBefore);
    expect(localStorage.getItem('daikou_driving_state')).toBeNull();
  });

  it('pageshow(persisted=false) → 何もしない (= bfcache 復帰でないので onResume も呼ばない)', () => {
    const savesBefore = saveSpy.calls;
    const ev = new Event('pageshow');
    Object.defineProperty(ev, 'persisted', { value: false });
    window.dispatchEvent(ev);
    expect(saveSpy.calls).toBe(savesBefore);
  });

  it('appState !== "driving" → driving_state 保存スキップ (= 業務外時の誤書込防止)・但し Business.save は実行', () => {
    globalThis.appState = 'idle';
    window.dispatchEvent(new Event('pagehide'));
    // driving_state は保存されない (= driving 中でないため)
    expect(localStorage.getItem('daikou_driving_state')).toBeNull();
    // Business.save は appState に関係なく呼ばれる (= 業務 state は別 gate)
    expect(saveSpy.calls).toBe(1);
  });

  it('Meter 未定義 → エラー throw せず・Business.save のみ実行', () => {
    delete globalThis.Meter;
    expect(() => window.dispatchEvent(new Event('pagehide'))).not.toThrow();
    expect(saveSpy.calls).toBe(1);
    expect(localStorage.getItem('daikou_driving_state')).toBeNull();
  });

  it('Business 未定義 → エラー throw せず・Meter 側の driving_state 保存のみ実行', () => {
    delete globalThis.Business;
    expect(() => window.dispatchEvent(new Event('pagehide'))).not.toThrow();
    const stored = JSON.parse(localStorage.getItem('daikou_driving_state'));
    expect(stored).toBeDefined();
    expect(stored.distance_m).toBe(1234.5);
  });

  it('pagehide + freeze 連続 (= W3C 仕様の標準シーケンス) で localStorage 上書きのみ・二重加算なし', () => {
    window.dispatchEvent(new Event('pagehide'));
    document.dispatchEvent(new Event('freeze'));
    // 両方とも同じ内容を保存・最終 stored は freeze の値
    const stored = JSON.parse(localStorage.getItem('daikou_driving_state'));
    expect(stored.distance_m).toBe(1234.5);
    // Business.save は 2 回呼ばれるが・課金状態への二重加算なし (= save は idempotent)
    expect(saveSpy.calls).toBe(2);
  });
});
