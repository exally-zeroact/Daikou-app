'use strict';
// ============================================================
// ★事務所は「反対側のメーター」のQRを出さない★ 2026-08-21
//
//   ▼これが要る理由（司さんの実機・2026-08-21）
//     本番の事務所からしかQRを読んでいないのに、3台のメーターが
//     ★テスト線の版(daikome-c7a5b18)★ になっていた。
//     配信側を全部数えても取り違えの跡は出なかった。
//     ★出なかった事より「出ても誰も気づけない形」だった事の方が問題★なので、
//     ★取り違えた時は QR を出さない★ を機械で固定する。
//
//   ▼この試験は ★dashboard.html に実際に書かれているコードを取り出して動かす★
//     （読むだけの試験にしない。別ファイルに写して測ると 写した方だけ緑になる）
//
//   ▼なぜ判定を画面の中に置くか
//     事務所(daikome-jimusho)は ★通す物だけ通す★ 作り。
//     新しい js/*.js を足すと ★事務所側で404★ になり、★見張りが黙って効かない★。
//     （2026-08-21 実測：js/host-pair.js を足したら check-hosts が
//       「事務所で /js/host-pair.js が 404」と赤で教えてくれた）
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DASH = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');

// ★配られる物そのものを取り出して動かす★
function loadGuard() {
  const start = DASH.indexOf('var HOST_PAIRS = [');
  const end = DASH.indexOf('/* ==HOST-PAIR-END== */');
  expect(start, '★判定の中身(HOST_PAIRS)が dashboard.html に無い★').toBeGreaterThan(-1);
  expect(end, '★判定の終わりの印が無い★').toBeGreaterThan(start);
  const src = DASH.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function(
    src + '\nreturn { expectedMeterFor: expectedMeterFor, checkQrTarget: checkQrTarget };'
  )();
}

const G = loadGuard();

describe('1. 対応表（事務所の住所だけで行き先が決まる）', () => {
  it('本番の事務所 → 本番のメーター', () => {
    expect(G.expectedMeterFor('daikome-jimusho.vercel.app')).toBe('https://daikou-app.vercel.app');
  });

  it('テストの事務所 → テストのメーター', () => {
    expect(G.expectedMeterFor('daikome-jimusho-test.vercel.app')).toBe(
      'https://daikou-app-test.vercel.app'
    );
  });

  it('メーター自身から開いた時は 自分自身', () => {
    expect(G.expectedMeterFor('daikou-app.vercel.app')).toBe('https://daikou-app.vercel.app');
    expect(G.expectedMeterFor('daikou-app-test.vercel.app')).toBe(
      'https://daikou-app-test.vercel.app'
    );
  });

  it('★知らない住所（開発中）は見ない＝素通り★', () => {
    expect(G.expectedMeterFor('localhost:3000')).toBe(null);
    expect(G.expectedMeterFor('')).toBe(null);
    expect(G.expectedMeterFor(null)).toBe(null);
    expect(G.checkQrTarget('localhost:3000', 'https://daikou-app-test.vercel.app').ok).toBe(true);
  });
});

describe('2. ★中の設定が反対側でも、住所で赤にできる★', () => {
  it('本番の事務所なのに APP_BASE がテスト → ★赤（QRを出してはいけない）★', () => {
    const r = G.checkQrTarget('daikome-jimusho.vercel.app', 'https://daikou-app-test.vercel.app');
    expect(r.known).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.want).toBe('https://daikou-app.vercel.app');
    expect(r.got).toBe('https://daikou-app-test.vercel.app');
  });

  it('テストの事務所なのに APP_BASE が本番 → ★赤★', () => {
    expect(
      G.checkQrTarget('daikome-jimusho-test.vercel.app', 'https://daikou-app.vercel.app').ok
    ).toBe(false);
  });

  it('合っている時は緑（末尾の / は付いていても同じ扱い）', () => {
    expect(G.checkQrTarget('daikome-jimusho.vercel.app', 'https://daikou-app.vercel.app').ok).toBe(
      true
    );
    expect(G.checkQrTarget('daikome-jimusho.vercel.app', 'https://daikou-app.vercel.app/').ok).toBe(
      true
    );
  });

  it('★APP_BASE が空（dk-config が読めなかった）時も 赤★', () => {
    // 読めなかった時に location.origin へ落ちる作りだったので、
    // ★「事務所自身のURL」をドライバーに配ってしまう★ 事故が起きうる。
    expect(G.checkQrTarget('daikome-jimusho.vercel.app', '').ok).toBe(false);
  });
});

describe('3. dashboard.html の配線', () => {
  it('★判定は画面の中に在る（外のファイルにしない＝事務所で404にならない）★', () => {
    expect(DASH).toContain('==HOST-PAIR-START==');
    expect(DASH, '★外のファイルにすると事務所で404になり 黙って効かなくなる★').not.toContain(
      'js/host-pair.js'
    );
  });

  it('★QRを作る前に checkQrTarget で確かめている★', () => {
    expect(DASH).toContain('checkQrTarget(location.host');
  });

  it('★合わない時に出す赤い知らせの入れ物がある★', () => {
    expect(DASH).toContain('id="qrSideWarn"');
  });

  it('★合わない時は QR を描かない（qr.make の前に止める）★', () => {
    const at = DASH.indexOf("$('toggleQr').addEventListener");
    expect(at, '★QRを描くボタンの配線が見つからない★').toBeGreaterThan(-1);
    const draw = DASH.slice(at, at + 700);
    expect(draw).toMatch(/QR_BLOCKED/);
    expect(draw.indexOf('QR_BLOCKED')).toBeLessThan(draw.indexOf('qr.make'));
  });

  it('★読むと開く場所を 画面に文字で出す★', () => {
    expect(DASH).toContain('id="coUrl"');
  });
});
