'use strict';
// ============================================================
// ★★倉庫の 道具（Edge Function）に 通らない 字が 無いか★★ 2026-09-11
//
//   ★★実際に 起きた 事故（司さんが 気づいた）★★
//     「9/2まで メーターで 請求書を 押したら 全部 自動で 反映されよったろが」
//
//     2026-09-03 に 車の札を 足した 時、
//       ★取る所 … 関数の 外（109行）★
//       ★使う所 … 関数の 中（271行・別の 関数）★
//     に 書いた。関数の 中からは 外の 変数が 見えない ので
//     ★請求書へ 入れようと した 瞬間に 必ず 落ちる★。
//
//     落ちた 所は「1件 失敗しても 次へ」で 握りつぶす 作り だった ので
//     ★走行データは 今まで通り 入り、明細だけ 黙って 0件★に なった。
//
//   ★★実測（2026-09-11）★★
//     明細が 止まった 日 ………… 9/3
//     dk-sync-jobs の 最後の 配信 … 9/3 19:55（★同じ日★）
//     入っていない 分 …………… ★9/3〜9/10 の 24件 45,300円★
//     お客さんの 名前が 空の 分 … 0件（材料は そろっていた）
//     自動投入の スイッチ ……… 立っていた（"1"）
//
//   ★★一番 大事な 事★★
//     ★型の 検査（tsc）は この 間違いを 見ていた★
//       index.ts(271,17): error TS2304: Cannot find name 'carLabel'.
//     ★でも 誰も 赤に していなかった★ので 本番まで 通った。
//     ⇒ ★見ていたのに 止めなかった★＝見張りが 無いのと 同じ。
//
//   ★ここで 守る 事★
//     supabase/functions/**/*.ts に ★宣言されていない 名前★が 1つも 無い。
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-11 実測 ＝ 下に 書く）★★
// ============================================================
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const FN = path.join(ROOT, 'supabase', 'functions');

function tsAll() {
  const out = [];
  (function aruku(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      const st = fs.statSync(p);
      if (st.isDirectory()) aruku(p);
      else if (n.endsWith('.ts')) out.push(p);
    }
  })(FN);
  return out;
}

// ★Deno の 物・外の 取り寄せは この 検査では 見ない★
//   （手元に 型が 無いだけ＝間違いでは ない）
// ★★ここで 見るのは「★宣言されていない 名前★」だけ★★ 2026-09-11
//   ★訳★ 今回の 事故は ★TS2304 Cannot find name★ そのもの。
//     ・関数の 外の 変数を 中で 使う → ★必ず 落ちる★＝お客さんに 出る 事故
//     ・型が 曖昧（TS7006 any）などは ★動く★＝別の 話。
//   ⇒ ★全部を 赤に すると 直せない 物で 止まり、見張りごと 切られる★。
//     だから ★落ちる 物 だけ★ に 絞る。
//   ★見ていない 物★（わざと・ここに 書く）
//     ・TS7006 型が 曖昧（dk-customers に 2件・動く）
//     ・TS2769 呼び方の 食い違い（dk-issue-license に 1件・動く）
//     ・Deno / 外の 取り寄せ（手元に 型が 無いだけ）
const MITTSU = ['TS2304']; // ★宣言されていない 名前★

describe('★倉庫の 道具に 通らない 字が 無いか★', () => {
  it('★① 見る 相手が 本当に 居る（空回りしていない）★', () => {
    const f = tsAll();
    // eslint-disable-next-line no-console
    console.log('★見る ファイル★ ' + JSON.stringify(f.map((x) => path.basename(path.dirname(x)))));
    expect(f.length, '★見る ファイルが 1本も ありません★').toBeGreaterThan(0);
    const honmei = f.filter((x) => x.indexOf('dk-sync-jobs') >= 0);
    expect(honmei.length, '★請求書へ 流す 道具（dk-sync-jobs）を 見ていません★').toBeGreaterThan(0);
  });

  it('★★② 宣言されていない 名前が 1つも 無い★★', () => {
    const f = tsAll();
    // ★★呼び方で 中身が 取れない★★ 2026-09-11（実測）
    //   execFileSync は Windows で ★stdout が 空・status が null★ に なった。
    //   ⇒ ★何も 出ていない＝指摘 0件★ と 読み、見張りが 空回りする。
    //   ⇒ spawnSync（shell あり）に した ＝ 749字 取れる 事を 実測。
    const r = spawnSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      [
        'tsc',
        '--noEmit',
        '--skipLibCheck',
        '--target',
        'es2022',
        '--module',
        'esnext',
        '--moduleResolution',
        'bundler',
        ...f,
      ],
      { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' }
    );
    const deta = String(r.stdout || '') + String(r.stderr || '');
    // ★★空回りを 止める★★ 何も 出ないのに 緑に しない
    expect(
      deta.length,
      '★型の 検査から 何も 返って きません★（呼び方が 悪いと 0件に 見えます）'
    ).toBeGreaterThan(0);
    const warui = deta
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && l.indexOf('error TS') >= 0)
      .filter((l) => MITTSU.some((m) => l.indexOf(m) >= 0))
      // ★Deno の 物は 除く★（手元に 型が 無いだけ・倉庫では 動く）
      .filter((l) => l.indexOf("Cannot find name 'Deno'") < 0);
    // eslint-disable-next-line no-console
    console.log('★残った 指摘★ ' + (warui.length ? JSON.stringify(warui.slice(0, 6)) : '0件'));
    expect(
      warui,
      '★倉庫の 道具に 通らない 字が あります★' +
        '（2026-09-03 は これで 請求書が 8日間 止まりました）: ' +
        JSON.stringify(warui.slice(0, 6))
    ).toEqual([]);
  }, 120000);

  it('★★③ 車の札は 関数に 渡している★★', () => {
    const p = path.join(FN, 'dk-sync-jobs', 'index.ts');
    const s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
    const i = s.indexOf('async function pushToInvoiceApp');
    expect(i, '★請求書へ 入れる 関数が ありません★').toBeGreaterThan(0);
    // ★引数の 並びだけ 切り出す★
    const hikisuu = s.slice(i, s.indexOf(')', s.indexOf('(', i)) + 1);
    expect(
      hikisuu.indexOf('carLabel'),
      '★車の札を 関数に 渡していません★（関数の 中から 外の 変数は 見えません）'
    ).toBeGreaterThan(0);
    expect(hikisuu.indexOf('carNo'), '★並び順を 渡していません★').toBeGreaterThan(0);
  });
});
