'use strict';
// ============================================================
// ★★「車の 距離計が 読めるか」を 見る部品の 見張り★★ 2026-08-30
//
//   ★どちらの物差しか★
//     ★距離の採点では ありません★。★距離にも 料金にも 1文字も 触りません★。
//     タクシー認定モードでも 代行モード（係数1.0085・検定対象外・DM Light基準）でも
//     ★同じ物を 出すだけ★です。
//
//   ★なぜ 要るか★
//     点が 来ない間を 今は ★位置の 直線★で 埋めています。
//     ★車が 自分で 積んでいる 距離が 読めるなら それが 一番 確か★ですが、
//     ★車種で 読めたり 読めなかったり します★（手元の走行は 1,087点 全部 −1＝未対応）。
//     ⇒★司さんの 車で 読めるかを 1分で 見る★為の 部品。
//
//   ★ここで 見る事★
//     ①★4通り 全部★（つながっていない／まだ調べていない／対応していない／読めた）
//     ②★色だけで 判らせない★＝どの場合も ★字★が 入っている
//     ③★読めない時は「次に 何を すれば よいか」まで 書いてある★
//     ④★車には 何も 送らない★（読むだけ＝コードに 送る所が 無い）
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const P = path.join(ROOT, 'js', 'kuruma-kyorikei.js');

function yomikomu(win) {
  delete require.cache[require.resolve(P)];
  const before = global.window;
  global.window = win;
  try {
    // eslint-disable-next-line global-require
    return require(P);
  } finally {
    global.window = before;
  }
}

describe('★車の 距離計が 読めるかを 見る部品★', () => {
  it('★① つながっていない時★', () => {
    const K = yomikomu({});
    const r = K.shirabe();
    expect(r.wakatta).toBe(false);
    expect(r.riyuu.midashi).toBe('OBDに つながっていません');
    expect(r.riyuu.tsugi.length, '★次に 何を すれば よいかが 空です★').toBeGreaterThan(5);
    expect(K.moji()).toContain('つながっていません');
  });

  it('★② つないだが まだ 調べていない時★', () => {
    const K = yomikomu({ OBDClient: { isConnected: () => true } });
    const r = K.shirabe();
    expect(r.wakatta).toBe(false);
    expect(r.riyuu.midashi).toBe('まだ 調べていません');
    expect(r.riyuu.tsugi).toContain('待って');
  });

  it('★③ 調べたが この車は 対応していない時★', () => {
    const K = yomikomu({
      OBDClient: { isConnected: () => true },
      OBD_PROBE_RESULT: {
        ts: 1,
        decoded: { odometer_supported: false, dist_since_clear_supported: false },
      },
    });
    const r = K.shirabe();
    expect(r.wakatta, '★調べ終わっている★').toBe(true);
    expect(r.dochiraka, '★どちらも 読めていない★').toBe(false);
    expect(r.riyuu.midashi).toBe('この車は 対応していません');
    expect(r.riyuu.tsugi, '★次に 何を すれば よいか★').toContain('別の車');
    // ★色だけで 判らせない★
    expect(r.kyorikei.moji).toBe('読めません');
    expect(r.ecu.moji).toBe('読めません');
  });

  it('★④ 読めた時（値まで 出る）★', () => {
    const K = yomikomu({
      OBDClient: { isConnected: () => true },
      OBD_PROBE_RESULT: {
        ts: 1,
        decoded: {
          odometer_supported: true,
          odometer_km: 123456.7,
          dist_since_clear_supported: true,
          dist_since_clear_km: 890,
        },
      },
    });
    const r = K.shirabe();
    expect(r.dochiraka).toBe(true);
    expect(r.riyuu, '★読めたのに 理由を 出しています★').toBe(null);
    expect(r.kyorikei.moji).toBe('読めました');
    expect(r.kyorikei.ataiMoji).toBe('123456.7 km');
    expect(r.ecu.ataiMoji).toBe('890.0 km');
    expect(K.moji()).toContain('123456.7 km');
  });

  it('★片方だけ 読めた時も 正しく 出る★（軽/古い車は 0131 だけ 出る事が 多い）', () => {
    const K = yomikomu({
      OBDClient: { isConnected: () => true },
      OBD_PROBE_RESULT: {
        ts: 1,
        decoded: {
          odometer_supported: false,
          dist_since_clear_supported: true,
          dist_since_clear_km: 890,
        },
      },
    });
    const r = K.shirabe();
    expect(r.dochiraka, '★片方 読めたら 使えます★').toBe(true);
    expect(r.riyuu).toBe(null);
    expect(r.kyorikei.moji).toBe('読めません');
    expect(r.ecu.moji).toBe('読めました');
  });

  it('★どの場合も 字が 入っている（色だけで 判らせない）★', () => {
    [{}, { OBDClient: { isConnected: () => true } }].forEach((w) => {
      const K = yomikomu(w);
      const m = K.moji();
      expect(m.length, '★字が 空です★').toBeGreaterThan(20);
      expect(m).toContain('■');
    });
  });

  it('★車には 何も 送らない（読むだけ）★', () => {
    const src = fs.readFileSync(P, 'utf8');
    ['_send(', 'write(', 'sendCommand', 'ATZ', '01A6'].forEach((w) => {
      // ★注記の中の 01A6 は 説明。★命令を 送る書き方が 無い事★を 見る
      if (w === '01A6') return;
      expect(src.includes(w), '★車へ 送る書き方が 入っています: ' + w + '★').toBe(false);
    });
  });

  it('★alert を 使っていない★（画面が 固まるので うちでは 禁止）', () => {
    const src = fs.readFileSync(P, 'utf8');
    expect(/\balert\s*\(/.test(src), '★alert は 使えません★').toBe(false);
  });
});
