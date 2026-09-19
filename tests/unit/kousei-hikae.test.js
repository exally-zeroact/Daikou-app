'use strict';
// ============================================================
// ★★較正の 控え＝「今のが 壊れない」を 機械で 縛る★★ 2026-09-19（司さん）
//
//   ★司さん★「車ごとに出さな何のために較正しよんど」
//             「★今のが壊れんようにきっちりやれや★」
//
//   ★この試験が 守る 物（順に 大事）★
//     ①★手元に 1台でも 在れば 何も しない★
//        ＝今 動いている 端末（司さんの 4台）は ★1バイトも 変わらない★
//     ②★預かった 物を そのまま 返す★
//        tireRatio と k は ★距離に 掛け算される★（js/meter.js 127-129）。
//        丸めたり 作り直したら ★距離と 料金が 動く★。
//     ③★空を 預けない★＝消えた 直後に 空で 上書きして 控えを 殺さない
//     ④★失敗しても 何も 起きない★＝圏外でも 業務を 止めない
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-19 実測 ＝ 下に 書く）★★
//     ①modoshiteYoika の 中身を true 固定に する … ★赤★（①が 落ちる）
//     ②戻す時に 数を 丸める（Math.round）…………… ★赤★（②が 落ちる）
//     ③空でも 預けるように する ……………………… ★赤★（③が 落ちる）
// ============================================================

const VB = require('../../js/veh-backup.js');

// ★実物と 同じ 形の 較正★（司さんの 車の 中身に 合わせた）
const KURUMA = [
  {
    id: 'v1',
    vin: 'JF1AAA000A0000001',
    name: '1466',
    tire: '195/65R15',
    tireCurrent: '205/60R16',
    tireRatio: 1.0123456789, // ★距離に 掛かる★
    k: 0.98765432, // ★距離に 掛かる★
    k_samples: 42,
    calibKs: [0.987, 0.989, 0.985],
  },
];

function tsukuruStore(hajime) {
  const mem = {};
  if (hajime !== undefined) mem[VB.LIST_KEY] = JSON.stringify(hajime);
  return {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => {
      mem[k] = String(v);
    },
    removeItem: (k) => {
      delete mem[k];
    },
    _naka: () => mem,
  };
}

describe('★★①手元に 1台でも 在れば 何も しない（今のを 壊さない）★★', () => {
  it('★1台 在る ⇒ 戻してよい＝いいえ★', () => {
    expect(VB.modoshiteYoika(tsukuruStore(KURUMA))).toBe(false);
  });

  it('★空っぽ ⇒ 戻してよい＝はい★', () => {
    expect(VB.modoshiteYoika(tsukuruStore([]))).toBe(true);
    expect(VB.modoshiteYoika(tsukuruStore())).toBe(true); // 鍵が 無い
  });

  it('★★手元が 在る 時に 戻そうと しても 1バイトも 変えない★★', async () => {
    const store = tsukuruStore(KURUMA);
    const mae = store.getItem(VB.LIST_KEY);
    let tataita = 0;
    global.fetch = () => {
      tataita++;
      return Promise.resolve({ ok: true, json: () => Promise.resolve([{ cars: [] }]) });
    };
    global.DKConfig = { SB_URL: 'https://x.supabase.co', ANON_KEY: 'k' };
    const r = await VB.modosu('co1', 'dev1', store);
    expect(r.ok, '★手元が 在るのに 戻しています★').toBe(false);
    expect(r.why).toBe('temoto_ari');
    expect(store.getItem(VB.LIST_KEY), '★手元の 中身が 変わりました★').toBe(mae);
    expect(tataita, '★手元が 在るなら 倉庫を 叩く 必要も 無い★').toBe(0);
  });

  it('★壊れた 中身でも「在る」と 数えない（安全側）★', () => {
    const store = tsukuruStore();
    store.setItem(VB.LIST_KEY, '{壊れた');
    expect(VB.modoshiteYoika(store)).toBe(true);
  });
});

describe('★★②預かった 物を そのまま 返す（距離が 動かない）★★', () => {
  it('★tireRatio と k が 1桁も 変わらない★', async () => {
    const store = tsukuruStore([]);
    global.DKConfig = { SB_URL: 'https://x.supabase.co', ANON_KEY: 'k' };
    global.fetch = () =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([{ cars: KURUMA }]) });
    const r = await VB.modosu('co1', 'dev1', store);
    expect(r.ok).toBe(true);
    const modotta = JSON.parse(store.getItem(VB.LIST_KEY));
    expect(modotta[0].tireRatio, '★tireRatio が 変わりました＝距離が 動きます★').toBe(1.0123456789);
    expect(modotta[0].k, '★k が 変わりました＝距離が 動きます★').toBe(0.98765432);
    expect(modotta[0].calibKs, '★1km学習の 中身が 変わりました★').toEqual([0.987, 0.989, 0.985]);
    // ★丸ごと 同じ★（字で 比べる＝1文字でも 違えば 落ちる）
    expect(JSON.stringify(modotta), '★預かった 物と 違う 物を 書きました★').toBe(
      JSON.stringify(KURUMA)
    );
  });

  it('★控えが 無い／空なら 何も しない★', async () => {
    const store = tsukuruStore([]);
    global.DKConfig = { SB_URL: 'https://x.supabase.co', ANON_KEY: 'k' };
    global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    const r = await VB.modosu('co1', 'dev1', store);
    expect(r.ok).toBe(false);
    expect(r.why).toBe('hikae_nashi');
    expect(store.getItem(VB.LIST_KEY)).toBe('[]');
  });
});

describe('★★③空を 預けない（控えを 殺さない）★★', () => {
  it('★手元が 空なら 預けない★', async () => {
    global.DKConfig = { SB_URL: 'https://x.supabase.co', ANON_KEY: 'k' };
    let tataita = 0;
    global.fetch = () => {
      tataita++;
      return Promise.resolve({ ok: true });
    };
    const r = await VB.azukeru('co1', 'dev1', tsukuruStore([]));
    expect(r.ok, '★空を 預けています★＝消えた 直後に 控えを 上書きして 殺します').toBe(false);
    expect(r.why).toBe('kara');
    expect(tataita).toBe(0);
  });

  it('★1台 在れば 預ける★', async () => {
    global.DKConfig = { SB_URL: 'https://x.supabase.co', ANON_KEY: 'k' };
    let okutta = null;
    global.fetch = (u, o) => {
      okutta = JSON.parse(o.body);
      return Promise.resolve({ ok: true });
    };
    const r = await VB.azukeru('co1', 'dev1', tsukuruStore(KURUMA));
    expect(r.ok).toBe(true);
    expect(okutta.device_id, '★席の 番号で 預けていません★').toBe('dev1');
    expect(JSON.stringify(okutta.cars), '★そのまま 送っていません★').toBe(JSON.stringify(KURUMA));
  });
});

describe('★★④失敗しても 何も 起きない（業務を 止めない）★★', () => {
  it('★圏外＝倒れずに false を 返す★', async () => {
    global.DKConfig = { SB_URL: 'https://x.supabase.co', ANON_KEY: 'k' };
    global.fetch = () => Promise.reject(new Error('offline'));
    const store = tsukuruStore([]);
    const a = await VB.modosu('co1', 'dev1', store);
    const b = await VB.azukeru('co1', 'dev1', tsukuruStore(KURUMA));
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    expect(store.getItem(VB.LIST_KEY), '★圏外なのに 手元を 触りました★').toBe('[]');
  });

  it('★倉庫の 設定が 無くても 倒れない★', async () => {
    global.DKConfig = null;
    const r = await VB.modosu('co1', 'dev1', tsukuruStore([]));
    expect(r.ok).toBe(false);
    expect(r.why).toBe('no_cfg');
  });
});

// ============================================================
// ★★⑤メーターへの 繋ぎ方★★（2026-09-19 ここを 1回 間違えた）
//   ★私の 間違い★ getState() が company_id を 返すと 思い込んで 書いた。
//     実物は {state, allowed, daysLeft, message} ＝ ★company_id は 無い★。
//     company_id は ★券の 中身（_verifiedPayload）★ に 在った。
//   ⇒ ★呼ぶ前に 実物を 読む★。ここを 機械で 縛る。
// ============================================================
const fs2 = require('fs');
const path2 = require('path');
const R2 = path2.join(__dirname, '..', '..');
const y2 = (p) => fs2.readFileSync(path2.join(R2, p), 'utf8').replace(/\r\n/g, '\n');
const IDX = y2('index.html');
const LA2 = require('../../js/license-activate.js');
const SW2 = y2('sw.js');

describe('★⑤メーターへの 繋ぎ方★', () => {
  it('★companyId() が 在る（getState には 無い）★', () => {
    expect(typeof LA2.companyId, '★companyId の 口が 在りません★').toBe('function');
    const st = LA2.getState();
    expect(
      'company_id' in st,
      '★getState が company_id を 持つように 変わりました★＝呼び方を 見直してください'
    ).toBe(false);
  });

  it('★★getState から company_id を 取る 書き方に 戻っていない★★', () => {
    expect(
      /getState\(\)\s*\|\|\s*\{\}[\s\S]{0,120}company_id/.test(IDX),
      '★getState().company_id を 読んでいます★＝★いつも undefined＝控えが 一生 効きません★'
    ).toBe(false);
  });

  it('★預ける／戻す の 両方を 繋いでいる★', () => {
    expect(/VehBackup\.modosu\(/.test(IDX), '★戻す を 繋いでいません★').toBe(true);
    expect(/VehBackup\.azukeru\(/.test(IDX), '★預ける を 繋いでいません★').toBe(true);
  });

  it('★★新しい js を 先取り名簿（sw.js）に 足した★★', () => {
    // 忘れると「オンラインだけ 動く」偽の 緑に なり 版が 上がった 日に 現場が 止まる
    expect(
      SW2.indexOf("'/js/veh-backup.js'") > 0,
      '★sw.js の 先取り名簿に 足していません★＝オフラインで 落ちます'
    ).toBe(true);
    expect(IDX.indexOf('js/veh-backup.js') > 0, '★メーターが 読み込んでいません★').toBe(true);
  });
});
