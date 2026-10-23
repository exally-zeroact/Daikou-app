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
// 時数の 保存（乗った人・車の 時間）は 入力の 画面と 同じ 部品 2026-10-23
const JISUU = fs.readFileSync(path.join(ROOT, 'js', 'jisuu-hozon.js'), 'utf8');
// ★時数・乗った人・手で 入れた 1日分は 入力の 画面へ 移した★ 2026-10-23（司さん「給料タブは確認と従業員の設定だけにして」）
const NYU = fs.readFileSync(path.join(ROOT, 'nyuryoku.html'), 'utf8');
const JIPPI = fs.readFileSync(path.join(ROOT, 'js', 'jippi-hozon.js'), 'utf8');

describe('読み込み順', () => {
  const order = [
    'js/dk-config.js',
    'js/dk-session.js',
    'js/uriage-agg.js',
    'js/daiko-payroll.js',
    'js/payroll-period.js',
    'js/payroll-daily.js',
    'js/jisuu-hozon.js',
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

  it('タブの3枚（明細・従業員・給料の設定）と、その中身が対になっている', () => {
    ['slip', 'emp', 'set'].forEach((t) => {
      expect(HTML).toContain('data-tab="' + t + '"');
    });
    ['paneSlip', 'paneEmp', 'paneSet'].forEach((p) => {
      expect(HTML).toContain('id="' + p + '"');
    });
    // 「時数を入れる」は 入力の 画面へ 移した 2026-10-23
    expect(HTML).not.toContain('data-tab="hours"');
    expect(HTML).not.toContain('id="paneHours"');
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
    // ★手当・控除(dk_pay_adjustments・10-06)★ と 乗った人の割り当て(dk_work_hours) の 2つだけ。
    // どれも人が手で入れた物なので、打ち間違いを消せないと使えない。
    // 乗った人を 外す 口は 部品（js/jisuu-hozon.js）へ 出した 2026-10-23＝部品の 消す 口も 数える
    // 手で入れた1日分(dk_manual_days)を 消す 口は 入力の 画面（js/jippi-hozon.js delTebiki）へ 移した
    const jsDels = [];
    const re3 = /DKSession\.rest\(\s*sess,\s*([\s\S]{0,400}?)\{\s*method:\s*'DELETE'/g;
    let m3;
    while ((m3 = re3.exec(JISUU)) !== null) jsDels.push({ target: m3[1], method: 'DELETE' });
    expect(jsDels.length).toBe(1);
    const all = dels.concat(jsDels);
    expect(all.length).toBe(2);
    const targets = all.map((d) => d.target).join(' ');
    expect(targets).toContain('dk_work_hours');
    expect(targets).toContain('dk_pay_adjustments');
    expect(HTML, '給料の 画面は 手で 入れた 1日分を 消さない（入力の 画面へ 移した）').not.toMatch(
      /dk_manual_days\?company_id=eq/
    );
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

  it('「◯月分 x/21 〜 x/31」と「◯◯ 殿」が出る', () => {
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
    // 車の 時間の 自動（メーターの 記録から）は 入力の 画面が 同じ 1か所を 使う 2026-10-23
    expect(NYU).toContain('PayrollDaily.carHoursOf');
    expect(NYU).toContain('PayrollDaily.buildCtx');
  });

  it('引く実費は売上表と同じ関数を通す', () => {
    // 2026-10-14 時数を入れる の 実費は 画面で 引き直さず、計算（payroll-daily）が 売上表と 同じ
    //   UriageAgg.deductOf で 引いた 車ごとの 額（CTX.byDate の expense）を そのまま 出す
    const PD = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'payroll-daily.js'), 'utf8');
    expect(PD).toMatch(/Uriage\.deductOf\(/);
  });
});

describe('★手で1日分を足せる（スマホが無くても給料が出せる）★＝入力の 画面 2026-10-23', () => {
  it('給料の 画面は 手で入れた分を 読んで 計算に 入れる', () => {
    expect(HTML).toContain('dk_manual_days');
    expect(HTML).toContain('RAW.manualDays');
  });

  it('入力の 画面で 売上と時数を手で打てる／その日の行を消せる／新しい車を足せる', () => {
    expect(NYU).toContain('dk_manual_days');
    expect(NYU).toContain('data-f="sales_yen"');
    expect(NYU).toContain('data-f="hours"');
    expect(NYU).toContain('data-man-del');
    expect(NYU).toContain('id="btnNewCar"');
    expect(JIPPI).toContain("field === 'hours'");
    expect(JIPPI).toContain('function delTebiki(');
  });

  it('乗った人・車の 時数も 入力の 画面（給料の 画面と 同じ 部品）', () => {
    expect(NYU).toContain('src="js/jisuu-hozon.js"');
    expect(NYU).toContain('JisuuHozon.saveWorkHour');
    expect(NYU).toContain('JisuuHozon.delWorkHour');
    expect(NYU).toContain('JisuuHozon.saveCarHours');
    expect(NYU).toContain('JisuuHozon.noriNashi');
    expect(HTML).toContain('JisuuHozon.noriNashi'); // 明細の 入れ漏れの 帯
  });
});
