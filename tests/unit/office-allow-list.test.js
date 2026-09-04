'use strict';
// ============================================================
// ★事務所で通す物の一覧が、実物のHTMLとズレていないこと 2026-08-02★
//
//   ★なぜ作ったか（指示役の実測）★
//     事務所は総当たり /:path* でメーターを丸ごと見せ、
//     /sw.js と /index.html だけ★名指しで塞いで★いた。実測するとこれが全部200:
//       fare.html / settings.html / history.html / help.html /
//       ★manifest.json★ / js/meter.js / js/gps.js / data/coarse-jp.js
//     ＝★画面が増えるたびに塞ぎ忘れる★形。今回の事故そのもの。
//     特に manifest.json。事務所のページが1箇所でも相対参照で読んだ瞬間、
//     ★iPhoneのホーム画面に「事務所」の顔でメーターが入る★。
//
//   ★直し方を逆にした★
//     「名指しで塞ぐ」→「★通す物だけ通す★」。総当たりを置かない＝残りは全部404。
//     通す物は目視で決めない。事務所4画面(+ログイン)のHTMLから機械で拾う。
//
//   ここで見張ること:
//     ・HTMLが参照している物が一覧から漏れていない（＝押したら404、を防ぐ）
//     ・一覧に余計な物が入っていない（＝メーターの物が事務所に出る、を防ぐ）
//     ・総当たりを置いていない（置いた瞬間に元の穴が戻る）
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

let OA;
beforeAll(async () => {
  OA = await import('../../scripts/office-allow.mjs');
});

function officeConfig() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'office-host', 'vercel.json'), 'utf8'));
}
const sources = () => officeConfig().rewrites.map((r) => r.source);

// ★★行き先は 全部 同じ 側を 指す★★ 2026-09-05
//   ★2026-09-05 に 私が 1行 足した時、★本番なのに テスト線を 指していました★
//     （テスト線から 写した まま 直し忘れ）
//   ⇒ ★本番の 事務所が テスト線の js を 読む★＝★直したのに 出ない／出てはいけない物が 出る★
//   ⇒ ★片方でも 混ざったら 赤★に する
//   ★★わざと壊して 赤に なる事を 見た（2026-09-05 実測）★★
//     1行を 逆の 側に する ⇒ ★赤★（ファイル名まで 出る）／戻して 緑
describe('★行き先は 全部 同じ 側を 指す★', () => {
  it('★本番とテスト線が 混ざっていない★', () => {
    const saki = officeConfig().rewrites.map((r) => ({
      s: r.source,
      host: String(r.destination).split('//')[1].split('/')[0],
    }));
    expect(saki.length, '★1本も 数えられていません★').toBeGreaterThan(10);
    const hosts = [...new Set(saki.map((x) => x.host))];
    const warui = hosts.length > 1 ? saki.filter((x) => x.host !== hosts[0]) : [];
    expect(
      warui.map((x) => x.s + ' → ' + x.host),
      '★行き先が 混ざっています（本番なのに テスト線／その逆）★'
    ).toEqual([]);
  });
});

describe('★通す物だけ通す（総当たりを置かない）★', () => {
  it('★/:path* のような総当たりが無い★', () => {
    const catchAll = sources().filter((s) => /[:*]/.test(s));
    expect(catchAll, '総当たりが有ると、メーターの画面もmanifestも事務所の住所で出る').toEqual([]);
  });

  it('★メーター専用の物が一覧に入っていない★', () => {
    const src = sources();
    [
      '/index.html',
      '/sw.js',
      '/manifest.json',
      '/fare.html',
      '/settings.html',
      '/history.html',
      '/help.html',
    ].forEach((p) => {
      expect(src, `${p} を事務所に出してはいけない`).not.toContain(p);
    });
  });

  it('★メーターの中身(js/meter.js・地図データ)が一覧に入っていない★', () => {
    const src = sources();
    src.forEach((s) => {
      expect(s.startsWith('/data/'), `${s} は地図データ＝事務所には要らない`).toBe(false);
    });
    ['/js/meter.js', '/js/gps.js', '/js/map-matcher.js'].forEach((p) => {
      expect(src).not.toContain(p);
    });
  });
});

describe('★一覧とHTMLがズレていないこと（増やし忘れ・減らし忘れ両方）★', () => {
  it('HTMLから機械で作った一覧と、実際の設定が一致する', () => {
    const { allow } = OA.buildAllowList(ROOT);
    const got = sources().sort();
    expect(got).toEqual(allow.slice().sort());
  });

  it('★HTMLが読む js が1つも漏れていない★（漏れると画面が動かない）', () => {
    const src = sources();
    const missing = [];
    // ★2026-08-28: 画面が 1枚も 無くても 緑でした＝★0件でも緑★。
    //   事務所の画面は ★必ず在る★（実測）。無いなら 消えた/名前が変わった＝★赤★。
    const nai = OA.OFFICE_PAGES.filter((page) => !fs.existsSync(path.join(ROOT, page)));
    expect(nai, '★事務所の画面が 在りません（OFFICE_PAGES を 直してください）★').toEqual([]);
    for (const page of OA.OFFICE_PAGES) {
      const f = path.join(ROOT, page);
      for (const r of OA.refsIn(fs.readFileSync(f, 'utf8'))) {
        if (!r.endsWith('.js')) continue;
        if (!src.includes(r)) missing.push(`${page} が読む ${r}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('★画面どうしの行き先が全部通してある★（タブを押して404にならない）', () => {
    const src = sources();
    ['/dashboard.html', '/kyuryo.html', '/uriage.html', '/shukei.html', '/login.html'].forEach(
      (p) => {
        expect(src, `${p} が通っていない＝押すと404`).toContain(p);
      }
    );
  });

  it('ホーム画面に追加する物は★事務所用★の方を通している', () => {
    const src = sources();
    expect(src).toContain('/office-manifest.json');
    expect(src).not.toContain('/manifest.json');
    expect(src).toContain('/icon-192.png');
  });
});

describe('★行き先の作り方★', () => {
  it('308で送り返される4画面は /office/ 経由（無限ループを避ける）', () => {
    const rw = officeConfig().rewrites;
    ['/dashboard.html', '/kyuryo.html', '/uriage.html', '/shukei.html'].forEach((p) => {
      const r = rw.find((x) => x.source === p);
      expect(new URL(r.destination).pathname, `${p} が308される道を通っている`).toBe('/office' + p);
    });
  });

  it('308されない物は そのままの道（/office/ を付けない）', () => {
    const rw = officeConfig().rewrites;
    ['/login.html', '/js/dk-config.js', '/office-manifest.json'].forEach((p) => {
      const r = rw.find((x) => x.source === p);
      expect(new URL(r.destination).pathname).toBe(p);
    });
  });

  it('トップは管理画面を出す', () => {
    const r = officeConfig().rewrites.find((x) => x.source === '/');
    expect(new URL(r.destination).pathname).toBe('/office/dashboard.html');
  });
});

describe('★洗い出しの道具そのものが空振りしていないこと★', () => {
  it('事務所の画面が5枚とも実在する', () => {
    const { missing } = OA.buildAllowList(ROOT);
    expect(missing).toEqual([]);
  });

  it('参照を拾えている（拾えないと「一覧が空でも緑」になる）', () => {
    const { allow } = OA.buildAllowList(ROOT);
    expect(allow.length).toBeGreaterThan(10);
    expect(allow).toContain('/js/dk-session.js');
    expect(allow).toContain('/js/payroll-daily.js');
  });

  it('★HTMLに新しい js を足したら一覧に出てくる★（拾い漏れの検出）', () => {
    const html = '<script src="js/atarashii.js"></script><a href="kyuryo.html">給料</a>';
    const refs = OA.refsIn(html);
    expect(Array.from(refs)).toContain('/js/atarashii.js');
    expect(Array.from(OA.pageLinksIn(html))).toContain('/kyuryo.html');
  });

  it('外の住所は拾わない（事務所を通らないので関係ない）', () => {
    const refs = OA.refsIn('<script src="https://cdn.example.com/x.js"></script>');
    expect(Array.from(refs)).toEqual([]);
  });
});

// ============================================================
// ★2026-08-26 実際に開いた穴（★見張りは緑のままだった★）★
//   給料明細のPDFで vendor/html2canvas.min.js / vendor/jspdf.umd.min.js を
//   ★押した時に el.src = 'vendor/…' で読む★形にした。
//   refsIn は ★HTMLの src= / href= しか見ない★ので この2本を拾わず、
//   事務所の住所（daikome-jimusho{,-test}.vercel.app）で ★実測 404★。
//   ＝押しても紙が出ず、保険の window.print()（司さんが突き返した紙）に落ちる。
//   ⇒ runtimeRefsIn を足した。ここは ★その穴が戻らないこと★ を見張る。
// ============================================================
describe('★JSが 後から読む物も 通してある★', () => {
  it('★紙(PDF)の道具2本が 事務所を通る★（通らないと 押しても紙が出ない）', () => {
    const src = sources();
    ['/vendor/html2canvas.min.js', '/vendor/jspdf.umd.min.js'].forEach((p) => {
      expect(src, `${p} が通っていない＝事務所で404＝PDFが出ない`).toContain(p);
    });
  });

  it('★引数で渡す形も 拾える★（これが 実際に開いた穴）', () => {
    // ★実物の書き方★（kyuryo.html の loadPdfLibs）
    //   function one(src, has) { … el.src = src; … }
    //   one('vendor/html2canvas.min.js', …)
    //   ＝★el.src = <変わる物>★ なので、src= を見る道具では ★字が出てこない★。
    const html =
      '<html><body><script>' +
      'function one(src, has) { var el = document.createElement("script"); el.src = src; }' +
      "one('vendor/html2canvas.min.js', function () { return !!window.html2canvas; });" +
      '</script></body></html>';
    expect([...OA.runtimeRefsIn(html, ROOT)], '★JSが後から読む物を 拾えていない★').toContain(
      '/vendor/html2canvas.min.js'
    );
    // ★src= だけを見る道具では 拾えない★＝だから runtimeRefsIn を足した
    expect([...OA.refsIn(html)], '前提が変わった').not.toContain('/vendor/html2canvas.min.js');
  });

  it('★実物の kyuryo.html でも 拾えている★（見本ではなく 本物で押す）', () => {
    const html = fs.readFileSync(path.join(ROOT, 'kyuryo.html'), 'utf8');
    const got = [...OA.runtimeRefsIn(html, ROOT)];
    ['/vendor/html2canvas.min.js', '/vendor/jspdf.umd.min.js'].forEach((p) => {
      expect(got, `★本物の画面から ${p} を拾えていない★`).toContain(p);
    });
  });

  it('★説明文の中のファイル名は 拾わない★（コメントを消してから見る）', () => {
    const html =
      '<html><body><script>' +
      '// むかしは js/meter.js を読んでいた\n' +
      '/* data/coarse-jp.js も読んでいた */\n' +
      'var a = 1;' +
      '</script></body></html>';
    const got = [...OA.runtimeRefsIn(html, ROOT)];
    expect(got, '★説明文の中の名前まで通してしまう★').not.toContain('/js/meter.js');
    expect(got, '★説明文の中の名前まで通してしまう★').not.toContain('/data/coarse-jp.js');
  });

  it('★repoに無いファイル名は 拾わない★（綴り違い・作り話を通さない）', () => {
    const html =
      '<html><body><script>' +
      "var el={}; el.src = 'vendor/aru-hazu-no-nai-mono.js';" +
      '</script></body></html>';
    expect([...OA.runtimeRefsIn(html, ROOT)]).toEqual([]);
  });
});
