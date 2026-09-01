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
