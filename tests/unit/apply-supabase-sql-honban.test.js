// ============================================================
// ★SQL を 当てる 道具（scripts/apply-supabase-sql.mjs）の 本番の 止め★ 2026-10-17
//   対立役 N7：前は 本番の 手元で 走らせると そのまま 本番に 当たった（--honban の 止めが 無かった）。
//   ①本番で --honban 無し＝止める ②--honban 付き・テストの 倉庫・--probe（読むだけ）＝止めない
//   ③止めは 門番より 前・当てるより 前に 在る ④退職の 列の SQL には 当てた後の 確かめが 2つ 在る
//   ★わざと壊して 赤に なった 記録（2026-10-17・4本中）★
//     止めの 呼び出しを null に＝1本 赤 ／ --honban の 判じを 逆に＝2本 赤
//     （最初の ③ は 関数の 定義の 字を 拾って、呼び出しを 外しても 緑だった＝呼び出しの 字で 探す 形に 直した）
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { honbanNoTome, ATO_NO_KAKUNIN, kagiNoNa } from '../../scripts/apply-supabase-sql.mjs';

// ⑤ 2026-10-17：打ち方が 違っても 当てた後の 確かめの 鍵に 当たる（前は「./supabase/…」で 0本の まま OK だった・対立役）
//   わざと壊す：kagiNoNa を 打った 字の まま 返す 形に 戻す ⇒ ⑤ が 赤
describe('★当てた後の 確かめの 鍵★', () => {
  it('⑤ ./ 付き・repo の 根からの 絶対の 道でも 同じ 鍵', () => {
    const k = 'supabase/apply-jugyoin-taishoku.sql';
    const root = path.resolve(__dirname, '..', '..');
    expect(kagiNoNa('./' + k)).toBe(k);
    expect(kagiNoNa(path.join(root, k))).toBe(k);
    expect(kagiNoNa(k.split('/').join(path.sep))).toBe(k);
    expect(ATO_NO_KAKUNIN[kagiNoNa('./' + k)]).toBeTruthy();
  });
});

const HON = 'tnfwipbgfgjaymlszeid';
const TEST = 'khawdrnvssdenumbiwfg';
const SRC = fs.readFileSync(
  path.resolve(__dirname, '../../scripts/apply-supabase-sql.mjs'),
  'utf8'
);

describe('★SQL を 当てる 道具の 本番の 止め★', () => {
  it('① 本番で --honban 無し＝止める', () => {
    expect(honbanNoTome(HON, ['supabase/a.sql'])).toMatch(/--honban/);
  });
  it('② --honban 付き・テストの 倉庫・--probe＝止めない', () => {
    expect(honbanNoTome(HON, ['--honban', 'supabase/a.sql'])).toBe(null);
    expect(honbanNoTome(TEST, ['supabase/a.sql'])).toBe(null);
    expect(honbanNoTome(HON, ['--probe'])).toBe(null);
  });
  it('③ 止めは 門番と 当てるより 前', () => {
    const tome = SRC.indexOf('const tome = honbanNoTome(ref, args);');
    expect(tome).toBeGreaterThan(0);
    expect(tome).toBeLessThan(SRC.indexOf('guard(sql)'));
    expect(tome).toBeLessThan(SRC.indexOf('runSql(ref, key.token, sql)'));
  });
  it('④ 退職の 列の SQL は 当てた後に retired_on と security_invoker を 数える', () => {
    const k = ATO_NO_KAKUNIN['supabase/apply-jugyoin-taishoku.sql'];
    expect(k.map((x) => x.q).join(' ')).toMatch(/retired_on/);
    expect(k.map((x) => x.q).join(' ')).toMatch(/security_invoker=true/);
    expect(k.every((x) => x.ok([{ n: 1 }]))).toBe(true);
    expect(k.some((x) => x.ok([{ n: 0 }]))).toBe(false);
    expect(k.some((x) => x.ok([]))).toBe(false);
  });
});
