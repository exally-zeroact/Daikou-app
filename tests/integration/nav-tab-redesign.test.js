// tests/integration/nav-tab-redesign.test.js
//
// ★設計変更宣言 (2026-06-05・ナビを青バー(appbar)へ統合・下フッタ/左レール撤去):
//   司さん承認mock(rev2)の最終方針 verify:
//     1. 業務/使い方/設定 を appbar 内 (.appbar-nav) に移設・3 タブ・履歴タブなし
//     2. bottom-nav(下フッタ)要素は撤去・横画面の左サイドレールも撤去
//     3. appbar の z-index は overlay より上 (使い方/設定 表示中もタブ切替可能)
//     4. 代行中(driving)/料金(fare) では誤タップ防止でナビ非表示
//     5. 使い方/設定 overlay の自前 appbar は非表示(青バーが常駐ヘッダ)
//     6. 履歴導線 (screenIdle 内 btn-history) は従来通り存続
//
// 絶対ルール準拠: distance_m / Meter / Worker B / map-matcher 完全無関係・CSS は hex 直値。

'use strict';

const fs = require('fs');
const path = require('path');

let html;
beforeAll(() => {
  html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
});

describe('1. ナビは appbar (.appbar-nav) に移設・3 タブ・履歴タブなし', () => {
  it('<nav class="appbar-nav"> が存在 (= 青バー内ナビ)', () => {
    expect(html).toMatch(/<nav class="appbar-nav"[^>]*>/);
  });

  it('appbar-nav 内に・3 つの nav-item button が存在', () => {
    const m = html.match(/<nav class="appbar-nav"[\s\S]*?<\/nav>/);
    expect(m).not.toBeNull();
    const buttons = m[0].match(/<button[^>]*class="nav-item[^"]*"/g) || [];
    expect(buttons.length).toBe(3);
  });

  it('appbar-nav 内に・ホーム/使い方/設定 ラベル・履歴は無し', () => {
    const m = html.match(/<nav class="appbar-nav"[\s\S]*?<\/nav>/);
    const navBlock = m[0];
    expect(navBlock).toMatch(/>ホーム</); // ★2026-06-11: ナビ「業務」→「ホーム」改名
    expect(navBlock).toMatch(/>使い方</);
    expect(navBlock).toMatch(/>設定</);
    expect(navBlock).not.toMatch(/>履歴</);
    expect(navBlock).not.toMatch(/showOverlay\(['"]history['"]\)/);
  });

  it('ホーム→hideAllOverlays / 使い方→help / 設定→settings の onclick', () => {
    const m = html.match(/<nav class="appbar-nav"[\s\S]*?<\/nav>/);
    const navBlock = m[0];
    expect(navBlock).toMatch(/onclick="window\.hideAllOverlays\(\)"/);
    expect(navBlock).toMatch(/showOverlay\(['"]help['"]\)/);
    expect(navBlock).toMatch(/showOverlay\(['"]settings['"]\)/);
  });
});

describe('2. bottom-nav(下フッタ) と 左サイドレール は撤去', () => {
  it('<nav class="bottom-nav"> 要素が存在しない', () => {
    expect(html).not.toMatch(/<nav class="bottom-nav">/);
  });

  it('横画面サイドレール用の padding-left:64px が無い (= レール撤去)', () => {
    expect(html).not.toMatch(/padding-left:\s*64px/);
  });

  it('overlay を左 64px ずらす left:64px が無い', () => {
    expect(html).not.toMatch(/\.spa-overlay\.show\s*\{[^}]*left:\s*64px/);
  });
});

describe('3. appbar が overlay より上・代行中/料金でナビ非表示', () => {
  it('.appbar の z-index が overlay(80) より大きい (>=100)', () => {
    const m = html.match(/\.appbar\s*\{[^}]*\}/);
    expect(m).not.toBeNull();
    const zmatch = m[0].match(/z-index:\s*(\d+)/);
    expect(zmatch).not.toBeNull();
    expect(Number(zmatch[1])).toBeGreaterThanOrEqual(100);
  });

  it('代行中(driving)/料金(fare) で .appbar-nav 非表示', () => {
    expect(html).toMatch(
      /body\.screen-driving \.appbar-nav,\s*\n?\s*body\.screen-fare \.appbar-nav\s*\{[^}]*display:\s*none/
    );
  });

  it('★全 overlay の自前 appbar は非表示 (= 司さん「青バー統一して無くせ」・履歴/料金も統一)', () => {
    // 2026-06-06 設計変更: 旧は help/settings のみ非表示で履歴/料金は自前appbar維持だったが、
    // 司さん指示で履歴/料金も含め全 overlay の二重青バーを統一非表示に。戻るは常駐青バーnav。
    expect(html).toMatch(
      /#overlayHelp \.appbar,\s*\n?\s*#overlaySettings \.appbar,\s*\n?\s*#overlayHistory \.appbar,\s*\n?\s*#overlayFare \.appbar\s*\{[^}]*display:\s*none/
    );
  });

  it('spa-overlay に appbar 分の上余白 (padding-top) が確保されている', () => {
    const m = html.match(/\.spa-overlay\s*\{[^}]*\}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/padding-top:\s*calc\([^)]*env\(safe-area-inset-top\)/);
  });
});

describe('4. JS 配線: _setNavActive は .appbar-nav 対象・_NAV_INDEX/_OVERLAYS 維持', () => {
  it('_setNavActive が .appbar-nav .nav-item を対象にする', () => {
    expect(html).toMatch(/querySelectorAll\(['"]\.appbar-nav \.nav-item['"]\)/);
  });

  it('_NAV_INDEX に・history 含まない (help:1/settings:2)', () => {
    expect(html).toMatch(/const _NAV_INDEX = \{ help: 1, settings: 2 \};/);
  });

  it('_OVERLAYS は・history 含む (= overlay 自体は残す)', () => {
    expect(html).toMatch(/_OVERLAYS = \{[\s\S]*?history:\s*['"]overlayHistory['"]/);
  });
});

describe('5. 履歴アクセス導線 verify (= screenIdle 内 btn-history 存続)', () => {
  it('screenIdle 内に・.btn-history button が存在 (onclick="onHistory()")', () => {
    expect(html).toMatch(/<button class="btn-history"[^>]*onclick="onHistory\(\)"/);
  });

  it('onHistory() が showOverlay("history") を呼ぶ', () => {
    const m = html.match(/function onHistory\(\)\s*\{[\s\S]*?\n\s\s\s\s\s\s\}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/showOverlay\(['"]history['"]\)/);
  });
});

describe('6. showScreen の body class toggle 5 件 (= 画面状態 class detection 維持)', () => {
  it('screen-idle/driving/fare/businessstart/businessreport の toggle', () => {
    const m = html.match(/function showScreen\(name\)\s*\{[\s\S]*?\n\s\s\s\s\s\s\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).toMatch(/classList\.toggle\(['"]screen-idle['"]/);
    expect(body).toMatch(/classList\.toggle\(['"]screen-driving['"]/);
    expect(body).toMatch(/classList\.toggle\(['"]screen-fare['"]/);
    expect(body).toMatch(/classList\.toggle\(['"]screen-businessstart['"]/);
    expect(body).toMatch(/classList\.toggle\(['"]screen-businessreport['"]/);
  });
});

describe('7. 不可侵境界 verify (= 距離/課金ロジックに無関係)', () => {
  it('distance_m の出現数が急増していない (= 表示専用)', () => {
    const matches = (html.match(/distance_m/g) || []).length;
    expect(matches).toBeGreaterThan(0);
    expect(matches).toBeLessThan(200);
  });
});
