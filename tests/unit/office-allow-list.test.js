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
    for (const page of OA.OFFICE_PAGES) {
      const f = path.join(ROOT, page);
      if (!fs.existsSync(f)) continue;
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
