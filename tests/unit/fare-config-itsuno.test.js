'use strict';
// ============================================================
// ★★「いつの 料金表か」を 見せる★★ 2026-08-30（監査役の指摘で 追加）
//
//   ★どちらの物差しか★
//     ★距離では ありません★。★お金（料金表）が いつの物か★を 見ます。
//
//   ★なぜ 要るか（監査役 2026-08-30）★
//     ダイコメは ★完全オフライン前提★なので、取れた料金表を 端末に 焼いて
//     ★圏外でも 料金が 出る★ように しました。
//     ⇒★その代わり「★古い料金表のまま 走る★」事が 起きます★
//     ⇒★端末は「いつ 取ったか」を 知っているのに 見せていませんでした★
//       ＝★持っているのに 渡していない★
//     ⇒ ここで 見張ります。
//
//   ★ここで 見る事★
//     ①焼く時に「いつ 取ったか」も 一緒に 焼く
//     ②読んだ時に それを 返す
//     ③古さを 日で 数える（7日 以上で 印を 変える）
//     ④★取った日が 分からない物を「0日前」と 言わない★（分からない、と 言う）
//     ⑤画面に 出す 言葉は ★部品が 1つだけ 作る★（2つの画面で 食い違わせない）
//     ⑥画面に その 置き場が 在る
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const P = path.join(ROOT, 'js', 'fare-config-store.js');

function niseSouko(handler) {
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
  const nise = async (url) => {
    const h = handler && handler(String(url));
    if (h) return h;
    return { ok: true, status: 200, json: async () => [] };
  };
  return { ls, win, nise };
}

function yomikomu(t) {
  const b = { w: global.window, l: global.localStorage, f: global.fetch };
  global.window = t.win;
  global.localStorage = t.win.localStorage;
  global.fetch = t.nise;
  delete require.cache[require.resolve(P)];
  // eslint-disable-next-line global-require
  const S = require(P);
  return {
    S,
    modosu() {
      global.window = b.w;
      global.localStorage = b.l;
      global.fetch = b.f;
      delete require.cache[require.resolve(P)];
    },
  };
}

describe('★いつの 料金表かを 見せる★', () => {
  it('★① 取ったら「いつ 取ったか」も 一緒に 焼く★', async () => {
    const t = niseSouko((url) =>
      url.indexOf('dk-fare-config') >= 0
        ? {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, config: { base_fare: 1500 }, updated_at: 'x' }),
          }
        : null
    );
    const h = yomikomu(t);
    try {
      t.ls['dk_license_company'] = 'tok';
      t.ls['DAIKOME_DEVICE_ID'] = 'dev';
      await h.S.torikomu();
      const yaita = JSON.parse(t.ls['dk_fare_config_cache']);
      expect(yaita.totta_at, '★いつ 取ったかを 焼いていません★').toBeTruthy();
      expect(Number.isFinite(Date.parse(yaita.totta_at)), '★日付として 読めません★').toBe(true);
      // ★updated_at（会社が 変えた日）と 別の物として 持つ★
      expect(yaita.updated_at, '★会社が 変えた日を 落としています★').toBe('x');
    } finally {
      h.modosu();
    }
  });

  it('★② 読んだ時に 返す（画面が 使える形で）★', () => {
    const t = niseSouko();
    const h = yomikomu(t);
    try {
      t.ls['dk_fare_config_cache'] = JSON.stringify({
        config: { base_fare: 1400 },
        totta_at: new Date().toISOString(),
      });
      const v = h.S.yomuOffline();
      expect(v.totta_at, '★いつ 取ったかを 返していません★').toBeTruthy();
      expect(v.furusa.wakaru).toBe(true);
      expect(v.furusa.nichi).toBe(0);
      expect(v.furusa.furui).toBe(false);
      expect(String(v.fuda), '★画面に 出す 言葉が ありません★').toContain('料金表：');
    } finally {
      h.modosu();
    }
  });

  it('★③ 7日 以上は 古いと 言う（境目の 両側で 測る）★', () => {
    const t = niseSouko();
    const h = yomikomu(t);
    try {
      const ima = Date.parse('2026-08-30T00:00:00Z');
      const hi = (n) => new Date(ima - n * 86400000).toISOString();
      expect(h.S.FURUI_NICHI, '★線が 動いています★').toBe(7);
      expect(h.S.furusa(hi(6), ima).furui, '★6日で 古いと 言っています★').toBe(false);
      expect(h.S.furusa(hi(7), ima).furui, '★7日ちょうどで 古いと 言っていません★').toBe(true);
      expect(h.S.furusa(hi(8), ima).furui).toBe(true);
      expect(h.S.furusa(hi(30), ima).nichi).toBe(30);
    } finally {
      h.modosu();
    }
  });

  it('★★④ 分からない物を「0日前」と 言わない★★', () => {
    const t = niseSouko();
    const h = yomikomu(t);
    try {
      [null, undefined, '', 'あした', '2026-99-99'].forEach((x) => {
        const f = h.S.furusa(x);
        expect(f.wakaru, '★分からないのに 分かると 言っています: ' + x + '★').toBe(false);
        expect(f.nichi, '★分からないのに 日数を 出しています: ' + x + '★').toBe(null);
        expect(f.furui).toBe(false);
      });
      // ★写しが 無い時も「0日前」に しない★
      const v = h.S.yomuOffline();
      expect(v.totta_at).toBe(null);
      expect(String(v.fuda)).not.toContain('0日前');
    } finally {
      h.modosu();
    }
  });

  it('★⑤ 言葉は 部品が 1つだけ 作る（画面で 組み立て直さない）★', () => {
    const t = niseSouko();
    const h = yomikomu(t);
    try {
      const ima = Date.now();
      const atarashii = h.S.fudaMoji({ totta_at: new Date(ima).toISOString() });
      const furui = h.S.fudaMoji({ totta_at: new Date(ima - 10 * 86400000).toISOString() });
      const nashi = h.S.fudaMoji(null);
      expect(atarashii).toContain('取得');
      expect(atarashii).not.toContain('⚠');
      expect(furui, '★古いのに 印が 付いていません★').toContain('⚠');
      expect(furui, '★何日前かを 出していません★').toContain('10日前');
      expect(nashi, '★分からない事を 言っていません★').toContain('分かりません');
      // ★画面側で 日付を 組み立て直していない事★
      const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
      const naka = html.slice(
        html.indexOf('function itsunoFuda'),
        html.indexOf('function itsunoFuda') + 900
      );
      expect(/getMonth\(\)/.test(naka), '★画面が 日付を 自分で 組み立てています★').toBe(false);
    } finally {
      h.modosu();
    }
  });

  it('★⑥ 画面に 置き場が 在る（部品だけ 作って 見せ忘れない）★', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    expect(html.includes('id="_fare_itsuno"'), '★出す所が ありません★').toBe(true);
    expect(html.includes('itsunoFuda('), '★出す所を 埋めていません★').toBe(true);
    // ★flex/grid の 箱で 潰さない★（前に 潰した事が ある）
    //   ★2026-09-01 直し★… 前は ★その場に 書いた 見た目（style="…")★だけを 見ていました。
    //   司さん「この赤丸いらんことない？」で ★箱を 札の 中へ 移し、見た目は class に★ したら
    //   ★中身は 直っているのに 赤★に なりました。⇒ ★どちらでも 通る★形に 直します。
    const i = html.indexOf('id="_fare_itsuno"');
    const box = html.slice(i, i + 500);
    const clsName = (box.match(/class="([^"]*)"/) || [])[1] || '';
    const cls = clsName
      ? html.slice(
          html.indexOf('.' + clsName.split(' ')[0] + ' {'),
          html.indexOf('.' + clsName.split(' ')[0] + ' {') + 400
        )
      : '';
    expect(
      /white-space:\s*normal/.test(box) || /white-space:\s*normal/.test(cls),
      '★折り返しの 指定が ありません★'
    ).toBe(true);
  });

  // ============================================================
  // ★★最後に 変えたのは 誰・いつ★★ 2026-08-30（監査役の指摘で 追加）
  //   ★記録は 前から 持っていたのに ★誰も 見ていませんでした★★
  //   ⇒★持っているのに 渡していない★
  //   ★名前が 出れば 変えにくくなります★（勝手に 変えても 分からない、が 終わる）
  // ============================================================
  it('★⑦ 誰が 変えたかを 焼いて 返す★', async () => {
    const t = niseSouko((url) =>
      url.indexOf('dk-fare-config') >= 0
        ? {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              config: { base_fare: 1500 },
              updated_at: '2026-08-30T05:20:00Z',
              updated_by: 'device:abcd1234efgh',
            }),
          }
        : null
    );
    const h = yomikomu(t);
    try {
      t.ls['dk_license_company'] = 'tok';
      t.ls['DAIKOME_DEVICE_ID'] = 'zzzz';
      await h.S.torikomu();
      const yaita = JSON.parse(t.ls['dk_fare_config_cache']);
      expect(yaita.updated_by, '★誰が 変えたかを 焼いていません★').toBe('device:abcd1234efgh');
      const v = h.S.yomuOffline();
      expect(v.updated_by, '★誰が 変えたかを 返していません★').toBe('device:abcd1234efgh');
      expect(String(v.fudaKaeta), '★画面に 出す 言葉が ありません★').toContain('最後に変えた人');
    } finally {
      h.modosu();
    }
  });

  it('★⑧ 端末IDを そのまま 出さない（自分／他を 分ける）★', () => {
    const t = niseSouko();
    const h = yomikomu(t);
    try {
      const jibun = h.S.fudaKaeta(
        { updated_by: 'device:abcd1234efgh', updated_at: '2026-08-30T05:20:00Z' },
        'abcd1234efgh'
      );
      const hoka = h.S.fudaKaeta(
        { updated_by: 'device:abcd1234efgh', updated_at: '2026-08-30T05:20:00Z' },
        'zzzz'
      );
      expect(jibun, '★自分の端末だと 言っていません★').toContain('この端末');
      expect(hoka, '★他の端末だと 言っていません★').toContain('別の端末');
      expect(hoka, '★端末IDを そのまま 出しています★').not.toContain('abcd1234efgh');
      expect(hoka, '★末尾4文字を 出していません★').toContain('efgh');
      // ★事務所（メール）は そのまま 出す★
      const mail = h.S.fudaKaeta(
        { updated_by: 'a@example.com', updated_at: '2026-08-30T05:20:00Z' },
        'zzzz'
      );
      expect(mail).toContain('a@example.com');
    } finally {
      h.modosu();
    }
  });

  it('★★⑨ 分からない物を 空欄に しない（誰・いつ の 両方）★★', () => {
    const t = niseSouko();
    const h = yomikomu(t);
    try {
      expect(h.S.fudaKaeta(null)).toBe('最後に変えた人：分かりません');
      expect(h.S.fudaKaeta({})).toBe('最後に変えた人：分かりません');
      expect(h.S.fudaKaeta({ updated_by: '' })).toBe('最後に変えた人：分かりません');
      expect(h.S.fudaKaeta({ updated_by: 'device:' })).toBe('最後に変えた人：分かりません');
      // ★人だけ 分からない／日だけ 分からない★
      expect(h.S.fudaKaeta({ updated_at: '2026-08-30T05:20:00Z' })).toContain('分かりません');
      expect(h.S.fudaKaeta({ updated_by: 'a@example.com' })).toContain('いつかは分かりません');
      // ★写しが 無い時も 空欄に しない★
      expect(String(h.S.yomuOffline().fudaKaeta)).toContain('最後に変えた人');
    } finally {
      h.modosu();
    }
  });

  // ★★2026-09-01 に 決まりが 変わりました★★
  //   司さん「この赤丸いらんことない？」
  //   ・料金は ★事務所からだけ★ 変える形に なった（メーターからは 変えられない）
  //   ⇒ メーターに「最後に 変えた人」を 出しても ★運転手には 要らない 字★
  //   ⇒ ★メーターでは 出さない／事務所の「料金表」に 出す★ に 変えました。
  //   ★部品（fudaKaeta）は 消していません★＝事務所が 使っています。
  it('★⑩ メーターでは「誰が 変えたか」を 出さない（事務所に 出す）★', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const i = html.indexOf('function itsunoFuda');
    const naka = html.slice(i, i + 1400);
    expect(naka.includes('fudaKaeta'), '★メーターに「誰が 変えたか」を 出しています★').toBe(false);
    // ★事務所には 出ている★（消えていない事）
    const jimusho = fs.readFileSync(path.join(ROOT, 'ryokinhyou.html'), 'utf8');
    expect(jimusho.includes('fudaKaeta'), '★事務所からも 消えています★').toBe(true);
    // ★同じ箱に 入っている★（2つで 1組・離さない）
    expect(naka.includes("$('_fare_itsuno')"), '★同じ箱に 出していません★').toBe(true);
    // ★画面で 日付を 組み立て直していない★
    expect(/getMonth\(\)/.test(naka), '★画面が 日付を 自分で 組み立てています★').toBe(false);
    expect(/getHours\(\)/.test(naka), '★画面が 時刻を 自分で 組み立てています★').toBe(false);
  });
});
