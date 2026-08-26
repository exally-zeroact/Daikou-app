// tests/drift-static/billing-gates-anchor.test.js
//
// ★AIの指摘②③④を 実物で測った結果を「戻らないように」固定する★ 2026-08-26（指示役の裁定）
//
//   ai-bug-hunter が出していた 3件を、本物の Worker B ＋ 本物の meter ＋ 実トレース2本で
//   実際に走らせて測った（docs/ai-bug-hunter-archive.md:33 / :36 / :39・issue #23）。
//   結果は ②嘘 ／ ④嘘 ／ ③条件つきで本当（今の本番では起きない）。
//   ★「嘘」だった2件も 消さない★＝★書き方を1つ変えたら 復活する★所だから。
//   ここは その「1つ」を 見張る。
//
//   ★AIの指摘を読む時の決まり（2026-08-26）★
//     ★行番号を信じない。関数名で探す。★
//     実例: AIは③を「map-matcher.js:L1455-L1520」と書いたが、今の L1455 は Viterbi の採点で、
//           outSnap を渡すのは L331。★AIの行番号は 古い版の物★（claude-sonnet-4-5・2026-08-16）。
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const meterSrc = () => fs.readFileSync(path.join(ROOT, 'js', 'meter.js'), 'utf8');
const pipeSrc = () => fs.readFileSync(path.join(ROOT, 'js', 'pipeline-distance.js'), 'utf8');

describe('★課金距離の門（AIの指摘②③④の実測を固定する）★', () => {
  // ── ② ────────────────────────────────────────────────
  it('★②随伴車k は 1.0 の定数のまま★（変数に戻すと worker の返事で距離が動く）', () => {
    const s = meterSrc();
    // ★実測（2026-08-26）★: worker の返す距離源を わざと 'obd' に書き換えて実トレース2本を流したが
    //   課金距離の差は ★0.000000m・料金の差 ¥0★。理由は ここが「書かれた定数の1.0」だから。
    expect(s, '★_kForDelta が 1.0 の定数でない＝worker の返事で距離が動く形に戻っている★').toMatch(
      /const\s+_kForDelta\s*=\s*1\.0\s*;/
    );
    // ★距離源(pipelineDeltaSrc)を 距離の掛け算に使っていない事★
    const kLine = s.split('\n').findIndex((l) => /const\s+_kForDelta\s*=/.test(l));
    const cal = s.split('\n')[kLine + 3] || '';
    expect(cal, '★cal の作り方が変わった（k の掛け算に別の物が入った）★').toContain(
      'delta * _kForDelta'
    );
    expect(cal, '★距離源(pipelineDeltaSrc)が 距離の掛け算に入った★').not.toContain(
      'pipelineDeltaSrc'
    );
  });

  // ── ④ ────────────────────────────────────────────────
  it('★④課金距離を増やす所は 門の内側にしか無い★（running かつ 確定していない）', () => {
    const lines = meterSrc().split('\n');
    const kasan = [];
    lines.forEach((l, i) => {
      if (/^\s*state\.distance_m\s*\+=\s*/.test(l)) kasan.push(i);
    });
    expect(kasan.length, '★課金距離を増やす所の数が変わった（今は 2か所）★').toBe(2);

    // それぞれの ★手前★ に門が在るか（同じ関数の中・30行以内）を見る
    const MON = /state\.running\s*&&\s*!state\.billing_frozen/;
    kasan.forEach((i) => {
      const mae = lines.slice(Math.max(0, i - 30), i).join('\n');
      expect(
        MON.test(mae),
        `★${i + 1}行目「${lines[i].trim()}」の手前30行に 門（running かつ 未確定）が無い★\n` +
          '  ＝実車していない/確定した後でも 課金距離が増える形になっています'
      ).toBe(true);
    });

    // ★業務の走行は 別の門（business_active）＝わざと増やす★（後付メーターと対等にする決まり）
    const bz = lines.findIndex((l) => /^\s*state\.business_distance_m\s*=\s*\(/.test(l));
    expect(bz, '★業務の走行を増やす所が見つからない★').toBeGreaterThan(-1);
    const bzMae = lines.slice(Math.max(0, bz - 5), bz).join('\n');
    expect(bzMae, '★業務の走行の門が変わった★').toMatch(
      /state\.business_active\s*&&\s*!state\.billing_frozen/
    );
  });

  // ── ③ ────────────────────────────────────────────────
  it('★③距離は「平滑した生GPSの弦」のまま★（道路の当てはめに戻すと 距離が増える）', () => {
    const s = pipeSrc();
    expect(
      s,
      '★smoothedRawMode を false に戻している★\n' +
        '  ★戻すと：道路の当てはめ(snap)が距離に効くようになり、\n' +
        '    その当てはめが欠けた時の退避（greedy 最近傍）で\n' +
        '    ★距離が +0.02%〜+0.88% 増えます（2026-08-26 実測）★\n' +
        '    実測：4.2km で +0.87m ／ 2.4km で +21.33m（料金の差は どちらも ¥0）\n' +
        '  ★今の姿では 当てはめを 距離に一度も使っていません★（実測 snapHit 0 / snapMiss 599）\n' +
        '  戻すなら ★退避経路（js/pipeline-distance.js の snapper.snap）を先に測ってから★'
    ).toMatch(/^\s*smoothedRawMode:\s*true,/m);

    // 退避経路そのものは 在ってよい（在る事を覚えておく＝消えたらここが赤になる）
    const taihi = (s.match(/snapper\.snap\(cur\.lat, cur\.lng\)/g) || []).length;
    expect(taihi, '★退避経路（greedy 最近傍）の数が変わった★').toBe(2);
  });
});
