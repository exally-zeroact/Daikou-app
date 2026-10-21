// ★本人の 明細の 札（24時間 パスワード 無し）を 当てる 道具の 門★ 2026-10-21（scripts/apply-kyuryo-fuda.mjs）
//   repo の SQL から 2つの 塊を 切り出せるか・在って ほしい 字・md5 の 門・誰が 呼べるかの 門
//   わざと壊す：下の 置き換えが 掴めない（空回り）時は 赤に なる様に not.toBe(src) を 見る
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  kiridasuFuda,
  kazoeruFuda,
  kazoeruFudaGet,
  fudaNoMon,
  okuruJi,
  proaclNoMon,
  honbanNoMuki,
  katachiNoMon,
  MAE_SOROERO,
  GRANT,
} from '../../scripts/apply-kyuryo-fuda.mjs';
import { kiridasu } from '../../scripts/apply-kyuryo-get.mjs';
import { honbunMd5, KANSUU as K4 } from '../../scripts/apply-kyuryo-pw-4keta.mjs';
import { HONBAN_REF } from '../../scripts/honban-tome.mjs';

const V = K4.find((x) => x.na === 'dk_kyuryo_verify').ato;

const SQL = fs
  .readFileSync(
    path.join(__dirname, '..', '..', 'supabase', 'apply-kyuryo-honnin-kansuu.sql'),
    'utf8'
  )
  .replace(/\r\n/g, '\n');

describe('★札を 当てる 道具の 門★', () => {
  const g = kiridasu(SQL);
  const f = kiridasuFuda(SQL);
  it('① repo の 2つの 塊に 在って ほしい 字が 全部 在る', () => {
    expect(
      kazoeruFudaGet(g)
        .aru.filter((x) => !x.ok)
        .map((x) => x.k)
    ).toEqual([]);
    expect(
      kazoeruFuda(f)
        .aru.filter((x) => !x.ok)
        .map((x) => x.k)
    ).toEqual([]);
  });
  it('② 倉庫が「揃えろ」の 版 か 当てる 版 なら 通す・知らない 版は 止める', () => {
    expect(fudaNoMon(g, f, MAE_SOROERO, V)).toEqual([]);
    expect(fudaNoMon(g, f, honbunMd5(g), V)).toEqual([]);
    expect(fudaNoMon(g, f, 'f8466f060d89895efde720ac7c7b907e', V).length).toBe(1);
  });
  it('③ 札の 枝を 抜いた get・24時間で ない fuda は 止める', () => {
    const g2 = g.replace("'fuda_kire'", "'kire'");
    expect(g2).not.toBe(g);
    expect(fudaNoMon(g2, f, MAE_SOROERO, V).length).toBeGreaterThan(0);
    const f2 = f.replace("interval '24 hours'", "interval '30 days'");
    expect(f2).not.toBe(f);
    expect(fudaNoMon(g, f2, MAE_SOROERO, V).length).toBeGreaterThan(0);
  });
  it('④ fuda の 塊に 別の 文・別の 表の 書き換え・例外 が 紛れたら 投げる', () => {
    const betsu = SQL.replace(
      "  return json_build_object('ok', true, 'name', v ->> 'name', 'fuda', v_fuda",
      "  update daikome.dk_employees set active = true;\n  return json_build_object('ok', true, 'name', v ->> 'name', 'fuda', v_fuda"
    );
    expect(betsu).not.toBe(SQL);
    expect(() => kiridasuFuda(betsu)).toThrow(/dk_employees/);
    const reigai = SQL.replace(
      '  v := public.dk_kyuryo_verify(p_token, p_pw);',
      "  v := public.dk_kyuryo_verify(p_token, p_pw);\n  raise notice 'x';"
    );
    expect(reigai).not.toBe(SQL);
    expect(() => kiridasuFuda(reigai)).toThrow(/raise/);
    const teigi = SQL.replace(
      'create or replace function public.dk_kyuryo_fuda(p_token text, p_pw text)\nreturns json\nlanguage plpgsql\nsecurity definer',
      'create or replace function public.dk_kyuryo_fuda(p_token text, p_pw text)\nreturns json\nlanguage plpgsql'
    );
    expect(teigi).not.toBe(SQL);
    expect(() => kiridasuFuda(teigi)).toThrow(/security definer/);
  });
  it('⑤ 1つの 取引で 送る（begin … commit・grant 込み）', () => {
    const j = okuruJi(g, f);
    expect(j.startsWith('begin;\n')).toBe(true);
    expect(j.endsWith('\ncommit;')).toBe(true);
    expect(j).toContain(GRANT);
  });
  it('⑥ 誰が 呼べるか：anon と authenticated が 要る', () => {
    expect(proaclNoMon('{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}')).toEqual(
      []
    );
    expect(proaclNoMon('{postgres=X/postgres,authenticated=X/postgres}').length).toBe(1);
    expect(proaclNoMon('{=X/postgres,postgres=X/postgres}').length).toBe(2);
  });
  it('⑦ 倉庫の verify が 道具に 書いた 版で ない ⇒ 止める（本番前の 対立役 N3）', () => {
    expect(fudaNoMon(g, f, MAE_SOROERO, '1d81c8812b1133ddc8f020ec09414fa3').length).toBe(1);
    expect(fudaNoMon(g, f, MAE_SOROERO, undefined).length).toBe(1);
  });
  it('⑧ --honban なのに 向き先が 本番で ない ⇒ 止める（本番前の 対立役 S1）', () => {
    expect(honbanNoMuki('khawdrnvssdenumbiwfg', ['--ateru', '--honban'])).toMatch(/本番で ない/);
    expect(honbanNoMuki(HONBAN_REF, ['--ateru', '--honban'])).toBeNull();
    expect(honbanNoMuki('khawdrnvssdenumbiwfg', ['--ateru'])).toBeNull();
  });
  it('⑨ 札の 関数の 形：security definer と search_path 固定', () => {
    expect(katachiNoMon(true, 'search_path=daikome, public, extensions')).toEqual([]);
    expect(katachiNoMon(false, 'search_path=daikome, public, extensions').length).toBe(1);
    expect(katachiNoMon(true, null).length).toBe(1);
  });
});
