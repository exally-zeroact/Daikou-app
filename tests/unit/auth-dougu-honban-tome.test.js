'use strict';
// ============================================================
// ★ログインの設定を 当てる 道具 2本（auth-mail-otp・auth-redirect-allow）の 本番の 止めを、
//   道具を 本当に 走らせて 縛る★ 2026-11-01
//   前は 2本とも honban-tome を 通らず、既定（本番＋テスト）で --apply を 打つと
//   ★本番の Auth に そのまま PATCH★ した（Rakunally 席の odan 候補→中身で 確かめた）。
//   ここでは fetch を 偽物に 替えて 子で 走らせ、★倉庫へ 向かった 数★ を 倉庫ごと・押し方ごとに 数える
//   （偽の fetch は 何も 送らない・鍵も 作り物）。
//     本番・--honban 無し＝本番へ 1回も 向かわない（読みにも 行かない）・終わり値 3
//     本番・--honban 付き＝本番へ PATCH 1回（止めが 道を 塞いでいる 証し）
//     既定（両方）・--honban 無し＝テストだけ 当たり 本番は 0回・終わり値 3
//     見るだけ＝本番も 読む（読むだけは 止めない）・PATCH 0回
//   ★わざと壊して 赤に なった 記録（2026-11-01）★
//     直す前の 2本に 戻す＝5本 赤（2本の「--honban 無し」「既定（両方）」＋ redirect の「PATCH 失敗」）
//     2本の `if (tome)` を `if (false)` に＝4本 赤（2本の「--honban 無し」「既定（両方）」）
//     redirect の 最後の process.exitCode = 0 の 上書きを 戻す＝3本 赤（redirect の 止め 2本＋「PATCH 失敗」）
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const HON = 'tnfwipbgfgjaymlszeid';
const TEST = 'khawdrnvssdenumbiwfg';

const NISE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-tome-'));
afterAll(() => fs.rmSync(NISE_DIR, { recursive: true, force: true }));

// ★偽の fetch★ 呼ばれた 向き・倉庫を 1行 出す。GET は 空の 設定を 返し、PATCH の 後は その 中身を 返す。
//   NISE_PATCH_NG=1 の 時は PATCH を 失敗（500）に する。
function niseFetch() {
  const f = path.join(NISE_DIR, 'nise-fetch.mjs');
  fs.writeFileSync(
    f,
    [
      'const kura = {};',
      'globalThis.fetch = async (u, o = {}) => {',
      "  const m = (o.method || 'GET').toUpperCase();",
      "  const ref = (String(u).match(/projects\\/([a-z0-9]+)\\//) || [])[1] || '?';",
      "  process.stdout.write('NISE_FETCH ' + m + ' ' + ref + '\\n');",
      "  if (m === 'GET' && process.env.NISE_GET_NG === '1')",
      '    return { ok: false, status: 429, text: async () => \'{"message":"nise"}\', json: async () => ({ message: \'nise\' }) };',
      "  if (m === 'GET' && process.env.NISE_GET_KATACHI === '1')",
      "    return { ok: true, status: 200, text: async () => '{}', json: async () => ({ message: 'nise' }) };",
      "  if (m === 'GET' && process.env.NISE_GET_NULL === '1')",
      "    return { ok: true, status: 200, text: async () => '{}', json: async () => ({ site_url: 'x', uri_allow_list: null }) };",
      "  if (m === 'GET' && process.env.NISE_ATO_GET_NG === '1' && kura[ref])",
      "    return { ok: false, status: 429, text: async () => '{}', json: async () => ({ message: 'nise' }) };",
      "  if (m === 'PATCH' && process.env.NISE_PATCH_NG === '1')",
      "    return { ok: false, status: 500, text: async () => 'nise', json: async () => ({}) };",
      "  if (m === 'PATCH') kura[ref] = Object.assign({}, kura[ref], JSON.parse(o.body));",
      "  const body = Object.assign({ site_url: 'https://nise.example', uri_allow_list: '', mailer_templates_magic_link_content: '' }, kura[ref]);",
      '  return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body };',
      '};',
      '',
    ].join('\n')
  );
  return f;
}
const NISE = niseFetch();

function hashiru(dougu, hiki, env = {}) {
  const r = spawnSync(
    process.execPath,
    ['--import', pathToFileURL(NISE).href, path.join(ROOT, 'scripts', dougu), ...hiki],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: Object.assign({}, process.env, { SUPABASE_ACCESS_TOKEN: 'sbp_tsukurimono' }, env),
    }
  );
  const kazu = (m, ref) =>
    (r.stdout.match(new RegExp('^NISE_FETCH ' + m + ' ' + ref + '$', 'gm')) || []).length;
  return {
    status: r.status,
    out: r.stdout + r.stderr,
    honGet: kazu('GET', HON),
    honPatch: kazu('PATCH', HON),
    testPatch: kazu('PATCH', TEST),
    honZenbu: kazu('[A-Z]+', HON),
  };
}

describe(
  '★ログインの設定の 道具 2本の 本番の 止め（子で 走らせて 数える）★',
  { timeout: 60000 },
  () => {
    for (const dougu of ['auth-mail-otp.mjs', 'auth-redirect-allow.mjs']) {
      it(dougu + '：--prod --apply（--honban 無し）＝本番へ 1回も 向かわず 止まる', () => {
        const r = hashiru(dougu, ['--prod', '--apply']);
        expect(r.honZenbu, r.out).toBe(0);
        expect(r.status, r.out).toBe(3);
        expect(r.out).toContain('--honban');
      });
      it(
        dougu + '：--prod --apply --honban＝本番へ PATCH 1回（止めが 道を 塞いでいる 証し）',
        () => {
          const r = hashiru(dougu, ['--prod', '--apply', '--honban']);
          expect(r.honPatch, r.out).toBe(1);
          expect(r.status, r.out).toBe(0);
        }
      );
      it(dougu + '：--test --apply＝テストへ PATCH 1回', () => {
        const r = hashiru(dougu, ['--test', '--apply']);
        expect(r.testPatch, r.out).toBe(1);
        expect(r.honZenbu, r.out).toBe(0);
        expect(r.status, r.out).toBe(0);
      });
      it(
        dougu + '：既定（両方）--apply・--honban 無し＝テストだけ 当たり 本番は 0回・終わり値 3',
        () => {
          const r = hashiru(dougu, ['--apply']);
          expect(r.testPatch, r.out).toBe(1);
          expect(r.honZenbu, r.out).toBe(0);
          expect(r.status, r.out).toBe(3);
        }
      );
      it(dougu + '：見るだけ＝本番も 読む・PATCH 0回（読むだけは 止めない）', () => {
        const r = hashiru(dougu, ['--prod']);
        expect(r.honGet, r.out).toBe(1);
        expect(r.honPatch, r.out).toBe(0);
      });
      it(dougu + '：PATCH が 失敗した 時＝終わり値が 0 に ならない', () => {
        const r = hashiru(dougu, ['--test', '--apply'], { NISE_PATCH_NG: '1' });
        expect(r.testPatch, r.out).toBe(1);
        expect(r.status, r.out).toBe(1);
      });
    }

    // ★2026-11-01 対立役 注意★ 今の設定を 読めない 時に、許可リストを 丸ごと 置き換えない
    //   わざと壊した 記録は 下の 4本の 後の 行に 書いた
    it('auth-redirect-allow.mjs：今の設定を 読めない（429）＝PATCH 0回・終わり値 1', () => {
      const r = hashiru('auth-redirect-allow.mjs', ['--test', '--apply'], { NISE_GET_NG: '1' });
      expect(r.testPatch, r.out).toBe(0);
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain('読めませんでした');
    });
    it('auth-redirect-allow.mjs：200 でも 許可リストの 欄が 無い＝PATCH 0回・終わり値 1', () => {
      const r = hashiru('auth-redirect-allow.mjs', ['--test', '--apply'], {
        NISE_GET_KATACHI: '1',
      });
      expect(r.testPatch, r.out).toBe(0);
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain('読めませんでした');
    });
    it('auth-redirect-allow.mjs：許可リストが null＝空と 見て 書かない（PATCH 0回・終わり値 1）', () => {
      const r = hashiru('auth-redirect-allow.mjs', ['--test', '--apply'], { NISE_GET_NULL: '1' });
      expect(r.testPatch, r.out).toBe(0);
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain('読めませんでした');
    });
    it('auth-redirect-allow.mjs：足した後の 読み直しが 429＝落ちずに 知らせて 終わり値 1', () => {
      const r = hashiru('auth-redirect-allow.mjs', ['--test', '--apply'], { NISE_ATO_GET_NG: '1' });
      expect(r.testPatch, r.out).toBe(1);
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain('足した後の 設定を 読めませんでした');
      expect(r.out).not.toContain('TypeError');
    });
    // わざと壊した 記録（2026-11-01）：直す前の 道具に 戻す＝上の 4本 赤／null を 通す（in cur に 戻す）＝null の 1本 赤／足した後の 止めを 外す＝読み直しの 1本 赤
  }
);
