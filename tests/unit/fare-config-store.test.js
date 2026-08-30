'use strict';
// ============================================================
// ★★料金表の 引っ越し（Firebase → Supabase）の 見張り★★ 2026-08-30
//
//   ★司さんの指示★「全部Supabaseに引越ししたろが」「★Firebaseは2度と使うな★」「引っ越しもしろよ」
//
//   ★どちらの物差しか★
//     ★距離の採点では ありません★。距離には 1文字も 触りません。
//     ★お金（料金）そのもの★を 見ます: ★引っ越しの 前後で 1円も 変わらない事★。
//
//   ★ここで 見る事★
//     ①★Firebase を 1行も 呼んでいない★（司さんの「2度と使うな」）
//     ②★料金が 1円も 変わらない★（★段の 境目 91個を 全部 含む★・前の値と 新しい置き場の 既定が 同じ）
//     ③★足りない所を 埋めても 在る値は 書き換えない★（勝手に 料金を 変えない）
//     ④★倉庫に 無い会社でも 空にしない★（既定を 返す）
//     ⑤★変えた記録が 残る／戻せる★（前は 上書き1件だけで 戻せなかった）
//
//   ★既定の値は 2026-08-30 に 引っ越し元から 読んだ 実物と 同じ★
//     base_fare 1300 ／ base_distance_m 1000 ／ add_fare 100 ／ add_distance_m 420
//     rounding 1 ／ version 2 ／ 夜間・週末・冬・待ち＝全部 OFF
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const P = path.join(ROOT, 'js', 'fare-config-store.js');
const S = require(P);
const M = require(path.join(ROOT, 'js', 'meter.js'));

// ★2026-08-30 に 引っ越し元から 読んだ 実物★（この値から 1円も 動かさない）
const HIKKOSHI_MOTO = {
  version: 2,
  base_fare: 1300,
  base_distance_m: 1000,
  add_fare: 100,
  add_distance_m: 420,
  rounding: 1,
  tiersEnabled: false,
  vehiclesEnabled: false,
  zonesEnabled: false,
  autoSurcharges: {
    night: { enabled: false, from: 22, to: 5, rate: 1.2 },
    weekend: { enabled: false, rate: 1.1 },
    winter: { enabled: false, from: '12-15', to: '03-15', rate: 1.1 },
  },
  wait: { enabled: false, freeMins: 5, ratePerMin: 100 },
};

describe('★料金表の 引っ越し（Firebase → Supabase）★', () => {
  it('★① Firebase を 1行も 呼んでいない★（司さん 2026-08-30「2度と使うな」）', () => {
    // ★注記の中の「Firebase」は 説明★（なぜ 引っ越したかを 書いてある）。
    //   ★2026-08-30 直し★: 前は 注記も 一緒に 数えていたので、
    //   「js/firebase.js の 既定は 10 だった」と 書いただけで 赤に なりました。
    //   ⇒★注記を 外してから 見ます（コードだけを 数える）★
    const zen = fs.readFileSync(P, 'utf8');
    const src = zen.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    ['firebase.', 'getDb(', 'db.ref(', 'firebaseio', 'firebasedatabase'].forEach((w) => {
      expect(src.includes(w), '★Firebase を 呼ぶ書き方が 入っています: ' + w + '★').toBe(false);
    });
    // ★注記を 外す作りが 効いている事も 見る（外し過ぎ／外し漏れの 見張り）★
    expect(src.includes('fetch('), '★注記を 外し過ぎて コードまで 消えています★').toBe(true);
  });

  // ★★2026-08-30: 指示役の指摘で 直しました★★
  //   前は 50m きざみの 787通りだけでした。数えたら
  //   ★段の 境目 91個のうち 19個しか 入っていませんでした★
  //   （50m きざみでは 420m の 段に ほとんど 当たりません）。
  //   ⇒★境目を 外した 787通りは、階段の 料金では 何も 保証しません★
  //   ⇒★段の 境目 ちょうど と その ±1m を 全部 入れます★
  it('★② 距離を 変えても 料金が 1円も 変わらない（★段の 境目を 全部 含む★）★', () => {
    const mae = HIKKOSHI_MOTO;
    const ato = S.totonoeru(null); // ★倉庫が 空の時に 使う 既定★

    const kyori = new Set();
    for (let m = 0; m <= 39300; m += 50) kyori.add(m); // 広く 浅く
    // ★段の 境目 ちょうど と ±1m★（1000m ／ 1420m ／ 1840m …）
    const kyokai = [];
    for (let m = 1000; m <= 39300; m += 420) kyokai.push(m);
    kyokai.forEach((m) => {
      [m - 1, m, m + 1].forEach((x) => {
        if (x >= 0) kyori.add(x);
      });
    });

    let chigau = 0;
    let mita = 0;
    kyori.forEach((m) => {
      M.setFareConfig(mae);
      const a = M.calcFare(m);
      M.setFareConfig(ato);
      const b = M.calcFare(m);
      mita++;
      if (a !== b) chigau++;
    });

    // ★何通り 見たか／境目を 何個 含むか を 数で 出す（0なら 何も 見ていない）★
    expect(mita, '★見た通り数が 少なすぎます★').toBeGreaterThan(1000);
    expect(kyokai.length, '★段の 境目が 数えられていません★').toBeGreaterThan(80);
    const fukumu = kyokai.filter((m) => kyori.has(m)).length;
    expect(fukumu, '★段の 境目を 全部 含んでいません★').toBe(kyokai.length);
    expect(chigau, '★料金が 変わった 距離が ' + chigau + ' 通り あります★').toBe(0);
  });

  it('★③ 在る値は 書き換えない（足りない所だけ 埋める）★', () => {
    const r = S.totonoeru({ base_fare: 1500, add_distance_m: 500 });
    expect(r.base_fare, '★入っていた値を 書き換えています★').toBe(1500);
    expect(r.add_distance_m).toBe(500);
    // 足りない所は 既定で 埋まる
    expect(r.base_distance_m).toBe(1000);
    expect(r.add_fare).toBe(100);
    expect(r.wait.enabled).toBe(false);
  });

  // ─────────────────────────
  // ★★2026-08-30 直し★★
  //   はじめ `window.DKSupabase` を 使う前提で 書いていましたが、
  //   ★この repo に DKSupabase は 存在しません★（supabase-js を 積んでいない）。
  //   ⇒ 試験も ★本物と 同じ つなぎ方（fetch）★で 測り直します。
  //   ★偽の fetch★ を 置いて「どこへ 何を 送ったか」を 実際に 数えます。
  // ─────────────────────────
  function niseSouko(opts) {
    opts = opts || {};
    const okutta = [];
    const ls = {};
    const win = {
      DKConfig: {
        fn: (n) => 'https://souko.example/functions/v1/' + n,
        rest: (q) => 'https://souko.example/rest/v1/' + q,
        headers: () => ({ apikey: 'anon' }),
      },
      localStorage: {
        getItem: (k) => (k in ls ? ls[k] : null),
        setItem: (k, v) => {
          ls[k] = String(v);
        },
        removeItem: (k) => {
          delete ls[k];
        },
      },
    };
    const nise = async (url, init) => {
      okutta.push({ url: String(url), init: init || {} });
      const h = opts.handler && opts.handler(String(url), init || {});
      if (h) return h;
      return { ok: true, status: 200, json: async () => [] };
    };
    return { okutta, ls, win, nise };
  }

  function yomikomu(t) {
    const beforeWin = global.window;
    const beforeLs = global.localStorage;
    const beforeFetch = global.fetch;
    global.window = t.win;
    global.localStorage = t.win.localStorage;
    global.fetch = t.nise;
    delete require.cache[require.resolve(P)];
    // eslint-disable-next-line global-require
    const S2 = require(P);
    return {
      S2,
      modosu() {
        global.window = beforeWin;
        global.localStorage = beforeLs;
        global.fetch = beforeFetch;
        delete require.cache[require.resolve(P)];
      },
    };
  }

  it('★④ 写しも 倉庫も 無い時に 空に しない（既定を 返す）★', () => {
    const t = niseSouko();
    const h = yomikomu(t);
    try {
      const r = h.S2.yomuOffline();
      expect(r.config.base_fare, '★空を 返しています★').toBe(1300);
      expect(r.moto).toBe('kitei');
      expect(t.okutta.length, '★写しを 読むだけなのに 通信しています★').toBe(0);
    } finally {
      h.modosu();
    }
  });

  it('★⑤ 変えた記録が 残り、戻せる★（前は 上書き1件だけで 戻せなかった）', async () => {
    const t = niseSouko({
      handler: (url) => {
        if (url.indexOf('dk_fare_config_history?select=before_config') >= 0)
          return {
            ok: true,
            status: 200,
            json: async () => [{ before_config: { base_fare: 1200 } }],
          };
        if (url.indexOf('dk_fare_config?select=') >= 0)
          return { ok: true, status: 200, json: async () => [] };
        return { ok: true, status: 201, json: async () => [] };
      },
    });
    const h = yomikomu(t);
    try {
      await h.S2.kaku({ access_token: 'jwt' }, 'c1', { base_fare: 1500 }, 'a@example.com');
      const kaita = t.okutta.filter((x) => (x.init.method || 'GET') === 'POST');
      const honntai = kaita.filter((x) => x.url.indexOf('/dk_fare_config?') >= 0);
      const kiroku = kaita.filter((x) => x.url.indexOf('/dk_fare_config_history') >= 0);
      expect(honntai.length, '★料金表を 保存していません★').toBe(1);
      expect(kiroku.length, '★変えた記録を 残していません★').toBe(1);
      const kr = JSON.parse(kiroku[0].init.body);
      expect(kr.after_config.base_fare).toBe(1500);
      expect(kr.changed_by).toBe('a@example.com');
      expect(kr.is_revert).toBe(false);
      expect(
        String(honntai[0].init.headers.Prefer || ''),
        '★上書きの 指定が ありません★'
      ).toContain('merge-duplicates');

      t.okutta.length = 0;
      await h.S2.modosu({ access_token: 'jwt' }, 'c1', 'b@example.com');
      const k2 = t.okutta
        .filter((x) => (x.init.method || 'GET') === 'POST')
        .filter((x) => x.url.indexOf('/dk_fare_config_history') >= 0);
      expect(k2.length, '★戻した事を 記録していません★').toBe(1);
      const r2 = JSON.parse(k2[0].init.body);
      expect(r2.is_revert, '★戻した印が 付いていません★').toBe(true);
      expect(r2.after_config.base_fare, '★1つ前に 戻っていません★').toBe(1200);
    } finally {
      h.modosu();
    }
  });

  it('★★⑦ 圏外でも 前の料金表が 出る（ダイコメは 完全オフライン前提）★★', async () => {
    const t = niseSouko({
      handler: (url) => {
        if (url.indexOf('dk-fare-config') >= 0)
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, config: { base_fare: 1500 }, updated_at: 'x' }),
          };
        return null;
      },
    });
    const h = yomikomu(t);
    try {
      t.ls['dk_license_company'] = 'tok';
      t.ls['DAIKOME_DEVICE_ID'] = 'dev';
      const r = await h.S2.torikomu();
      expect(r.ok, '★倉庫から 取れていません★').toBe(true);
      expect(r.config.base_fare).toBe(1500);
      global.fetch = async () => {
        throw new Error('offline');
      };
      const r2 = await h.S2.torikomu();
      expect(r2.ok, '★圏外なのに 取れたと 言っています★').toBe(false);
      expect(r2.reason).toBe('network');
      const off = h.S2.yomuOffline();
      expect(off.config.base_fare, '★圏外で 料金が 既定に 戻っています★').toBe(1500);
      expect(off.moto).toBe('utsushi');
    } finally {
      h.modosu();
    }
  });

  it('★⑧ 棚に まだ 無い時に 写しを 消さない（0円の料金表を でっち上げない）★', async () => {
    const t = niseSouko({
      handler: (url) => {
        if (url.indexOf('dk-fare-config') >= 0)
          return { ok: true, status: 200, json: async () => ({ ok: true, config: null }) };
        return null;
      },
    });
    const h = yomikomu(t);
    try {
      t.ls['dk_license_company'] = 'tok';
      t.ls['DAIKOME_DEVICE_ID'] = 'dev';
      t.ls['dk_fare_config_cache'] = JSON.stringify({ config: { base_fare: 1400 } });
      const r = await h.S2.torikomu();
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('no_row');
      expect(h.S2.yomuOffline().config.base_fare, '★写しを 消しました★').toBe(1400);
    } finally {
      h.modosu();
    }
  });

  it('★⑨ 料金表を 配る 関数が 端末を 確かめている（よそへ 渡さない）★', () => {
    const fn = path.join(ROOT, 'supabase', 'functions', 'dk-fare-config', 'index.ts');
    expect(fs.existsSync(fn), '★料金表を 配る 関数が ありません★').toBe(true);
    const src = fs.readFileSync(fn, 'utf8');
    expect(src, '★端末の 確認が ありません★').toContain('dk_company_devices');
    expect(src, '★会社の 引き方が 違います★').toContain('url_token');
    // ★書く道も ある★（メーターの 設定画面の 力を 落とさない）。だから
    //   ★端末を 確かめる所より 後で しか 書いていない★事を 見ます。
    const devPos = src.indexOf('dk_company_devices');
    const upPos = src.indexOf('.upsert(');
    expect(upPos, '★書く道が ありません★').toBeGreaterThan(0);
    expect(upPos, '★端末を 確かめる前に 書いています★').toBeGreaterThan(devPos);
    // ★変えた記録を 必ず 残す★
    expect(src, '★変えた記録を 残していません★').toContain('dk_fare_config_history');
    // ★失敗を 200 で 返さない★（画面が「保存しました」と 嘘を つく）
    expect(src, '★保存の 失敗を 返していません★').toContain('save_failed');
  });

  it('★⑩ この repo に 無い物(DKSupabase)を 呼んでいない★（2026-08-30 自分の間違い）', () => {
    const zen = fs.readFileSync(P, 'utf8');
    const nakami = zen.replace(/^\s*\/\/.*$/gm, '');
    expect(nakami.includes('DKSupabase'), '★存在しない 部品を 呼んでいます★').toBe(false);
    expect(zen, '★この repo の つなぎ方(fetch)で ありません★').toContain('fetch(');
  });

  it('★★⑪ 既定を 引っ越しで 変えていない（rounding は 10）★★', () => {
    // ★2026-08-30 実測★: 引っ越し前の 既定は ★どちらの道でも 10★ だった。
    //   js/meter.js の 内蔵 …………… rounding: 10
    //   js/firebase.js の 穴埋め …… out.rounding = 10
    //   ★1 に すると 端数を 丸めなくなる＝割増を 使う会社で 1円ずつ ずれる★
    const mSrc = fs.readFileSync(path.join(ROOT, 'js', 'meter.js'), 'utf8');
    const mae = /rounding:\s*(\d+)/.exec(mSrc);
    expect(mae, '★meter.js の 既定が 読めません★').toBeTruthy();
    expect(S.KITEI.rounding, '★引っ越しで 既定の 丸め方を 変えています（お金が ずれます）★').toBe(
      Number(mae[1])
    );
    expect(S.totonoeru({}).rounding).toBe(Number(mae[1]));
    // ★自分で 持っている値は 書き換えない★
    expect(S.totonoeru({ rounding: 1 }).rounding, '★持っている値を 上書きしました★').toBe(1);
  });

  it('★⑥ 棚の 作り方（SQL）も repo に 在る★（口約束に しない）', () => {
    const sql = path.join(ROOT, 'supabase', 'dk_fare_config.sql');
    expect(fs.existsSync(sql), '★棚を 作る SQL が ありません★').toBe(true);
    const s = fs.readFileSync(sql, 'utf8');
    expect(s).toContain('dk_fare_config');
    expect(s).toContain('dk_fare_config_history');
    expect(s, '★鍵(RLS)を 掛けていません★').toContain('row level security');
  });
});
