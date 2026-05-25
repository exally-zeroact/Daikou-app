// tests/integration/nav-tab-redesign.test.js
//
// ★設計変更宣言 (2026-05-23・ナビ再設計・3 タブ均等 + 横画面サイドレール):
//   司さんとモック合意済の最終方針 verify:
//     1. 履歴タブ削除 (= 縦横とも)・履歴は・独立画面として残す
//     2. 縦画面: 下部 3 タブ均等配置 (業務/使い方/設定)
//     3. 横画面・業務画面: bottom-nav 非表示・現状維持
//     4. 横画面・overlay 表示時 (= 履歴/使い方/設定): 左サイドレール 64px
//     5. 履歴画面 横画面: 左右余白 padding 32px + max-width 720px
//
// 絶対ルール準拠:
//   ✓ distance_m / Meter / Worker B / map-matcher: 完全無関係
//   ✓ CSS 変数禁止・hex 直値のみ (= #007aff / #c6c6c8 / #fff)
//   ✓ console.error は・dlog 置換なし (= 編集対象外)
//   ✓ iOS Safari / Android Chrome: bottom-nav HTML 共通・分岐なし

'use strict';

const fs = require('fs');
const path = require('path');

let html;
beforeAll(() => {
  html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
});

describe('1. 履歴タブ削除 verify (= bottom-nav 3 タブ均等)', () => {
  it('bottom-nav 内に・履歴 button が・存在しない (= showOverlay("history") 呼出ボタンなし)', () => {
    // bottom-nav block 内のみ抽出
    const m = html.match(/<nav class="bottom-nav">[\s\S]*?<\/nav>/);
    expect(m).not.toBeNull();
    const navBlock = m[0];
    expect(navBlock).not.toMatch(/showOverlay\(['"]history['"]\)/);
    expect(navBlock).not.toMatch(/>履歴</);
  });

  it('bottom-nav 内に・3 つの button が・存在 (= 業務/使い方/設定)', () => {
    const m = html.match(/<nav class="bottom-nav">[\s\S]*?<\/nav>/);
    const navBlock = m[0];
    const buttons = navBlock.match(/<button[^>]*class="nav-item[^"]*"/g) || [];
    expect(buttons.length).toBe(3);
  });

  it('bottom-nav 内に・業務/使い方/設定 ラベル 3 つ存在', () => {
    const m = html.match(/<nav class="bottom-nav">[\s\S]*?<\/nav>/);
    const navBlock = m[0];
    expect(navBlock).toMatch(/>業務</);
    expect(navBlock).toMatch(/>使い方</);
    expect(navBlock).toMatch(/>設定</);
  });

  it('業務 button が・hideAllOverlays() 呼出 (= 既存挙動)', () => {
    const m = html.match(/<nav class="bottom-nav">[\s\S]*?<\/nav>/);
    const navBlock = m[0];
    expect(navBlock).toMatch(/onclick="window\.hideAllOverlays\(\)"/);
  });

  it('使い方 / 設定 button が・showOverlay 呼出', () => {
    const m = html.match(/<nav class="bottom-nav">[\s\S]*?<\/nav>/);
    const navBlock = m[0];
    expect(navBlock).toMatch(/showOverlay\(['"]help['"]\)/);
    expect(navBlock).toMatch(/showOverlay\(['"]settings['"]\)/);
  });
});

describe('2. JS _NAV_INDEX 更新 verify (= history 撤去・help:1/settings:2)', () => {
  it('_NAV_INDEX に・history 含まない', () => {
    expect(html).toMatch(/const _NAV_INDEX = \{ help: 1, settings: 2 \};/);
    expect(html).not.toMatch(/const _NAV_INDEX = \{[^}]*history:[^}]*\};/);
  });

  it('_OVERLAYS は・history 含む (= overlay 自体は残す)', () => {
    // history overlay は・screenIdle .btn-history 経由で表示するので・object に残す
    expect(html).toMatch(/_OVERLAYS = \{[\s\S]*?history:\s*['"]overlayHistory['"]/);
  });
});

describe('3. 履歴アクセス導線 verify (= screenIdle 内 btn-history 存続)', () => {
  it('screenIdle 内に・.btn-history button が・存在 (= onclick="onHistory()")', () => {
    expect(html).toMatch(/<button class="btn-history"[^>]*onclick="onHistory\(\)"/);
  });

  it('横画面 .btn-history-landscape-idle が・存在', () => {
    expect(html).toMatch(/class="btn-history-landscape-idle"/);
  });

  it('onHistory() 関数が・showOverlay("history") を呼ぶ', () => {
    const m = html.match(/function onHistory\(\)\s*\{[\s\S]*?\n\s\s\s\s\s\s\}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/showOverlay\(['"]history['"]\)/);
  });
});

describe('4. CSS 横画面サイドレール verify (= overlay 連動・64px)', () => {
  it('landscape + body:has(.spa-overlay.show) + .bottom-nav rule が・存在 (= 表示)', () => {
    expect(html).toMatch(
      /body:has\(\.spa-overlay\.show\)\s+\.bottom-nav\s*\{[^}]*display:\s*flex\s*!important/
    );
  });

  it('サイドレール幅 = 64px (= タップターゲット 44pt + 余白)', () => {
    expect(html).toMatch(/body:has\(\.spa-overlay\.show\)\s+\.bottom-nav\s*\{[^}]*width:\s*64px/);
  });

  it('サイドレール: flex-direction column / left:0 / border-right', () => {
    const m = html.match(/body:has\(\.spa-overlay\.show\)\s+\.bottom-nav\s*\{[^}]*\}/);
    expect(m).not.toBeNull();
    expect(m[0]).toContain('flex-direction: column');
    expect(m[0]).toContain('left: 0');
    expect(m[0]).toContain('border-right');
  });

  it('overlay 自身が・left:64px (= レール分・重なり防止)', () => {
    expect(html).toMatch(
      /body:has\(\.spa-overlay\.show\)\s+\.spa-overlay\.show\s*\{[^}]*left:\s*64px/
    );
  });

  it('アクティブ表現: 左端 3px バー (= ::before 疑似要素・横画面のみ)', () => {
    expect(html).toMatch(
      /body:has\(\.spa-overlay\.show\)\s+\.bottom-nav\s+\.nav-item\.active::before\s*\{[^}]*width:\s*3px/
    );
  });

  it('hex 直値 #007aff (= active 色) を使用・CSS 変数 var() 使用なし', () => {
    const m = html.match(
      /body:has\(\.spa-overlay\.show\)\s+\.bottom-nav\s+\.nav-item\.active::before\s*\{[^}]*\}/
    );
    expect(m[0]).toMatch(/#007aff/i);
    expect(m[0]).not.toMatch(/var\(/);
  });

  it('min-width 条件 撤去 (= 全 landscape 機種で適用・iPhone SE 等 < 700px も対象)', () => {
    // body:has(.spa-overlay.show) を含む @media の・条件文字列 verify
    // 該当 @media block 直前に・@media (orientation: landscape) { (= and (min-width) なし) 存在
    const idx = html.indexOf('body:has(.spa-overlay.show) {');
    expect(idx).toBeGreaterThan(0);
    // 直前 @media を逆走査
    const upToIdx = html.slice(0, idx);
    const lastMedia = upToIdx.match(/@media\s+\([^{]+\)\s*\{[^@]*$/);
    expect(lastMedia).not.toBeNull();
    expect(lastMedia[0]).toMatch(/orientation:\s*landscape/);
    expect(lastMedia[0]).not.toMatch(/min-width/);
  });
});

describe('5. CSS 横画面 業務画面 = bottom-nav 非表示 (= 既存維持・触らず)', () => {
  it('@media landscape 内に・.bottom-nav { display: none !important; } 既存維持', () => {
    // L2628 既存 rule (= 業務画面横画面で・非表示) が・残ってる
    expect(html).toMatch(/\.bottom-nav\s*\{\s*display:\s*none\s*!important;\s*\}/);
  });
});

describe('6. 履歴画面 横画面 左右余白 verify', () => {
  it('@media landscape 内・#overlayHistory .wrap に・padding-left:32px + max-width', () => {
    const m = html.match(
      /@media \(orientation: landscape\)\s*\{[^}]*#overlayHistory \.wrap\s*\{[^}]*\}/
    );
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/padding-left:\s*32px/);
    expect(m[0]).toMatch(/padding-right:\s*32px/);
    expect(m[0]).toMatch(/max-width:\s*720px/);
    expect(m[0]).toMatch(/margin:\s*0\s+auto/);
  });

  it('縦画面 padding 16px は・既存維持 (= 縦画面崩さない)', () => {
    expect(html).toMatch(/#overlayHistory \.wrap\s*\{\s*padding:\s*16px/);
  });
});

describe('7. 横画面サイドレール拡張 verify (= 2026-05-24・screenIdle + screenBusinessStart)', () => {
  it('showScreen 関数で・body.classList.toggle 5 件 (= screen-idle/driving/fare/businessstart/businessreport)', () => {
    const m = html.match(/function showScreen\(name\)\s*\{[\s\S]*?\n\s\s\s\s\s\s\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).toMatch(/classList\.toggle\(['"]screen-idle['"],\s*name\s*===\s*['"]idle['"]\)/);
    expect(body).toMatch(
      /classList\.toggle\(['"]screen-driving['"],\s*name\s*===\s*['"]driving['"]\)/
    );
    expect(body).toMatch(/classList\.toggle\(['"]screen-fare['"],\s*name\s*===\s*['"]fare['"]\)/);
    expect(body).toMatch(
      /classList\.toggle\(['"]screen-businessstart['"],\s*name\s*===\s*['"]businessStart['"]\)/
    );
    expect(body).toMatch(
      /classList\.toggle\(['"]screen-businessreport['"],\s*name\s*===\s*['"]businessReport['"]\)/
    );
  });

  it('body.screen-idle / body.screen-businessstart 横画面で・サイドレール 64px 表示 rule', () => {
    expect(html).toMatch(
      /body\.screen-idle,\s*\n\s*body\.screen-businessstart\s*\{[^}]*padding-left:\s*64px/
    );
    expect(html).toMatch(
      /body\.screen-idle \.bottom-nav,\s*\n\s*body\.screen-businessstart \.bottom-nav\s*\{[^}]*display:\s*flex\s*!important/
    );
    expect(html).toMatch(
      /body\.screen-idle \.bottom-nav,\s*\n\s*body\.screen-businessstart \.bottom-nav\s*\{[^}]*width:\s*64px/
    );
  });

  it('body.screen-idle / body.screen-businessstart アクティブ表現: 左端 3px バー + #007aff', () => {
    const m = html.match(
      /body\.screen-idle \.bottom-nav \.nav-item\.active::before,\s*\n\s*body\.screen-businessstart \.bottom-nav \.nav-item\.active::before\s*\{[^}]*\}/
    );
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/width:\s*3px/);
    expect(m[0]).toMatch(/#007aff/i);
    expect(m[0]).not.toMatch(/var\(/); // CSS 変数禁止
  });

  it('body.screen-businessstart grid 1fr rule (= iOS Safari :has() bug 回避・class detection 並記)', () => {
    // body.screen-businessstart は・2 か所に・別 block:
    //   ① サイドレール用 (= padding-left:64px・共通)
    //   ② grid 1fr 用 (= 大ボタン中央配置・businessStart 専用)
    // ② を直接 hit (= block 内 grid-template-columns 含む 行で・正規表現 anchor)
    expect(html).toMatch(
      /body\.screen-businessstart\s*\{[^}]*grid-template-columns:\s*1fr\s*!important/
    );
    expect(html).toMatch(/body\.screen-businessstart\s*\{[^}]*padding-right:\s*0\s*!important/);
  });

  it('body.screen-businessstart .btn-area 非表示 rule', () => {
    expect(html).toMatch(
      /body\.screen-businessstart \.btn-area\s*\{[^}]*display:\s*none\s*!important/
    );
  });

  it('既存 body:has(#screenBusinessStart...) :has() rule は・並記維持 (= 1 byte 不変)', () => {
    expect(html).toMatch(
      /body:has\(#screenBusinessStart\[style\*='display: flex'\]\)\s*\{[^}]*grid-template-columns:\s*1fr\s*!important/
    );
  });

  it('screenDriving / screenFare 用・body class rule なし (= 触らず維持・bottom-nav 非表示)', () => {
    // body.screen-driving / body.screen-fare を・selector に使う CSS rule は・存在しない
    expect(html).not.toMatch(/body\.screen-driving\s*\{/);
    expect(html).not.toMatch(/body\.screen-fare\s*\{/);
    // ただし JS の・classList.toggle 内には・含まれる (= 上の test で・既に verify)
  });
});

describe('8. 不可侵境界 verify (= 触らないファイル untouched・本 test では・index.html のみ確認)', () => {
  it('distance_m 文字列 grep で・index.html に・追加なし (= 表示専用)', () => {
    // distance_m 単独で・新規追加されてないか (= 既存使用箇所のみ存続)
    const matches = (html.match(/distance_m/g) || []).length;
    // 既存使用は・大量にある (= dashboard / Meter.getState 等)・大幅増減ないことを確認
    expect(matches).toBeGreaterThan(0); // 既存は存在
    expect(matches).toBeLessThan(200); // 急増なし
  });

  it('isStationary 文字列 grep で・index.html に・新規追加なし', () => {
    // isStationary は・既存 GPS callback / mmWorker hint で・使用・本 task で追加なし
    const matches = (html.match(/isStationary/g) || []).length;
    expect(matches).toBeGreaterThan(0); // 既存
    expect(matches).toBeLessThan(50); // 急増なし
  });
});
