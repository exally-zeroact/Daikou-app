'use strict';
// ============================================================
// ★会社が変わったら、前の会社の勤務を新しい会社に送らないこと 2026-08-03★
//
//   ★司さんの報告から見つかった（実際に起きるところだった）★
//     従業員の予備スマホをテストで使い、そのまま本番用に登録しようとしていた。
//     その端末には テスト時の勤務が daikou_business_history に30日ぶん残っている。
//
//     ところが送る勤務の選び方(selectUnsynced)は
//     ★「まだ送っていないか」しか見ておらず、どの会社の物かを見ていなかった★。
//     本番の dk_shifts は 0件＝テスト分は一度もクラウドに上がっていない
//     ＝全部「未送信」のまま残っている。
//     → 本番のQRを読んだ瞬間、★テストで走った分が ZERO代行の売上に上がる★。
//        しかも売上表には普通の1件として出るので、見ただけでは気づけない。
//
//   ★入れる決まり★
//     ・会社が「無い → ある」(はじめての活性化) … ★切り離さない★
//       従業員は活性化する前から本番のメーターで実際に働いている。
//       その働きはその会社の物なので、捨ててはいけない（30日で消える前に拾うのが目的）。
//     ・会社が「A → B」に変わった … ★切り離す★
//       Aのために走った分をBに請求してはいけない。
// ============================================================
const path = require('path');

const JS = require(path.resolve(__dirname, '..', '..', 'js', 'job-sync.js'));

// 端末の保存場所を偽物で作る
function store(init) {
  const m = Object.assign({}, init || {});
  return {
    getItem: function (k) {
      return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null;
    },
    setItem: function (k, v) {
      m[k] = String(v);
    },
    removeItem: function (k) {
      delete m[k];
    },
    _dump: function () {
      return m;
    },
  };
}

const shift = (t) => ({ start_time: t, trips: [] });

describe('★会社が変わったら 前の会社の勤務を送らない★', () => {
  it('道具がある（無ければ守れていない）', () => {
    expect(typeof JS.sealForCompanySwitch, 'sealForCompanySwitch が無い').toBe('function');
  });

  it('★A社 → B社 に変わったら、それまでの勤務は送らない★', () => {
    const s = store({
      daikou_business_history: JSON.stringify([shift(100), shift(200)]),
      dk_synced_shifts: JSON.stringify([]),
      dk_sync_company: 'AAA', // 前はA社だった
    });
    const r = JS.sealForCompanySwitch(s, 'BBB');
    expect(r.sealed, '切り離していない').toBe(2);

    const synced = JSON.parse(s.getItem('dk_synced_shifts'));
    const left = JS.selectUnsynced(JSON.parse(s.getItem('daikou_business_history')), synced);
    expect(left, '前の会社の勤務が残っている＝新しい会社に上がる').toEqual([]);
  });

  it('★はじめての活性化（会社が無い → ある）では切り離さない★', () => {
    // 従業員は活性化する前から本番のメーターで働いている。その分は拾わないといけない。
    const s = store({
      daikou_business_history: JSON.stringify([shift(100), shift(200)]),
      dk_synced_shifts: JSON.stringify([]),
      // dk_sync_company は無い
    });
    const r = JS.sealForCompanySwitch(s, 'BBB');
    expect(r.sealed, '働いた分を捨ててしまっている').toBe(0);

    const left = JS.selectUnsynced(
      JSON.parse(s.getItem('daikou_business_history')),
      JSON.parse(s.getItem('dk_synced_shifts'))
    );
    expect(left.length, 'はじめての活性化なのに送れなくなっている').toBe(2);
  });

  it('同じ会社のままなら何もしない（毎回切り離したら永久に送れない）', () => {
    const s = store({
      daikou_business_history: JSON.stringify([shift(100)]),
      dk_synced_shifts: JSON.stringify([]),
      dk_sync_company: 'AAA',
    });
    const r = JS.sealForCompanySwitch(s, 'AAA');
    expect(r.sealed).toBe(0);
    expect(r.changed).toBe(false);
  });

  it('切り離したあと、今の会社を覚える（次から切り離さない）', () => {
    const s = store({
      daikou_business_history: JSON.stringify([shift(100)]),
      dk_synced_shifts: JSON.stringify([]),
      dk_sync_company: 'AAA',
    });
    JS.sealForCompanySwitch(s, 'BBB');
    expect(s.getItem('dk_sync_company')).toBe('BBB');
    // 2回目は何もしない
    expect(JS.sealForCompanySwitch(s, 'BBB').sealed).toBe(0);
  });

  it('★切り離しても、これから走る分は送れる★', () => {
    const s = store({
      daikou_business_history: JSON.stringify([shift(100)]),
      dk_synced_shifts: JSON.stringify([]),
      dk_sync_company: 'AAA',
    });
    JS.sealForCompanySwitch(s, 'BBB');
    // 切り替えた後に走った勤務
    const after = [shift(100), shift(999)];
    const left = JS.selectUnsynced(after, JSON.parse(s.getItem('dk_synced_shifts')));
    expect(
      left.map((x) => x.start_time),
      '新しい会社の分が送れない'
    ).toEqual([999]);
  });

  it('履歴が壊れていても落ちない（業務を止めない）', () => {
    const s = store({
      daikou_business_history: 'こわれている',
      dk_synced_shifts: 'こわれている',
      dk_sync_company: 'AAA',
    });
    expect(function () {
      JS.sealForCompanySwitch(s, 'BBB');
    }).not.toThrow();
  });

  it('保存できない端末でも落ちない', () => {
    const s = {
      getItem: function () {
        throw new Error('だめ');
      },
      setItem: function () {
        throw new Error('だめ');
      },
    };
    expect(function () {
      JS.sealForCompanySwitch(s, 'BBB');
    }).not.toThrow();
  });
});

// ============================================================
// ★既に動いている端末のための引き継ぎ（穴を1つ塞いだ）★
//   dk_sync_company は今日足した新しい記録なので、
//   ★今動いている端末には全部「無い」★。すると切り離しから見て
//   どれも「はじめての活性化」に見え、★切り離しが効かない★。
//   ＝テストで使った端末が本番のQRを読んでも、古い勤務がそのまま上がってしまう。
//   → 起動時に一度だけ、今の会社を写しておく。
// ============================================================
describe('★既に動いている端末でも切り離しが効くこと★', () => {
  it('テストで活性化済みの端末は、今の会社を控える', () => {
    const s = store({ dk_license_company: 'TEST_CO' });
    expect(JS.adoptCurrentCompanyOnce(s)).toBe(true);
    expect(s.getItem('dk_sync_company')).toBe('TEST_CO');
  });

  it('★控えたあと本番へ切り替わると、ちゃんと切り離される★（これが穴だった）', () => {
    const s = store({
      dk_license_company: 'TEST_CO',
      daikou_business_history: JSON.stringify([shift(100), shift(200)]),
      dk_synced_shifts: JSON.stringify([]),
    });
    JS.adoptCurrentCompanyOnce(s); // 起動時
    const r = JS.sealForCompanySwitch(s, 'ZERO_CO'); // QRを読んで本番へ
    expect(r.sealed, 'テストの勤務が本番の売上に上がってしまう').toBe(2);
  });

  it('★一度も活性化していない端末では何もしない★（働いた分を捨てない）', () => {
    const s = store({ daikou_business_history: JSON.stringify([shift(100)]) });
    expect(JS.adoptCurrentCompanyOnce(s)).toBe(false);
    expect(s.getItem('dk_sync_company')).toBe(null);
    // その後 はじめて活性化しても切り離されない
    expect(JS.sealForCompanySwitch(s, 'ZERO_CO').sealed).toBe(0);
  });

  it('もう控えてあれば上書きしない', () => {
    const s = store({ dk_license_company: 'B', dk_sync_company: 'A' });
    expect(JS.adoptCurrentCompanyOnce(s)).toBe(false);
    expect(s.getItem('dk_sync_company')).toBe('A');
  });

  it('保存できない端末でも落ちない', () => {
    const s = {
      getItem: function () {
        throw new Error('だめ');
      },
      setItem: function () {
        throw new Error('だめ');
      },
    };
    expect(function () {
      JS.adoptCurrentCompanyOnce(s);
    }).not.toThrow();
  });
});

describe('★作っただけで呼ばれていない、を防ぐ★', () => {
  const fs = require('fs');
  const SRC = fs.readFileSync(path.resolve(__dirname, '..', '..', 'js', 'job-sync.js'), 'utf8');

  it('sync() の中から呼んでいる', () => {
    const i = SRC.indexOf('async function sync()');
    expect(i).toBeGreaterThan(-1);
    const body = SRC.slice(i, i + 1200);
    expect(body, 'sync から呼ばれていない＝守れていない').toContain('sealForCompanySwitch(');
  });

  it('★起動時(init)に、今の会社を控えている★（無いと既存端末で切り離しが効かない）', () => {
    const i = SRC.indexOf('function init()');
    expect(i).toBeGreaterThan(-1);
    const body = SRC.slice(i, i + 900);
    expect(body, 'init から呼ばれていない＝既に動いている端末が守れない').toContain(
      'adoptCurrentCompanyOnce('
    );
  });

  it('★圏外の判定より前に呼んでいる★（圏外でも切り離しは効かせる）', () => {
    const i = SRC.indexOf('async function sync()');
    const body = SRC.slice(i, i + 1200);
    const seal = body.indexOf('sealForCompanySwitch(');
    const online = body.indexOf('_online()');
    expect(seal).toBeGreaterThan(-1);
    expect(online).toBeGreaterThan(-1);
    expect(seal, '圏外だと切り離されず、次に繋がった時に上がってしまう').toBeLessThan(online);
  });
});

describe('★距離と料金は運ぶだけ（この変更で1円も動かない）★', () => {
  it('切り離しは履歴を書き換えない（読むだけ）', () => {
    const hist = [shift(100), shift(200)];
    const s = store({
      daikou_business_history: JSON.stringify(hist),
      dk_synced_shifts: JSON.stringify([]),
      dk_sync_company: 'AAA',
    });
    JS.sealForCompanySwitch(s, 'BBB');
    expect(JSON.parse(s.getItem('daikou_business_history'))).toEqual(hist);
  });
});
