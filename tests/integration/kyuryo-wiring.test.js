'use strict';
// ============================================================
// 給料の画面（kyuryo.html）配線テスト 2026-08-01
//
//   ★純ロジックが緑でも、画面の配線が1本抜けていれば給料は出ない★
//   （Kyually で「libは緑なのに実UIに出ない」を踏んでいる。同じ轍を踏まないための機械チェック）
//
//   ここで固定すること:
//     1. 読み込み順（先に要る物が先に載っているか）
//     2. $('…') で触っている入れ物が★全部HTMLに在るか★（打ち間違いを機械で潰す）
//     3. 接続先の直書きが無い（dk-config.js 一元化を壊さない）
//     4. ★元データ（dk_shifts / dk_trips）に書き込まない★＝メーターが確定した数字は不可侵
//     5. 触る棚は dk_ だけ（他アプリの棚に触らない）
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'kyuryo.html'), 'utf8');

describe('読み込み順', () => {
  const order = [
    'js/dk-config.js',
    'js/dk-session.js',
    'js/uriage-agg.js',
    'js/daiko-payroll.js',
    'js/payroll-period.js',
    'js/payroll-daily.js',
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
    expect(ids.size).toBeGreaterThan(15); // 拾えていないと素通りするので下限を置く
    const missing = Array.from(ids).filter((id) => HTML.indexOf('id="' + id + '"') < 0);
    expect(missing).toEqual([]);
  });

  it('タブの4枚と、その中身が対になっている', () => {
    ['slip', 'hours', 'emp', 'set'].forEach((t) => {
      expect(HTML).toContain('data-tab="' + t + '"');
    });
    ['paneSlip', 'paneHours', 'paneEmp', 'paneSet'].forEach((p) => {
      expect(HTML).toContain('id="' + p + '"');
    });
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

describe('★元データは書き換えない（メーターが確定した数字は不可侵）★', () => {
  // 書き込みは method: POST / PATCH / DELETE。その直前に出てくる棚名を見る。
  const writes = [];
  const re = /DKSession\.rest\(\s*SESS,\s*([\s\S]{0,400}?)\{\s*method:\s*'(POST|PATCH|DELETE)'/g;
  let m;
  while ((m = re.exec(HTML)) !== null) writes.push({ target: m[1], method: m[2] });
  // upsert() 経由の書き込み
  const ups = [];
  const re2 = /upsert\('([\w]+)'/g;
  while ((m = re2.exec(HTML)) !== null) ups.push(m[1]);

  it('書き込み口を見つけられている', () => {
    expect(writes.length + ups.length).toBeGreaterThan(3);
  });

  it('★dk_shifts / dk_trips には1文字も書かない★', () => {
    writes.forEach((w) => {
      expect(w.target).not.toMatch(/dk_shifts|dk_trips/);
    });
    ups.forEach((t) => {
      expect(['dk_shifts', 'dk_trips']).not.toContain(t);
    });
  });

  it('書き込む棚は dk_ で始まる物だけ', () => {
    const tables = new Set(ups);
    writes.forEach((w) => {
      const mm = w.target.match(/'([a-z_][\w]*)\?/);
      if (mm) tables.add(mm[1]);
    });
    tables.forEach((t) => expect(t.indexOf('dk_')).toBe(0));
  });

  it('★消せるのは「手で入れた物」だけ★（メーターの記録も従業員も消さない）', () => {
    const dels = writes.filter((w) => w.method === 'DELETE');
    // 乗った人の割り当て(dk_work_hours) と 手で入れた1日分(dk_manual_days) の2つだけ。
    // どちらも人が手で入れた物なので、打ち間違いを消せないと使えない。
    expect(dels.length).toBe(2);
    const targets = dels.map((d) => d.target).join(' ');
    expect(targets).toContain('dk_work_hours');
    expect(targets).toContain('dk_manual_days');
    // ★メーターが確定した記録は消す道が無い★
    expect(targets).not.toMatch(/dk_shifts|dk_trips|dk_employees/);
  });
});

describe('★実物の明細と同じ物が出る作りになっている★', () => {
  it('日付 / 金額 / 時間 / 売上n / 時間(全台) の行がある', () => {
    expect(HTML).toContain('>日付<');
    expect(HTML).toContain("row('金額'");
    expect(HTML).toContain("row('時間'");
    // 2026-08-25：1台ずつ「明細に出す/出さない」を足したので、番号は
    // ★出す車だけで振り直す★（i ではなく n）。売上2・売上3 が抜けない為。
    expect(HTML).toContain("'売上' + (n + 1)");
    expect(HTML).toContain("row('時間（全台）'");
  });

  it('「◯月分 x/21 ~ x/31」と「◯◯ 殿」が出る', () => {
    expect(HTML).toContain('PERIOD.label');
    expect(HTML).toContain('PERIOD.rangeLabel');
    expect(HTML).toContain('　殿');
  });

  it('休んだ日は空欄（null をそのまま出さない）', () => {
    expect(HTML).toContain("c.pay === null ? '' :");
    expect(HTML).toContain("c.hours === null ? '' :");
  });

  it('印刷できる', () => {
    expect(HTML).toContain('window.print()');
    expect(HTML).toContain('@media print');
    expect(HTML).toContain('break-inside: avoid');
  });
});

describe('金額の計算は自前で書かない（エンジンだけが正）', () => {
  it('★画面の中に歩合や最低保証の数字を書いていない★', () => {
    const script = HTML.slice(HTML.indexOf('js/payroll-daily.js'));
    expect(script).not.toContain('1150');
    expect(script).not.toContain('0.35');
    expect(script).not.toMatch(/Math\.max\([^)]*floor/);
  });

  it('計算は PayrollDaily に任せている', () => {
    expect(HTML).toContain('PayrollDaily.buildCtx');
    expect(HTML).toContain('PayrollDaily.report');
    expect(HTML).toContain('PayrollDaily.carHoursOf');
  });

  it('引く実費は売上表と同じ関数を通す', () => {
    expect(HTML).toContain('UriageAgg.deductOf');
  });
});

describe('★手で1日分を足せる（スマホが無くても給料が出せる）★', () => {
  it('手で入れた分を読み込んでいる', () => {
    expect(HTML).toContain('dk_manual_days');
    expect(HTML).toContain('RAW.manualDays');
  });

  it('売上と時間を手で打てる／行を消せる／車を足せる', () => {
    expect(HTML).toContain('data-man-f="sales_yen"');
    expect(HTML).toContain('data-man-f="hours"');
    expect(HTML).toContain('data-man-del-dev');
    expect(HTML).toContain('data-man-add');
  });

  it('★手で入れた分は見た目で分かる★', () => {
    expect(HTML).toContain('>手入力<');
    expect(HTML).toContain('.manual {');
  });

  it('★メーターがある車は手入力の行を出さない（二重に見せない）★', () => {
    expect(HTML).toContain('!meterDevs[m.device_id]');
  });

  it('勤務っぽい形への変換は lib の1箇所だけ（画面で組み立て直さない）', () => {
    expect(HTML).toContain('PayrollDaily.manualAsShifts');
    expect(HTML).not.toMatch(/fare_total_yen:\s*num\(/);
  });
});
