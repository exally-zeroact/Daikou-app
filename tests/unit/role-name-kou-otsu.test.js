// ============================================================
// ★役割の名前に「甲」「乙」を使わない★ 2026-08-25（指示役の裁定）
//
//   ★理由（3つ）★
//     ①「甲欄・乙欄」は ★源泉徴収で実際に使う言葉★＝給与の画面で紛らわしい
//     ②★本番は 1種・2種 で動いている★
//       （1種＝長野真道/竹内真一郎/正岡卓/向垣内靖、2種＝白石正人/長野孝/結田航平）
//       同じ物を2つの名前で呼ぶと いつか事故る
//     ③テスト環境を ★本番に合わせる（逆はしない）★
//
//   ★倉庫も直した（2026-08-25 実測）★
//     テストの倉庫 … 甲・乙 前 5件 → 後 ★0件★
//     本番の倉庫   … 元から 0件（読んだだけ・触っていない）
//
//   ★住所の「甲・乙」は別物★
//     今治市 松本町 ★甲★／★乙★ は ★実在の小字★（tests/integration/address-street-build）。
//     役割の話ではないので ここでは見ない。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

// 役割の名前が出てくる所（作り物のデータと 画面）
const FILES = ['supabase/seed-test-fake.sql', 'kyuryo.html'];

describe('★役割の名前に 甲・乙 を使わない★', () => {
  it.each(FILES)('%s に 役割としての 甲・乙 が無い', (f) => {
    const p = path.join(ROOT, f);
    // ★2026-08-28: 前は 黙って return＝★無い画面は 何も見ずに緑★でした。
    expect(fs.existsSync(p), '★見るはずの画面が 在りません: ' + f + '★').toBe(true);
    const s = fs.readFileSync(p, 'utf8');
    // 役割として使われる形だけを見る（住所の小字は '甲' 単体では出てこない書き方）
    const hits = [];
    const RE = /['"「]([甲乙])['"」]/g;
    let m;
    while ((m = RE.exec(s))) {
      const line = s.slice(0, m.index).split('\n').length;
      hits.push(`${f} の ${line} 行あたり: ${m[0]}`);
    }
    expect(hits.length, `★役割の名前に 甲・乙 が ${hits.length} 件★\n  ${hits.join('\n  ')}`).toBe(
      0
    );
  });

  it('★作り物のデータは 本番と同じ 1種・2種★', () => {
    const s = fs.readFileSync(path.join(ROOT, 'supabase', 'seed-test-fake.sql'), 'utf8');
    expect(s, '★1種が無い★').toContain('"1種"');
    expect(s, '★2種が無い★').toContain('"2種"');
    expect(s, '★従業員に 1種が付いていない★').toContain("'1種'");
    expect(s, '★従業員に 2種が付いていない★').toContain("'2種'");
  });

  it('★住所の小字（今治市 松本町 甲・乙）は 別物なので 残す★', () => {
    const p = path.join(ROOT, 'tests', 'integration', 'address-street-build.test.js');
    // ★2026-08-28: 前は「無ければ return」＝★何も見ずに緑★でした。
    //   見張る相手が 消えたら ★見張れていない★＝赤にします。
    expect(fs.existsSync(p), '★見張る相手（address-street-build.test.js）が 在りません★').toBe(
      true
    );
    const s = fs.readFileSync(p, 'utf8');
    // ここを うっかり消すと 実在の住所が出せなくなる
    expect(s, '★実在の小字を消してしまっている★').toContain("koaza: '甲'");
    expect(s, '★実在の小字を消してしまっている★').toContain("koaza: '乙'");
  });
});
