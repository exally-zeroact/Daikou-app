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
//   ★★2026-09-02 追記：この 見張りには ★穴★が 在りました★★
//     ★読み込む ファイル（script src）しか 見ていませんでした★。
//     ⇒ ★画面の 中に 直接 書いてあった 送り先★を 見逃していました:
//       index.html の (function _startupMetrics(){…})() が
//       https://daikou-app-c821a-…firebasedatabase.app/debug_traces.json へ
//       ★起動の たびに POST★ していました（sendBeacon → だめなら fetch）。
//     ★誰に 起きていたか★
//       ・新しい 端末 … 飛ばない（DAIKOME_DEVICE_ID が 無いので 途中で 戻る）
//       ・★前に 一度でも trace を 入れた 端末★ … ID が 残っているので ★飛び続けていた★
//     ★実測（実ブラウザ・DAIKOME_DEVICE_ID を 入れて 36秒 待った）★
//       外す前 … ★POST 1本★（daikou-app-c821a-…firebasedatabase.app）
//       外した後 … ★0本★
//     ⇒ ★④で「画面の 中に 直接 書いた 住所も 数える」★ように 直しました。
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

// ★★repo の 画面を 全部 集める★★ 2026-09-04
//   ★前は 手書きの 名簿でした★（index + 事務所5枚 ＝ 6枚）。
//   実際は ★21枚★ 在り、名簿に 無い ★sub.html★ が
//   ★Firebase の SDK 2本 + firebase-config.js + firebase.js を 読み込んだまま★
//   ★本番で 生きていました★（HTTP 200・どこからも リンクは 無い）。
//   ⇒ ★名簿を やめて 機械に 全部 数えさせます★
function zenGamen() {
  const deta = [];
  const oku = ['node_modules', '.git', 'coverage', 'data', 'dist'];
  (function aruku(d, fukasa) {
    if (fukasa > 4) return;
    for (const na of fs.readdirSync(d)) {
      if (oku.indexOf(na) >= 0) continue;
      const p = path.join(d, na);
      const st = fs.statSync(p);
      if (st.isDirectory()) aruku(p, fukasa + 1);
      else if (na.endsWith('.html')) deta.push(path.relative(ROOT, p).split(path.sep).join('/'));
    }
  })(ROOT, 0);
  return deta.sort();
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

  // ★★③ 手書きの 名簿を やめた（2026-09-04）★★ 事務所5枚 → ★repo の 画面 全部★
  it('★★③ repo の 画面が 1枚も Firebase を 読み込まない★★', () => {
    const gamen = zenGamen();
    // ★何枚 見たかも 数える★（0枚を 見て 緑に しない）
    expect(gamen.length, '★画面を 1枚も 見つけられていません★').toBeGreaterThan(15);
    const warui = [];
    for (const f of gamen) {
      const uso = yomikomu(yomu(f)).filter((u) => /firebase/i.test(u));
      if (uso.length) warui.push(f + ' → ' + uso.join(','));
    }
    expect(warui, '★Firebase を 読み込んでいる 画面が あります★').toEqual([]);
  });

  it('★④ 上げられないのに「送ります」と 聞かない（同意の 帯を 出さない）★', () => {
    const s = yomu('index.html');
    // ★帯を 出す 所が 必ず 早く 戻る★（出さない）
    expect(
      /function _showBanner\(\)[\s\S]{0,600}?return;/.test(s),
      '★上げ先が 無いのに 同意を 聞く 帯が 出ます★'
    ).toBe(true);
  });

  // ★★④ 画面の 中に 直接 書いた 送り先も 数える★★ 2026-09-02
  //   ★読み込む ファイルだけ 見ていて 見逃しました★（上の 追記）
  //   ⇒ ★説明文を 消してから★ 中身に Firebase の 住所が 無い事を 見ます
  //     （説明文には 経緯として 名前が 出るので、消さないと 直せません）
  it('★★④ 画面の 中に Firebase の 送り先が 1つも 無い★★', () => {
    const kesu = (x) =>
      x
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(new RegExp('(^|[^:])//[^' + String.fromCharCode(10) + ']*', 'g'), '$1 ');
    const ATENA = /firebasedatabase\.app|firebaseio\.com|gstatic\.com\/firebasejs|firebasestorage/;
    zenGamen().forEach((f) => {
      const naka = kesu(yomu(f));
      expect(
        ATENA.test(naka),
        '★' + f + ' の 中に Firebase の 送り先が 書いてあります（説明文では ありません）★'
      ).toBe(false);
    });
  });

  // ★★⑥ 会社の 道具（CI が 毎日 走らせる 物）も 数える★★ 2026-09-04
  //   ★①〜⑤は 画面（html）しか 見ていませんでした★
  //   ⇒ ★毎日 走る .github の 見張りが Firebase を 読んでいたのを 見逃していました★
  //     tests/real-trace-compare.js … cron 0 0 * * *（本番・テストの ★2つの repo で★）
  //     実測（2026-09-04）… 直近8回とも success ＝ ★毎日 Firebase を 読んで「未測定」と 返していた★
  //   ⇒ 材料を ★手元の data/traces/*.json★ から 読む形に 直しました
  it('★★⑥ CI が 走らせる js に Firebase の 送り先が 1つも 無い★★', () => {
    const WF = path.join(ROOT, '.github', 'workflows');
    expect(fs.existsSync(WF), '★.github/workflows が ありません★').toBe(true);
    const kesu = (x) =>
      x
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(
          new RegExp(
            '(^|[^:])//[^' + String.fromCharCode(10) + String.fromCharCode(13) + ']*',
            'g'
          ),
          '$1 '
        );
    const ATENA = /firebasedatabase\.app|firebaseio\.com|gstatic\.com\/firebasejs|firebasestorage/;
    const warui = [];
    let mita = 0;
    for (const y of fs.readdirSync(WF)) {
      const yml = fs.readFileSync(path.join(WF, y), 'utf8');
      const files = [...new Set(yml.match(/[A-Za-z0-9_./-]+\.(js|mjs|cjs)/g) || [])];
      // ★飛ばす書き方は しない★（無い物を 黙って 通すと 見張りが 嘘に なる）
      const aru = files.filter((rel) => {
        const p = path.join(ROOT, rel);
        return fs.existsSync(p) && fs.statSync(p).isFile();
      });
      for (const rel of aru) {
        const p = path.join(ROOT, rel);
        mita++;
        if (ATENA.test(kesu(fs.readFileSync(p, 'utf8')))) warui.push(y + ' → ' + rel);
      }
    }
    // ★数えた 数も 出す★（0本を 見ただけで 緑に しない＝何も 見ていない のと 区別する）
    expect(mita, '★CI が 走らせる js を 1本も 見つけられていません★').toBeGreaterThan(10);
    expect(warui, '★CI が Firebase を 読んでいます★').toEqual([]);
  });
  it('★⑤ 使わないだけ＝ファイルは 消していない（戻せる）★', () => {
    ['js/firebase.js', 'js/firebase-config.js', 'js/training-uploader.js'].forEach((f) => {
      expect(fs.existsSync(path.join(ROOT, f)), '★' + f + ' を 消しています★').toBe(true);
    });
  });
});
