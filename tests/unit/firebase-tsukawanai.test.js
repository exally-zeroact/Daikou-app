'use strict';
// ============================================================
// ★★Firebase は 使わない★★ 2026-09-01
//
//   ★司さんの 恒久ルール★
//     「★★Firebaseは2度と使うな＝★読む為にも★使わない★★」（2026-08-30）
//     2026-09-01「Firebaseは使うなっていよろがぼけ」
//
//   ★2026-09-01 まで 本番に 残っていた 物（実測）★
//     ・gstatic の Firebase SDK ★4本★（app / database / storage / remote-config）
//     ・js/firebase-config.js ／ js/firebase.js
//     ・js/trace-outbox.js ／ js/debug-trace.js ／ js/debug-log-uploader.js
//       （★Firebase RTDB へ 書く為だけ★の 物）
//     ・js/training-uploader.js（★Firebase Storage へ 30分ごと★）
//     ⇒ ★全部 読み込みを 外しました★
//
//   ★外した 後の 実測（実ブラウザ）★
//     ・`typeof FB` = undefined ／ `typeof firebase` = undefined
//     ・★Firebase への 通信 0本★（gstatic は 文字のフォントだけ）
//     ・★画面の 落ち 0件★（FB を 呼ぶ 15か所は 全部 守りが 在る）
//     ・★料金は 変わらない★ … calcFare(5000m) = ★2,300円★
//
//   ★ファイルは 消していません★
//     戻せるように 置いてあります。★読み込まない★＝使わない、が この決まりです。
//
//   ★★わざと壊して 実測（2026-09-01）★★
//     index.html に `<script src="js/firebase.js">` を 1本 戻す → ★赤★
//     gstatic の SDK を 1本 戻す → ★赤★
//     戻して ★緑★
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function yomu(rel) {
  const p = path.join(ROOT, rel);
  expect(fs.existsSync(p), '★見に行く ファイルが ありません: ' + rel + '★').toBe(true);
  return fs.readFileSync(p, 'utf8');
}

// ★画面が 読み込む 物だけを 見る★（説明文に 名前が 出るのは 構わない）
function yomikomu(html) {
  return (html.match(/<script[^>]+src="([^"]+)"/g) || []).map((t) =>
    t.replace(/.*src="/, '').replace(/".*/, '')
  );
}

describe('★Firebase は 使わない★', () => {
  it('★★① メーターの 画面が Firebase を 1本も 読み込まない★★', () => {
    const src = yomikomu(yomu('index.html'));
    const warui = src.filter((u) => /firebase/i.test(u));
    expect(warui, '★Firebase を 読み込んでいます★').toEqual([]);
  });

  it('★★② Firebase へ 書く為だけの 物も 読み込まない★★', () => {
    // trace / ログ … 行き先が Firebase RTDB 直書き（js/trace-outbox.js:26 など）
    const src = yomikomu(yomu('index.html'));
    [
      'js/trace-outbox.js',
      'js/debug-trace.js',
      'js/debug-log-uploader.js',
      'js/training-uploader.js',
    ].forEach((f) => {
      expect(src, '★' + f + ' を 読み込んでいます（Firebase へ 書く 物です）★').not.toContain(f);
    });
  });

  it('★③ 事務所の 画面も 読み込まない★', () => {
    ['dashboard.html', 'kyuryo.html', 'uriage.html', 'shukei.html', 'ryokinhyou.html'].forEach(
      (f) => {
        const warui = yomikomu(yomu(f)).filter((u) => /firebase/i.test(u));
        expect(warui, '★' + f + ' が Firebase を 読み込んでいます★').toEqual([]);
      }
    );
  });

  it('★④ 上げられないのに「送ります」と 聞かない（同意の 帯を 出さない）★', () => {
    const s = yomu('index.html');
    // ★帯を 出す 所が 必ず 早く 戻る★（出さない）
    expect(
      /function _showBanner\(\)[\s\S]{0,600}?return;/.test(s),
      '★上げ先が 無いのに 同意を 聞く 帯が 出ます★'
    ).toBe(true);
  });

  it('★⑤ 使わないだけ＝ファイルは 消していない（戻せる）★', () => {
    ['js/firebase.js', 'js/firebase-config.js', 'js/training-uploader.js'].forEach((f) => {
      expect(fs.existsSync(path.join(ROOT, f)), '★' + f + ' を 消しています★').toBe(true);
    });
  });
});
