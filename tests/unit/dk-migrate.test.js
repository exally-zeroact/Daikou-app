// ============================================================
// ★引っ越し（テスト版 → 本番）の中身を 実物の関数で数える★（2026-08-22）
//
//   ★守る事（これが破れたら赤）★
//     ①★較正K（dk_veh_list の calibKs）が そのまま運べる★
//     ②★端末ID(DAIKOME_DEVICE_ID)を運ぶ＝席が増えない★
//     ③★既に中身が在るキーは 1つも上書きしない★
//     ④★走行中の状態(daikou_driving_state)と 鍵は 運ばない★
//     ⑤★一覧に無いキーは 受け取らない★
// ============================================================
const path = require('path');
const DKMigrate = require(path.resolve(__dirname, '..', '..', 'js', 'dk-migrate.js'));

// localStorage の代わり（実物と同じ getItem/setItem/key/length を持つ）
function makeStore(obj) {
  const m = new Map(Object.entries(obj || {}));
  return {
    get length() {
      return m.size;
    },
    key(i) {
      return Array.from(m.keys())[i];
    },
    getItem(k) {
      return m.has(k) ? m.get(k) : null;
    },
    setItem(k, v) {
      m.set(k, String(v));
    },
    removeItem(k) {
      m.delete(k);
    },
    _dump() {
      return Object.fromEntries(m);
    },
  };
}

const CAR_CALIBRATED = { id: 'v1', name: '車1', calibKs: [1.012, 1.009, 1.011] };
const CAR_NOT_YET = { id: 'v2', name: '車2', calibKs: [1.02] };

function testPhone() {
  return makeStore({
    dk_veh_list: JSON.stringify([CAR_CALIBRATED, CAR_NOT_YET]),
    dk_veh_active_id: 'v1',
    DAIKOME_DEVICE_ID: '22849fdb-cde7-4f1d-afc7-47009a6e08c8',
    daikou_business_history: JSON.stringify([{ d: '2026-08-14' }, { d: '2026-08-15' }]),
    daikou_settings: '{"x":1}',
    daikou_driving_state: '{"running":true}', // ★運ばない★
    daikou_gh_pat: 'ghp_secret', // ★運ばない★
    compass_granted: '1', // 一覧に無い＝運ばない
  });
}

describe('★引っ越し：較正Kと端末IDが そのまま運べる★', () => {
  it('①較正Kが運べる（較正済みの車の数が 前と後で同じ）', () => {
    const from = testPhone();
    const to = makeStore({});
    const before = DKMigrate.summarize(from);
    DKMigrate.apply(to, DKMigrate.collect(from));
    const after = DKMigrate.summarize(to);

    expect(before.calibrated, '★元の端末で 較正済みが数えられていない★').toBe(1);
    expect(after.cars, '★車の台数が変わった★').toBe(before.cars);
    expect(after.calibrated, '★較正済みの台数が変わった＝較正やり直しになる★').toBe(
      before.calibrated
    );
    // ★値そのものも1つずつ突き合わせる（数だけ合わせて中身が違う、を止める）★
    expect(JSON.parse(to.getItem('dk_veh_list'))[0].calibKs).toEqual(CAR_CALIBRATED.calibKs);
  });

  it('②端末IDを運ぶ＝本番で新しい席を取らない', () => {
    const from = testPhone();
    const to = makeStore({});
    DKMigrate.apply(to, DKMigrate.collect(from));
    expect(to.getItem('DAIKOME_DEVICE_ID'), '★端末IDが運べていない＝5台目になる★').toBe(
      '22849fdb-cde7-4f1d-afc7-47009a6e08c8'
    );
  });

  it('③既に中身が在るキーは 1つも上書きしない', () => {
    const from = testPhone();
    const to = makeStore({
      DAIKOME_DEVICE_ID: 'f3527369-9df3-47c4-93a8-b6e532a4ce92', // 本番で使っている端末
      dk_veh_list: JSON.stringify([{ id: 'v9', name: '本番の車', calibKs: [1, 1, 1] }]),
    });
    const res = DKMigrate.apply(to, DKMigrate.collect(from));
    expect(to.getItem('DAIKOME_DEVICE_ID'), '★本番の端末IDを上書きした★').toBe(
      'f3527369-9df3-47c4-93a8-b6e532a4ce92'
    );
    expect(JSON.parse(to.getItem('dk_veh_list'))[0].name, '★本番の車を上書きした★').toBe(
      '本番の車'
    );
    expect(res.kept).toContain('DAIKOME_DEVICE_ID');
    expect(res.kept).toContain('dk_veh_list');
  });

  it('④走行中の状態と 鍵は 運ばない', () => {
    const from = testPhone();
    const packed = DKMigrate.collect(from);
    expect(packed.daikou_driving_state, '★走行中の状態を運んでいる★').toBeUndefined();
    expect(packed.daikou_gh_pat, '★鍵を運んでいる★').toBeUndefined();
    expect(packed.compass_granted, '★一覧に無い物を運んでいる★').toBeUndefined();
  });

  it('⑤一覧に無いキーは 受け取らない（送り側が細工しても入らない）', () => {
    const to = makeStore({});
    DKMigrate.apply(to, { dk_veh_list: '[]', daikou_gh_pat: 'ghp_x', nazono_key: 'x' });
    expect(to.getItem('daikou_gh_pat'), '★鍵を受け取った★').toBe(null);
    expect(to.getItem('nazono_key'), '★知らないキーを受け取った★').toBe(null);
    expect(to.getItem('dk_veh_list'), '★運ぶべき物が入っていない★').toBe('[]');
  });

  it('⑥受け取ってよい送り元は テスト線だけ（アドレスが定数で固定されている）', () => {
    expect(DKMigrate.TEST_ORIGIN).toBe('https://daikou-app-test.vercel.app');
    expect(DKMigrate.PROD_ORIGIN).toBe('https://daikou-app.vercel.app');
  });

  it('⑦履歴の日数が そのまま運べる', () => {
    const from = testPhone();
    const to = makeStore({});
    DKMigrate.apply(to, DKMigrate.collect(from));
    expect(DKMigrate.summarize(to).days).toBe(2);
  });

  // ============================================================
  // ★2026-08-22 実際に押して見つけた（作り物では出なかった）★
  //   本番のアプリは ★開いた瞬間に自分で★
  //     dk_veh_list='[]' ／ DAIKOME_DEVICE_ID=新しい番号 ／ daikou_business_state …
  //   を書く。これを「もう在る」と読むと ★引っ越しが1件も入らない★。
  //   実測：車0台・端末IDは新しい番号 ＝ ★そのまま出していたら 5台目になって弾かれていた★。
  // ============================================================
  it('⑧開いただけの端末（車0台・履歴0日）には、アプリが自分で書いた空っぽを越えて入る', () => {
    const from = testPhone();
    // ★本番のアプリが開いた瞬間に書く物★を そのまま再現する
    const to = makeStore({
      dk_veh_list: '[]',
      DAIKOME_DEVICE_ID: '85443393-5ac2-4240-b89d-339fe5a4f240', // 開いた時に作られた新しい番号
      daikou_business_state: '{}',
      daikou_discounts: '[]',
      daikou_extras: '[]',
      DAIKOME_LICENSE_CACHE: '{"ok":false}',
    });
    expect(DKMigrate.isFresh(to), '★開いただけの端末を「使用中」と読んでいる★').toBe(true);

    const res = DKMigrate.apply(to, DKMigrate.collect(from));
    const after = DKMigrate.summarize(to);
    expect(after.cars, '★車が入っていない（空の[]に負けた）★').toBe(2);
    expect(after.calibrated, '★較正Kが入っていない＝較正やり直しになる★').toBe(1);
    expect(to.getItem('DAIKOME_DEVICE_ID'), '★新しい端末IDのまま＝5台目になって弾かれる★').toBe(
      '22849fdb-cde7-4f1d-afc7-47009a6e08c8'
    );
    expect(res.tookOverDevice).toBe(true);
    expect(
      to.getItem('DAIKOME_LICENSE_CACHE'),
      '★古いライセンスの判定が残っている（別の端末IDで出した答え）★'
    ).toBe(null);
  });

  it('⑨本番で使っている端末（車が在る）には 1つも上書きしない', () => {
    const from = testPhone();
    const to = makeStore({
      dk_veh_list: JSON.stringify([{ id: 'v9', name: '本番の車', calibKs: [1, 1, 1] }]),
      DAIKOME_DEVICE_ID: 'f3527369-9df3-47c4-93a8-b6e532a4ce92',
      daikou_business_history: JSON.stringify([{ d: '2026-08-15' }]),
    });
    expect(DKMigrate.isFresh(to)).toBe(false);
    DKMigrate.apply(to, DKMigrate.collect(from));
    expect(JSON.parse(to.getItem('dk_veh_list'))[0].name).toBe('本番の車');
    expect(to.getItem('DAIKOME_DEVICE_ID')).toBe('f3527369-9df3-47c4-93a8-b6e532a4ce92');
  });

  it('⑩空っぽの見分け（境界）', () => {
    const s = makeStore({ a: '', b: '[]', c: '{}', d: 'null', e: '0', f: '[{"id":"v1"}]' });
    expect(DKMigrate.hasReal(s, 'a')).toBe(false);
    expect(DKMigrate.hasReal(s, 'b')).toBe(false);
    expect(DKMigrate.hasReal(s, 'c')).toBe(false);
    expect(DKMigrate.hasReal(s, 'd')).toBe(false);
    expect(DKMigrate.hasReal(s, 'e'), '★"0" は中身が在る★').toBe(true);
    expect(DKMigrate.hasReal(s, 'f')).toBe(true);
    expect(DKMigrate.hasReal(s, 'zzz'), '★無いキー★').toBe(false);
  });
});
