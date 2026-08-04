'use strict';
// ============================================================
// ★控えが「作っただけで呼ばれていない」を防ぐ 2026-08-04★
//
//   js/meter-persist.js の中身が正しくても、呼ばれていなければ
//   ★また閉じた瞬間に距離が消える★。配線を機械で固定する。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const IDX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

describe('★読み込まれていること★', () => {
  it('js/meter-persist.js が在る', () => {
    expect(fs.existsSync(path.join(ROOT, 'js', 'meter-persist.js'))).toBe(true);
  });

  it('index.html が読み込んでいる', () => {
    expect(IDX).toContain('src="js/meter-persist.js"');
  });

  it('★meter.js より後に読み込む★（Meter が居ないと控えが取れない）', () => {
    const m = IDX.indexOf('src="js/meter.js"');
    const p = IDX.indexOf('src="js/meter-persist.js"');
    expect(m).toBeGreaterThan(-1);
    expect(p).toBeGreaterThan(m);
  });
});

describe('★1秒ごとに書いていること★', () => {
  it('GPSのたびに控えを書く（business.js の保存と同じ場所＝同じ間隔）', () => {
    const i = IDX.indexOf('Business.onGps(g);');
    expect(i).toBeGreaterThan(-1);
    const around = IDX.slice(i, i + 900);
    expect(around, '★GPSのたびに控えていない＝閉じたら消える★').toContain('_saveMeterSnapshot()');
  });

  it('_saveMeterSnapshot の中身がある', () => {
    expect(IDX).toContain('function _saveMeterSnapshot()');
    const i = IDX.indexOf('function _saveMeterSnapshot()');
    const body = IDX.slice(i, i + 500);
    expect(body).toContain('MeterPersist.save');
    expect(body).toContain('Meter.getState()');
  });
});

describe('★画面が隠れた瞬間に書くこと（今回の穴）★', () => {
  it('visibilitychange で書く', () => {
    // ★index.html には別用途の visibilitychange も在る★ので、
    //   控えを書いている物だけを狙って探す（最初の1つを見ると別の物を掴む）。
    const all = Array.from(IDX.matchAll(/addEventListener\('visibilitychange'[\s\S]{0,320}/g)).map(
      (m) => m[0]
    );
    expect(all.length, 'visibilitychange が1つも無い').toBeGreaterThan(0);
    const mine = all.filter((s) => s.includes('_saveMeterSnapshot()'));
    expect(mine.length, '★閉じる直前に控えを書いていない＝今回と同じ事故が起きる★').toBe(1);
    expect(mine[0], '隠れた時だけ書く形になっていない').toContain('hidden');
  });

  it('pagehide でも書く（タスクキル・電池切れの直前）', () => {
    expect(IDX).toContain("addEventListener('pagehide', _saveMeterSnapshot)");
  });
});

describe('★起動時に1回だけ戻すこと★', () => {
  it('Business.load() の直後に戻す', () => {
    const i = IDX.indexOf('Business.load();');
    expect(i).toBeGreaterThan(-1);
    const around = IDX.slice(i, i + 600);
    expect(around, '起動時に戻していない＝控えても意味がない').toContain('_restoreMeterSnapshot()');
  });

  it('★戻すのは1箇所だけ（何度も呼ぶと足し込まれる恐れ）★', () => {
    const n = (IDX.match(/_restoreMeterSnapshot\(\)/g) || []).length;
    // 定義1 + 呼び出し1 = 2
    expect(n, '戻す呼び出しが複数ある').toBeLessThanOrEqual(2);
  });

  it('戻す時は必ず上書き（足し算にしない）', () => {
    const i = IDX.indexOf('function _restoreMeterSnapshot()');
    expect(i).toBeGreaterThan(-1);
    const body = IDX.slice(i, i + 1800);
    expect(body).toContain('Meter.setDistance(');
    expect(body).toContain('Meter.setBusinessDistance(');
    expect(body, '★足し算になっている＝二重課金★').not.toMatch(/setDistance\([^)]*\+/);
  });
});

describe('★黙って金額を戻さないこと★', () => {
  it('料金を戻したら画面に出す', () => {
    const i = IDX.indexOf('function _restoreMeterSnapshot()');
    const body = IDX.slice(i, i + 1800);
    expect(body).toContain('r.fare_restored');
    expect(body, '★金額が戻ったのに何も出ない★').toContain('_showToast(r.notice');
  });
});

describe('★控えが取れなくても業務を止めないこと★', () => {
  it('書く方も戻す方も try/catch で囲ってある', () => {
    ['_saveMeterSnapshot', '_restoreMeterSnapshot'].forEach(function (fn) {
      const i = IDX.indexOf('function ' + fn + '()');
      const body = IDX.slice(i, i + (fn === '_saveMeterSnapshot' ? 500 : 1800));
      expect(body, fn + ' が囲われていない').toContain('try {');
      expect(body).toContain('catch');
    });
  });
});

describe('★距離・料金の計算に触っていないこと★', () => {
  it('meter.js に距離を保存する処理を足していない（控えは別ファイル）', () => {
    const meter = fs.readFileSync(path.join(ROOT, 'js', 'meter.js'), 'utf8');
    const hits = meter.match(/setItem\([^)]*\b(distance|fare|business|elapsed)/g) || [];
    expect(hits, 'meter.js に保存処理が混ざっている').toEqual([]);
  });

  it('控えのファイルが料金を計算していない', () => {
    const mp = fs.readFileSync(path.join(ROOT, 'js', 'meter-persist.js'), 'utf8');
    ['calcFare', 'setDistance(', 'Meter.update'].forEach(function (w) {
      expect(mp, '控えが ' + w + ' に触っている').not.toContain(w);
    });
  });
});
