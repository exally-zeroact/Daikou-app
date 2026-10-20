// Playwright の WebKit（iPhone の Safari の 中身）だけで 回す 小さい 組 2026-10-17
//   CI は chromium だけで、客の 多い iPhone の 中身を 1回も 測っていなかった（指示役 10-16）。
//   運転手が iPhone で 一番 触る 道（業務の 始め〜走る〜終わり・送り・保存・お金・許可・料金表）と、本人の 明細だけを iPhone の 形で 開く。
//   ★本体の playwright.config.js は 変えない★（既定の 組に webkit を 足すと chromium の job でも 走り、入っていない webkit で 落ちる）
//   ★名前は .js★（.mjs から 本体の .js を import すると、package.json に type が 無いので 読めず 1本も 走らなかった・対立役 10-17）
//   ★本物の 倉庫へ 行かせない★ chromium の host-resolver-rules は webkit に 無いので、localhost 以外を 届かない 代理に 向ける
//   （page.route で 偽の 返事を 用意した 所は 今まで通り 横取りされる。外の CDN は 届かず 1つ 2秒ほど 待つ）。
//   ★その 代理を souko-ni-ikanai が 見張る★（外されたら 赤）
//   ★わざと壊して 赤に なった 記録（対立役 10-17）★ index.html の onBusinessEnd の 頭で iPhone の 時だけ 返す
//     ⇒ この 組は 2 failed（driving-1km・flow-standard）／同じ 壊し方で chromium の 組は 緑＝iPhone だけの 崩れを ここだけが 捕まえる
//
//   ★業務終了の 送り（shuryo-tsuzukeru-okuru）★ 初めて WebKit で 回すと 時々 赤（「1回目の POST が 出ない」）。
//     訳＝POST は 出ているが、WebKit では service worker が 握る 画面の 要求に page.route が 効かない 事が ある（試験の 道具の 癖）。
//     iPhone の UA の 道では ない（job-sync.js に UA の 分かれ 0件・chromium＋iPhone の UA で 緑）。
//     ⇒ その 試験は service worker を 止めて 中身を 数え、okuru-sw-keiyu が「握っていても 出る」を 縛る。
//   ★まだ 入れていない 物★ install-offline-reopen-flow・offline-ryokin-deru（setOffline の 後の page.reload で WebKit が internal error）
//     Playwright の WebKit の 限界か 本物の iPhone の 崩れかは 分けていない＝★圏外で 開き直す 道は WebKit で 測れていない★
//   ★設定が 読めない・webServer・代理の 赤は「前から 在る 崩れ」に 数えない★（道具の 赤）
import base from './playwright.config.js';
import { defineConfig, devices } from '@playwright/test';

export const WEBKIT_KUMI = [
  // 本物の 倉庫へ 行かせない 代理の 見張り
  'souko-ni-ikanai.spec.js',
  // 業務の 道
  'flow-standard.spec.js',
  'driving-1km.spec.js',
  'driving-uitimer-no-crash.spec.js',
  'gyoumu-chuu-yomi-naosanai.spec.js',
  'shuryo-tsuzukeru-okuru.spec.js',
  'okuru-sw-keiyu.spec.js',
  'soukou-hozon-ippai.spec.js',
  'zenkai-tsuzuki-shirase.spec.js',
  'history-times.spec.js',
  'appbar-single-row.spec.js',
  // お金
  'fare-billing-freeze.spec.js',
  'stationary-no-increase.spec.js',
  'kakutei-go-kill.spec.js',
  'daikou-kakeru-kakujitsu.spec.js',
  'fare-hozon-shippai-uwagaki.spec.js',
  'meter-ryokin-miru-dake.spec.js',
  // 距離（iPhone の 位置の 取り方で 請求の 距離が 変わる 道・対立役 10-17）
  'stationary-real-pipeline.spec.js',
  'gap-fill.spec.js',
  'sensor-edge-cases.spec.js',
  // 許可・端末
  'license-gate-flow.spec.js',
  'platform-ios.spec.js',
  // 本人の 明細
  'kyuryo-sumaho.spec.js',
  'kyuryo-honnin.spec.js',
  'kyuryo-honnin-shashin.spec.js',
  // 従業員の 明細の 期間の ボタン（iPhone の 中身でも 1行に 入るか・対立役 M1 2026-10-20）
  'kyuryo-honnin-kikan.spec.js',
  'kyuryo-meisai-miseru.spec.js',
];

export default defineConfig({
  ...base,
  testMatch: WEBKIT_KUMI,
  projects: [
    {
      name: 'webkit',
      use: {
        ...devices['iPhone 13'],
        timezoneId: 'Asia/Tokyo',
        proxy: { server: 'http://127.0.0.1:9', bypass: 'localhost,127.0.0.1' },
      },
    },
  ],
});
