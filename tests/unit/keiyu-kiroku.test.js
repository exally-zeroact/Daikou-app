// ============================================================
// ★経由を押した前後30秒の記録（js/keiyu-kiroku.js）★ 2026-11-13
//   司さん 11/11「経由を押したら距離が増えた」＝再現0 → 次に起きた時の数を端末に残す。
//   見る事：前30秒/後30秒・mmResult（距離の増えの入口）・押した処理の長さ・加速度の見立て（gps.js と同じ値）・
//           ★位置・住所・snap を入れない★・throw しない・2回押しは延ばす・hidden で途中保存・
//           距離と料金のファイルを1バイトも変えない（この件で触らない）。
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const KK = require('../../js/keiyu-kiroku.js');

function mk() {
  let t = 1000;
  const saved = [];
  const k = KK.createKiroku({
    now: function () {
      return t;
    },
    wall: function () {
      return 1762000000000;
    },
    save: function (r) {
      saved.push(r);
    },
  });
  return {
    k: k,
    saved: saved,
    adv: function (ms) {
      t += ms;
    },
  };
}
function g(dist, extra) {
  return Object.assign(
    {
      lat: 34.1,
      lng: 133.2,
      speedKmh: 0,
      speedSrc: 'dop',
      accuracy: 5,
      timestamp: 1,
      isStationary: true,
    },
    extra || {}
  );
}
function st(dist) {
  return {
    distance_m: dist,
    business_distance_m: dist + 100,
    fare_yen: 700,
    distanceSource: 'pipeline',
  };
}

describe('keiyu-kiroku：前後30秒', () => {
  it('押す前30秒だけ持ち・押した後30秒で閉じて1件残す', () => {
    const h = mk();
    // 60秒走る（1Hz）。押す前30秒より古い点は持たない
    for (let i = 0; i < 60; i++) {
      h.k.feed(g(), st(i * 10), 'driving', false);
      h.adv(1000);
    }
    h.k.mark();
    h.adv(250);
    h.k.markEnd();
    for (let i = 0; i < 31; i++) {
      h.k.feed(g(), st(600 + i), 'driving', false);
      h.adv(1000);
    }
    expect(h.saved.length).toBe(1);
    const r = h.saved[0];
    expect(r.partial).toBe(0);
    expect(r.pre.length).toBe(30); // 30秒より前は捨てた
    expect(r.pre[0].t).toBeGreaterThanOrEqual(-30000);
    expect(r.pre[0].t).toBe(-30000);
    expect(r.marks).toEqual([{ t: 0, ms: 250 }]);
    expect(r.sum.preIncM).toBe(290); // 300→590
    expect(r.sum.postIncM).toBe(30 + 10); // 590→630
    expect(r.sum.maxMarkMs).toBe(250);
    expect(r.sum.maxGapMs).toBe(1250); // 押した処理の 250ms がそのまま空きに出る
  });

  it('mmResult＝距離の増えの入口を残し、後ろの合計を出す', () => {
    const h = mk();
    h.k.feed(g(), st(0), 'driving', false);
    h.k.mark();
    for (let i = 0; i < 5; i++) {
      h.adv(1000);
      h.k.mm({
        type: 'mmResult',
        pipelineDeltaM: 2.5,
        pipelineDeltaSrc: 'gap',
        isStationary: false,
        _reason: 'x',
        mienai: 0,
        committed: true,
        snap: { lat: 34, lng: 133 },
      });
      h.k.mm({ type: 'other' }); // mmResult 以外は取らない
    }
    h.adv(30000);
    h.k.tick();
    const r = h.saved[0];
    const ms = r.post.filter((e) => e.k === 'm');
    expect(ms.length).toBe(5);
    expect(ms[0]).toMatchObject({ d: 2.5, ds: 'gap', st: 0, f: 'C' });
    expect(r.sum.mmPostM).toBe(12.5);
  });

  it('★位置・住所・snap の字が記録に1つも無い★', () => {
    const h = mk();
    h.k.feed(g(0, { address: '香川県' }), st(0), 'driving', false);
    h.k.mark();
    h.k.mm({ type: 'mmResult', pipelineDeltaM: 1, snap: { lat: 34, lng: 133 }, lat: 34, lng: 133 });
    h.k.flush();
    const s = JSON.stringify(h.saved[0]);
    expect(s).not.toMatch(/"lat"|"lng"|"snap"|address|香川|34\.1|133\.2/);
  });

  it('加速度は gps.js と同じ（3000ms・5点・0.1）・実点で箱を空にし・合成点では空にしない', () => {
    const h = mk();
    for (let i = 0; i < 6; i++) {
      h.k.onMotion(0, 0, 9.8 + (i % 2) * 2); // 揺れ＝分散 1.0
      h.adv(20);
    }
    h.k.feed(g(0, { isSynthetic: true, speedSrc: 'coast' }), st(0), 'driving', false);
    h.k.feed(g(0), st(0), 'driving', false); // 合成点では空にしない＝次も見える
    h.k.feed(g(0), st(0), 'driving', false); // 実点の後は空
    const ring = h.k._peek().ring;
    expect(ring[0]).toMatchObject({ syn: 1, src: 'coast', an: 6, zupt: 0 });
    expect(ring[0].av).toBeCloseTo(1, 3);
    expect(ring[1]).toMatchObject({ an: 6, zupt: 0 });
    expect(ring[2]).toMatchObject({ av: null, an: 0, zupt: null });
    // 3000ms より古い加速度は数えない
    const h2 = mk();
    for (let i = 0; i < 6; i++) h2.k.onMotion(0, 0, 9.8);
    h2.adv(3000);
    h2.k.feed(g(), st(0), 'driving', false);
    expect(h2.k._peek().ring[0]).toMatchObject({ av: null, an: 0 });
  });

  it('押している途中でもう1回押したら閉じずに延ばす（印は2つ）', () => {
    const h = mk();
    h.k.mark();
    h.adv(20000);
    h.k.mark();
    h.adv(20000);
    h.k.tick();
    expect(h.saved.length).toBe(0); // 2回目から30秒たっていない
    h.adv(10000);
    h.k.tick();
    expect(h.saved.length).toBe(1);
    expect(h.saved[0].marks.map((m) => m.t)).toEqual([0, 20000]);
  });

  it('hidden / pagehide で途中まで書き・閉じずに集め続け・戻って10秒を同じ件に足して書き直す', () => {
    const h = mk();
    h.k.mark();
    h.adv(5000);
    h.k.event('hidden');
    expect(h.saved.length).toBe(1);
    expect(h.saved[0].partial).toBe(1);
    expect(h.saved[0].post.some((e) => e.k === 'e' && e.n === 'hidden')).toBe(true);
    h.adv(40000); // 裏に居る間は tick が来ない
    h.k.event('visible');
    h.k.mm({ type: 'mmResult', pipelineDeltaM: 50 }); // 戻った時にまとめて来る増え
    h.adv(9000);
    h.k.tick();
    expect(h.saved.length).toBe(1);
    h.adv(1000);
    h.k.tick();
    expect(h.saved.length).toBe(2);
    expect(h.saved[1].at).toBe(h.saved[0].at); // 同じ件＝書き直し
    expect(h.saved[1].partial).toBe(0);
    expect(h.saved[1].sum.mmPostM).toBe(50);
  });

  it('throw しない（壊れた値・書き先の例外）', () => {
    const k = KK.createKiroku({
      save: function () {
        throw new Error('quota');
      },
    });
    expect(() => {
      k.feed(null);
      k.feed({
        get speedKmh() {
          throw new Error('x');
        },
      });
      k.mm(null);
      k.mm({ type: 'mmResult', pipelineDeltaM: 'abc' });
      k.onMotion('a', null, undefined);
      k.markEnd();
      k.mark();
      k.event({});
      k.flush();
    }).not.toThrow();
  });

  it('点の数は上限で切る（膨らまない）', () => {
    const h = mk();
    h.k.mark();
    for (let i = 0; i < 2000; i++) {
      h.k.mm({ type: 'mmResult', pipelineDeltaM: 0 });
      h.adv(10);
    }
    h.k.flush();
    expect(h.saved[0].post.length).toBe(800);
    expect(h.saved[0].cut).toBe(1200);
  });
});

describe('keiyu-kiroku：距離と料金のファイルを触らない', () => {
  it('★gps.js / meter.js / map-matcher.js / pipeline-distance.js / gps-worker.js / business.js / fare-calc.js は HEAD と同じ★', () => {
    const root = path.join(__dirname, '..', '..');
    const files = [
      'js/gps.js',
      'js/meter.js',
      'js/map-matcher.js',
      'js/pipeline-distance.js',
      'js/gps-worker.js',
      'js/business.js',
      'js/fare-calc.js',
    ];
    const out = execSync('git diff --name-only HEAD -- ' + files.join(' '), { cwd: root })
      .toString()
      .trim();
    expect(out).toBe('');
  });
  it('記録の js は網に出さない（fetch / sendBeacon / XMLHttpRequest / firebase の字が無い）', () => {
    const src = fs
      .readFileSync(path.join(__dirname, '..', '..', 'js', 'keiyu-kiroku.js'), 'utf8')
      .replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/fetch\(|sendBeacon|XMLHttpRequest|firebase|localStorage/i);
  });
});
