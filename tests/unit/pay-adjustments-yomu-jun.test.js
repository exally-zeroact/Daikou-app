// ============================================================
// ★★手当・控除（dk_pay_adjustments）の 読みの 順は 一意★★ 2026-10-23 件G
//
//   1000行 ずつ 読む 時（js/dk-session.js zenbuYomu）は 表の 鍵の 順で 継ぎ目を 決める。
//   前は 鍵の 順に 無く、頼みの order（work_date.asc,created_at.asc ／ 無し）の まま
//   ＝同じ 日・同じ 時刻の 行が 1000行目を 跨ぐと 二重・抜けが 出得た（給料の 額が 黙って 変わる）。
//   ⇒ KAGI_JUN に dk_pay_adjustments: 'work_date.asc,adj_id.asc'。給料タブ（明細・給料表）と 月次集計の 読みに 通す。
//
//   ★わざと壊して 赤（2026-10-23 実測）★ 直す 前の 版（KAGI_JUN と 3か所の order が 無い）⇒ ★赤 3 / 3★・直した 後 ⇒ 緑 3 / 3
// ============================================================
const fs = require('fs');
const path = require('path');
const DK = require('../../js/dk-session.js');

const yomu = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');

function fakeSess() {
  const payload = Buffer.from(JSON.stringify({ sub: 'u1' }), 'utf8').toString('base64url');
  return { access_token: 'x.' + payload + '.y' };
}

// 1回 1000行で 切る 作り物（order の 鍵で 並べて 返す・同じ 日の 行は adj_id で 一意）
function kura(n) {
  const rows = Array.from({ length: n }, (_, i) => ({
    adj_id: 'a' + String(i).padStart(5, '0'),
    work_date: '2026-09-' + String((i % 3) + 1).padStart(2, '0'),
  }));
  const kiita = [];
  const fetch = (url) => {
    const u = new URL(url);
    kiita.push(decodeURIComponent(u.search));
    const order = String(u.searchParams.get('order') || '');
    const lim = Math.min(Number(u.searchParams.get('limit') || 1000), 1000);
    const off = Number(u.searchParams.get('offset') || 0);
    const s = rows.slice();
    // 一意で ない 順（adj_id が 無い）なら 倉庫は 同じ 日の 行を 頼む たびに 違う 順で 返し得る
    //   ＝ここでは 2回目の 頼みだけ 逆さに して 見せる
    if (order.indexOf('adj_id') < 0 && (off / 1000) % 2 === 1) s.reverse();
    s.sort((a, b) =>
      a.work_date < b.work_date
        ? -1
        : a.work_date > b.work_date
          ? 1
          : order.indexOf('adj_id') < 0
            ? 0
            : a.adj_id < b.adj_id
              ? -1
              : 1
    );
    return Promise.resolve({ ok: true, json: () => Promise.resolve(s.slice(off, off + lim)) });
  };
  return { fetch, kiita };
}

// 画面の 読みの 字（kyuryo.html・shukei.html に 書いて ある 物）を 集める
function yomiNoJi() {
  const out = [];
  for (const f of ['kyuryo.html', 'shukei.html']) {
    const re = /'dk_pay_adjustments\?select=\*&work_date=gte\.' \+[\s\S]*?&limit=\d+'/g;
    let m;
    while ((m = re.exec(yomu(f)))) out.push({ f, ji: m[0] });
  }
  return out;
}

describe('★手当・控除の 読みの 順★', () => {
  it('鍵の 順は work_date.asc,adj_id.asc', () => {
    expect(yomu('js/dk-session.js')).toMatch(/dk_pay_adjustments: 'work_date\.asc,adj_id\.asc'/);
  });

  it('給料タブ（給料表・明細）と 月次集計の 3か所の 読みは 全部 1000行 より 多く 頼み・順に adj_id', () => {
    const ji = yomiNoJi();
    expect(ji.map((x) => x.f)).toEqual(['kyuryo.html', 'kyuryo.html', 'shukei.html']);
    ji.forEach((x) => {
      const l = /&limit=(\d+)/.exec(x.ji);
      expect(Number(l[1]), x.f + ' が 1000行で 切れる').toBeGreaterThan(1000);
      expect(x.ji, x.f + ' の 読みの 順が 鍵の 順で ない').toContain(
        '&order=work_date.asc,adj_id.asc'
      );
    });
  });

  it('2,500行 を 読むと 抜け・二重 無し（継ぎ目は 鍵の 順）', async () => {
    const k = kura(2500);
    const orig = globalThis.fetch;
    globalThis.fetch = k.fetch;
    try {
      const st = DK.newLoadState();
      const r = await DK.softList(
        fakeSess(),
        'dk_pay_adjustments?select=*&work_date=gte.2026-09-01&work_date=lte.2026-09-30&limit=5000',
        st
      );
      expect(r.length).toBe(2500);
      expect(new Set(r.map((x) => x.adj_id)).size, '★二重・抜けが 出た★').toBe(2500);
      k.kiita.forEach((q) => expect(q).toContain('order=work_date.asc,adj_id.asc'));
    } finally {
      globalThis.fetch = orig;
    }
  });
});
