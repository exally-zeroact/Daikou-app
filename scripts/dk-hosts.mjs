// ============================================================
// scripts/dk-hosts.mjs
// ★4ホストの表 ─ ここが唯一の正★ 2026-08-02
//
//   司さん「テスト用も本番用も要るやろ」。そのとおりで、それまで本番しか見ていなかった。
//
//   ┌──────┬────────────────────────────┬──────────────┐
//   │      │ メーター(SWあり・圏外必須)   │ 事務所(SW無し) │
//   ├──────┼────────────────────────────┼──────────────┤
//   │テスト │ daikou-app-test.vercel.app │ daikome-jimusho-test │
//   │本番   │ daikou-app.vercel.app      │ daikome-jimusho      │
//   └──────┴────────────────────────────┴──────────────┘
//
//   ★一番こわい間違い★
//     事務所が出すQR(会社URL)が「別の側のメーター」を指すこと。
//     本番の事務所がテストのメーターを指したら、★従業員全員がテスト版で走り始める★。
//     だから「どのホストの事務所が、どのメーターを指すべきか」をここ1箇所に書いて、機械で縛る。
//
//   ★事務所は中身を持たない（メーター側の同じファイルを見せているだけ）★
//     ＝どのメーターを proxy しているかで APP_BASE が決まる。表と実物がズレたら赤にする。
// ============================================================

export const SIDE = { TEST: 'test', PROD: 'prod' };

export const HOSTS = {
  // ── メーター（ドライバーが使う・サービスワーカーあり・圏外で動く必要がある）──
  'daikou-app-test.vercel.app': {
    role: 'meter',
    side: SIDE.TEST,
    repo: 'Daikou-app-test',
    appBase: 'https://daikou-app-test.vercel.app', // 自分自身を指す
    serviceWorker: true,
  },
  'daikou-app.vercel.app': {
    role: 'meter',
    side: SIDE.PROD,
    repo: 'Daikou-app',
    appBase: 'https://daikou-app.vercel.app',
    serviceWorker: true,
  },

  // ── 事務所（社長が使う・★サービスワーカーを置かない★）──
  //   置くと「電波が揺れるとどのURLもメーターに化ける」あの事故が戻る
  'daikome-jimusho-test.vercel.app': {
    role: 'office',
    side: SIDE.TEST,
    proxyOf: 'daikou-app-test.vercel.app',
    appBase: 'https://daikou-app-test.vercel.app', // ★テストのメーターを指す★
    serviceWorker: false,
  },
  'daikome-jimusho.vercel.app': {
    role: 'office',
    side: SIDE.PROD,
    proxyOf: 'daikou-app.vercel.app',
    appBase: 'https://daikou-app.vercel.app', // ★本番のメーターを指す★
    serviceWorker: false,
  },
};

// repo名 → その repo が配信するメーターのホスト
export const REPO_TO_METER = {
  'Daikou-app-test': 'daikou-app-test.vercel.app',
  'Daikou-app': 'daikou-app.vercel.app',
};

// 「この事務所ホストは、どのメーターを指すべきか」
export function expectedAppBase(host) {
  const h = HOSTS[host];
  return h ? h.appBase : null;
}

// 同じ側（テスト同士／本番同士）で揃っているか
export function sideOf(host) {
  const h = HOSTS[host];
  return h ? h.side : null;
}

// ★事務所とメーターの取り違えを見つける★
//   返り値: 違反の説明の配列（空なら正しい）
export function checkPairing() {
  const bad = [];
  Object.keys(HOSTS).forEach((host) => {
    const h = HOSTS[host];
    if (h.role !== 'office') return;
    const meter = HOSTS[h.proxyOf];
    if (!meter) {
      bad.push(`${host}: proxy先 ${h.proxyOf} が表に無い`);
      return;
    }
    if (meter.role !== 'meter') bad.push(`${host}: proxy先がメーターでない`);
    if (meter.side !== h.side) {
      bad.push(`★${host}(${h.side}) が ${h.proxyOf}(${meter.side}) を指している＝側が違う★`);
    }
    if (h.appBase !== meter.appBase) {
      bad.push(`★${host} の APP_BASE(${h.appBase}) が proxy先(${meter.appBase})と違う★`);
    }
    if (h.serviceWorker) bad.push(`★${host} は事務所なのに serviceWorker=true★`);
  });
  return bad;
}
