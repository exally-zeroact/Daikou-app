'use strict';
// ============================================================
// ★サービスワーカーが「身代わりにメーターを返す」のを禁止する 2026-08-01★
//
//   司さんの報告「どのURLもここにしかいかんけど」の真因。
//     旧: ネットに失敗すると navigationHandler が caches.match('/') を返していた
//         → /dashboard.html を開いても ★メーター(/)が出る★。
//         電波が一瞬揺れるだけで起きるうえ、アドレスバーは /dashboard.html のままなので
//         「URLが効いていない」ようにしか見えない。原因が一番分かりにくい形の事故。
//
//   ★このテストは恒久★ 同じ書き方が戻ってきたら落ちる。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SW_RAW = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
// 説明のコメントには「昔はこう書いていた」と残してあるので、実際に動く行だけを見る
const code = (s) =>
  s
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
const SW = SW_RAW;

describe("★どのハンドラも身代わりに '/' を返さない★", () => {
  it("動く行に caches.match('/') が無い", () => {
    const hits = SW_RAW.split('\n')
      .map((l, i) => ({ l: l, n: i + 1 }))
      .filter((x) => !/^\s*(\/\/|\*|\/\*)/.test(x.l))
      .filter((x) => /caches\.match\(\s*['"]\/['"]\s*\)/.test(x.l))
      .map((x) => x.n + ': ' + x.l.trim());
    expect(hits).toEqual([]);
  });

  it("動く行に cache.match('/') も無い", () => {
    expect(/\bcache\.match\(\s*['"]\/['"]\s*\)/.test(code(SW_RAW))).toBe(false);
  });
});

describe('★つながらない時は正直に「つながらない」と出す★', () => {
  it('ナビゲーション用のオフライン画面がある', () => {
    expect(SW).toContain('function offlinePage');
    expect(SW).toContain('いまつながりません');
  });

  it('オフライン画面は HTML として返す（中身が化けない）', () => {
    const i = SW.indexOf('function offlinePage');
    const body = SW.slice(i, i + 1800);
    expect(body).toContain("'Content-Type': 'text/html; charset=utf-8'");
    expect(body).toContain('status: 503');
  });

  it('もう一度ひらくボタンがある（電波が戻ったら押すだけ）', () => {
    expect(SW).toContain('location.reload()');
    expect(SW).toContain('もう一度ひらく');
  });

  it('ナビゲーションは まず自分のURLのキャッシュ → 無ければオフライン画面', () => {
    const i = SW.indexOf('function navigationHandler');
    const body = code(SW.slice(i, i + 1800));
    expect(body).toContain('if (cached) return cached;');
    expect(body).toContain('offlinePage(');
    // ★別のページを返す道が残っていないこと★
    expect(body).not.toMatch(/caches\.match\(\s*['"]\//);
  });
});

describe('★JS・データの失敗に HTML を返さない★', () => {
  it('SWR は自分のキャッシュか、素直な失敗だけを返す', () => {
    const i = SW.indexOf('function staleWhileRevalidate');
    expect(i).toBeGreaterThan(-1);
    const body = code(SW.slice(i, SW.indexOf('function navigationHandler')));
    expect(body).toContain('return cached || Response.error();');
    expect(body).not.toMatch(/caches\.match\(\s*['"]\//);
  });

  it('/api/* は今まで通り JSON でエラーを返す（HTML化けを防ぐ）', () => {
    expect(SW).toContain('function networkOnlyJson');
    expect(SW).toContain("error: 'offline'");
  });
});

describe('メーター本体のオフライン運用は変わらない', () => {
  it("'/' は今まで通り precache に入っている", () => {
    expect(SW).toMatch(/PRECACHE_FILES\s*=\s*\[\s*\n\s*'\/'/);
  });

  it('ナビゲーションは自分のURLのキャッシュを先に見る（オフラインでも開ける）', () => {
    const i = SW.indexOf('function navigationHandler');
    const body = SW.slice(i, i + 1400);
    expect(body).toContain('cache.match(request, { ignoreSearch: true })');
    expect(body).toContain('return cached || fetchPromise;');
  });
});
