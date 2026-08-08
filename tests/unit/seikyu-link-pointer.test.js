'use strict';
// ============================================================
// ★事務所→代行請求書のリンクが、この repo の正しい行き先を指していること★ 2026-08-09
//
//   ★何が起きていたか（司さん指摘）★
//     事務所の dashboard.html に
//         'https://exally-test.vercel.app/daikou-seikyu.html'
//     が直書きされていて、★本番repo も テストrepo も 同じ所★へ飛んでいた。
//     しかも exally-test は ★名前に -test と入っているのに中身は本番★:
//         exally-test.vercel.app/daikou-seikyu.html … 本番の倉庫 / sha256 456a28482b2a072d
//         daikou-seikyu.vercel.app/daikou-seikyu.html … 本番の倉庫 / sha256 456a28482b2a072d（同一）
//         daikou-seikyu-test.vercel.app/…            … テストの倉庫（★これだけがテスト★）
//     ＝ ★テストのつもりで本物の請求データを触る★ 事故のもとだった。
//     （repo名の -test を環境の証拠にするな、で 8/6 に改名した時の積み残し）
//
//   ★ここで縛ること★
//     ・行き先は js/dk-config.js の SEIKYU_BASE から読む（画面に直書きしない）
//     ・★この repo（本番）は 本番の請求書を指す★
//     ・★古い名前 exally-test を指していない★
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const CFG = read('js/dk-config.js');
const DASH = read('dashboard.html');

// ★この repo が指すべき行き先★（本番repo では daikou-seikyu.vercel.app）
const WANT = 'https://daikou-seikyu.vercel.app';
const TESTONE = 'https://daikou-seikyu-test.vercel.app';
const OLD = 'exally-test.vercel.app';

describe('★事務所→代行請求書のリンク★', () => {
  it('行き先は dk-config.js に置いてある（画面に直書きしない）', () => {
    expect(CFG, '★SEIKYU_BASE が無い＝また画面に直書きされる★').toContain('SEIKYU_BASE');
    expect(CFG, '★外に出していない＝画面から読めない★').toContain('SEIKYU_BASE: SEIKYU_BASE');
  });

  it('★このrepo（本番）は 本番の請求書を指す★', () => {
    expect(CFG, '★行き先が違う★').toContain("const SEIKYU_BASE = '" + WANT + "'");
  });

  it('★テストの請求書を指していない★（本番なのにテストを見ない）', () => {
    const m = CFG.match(/const SEIKYU_BASE = '([^']+)'/);
    expect(m, 'SEIKYU_BASE が読めない').not.toBe(null);
    expect(m[1], '★本番repo なのにテストの請求書を指している★').not.toBe(TESTONE);
  });

  it('★古い名前(exally-test)を どこも指していない★', () => {
    expect(CFG.includes(OLD), '★dk-config.js に古い名前が残っている★').toBe(false);
    // dashboard.html は説明のコメントに名前が出るのは可。★実際に飛ぶ行き先★に無ければよい。
    const urls = DASH.match(/https?:\/\/[^"'\s<>)]+/g) || [];
    const live = urls.filter((u) => !u.includes('w3.org'));
    expect(
      live.filter((u) => u.includes(OLD)),
      '★画面から古い名前へ飛ぶ★'
    ).toEqual([]);
  });

  it('画面は 設定から組み立てている（直書きに戻っていない）', () => {
    expect(DASH, '★行き先を設定から読んでいない★').toContain('DKConfig.SEIKYU_BASE');
    expect(/var SEIKYU_URL = 'https?:\/\//.test(DASH), '★また直書きに戻っている★').toBe(false);
  });
});
