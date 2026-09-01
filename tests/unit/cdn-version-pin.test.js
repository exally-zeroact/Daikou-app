'use strict';
// ============================================================
// ★★外から 借りる 道具は 版を x.y.z まで 書く★★ 2026-09-02
//
//   ★何が 起きていたか（実測）★
//     `<script src=".../@supabase/supabase-js@2">` と ★版を 途中までしか 書いていない★
//     書き方が 全社で ★41か所／14アプリ★ 在りました。
//     ・`@2` は ★今 2.112.4 を返します★（jsdelivr の x-jsd-version で 実測）
//     ・飲み屋だけ ★2.111.0 で 固定★＝★同じ 道具が アプリ間で 別の版で 動いていた★
//     ⇒ ★うちが 1文字も 直していないのに、ある日 中身が 入れ替わります★
//     ⇒ ★CI は 緑のまま★（CI は 外の 中身を 見ない）＝★今日まで 誰も 気づいていません★
//
//   ★2.112.4 に した 理由★
//     ★今 まさに 客に 配られている 版★だから。
//     実測 … `@2` と `@2.112.4` は ★212,426 bytes・sha256 f8ce7fab799af191 で バイト一致★
//     ⇒ ★今日の 動きは 1つも 変わりません（0円・0mm）★
//     （飲み屋の 2.111.0 に 揃えるのは ★版を 動かす＝試験が 要る★ので 別件）
//
//   ★なぜ repo に 見張りを 置くか★
//     手元の 機械に 仕掛け（hook）を 入れても ★CI も 他の 機械も 守れません★。
//     ⇒ ★repo の 試験に すれば どこで 書いても 赤に なります★
//
//   ★★わざと壊して 実測（2026-09-02）★★
//     @2 に 戻す → ★赤★／@latest → ★赤★／版なし → ★赤★
//     cdnjs の x.y まで（2.1）→ ★赤★／戻して ★緑★
//     ★CSP の 書き方（https://cdn.jsdelivr.net だけ）は 誤検知しません★
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

// ★外の 置き場★（増えたら ここに 足す）
const SOTO = /https:\/\/(?:cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com)\/[^"')\s]+/g;
// ★版が x.y.z まで 書いてある★印
const KATAI = /@\d+\.\d+\.\d+|\/\d+\.\d+\.\d+\//;

function html() {
  return fs
    .readdirSync(ROOT)
    .filter((f) => f.endsWith('.html'))
    .map((f) => ({ f, s: fs.readFileSync(path.join(ROOT, f), 'utf8') }));
}

describe('★外から 借りる 道具は 版を x.y.z まで 書く★', () => {
  const mono = html();

  it('★① 画面が 見つかっている（0枚でも 緑、に しない）★', () => {
    expect(mono.length, '★html が 1枚も 見つかりません（数え方が 壊れています）★').toBeGreaterThan(
      0
    );
  });

  it('★★② 版が 途中までの 借り物が 1つも 無い★★', () => {
    const warui = [];
    mono.forEach(({ f, s }) => {
      const li = s.match(SOTO) || [];
      li.forEach((u) => {
        // ★置き場そのもの（CSP の 書き方）は 数えない★＝ファイルを 指していない
        if (!/\/npm\/|\/ajax\/libs\/|unpkg\.com\/[^/]/.test(u)) return;
        if (!KATAI.test(u)) warui.push(f + ' : ' + u);
      });
    });
    expect(
      warui,
      '★版が 途中までです（ある日 中身が 入れ替わり、CI は 緑のまま 気づけません）★'
    ).toEqual([]);
  });

  it('★③ 借り物が 見つかっている（数え方が 壊れたら 気づく）★', () => {
    const kazu = mono.reduce((a, { s }) => a + (s.match(SOTO) || []).length, 0);
    expect(kazu, '★借り物が 1つも 見つかりません（数え方が 壊れています）★').toBeGreaterThan(0);
  });
});
