// tests/property/live-address-freeze.test.js
// ★住所②"全然違う場所"=現在地フリーズ 回帰テスト (2026-06-20・実機trace 497e5ded で確定)★
//   実機(今夜Android)trace解析: 住所②がセッション中ずっと「今治市石井町」固定(1822回・他町ゼロ)、
//   一方GPSは南北15km移動・住所表示が石井町なのにGPSが最大17.5km離れた点1142箇所。
//   根因: business.js getCurrentLiveAddress 段②が ★古いsnap(_lastMMSnap)を古さ無制限で永遠に返す★
//   → snap更新停止で現在地表示が初期地点に凍結・段③(生GPS)へ絶対落ちない。
//   直し: 段②で「生GPSが新鮮 かつ 古いsnapから大きく離れてたら(=snapが死んで現在地が進んだ)生GPSを使う」。
//   ★住所表示層のみ・距離/課金は不可侵(read-onlyキャッシュ)★。純粋関数 _pickLiveAddrPos をテスト先行で固定。
'use strict';

const path = require('path');
const Business = require(path.join(__dirname, '..', '..', 'js', 'business.js'));

const pick = Business._pickLiveAddrPos;

// 定数(business.js と一致): snap fresh=5s / raw fresh=60s / 乖離しきい値。
describe('住所② 現在地フリーズ根治 (_pickLiveAddrPos)', () => {
  it('関数が公開されている (テスト seam)', () => {
    expect(typeof pick).toBe('function');
  });

  it('段①: snap新鮮 → snapを使う', () => {
    const now = 100000;
    const r = pick({
      mmSnap: { lat: 34.2, lng: 133.09, t: now - 1000 },
      rawGps: { lat: 34.0, lng: 132.99, t: now },
      now,
    });
    expect(r.src).toBe('snap');
    expect(r.lat).toBe(34.2);
  });

  it('段②(正常): snap stale だが生GPSがsnap近く(短時間停止) → snap保持で安定', () => {
    const now = 100000;
    // snap 10s前(stale)・生GPSは20m隣(停止中のdrift)
    const r = pick({
      mmSnap: { lat: 34.2, lng: 133.09, t: now - 10000 },
      rawGps: { lat: 34.20018, lng: 133.09, t: now },
      now,
    });
    expect(r.src).toBe('snap'); // 近接=停止とみなしsnap保持(flicker防止)
  });

  it('★段②(凍結根治): snap stale かつ 生GPSが遠く離れた → 生GPSを使う(フリーズ解消)', () => {
    const now = 100000;
    // 実機再現: snapは石井町で凍結・生GPSは17km南へ移動
    const r = pick({
      mmSnap: { lat: 34.2035, lng: 133.0938, t: now - 30000 },
      rawGps: { lat: 34.0686, lng: 132.9965, t: now },
      now,
    });
    expect(r.src).toBe('raw'); // ★凍結したsnapでなく生GPSで現在地を追従★
    expect(r.lat).toBe(34.0686);
  });

  it('★実機17.5km凍結の核: 古いsnapが生GPSから遠い時は生GPS優先(石井町張り付き禁止)', () => {
    const now = 999999999;
    const r = pick({
      mmSnap: { lat: 34.2035, lng: 133.0938, t: 0 },
      rawGps: { lat: 34.0686, lng: 132.9965, t: now - 1000 },
      now,
    });
    expect(r.src).toBe('raw');
  });

  it('段③: snap無し・生GPS新鮮 → 生GPS', () => {
    const now = 100000;
    const r = pick({ mmSnap: null, rawGps: { lat: 34.0, lng: 132.99, t: now - 1000 }, now });
    expect(r.src).toBe('raw');
  });

  it('段②fallback: snap stale・生GPSが古すぎる(60s超) → snap保持(生GPSも信頼できない)', () => {
    const now = 100000;
    const r = pick({
      mmSnap: { lat: 34.2, lng: 133.09, t: now - 10000 },
      rawGps: { lat: 34.0686, lng: 132.99, t: now - 90000 },
      now,
    });
    expect(r.src).toBe('snap'); // 生GPSが60s超stale=信頼できない→snap保持(従来挙動)
  });

  it('④全部無し → null', () => {
    const r = pick({ mmSnap: null, rawGps: null, now: 100000 });
    expect(r).toBe(null);
  });
});
