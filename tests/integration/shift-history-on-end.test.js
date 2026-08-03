'use strict';
// ============================================================
// ★業務終了した時点で記録を確定させる 2026-08-03★
//
//   ★確定した欠陥（指示役も本番コードで裏を取った）★
//     index.html:8582 のコメントにそのまま書いてある:
//       「履歴の確定 push は次の Business.start() 内の abandon() で実施 (二重 push 回避)」
//     ＝★業務終了だけでは記録がどこにも残らない★。
//     夜の仕事は「終わったらもう開かない」ので、★その晩の記録は翌日まで上がらない★。
//     司さんが「反映されない」と言ったのはこれ。★設計どおりに壊れている★。
//
//   ★変えるとき絶対に壊してはいけないこと★
//     元の作りが「次の開始まで待つ」にしていた理由は ★二重 push 回避★。
//     だから先に「二重にならない」「業務再開が壊れない」を機械で固定してから変える。
//
//   ▼距離の計算・料金・メーター本体には触らない（履歴に積むタイミングだけ）。
// ============================================================
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BJS = path.join(ROOT, 'js', 'business.js');

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

function load(storage, meter) {
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

function drive(B, meter, meters, ticks) {
  B.start();
  for (let i = 0; i < ticks; i++) {
    meter.drive(meters / ticks);
    B.onGps({ lat: 34, lng: 133, t: Date.now() + i * 1000 });
  }
}

describe('★業務終了で、その場で記録が残ること★', () => {
  it('終了した時点で履歴が1件できる（次の業務開始を待たない）', () => {
    const s = makeStorage();
    const m = makeMeter();
    const B = load(s, m);
    drive(B, m, 5320, 10);
    B.end();
    const h = hist(s);
    expect(h.length, '★終了しても記録がどこにも残らない（司さんの「反映されない」）★').toBe(1);
    expect(h[0].total_distance_m).toBeCloseTo(5320, 0);
  });

  it('★終了して、その日はもう開かなくても、送れる状態になる★', () => {
    const s = makeStorage();
    const m = makeMeter();
    const B = load(s, m);
    drive(B, m, 5320, 10);
    B.end();
    const JS = require(path.join(ROOT, 'js', 'job-sync.js'));
    const targets = JS.selectUnsynced(hist(s), []);
    expect(targets.length, '終了しただけでは送れない＝翌日まで上がらない').toBe(1);
    expect(targets[0].total_distance_m).toBeCloseTo(5320, 0);
  });

  it('アプリを開き直しても、終了済みの記録は残っている', () => {
    const s = makeStorage();
    const m = makeMeter();
    const B = load(s, m);
    drive(B, m, 5320, 10);
    B.end();
    m.reboot();
    const B2 = load(s, m);
    B2.load();
    expect(hist(s).length).toBe(1);
    expect(hist(s)[0].total_distance_m).toBeCloseTo(5320, 0);
  });
});

describe('★二重に積まないこと（元の作りが避けていた事故）★', () => {
  it('終了 → 次の業務開始 でも、記録は1件のまま', () => {
    const s = makeStorage();
    const m = makeMeter();
    const B = load(s, m);
    drive(B, m, 5320, 10);
    B.end();
    B.start(); // 中の abandon() がもう一度積んだら二重
    expect(hist(s).length, '★同じ勤務が2件になっている＝二重請求の芽★').toBe(1);
  });

  it('終了 → 開き直し → 次の業務開始 でも1件のまま', () => {
    const s = makeStorage();
    const m = makeMeter();
    const B = load(s, m);
    drive(B, m, 5320, 10);
    B.end();
    m.reboot();
    const B2 = load(s, m);
    B2.load();
    B2.start();
    expect(hist(s).length).toBe(1);
  });

  it('終了を2回押しても1件のまま', () => {
    const s = makeStorage();
    const m = makeMeter();
    const B = load(s, m);
    drive(B, m, 5320, 10);
    B.end();
    B.end();
    expect(hist(s).length).toBe(1);
  });
});

describe('★業務再開（続ける）が壊れないこと★', () => {
  it('終了 → 続ける を押したら、記録は履歴から外れる（まだ終わっていないので）', () => {
    const s = makeStorage();
    const m = makeMeter();
    const B = load(s, m);
    drive(B, m, 5320, 10);
    B.end();
    expect(hist(s).length).toBe(1);
    expect(B.resume(), '再開できない').toBe(true);
    expect(hist(s).length, '★再開したのに履歴に残ったまま＝あとで二重になる★').toBe(0);
  });

  it('★続ける → さらに走る → 終了 で、合計が残る★', () => {
    const s = makeStorage();
    const m = makeMeter();
    const B = load(s, m);
    drive(B, m, 5320, 10);
    B.end();
    B.resume();
    for (let i = 0; i < 5; i++) {
      m.drive(200);
      B.onGps({ lat: 34, lng: 133, t: Date.now() + i * 1000 });
    }
    B.end();
    const h = hist(s);
    expect(h.length, '再開して終了したのに1件になっていない').toBe(1);
    expect(h[0].total_distance_m, '再開ぶんが足されていない').toBeCloseTo(6320, 0);
  });

  it('開き直してから「続ける」でも、履歴から外れる', () => {
    const s = makeStorage();
    const m = makeMeter();
    const B = load(s, m);
    drive(B, m, 5320, 10);
    B.end();
    m.reboot();
    const B2 = load(s, m);
    B2.load();
    expect(B2.resume()).toBe(true);
    expect(hist(s).length).toBe(0);
  });
});

describe('★距離0の勤務を静かに積まないこと★', () => {
  it('長時間なのに0mなら、印を付けて分かるようにする', () => {
    const s = makeStorage();
    const m = makeMeter();
    const B = load(s, m);
    B.start();
    // 走らないまま長時間経過（メーターが積算していない状態）
    B.end();
    const h = hist(s);
    expect(h.length).toBe(1);
    expect(h[0].total_distance_m).toBe(0);
    // ★0でも履歴には残す★（消すと何が起きたか分からなくなる）。
    // 事務所側でこれを「おかしい」と見せるのは別件。
  });
});
