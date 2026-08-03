'use strict';
// ============================================================
// ★オフライン地図を「今いる県＋隣」だけにする 2026-08-03★
//
//   ★司さんの報告★
//     「設定の最新データを確認するおさな46県で止まる」「完了するまでもくそ遅い」
//
//   ★実測★
//     47都道府県ぶん・合計204MB を落としていた（roads-*.js 47件・最大は北海道11.2MB）。
//     パソコンの回線でも1件2〜2.5秒。携帯のWi-Fiなら1件10〜30秒＝★10〜25分★。
//     司さんが走るのは愛媛（4.4MB・1件）。★残り46県・約200MBは一生使わない。★
// ============================================================
const path = require('path');
const P = require(path.resolve(__dirname, '..', '..', 'js', 'dl-plan.js'));

const ALL47 = Object.keys(P.NEIGHBORS);

describe('★47県ぶんそろっていること（表そのものの健全性）★', () => {
  it('47県ある', () => {
    expect(ALL47.length).toBe(47);
  });

  it('★隣として書いた県名が、47県の中に必ず在る★（綴り間違いを止める）', () => {
    const bad = [];
    ALL47.forEach(function (p) {
      P.NEIGHBORS[p].forEach(function (n) {
        if (ALL47.indexOf(n) < 0) bad.push(p + ' → ' + n);
      });
    });
    expect(bad, '知らない県名が書いてある').toEqual([]);
  });

  it('★隣どうしは両方から見えている★（片側だけだと片道でしか効かない）', () => {
    const bad = [];
    ALL47.forEach(function (p) {
      P.NEIGHBORS[p].forEach(function (n) {
        if (P.NEIGHBORS[n].indexOf(p) < 0)
          bad.push(p + ' は ' + n + ' を隣と書いているが、逆が無い');
      });
    });
    expect(bad).toEqual([]);
  });

  it('自分自身を隣に書いていない', () => {
    ALL47.forEach(function (p) {
      expect(P.NEIGHBORS[p], p).not.toContain(p);
    });
  });
});

describe('★司さんの現場（愛媛）で正しいこと★', () => {
  it('愛媛を選ぶと、愛媛が必ず1番目', () => {
    const plan = P.planFor('ehime');
    expect(plan[0]).toBe('ehime');
  });

  it('★しまなみ海道の広島と、フェリーの大分が入っている★（実際に走る先）', () => {
    const plan = P.planFor('ehime');
    expect(plan, '広島が入っていない＝しまなみを渡ると地図が無い').toContain('hiroshima');
    expect(plan, '大分が入っていない＝フェリーで渡ると地図が無い').toContain('oita');
  });

  it('四国3県が入っている', () => {
    const plan = P.planFor('ehime');
    ['kagawa', 'tokushima', 'kochi'].forEach(function (p) {
      expect(plan).toContain(p);
    });
  });

  it('★47県より ずっと少ない★（これが効かないと意味がない）', () => {
    const plan = P.planFor('ehime');
    expect(plan.length).toBeLessThanOrEqual(8);
    expect(plan.length).toBeLessThan(ALL47.length / 3);
  });

  it('北海道は入らない（愛媛から走って行かない）', () => {
    expect(P.planFor('ehime')).not.toContain('hokkaido');
  });
});

describe('★落とす順番★', () => {
  it('今いる県が必ず1番目（先にこれが揃えば仕事は始められる）', () => {
    const order = P.orderFor('ehime', ALL47);
    expect(order[0]).toBe('ehime');
  });

  it('★1件も減らさない★（順番を変えるだけ。全国を選んだ時に落ちる県が出ない）', () => {
    const order = P.orderFor('ehime', ALL47);
    expect(order.length).toBe(ALL47.length);
    expect(order.slice().sort()).toEqual(ALL47.slice().sort());
  });

  it('隣の県が、関係ない県より先に来る', () => {
    const order = P.orderFor('ehime', ALL47);
    expect(order.indexOf('hiroshima')).toBeLessThan(order.indexOf('hokkaido'));
    expect(order.indexOf('kochi')).toBeLessThan(order.indexOf('aomori'));
  });
});

describe('★県が分からない時に壊れないこと★', () => {
  it('知らない県名なら null（呼び出し側が全国に落とす判断をする）', () => {
    expect(P.planFor('shiranai')).toBe(null);
    expect(P.planFor('')).toBe(null);
    expect(P.planFor(null)).toBe(null);
  });

  it('順番決めは、県が分からなくても元の一覧をそのまま返す', () => {
    expect(P.orderFor(null, ALL47)).toEqual(ALL47);
    expect(P.orderFor('shiranai', ALL47)).toEqual(ALL47);
  });

  it('一覧が壊れていても落ちない', () => {
    expect(P.orderFor('ehime', null)).toEqual([]);
    expect(function () {
      P.orderFor('ehime', 'こわれている');
    }).not.toThrow();
  });
});

describe('★沖縄のように隣が無い県★', () => {
  it('沖縄は自分だけ（船で他県へ代行しない）', () => {
    expect(P.planFor('okinawa')).toEqual(['okinawa']);
  });
});
