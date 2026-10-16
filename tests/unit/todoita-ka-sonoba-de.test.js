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
const yaml = require('js-yaml');

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
  //   ★yml を 読み解いて 判じる★（前は 字の 目印で、行を # で 殺しても 緑だった・対立役 直す-3）
  //   わざと壊す：workflow_run を 消す／名前を 1字 変える／通す 終わり方に failure を 足す／ochita に concurrency を 付ける／
  //     check の concurrency を 外す／ochita の 判じの 行を # で 殺す／failure の 腕を 前に 足す／ochita の if に && false／continue-on-error を 付ける／判じの 段に if: false ⇒ ①-2 が 赤
  it('★①-2 版名を 付ける workflow が 終わった 時に 走り、落ちたら 赤（取り消されない job で）★', () => {
    const d = yaml.load(y());
    const on = d.on || d[true];
    const av = yaml.load(
      fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'auto-version.yml'), 'utf8')
    );
    expect(av.name, '★auto-version.yml の name が 読めません★').toBeTruthy();
    const wr = on && on.workflow_run;
    expect(
      wr,
      '★workflow_run の 引き金が ありません（bot の 版名の コミットでは 走りません）★'
    ).toBeTruthy();
    expect(
      wr.workflows,
      '★workflow_run の 名前が auto-version.yml の name と 合いません★'
    ).toContain(av.name);
    expect([].concat(wr.types), '★終わった 時（completed）で ありません★').toContain('completed');
    // 落ちた 事を 見る job（ochita）：取り消しの 掛からない 別の job で、通す 終わり方を 名指しする（直す-1・直す-2）
    expect(
      d.concurrency,
      '★workflow 全体に 取り消しが 掛かっています（落ちた 知らせが 消される）★'
    ).toBeFalsy();
    const o = d.jobs && d.jobs.ochita;
    expect(o, '★落ちた 事を 見る job（ochita）が ありません★').toBeTruthy();
    expect(o.concurrency, '★落ちた 事を 見る job に 取り消しが 掛かっています★').toBeFalsy();
    // 字の 全一致（「&& false」を 足すと 部分一致では 通った・対立役 直す-A）
    expect(o.if, '★workflow_run の 時に 走りません★').toBe("github.event_name == 'workflow_run'");
    // 赤を 握りつぶす 書き方が 無い 事（job・段の continue-on-error、段の if）
    expect(o['continue-on-error'], '★job の 赤が 握りつぶされます★').toBeFalsy();
    for (const st of o.steps || []) {
      expect(st['continue-on-error'], '★段の 赤が 握りつぶされます★').toBeFalsy();
      expect(st.if, '★判じの 段が 条件で 飛ばされます★').toBeUndefined();
    }
    const run = (o.steps || []).map((x) => x.run || '').join('\n');
    const env = (o.steps || []).map((x) => (x.env && x.env.OWARI) || '').join('');
    expect(env, '★終わり方（conclusion）を 読んでいません★').toContain(
      'github.event.workflow_run.conclusion'
    );
    const kaku = run
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    // case の 腕を 全部 集め、exit 1 しない 腕の 名前の 集まりが ちょうど 3つで ある 事（最初の 1行だけで 判じない・直す-A）
    const ude = [...kaku.matchAll(/^\s*([a-z_|*]+)\)\s*(.*)$/gm)].map((m) => ({
      na: m[1].split('|'),
      aka: /exit 1/.test(m[2]),
    }));
    expect(ude.length, '★case の 腕が 読めません★').toBeGreaterThan(1);
    const toosu = ude.filter((u) => !u.aka).flatMap((u) => u.na);
    expect(toosu.sort(), '★通す 終わり方が 違います（failure 等を 通していませんか）★').toEqual([
      'cancelled',
      'skipped',
      'success',
    ]);
    expect(
      ude.some((u) => u.aka && u.na.includes('*')),
      '★それ以外を 赤に していません★'
    ).toBe(true);
    // 突き合わせの job だけ 並んで 走らせない（偽の 赤）
    const c = d.jobs.check && d.jobs.check.concurrency;
    expect(
      c && c['cancel-in-progress'],
      '★突き合わせが 並んで 走ります（前の 走りが 偽の 赤を 出す）★'
    ).toBe(true);
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
    const tm = Number(yaml.load(s).jobs.check['timeout-minutes']); // 突き合わせの job の 打ち切り（10-17 ochita を 足したので 最初の 字では 読まない）
    expect(tm, '★待つ 時間より 打ち切りが 短いです（★必ず 途中で 切れます★）★').toBeGreaterThan(n);
  });
});
