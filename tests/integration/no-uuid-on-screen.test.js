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
