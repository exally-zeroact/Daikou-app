// ============================================================
// ★★請求書アプリへ 送る行に「車の札」を 付ける★★ 2026-09-03（司さん）
//
//   ★何が 起きていたか（実測・本番の倉庫）★
//     一覧は extra の ★dk_car★ で 車ごとに 分けている。
//       8/22 の行 … dk_car("4987") と dk_car_no(2) が ★在る★ ⇒「車 4987」で 出る
//       8/25以降  … ★1件も 無い★ ⇒ 車が 無い＝★「手で入れた分」に まとめられる★
//     ★同じ端末なのに 8/22 は 有り・8/26 は 無し★＝データの問題では ない。
//     ★dk_car を 書く所が どの repo にも 1行も 無かった★
//       （Daikou-app … origin/main 0件・★履歴の commit も 0件★／請求書アプリ … 読むだけ）
//     ⇒★8/25 に 手で 配った 関数だけに 入っていて、上書きされて 消えた★
//
//   ★直し★ … 送る行の extra に ★dk_car（車の名前）★ と ★dk_car_no（事務所で決めた並び順）★ を 足す。
//     車の名前は ★倉庫の daikome.dk_device_labels★（事務所で 付けた札）から。
//     ★取れない時は 足さない★＝★空文字や 0 を 作らない★（＝「車が 無い」と 読まれる物を 作らない）
//
//   ★お金には 触らない★ … 足すのは 札2つだけ。金額・日付・行き先・備考は 1文字も 変えない。
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-03 実測）★★
//     ①札を 足すのを やめる ………………………… ★6本中 2本 赤★
//     ②取れない時に 空文字を 入れる ……………… ★6本中 2本 赤★
//     ③並び順を 文字で 入れる（数で 入れない）… ★6本中 1本 赤★
//     戻した後 … ★6本とも 緑★
//     ⇒★3通り 全部で 赤に なった＝空振りでは ありません★
// ============================================================
'use strict';

const path = require('path');
const M = require(
  path.join(__dirname, '..', '..', 'supabase', 'functions', 'dk-sync-jobs', 'meisai-row.js')
);

const trip = (seq, name) => ({
  seq,
  payment_type: 'invoice',
  customer_name: name || 'テスト商事',
  fare_yen: 1500,
  distance_m: 1234.5,
  start_address: '今治市松本町',
  end_address: '今治市旭町',
});

const base = {
  ownerId: 'owner-1',
  deviceId: '7e1919ef-4aaa-411e-8db0-ba0424d1fe53',
  shiftStartMs: 1787385737281,
  trips: [trip(1)],
  homeCity: '今治市',
};

describe('★請求書へ 送る行に 車の札を 付ける★', () => {
  it('★① 車の名前と 並び順が 入る★', () => {
    const r = M.buildMeisaiRows(Object.assign({}, base, { carLabel: '4987', carNo: 2 }))[0];
    expect(r.extra.dk_car, '★車の名前が 入っていません★').toBe('4987');
    expect(r.extra.dk_car_no, '★並び順が 入っていません★').toBe(2);
  });

  it('★② 並び順は ★数★ で 入れる（文字だと 一覧が 車として 読めない）★', () => {
    const r = M.buildMeisaiRows(Object.assign({}, base, { carLabel: '1466', carNo: '1' }))[0];
    expect(typeof r.extra.dk_car_no, '★並び順が 数に なっていません★').toBe('number');
    expect(r.extra.dk_car_no).toBe(1);
  });

  it('★★③ 札が 取れない時は 足さない（空文字や 0 を 作らない）★★', () => {
    const r = M.buildMeisaiRows(Object.assign({}, base, { carLabel: '', carNo: null }))[0];
    expect('dk_car' in r.extra, '★空の 車の名前を 作っています★').toBe(false);
    expect('dk_car_no' in r.extra, '★0番の 車を 作っています★').toBe(false);
  });

  it('★④ 札を 渡さなくても 今までどおり 動く（他の 中身が 消えない）★', () => {
    const r = M.buildMeisaiRows(base)[0];
    expect(r.extra.dk_ref, '★二重登録を 防ぐ鍵が 消えました★').toBeTruthy();
    expect(r.extra.dk_source).toBe('daikome');
    expect(typeof r.extra.dk_distance_m).toBe('number');
    expect('dk_car' in r.extra).toBe(false);
  });

  it('★⑤ お金と 日付と 行き先は 札を 足しても 変わらない★', () => {
    const nashi = M.buildMeisaiRows(base)[0];
    const ari = M.buildMeisaiRows(Object.assign({}, base, { carLabel: '4987', carNo: 2 }))[0];
    expect(ari.amount, '★金額が 変わりました★').toBe(nashi.amount);
    expect(ari.date, '★日付が 変わりました★').toBe(nashi.date);
    expect(ari.destination, '★行き先が 変わりました★').toBe(nashi.destination);
    expect(ari.distance, '★距離が 変わりました★').toBe(nashi.distance);
  });

  it('★⑥ 送る側（関数の入口）が 札を 渡している★', () => {
    const fs = require('fs');
    const ts = fs.readFileSync(
      path.join(__dirname, '..', '..', 'supabase', 'functions', 'dk-sync-jobs', 'index.ts'),
      'utf8'
    );
    expect(ts, '★事務所で 付けた 車の札を 取っていません★').toMatch(/dk_device_labels/);
    expect(ts, '★buildMeisaiRows に 車の札を 渡していません★').toMatch(/carLabel/);
    expect(ts, '★buildMeisaiRows に 並び順を 渡していません★').toMatch(/carNo/);
  });
});
