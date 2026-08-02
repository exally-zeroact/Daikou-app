'use strict';
// ============================================================
// ★check-hosts.mjs の「目」が本当に見えているか 2026-08-02★
//
//   ★何があったか★
//     2026-08-02 21:47〜22:03 の約16分間、事務所テスト daikome-jimusho-test は
//     ★/ も /dashboard.html も /uriage.html も全部404★ だった。
//     ところが当時の check-hosts.mjs は「事務所の4画面」を見ていなかったので、
//     もし / だけたまたま通っていたら★素通りしていた★。
//
//     原因（測って確定・推測ではない）:
//       事務所は「メーターの /office/… 」を見に行く作り。その入口は
//       メーター側のデプロイが vercel.json の _comment で落ちていて★まだ無かった★。
//       事務所は上流メーターの404をそのまま返していた（X-Vercel-Error: NOT_FOUND が透過）。
//       ＝事務所の設定は正しく、原因は _comment 1つ。
//
//   ★だからここで固定する★
//     実物のホストは直ってしまったので、もう本番で赤を再現できない。
//     偽の応答で★当時の壊れた状態を作り直し、目が赤くなることを永久に固定★する。
//     （「直ったから確認できません」で終わらせない）
// ============================================================

let CH;
beforeAll(async () => {
  CH = await import('../../scripts/check-hosts.mjs');
});

const OFFICE = {
  role: 'office',
  side: 'test',
  proxyOf: 'daikou-app-test.vercel.app',
  appBase: 'https://daikou-app-test.vercel.app',
  serviceWorker: false,
};
const METER = {
  role: 'meter',
  side: 'test',
  repo: 'Daikou-app-test',
  appBase: 'https://daikou-app-test.vercel.app',
  serviceWorker: true,
};
const HOSTS = {
  'daikou-app-test.vercel.app': METER,
  'daikome-jimusho-test.vercel.app': OFFICE,
};

// 応答表から偽の probe を作る（表に無いパスは既定値）
function fakeProbe(table, defaults = {}) {
  const d = Object.assign({ status: 200, location: null }, defaults);
  const look = (url) => {
    const u = new URL(url);
    const key = u.host + u.pathname;
    return table[key] !== undefined
      ? table[key]
      : table[u.pathname] !== undefined
        ? table[u.pathname]
        : d;
  };
  return {
    async head(url) {
      const r = look(url);
      return { status: r.status, location: r.location || null };
    },
    async text(url) {
      const r = look(url);
      return { status: r.status, body: r.body !== undefined ? r.body : null };
    },
  };
}

const OK_CONFIG = "const APP_BASE = 'https://daikou-app-test.vercel.app';";
const OFFICE_PAGE = '<html>事務所 売上表 月次集計</html>';

describe('★当時(2026-08-02 21:57)の壊れた状態で赤になること★', () => {
  it('事務所の4画面が全部404なら赤（指示役が実測した状態そのもの）', async () => {
    const probe = fakeProbe({
      '/': { status: 404 },
      '/dashboard.html': { status: 404 },
      '/kyuryo.html': { status: 404 },
      '/uriage.html': { status: 404 },
      '/shukei.html': { status: 404 },
      '/sw.js': { status: 404 },
      '/index.html': { status: 404 },
      '/js/dk-config.js': { status: 200, body: OK_CONFIG },
    });
    const r = await CH.checkHost('daikome-jimusho-test.vercel.app', OFFICE, probe, HOSTS);
    expect(r.ng.length).toBeGreaterThan(0);
    expect(r.ng.join()).toContain('/dashboard.html');
    expect(r.ng.join()).toContain('/uriage.html');
  });

  it('★トップだけ通って中の画面が404でも赤（前の版はここを素通りしていた）★', async () => {
    const probe = fakeProbe({
      '/': { status: 200, body: OFFICE_PAGE },
      '/dashboard.html': { status: 404 },
      '/kyuryo.html': { status: 404 },
      '/uriage.html': { status: 404 },
      '/shukei.html': { status: 404 },
      '/sw.js': { status: 404 },
      '/index.html': { status: 404 },
      '/js/dk-config.js': { status: 200, body: OK_CONFIG },
    });
    const r = await CH.checkHost('daikome-jimusho-test.vercel.app', OFFICE, probe, HOSTS);
    expect(r.ng.length, '中の画面が全部404なのに通ってしまった').toBeGreaterThan(0);
  });

  it('★開けない住所へ308を飛ばしていたら赤★（事務所が開けなくなるのを止める）', async () => {
    const probe = fakeProbe({
      'daikou-app-test.vercel.app/': { status: 200 },
      'daikou-app-test.vercel.app/sw.js': { status: 200 },
      'daikou-app-test.vercel.app/js/dk-config.js': { status: 200, body: OK_CONFIG },
      'daikou-app-test.vercel.app/dashboard.html': {
        status: 308,
        location: 'https://daikome-jimusho-test.vercel.app/',
      },
      // ★送り先が死んでいる★
      'daikome-jimusho-test.vercel.app/': { status: 404 },
    });
    const r = await CH.checkHost('daikou-app-test.vercel.app', METER, probe, HOSTS);
    expect(r.ng.join()).toContain('開けない住所へ飛ばしている');
  });
});

describe('正しい状態では緑になること（目が過敏すぎないこと）', () => {
  const healthyOffice = {
    '/': { status: 200, body: OFFICE_PAGE },
    '/dashboard.html': { status: 200 },
    '/kyuryo.html': { status: 200 },
    '/uriage.html': { status: 200 },
    '/shukei.html': { status: 200 },
    '/sw.js': { status: 404 },
    '/index.html': { status: 404 },
    '/js/dk-config.js': { status: 200, body: OK_CONFIG },
  };

  it('事務所が全部開けて sw.js が居なければ緑', async () => {
    const r = await CH.checkHost(
      'daikome-jimusho-test.vercel.app',
      OFFICE,
      fakeProbe(healthyOffice),
      HOSTS
    );
    expect(r.ng).toEqual([]);
  });

  it('メーターが自分を指し 308 の送り先が生きていれば緑', async () => {
    const probe = fakeProbe({
      'daikou-app-test.vercel.app/': { status: 200 },
      'daikou-app-test.vercel.app/sw.js': { status: 200 },
      'daikou-app-test.vercel.app/js/dk-config.js': { status: 200, body: OK_CONFIG },
      'daikou-app-test.vercel.app/dashboard.html': {
        status: 308,
        location: 'https://daikome-jimusho-test.vercel.app/',
      },
      'daikome-jimusho-test.vercel.app/': { status: 200, body: OFFICE_PAGE },
    });
    const r = await CH.checkHost('daikou-app-test.vercel.app', METER, probe, HOSTS);
    expect(r.ng).toEqual([]);
  });
});

// ============================================================
// ★ログインの戻り先 (2026-08-02 実測で見つけた)★
//   Supabase は戻り先が許可リストに無いと、弾かずに★既定の戻り先へ黙って飛ばす★。
//   実測: daikome-jimusho-test の戻り先は
//     https://exally-test.vercel.app/daikou-seikyu.html（★請求書アプリ★）だった。
//   ＝事務所にログインしたつもりで別のアプリに着く。エラーは出ない。
//   画面を見ても気づけないので、機械で見るしかない。
// ============================================================
describe('★ログインの戻り先が自分の住所であること★', () => {
  const AUTH = 'https://sb.example.co';

  it('★別のアプリへ飛ばされていたら赤（実測で出た状態そのもの）★', async () => {
    const probe = {
      async head() {
        return {
          status: 303,
          location:
            'https://exally-test.vercel.app/daikou-seikyu.html#error=access_denied&error_code=otp_expired',
        };
      },
      async text() {
        return { status: 200, body: null };
      },
    };
    const r = await CH.checkLoginReturn('daikome-jimusho-test.vercel.app', AUTH, probe);
    expect(r.ok).toBe(false);
    expect(r.ng.join()).toContain('daikou-seikyu.html');
    expect(r.ng.join()).toContain('別のアプリに着く');
  });

  it('自分の住所へ戻ってくれば緑', async () => {
    const probe = {
      async head() {
        return {
          status: 303,
          location: 'https://daikome-jimusho.vercel.app/dashboard.html#error=access_denied',
        };
      },
      async text() {
        return { status: 200, body: null };
      },
    };
    const r = await CH.checkLoginReturn('daikome-jimusho.vercel.app', AUTH, probe);
    expect(r.ok).toBe(true);
    expect(r.ng).toEqual([]);
  });

  it('★似た名前に飛ばされていたら赤★（jimusho と jimusho-test の取り違え）', async () => {
    const probe = {
      async head() {
        return { status: 303, location: 'https://daikome-jimusho.vercel.app/dashboard.html' };
      },
      async text() {
        return { status: 200, body: null };
      },
    };
    const r = await CH.checkLoginReturn('daikome-jimusho-test.vercel.app', AUTH, probe);
    expect(r.ok, '本番の事務所へ戻されているのに通ってしまった').toBe(false);
  });
});

describe('★取り違え（一番こわいやつ）★', () => {
  it('事務所が反対側のメーターを見ていたら赤', async () => {
    const probe = fakeProbe({
      '/': { status: 200, body: OFFICE_PAGE },
      '/dashboard.html': { status: 200 },
      '/kyuryo.html': { status: 200 },
      '/uriage.html': { status: 200 },
      '/shukei.html': { status: 200 },
      '/sw.js': { status: 404 },
      '/index.html': { status: 404 },
      // ★本番のメーターを指してしまっている★
      '/js/dk-config.js': {
        status: 200,
        body: "const APP_BASE = 'https://daikou-app.vercel.app';",
      },
    });
    const r = await CH.checkHost('daikome-jimusho-test.vercel.app', OFFICE, probe, HOSTS);
    expect(r.ng.join()).toContain('APP_BASE が違う');
  });

  it('事務所に sw.js が居たら赤', async () => {
    const probe = fakeProbe({
      '/': { status: 200, body: OFFICE_PAGE },
      '/dashboard.html': { status: 200 },
      '/kyuryo.html': { status: 200 },
      '/uriage.html': { status: 200 },
      '/shukei.html': { status: 200 },
      '/sw.js': { status: 200 },
      '/index.html': { status: 404 },
      '/js/dk-config.js': { status: 200, body: OK_CONFIG },
    });
    const r = await CH.checkHost('daikome-jimusho-test.vercel.app', OFFICE, probe, HOSTS);
    expect(r.ng.join()).toContain('sw.js が居る');
  });

  it('事務所の /index.html でメーター本体が出たら赤', async () => {
    const probe = fakeProbe({
      '/': { status: 200, body: OFFICE_PAGE },
      '/dashboard.html': { status: 200 },
      '/kyuryo.html': { status: 200 },
      '/uriage.html': { status: 200 },
      '/shukei.html': { status: 200 },
      '/sw.js': { status: 404 },
      '/index.html': { status: 200 },
      '/js/dk-config.js': { status: 200, body: OK_CONFIG },
    });
    const r = await CH.checkHost('daikome-jimusho-test.vercel.app', OFFICE, probe, HOSTS);
    expect(r.ng.join()).toContain('メーター本体が出る');
  });
});
