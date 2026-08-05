'use strict';
// ============================================================
// ★画面にUUIDを出さない（全画面）2026-08-04★
//
//   ★司さん「売上1の横の英語のやつ邪魔でしょうがない」★
//     給料明細に 売上1(7e1919ef-4aaa-411e-8db0-ba0424…) と出ていた。
//     指示役の実測: ★dk_device_labels = 0件★ なので端末ID(UUID)がそのまま出ていた。
//
//   出る所を全部見る: ★給料明細 / 売上表 / 月次集計 / 会社の設定★
//   1つでも漏らすと、そこだけ英語の羅列が残る。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CN = require(path.join(ROOT, 'js', 'car-name.js'));

const SCREENS = ['kyuryo.html', 'uriage.html', 'shukei.html', 'dashboard.html'];
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('★名前を決める所が1箇所だけであること★', () => {
  it('js/car-name.js が在る', () => {
    expect(fs.existsSync(path.join(ROOT, 'js', 'car-name.js'))).toBe(true);
  });

  it('事務所の画面が読み込んでいる', () => {
    ['kyuryo.html', 'uriage.html', 'shukei.html'].forEach(function (f) {
      expect(read(f), f + ' が car-name.js を読んでいない').toContain('src="js/car-name.js"');
    });
  });

  it('★使う側より先に読み込む★', () => {
    ['kyuryo.html', 'uriage.html', 'shukei.html'].forEach(function (f) {
      const t = read(f);
      const cn = t.indexOf('src="js/car-name.js"');
      const ua = t.indexOf('src="js/uriage-agg.js"');
      expect(cn, f).toBeGreaterThan(-1);
      expect(cn, f + ': car-name.js が uriage-agg.js より後にある').toBeLessThan(ua);
    });
  });
});

// ============================================================
// ★2026-08-05 テストの見方を変えた（同じ漏れを2回やったため）★
//
//   1回目: kyuryo.html の車の行だけ直した → ★給料明細の「売上1（UUID）」が残っていた★
//   司さん「消してないやないかぼけ」
//
//   ★なぜ漏れたか★
//     テストが「私が直した1箇所」を名指しで見ていたので、
//     ★直していない別の経路を見ていなかった★。
//   ⇒ 名指しをやめ、★「名前を作っている所」を全部見つけて、どれも UUID を出さない★
//     という見方にする。新しい経路が増えても自動で引っかかる。
// ============================================================
describe('★名前を作っている所を全部見る（名指しをやめる）★', () => {
  const SOURCES = ['js/payroll-daily.js', 'js/uriage-agg.js', 'kyuryo.html', 'uriage.html'];

  it('★「名前が無ければ端末ID」と書いている所が1つも無い★', () => {
    // labels[x] || x   /  labels[dev] || dev   のような「端末IDに落とす」書き方を全部探す
    const offenders = [];
    SOURCES.forEach(function (f) {
      const t = read(f);
      const re = /\|\|\s*(dev|d|deviceId|device_id|s\.device_id)\s*[,;)\n]/g;
      let m;
      while ((m = re.exec(t))) {
        const line = t.slice(0, m.index).split('\n').length;
        offenders.push(f + ':' + line + '  ' + m[0].trim());
      }
    });
    expect(offenders, '★名前が無い時に端末IDを出している★').toEqual([]);
  });

  it('★短縮UUIDに落とす書き方も無い★', () => {
    const offenders = [];
    SOURCES.forEach(function (f) {
      const t = read(f);
      if (/\|\|\s*shortId\(/.test(t)) offenders.push(f);
    });
    expect(offenders, '★7e1919ef… のような短縮UUIDを名前にしている★').toEqual([]);
  });

  it('名前を決める道具を通していること', () => {
    ['js/payroll-daily.js', 'js/uriage-agg.js'].forEach(function (f) {
      expect(read(f), f + ' が名前を自分で決めている').toMatch(/CarName|_carLabels/);
    });
  });
});

describe('★端末IDをそのまま画面に出していないこと★', () => {
  it('給料明細が device_id をそのまま名前にしていない', () => {
    const t = read('kyuryo.html');
    expect(t, '★名前が無い時にUUIDを出している（司さんが見た形）★').not.toContain(
      'CTX.labels[s.device_id] ? CTX.labels[s.device_id] : s.device_id'
    );
    expect(t, '車の名前を決める道具を使っていない').toContain('_carName(');
  });

  it('売上表の集計が短縮UUIDを名前にしていない', () => {
    const t = read('js/uriage-agg.js');
    expect(t, '★7e1919ef… のような短縮UUIDを名前にしている★').not.toContain(
      'label: labelById[dev] || shortId(dev)'
    );
  });

  it('★どの画面も device_id を「表示される文字」に直接入れていない★', () => {
    // data-* 属性（機械が使う）は良い。画面に出る所（>…< の中）に入れるのが駄目。
    const offenders = [];
    SCREENS.forEach(function (f) {
      const t = read(f);
      // '>' + esc(x.device_id) + '<'  のような形を探す
      const re = />'\s*\+\s*\w*esc\(\s*\w+\.device_id\s*\)/g;
      if (re.test(t)) offenders.push(f);
    });
    expect(offenders, '★画面に出る所に端末IDを入れている★').toEqual([]);
  });
});

describe('★名前が無い時は短い仮名（UUIDではない）★', () => {
  const A = '7e1919ef-4aaa-411e-8db0-ba0424111111';
  const B = 'f3527369-bbbb-411e-8db0-ba0424222222';

  it('「車1」「車2」が出る', () => {
    const m = CN.nameMap([A, B], []);
    expect(Object.values(m).sort()).toEqual(['車1', '車2']);
  });

  it('★出す名前にUUIDが含まれない★', () => {
    const m = CN.nameMap([A, B], []);
    Object.keys(m).forEach(function (k) {
      expect(CN.hasUuid(m[k]), '★UUIDが画面に出る★').toBe(false);
    });
  });

  it('★短縮UUID(8文字+…)も名前にしない★（英語の羅列であることに変わりない）', () => {
    const m = CN.nameMap([A, B], []);
    Object.keys(m).forEach(function (k) {
      expect(m[k], '短縮UUIDを名前にしている').not.toMatch(/^[0-9a-f]{8}/);
    });
  });
});

describe('★司さんの呼び方が出ること★', () => {
  it('4987 / 1466 / 1173 がそのまま出る', () => {
    const ids = [
      '7e1919ef-4aaa-411e-8db0-ba0424111111',
      'f3527369-bbbb-411e-8db0-ba0424222222',
      '22849fdb-cccc-411e-8db0-ba0424333333',
    ];
    const m = CN.nameMap(ids, [
      { device_id: ids[0], label: '4987' },
      { device_id: ids[1], label: '1466' },
      { device_id: ids[2], label: '1173' },
    ]);
    expect([m[ids[0]], m[ids[1]], m[ids[2]]]).toEqual(['4987', '1466', '1173']);
  });
});

// ★出る文字そのものを見る（コードの形だけでは足りなかった）★
describe('★給料明細に出る名前に UUID が混ざらないこと★', () => {
  const PD = require(path.join(ROOT, 'js', 'payroll-daily.js'));
  const A = '7e1919ef-4aaa-411e-8db0-ba0424111111';
  const B = '22849fdb-cde7-4f1d-afc7-47009a6222222';
  const C = 'f3527369-9df3-47c4-93a8-b6e532a333333';

  function ctx(labels) {
    return {
      devices: [A, B, C],
      labels: labels || {},
      settings: { ownerDeviceId: '' },
      byDate: {},
    };
  }

  it('★名前が無くても「売上1（車1）」になる（UUIDが出ない）★', () => {
    const cars = PD.carsOf(ctx());
    expect(cars.length).toBe(3);
    cars.forEach(function (c, i) {
      const shown = '売上' + (i + 1) + '（' + c.label + '）';
      expect(CN.hasUuid(shown), '★' + shown + '★').toBe(false);
      expect(c.label).toMatch(/^車\d+$/);
    });
  });

  it('名前を付ければ その名前が出る', () => {
    const cars = PD.carsOf(ctx({ [A]: '4987', [B]: '1173', [C]: '1466' }));
    const names = cars.map((c) => c.label).sort();
    expect(names).toEqual(['1173', '1466', '4987']);
  });

  it('★一部だけ名前が付いていても、残りはUUIDにならない★', () => {
    const cars = PD.carsOf(ctx({ [A]: '4987' }));
    cars.forEach(function (c) {
      expect(CN.hasUuid(c.label), '★' + c.label + '★').toBe(false);
    });
    expect(cars.map((c) => c.label)).toContain('4987');
  });

  it('★1日ぶんの明細でもUUIDが出ない★', () => {
    const c = ctx();
    c.byDate['2026-08-04'] = {
      [A]: { sales: 19600, expense: 0, hours: 8 },
      [B]: { sales: 24300, expense: 0, hours: 9 },
    };
    const day = PD.dayInput('2026-08-04', c);
    day.cars.forEach(function (car) {
      expect(CN.hasUuid(car.label), '★' + car.label + '★').toBe(false);
      expect(car.label).not.toMatch(/^[0-9a-f]{8}/);
    });
  });
});

describe('★名前を付ける画面が事務所にあること★', () => {
  it('売上表に名前の入力欄がある', () => {
    const t = read('uriage.html');
    expect(t).toContain('class="carname"');
    expect(t).toContain('placeholder="車の名前"');
  });

  it('付けた名前が保存される', () => {
    expect(read('uriage.html')).toContain('dk_device_labels?on_conflict=company_id,device_id');
  });

  it('★メーター側には名前を付ける画面を出さない★（社長が付ける物）', () => {
    expect(read('index.html')).not.toContain('dk_device_labels');
  });
});
