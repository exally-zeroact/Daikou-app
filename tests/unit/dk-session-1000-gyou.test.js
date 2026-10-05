// ============================================================
// ★★倉庫は 1回 1000行 まで＝それより 多く 頼んだら 1000行 ずつ 全部 読む★★ 2026-10-06
//
//   司さん「気にかけてどうするんど解決策は」
//   PostgREST は limit=2000／5000 と 頼んでも ★黙って 1000行で 切る★（max-rows）。
//   実費の 行（dk_shift_edits）は 日付で 絞らずに 全部 読む＝年ごとに 増え、いつか 給料・売上が 黙って 減る。
//   ⇒ DKSession.softList が 1000行 より 多く 頼まれたら ★表の 鍵の 順★で 1000行 ずつ 全部 読む。
//
//   わざと壊す（10-06 実測）：softList の「1000行 より 多ければ 全部 読む」を 外す ⇒ ★赤★（1000行で 切れる）
// ============================================================
const DK = require('../../js/dk-session.js');

function fakeSess() {
  const payload = Buffer.from(JSON.stringify({ sub: 'u1' }), 'utf8').toString('base64url');
  return { access_token: 'x.' + payload + '.y' };
}

// ★本物の 倉庫と 同じく 1回 1000行で 切る★ 作り物（limit と offset を 読む）
function kura(n) {
  const rows = Array.from({ length: n }, (_, i) => ({
    shift_id: 's' + String(i).padStart(5, '0'),
  }));
  const kiita = [];
  const fetch = (url) => {
    const u = new URL(url);
    kiita.push(u.search);
    const lim = Math.min(Number(u.searchParams.get('limit') || 1000), 1000);
    const off = Number(u.searchParams.get('offset') || 0);
    return Promise.resolve({ ok: true, json: () => Promise.resolve(rows.slice(off, off + lim)) });
  };
  return { fetch, kiita };
}

async function yomu(n, path) {
  const k = kura(n);
  const orig = globalThis.fetch;
  globalThis.fetch = k.fetch;
  try {
    const st = DK.newLoadState();
    const r = await DK.softList(fakeSess(), path, st);
    return { r, st, kiita: k.kiita };
  } finally {
    globalThis.fetch = orig;
  }
}

describe('★1000行 より 多い 表も 全部 読む★', () => {
  it('2,500行 を limit=5000 で 頼むと 2,500行 全部 返る（前は 1,000行で 切れた）', async () => {
    const { r, st, kiita } = await yomu(2500, 'dk_shift_edits?select=*&limit=5000');
    expect(r.length, '★1000行で 切れている★').toBe(2500);
    expect(new Set(r.map((x) => x.shift_id)).size, '★同じ 行を 2回 読んだ★').toBe(2500);
    expect(kiita.length, '★3回に 分けて 読んでいない★').toBe(3);
    expect(st.failed).toBe(0);
    // ★順番は 表の 鍵★（同じ 行を 2回／読み落とし を 出さない）
    kiita.forEach((q) => expect(decodeURIComponent(q)).toContain('order=shift_id.asc'));
  });

  it('頼んだ 数（2000）を 越えても 切らない（その 数も いつか 越える）', async () => {
    const { r } = await yomu(3200, 'dk_manual_days?select=*&work_date=gte.2026-01-01&limit=2000');
    expect(r.length).toBe(3200);
  });

  it('絞り（work_date など）は そのまま 残る・order は 鍵の 順に 置き換わる', async () => {
    const { kiita } = await yomu(
      10,
      'dk_shifts?select=shift_id&started_at=gte.2026-01-01&order=started_at.asc&limit=5000'
    );
    const q = decodeURIComponent(kiita[0]);
    expect(q).toContain('started_at=gte.2026-01-01');
    expect(q).toContain('order=started_at.asc,shift_id.asc');
    expect(q.match(/order=/g).length, '★order が 2つ 付いた★').toBe(1);
    expect(q.match(/limit=/g).length, '★limit が 2つ 付いた★').toBe(1);
  });

  it('1000行 以下の 頼みは 今まで通り 1回だけ', async () => {
    const { r, kiita } = await yomu(50, 'dk_device_labels?select=*&limit=500');
    expect(r.length).toBe(50);
    expect(kiita.length).toBe(1);
    expect(decodeURIComponent(kiita[0])).not.toContain('offset=');
  });
});
