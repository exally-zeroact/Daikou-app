'use strict';
// ============================================================
// ★★客に 届いていない事に「その場で」気づく★★ 2026-09-01
//
//   ★何が 起きたか（2026-08-31 実際に 見ました）★
//     本番ビルドを 1回に する為に vercel.json の ignoreCommand で
//     ★sw.js が 変わらない コミットは 建てない★ ようにしています。
//     ⇒ 客に 届く版を 作るのは ★版名を 付ける workflow（auto-version）★だけ。
//     実際に … 押した ビルドが ★次の push で Canceled★に なり、
//     版名の コミットが 来るまで ★実配信が 古いまま★でした（20分ほど）。
//     ★CIは 緑・push済み・でも 客は 古い物を 見ている★＝一番 気づけない 壊れ方。
//
//   ★見張りは 有ったが 1日1回★ ⇒ ★最悪 24時間 気づけません★
//   ⇒ ★版名を 付けた 直後（sw.js が 変わった push）にも 走らせます★
//     ・回数は 増やしません（版名の コミットは ★唯一の 引き金★なので そこ 1回で 足りる）
//     ・本番の ビルドは 実測 ★約4分（3:56）★ なので ★8回=8分★ 待ってから 赤に する
//
//   ★わざと壊して 実測★（下の 3本を 1つずつ 壊すと 赤に なる事を 確かめました）
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const YML = path.join(ROOT, '.github', 'workflows', 'hanmei-mihari.yml');

describe('★届いていない事に その場で 気づく★', () => {
  const y = () => fs.readFileSync(YML, 'utf8');

  it('★① 版名が 変わった時に 走る（push の 引き金が 在る）★', () => {
    const s = y();
    expect(s, '★毎日 だけに なっています（最悪 24時間 気づけません）★').toContain('push:');
    expect(s, '★sw.js の 変化を 見ていません（版名の コミットで 走りません）★').toMatch(
      /paths:[\s\S]{0,80}sw\.js/
    );
  });

  // ★★2026-10-17★★ ① の push は bot の 版名の コミット（GITHUB_TOKEN の 押し）では 起きない＝1143本で 0回 だった。
  //   版名を 付ける workflow が 終わった 時の workflow_run で 走る 事と、その 名前が auto-version.yml の name と 同じ 事を 縛る。
  //   わざと壊す：workflow_run を 消す／名前を 1字 変える／failure で 赤に しない／concurrency を 外す ⇒ ①-2 が 赤
  it('★①-2 版名を 付ける workflow が 終わった 時に 走る（bot の 押しでも 起きる 引き金）★', () => {
    const s = y();
    const av = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'auto-version.yml'), 'utf8');
    const avName = ((av.match(/^name:\s*(.+)$/m) || [])[1] || '')
      .trim()
      .replace(/^['"]|['"]$/g, '');
    expect(avName, '★auto-version.yml の name が 読めません★').toBeTruthy();
    const m = s.match(
      /workflow_run:\s*\n\s*workflows:\s*\[([^\]]*)\]\s*\n\s*types:\s*\[([^\]]*)\]/
    );
    expect(
      m,
      '★workflow_run の 引き金が ありません（bot の 版名の コミットでは 走りません）★'
    ).toBeTruthy();
    const names = m[1].split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, ''));
    expect(names, '★workflow_run の 名前が auto-version.yml の name と 合いません★').toContain(
      avName
    );
    expect(m[2], '★終わった 時（completed）で ありません★').toContain('completed');
    // 落ちた 時（failure）は 赤に する（前は「合っている」で 緑に なった・対立役 直す-2）
    expect(s, '★版名を 付ける workflow の 終わり方を 見ていません★').toMatch(
      /github\.event\.workflow_run\.conclusion \}\}" = "failure" \]; then[\s\S]{0,120}exit 1/
    );
    // 並んで 走らせない（偽の 赤・対立役 直す-1）
    expect(s, '★並んで 走ります（前の 走りが 偽の 赤を 出す）★').toMatch(
      /concurrency:\s*\n\s*group: hanmei-mihari\s*\n\s*cancel-in-progress: true/
    );
  });

  it('★② 毎日の 見張りも 残っている（push が 来ない 日も 見る）★', () => {
    expect(y(), '★毎日の 見張りが 消えています★').toContain('schedule:');
  });

  it('★★③ 本番の ビルド（実測 約4分）を 待てる長さが 在る★★', () => {
    const s = y();
    const kai = (s.match(/for i in ([0-9 ]+); do/) || [])[1];
    expect(kai, '★待つ 回数が 読めません★').toBeTruthy();
    const n = kai.trim().split(/\s+/).length;
    expect(n, '★待ちが 短すぎます（本番の ビルドは 約4分・並ぶ事も ある）★').toBeGreaterThanOrEqual(
      6
    );
    const tm = Number((s.match(/timeout-minutes:\s*(\d+)/) || [])[1]);
    expect(tm, '★待つ 時間より 打ち切りが 短いです（★必ず 途中で 切れます★）★').toBeGreaterThan(n);
  });
});
