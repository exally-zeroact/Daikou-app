'use strict';
// ============================================================
// ★ぜんぶオフラインで2晩続けて働いた時 2026-08-05★
//
//   ★司さんの問い★
//     「従業員が全てオフラインで業務終了も次の業務開始もやってしまった場合」
//
//   つまり:
//     1日目 業務開始(圏外) → 走る → 業務終了(圏外)   ← 送れない
//     2日目 業務開始(圏外) → 走る → 業務終了(圏外)   ← 送れない
//     そのあと電波の入る所へ                        ← ここで2晩ぶん上がるはず
//
//   ★ここが崩れると、1晩まるごと消えるか、二重に請求が立つ★。
//   代行は夜の仕事で圏外が当たり前なので、★これが通らないと話にならない★。
// ============================================================
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BJS = path.join(ROOT, 'js', 'business.js');
const JS = require(path.join(ROOT, 'js', 'job-sync.js'));

function makeStorage() {
  const m = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null),
    setItem: (k, v) => {
      m[k] = String(v);
    },
    removeItem: (k) => {
      delete m[k];
    },
    _dump: () => m,
  };
}

function makeMeter() {
  const s = {
    running: false,
    billing_frozen: false,
    business_active: false,
    distance_m: 0,
    business_distance_m: 0,
    business_display_distance_m: 0,
    business_tier2_pending_m: 0,
  };
  return {
    getState: () => s,
    setBusinessActive: (v) => {
      s.business_active = !!v;
    },
    setBusinessDistance: (v) => {
      s.business_distance_m = v;
      s.business_display_distance_m = v;
    },
    drive: (m) => {
      if (s.business_active && !s.billing_frozen) {
        s.business_distance_m += m;
        s.business_display_distance_m = s.business_distance_m;
        s.distance_m += m;
      }
    },
    reboot: () => {
      s.business_distance_m = 0;
      s.business_display_distance_m = 0;
      s.distance_m = 0;
      s.business_active = false;
    },
  };
}

function loadBusiness(storage, meter) {
  global.localStorage = storage;
  global.Meter = meter;
  delete require.cache[require.resolve(BJS)];
  return require(BJS);
}
const hist = (s) => {
  try {
    return JSON.parse(s.getItem('daikou_business_history') || '[]');
  } catch (_) {
    return [];
  }
};

// 1晩ぶん働く（ぜんぶ圏外）
//   ★勤務の見分けは start_time（ミリ秒）1つ★なので、
//   同じミリ秒で2晩始めると同じ勤務に見えてしまう。
//   実際の夜勤は日をまたぐので起こらないが、テストでは必ず時刻をずらす。
function workOneNight(B, meter, meters) {
  const t0 = Date.now();
  while (Date.now() === t0) {
    /* 1ミリ秒ずらす（同じ start_time にしない） */
  }
  B.start();
  for (let i = 0; i < 10; i++) {
    meter.drive(meters / 10);
    B.onGps({ lat: 34, lng: 133, t: Date.now() + i * 1000 });
  }
  B.end(); // ★圏外なので送れない。端末に積むだけ★
}

describe('★ぜんぶオフラインで2晩続けて働いた時★', () => {
  it('★2晩ぶんが端末に残る（1晩も消えない）★', () => {
    const s = makeStorage();
    const m = makeMeter();
    const B = loadBusiness(s, m);

    workOneNight(B, m, 123480); // 1晩目 123.48km
    expect(hist(s).length, '1晩目が積まれていない').toBe(1);

    workOneNight(B, m, 64650); // 2晩目 64.65km
    expect(hist(s).length, '★2晩目で1晩目が消えた／二重になった★').toBe(2);

    const km = hist(s)
      .map((h) => Math.round(h.total_distance_m))
      .sort((a, b) => a - b);
    expect(km, '★距離が混ざっている★').toEqual([64650, 123480]);
  });

  it('★2晩とも「まだ送っていない」として拾える★', () => {
    const s = makeStorage();
    const m = makeMeter();
    const B = loadBusiness(s, m);
    workOneNight(B, m, 123480);
    workOneNight(B, m, 64650);

    const targets = JS.selectUnsynced(hist(s), []);
    expect(targets.length, '★電波が入っても1晩ぶんしか上がらない★').toBe(2);
    // 古い順（先に働いた晩が先に上がる）
    expect(targets[0].total_distance_m).toBeCloseTo(123480, 0);
    expect(targets[1].total_distance_m).toBeCloseTo(64650, 0);
  });

  it('★2日目の業務開始で、1日目が二重に積まれないこと★', () => {
    const s = makeStorage();
    const m = makeMeter();
    const B = loadBusiness(s, m);
    workOneNight(B, m, 123480);
    // 2日目の業務開始（この中で abandon() が走る）
    B.start();
    expect(hist(s).length, '★同じ晩が2件になった＝二重請求の芽★').toBe(1);
  });

  it('★間でアプリを閉じて開き直しても、2晩ぶん残る★', () => {
    const s = makeStorage();
    const m = makeMeter();
    let B = loadBusiness(s, m);
    workOneNight(B, m, 123480);

    // 1晩目のあと、アプリを閉じて次の日に開き直す
    m.reboot();
    B = loadBusiness(s, m);
    B.load();

    workOneNight(B, m, 64650);
    expect(hist(s).length).toBe(2);
    expect(JS.selectUnsynced(hist(s), []).length).toBe(2);
  });

  it('★3晩でも4晩でも溜まる（ずっと圏外でも消えない）★', () => {
    const s = makeStorage();
    const m = makeMeter();
    const B = loadBusiness(s, m);
    for (let n = 1; n <= 4; n++) workOneNight(B, m, 10000 * n);
    expect(hist(s).length).toBe(4);
    expect(JS.selectUnsynced(hist(s), []).length).toBe(4);
  });
});

describe('★電波が入った時に、まとめて上がること★', () => {
  it('2晩ぶんを1回で送り、受け取られた分だけ送信済みになる', () => {
    const s = makeStorage();
    const m = makeMeter();
    const B = loadBusiness(s, m);
    workOneNight(B, m, 123480);
    workOneNight(B, m, 64650);

    const targets = JS.selectUnsynced(hist(s), []);
    const payloads = targets.map(JS.toPayload).filter(Boolean);
    expect(payloads.length).toBe(2);

    // サーバが2件とも受け取った
    const accepted = JS.acceptedKeysOf(
      { ok: true, accepted: payloads.map((p) => p.start_time) },
      payloads
    );
    const synced = JS.mergeSynced([], accepted);
    expect(JS.selectUnsynced(hist(s), synced), '送ったのに残っている').toEqual([]);
  });

  it('★1件だけ受け取られた時、もう1晩は次回また送る★', () => {
    const s = makeStorage();
    const m = makeMeter();
    const B = loadBusiness(s, m);
    workOneNight(B, m, 123480);
    workOneNight(B, m, 64650);

    const targets = JS.selectUnsynced(hist(s), []);
    const payloads = targets.map(JS.toPayload).filter(Boolean);
    const accepted = JS.acceptedKeysOf({ ok: true, accepted: [payloads[0].start_time] }, payloads);
    const synced = JS.mergeSynced([], accepted);
    const left = JS.selectUnsynced(hist(s), synced);
    expect(left.length, '★受け取られなかった晩が消えた★').toBe(1);
    expect(left[0].total_distance_m).toBeCloseTo(64650, 0);
  });
});

describe('★正直に言っておく限界★', () => {
  it('端末が覚えていられるのは30日ぶん', () => {
    const src = require('fs').readFileSync(BJS, 'utf8');
    expect(src).toContain('RETENTION_DAYS = 30');
    // ＝★30日以上ずっと圏外だと、古い晩から消える★。
    //   代行の運用（毎晩どこかで電波に触れる）では当たらないが、限界として残しておく。
  });

  it('1回に送るのは20件まで（残りは次回）', () => {
    expect(JS.MAX_BATCH).toBe(20);
  });
});
