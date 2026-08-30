'use strict';
// ============================================================
// ★★道路データは「変わった県だけ」積む★★ 2026-08-31
//
//   ★どちらの物差しか★
//     ★距離でも 料金でも ありません★。★お金（Vercel の 請求）★を 見ます。
//     タクシー認定モードでも 代行モード（係数1.0085・検定対象外・DM Light基準）でも 同じ
//     ＝この試験は ★物差しを 選びません★。
//     ★課金距離は OBD の 速度と GPS の 位置で 出しており、道路データは 使いません★
//     （2026-08-31 実測: 0610-Android を 道路データ 無しで 走らせても 同じ 距離）。
//
//   ★司さん（2026-08-31）★
//     「そもそもなんで全部やりよんど／変わったとこだけでええやろが」
//     「そんな頻繁に道路は変わるか？」
//
//   ★実測★
//     ・道は ★1週で 0.05%★ しか 変わらない（全国 624万本のうち 3,169本）
//     ・なのに 毎週 ★45県／198MB★ を 履歴に 積んでいた
//     ・理由 … base64+varint の 一続きの 塊なので ★道が1本 変わると 全部 ずれる★
//       （実測: 頭から 同じ 0.00MB／後ろから 同じ 0.00MB＝★1バイト目から 別物★）
//     ・⇒ clone が ★毎週 +6.5秒★ 増え続けていた
//
//   ★直した形★
//     ①頻度 … ★毎週日曜 → 毎月1日★
//     ②積み方 … ★変わり方が しきい値(0.2%)未満の県は 前の物に 戻す＝積まない★
//     ★実測（2026-08-22→08-29 の 本物の 更新で 再現）★
//       ★積む 2県 7.6MB／戻す 45県 196.0MB★＝★26分の1★
//
//   ★ここで 見る事★
//     ①道具が 在る
//     ②仕組みが その道具を 呼んでいる（★積む前に★）
//     ③頻度が 月1に なっている
//     ④★迷ったら 積む★（前が 無い県）
//     ⑤★しきい値の 両側で 判定が 変わる★（0.2% の 上下）
//     ⑥★本数が 読めない時も 積む★（形が 変わった 時に 古いまま 放置しない）
//     ⑦★客が 読む 形は 何も 変えていない★（build-roads.js に 触っていない）
// ============================================================
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const TOOL = path.join(ROOT, 'scripts', 'osm-kawatta-dake.js');
const YML = path.join(ROOT, '.github', 'workflows', 'osm-update.yml');

// ★試しに 作る 道路ファイルの 中身★
//   n が null … ★本数(numRoads)を 書かない★（形が 変わった 時の 見立て）
function atama(n) {
  const uso = n === null ? 'B'.repeat(200) : 'A'.repeat(200);
  const naka =
    n === null
      ? '{"v":8,"data":"' + uso + '"}'
      : '{"v":7,"numRoads":' + n + ',"data":"' + uso + '"}';
  return '// x\nwindow.ROADS_TEST = ' + naka + ';\n';
}

// ★本物の 走らせ方で 測る（字を 読むだけに しない）★
//   返り値 … '積む' / '戻す' / '★ちぐはぐ★…'
function tameshi(mae, ato, shikii) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-'));

  // ★★2026-08-31 事故（実際に 起きました）★★
  //   この試験が ★本物の repo に commit してしまい★、
  //   枝の 頭が「mae」に なって 索引が 飛びました（戻しました）。
  //   ⇒★試験が 本物の repo を 触れない形に します★
  //     ①作った 場所が repo の 中なら ★その場で 止める★
  //     ②git に ★見る場所を 名指しで 渡す★（GIT_DIR / GIT_WORK_TREE）
  //     ③★hooks を 使わない★（pre-commit が 走ると 何が 起きるか 分からない）
  if (path.resolve(dir).startsWith(path.resolve(ROOT))) {
    throw new Error('★試しの 置き場が repo の 中です（本物を 触る恐れ）: ' + dir + '★');
  }
  const kankyo = Object.assign({}, process.env, {
    GIT_DIR: path.join(dir, '.git'),
    GIT_WORK_TREE: dir,
    GIT_CONFIG_NOSYSTEM: '1',
    HOME: dir,
  });
  const g = (a) =>
    execFileSync('git', ['-c', 'core.hooksPath=' + path.join(dir, 'nohooks')].concat(a), {
      cwd: dir,
      stdio: 'pipe',
      env: kankyo,
    });
  fs.mkdirSync(path.join(dir, 'data'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.copyFileSync(TOOL, path.join(dir, 'scripts', 'osm-kawatta-dake.js'));
  g(['init', '-q']);
  g(['config', 'user.email', 'x@example.com']);
  g(['config', 'user.name', 'x']);
  if (mae !== null) {
    fs.writeFileSync(path.join(dir, 'data', 'roads-test.js'), atama(mae));
  } else {
    fs.writeFileSync(path.join(dir, 'README'), 'x');
  }
  g(['add', '-A']);
  g(['commit', '-q', '-m', 'mae']);
  fs.writeFileSync(path.join(dir, 'data', 'roads-test.js'), atama(ato));

  // ★★2026-08-31（わざと壊して 分かった）★★
  //   前は「ファイルの 中身が 新しい方か」だけ 見ていました。
  //   ⇒★前が 無い県では「積む」と「何も しない」が 見分けられません★（緑のままだった）
  //   ⇒★道具が 出した 字（積む県の 数）でも 見ます★
  const deta = execFileSync('node', ['scripts/osm-kawatta-dake.js', 'HEAD', String(shikii)], {
    cwd: dir,
    stdio: 'pipe',
    env: kankyo,
  }).toString('utf8');
  const nakami = fs.readFileSync(path.join(dir, 'data', 'roads-test.js'), 'utf8');

  const atarashii =
    ato === null ? nakami.indexOf('"v":8') >= 0 : nakami.indexOf('"numRoads":' + ato) >= 0;
  const kazu = /積む県 … (\d+) 県/.exec(deta);
  const itta = !!(kazu && Number(kazu[1]) === 1);

  if (atarashii && itta) return '積む';
  if (!atarashii && !itta) return '戻す';
  return '★ちぐはぐ★ 中身=' + (atarashii ? '新' : '旧') + ' 言った事=' + (itta ? '積む' : '戻す');
}

describe('★道路データは「変わった県だけ」積む（Vercel の お金）★', () => {
  it('★① 道具が 在る★', () => {
    expect(fs.existsSync(TOOL), '★道具が ありません★').toBe(true);
  });

  it('★② 仕組みが その道具を 呼んでいる（積む前に）★', () => {
    const y = fs.readFileSync(YML, 'utf8');
    expect(y, '★仕組みが 道具を 呼んでいません★').toContain('scripts/osm-kawatta-dake.js');
    const yobu = y.indexOf('osm-kawatta-dake.js');
    const tsumu = y.indexOf('git add data/');
    expect(yobu, '★道具を 呼ぶ 段が ありません★').toBeGreaterThan(0);
    expect(tsumu, '★積む 段が ありません★').toBeGreaterThan(0);
    expect(yobu, '★積んだ 後に 呼んでいます（手遅れ）★').toBeLessThan(tsumu);
  });

  it('★③ 頻度が 月1に なっている★', () => {
    const y = fs.readFileSync(YML, 'utf8');
    const m = /- cron: '([^']+)'/.exec(y);
    expect(m, '★決まった 日時が ありません★').toBeTruthy();
    const f = m[1].trim().split(/\s+/);
    expect(f[2], '★毎月1回に なっていません（日が * のまま）★').not.toBe('*');
    expect(f[4], '★曜日で 毎週に 戻っています★').toBe('*');
  });

  it('★★④ 迷ったら 積む（前が 無い県は 必ず 積む）★★', () => {
    expect(tameshi(null, 1000, 0.2), '★新しい県を 積んでいません★').toBe('積む');
  });

  it('★★⑤ しきい値の 両側で 判定が 変わる（0.2%）★★', () => {
    expect(tameshi(100000, 100199, 0.2), '★しきい値の 内側を 積んでいます★').toBe('戻す');
    expect(tameshi(100000, 100200, 0.2), '★しきい値ちょうどを 積んでいません★').toBe('積む');
    expect(tameshi(100000, 101000, 0.2), '★1%も 変わったのに 積んでいません★').toBe('積む');
  });

  // ★★2026-08-31（わざと壊して 分かった）★★
  //   「本数が 読めない → 必ず 積む」の 段を 消しても ★緑のまま★でした。
  //   ⇒ 調べたら、null が 数として 0 に なり ★100% 変化★と 見なされて
  //     結局 積まれていました（★安全側に 倒れている＝結果は 正しい★）。
  //   ⇒★結果だけ 見ても この段の 有無は 分かりません★ので、
  //     ★段が 在る事★と ★理由を そう 言う事★の 両方を 見ます。
  it('★★⑥ 本数が 読めない時も 積む（古いまま 放置しない）★★', () => {
    expect(tameshi(100000, null, 0.2), '★本数が 読めないのに 積んでいません★').toBe('積む');
    // ★その 道が コードに 在る事★（安全側の 倒れ方に 頼らない）
    const src = fs.readFileSync(TOOL, 'utf8');
    expect(
      /a === null \|\| b === null/.test(src),
      '★「本数が 読めない」を 見る 段が ありません（たまたま 積まれているだけ）★'
    ).toBe(true);
    expect(src, '★理由を そう 言っていません★').toContain('★本数が 読めない★');
  });

  it('★⑦ 客が 読む 形は 何も 変えていない★', () => {
    const src = fs.readFileSync(TOOL, 'utf8');
    expect(src.includes('build-roads'), '★作る道具に 手を 入れています★').toBe(false);
    expect(src, '★前の中身で 書き戻す 作りに なっていません★').toContain('fs.writeFileSync');
    expect(src, '★前の中身を 取っていません★').toContain("git(['show'");
  });
});
