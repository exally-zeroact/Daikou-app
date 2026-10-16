'use strict';
// ============================================================
// ★poi-update の 積み直し（push 拒否→main の 先端へ cherry-pick）の 後は 見張りを もう一度 回し、赤なら push しない★ 2026-10-16
//   commit の 段は `set +e`（bash {0}）なので、`if !`・`break` を 外して 素の `bash scripts/kinshi-tsutsumu.sh` に すると
//   終わり値が 黙って 捨てられ、赤の 木を push する（対立役 W-a：段の 試験は「包みを 呼ぶか」「|| true」しか 見ない）。
//   ★見る 事★（注釈の 行は 外して 見る）
//     1. cherry-pick が 通った 枝で、包みを `if ! bash scripts/kinshi-tsutsumu.sh; then` で 呼び、その then の 直下に break
//        （then の 中に 別の if・continue が 無い）
//     2. push の やり直しの 輪の 中に continue が 無い（赤で 輪の 頭へ 戻って 押さない）
//     3. push_ok=1 を 立てるのは `git push … && { push_ok=1; …; break; }` の 1か所 だけ（引用符つき・別の 行でも 数える）
//     4. 輪の 後に `if [ "$push_ok" != "1" ]` が 在り、その 中で exit 1（押せなかったのに 緑で 黙らない）
//   ★わざと壊して 赤に なった 記録（2026-10-16）★
//     素の 1行に／then の break を 消す／break の 前に continue／break を then の 中の 別の if に／fi の 後に push_ok=1／
//     push_ok="1"／最後の exit 1 を 消す → どれも 1本 赤
// ============================================================
const fs = require('fs');
const path = require('path');

const YML = path.resolve(__dirname, '..', '..', '.github', 'workflows', 'poi-update.yml');

function commitNoDan() {
  const y = fs.readFileSync(YML, 'utf8').replace(/\r\n/g, '\n');
  const a = y.indexOf('- name: 自動コミット & プッシュ');
  const b = y.indexOf('\n      - name: ', a + 1);
  if (a < 0 || b < 0) return null;
  // 注釈の 行（# で 始まる）を 外す
  return y
    .slice(a, b)
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
}

describe('★積み直した 後の 見張り★', () => {
  const dan = commitNoDan();
  it('commit の 段が 読める', () => {
    expect(dan, '自動コミットの 段が 無い').toBeTruthy();
  });

  it('1. cherry-pick が 通った 枝で 包みを if ! で 呼び、then の 直下で break', () => {
    const a = dan.indexOf('if git cherry-pick "$MY_COMMIT"');
    expect(a, 'cherry-pick の 枝が 無い').toBeGreaterThan(0);
    const b = dan.indexOf('\n            else\n', a);
    expect(b, 'cherry-pick の 枝の 終わり（else）が 無い').toBeGreaterThan(a);
    const eda = dan.slice(a, b + 1);
    const m = /\n(\s*)if ! bash scripts\/kinshi-tsutsumu\.sh; then\n([\s\S]*?)\n\1fi\n/.exec(eda);
    expect(m, '★積み直した 後に 包みを if ! で 呼んでいない＝赤でも push する★').toBeTruthy();
    const naka = m[2]
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    expect(naka, '★赤の 時に break で 抜けていない★').toContain('break');
    expect(
      naka.some((l) => /^(if|for|while|case)\b|\bcontinue\b/.test(l)),
      '★then の 中に 別の if・continue が 在る★'
    ).toBe(false);
  });

  it('1b. cherry-pick が ぶつかった 枝（else）でも abort の 後に break（抜けないと 次の git push が up-to-date で 0 を 返し 押した 事に なる）', () => {
    const a = dan.indexOf('if git cherry-pick "$MY_COMMIT"');
    const b = dan.indexOf('\n            else\n', a);
    const c = dan.indexOf('\n            fi\n', b);
    expect(b > a && c > b, 'ぶつかった 枝が 読めない').toBe(true);
    const naka = dan
      .slice(b, c)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    expect(naka, '★ぶつかった 時に break で 抜けていない★').toContain('break');
    expect(
      naka.some((l) => /\bcontinue\b|^exit 0\b/.test(l)),
      '★ぶつかった 枝に continue・exit 0★'
    ).toBe(false);
  });

  it('2. push の やり直しの 輪の 中に continue が 無い', () => {
    const a = dan.indexOf('for i in');
    const b = dan.indexOf('\n          done', a);
    expect(a > 0 && b > a, 'push の 輪が 無い').toBe(true);
    expect(dan.slice(a, b), '★輪の 中に continue が 在る★').not.toMatch(/\bcontinue\b/);
  });

  it('3. push_ok=1 を 立てるのは git push … && の 1か所 だけ', () => {
    const tateru = dan.split('\n').filter((l) => /push_ok\s*=\s*["']?1["']?/.test(l));
    expect(tateru.length, '★push_ok=1 を 立てる 所が 1つで ない★').toBe(1);
    expect(tateru[0], '★push_ok=1 を git push の 成功 以外で 立てている★').toMatch(
      /git push[^\n]*&&\s*\{\s*push_ok=1;/
    );
  });

  it('4. 輪の 後で push_ok が 1 で なければ exit 1', () => {
    const a = dan.indexOf('\n          done');
    const m = /if \[ "\$push_ok" != "1" \]; then\n([\s\S]*?)\n\s*fi/.exec(dan.slice(a));
    expect(m, '★押せなかった 時の 確かめが 無い★').toBeTruthy();
    expect(m[1], '★押せなかった のに exit 1 が 無い＝緑で 黙る★').toMatch(/^\s*exit 1\s*$/m);
  });
});
