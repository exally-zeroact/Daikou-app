'use strict';
// ============================================================
// ★★「見えなかった分」を 倉庫まで 運ぶ 道★★ 2026-09-01
//
//   ★今 どこまで 出来ているか（★正直に★）★
//     ①数える …………… ★出来ている★（js/pipeline-distance.js mienakattaBun・本番に 在る）
//     ②上げる 口 ……… ★出来た★（js/job-sync.js が shift の 3つを そのまま 上げる）
//     ③倉庫の 列 ……… ★SQLは 書いた★（supabase/apply-mienai-columns.sql）★当てるのは 司さん★
//     ③-b 途中の 関数 …… ★出来た★（supabase/functions/dk-sync-jobs）
//        ★ここで 落としていました★… 画面は 送っていたのに 関数が 列を 名指しで 組み直すので
//        ★黙って 捨てられていた★（2026-09-01 に SQL を 当てる時に 気づいた）
//     ④★数えた 値を ②へ 渡す★ … ★まだ★
//        理由 … その値は ★課金の Worker（map-matcher → pipeline-distance）の 中★に あり、
//        本体へ 返す 道が ありません。★課金の 経路なので 雑に 触りません★。
//
//   ★ここで 見張る事★
//     ・②の 口が ★開いたまま★である（消されたら 気づく）
//     ・②が ★null を そのまま 上げる★（★数字が 無いのに 0 と 書かない★）
//     ・③の SQL が ★足すだけ★である（消す/書き換える 文が 混ざっていない）
//
//   ★わざと壊して 実測★（口を 消す／0 に する／SQL に drop を 混ぜる → 3本とも 赤）
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const JS = path.join(ROOT, 'js', 'job-sync.js');
const SQL = path.join(ROOT, 'supabase', 'apply-mienai-columns.sql');
const HASHIRA = ['mienai_kaisuu', 'mienai_byou', 'mienai_m'];

describe('★「見えなかった分」を 倉庫まで 運ぶ 道★', () => {
  it('★① 上げる 口が 開いている（3つとも）★', () => {
    const s = fs.readFileSync(JS, 'utf8');
    HASHIRA.forEach((k) => {
      expect(s, '★' + k + ' を 上げる 口が ありません★').toContain(k + ':');
    });
  });

  it('★★② 数字が 無い時は null（★0 と 書かない★）★★', () => {
    const s = fs.readFileSync(JS, 'utf8');
    HASHIRA.forEach((k) => {
      const re = new RegExp(
        k + ':\\s*_isNum\\(shift\\.' + k + '\\)\\s*\\?\\s*shift\\.' + k + '\\s*:\\s*null'
      );
      expect(
        re.test(s),
        '★' + k + ' が「無い時に 0」に なっています（★取っていない★と 見分けが つきません）★'
      ).toBe(true);
    });
  });

  it('★③ 倉庫の SQL は「足すだけ」★', () => {
    const s = fs.readFileSync(SQL, 'utf8');
    expect(s, '★列を 足す 文が ありません★').toMatch(/add column if not exists/);
    HASHIRA.forEach((k) => {
      expect(s, '★' + k + ' が SQL に ありません★').toContain(k);
    });
    // ★消す/入れ替える 文が 混ざっていない★
    [/drop\s+column/i, /drop\s+table/i, /delete\s+from/i, /truncate/i, /update\s+daikome/i].forEach(
      (re) => {
        expect(re.test(s), '★足すだけでは ない 文が 混ざっています（' + re + '）★').toBe(false);
      }
    );
  });

  it('★★③-b 途中の 関数も 3つを 通す（ここで 落としていた）★★', () => {
    const p = path.join(ROOT, 'supabase', 'functions', 'dk-sync-jobs', 'index.ts');
    const s = fs.readFileSync(p, 'utf8');
    HASHIRA.forEach((k) => {
      expect(s, '★関数が ' + k + ' を 落としています（画面は 送っているのに 消える）★').toContain(
        k + ':'
      );
    });
  });

  it('★④ 数える 仕組みは まだ 生きている（消していない）★', () => {
    const s = fs.readFileSync(path.join(ROOT, 'js', 'pipeline-distance.js'), 'utf8');
    expect(s, '★mienakattaBun が 消えています★').toContain('mienakattaBun');
  });
});
