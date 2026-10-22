// ============================================================
// ★★見張り：月次集計の 電子決済（日ごと）は その 年の 分を 全部 読む（500件で 切らない）★★ 2026-10-23
//
//   ★前★ dk_day_extras を 日付で 絞らず・並びも 無く limit=500 で 1回 読んだ（softList の hitoTsu）。
//         電子決済は 1日 1行＝1年半ほどで 500 を 越え、越えると その 年の 日の 額が 黙って 抜けた
//         （日ごとが 消えた 月は 月ごとの 額に 戻る 事も ある）。10-23 実測＝本番・テストとも 0行（今 抜けている 会社 0）
//   ★今★ 前の 年の 12月 〜 次の 年の 1月 だけを 日付の 順に 1000行 ずつ 全部 読む（勤務・手で 入れた 日 と 同じ 範囲）
//   ★本物の 数え方（DKSession.softList・zenbuYomu）を 通す★＝倉庫の 返事（fetch）だけ PostgREST に 似せて 答える
//     （pay_date の gte/lte・order・offset・limit（1回 1000行まで）を 守る）
//   ★★わざと壊して 赤（2026-10-23 手元 chromium 実測）★★ 直す 前の 読み（limit=500・絞り 無し）＝赤（0 対 5,000）／
//     order=pay_date.asc だけ 外す＝赤（道の 検査）
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
test.use({ timezoneId: 'Asia/Tokyo' });

const CO = '11111111-2222-3333-4444-555555555555';

const SHIFTS = [
  {
    shift_id: 's1',
    device_id: 'd1',
    started_at: '2026-01-05T20:00:00+09:00',
    ended_at: '2026-01-06T04:00:00+09:00',
    elapsed_sec: 28800,
    fare_total_yen: 40000,
    trip_count: 12,
    actual_total_m: 80000,
    total_distance_m: 150000,
  },
];
const LABELS = [{ device_id: 'd1', label: '4987', sort_order: 1 }];

// ★前の 年より 前の 電子決済 600行（2023-04-11 〜 2024-11-30・各 100円）を 先に 置き、この 年の 2行を 後ろに 置く★
//   ＝並び無しで 500行 だけ 読むと この 年の 2行（4,000＋1,000）が 抜ける 形
function denshi() {
  const out = [];
  const t0 = Date.UTC(2023, 3, 11);
  for (let i = 0; i < 600; i++) {
    const d = new Date(t0 + i * 86400000).toISOString().slice(0, 10);
    out.push({ company_id: CO, pay_date: d, denshi_yen: 100 });
  }
  out.push({ company_id: CO, pay_date: '2026-01-05', denshi_yen: 4000 });
  out.push({ company_id: CO, pay_date: '2026-03-01', denshi_yen: 1000 });
  return out;
}

function tsukuru() {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const co = { company_id: CO, name: 'mihari' };
  const hyou = { dk_shifts: SHIFTS, dk_device_labels: LABELS, dk_day_extras: denshi() };
  const nakami = function (co, T) {
    const S = window.DKSession;
    window.__yonda = []; // 倉庫へ 頼んだ 道（dk_day_extras だけ）
    const kotae = (v) => ({ ok: true, status: 200, json: () => Promise.resolve(v) });
    S.ensure = () => Promise.resolve({ token: 'd' });
    S.goLogin = () => {};
    S.logout = () => {};
    S.rememberedCompanyId = () => co.company_id;
    S.pickCompany = () => ({ mode: 'one', company: co });
    S.myCompanies = () => Promise.resolve(kotae([co]));
    // ★PostgREST に 似せる★（eq・gte・lte・order・offset・limit／1回 1000行まで）
    const hen = (s, p) => {
      const [na, q] = String(p).split('?');
      if (na === 'dk_day_extras') window.__yonda.push(String(p));
      let rows = (T[na] || []).slice();
      const prm = new URLSearchParams(q || '');
      let order = '';
      let off = 0;
      let lim = 1000;
      prm.forEach((v, k) => {
        if (k === 'order') order = v;
        else if (k === 'offset') off = Number(v);
        else if (k === 'limit') lim = Math.min(Number(v), 1000);
        else if (k === 'select') return;
        else {
          const m = /^(eq|gte|lte|gt|lt)\.(.*)$/.exec(v);
          if (!m) return;
          rows = rows.filter((r) => {
            if (r[k] === undefined) return true;
            const a = String(r[k]);
            const b = m[2];
            return m[1] === 'eq'
              ? a === b
              : m[1] === 'gte'
                ? a >= b
                : m[1] === 'lte'
                  ? a <= b
                  : m[1] === 'gt'
                    ? a > b
                    : a < b;
          });
        }
      });
      if (order) {
        const ks = order.split(',').map((x) => x.split('.'));
        rows.sort((x, y) => {
          for (const [k, d] of ks) {
            const a = String(x[k]);
            const b = String(y[k]);
            if (a !== b) return (a < b ? -1 : 1) * (d === 'desc' ? -1 : 1);
          }
          return 0;
        });
      }
      return Promise.resolve(kotae(rows.slice(off, off + lim)));
    };
    S.rest = hen;
    const motoFetch = window.fetch;
    window.fetch = (u, o) => {
      const k = String(u).split('/rest/v1/');
      if (k.length === 2) return hen(null, decodeURIComponent(k[1]));
      return motoFetch(u, o);
    };
  };
  return (
    moto +
    ';(' +
    nakami.toString() +
    ')(' +
    [co, hyou].map((x) => JSON.stringify(x)).join(',') +
    ');'
  );
}

async function akeru(page) {
  await page.clock.setFixedTime(new Date('2026-02-15T12:00:00+09:00'));
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsukuru(),
    })
  );
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/shukei.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#yearLabel')).toContainText('2026', { timeout: 15000 });
  await page.locator('#motoHyou > summary').click({ timeout: 15000 });
  await page.locator('#dkBody').waitFor({ state: 'attached', timeout: 15000 });
  await page.waitForTimeout(800);
}

// 内訳の 電子決済 の 行（年まるごと）
function denshiWoYomu(page) {
  return page.evaluate(() => {
    const tr = [...document.querySelectorAll('#kpis tr')].find(
      (x) => (x.children[0] || {}).textContent && x.children[0].textContent.indexOf('電子決済') >= 0
    );
    return tr ? Number((tr.children[1].textContent || '').replace(/[^\d-]/g, '')) : null;
  });
}

test('★電子決済が 前の 年までに 600行 在っても この 年の 分（4,000＋1,000）を 全部 数える★', async ({
  page,
}) => {
  const err = [];
  page.on('pageerror', (e) => err.push(e.message));
  await akeru(page);
  const v = await denshiWoYomu(page);
  expect(v, '★この 年の 電子決済が 抜けた（500行で 切れた）★').toBe(5000);
  // 読んだ 道＝この 年の 範囲（前の 年の 12月 〜 次の 年の 1月）で 絞り、日付の 順で 1000行 ずつ
  const yonda = await page.evaluate(() => window.__yonda);
  expect(yonda.length, '★電子決済を 読んでいない★').toBeGreaterThan(0);
  for (const p of yonda) {
    expect(p).toContain('pay_date=gte.2025-12-01');
    expect(p).toContain('pay_date=lte.2027-01-31');
    expect(p).toContain('order=pay_date.asc');
    expect(p).toContain('company_id=eq.' + CO);
  }
  expect(err, '★画面が 落ちた★').toEqual([]);
});
