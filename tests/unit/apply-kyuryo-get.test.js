'use strict';
// ============================================================
// ★scripts/apply-kyuryo-get.mjs＝dk_kyuryo_get 1本だけ 当てる 道具の 見張り★ 2026-10-02
//
//   ① repo の SQL から ★その 1本だけ★ 切り出せる（pw_set／verify／grant は 入らない）
//   ② 囲いの 外に 別の 文を 紛れ込ませると 投げる
//   ③ 読むだけの 関数に 書き換えの 字が 入ると 投げる
//   ④ 読み戻した 関数の 数え（直す前の 形は NG・今の 形は OK）
//
//   ★わざと壊して 赤に なるのを 見た（2026-10-02）★
//     kiridasu の「囲いの 外の ; は 1つ」を 外す ⇒ ② が 赤
//     NAI から to_jsonb(w) を 外す ⇒ ④-2 が 赤
//       ★はじめ「④ が 赤になる」と 書いたが 測ったら 緑のまま だった★
//       （直す前の 形は ARU が 欠けて 別の 理由で NG に なる＝NAI を 見ていなかった）⇒ ④-2 を 足した
//     戻すと 全部 緑。テスト倉庫では 当てる前 KAKUNIN まだ → 当てた後 OK（実測）
// ============================================================
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const SQL = fs.readFileSync(path.join(ROOT, 'supabase/apply-kyuryo-honnin-kansuu.sql'), 'utf8');
let T;
beforeAll(async () => {
  T = await import('../../scripts/apply-kyuryo-get.mjs');
});

describe('★dk_kyuryo_get だけを 当てる 道具★', () => {
  it('① その 1本だけ 切り出す', () => {
    const b = T.kiridasu(SQL);
    expect(b.startsWith('create or replace function public.dk_kyuryo_get(')).toBe(true);
    expect(b.trimEnd().endsWith('$fn$;')).toBe(true);
    expect(b).not.toMatch(/dk_kyuryo_pw_set|dk_kyuryo_verify|grant execute/);
    expect(T.kazoeru(b).ok, '★repo の 関数が 直した 形に なっていない★').toBe(true);
  });
  it('② 囲いの 外に 別の 文が 在れば 投げる', () => {
    const lf = SQL.replace(/\r\n/g, '\n');
    const atama = 'p_from date, p_to date)\nreturns json\n';
    expect(lf.split(atama).length, '★置き換える 所が 1か所 でない（試験が 空回り）★').toBe(2);
    const warui = lf.replace(atama, atama + 'drop table daikome.dk_shifts;\n');
    expect(() => T.kiridasu(warui)).toThrow();
  });
  it('③ 読むだけの 関数に 書き換えの 字が 在れば 投げる', () => {
    const warui = SQL.replace(/\r\n/g, '\n').replace(
      '  if p_from is null',
      '  delete from daikome.dk_shifts;\n  if p_from is null'
    );
    expect(() => T.kiridasu(warui)).toThrow(/delete/);
  });
  it('④ 直す前の 形（行ごと 丸ごと・本人で 絞らない）は NG', () => {
    const mae =
      'select to_jsonb(ed) from daikome.dk_shift_edits ed; select to_jsonb(w) from daikome.dk_work_hours w; select to_jsonb(m) from daikome.dk_manual_days m;';
    expect(T.kazoeru(mae).ok).toBe(false);
    expect(T.kazoeru('').ok, '★空を OK に しない★').toBe(false);
  });
  it('④-2 在って ほしい 字が 揃っていても 行ごと 丸ごとが 残っていれば NG', () => {
    const b = T.kiridasu(SQL);
    const mazari = b + '\n-- 残り: select to_jsonb(w) from daikome.dk_work_hours w';
    expect(T.kazoeru(mazari).ok, '★to_jsonb(w) が 残っているのに OK★').toBe(false);
  });
});
