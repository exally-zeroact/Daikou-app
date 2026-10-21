// ★外した 明細の 記録の 表を 当てる 道具の 門★ 2026-10-22（scripts/apply-dk-meisai-hazushi.mjs・対立役 止1）
//   revoke を 抜いた 紙・消す 字が 在る 紙は 当てない／読み戻した 形で 1つでも 開いていれば ★NG★／
//   --honban なのに 本番で ない 向き先は 止める
//   わざと壊す：下の 判じの 1つを 外す ⇒ どれかが 赤
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { okuruJi, katachiNoMon, honbanNoMuki } from '../../scripts/apply-dk-meisai-hazushi.mjs';
import { HONBAN_REF } from '../../scripts/honban-tome.mjs';

const SQL = fs.readFileSync(
  path.join(__dirname, '..', '..', 'supabase', 'apply-dk-meisai-hazushi.sql'),
  'utf8'
);
const YOI = {
  rls: true,
  hoshin: 0,
  t_anon_s: false,
  t_anon_i: false,
  t_auth_s: false,
  t_auth_i: false,
  v_anon_s: false,
  v_anon_i: false,
  v_auth_s: false,
  v_auth_i: false,
  t_sr_s: true,
  t_sr_i: true,
  v_sr_s: true,
  v_sr_i: true,
  invoker: true,
};

describe('★記録の 表を 当てる 道具の 門★', () => {
  it('① repo の 紙は 1つの 取引で 送り、名簿の 読み直しを 足す', () => {
    const j = okuruJi(SQL);
    expect(j.startsWith('begin;\n')).toBe(true);
    expect(j.endsWith('\ncommit;')).toBe(true);
    expect(j).toContain("notify pgrst, 'reload schema';");
  });
  it('② revoke を 抜いた 紙・消す 字が 在る 紙は 当てない', () => {
    const nuki = SQL.replace(
      'revoke all on daikome.dk_meisai_hazushi from anon, authenticated;',
      ''
    );
    expect(nuki).not.toBe(SQL);
    expect(() => okuruJi(nuki)).toThrow(/revoke/);
    const nuki2 = SQL.replace(
      'revoke all on public.dk_meisai_hazushi from anon, authenticated;',
      ''
    );
    expect(nuki2).not.toBe(SQL);
    expect(() => okuruJi(nuki2)).toThrow(/revoke/);
    expect(() => okuruJi(SQL + '\ndrop table daikome.dk_meisai_hazushi;')).toThrow(/消す/);
  });
  it('③ 読み戻した 形：全部 閉じていれば OK・1つでも 開いていれば 止める', () => {
    expect(katachiNoMon(YOI)).toEqual([]);
    expect(katachiNoMon({ ...YOI, t_anon_s: true }).length).toBe(1);
    expect(katachiNoMon({ ...YOI, v_auth_i: true }).length).toBe(1);
    expect(katachiNoMon({ ...YOI, rls: false }).length).toBe(1);
    expect(katachiNoMon({ ...YOI, hoshin: 1 }).length).toBe(1);
    expect(katachiNoMon({ ...YOI, invoker: false }).length).toBe(1);
    expect(katachiNoMon({ ...YOI, t_sr_i: false }).length).toBe(1);
    expect(katachiNoMon(null).length).toBe(1);
  });
  it('④ --honban なのに 向き先が 本番で ない ⇒ 止める', () => {
    expect(honbanNoMuki('khawdrnvssdenumbiwfg', ['--ateru', '--honban'])).toMatch(/本番で ない/);
    expect(honbanNoMuki(HONBAN_REF, ['--ateru', '--honban'])).toBeNull();
    expect(honbanNoMuki('khawdrnvssdenumbiwfg', ['--ateru'])).toBeNull();
  });
});
