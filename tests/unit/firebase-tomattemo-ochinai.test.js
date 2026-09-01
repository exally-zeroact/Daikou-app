'use strict';
// ============================================================
// ★★Firebase が 止まっても 業務が 落ちない★★ 2026-09-01
//
//   ★なぜ 要るか★
//     司さんの 決まり … ★「Firebaseは 2度と 使うな＝読む為にも 使わない」★
//     でも ★本番の コードには まだ 残っています★（2026-09-01 実測）。
//     外すのは これからですが、★その前に「止まっても 困らない」形★に しておきます。
//
//   ★実測（2026-09-01・実ブラウザで FB を 消して 呼んだ）★
//     ・Meter は 読める／★calcFare(5000m)=2,300円★（★料金は 影響なし★）
//     ・distance_m の 経路に FB は ★0か所★
//     ・★守りの 無い 呼び出しが 2か所 あって ReferenceError で 落ちた★
//         index.html  FB.setVehicleId  … 車を 選んだ時（★この下の「今日の距離」の表示まで 止まった★）
//         index.html  FB.updateVehicle … ★走行中 2秒ごと★（落ちると 走行の 表示が 止まる）
//       ⇒ 2か所とも ★他の 呼び出しと 同じ形★に 直しました。
//
//   ★ここで 見張る事★
//     ★FB を 呼ぶ 所は 全部 守られている★
//       （`typeof FB !== 'undefined'` か `FB && …` か ★try/catch の 中★）
//     ⇒ 新しく 足した 人が 守り忘れたら ★赤★に なります。
//
//   ★★わざと壊して 実測（2026-09-01）★★
//     index.html の 2秒ごとの 送信から 守り
//       `&& typeof FB !== 'undefined' && FB.updateVehicle` を 外す
//     ⇒ ★赤★ … 「★守りの 無い 呼び出しが あります★ index.html:8257 FB.updateVehicle」
//     戻して ★3本 緑★
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MIRU = ['index.html', 'js/meter.js', 'js/training-uploader.js'];

// ★守られている 印★（どれか 1つ 有れば よい）
const MAMORI = /typeof FB !== 'undefined'|typeof FB === 'undefined'|FB && |&& FB\.|try \{/;

// ★★「無い時に そのまま 緑」に しない★★
//   別の 見張り（nai-toki-midori）は ★readFileSync の 近くの return;★を
//   「無い時に 黙って 通す 形」として 数えます。
//   ここの return は ★行を 読み飛ばしているだけ★ですが ★形が 同じなら 見分けが つきません★。
//   ⇒ ★ファイルが 読めなかったら 必ず 赤★に する形に して、窓の 中に expect を 置きます。
function yomu(rel) {
  const p = path.join(ROOT, rel);
  expect(fs.existsSync(p), '★見に行く ファイルが ありません: ' + rel + '★').toBe(true);
  return fs.readFileSync(p, 'utf8');
}

function shirabe(rel) {
  const L = yomu(rel).split(String.fromCharCode(10));
  const naked = [];
  let n = 0;
  L.forEach((l, i) => {
    const m = l.match(/\bFB\.([A-Za-z_]+)/);
    if (!m) return;
    if (/^\s*(\/\/|\*|<!--)/.test(l)) return; // 説明文は 数えない
    n++;
    const mado = L.slice(Math.max(0, i - 8), i + 1).join('\n');
    if (!MAMORI.test(mado)) naked.push(rel + ':' + (i + 1) + ' FB.' + m[1]);
  });
  return { n, naked };
}

describe('★Firebase が 止まっても 業務が 落ちない★', () => {
  const kekka = () => MIRU.map(shirabe);

  it('★① 呼び出しが 見つかっている（0か所でも 緑、に しない）★', () => {
    const goukei = kekka().reduce((a, b) => a + b.n, 0);
    // ★0に なったら それは「外し終わった」時＝この試験ごと 消してよい★
    expect(
      goukei,
      '★FB の 呼び出しが 1つも 見つかりません（数え方が 壊れたか、外し終わった）★'
    ).toBeGreaterThan(0);
  });

  it('★★② FB を 呼ぶ 所は 全部 守られている★★', () => {
    const naked = kekka().flatMap((k) => k.naked);
    expect(
      naked,
      '★守りの 無い 呼び出しが あります（Firebase が 止まると ここで 業務が 落ちます）★'
    ).toEqual([]);
  });

  it('★③ 課金距離は Firebase に 触っていない★', () => {
    const s = yomu('js/meter.js');
    const warui = s.split('\n').filter((l) => /distance_m/.test(l) && /\bFB\./.test(l));
    expect(warui, '★距離の 行で Firebase を 呼んでいます★').toEqual([]);
  });
});
