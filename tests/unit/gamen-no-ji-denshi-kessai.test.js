'use strict';
// ============================================================
// ★★どこにも「PayPay」を 残さない（電子決済に そろえる）★★ 2026-09-08
//
//   ★司さん★「PayPayやなくて電子決済にして」
//             →「PayPayって書いてるとこ全部電子決済にしてな」
//             →「★直して全部やれ★」
//
//   ★どこまで やったか★
//     ①画面に 出る 字 ………………… 電子決済（例として PayPay と 書くのも やめた）
//     ②説明（コメント）・見張りの 言い方 … 電子決済
//     ③ファイルの 名前 ……………… denshi-*
//     ④★中の 名前（変数・関数・印）★ … denshi / DENSHI_*
//     ⑤★倉庫の 列の 名前★ ………… paypay_yen → ★denshi_yen★
//
//   ★倉庫の 列を 変えて よかったのか（先に 数えた）★
//     はじめは「前に 入れた 分が 読めなくなる」と 思って 残していました。
//     ★2026-09-08 に 数えたら 本番も テストも 0行★（dk_month_extras / dk_day_extras）
//     ⇒ ★失う 物が 無い★ので 変えました。
//       （そもそも rename は 中身を 消しません。列の 札を 付け替えるだけ）
//
//   ★見る 範囲（先に 数えて 名指しで 書く）★
//     ・画面 3枚 …… nyuryoku.html / shukei.html / uriage.html
//     ・部品 3本 …… js/jippi-hozon.js / js/getsuji-agg.js / js/jimusho-footer.js
//     ・倉庫の 台本 … supabase/*.sql（全部）
//     ⇒ ★司さんの 言葉そのもの（「PayPayやなくて…」）だけ 残してよい★
//       ＝何を 言われたかの 記録。消すと 後で 分からなく なる。
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-08 実測 ＝ 下に 書く）★★
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const GAMEN = ['nyuryoku.html', 'shukei.html', 'uriage.html'];
const BUHIN = [
  path.join('js', 'jippi-hozon.js'),
  path.join('js', 'getsuji-agg.js'),
  path.join('js', 'jimusho-footer.js'),
];

function yomu(f) {
  return fs.readFileSync(path.join(ROOT, f), 'utf8');
}

// ★<script> の 中は 見ない★（画面の 字だけ 見たい時）
function honbun(f) {
  return yomu(f)
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

// ★司さんの 言葉そのもの★は 残してよい（記録）
const SHIJI = [
  'PayPayやなくて電子決済にして',
  'PayPayって書いてるとこ全部電子決済にしてな',
  'PayPayいれたら現金が減るようにしろよ',
];

// ★その 場所が 司さんの 言葉の 中か★
function shijiNoNaka(s, i) {
  return SHIJI.some((k) => {
    let from = 0;
    for (;;) {
      const p = s.indexOf(k, from);
      if (p < 0) return false;
      if (i >= p && i < p + k.length) return true;
      from = p + 1;
    }
  });
}

function nokori(s) {
  const out = [];
  const re = /PayPay|paypay/g;
  let m;
  while ((m = re.exec(s))) {
    if (shijiNoNaka(s, m.index)) continue;
    out.push(s.slice(Math.max(0, m.index - 25), m.index + 25).replace(/\s+/g, ' '));
  }
  return out;
}

describe('★どこにも PayPay を 残さない★', () => {
  it('★① 見る 物が 全部 読めている★（0本を 見て 緑に しない）', () => {
    GAMEN.concat(BUHIN).forEach((f) => {
      expect(yomu(f).length, '★' + f + ' が 読めません★').toBeGreaterThan(300);
    });
    const sql = fs.readdirSync(path.join(ROOT, 'supabase')).filter((f) => f.endsWith('.sql'));
    expect(sql.length, '★倉庫の 台本が 1本も ありません★').toBeGreaterThan(3);
  });

  it('★② 「電子決済」の 字が 画面 3枚に 在る★', () => {
    GAMEN.forEach((f) => {
      expect(
        honbun(f).indexOf('電子決済'),
        '★' + f + ' に 電子決済 の 字が ありません★'
      ).toBeGreaterThan(0);
    });
  });

  it('★③ 画面に PayPay の 字が 1つも 無い★', () => {
    const warui = [];
    GAMEN.forEach((f) => {
      nokori(honbun(f)).forEach((x) => warui.push(f + ' … 「' + x + '」'));
    });
    expect(
      warui,
      '★PayPay の 字が 画面に 残っています★ ⇒ 司さん「PayPayって書いてるとこ全部電子決済にしてな」'
    ).toEqual([]);
  });

  it('★④ 部品（js）にも paypay が 残っていない★', () => {
    const warui = [];
    BUHIN.forEach((f) => {
      nokori(yomu(f)).forEach((x) => warui.push(f + ' … 「' + x + '」'));
    });
    expect(warui, '★部品に paypay が 残っています★ ⇒ 司さん「直して全部やれ」').toEqual([]);
  });

  it('★⑤ 倉庫の 台本（SQL）にも paypay が 残っていない★', () => {
    const dir = path.join(ROOT, 'supabase');
    const warui = [];
    fs.readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      // ★名前替えの 台本だけは 除く★
      //   旧い 名前を 書かないと 名前を 変えられない（それ自体が 仕事）
      .filter((f) => f !== 'apply-denshi-kessai-rename.sql')
      .forEach((f) => {
        nokori(fs.readFileSync(path.join(dir, f), 'utf8')).forEach((x) =>
          warui.push(f + ' … 「' + x + '」')
        );
      });
    expect(warui, '★倉庫の 台本に paypay が 残っています★').toEqual([]);
  });

  it('★⑥ 倉庫へ 送る 列の 名前は denshi_yen★', () => {
    const s = yomu(path.join('js', 'jippi-hozon.js'));
    expect(s.indexOf('denshi_yen'), '★送る 列の 名前が 違います★').toBeGreaterThan(0);
    // ★倉庫の 引っ越しの 台本が 在る★＝画面だけ 直して 倉庫を 忘れていない
    const rename = path.join(ROOT, 'supabase', 'apply-denshi-kessai-rename.sql');
    expect(fs.existsSync(rename), '★倉庫の 名前替えの 台本が ありません★').toBe(true);
    const r = fs.readFileSync(rename, 'utf8');
    expect(r.indexOf('rename column'), '★名前替えを していません★').toBeGreaterThan(0);
    // ★窓は security_invoker を 付け直す★（2026-09-06 の 事故）
    expect(r.indexOf('security_invoker = true'), '★窓の 鍵を 付け直していません★').toBeGreaterThan(
      0
    );
  });
});
