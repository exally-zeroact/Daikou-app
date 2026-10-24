// ============================================================
// ★★地名の やり直し★★ 2026-10-24（対立役 止1・止2）
//   前の 作り＝1秒ごと 5回・「荒い 点が 読めたら やり直さない」・支払い（onTripEnd）で 打ち切り・開始の GPS が 無いと 始めない
//     ⇒ 出発地・到着地が 空の まま 残った（本番の 記録で 出発が 空 8件）
//   見る 事：
//     ① 町の 形が 後から 届いたら 埋まる（荒い 点が 読めて いても）
//     ② 支払いの 後に 解けても 記録（state.trips）へ 書き戻す
//     ③ 開始の 時に GPS が 無い＝その 後に 届いた GPS で 出発地を 埋める
//     ④ 当たらない 点も 10分 までは やり直す（途中で やめると 隣の 県の 升で 空の まま 残った・対立役 2回目 止B）
//   わざと壊す：_addrRetarget を 呼ばない ⇒ ② 赤／_addrTick で _lastRawGps を 使わない ⇒ ③ 赤
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'business.js'), 'utf8');

function makeLocalStorage() {
  const store = Object.create(null);
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
    key: (i) => Object.keys(store)[i] || null,
    get length() {
      return Object.keys(store).length;
    },
  };
}

// 作り物の 町＝見本台（33.85,132.77 の まわり）
function townBundle() {
  const a = 3385000;
  const b = 13277000;
  const d = 400;
  return {
    v: 1,
    precision: 100000,
    bbox: [a - d, b - d, a + d, b + d],
    items: [
      {
        n: '見本台',
        c: '架空市',
        rings: [
          [
            [a - d, b - d],
            [a - d, b + d],
            [a + d, b + d],
            [a + d, b - d],
            [a - d, b - d],
          ],
        ],
        bbox: [a - d, b - d, a + d, b + d],
      },
    ],
  };
}

function load() {
  const sb = {};
  const ls = makeLocalStorage();
  sb.window = sb;
  sb.ADDRESSES_COARSE_JP = { items: [{ lat: 3385000, lng: 13277000, n: '架空市', c: '99999' }] };
  const meter = { getState: () => ({ distance_m: 0, business_distance_m: 0, running: true }) };
  const B = new Function(
    'window',
    'Meter',
    'localStorage',
    'dlog',
    SRC + '\n;return window.Business;'
  )(sb, meter, ls, () => {});
  return { B, sb, ls };
}

describe('地名の やり直し', () => {
  it('① 町の 形が 後から 届いたら 埋まる（荒い 点は 読めて いる）', () => {
    const { B, sb } = load();
    B.start();
    B.onTripStart(33.85, 132.77, 5);
    expect(B.getCurrentTrip().start_address).toBeNull();
    sb.TOWN_POLYGONS_KAKUU = townBundle();
    B.__addressFormatter.addrTick();
    expect(B.getCurrentTrip().start_address).toBe('架空市見本台');
  });

  it('② 支払いの 後に 解けても 記録へ 書き戻す（到着地・経由地）', () => {
    const { B, sb } = load();
    B.start();
    B.onTripStart(33.85, 132.77, 5);
    B.onWaypoint(33.8501, 132.7701, 5);
    B.setEndAddress(33.8502, 132.7702, 5);
    B.onTripEnd(1000, 2000, Date.now());
    sb.TOWN_POLYGONS_KAKUU = townBundle();
    B.__addressFormatter.addrTick();
    const t = B.getState().trips[0];
    expect(t.start_address).toBe('架空市見本台');
    expect(t.waypoints[0].address).toBe('架空市見本台');
    expect(t.end_address).toBe('架空市見本台');
  });

  it('③ 開始の 時に GPS が 無い＝その 後の GPS で 出発地を 埋める', () => {
    const { B, sb } = load();
    sb.TOWN_POLYGONS_KAKUU = townBundle();
    B.start();
    B.onTripStart(null, null, null);
    expect(B.getCurrentTrip().start_address).toBeNull();
    B.notifyRawGps(33.85, 132.77);
    B.__addressFormatter.addrTick();
    expect(B.getCurrentTrip().start_address).toBe('架空市見本台');
  });

  it('④ 当たらない 点（海の 際 等）も 10分 までは やり直す・10分を 過ぎたら やめる', () => {
    const { B, sb } = load();
    sb.TOWN_POLYGONS_KAKUU = townBundle();
    B.start();
    B.onTripStart(33.8599, 132.7799, 5); // 見本台と 同じ 1km の 升・角から 約 650m
    expect(B.getCurrentTrip().start_address).toBeNull();
    B.__addressFormatter.addrTick();
    expect(
      B.__addressFormatter.addrPending().length,
      '★10分 前に やめた（隣の 県の 升で 揃ったと 見た 穴）★'
    ).toBe(1);
    B.__addressFormatter.addrPending()[0].t0 -= 11 * 60 * 1000;
    B.__addressFormatter.addrTick();
    expect(B.__addressFormatter.addrPending().length).toBe(0);
  });

  it('⑤ 業務を 閉じた 後に 解けた 地名も 事務所へ 送る 控えと 運転手の 履歴に 入る・送った 印を 外す', () => {
    const { B, sb, ls } = load();
    B.start();
    B.onTripStart(33.85, 132.77, 5);
    const key = B.getCurrentTrip().start_time;
    B.setEndAddress(33.8502, 132.7702, 5);
    // 清算の 時に 画面が 取る 履歴の 写し（index.html）
    ls.setItem(
      'daikou_history_Sat Oct 24 2026',
      JSON.stringify([{ trip_key: key, start_address: null, end_address: null, waypoints: [] }])
    );
    B.onTripEnd(1000, 2000, Date.now());
    B.end();
    const shiftStart = B.getState().start_time;
    ls.setItem('dk_synced_shifts', JSON.stringify([String(shiftStart)]));
    sb.TOWN_POLYGONS_KAKUU = townBundle();
    B.__addressFormatter.addrTick();
    const hikae = JSON.parse(ls.getItem('daikou_business_history'))[0].trips[0];
    expect(hikae.start_address, '★事務所へ 送る 控えが 空の まま★').toBe('架空市見本台');
    expect(hikae.end_address).toBe('架空市見本台');
    const reki = JSON.parse(ls.getItem('daikou_history_Sat Oct 24 2026'))[0];
    expect(reki.start_address, '★運転手の 履歴が 空の まま★').toBe('架空市見本台');
    expect(reki.end_address).toBe('架空市見本台');
    expect(
      JSON.parse(ls.getItem('dk_synced_shifts')),
      '★送った 印が 残り 直した 版が 上がらない★'
    ).toEqual([]);
  });
  it('⑥ 業務を 閉じて すぐ 次の 業務を 始めても 前の 業務の 控えに 届く（代行の 時刻で 探す）', () => {
    const { B, sb, ls } = load();
    B.start();
    B.onTripStart(33.85, 132.77, 5);
    B.setEndAddress(33.8502, 132.7702, 5);
    B.onTripEnd(1000, 2000, Date.now());
    B.end();
    B.start(); // 次の 業務
    sb.TOWN_POLYGONS_KAKUU = townBundle();
    B.__addressFormatter.addrTick();
    const hikae = JSON.parse(ls.getItem('daikou_business_history'));
    const t = hikae.flatMap((r) => r.trips || [])[0];
    expect(t.end_address, '★次の 業務を 始めたら 前の 控えに 届かない★').toBe('架空市見本台');
  });
  it('⑦ やり直しは 待って いる 点の 地名を 書く（今の 車の 場所＝道に 合わせた 点を 書かない）', () => {
    const { B, sb } = load();
    B.start();
    B.onTripStart(33.85, 132.77, 5); // 見本台で 開始（形は まだ 無い）
    // 車が 動いた＝道に 合わせた 点は 2km 先（形の 外）
    B.notifyMMSnap(33.87, 132.79);
    sb.TOWN_POLYGONS_KAKUU = townBundle();
    B.__addressFormatter.addrTick();
    expect(B.getCurrentTrip().start_address, '★今の 車の 場所を 書いた★').toBe('架空市見本台');
  });

  it('⑧ 形が 届いた 後に 車が 別の 町へ 動いて いても 待って いる 点の 町', () => {
    const { B, sb } = load();
    const tb = townBundle();
    const a = 3386000;
    const b = 13278000;
    const d = 400;
    tb.items.push({
      n: '試験台',
      c: '架空市',
      rings: [
        [
          [a - d, b - d],
          [a - d, b + d],
          [a + d, b + d],
          [a + d, b - d],
          [a - d, b - d],
        ],
      ],
      bbox: [a - d, b - d, a + d, b + d],
    });
    tb.bbox = [3384600, 13276600, 3386400, 13278400];
    B.start();
    B.onTripStart(33.85, 132.77, 5);
    sb.TOWN_POLYGONS_KAKUU = tb;
    B.notifyMMSnap(33.86, 132.78); // 今は 試験台
    B.__addressFormatter.addrTick();
    expect(B.getCurrentTrip().start_address).toBe('架空市見本台');
  });
});
