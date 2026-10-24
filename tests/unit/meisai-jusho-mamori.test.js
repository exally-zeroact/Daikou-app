// ============================================================
// ★★あいまいな 地名で 町名を 上書きしない★★ 2026-10-24
//   司さん「やれ」＝本番の 記録の「西条市 付近」（本当は 今治市郷桜井）を 直した。
//   古い 版の 端末の 手元の 履歴には「○○市 付近」が 残り、送り直しの たびに
//   dk_trips（消して 入れ直し）と 明細の 行き先（UPDATABLE）へ 戻って くる。
//   見る 事：
//     ① 代行の 入れ直しで 町名入りの 出発地・到着地・経由地を「付近」や 空で 消さない
//     ② 新しい 字が 町名入りなら 今まで 通り 入れ替える（運転手の 直しは 通す）
//     ③ 明細の 行き先も 同じ（金額・距離・日付は 今まで 通り 直す）
//   わざと壊す：planMeisaiWrite の destination の 守りを 外す ⇒ ③ 赤
// ============================================================
import * as R from '../../supabase/functions/dk-sync-jobs/meisai-row.js';

describe('あいまいな 地名で 町名を 上書きしない', () => {
  it('① 代行の 入れ直しで 町名入りの 地名を 残す', () => {
    const mae = [
      {
        seq: 1,
        start_address: '架空市見本台',
        end_address: '架空市試験台',
        waypoints: [{ address: '架空市出発台' }],
      },
    ];
    const kita = [
      { seq: 1, start_address: '', end_address: '架空市 付近', waypoints: [{ address: null }] },
    ];
    const r = R.planJushoMamori(mae, kita);
    expect(r[0].start_address).toBe('架空市見本台');
    expect(r[0].end_address).toBe('架空市試験台');
    expect(r[0].waypoints[0].address).toBe('架空市出発台');
  });

  it('② 新しい 字が 町名入りなら 入れ替える・前の 行が 無い 代行は そのまま', () => {
    const mae = [
      { seq: 1, start_address: '架空市見本台', end_address: '架空市 付近', waypoints: [] },
    ];
    const kita = [
      { seq: 1, start_address: '架空市試験台', end_address: '架空市出発台', waypoints: [] },
      { seq: 2, start_address: '架空市 付近', end_address: '', waypoints: [] },
    ];
    const r = R.planJushoMamori(mae, kita);
    expect(r[0].start_address).toBe('架空市試験台');
    expect(r[0].end_address).toBe('架空市出発台');
    expect(r[1].start_address).toBe('架空市 付近');
  });

  it('③ 明細の 行き先も「付近」で 上書きしない（金額・距離は 直す）', () => {
    const ref = 'dev:1:1';
    const cur = {
      id: 9,
      company: '架験A',
      date: '2026-10-21',
      destination: '松本町〜郷桜井',
      amount: 3000,
      distance: 5,
      extra: { dk_ref: ref, dk_meter_yen: 3000, dk_distance_m: 5000 },
    };
    const row = {
      company: '架験A',
      date: '2026-10-21',
      destination: '松本町〜西条市 付近',
      amount: 3500,
      distance: 6,
      extra: { dk_ref: ref, dk_meter_yen: 3500, dk_distance_m: 6000 },
    };
    const p = R.planMeisaiWrite([row], [cur]);
    expect(p.updates.length).toBe(1);
    expect(p.updates[0].patch.destination).toBeUndefined();
    expect(p.updates[0].patch.amount).toBe(3500);
    // 町名入りの 新しい 行き先は 通す
    const p2 = R.planMeisaiWrite([Object.assign({}, row, { destination: '松本町〜桜井' })], [cur]);
    expect(p2.updates[0].patch.destination).toBe('松本町〜桜井');
  });
});
