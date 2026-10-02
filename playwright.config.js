// Playwright E2E config (2026-05-15・lint Phase 動的解析 ② 導入)
// ローカル static server を webServer 経由で起動 (npx http-server -p 3000)
// chromium のみ install (firefox/webkit は意図的に未導入・ディスク節約)
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  // ★★2026-08-30 追加（実際に 赤に なった）★★
  //   道路グラフ 15,990本を 消した コミットで CI の e2e が 落ちました:
  //     GitCommitInfo: timeout ... git fetch <sha> --depth=1
  //     ★RangeError: Invalid string length★
  //   ＝Playwright が ★コミットの 情報（変えたファイルの 一覧）を 文字にまとめる★所で
  //     文字が 長すぎて 落ちていました。★試験の 中身は 1本も 落ちていません★。
  //   ⇒ この情報は ★報告書の 飾り★なので 取りません（試験の 判定は 1文字も 変わりません）。
  captureGitInfo: { commit: false, diff: false },
  use: {
    baseURL: 'http://localhost:3000',
    // ★★時間帯は 日本に 固定★★ 2026-09-09（実測）
    //   ★なぜ 要るか★ CI は UTC で 走るので
    //     ①深夜割増（22〜5時）が 意図せず 掛かる（1,300 → 1,560）
    //     ②★日付の 境目が 9時間 ずれる★
    //   ⇒ ★手元は 緑・CI だけ 赤★ という
    //     一番 見つけにくい 形に なる。
    //   ★お客さんは 日本に 居る★ので
    //   ★試験を 本番に 合わせる★（逆は しない）
    timezoneId: 'Asia/Tokyo',
    headless: true,
    trace: 'retain-on-failure',
    // ★★落ちた 時の 証拠を 残す★★ 2026-09-06（指示役）
    //   ★なぜ 要るか★
    //     『たまに 赤』は ★明日には いつもの 赤★に なり、★いつもの 赤は 誰も 見なく なる★。
    //     （今日 飲み屋が 87時間 赤だったのは そこから）
    //   ★足跡（trace）だけでは 開かないと 分からない★ので
    //   ★絵と 動画★も 残す。★落ちた 回だけ★＝緑の 回は 1バイトも 増えません。
    //   ★試験の 判定は 1文字も 変えていません★（残す 物が 増えるだけ）
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // ★★試験から 本物の 倉庫（*.supabase.co）へ 行かせない★★ 2026-10-02
        //   本番の repo の 試験 1本で 実測：本物の 本番倉庫へ 4本 出ていた
        //   （dk-fare-config / dk_check_device_license / ★dk-issue-license★ / dk-customers）。
        //   ＝試験が ★本番の 倉庫に 端末の 許可を 書き込める★ 形。本番の dk_company_devices の
        //     試験用の 名札 12件の 出どころの 見立て。重い時は 本物の 返事が 遅れて 試験が 揺れる。
        //   page.route で 偽の 返事を 用意した 所は ★住所を 引く 前に★ 横取りされるので 今まで通り 動く。
        //   用意していない 所だけ「見つからない 住所」で すぐ 失敗する（本物には 1本も 届かない）。
        launchOptions: { args: ['--host-resolver-rules=MAP *.supabase.co ~NOTFOUND'] },
      },
    },
  ],
  webServer: {
    command: 'npx http-server -p 3000 -c-1 -s',
    port: 3000,
    reuseExistingServer: true,
    timeout: 30000,
  },
});
