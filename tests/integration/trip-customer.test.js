'use strict';
// ============================================================
// 代行への「請求書払い(掛け)先」の紐付け テスト (2026-07-31)
//
//   司さんの要件:
//     「請求書マスタを作って、実車中の値引ボタンや追加料金ボタンのところに請求書ボタンを作って、
//       会社名を選んだら勝手にデータとして残るようにしたい」
//
//   ★なぜ現場(実車中)で選ぶのが正しいか★
//     その客が「◯◯商事の掛け」だと分かるのは、その場にいるドライバーだけ。
//     後から事務所で突き合わせるのは不可能に近い。だから代行中に1タップで紐付ける。
//
//   ★このテストが守る性質★
//     1. 選んだ会社が、その代行(trip)に確実に残る
//     2. 選ばなければ現金扱い(payment_type='cash')
//     3. 選び直し・取り消しができる
//     4. ★何をしても業務が止まらない(throwしない)★
//     5. 会社名は「その時の名前」を焼き付ける(後でマスタから消えても請求書が壊れない)
// ============================================================
const fs = require('fs');
const path = require('path');

const BUSINESS_JS_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'js', 'business.js'),
  'utf8'
);

function makeLocalStorage() {
  const store = Object.create(null);
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    key: (i) => Object.keys(store)[i] || null,
    get length() {
      return Object.keys(store).length;
    },
  };
}

function makeMeterMock() {
  let dist = 0;
  let bizDist = 0;
  return {
    getState: () => ({ distance_m: dist, business_distance_m: bizDist, running: false }),
    setDistance: (v) => {
      dist = v;
    },
    setBusinessDistance: (v) => {
      bizDist = v;
    },
  };
}

function loadBusiness() {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.Meter = makeMeterMock();
  sandbox.localStorage = makeLocalStorage();
  sandbox.dlog = () => {};
  sandbox.console = console;
  const fn = new Function(
    'window',
    'Meter',
    'localStorage',
    'dlog',
    'console',
    BUSINESS_JS_SOURCE + '\n;return window.Business;'
  );
  return fn(sandbox, sandbox.Meter, sandbox.localStorage, sandbox.dlog, sandbox.console);
}

describe('実車中に請求書(掛け)先を選ぶ', () => {
  let Business;
  beforeEach(() => {
    Business = loadBusiness();
    Business.start();
    Business.onTripStart(33.8, 132.7, 10);
  });

  it('★選んだ会社が、その代行に残る★', () => {
    Business.setTripCustomer('cust-1', '○○商事');
    Business.onTripEnd(3000, 4500);
    const t = Business.getState().trips[0];
    expect(t.customer_id).toBe('cust-1');
    expect(t.customer_name).toBe('○○商事');
    expect(t.payment_type).toBe('invoice');
  });

  it('選ばなければ現金扱い', () => {
    Business.onTripEnd(3000, 4500);
    const t = Business.getState().trips[0];
    expect(t.customer_id).toBeNull();
    expect(t.payment_type).toBe('cash');
  });

  it('選び直せる(最後に選んだ会社が残る)', () => {
    Business.setTripCustomer('cust-1', '○○商事');
    Business.setTripCustomer('cust-2', '△△建設');
    Business.onTripEnd(3000, 4500);
    const t = Business.getState().trips[0];
    expect(t.customer_id).toBe('cust-2');
    expect(t.customer_name).toBe('△△建設');
  });

  it('取り消せる(現金に戻る)', () => {
    Business.setTripCustomer('cust-1', '○○商事');
    Business.setTripCustomer(null);
    Business.onTripEnd(3000, 4500);
    const t = Business.getState().trips[0];
    expect(t.customer_id).toBeNull();
    expect(t.payment_type).toBe('cash');
  });

  it('今なんの掛けが選ばれているか読める(画面表示用)', () => {
    expect(Business.getTripCustomer()).toBeNull();
    Business.setTripCustomer('cust-1', '○○商事');
    // ★2026-08-05 「誰が乗ったか」を足した★
    //   藤原建設のように請求書を会長/社長/専務で分ける会社があるため。
    //   分け方を使わない会社では null（＝今までどおり）。
    expect(Business.getTripCustomer()).toEqual({
      customer_id: 'cust-1',
      customer_name: '○○商事',
      customer_note: null,
    });
  });

  it('次の代行に持ち越さない(前の客の掛けが次に付いたら事故)', () => {
    Business.setTripCustomer('cust-1', '○○商事');
    Business.onTripEnd(3000, 4500);
    Business.onTripStart(33.8, 132.7, 10);
    Business.onTripEnd(2000, 3000);
    const trips = Business.getState().trips;
    expect(trips[0].customer_id).toBe('cust-1');
    expect(trips[1].customer_id).toBeNull();
    expect(trips[1].payment_type).toBe('cash');
  });

  it('★代行が始まっていない時に押しても落ちない(業務を止めない)★', () => {
    const B2 = loadBusiness();
    B2.start();
    expect(() => B2.setTripCustomer('cust-1', '○○商事')).not.toThrow();
    expect(() => B2.getTripCustomer()).not.toThrow();
  });

  it('★おかしな値を渡しても落ちない★', () => {
    expect(() => Business.setTripCustomer({}, [])).not.toThrow();
    expect(() => Business.setTripCustomer(undefined, undefined)).not.toThrow();
    Business.onTripEnd(1000, 1000);
    expect(Business.getState().trips[0].payment_type).toBe('cash');
  });

  it('★距離と料金には一切影響しない★', () => {
    Business.setTripCustomer('cust-1', '○○商事');
    Business.onTripEnd(3210, 4560);
    const t = Business.getState().trips[0];
    expect(t.distance_m).toBe(3210);
    expect(t.fare_yen).toBe(4560);
  });
});

describe('job-sync が掛け先も運ぶ', () => {
  const JobSync = require('../../js/job-sync.js');

  it('掛け先が送信データに乗る', () => {
    const p = JobSync.toPayload({
      start_time: 1000,
      trips: [
        {
          distance_m: 100,
          fare_yen: 2000,
          start_time: 1,
          end_time: 2,
          customer_id: 'cust-1',
          customer_name: '○○商事',
          payment_type: 'invoice',
        },
      ],
    });
    expect(p.trips[0].customer_id).toBe('cust-1');
    expect(p.trips[0].customer_name).toBe('○○商事');
    expect(p.trips[0].payment_type).toBe('invoice');
  });

  it('掛け先が無い代行は現金として送る', () => {
    const p = JobSync.toPayload({
      start_time: 1000,
      trips: [{ distance_m: 100, fare_yen: 2000, start_time: 1, end_time: 2 }],
    });
    expect(p.trips[0].customer_id).toBe(null);
    expect(p.trips[0].payment_type).toBe('cash');
  });

  it('おかしな支払区分は現金に倒す(倉庫に変な値を入れない)', () => {
    const p = JobSync.toPayload({
      start_time: 1000,
      trips: [{ distance_m: 100, fare_yen: 2000, payment_type: 'あやしい' }],
    });
    expect(p.trips[0].payment_type).toBe('cash');
  });
});
