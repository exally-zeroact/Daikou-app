'use strict';
// ============================================================
// 月次集計の画面（shukei.html）配線テスト 2026-08-01
//
//   固定すること:
//     1. 読み込み順（先に要る物が先に載っているか）
//     2. $('…') で触っている入れ物が全部HTMLに在るか
//     3. 接続先の直書きが無い
//     4. ★元データ（dk_shifts / dk_trips）に書き込まない★
//     5. 計算は GetsujiAgg に任せていて、画面の中で足し算し直していない
//     6. 事務所の画面どうしが行き来できる（最後に管理画面へまとめるとき迷子にしない）
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'shukei.html'), 'utf8');

describe('読み込み順', () => {
  const order = [
    'js/dk-config.js',
    'js/dk-session.js',
    'js/uriage-agg.js',
    'js/daiko-payroll.js',
    'js/payroll-period.js',
    'js/payroll-daily.js',
    'js/getsuji-agg.js',
  ];

  it('必要な部品が全部載っている', () => {
    order.forEach((f) => expect(HTML).toContain('src="' + f + '"'));
  });

  it('★後の物が先に読まれていない★', () => {
    const pos = order.map((f) => HTML.indexOf('src="' + f + '"'));
    for (let i = 1; i < pos.length; i++) expect(pos[i]).toBeGreaterThan(pos[i - 1]);
  });

  it('部品のファイルが実在する', () => {
    order.forEach((f) => expect(fs.existsSync(path.join(ROOT, f))).toBe(true));
  });
});

describe('★触っている入れ物が全部HTMLに在る（打ち間違い検出）★', () => {
  it('$(...) の相手が全部ある', () => {
    const ids = new Set();
    const re = /\$\('([A-Za-z][\w-]*)'\)/g;
    let m;
    while ((m = re.exec(HTML)) !== null) ids.add(m[1]);
    expect(ids.size).toBeGreaterThan(8);
    const missing = Array.from(ids).filter((id) => HTML.indexOf('id="' + id + '"') < 0);
    expect(missing).toEqual([]);
  });
});

describe('★接続先は dk-config.js だけ★', () => {
  it('Supabase の URL を直書きしていない', () => {
    expect(/https:\/\/[a-z0-9]{15,}\.supabase\.co/.test(HTML)).toBe(false);
  });
  it('anonキー(JWT)を直書きしていない', () => {
    expect(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\./.test(HTML)).toBe(false);
  });
  it('通信は DKSession 経由（fetch を直に呼ばない）', () => {
    expect(/[^.\w]fetch\s*\(/.test(HTML.replace(/DKSession\.rest/g, ''))).toBe(false);
  });
});

describe('★元データは書き換えない★', () => {
  const writes = [];
  const re = /DKSession\.rest\(\s*SESS,\s*([\s\S]{0,400}?)\{\s*method:\s*'(POST|PATCH|DELETE)'/g;
  let m;
  while ((m = re.exec(HTML)) !== null) writes.push({ target: m[1], method: m[2] });

  it('書き込み口は「PayPayの手入力」1つだけ', () => {
    expect(writes.length).toBe(1);
    expect(writes[0].target).toContain('dk_month_extras');
  });

  it('★dk_shifts / dk_trips / 給料の棚には書かない★', () => {
    writes.forEach((w) => {
      expect(w.target).not.toMatch(/dk_shifts|dk_trips|dk_work_hours|dk_employees/);
    });
  });

  it('消す通信は1つも無い', () => {
    expect(writes.filter((w) => w.method === 'DELETE').length).toBe(0);
  });
});

describe('★計算は GetsujiAgg に任せている（画面で足し算し直さない）★', () => {
  it('GetsujiAgg を使っている', () => {
    expect(HTML).toContain('GetsujiAgg.year');
    expect(HTML).toContain('PayrollDaily.buildCtx');
  });

  it('★画面の中に 会社に残る分 の式を書いていない★', () => {
    const script = HTML.slice(HTML.indexOf('js/getsuji-agg.js'));
    // 売上 − 給料 − 積立 を画面側で組み直していないこと
    expect(script).not.toMatch(/salesTotal\s*-\s*payTotal/);
    expect(script).not.toMatch(/\/\s*1\.1/); // 税の計算も lib 側だけ
    expect(script).not.toContain('0.05');
  });

  it('月ごとの数字は lib が返した物をそのまま出している', () => {
    [
      'm.salesTotal',
      'm.payTotal',
      'm.expense',
      'm.reserve',
      'm.unpaid',
      'm.cash',
      'm.ownerShare',
    ].forEach((k) => expect(HTML).toContain(k));
  });
});

describe('★実物の月別シートと同じ列が出る★', () => {
  it('売上 / 給料 / 経費 / 積立金 / 未収 / 現金 / 会社に残る分', () => {
    ['>売上<', '給料 合計', '>経費<', '>積立金<', '>未収<', '>現金<', '会社に残る分'].forEach((x) =>
      expect(HTML).toContain(x)
    );
  });

  it('★給料の列は期ごとに出す（月3回払い）★', () => {
    expect(HTML).toContain('YR.total.periods');
    expect(HTML).toContain('esc(p.name)');
  });

  it('PayPay は手入力できる（メーターが区別していないため）', () => {
    expect(HTML).toContain('dk_month_extras');
    expect(HTML).toContain('data-pp=');
  });

  it('印刷できる', () => {
    expect(HTML).toContain('window.print()');
    expect(HTML).toContain('@media print');
  });
});

describe('★事務所の画面どうしが行き来できる★', () => {
  const pages = {
    'uriage.html': ['kyuryo.html', 'shukei.html', 'dashboard.html'],
    'kyuryo.html': ['uriage.html', 'shukei.html', 'dashboard.html'],
    'shukei.html': ['uriage.html', 'kyuryo.html', 'dashboard.html'],
  };
  Object.keys(pages).forEach((from) => {
    it(from + ' から他の画面へ行ける', () => {
      const src = fs.readFileSync(path.join(ROOT, from), 'utf8');
      pages[from].forEach((to) => expect(src).toContain(to));
    });
  });
});
