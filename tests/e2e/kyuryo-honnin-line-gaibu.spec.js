// ============================================================
// ★★本人の 明細：配る URL の 後ろの openExternalBrowser=1 で 開いても 同じに 動く★★ 2026-11-01
//   配る URL（kyuryo.html haifuUrl）に LINE 公式の openExternalBrowser=1 を 付けた
//   （LINE の 中の ブラウザでは PDF の 保存が 効かない 端末が 在る＝Safari／Chrome で 開かせる）。
//   本人の 画面は t と c だけ 読む＝後ろの 字が 鍵（t）に 混ざらない 事・紙が 出る 事を 見る
//   ★これは 壊れないかの 見張り★＝直す 前でも 緑（2026-11-01 実測）。印が 付くかは
//     kyuryo-haifu・kyuryo-okuru・kyuryo-qr-miseru が 見る（印を 外すと その 4本が 赤・同日 実測）
//   ★わざと壊して 赤（2026-11-01 実測）★
//     本人の 入口 HONNIN の 鍵の 読みを q.get('t') から location.search.split('t=')[1] に 替える
//     （後ろの &openExternalBrowser=1 が 鍵に 混ざる 形）…… ★この 1本が 赤★「後ろの 字が 鍵に 混ざりました」
// ============================================================
const { test, expect } = require('@playwright/test');
const { hiraku } = require('./honnin-harness');

test.use({ timezoneId: 'Asia/Tokyo' });

test('配る URL の 後ろに openExternalBrowser=1 が 在っても 鍵は TOK の まま・紙が 出る', async ({
  page,
}) => {
  const kagi = [];
  page.on('request', (r) => {
    if (/\/rest\/v1\/rpc\/dk_kyuryo_/.test(r.url())) {
      try {
        const b = JSON.parse(r.postData() || '{}');
        if (b && b.p_token !== undefined) kagi.push(b.p_token);
      } catch (_) {
        // 字で ない 返り は 見ない
      }
    }
  });
  await hiraku(page, null, null, false, null, null, '/kyuryo.html?t=TOK&openExternalBrowser=1');
  expect(kagi.length, '★倉庫を 鍵つきで 呼んでいません★').toBeGreaterThan(0);
  expect([...new Set(kagi)], '★後ろの 字が 鍵に 混ざりました★').toEqual(['TOK']);
  await expect(page.locator('#hnPdf')).toBeEnabled();
});
