'use strict';
// ============================================================
// ★★「赤の中身を 残す記録係」が 本当に 効いている事を 機械で 縛る★★ 2026-08-29
//
//   ★なぜ 要るか（実際に 起きた事）★
//     2026-08-29 に 全体を 18回 回して 赤が 2回 出ましたが、
//     結果が 次の回で 上書きされ ★2回とも 中身を 取り逃がしました★。
//     司さんに「原因はなんやったんど」と 聞かれて ★言えませんでした★。
//     ⇒ 記録係を 作った。★作っただけでは 回りません★ので ここで 縛ります。
//
//   ★ここで 見る事★
//     ① vitest.config.js に ちゃんと 登録されている（外したら 赤）
//     ② 赤が 出た時に 書く（file名・試験名・文言 の3つが 入っている）
//     ③ ★緑の回は 1文字も 書かない★
//     ④ ★消さずに 足す★（前の記録が 残る）
//     ⑤ ★記録に 失敗しても 試験の結果を 変えない★（書けない所を 渡しても 落ちない）
//
//   ★本物の記録(data/test-results/failures.log)は 汚しません★
//     書き出し先を 差し替えて、その回かぎりの file に 書かせます。
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const FailureRecorder = require(path.join(ROOT, 'tests', 'tools', 'failure-recorder.js'));

// ★その回かぎりの 書き出し先★（本物の記録を 汚さない）
function karinoBasho(namae) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-failrec-'));
  return path.join(dir, namae);
}

// ★vitest 4系が 渡してくる形を 真似た 偽の試験★
function nisemonoNoShiken(opts) {
  return {
    fullName: opts.namae,
    module: { moduleId: opts.file },
    result: () => ({
      state: opts.ochita ? 'failed' : 'passed',
      errors: opts.ochita ? [{ message: opts.moji }] : [],
    }),
  };
}

describe('★赤の中身を 残す記録係★', () => {
  it('① vitest.config.js に 登録されている（外したら ここが赤）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'vitest.config.js'), 'utf8');
    expect(
      src.includes('failure-recorder'),
      '★記録係が vitest.config.js から 外れています★\n' +
        '  ＝赤が出ても 中身が 残らない状態に 戻っています（2026-08-29 に それで 原因を 言えなかった）'
    ).toBe(true);
    expect(
      /new\s+FailureRecorder\s*\(/.test(src),
      '★import しただけで 使っていません★（reporters に 入れてください）'
    ).toBe(true);
  });

  it('② 赤が出たら 書く（file名・試験名・文言 の3つが 入る）', () => {
    const log = karinoBasho('a.log');
    const r = new FailureRecorder({ logPath: log });
    r.onTestCaseResult(
      nisemonoNoShiken({
        file: '/tmp/aru.test.js',
        namae: '★ためしの試験★',
        ochita: true,
        moji: 'expected 2 to be 3',
      })
    );
    r.onTestRunEnd();
    const naka = fs.readFileSync(log, 'utf8');
    expect(naka).toContain('/tmp/aru.test.js');
    expect(naka).toContain('★ためしの試験★');
    expect(naka).toContain('expected 2 to be 3');
    // ★1行に まとまっている（後で 読む人が 追える形）★
    const gyou = naka.split('\n').filter((x) => x && !x.startsWith('#'));
    expect(gyou.length).toBe(1);
    expect(gyou[0].split('\t').length).toBe(3);
  });

  it('③ ★緑の回は 1文字も 書かない★', () => {
    const log = karinoBasho('b.log');
    const r = new FailureRecorder({ logPath: log });
    r.onTestCaseResult(
      nisemonoNoShiken({ file: '/tmp/x.test.js', namae: 'みどり', ochita: false })
    );
    r.onTestRunEnd();
    expect(
      fs.existsSync(log),
      '★緑なのに 記録を 作っています★（毎回 増えると 誰も 読まなくなります）'
    ).toBe(false);
  });

  it('④ ★消さずに 足す★（前の赤が 残る）', () => {
    const log = karinoBasho('c.log');
    for (const n of ['1回目', '2回目']) {
      const r = new FailureRecorder({ logPath: log });
      r.onTestCaseResult(
        nisemonoNoShiken({ file: '/tmp/y.test.js', namae: n, ochita: true, moji: 'だめ' })
      );
      r.onTestRunEnd();
    }
    const naka = fs.readFileSync(log, 'utf8');
    expect(naka).toContain('1回目');
    expect(naka, '★前の記録を 消しています★').toContain('2回目');
    expect(naka.split('\n').filter((x) => x.startsWith('#')).length).toBe(2);
  });

  it('⑤ ★記録に 失敗しても 試験の結果を 変えない★', () => {
    // ★書けない所を 渡す★: まず file を 1つ 作り、その file の 下を 書き出し先に する
    //   （file の 下に 入れ物は 作れない＝記録係の中で 必ず 失敗します）
    const jamamono = karinoBasho('d.log');
    fs.writeFileSync(jamamono, 'これは file です', 'utf8');
    const tsukaenai = path.join(jamamono, 'muri', 'e.log');
    const r = new FailureRecorder({ logPath: tsukaenai });
    r.onTestCaseResult(
      nisemonoNoShiken({ file: '/tmp/z.test.js', namae: 'む', ochita: true, moji: 'だめ' })
    );
    expect(
      () => r.onTestRunEnd(),
      '★記録に失敗した時に 例外を 投げています★＝記録の為に 試験を 落とすのは 本末転倒'
    ).not.toThrow();
  });
});
