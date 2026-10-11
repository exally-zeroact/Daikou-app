'use strict';
// ============================================================
// ★店データの 当たりを 施設ごとに 出す 道具（scripts/poi-kinshi-atari.mjs）の 見張り★ 2026-10-11
//   白名簿の「当たりN」は 語の 種類の 数で、施設の 数ではない＝席は この 道具で 施設ごとに 数えて 中身を 見る。
//   ★字は 出さない★・★分からない時は 止める（2）★ 事も 見る。作り物の 語と 作り物の 店データで 動かす。
//   ★わざと壊して 赤に なった 記録（10-11）★：前の 道具（cacacab0c 前）で 走らせて 4本 赤。
//     鍵から 指紋を 外す・鍵から 欄を 外す・タグ外しを 毎回に する・無い 版を 通す・repo の 外の 道を 通す の 5通りで それぞれ 1本 赤。
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const TOOL = path.join(ROOT, 'scripts', 'poi-kinshi-atari.mjs');
const GO = '見本太郎';

function mise(pois) {
  return (
    'window.POI_TEST = ' +
    JSON.stringify({ v: 2, cats: { 0: 'hotel', 80: 'bus_stop' }, pois }) +
    ';\n'
  );
}
function hashiru(args, env) {
  return spawnSync(process.execPath, [TOOL, ...args], {
    encoding: 'utf8',
    env: { ...process.env, KINSHI_JI: GO, ...env },
  });
}

describe('★店データの 当たりを 施設ごとに 出す（10-11）★', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'poi-atari-'));
  const dir = (n) => {
    const d = path.join(tmp, n);
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  const oku = (d, pois) => {
    const f = path.join(d, 'poi-x.js');
    fs.writeFileSync(f, typeof pois === 'string' ? pois : mise(pois));
    return f;
  };
  const A = { c: 0, lat: 1, lng: 2, n: GO + 'の宿' };
  const B = { c: 80, lat: 3, lng: 4, n: GO + '前' };
  const C = { c: 0, lat: 5, lng: 6, n: 'ふつうの宿' };
  const mae = dir('mae');
  const ima = dir('ima');
  oku(mae, [A, C]);
  const imaF = oku(ima, [A, B, C]);
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('同じ 語が 2つの 施設に 当たると「施設 2か所・語の 種類 1」と 出す（白名簿の 当たり1 の 中身）', () => {
    const r = hashiru([imaF]);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/施設 2か所・当たり 2・語の 種類 1/);
    expect(r.stdout).toMatch(/施設 #0・欄 n・種類 0（hotel）・一覧の 1 番目/);
    expect(r.stdout).toMatch(/施設 #1・欄 n・種類 80（bus_stop）・一覧の 1 番目/);
  });

  it('前の 版と 比べると、新しく 当たった 施設だけ「★新しい★」で 出す', () => {
    const r = hashiru([imaF, '--mae', mae]);
    expect(r.stdout).toMatch(/前の 版に 無い 当たり 1/);
    expect(r.stdout).toMatch(/★新しい★ 施設 #1・欄 n・種類 80/);
    expect(r.stdout).not.toMatch(/施設 #0・/);
  });

  it('同じ 場所・同じ 長さで 名前が 違う 施設と、二重登録は「★新しい★」で 出す（数で 比べる）', () => {
    const d = dir('kagi');
    const sasikae = { ...A, n: GO + 'の館' }; // 同じ 種類・緯度経度・名前の 長さ・中身が 違う
    const f = oku(d, [A, sasikae, A]);
    const r = hashiru([f, '--mae', mae]);
    expect(r.stdout).toMatch(/前の 版に 無い 当たり 2/);
  });

  it('前の 版と 今が 同じ ファイル・同じ 中身なら 止める（2）', () => {
    expect(hashiru([imaF, '--mae', ima]).status).toBe(2);
    const d = dir('onaji');
    oku(d, [A, B, C]);
    expect(hashiru([imaF, '--mae', d]).status).toBe(2);
  });

  it('入れ子の 欄の 当たりも 施設に 結ぶ・施設に 結べない 当たり（上の 欄）は 止める（2）', () => {
    const d = dir('ireko');
    const f = oku(d, [{ c: 0, lat: 7, lng: 8, n: 'ふつう', a: { open: GO + 'に聞く' } }]);
    const r = hashiru([f]);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/施設 #0・欄 a\.open・種類 0/);
    const d2 = dir('ue');
    const ueF = oku(
      d2,
      'window.POI_TEST = ' + JSON.stringify({ v: 2, prefecture: GO, cats: {}, pois: [C] }) + ';\n'
    );
    const r2 = hashiru([ueF]);
    expect(r2.status).toBe(2);
    expect(r2.stderr).toMatch(/施設に 結べない 当たり（一覧の 1 番目）/);
  });

  it('字は 出さない（語も 施設の 名前も・読めない ファイルの 中身も）', () => {
    const r = hashiru([imaF, '--mae', mae]);
    const d = dir('koware');
    const kowareF = oku(d, 'window.POI_TEST = {"pois":[{"n":"' + GO + '"}]x};\n');
    const r2 = hashiru([kowareF]);
    expect(r2.status).toBe(2);
    const r3 = hashiru([imaF, '--mae', d]);
    expect(r3.status).toBe(2);
    for (const x of [r, r2, r3]) {
      const dashi = x.stdout + x.stderr;
      expect(dashi).not.toContain(GO);
      expect(dashi).not.toContain('の宿');
      expect(dashi).not.toContain('ふつう');
    }
  });

  it('鍵は 欄の 字の 指紋と 欄の 道で 比べる（同じ 長さの 別の 名前・別の 欄に 移った 字は 新しい）', () => {
    const m1 = dir('k-mae');
    oku(m1, [A]);
    const n1 = dir('k-ima1');
    const f1 = oku(n1, [{ ...A, n: GO + 'の館' }]);
    expect(hashiru([f1, '--mae', m1]).stdout).toMatch(/前の 版に 無い 当たり 1/);
    const n2 = dir('k-ima2');
    const f2 = oku(n2, [{ ...A, n: 'ふつう', a: { open: A.n } }]);
    expect(hashiru([f2, '--mae', m1]).stdout).toMatch(/前の 版に 無い 当たり 1/);
  });

  it('タグの 無い「<1F」「2F>」で 施設を またいで 字が つながっても 止まらない（見張りと 同じ 条件）', () => {
    const d = dir('tag');
    const f = oku(d, [
      { c: 0, lat: 1, lng: 2, n: '見本<1F' },
      { c: 0, lat: 3, lng: 4, n: '2F>太郎' },
    ]);
    expect(hashiru([f]).status).toBe(0);
  });

  it('--mae-git：git の 前の 版と 比べる・無い 版と repo の 外の 道は 止める（2）', () => {
    const g = dir('gitrepo');
    // ★hook（pre-push）から 走る 時は git が GIT_DIR 等を 渡す＝外さないと 作り物の git が 本物の repo を 書き換える★
    //   （10-11 実測：外し忘れて 本物の 枝に 作り物の commit が 出来・索引が 替わり・主の config が 書き換わった）
    const env = { ...process.env, KINSHI_JI: GO };
    for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
    const run = (...a) => spawnSync('git', ['-C', g, ...a], { encoding: 'utf8', env });
    fs.mkdirSync(path.join(g, 'scripts'));
    fs.mkdirSync(path.join(g, 'tests'));
    fs.mkdirSync(path.join(g, 'data'));
    fs.copyFileSync(TOOL, path.join(g, 'scripts', 'poi-kinshi-atari.mjs'));
    fs.copyFileSync(
      path.join(ROOT, 'tests', 'kinshi-ji.test.mjs'),
      path.join(g, 'tests', 'kinshi-ji.test.mjs')
    );
    const gf = path.join(g, 'data', 'poi-x.js');
    fs.writeFileSync(gf, mise([A, C]));
    run('init', '-q');
    run('add', '-A');
    run(
      '-c',
      'user.name=x',
      '-c',
      'user.email=1+x@users.noreply.github.com',
      'commit',
      '-q',
      '-m',
      'mae'
    );
    fs.writeFileSync(gf, mise([A, B, C]));
    const gtool = path.join(g, 'scripts', 'poi-kinshi-atari.mjs');
    const r = spawnSync(process.execPath, [gtool, gf, '--mae-git', 'HEAD'], {
      encoding: 'utf8',
      env,
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/前の 版に 無い 当たり 1/);
    expect(r.stdout).toMatch(/★新しい★ 施設 #1・欄 n・種類 80/);
    const r2 = spawnSync(process.execPath, [gtool, gf, '--mae-git', 'HAED'], {
      encoding: 'utf8',
      env,
    });
    expect(r2.status).toBe(2);
    const r3 = spawnSync(process.execPath, [gtool, imaF, '--mae-git', 'HEAD'], {
      encoding: 'utf8',
      env,
    });
    expect(r3.status).toBe(2);
  });

  it('当たり 0 なら 終わり値 0・一覧が 無ければ 2（未測定で 通さない）', () => {
    expect(hashiru([path.join(mae, 'poi-x.js')], { KINSHI_JI: 'べつの語' }).status).toBe(0);
    const nashi = hashiru([imaF], { KINSHI_JI: '', HOME: tmp, USERPROFILE: tmp });
    expect(nashi.status).toBe(2);
  });
});
