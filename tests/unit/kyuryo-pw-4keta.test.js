// ★本人の パスワード 4桁・3回 続けて 間違えたら 止める★ 2026-10-20（docs/pw-4keta.md）
//   repo の SQL の 字と md5 を 縛る（当てる 道具 scripts/apply-kyuryo-pw-4keta.mjs の 門と 同じ 物）
//   ★null の 守り★（10-19 に 先に 塞いだ 穴＝`is distinct from`）を 書き直しで 落とさない（対立役 本番前 N2）
//   わざと壊す：
//     照らす 所を 古い `<>` に 戻す ⇒ ① 赤 ／ 最初の for update を 外す ⇒ ② 赤（kiridasu が 投げる）
//     verify に exception を 足す ⇒ ② 赤 ／ 4桁の 形の 門から null を 外す ⇒ ① 赤
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  KANSUU,
  kiridasu,
  kazoeru,
  honbunMd5,
  hyouToMado,
} from '../../scripts/apply-kyuryo-pw-4keta.mjs';

const ROOT = path.join(__dirname, '..', '..');
const yomu = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('★4桁・3回 続けて 間違えたら 止める★', () => {
  KANSUU.forEach((k) => {
    it('① ' + k.na + '：在って ほしい 字・md5 が 道具に 書いた 版', () => {
      const block = kiridasu(yomu(k.file), k);
      const kz = kazoeru(block, k);
      expect(kz.aru.filter((x) => !x.ok).map((x) => x.x)).toEqual([]);
      expect(kz.nai.filter((x) => !x.ok).map((x) => x.x)).toEqual([]);
      expect(honbunMd5(block)).toBe(k.ato);
    });
  });
  it('② 照らす 3本の 守り（最初が for update・exception／raise が 無い）を 外すと 投げる', () => {
    const src = yomu('supabase/apply-kyuryo-honnin-kansuu.sql').replace(/\r\n/g, '\n');
    const v = KANSUU.find((k) => k.na === 'dk_kyuryo_verify');
    const nashi = src.replace(
      "  select * into r from daikome.dk_kyuryo_pub where token = p_token for update;\n  if not found or r.pw_hash is null then\n    return json_build_object('ok', false, 'reason', 'no_token');\n  end if;\n  -- ★3回",
      "  select * into r from daikome.dk_kyuryo_pub where token = p_token;\n  if not found or r.pw_hash is null then\n    return json_build_object('ok', false, 'reason', 'no_token');\n  end if;\n  -- ★3回"
    );
    expect(nashi, '★置き換える 所が 無い（試験が 空回り）★').not.toBe(src);
    expect(() => kiridasu(nashi, v)).toThrow(/鍵/);
    const reigai = src.replace(
      "  return json_build_object('ok', true, 'name', coalesce(nm, ''));\nend;",
      "  return json_build_object('ok', true, 'name', coalesce(nm, ''));\nexception when others then\n  return null;\nend;"
    );
    expect(reigai).not.toBe(src);
    expect(() => kiridasu(reigai, v)).toThrow(/exception/);
  });
  it('③ 窓は security_invoker を 同じ 文で・表の 列は 0〜3 の 縛り', () => {
    const { alt, mado } = hyouToMado(yomu('supabase/apply-kyuryo-honnin.sql'));
    expect(mado).toMatch(/with \(security_invoker = on\) as/);
    // 式で 出す（窓から 書き換えられない）
    expect(mado).toMatch(/\(p\.pw_miss \+ 0\) as pw_miss/);
    expect(mado).toMatch(/\(p\.tomatta_at \+ interval '0 second'\) as tomatta_at/);
    expect(alt).toMatch(/check \(pw_miss between 0 and 3\)/);
  });
  // わざと壊す：apply-kyuryo-honnin.sql の revoke を 1つ 消す ⇒ ③b 赤（道具が 投げる）
  it('③b 表と 窓の 直の 権限を 外す 2文が 在る（道具が 当てる）', () => {
    const src = yomu('supabase/apply-kyuryo-honnin.sql');
    const { revoke } = hyouToMado(src);
    expect(revoke).toContain('revoke all on table daikome.dk_kyuryo_pub from anon, authenticated;');
    expect(revoke).toContain('revoke all on table public.dk_kyuryo_pub from anon, authenticated;');
    const nashi = src.replace(
      'revoke all on table daikome.dk_kyuryo_pub from anon, authenticated;\n',
      ''
    );
    expect(nashi).not.toBe(src);
    expect(() => hyouToMado(nashi)).toThrow(/直の 権限/);
  });
  it('④ 理由の 字が SQL と 画面で 同じ 組', () => {
    const sql = yomu('supabase/apply-kyuryo-honnin-kansuu.sql');
    const html = yomu('kyuryo.html');
    ['tomatta', 'pw_4keta', 'bad_pw', 'no_token', 'already_set', 'bad_init'].forEach((r) => {
      expect(sql.includes("'" + r + "'"), 'SQL に ' + r).toBe(true);
      expect(html.includes("'" + r + "'"), '画面に ' + r).toBe(true);
    });
    expect(sql.includes("'nokori'")).toBe(true);
    expect(html.includes('.nokori')).toBe(true);
  });
});
