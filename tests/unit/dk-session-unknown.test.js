'use strict';
// ============================================================
// ★「取れなかった」を 0 や 空 として出さない★ 2026-08-09
//
//   ★なぜ★
//     司さんの申告「台数が使いよんのに0になっとる」を追う中で、
//     ★通信が失敗しても 空配列にして、画面には 0 と書く★ 形が 21箇所あった。
//       dashboard.html  3箇所（うち loadDevices が 使用台数 0 の元）
//       kyuryo.html     9箇所（元は soft() 1箇所）
//       shukei.html     9箇所（同上）
//     ＝ ★「本当に0台」と「取れなかった」が 画面で見分けられない★。
//     今回の 0/4 は別会社を見ていたためで これとは別だったが、
//     ★同じ事故を起こす形が実在した★ので塞ぐ。
//
//   ★直す形★
//     ・取れなかったことを ★数える★（黙って捨てない）
//     ・画面には ★0 でも 空 でもなく「—」★ を出し、★「もう一度読む」★ を添える
//     ・★本当に0 と 取れなかった が 必ず違って見える★
// ============================================================
const DK = require('../../js/dk-session.js');

function fakeSess() {
  const payload = Buffer.from(JSON.stringify({ sub: 'u1' }), 'utf8').toString('base64url');
  return { access_token: 'x.' + payload + '.y' };
}

describe('★取れなかったことを 数える★', () => {
  it('取れた時は 中身を返し、失敗の数は増えない', async () => {
    const st = DK.newLoadState();
    const orig = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve([1, 2]) });
    try {
      const r = await DK.softList(fakeSess(), 'dk_x?select=*', st);
      expect(r).toEqual([1, 2]);
      expect(st.failed, '取れているのに失敗に数えた').toBe(0);
      expect(DK.loadFailed(st)).toBe(false);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('★サーバが断った時は 空を返しても「失敗」を数える★', async () => {
    const st = DK.newLoadState();
    const orig = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve({ ok: false, status: 500 });
    try {
      const r = await DK.softList(fakeSess(), 'dk_x?select=*', st);
      expect(r, '落ちないよう空は返す').toEqual([]);
      expect(st.failed, '★黙って空にした＝0と区別できない★').toBe(1);
      expect(DK.loadFailed(st)).toBe(true);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('★通信ごと落ちた時も 数える★', async () => {
    const st = DK.newLoadState();
    const orig = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error('圏外'));
    try {
      const r = await DK.softList(fakeSess(), 'dk_x?select=*', st);
      expect(r).toEqual([]);
      expect(st.failed).toBe(1);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('何本失敗したかを足していく（1本でも失敗なら 数字は信じない）', async () => {
    const st = DK.newLoadState();
    const orig = globalThis.fetch;
    let n = 0;
    globalThis.fetch = () => {
      n++;
      return n === 2
        ? Promise.resolve({ ok: false, status: 503 })
        : Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    };
    try {
      await Promise.all([
        DK.softList(fakeSess(), 'a', st),
        DK.softList(fakeSess(), 'b', st),
        DK.softList(fakeSess(), 'c', st),
      ]);
      expect(st.failed).toBe(1);
      expect(DK.loadFailed(st), '★1本でも失敗したら 数字は信じない★').toBe(true);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe('★画面に出す形（0 と 取れなかった を分ける）★', () => {
  it('取れなかった時に出す文字は ★0 でも 空 でもなく「—」★', () => {
    expect(DK.UNKNOWN_TEXT).toBe('—');
    expect(DK.UNKNOWN_TEXT).not.toBe('0');
    expect(DK.UNKNOWN_TEXT).not.toBe('');
  });

  it('数字を出す時、取れていれば その数字／取れていなければ「—」', () => {
    expect(DK.numOrUnknown(3, { failed: 0 })).toBe('3');
    expect(DK.numOrUnknown(0, { failed: 0 }), '★本当に0は 0と出す★').toBe('0');
    expect(DK.numOrUnknown(0, { failed: 1 }), '★取れなかったのに 0 と出した★').toBe('—');
    expect(DK.numOrUnknown(3, { failed: 1 }), '★取れていないのに数字を出した★').toBe('—');
  });
});
