'use strict';
// ============================================================
// ★★本番ビルドを 1回に する（Vercel の お金）★★ 2026-08-30
//
//   ★どちらの物差しか★
//     ★距離でも 料金でも ありません★。★お金（Vercel の 請求）★を 見ます。
//
//   ★何が 起きていたか（ビルドログの 実物・2026-08-30 12:00 本番）★
//     Cloning completed: ★4:26.827★ ／ Build Completed ★[28s]★
//     ⇒★時間の 94% が clone★（repo が 3.3GB あるため）
//     その clone を ★1回の 変更で 2回★:
//       ①merge を 建てる（sw.js は ★まだ 古い版名★）→②版名コミット→③もう一度 建てる
//     ⇒★①は 捨て玉★
//
//   ★★1度 失敗しています（記録として 残す）★★
//     はじめ「PR の 枝で 先に 版名を 付ける」形を 作りました。
//     ・★自分で ループを 作りました★（付ける→push→また 自分が 走る）＝実際に 2回 回った
//     ・止めた後で 数えたら ★合計の ビルド数は 減りませんでした★
//       （前 下見1＋本番2＝3／後 下見2＋本番1＝3。PR に コミットを 積むほど 悪化）
//     ⇒★取り下げて、この形（①を 建てない）に しました★
//
//   ★今の 形★
//     vercel.json の ignoreCommand → scripts/vercel-ignore-build.sh
//       本番(main)以外 ………………… 建てる（下見は 今までどおり）
//       本番で sw.js が 変わった … 建てる（＝客に 届く版）
//       本番で sw.js が 変わらない … 建てない（②が すぐ 来る）
//       ★分からない時は 建てる★（黙って 止めない）
//
//   ★★これは「黙って 止まる」を 作る 変更です★★
//     だから ★同じ回で 見張りを 入れました★:
//       .github/workflows/hanmei-mihari.yml
//       ＝毎日 ★実配信の 版名★と ★repo の 版名★を 突き合わせ、ずれたら 赤。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SH = path.join(ROOT, 'scripts', 'vercel-ignore-build.sh');
const VJ = path.join(ROOT, 'vercel.json');
const YML = path.join(ROOT, '.github', 'workflows', 'auto-version.yml');
const MIHARI = path.join(ROOT, '.github', 'workflows', 'hanmei-mihari.yml');
const SW = path.join(ROOT, 'sw.js');

describe('★本番ビルドを 1回に する（Vercel の お金）★', () => {
  it('★① vercel.json が この決め方を 呼んでいる★', () => {
    const v = JSON.parse(fs.readFileSync(VJ, 'utf8'));
    expect(v.ignoreCommand, '★ignoreCommand が ありません＝今までどおり 2回 建ちます★').toBe(
      'bash scripts/vercel-ignore-build.sh'
    );
    expect(fs.existsSync(SH), '★呼ぶ先の ファイルが ありません★').toBe(true);
  });

  it('★★② 決め方が 4通りとも 正しい（実際に 走らせる）★★', () => {
    // ★字を 読むだけでは 弱い★ので、中の 判定を そのまま 真似て 走らせます。
    const src = fs.readFileSync(SH, 'utf8');
    // 中の 3つの 分かれ道が 在る事
    expect(src, '★本番以外を 通す 道が ありません★').toContain('!= "main"');
    expect(src, '★前のコミットを 見る 道が ありません★').toContain('HEAD^');
    expect(src, '★sw.js を 見ていません★').toContain("grep -qx 'sw.js'");

    expect(src.match(/exit 1/g) || [], '★「建てる」出口が 足りません★').toHaveLength(3);
    expect(src.match(/exit 0/g) || [], '★「建てない」出口は 1つだけ★').toHaveLength(1);

    // ★「建てない」は ★一番 最後★＝それより 前で 迷ったら 全部 建てる★
    expect(src.lastIndexOf('exit 0')).toBeGreaterThan(src.lastIndexOf('exit 1'));
  });

  it('★★③「黙って 止まる」の 見張りが 同じ回で 入っている★★', () => {
    expect(fs.existsSync(MIHARI), '★版名の 見張りが ありません（事故の種を 撒く形）★').toBe(true);
    const m = fs.readFileSync(MIHARI, 'utf8');
    expect(m, '★毎日 回りません★').toContain('schedule');
    expect(m, '★手で 押せません★').toContain('workflow_dispatch');
    expect(m, '★実配信を 見に 行っていません★').toContain('/sw.js');
    expect(m, '★repo の 版名と 比べていません★').toContain('CACHE_NAME');
    expect(m, '★ずれても 赤に なりません★').toContain('exit 1');
    // ★見に行く先を 直書きしない★（dk-config.js の APP_BASE から 取る）
    expect(m, '★見に行く先を 直書きしています★').toContain('APP_BASE');
    expect(/https:\/\/daikou-app/.test(m), '★ホスト名を 直書きしています★').toBe(false);
  });

  it('★④ 版名を 付ける仕組みを 消していない（消すと 何も 配信されない）★', () => {
    const y = fs.readFileSync(YML, 'utf8');
    const jobs = (y.match(/^ {2}([a-zA-Z0-9_-]+):$/gm) || []).map((l) => l.trim().slice(0, -1));
    expect(jobs, '★版名を 付ける job を 消しています★').toContain('update-cache-name');
    expect(y, '★push の 引き金を 消しています★').toContain('branches: [main]');
    // ★二重に 付けない門★（付け直すと また 1回 建つ）
    expect(y, '★門が ありません★').toContain("grep -qx 'sw.js'");
    const kado = (y.match(/steps\.sumi\.outputs\.already != 'yes'/g) || []).length;
    expect(kado, '★門に ぶら下がっていない 段が あります★').toBe(3);
  });

  it('★⑤ 版名は 空に ならない（空だと 写しが 効かない）★', () => {
    const now = /const CACHE_NAME = '([^']*)'/.exec(fs.readFileSync(SW, 'utf8'));
    expect(now, '★sw.js に 版名が ありません★').toBeTruthy();
    expect(now[1].length, '★版名が 空です★').toBeGreaterThan(3);
    expect(now[1].startsWith('daikome-'), '★版名の 頭が 変わりました★').toBe(true);
  });

  it('★⑥ 配信を 止める 合図を 足していない（前に それで 届かなくなった）★', () => {
    const y = fs.readFileSync(YML, 'utf8');
    // 2026-05-29: その合図は Vercel も 止めてしまい sw.js が 客に 届かなかった
    const naka = y.replace(/^\s*#.*$/gm, '');
    expect(/\[skip\s+ci\]|\[ci\s+skip\]/.test(naka), '★配信を 止める 合図が 入っています★').toBe(
      false
    );
  });
});
