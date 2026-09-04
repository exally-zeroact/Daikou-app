/* global showScreen */
// ============================================================
// ★★OBDの赤い警告が 出ても「業務終了」ボタンが 動かない★★ 2026-09-05
//
//   ★なぜ 作ったか（司さん）★
//     「最後 車から離れて OBDが切れた状態で 事務所にきて Wi-Fi繋いで
//       業務終了押す時に OBDに繋いで下さいの警告のせいで 変になる」
//     「訳分からんことせずに 警告のせいで ボタン押せんとか ないようにしろやぼけ」
//
//   ★実測（直す前）★ スマホ 390x844・待機画面
//     赤バー 42px ／ 業務終了ボタン 上から 502px → ★544px（42px 下に ずれた）★
//     ＝押そうとした 瞬間に 指の 下から ボタンが 逃げる
//
//   ★直し方★ 赤バーを ★上に 重ねる（position:fixed）★
//     ⇒ 下の 中身は 1px も 動かない。★警告は そのまま 出す★（判定は 1つも 変えていない）
//
//   ★わざと壊して 赤に なる事を 見た（2026-09-05 実測）★
//     赤バーの position を static（元の 押し下げる 形）に 戻す
//       … iPhone 14 ★zure 42px★ ／ iPhone SE ★zure 42px★ ⇒ ★両方 赤★
// ============================================================
import { test, expect } from '@playwright/test';

const SIZE = [
  { w: 390, h: 844, na: 'iPhone 14' },
  { w: 375, h: 667, na: 'iPhone SE（小さい方）' },
];

async function gotoApp(page) {
  await page.addInitScript(() => {
    sessionStorage.setItem('sensor_permission_active', '1');
    sessionStorage.setItem('sensorGranted', '1');
    sessionStorage.setItem('dl_just_completed', '1');
    localStorage.setItem('daikome_training_consent', 'dismissed');
    localStorage.setItem('pwa_banner_dismissed', '1');
    localStorage.setItem('apk_banner_dismissed', '1');
    localStorage.setItem('tutorial_done', '1');
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    ['dlOverlay', 'trainingConsentBanner', 'pwaBanner', 'apkBanner', 'sensorRestoreBanner'].forEach(
      (id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      }
    );
    if (typeof showScreen === 'function') showScreen('idle');
  });
}

// ★赤バーを 出して 業務終了ボタンの 位置を 前後で 測る★
async function hakaru(page) {
  return page.evaluate(() => {
    const bar = document.getElementById('obdReconnectBar');
    const btn = [].slice
      .call(document.querySelectorAll('.btn-business-end'))
      .filter((x) => x.offsetWidth > 0 && x.offsetHeight > 0)[0];
    if (!bar) return { NG: '赤バーが 見つかりません（#obdReconnectBar）' };
    if (!btn) return { NG: '業務終了ボタンが 見えていません（.btn-business-end）' };
    const yomu = () => {
      const b = btn.getBoundingClientRect();
      const cx = Math.round(b.left + b.width / 2);
      const cy = Math.round(b.top + b.height / 2);
      const e = document.elementFromPoint(cx, cy);
      return {
        top: Math.round(b.top),
        bottom: Math.round(b.bottom),
        // ★真ん中を 突いた 時に 当たるのは ボタン本体か★（別の物が 被さっていないか）
        ataru: e
          ? btn === e || btn.contains(e)
            ? 'botan'
            : e.id || String(e.className).slice(0, 24)
          : 'nashi',
        mieru: b.top >= 0 && b.bottom <= window.innerHeight,
      };
    };
    const mae = yomu();
    // ★本物と 同じ 出し方★（index.html の 出す所と 同じ 2行）
    bar.style.display = 'flex';
    const ab = document.getElementById('appbar');
    bar.style.top = (ab ? Math.round(ab.getBoundingClientRect().bottom) : 0) + 'px';
    const bb = bar.getBoundingClientRect();
    const ato = yomu();
    bar.style.display = 'none';
    return {
      barH: Math.round(bb.height),
      barTop: Math.round(bb.top),
      barHamidasu: bb.bottom > window.innerHeight || bb.top < 0,
      mae,
      ato,
      zure: ato.top - mae.top,
      mado: window.innerHeight,
    };
  });
}

for (const v of SIZE) {
  test('★' + v.na + '：赤い警告が 出ても 業務終了ボタンは 1px も 動かない★', async ({ page }) => {
    await page.setViewportSize({ width: v.w, height: v.h });
    await gotoApp(page);
    const r = await hakaru(page);
    // eslint-disable-next-line no-console
    console.log('★' + v.na + '★ ' + JSON.stringify(r));

    expect(r.NG, '★測れていません＝緑にしない★').toBeUndefined();
    // ★0を 見て 緑に しない★（バーが 本当に 出ている事）
    expect(r.barH, '★赤バーが 出ていません（高さ0）＝何も 測れていない★').toBeGreaterThan(10);
    // ★本題★
    expect(r.zure, '★赤い警告のせいで 業務終了ボタンが 動きました★').toBe(0);
    // ★押せる事★
    expect(r.ato.ataru, '★ボタンの 上に 別の 物が 被さっています★').toBe('botan');
    expect(r.ato.mieru, '★ボタンが 画面から はみ出しました★').toBe(true);
    // ★警告 自体も ちゃんと 見えている事★（消して 逃げていない）
    expect(r.barHamidasu, '★赤い警告が 画面の 外に 行きました＝見えません★').toBe(false);
  });
}
