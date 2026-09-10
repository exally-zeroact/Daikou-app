// ============================================================
// ★★版の 行に「本番」と 書かない★★ 2026-09-09
//
//   ★司さん★「ほんで バージョンも 本番って いれるな
//              テスト版には テストって 入れて ええけど」
//
//   ★前★ daikome-xxxxxxx  /  本番  /  daikou-app.vercel.app
//   ★今★ daikome-xxxxxxx  /  daikou-app.vercel.app
//        テストは 今まで通り ★テスト用★ を 出す
//
//   ★★一番 高い 事故は 変えていません★★
//     ＝★本番に「テスト用」と 出る★
//     判定は location.host（中の 設定を 信じない）ので 今まで通り 起きません。
//
//   ★測り方★ 本物の _envLabel/_withEnv を ★画面から そのまま 取り出して★
//     3つの 配り先で 動かす（字を 読むだけに しない）。
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-09 実測）★★
//     ①本番の 戻り値を '本番' に 戻す … ★赤★
// ============================================================
const { test, expect } = require('@playwright/test');

test('★本番と テストで 何と 出るか★', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const r = await page.evaluate(() => {
    // ★本物の 中身を そのまま 取り出して 動かす★（写しを 作らない）
    const src = [...document.querySelectorAll('script')].map((s) => s.textContent || '').join('\n');
    const i = src.indexOf('function _envLabel()');
    const j = src.indexOf('function _loadAppVersion()', i);
    const honmono = src.slice(i, j);
    const out = {};
    [
      // ★本番（何も 出ない）★
      'daikou-app.vercel.app',
      'daikome-jimusho.vercel.app',
      // ★テスト（テスト用 と 出る）★
      'daikou-app-test.vercel.app',
      'daikome-jimusho-test.vercel.app',
      'daikome-jimusho-host-test.vercel.app',
      // ★★枝ごとの 配信★★ 2026-09-09（監査で 見つけた 穴）
      //   前は ここが 素通りして ★「本番」と 出ていた★
      'daikou-app-test-git-obd-exallysupoort-8848s-projects.vercel.app',
      // ★★本番repo の 枝配信★★ 2026-09-10（指示役の 監査③）
      //   -test- を 1つも 含まないので ★本番と 同じ 見た目★だった
      'daikou-app-git-obd-exallysupoort-8848s-projects.vercel.app',
      'daikome-jimusho-git-shirase-exallysupoort-8848s-projects.vercel.app',
    ].forEach((host) => {
      // eslint-disable-next-line no-new-func
      const f = new Function('location', honmono + '; return _withEnv("daikome-75aedea");');
      out[host] = f({ host: host });
    });
    return out;
  });

  // eslint-disable-next-line no-console
  console.log('★版の 行★ ' + JSON.stringify(r, null, 1));
  expect(r['daikou-app.vercel.app'], '★本番に 本番と 出ています★').not.toContain('本番');
  expect(r['daikou-app-test.vercel.app'], '★テストに テストと 出ていません★').toContain('テスト');
  expect(r['daikou-app.vercel.app'], '★版が 出ていません★').toContain('daikome-75aedea');
  expect(r['daikou-app.vercel.app'], '★空の 区切りが 残っています★').not.toContain('/  /');
  // ★★本番は 1つも「テスト用」に ならない★★（一番 高い 事故）
  ['daikou-app.vercel.app', 'daikome-jimusho.vercel.app'].forEach((h) => {
    expect(r[h], '★本番に テスト用と 出ています★ ' + h).not.toContain('テスト');
    expect(r[h], '★本番に 本番と 出ています★ ' + h).not.toContain('本番');
  });
  // ★★テストは 全部「テスト用」に なる★★（枝ごとの 配信も 含む）
  [
    'daikou-app-test.vercel.app',
    'daikome-jimusho-test.vercel.app',
    'daikome-jimusho-host-test.vercel.app',
    'daikou-app-test-git-obd-exallysupoort-8848s-projects.vercel.app',
  ].forEach((h) => {
    expect(r[h], '★テストなのに テストと 出ていません★ ' + h).toContain('テスト');
  });

  // ★★枝ごとの 配信は 本番と 見分けが 付く★★ 2026-09-10（指示役の 監査③）
  //   ★訳★ 司さんが 確かめ用の 配信を 開いて ★本番だと 思い込む★のを 防ぐ
  [
    'daikou-app-git-obd-exallysupoort-8848s-projects.vercel.app',
    'daikome-jimusho-git-shirase-exallysupoort-8848s-projects.vercel.app',
  ].forEach((h) => {
    expect(r[h], '★枝配信が 本番と 同じ 見た目です★ ' + h).toContain('確かめ用');
  });
});

// ★★本番の 配り先に -test- が 混ざったら 赤★★ 2026-09-09（監査で 出た 心配）
//   ★訳★ 判定を /-test[.-]/ に 広げた ので、
//     将来 本番の 配り先の 名前に -test- が 入ると
//     ★本番に「テスト用」と 出る★＝一番 高い 事故。
//   ⇒ ★本番の 名前を ここに 書いて 固定する★（増えたら ここも 直す）
test('★★本番の 配り先の 名前に -test- が 入っていない★★', async ({ page }) => {
  const HONBAN = ['daikou-app.vercel.app', 'daikome-jimusho.vercel.app'];
  HONBAN.forEach((h) => {
    expect(
      /-test[.-]/.test(h),
      '★本番の 配り先に -test- が 入っています★（テスト用と 出ます）: ' + h
    ).toBe(false);
    expect(/-test$/.test(h), '★本番の 配り先が -test で 終わっています★: ' + h).toBe(false);
  });
  void page;
});
