// ============================================================
// scripts/apply-meisai-naosu.mjs の 守り 2026-11-14 件⑧b（入力から 明細 1行の 額を 直す 関数 dk_meisai_naosu）
//   ①本物の SQL から 関数の 塊だけ 切り出せる（呼べる 人の 文は 塊に 入らない）
//   ②書き換えて よい 表は meisai・dk_trips・dk_shifts・dk_shift_edits だけ（他の 表は 止まる）
//   ③書く 列は KAKU_RETSU だけ（距離を 足すと 列の 数えでも 在って ほしくない 字でも 分かる）
//   ④本物の SQL は 在って ほしい 字を 全部 持つ（控えの 比べ・人の 物・マイナス断り 等）
//   ⑤search_path は '' の 1行（daikome, public に 戻すと 止まる）・security invoker は 止まる
//   ⑥中に delete・insert・execute が 在ると 止まる
//   ⑦道具が 書く 呼べる 人の 2文は SQL の ファイルの 末尾の 2文と 同じ（名前・引数の 型の ずれ）
//   ⑧今までの 関数（searchPath を 持たない K）は 今まで 通りの 判じ
// ============================================================
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
let M;
let Y;
beforeAll(async () => {
  M = await import(pathToFileURL(path.join(ROOT, 'scripts', 'apply-meisai-naosu.mjs')).href);
  Y = await import(pathToFileURL(path.join(ROOT, 'scripts', 'apply-yaku-namae.mjs')).href);
});
const SQL = fs.readFileSync(path.join(ROOT, 'supabase', 'apply-meisai-naosu.sql'), 'utf8');
const kae = (a, b) => {
  const s = SQL.replace(a, b);
  expect(s, a + ' が SQL に 無い').not.toBe(SQL);
  return s;
};

describe('apply-meisai-naosu の 守り', () => {
  it('① 関数の 塊だけ 切り出す', () => {
    const b = Y.kiridasu(SQL, M.K);
    expect(b.startsWith(M.K.atama)).toBe(true);
    expect(b.trimEnd().endsWith('$fn$;')).toBe(true);
    expect(b).not.toMatch(/\bgrant\b|\brevoke\b/i);
  });
  it('② 他の 表を 書き換えたら 止まる', () => {
    const s = kae(
      'update daikome.dk_trips t set fare_yen',
      'update daikome.dk_employees t set fare_yen'
    );
    expect(() => Y.kiridasu(s, M.K)).toThrow('dk_employees');
    const s2 = kae('update daikou.meisai m', 'update "daikou"."payments" m');
    expect(() => Y.kiridasu(s2, M.K)).toThrow('daikou.payments');
  });
  it('③ 書く 列は 決まりの 中だけ', () => {
    const b = Y.kiridasu(SQL, M.K);
    expect(M.kakuRetsuOk(b)).toBe(true);
    expect(M.KAKU_RETSU.length).toBe(7);
    const s = kae('set fare_yen = p_amount', 'set fare_yen = p_amount, distance_m = 0');
    const b2 = Y.kiridasu(s, M.K);
    expect(M.kakuRetsuOk(b2)).toBe(false);
    expect(Y.kazoeru(b2, M.K).ok).toBe(false);
  });
  it('④ 本物の SQL は 在って ほしい 字を 全部 持つ・無いと 割れる', () => {
    const b = Y.kiridasu(SQL, M.K);
    expect(Y.kazoeru(b, M.K).ok).toBe(true);
    expect(Y.kazoeru('', M.K).ok).toBe(false);
    // 控えの 比べを 消すと 割れる（別の 画面の 直しを 上書きする 壊し）
    const s = kae('v_m.amount is distinct from p_hikae', 'false');
    expect(Y.kazoeru(Y.kiridasu(s, M.K), M.K).ok).toBe(false);
    // 人の 明細の 守りを 消すと 割れる
    const s2 = kae('v_m.user_id is distinct from v_uid', 'false');
    expect(Y.kazoeru(Y.kiridasu(s2, M.K), M.K).ok).toBe(false);
  });
  it("⑤ search_path は '' の 1行・security invoker は 止まる", () => {
    const s = kae("set search_path = ''", 'set search_path = daikome, public, extensions');
    expect(() => Y.kiridasu(s, M.K)).toThrow('search_path');
    // ★注釈（先頭の「★守り★ security definer」）でなく 本体の 行を 替える★
    const s2 = kae('\nsecurity definer\n', '\nsecurity invoker\n');
    expect(() => Y.kiridasu(s2, M.K)).toThrow('security');
    // 注釈の 中の 字では 通さない
    const s3 = kae("set search_path = ''", "-- set search_path = ''\nset search_path = public");
    expect(() => Y.kiridasu(s3, M.K)).toThrow('search_path');
  });
  it('⑥ 中に delete・insert・execute が 在ると 止まる', () => {
    for (const w of [
      'delete from daikome.dk_trips t where t.trip_id = v_trip;',
      'insert into daikou.meisai(id) values (gen_random_uuid());',
      "execute 'select 1';",
    ]) {
      const s = kae('  -- ⑤ 代行の 額', '  ' + w + '\n  -- ⑤ 代行の 額');
      expect(() => Y.kiridasu(s, M.K)).toThrow(/delete|insert|execute/);
    }
  });
  it('⑦ 道具が 書く 呼べる 人の 2文＝SQL の 末尾の 2文', () => {
    const s = SQL.replace(/\r\n/g, '\n');
    for (const k of M.KENGEN) expect(s).toContain(k);
    // 関数の 形（引数の 型）と 呼べる 人の 文の 形が 揃う
    expect(M.K.atama).toContain('(p_meisai_id uuid, p_amount integer, p_hikae integer)');
    expect(M.K.sig).toBe('dk_meisai_naosu(uuid,integer,integer)');
  });
  it('⑧ searchPath を 持たない 今までの 関数は 今まで 通り', () => {
    const yaku = fs.readFileSync(path.join(ROOT, 'supabase', 'apply-yaku-namae.sql'), 'utf8');
    expect(() => Y.kiridasu(yaku, Y.K)).not.toThrow();
    const s = yaku.replace('set search_path = daikome, public, extensions', "set search_path = ''");
    expect(s).not.toBe(yaku);
    expect(() => Y.kiridasu(s, Y.K)).toThrow('search_path');
  });
});
