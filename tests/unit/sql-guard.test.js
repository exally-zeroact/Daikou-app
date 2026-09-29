'use strict';
// ============================================================
// 共有本番にSQLを当てる前の門番 テスト 2026-08-01
//
//   ★この倉庫には Kyually本番 / Exally本番 / 代行請求（明細1000件超）の実データが同居している★
//   事故の形は2つだけ:
//     ① 消す/書き換える系が混ざる     → 他アプリのデータが飛ぶ
//     ② dk_ 以外の棚をいじってしまう  → 他アプリの棚が壊れる
//   両方を機械で止める。★わざと危ない物を食わせて止まることまで確かめる★
// ============================================================
const fs = require('fs');
const path = require('path');

let G;
beforeAll(async () => {
  G = await import('../../scripts/sql-guard.mjs');
});

const OK_SQL = `
-- 足すだけ
create table if not exists dk_employees (
  employee_id uuid primary key default gen_random_uuid(),
  company_id  uuid not null references dk_companies(company_id) on delete cascade,
  name        text not null
);
create index if not exists dk_employees_company_idx on dk_employees (company_id);
alter table dk_employees enable row level security;
create policy dk_employees_owner_sel on dk_employees
  for select using (company_id in (select company_id from dk_companies where owner_id = auth.uid()));
select tablename from pg_tables where schemaname = 'public';
`;

describe('★足すだけのSQLは通す★', () => {
  it('通る', () => {
    const r = G.guard(OK_SQL);
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it('触る棚をぜんぶ挙げる', () => {
    expect(G.guard(OK_SQL).tables).toEqual(['dk_employees']);
  });

  it('列を足すのは通る', () => {
    const r = G.guard(
      'alter table dk_shift_edits add column if not exists hours double precision;'
    );
    expect(r.ok).toBe(true);
  });

  it('コメントを付けるのは通る', () => {
    const r = G.guard("comment on column dk_shift_edits.hours is '車の時数';");
    expect(r.ok).toBe(true);
  });
});

describe('★消す/書き換える系は止める★', () => {
  const bad = {
    'drop table': 'drop table dk_employees;',
    'drop policy': 'drop policy if exists dk_shifts_owner_sel on dk_shifts;',
    'drop column': 'alter table dk_employees drop column name;',
    truncate: 'truncate dk_work_hours;',
    delete: 'delete from dk_employees where active = false;',
    update: "update dk_employees set role = '1種';",
    insert: "insert into dk_employees (name) values ('x');",
    revoke: 'revoke all on dk_employees from anon;',
  };
  Object.keys(bad).forEach((k) => {
    it(k + ' は止まる', () => {
      const r = G.guard(bad[k]);
      expect(r.ok).toBe(false);
      expect(r.reasons.length).toBeGreaterThan(0);
    });
  });

  it('★足すだけの中に1文だけ混ぜても止まる★', () => {
    const r = G.guard(OK_SQL + '\ndrop table pay_slips;');
    expect(r.ok).toBe(false);
  });

  it('中身を読めない do $$ ... $$ は通さない', () => {
    const r = G.guard('do $$ begin execute (%%); end $$;');
    expect(r.ok).toBe(false);
  });
});

describe('★dk_ 以外の棚に触る物は止める★', () => {
  it('他アプリの棚を作ろうとしたら止まる', () => {
    const r = G.guard('create table if not exists pay_slips (id uuid primary key);');
    expect(r.ok).toBe(false);
    expect(r.reasons.join()).toContain('pay_slips');
  });

  it('代行請求の meisai に触ろうとしたら止まる', () => {
    const r = G.guard('alter table meisai add column if not exists x int;');
    expect(r.ok).toBe(false);
    expect(r.reasons.join()).toContain('meisai');
  });

  it('policy を他アプリの棚に付けようとしたら止まる', () => {
    const r = G.guard('create policy p1 on companies for select using (true);');
    expect(r.ok).toBe(false);
  });

  it('★dk_ を参照するだけ（references / select の中）は止めない★', () => {
    const r = G.guard(
      'create table if not exists dk_x (a uuid references dk_companies(company_id), b uuid references pay_org(id));'
    );
    // 作る棚は dk_x だけ。参照先は作り変えないので通る
    expect(r.tables).toEqual(['dk_x']);
    expect(r.ok).toBe(true);
  });
});

describe('★ごまかしが効かないこと★', () => {
  it('コメントの中の drop は無視する（止めない）', () => {
    const r = G.guard(
      '-- drop table dk_employees するな\ncreate table if not exists dk_a (id int);'
    );
    expect(r.ok).toBe(true);
  });

  it('文字列の中の drop は無視する', () => {
    const r = G.guard("comment on table dk_a is 'drop table しない';");
    expect(r.ok).toBe(true);
  });

  it('大文字でも止める', () => {
    expect(G.guard('DROP TABLE dk_a;').ok).toBe(false);
    expect(G.guard('DeLeTe FrOm dk_a;').ok).toBe(false);
  });

  it('改行や空白を増やしても止める', () => {
    expect(G.guard('drop\n\n   table   dk_a;').ok).toBe(false);
  });

  it('空っぽ・意味不明は通さない', () => {
    expect(G.guard('').ok).toBe(false);
    expect(G.guard(null).ok).toBe(false);
    expect(G.guard('こんにちは').ok).toBe(false);
  });
});

describe('★実物のファイルで確かめる★', () => {
  const dir = path.join(__dirname, '..', '..', 'supabase');
  const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

  [
    'apply-shared-dk-jobs.sql',
    'apply-shared-dk-sales.sql',
    'apply-shared-dk-sales-settings.sql',
    'apply-shared-dk-payroll.sql',
  ].forEach((f) => {
    it(f + ' は通る（足すだけ）', () => {
      const r = G.guard(read(f));
      if (!r.ok) console.log(f, r.reasons);
      expect(r.ok).toBe(true);
      expect(r.tables.every((t) => t.indexOf('dk_') === 0)).toBe(true);
    });
  });

  it('★migrate-standalone.sql は止まる（新しい空プロジェクト用・共有本番に持ち込まない）★', () => {
    const r = G.guard(read('migrate-standalone.sql'));
    expect(r.ok).toBe(false);
  });
});

// ============================================================
// ★部屋(schema)つきの名前を読めるか★ 2026-08-25
//   ダイコメの棚は daikome という部屋に入っている（daikome.dk_payroll_settings）。
//   門番は 部屋つきの名前を「daikome という棚」と読んで、
//   ★自分の棚なのに「他アプリの棚」と言って止めていた★（司さんの作業が1回 止まった）。
//   ⇒ 部屋と 頭文字(dk_) の ★両方★ を見る。ここで その両方を数える。
// ============================================================
describe('★部屋つきの棚の名前★', () => {
  it('daikome.dk_◯◯ は通す', () => {
    expect(
      G.guard(
        'alter table daikome.dk_payroll_settings add column if not exists show_car_sales boolean not null default true;'
      ).ok,
      '★自分の棚を止めている★'
    ).toBe(true);
  });
  it('部屋なしの dk_◯◯ も 今までどおり通す', () => {
    expect(G.guard('alter table dk_trips add column if not exists memo text;').ok).toBe(true);
  });
  it('★他の部屋は止める★', () => {
    expect(G.guard('alter table public.users add column x text;').ok, '★他の部屋を通した★').toBe(
      false
    );
    expect(
      G.guard('alter table kyuyo.dk_x add column x text;').ok,
      '★他の部屋の dk_ を通した★'
    ).toBe(false);
  });
  it('★自分の部屋でも dk_ で始まらない棚は止める★', () => {
    expect(G.guard('alter table daikome.employees add column x text;').ok).toBe(false);
  });
  it('★消す/書き換える書き方は 部屋つきでも止める★', () => {
    expect(G.guard('drop table daikome.dk_trips;').ok).toBe(false);
    expect(G.guard('delete from daikome.dk_trips;').ok).toBe(false);
    expect(G.guard('update daikome.dk_trips set fare_yen = 0;').ok).toBe(false);
  });

  // ── ★2026-09-26 に 見つけた 穴★ ───────────────────────────
  //   本物の紙 supabase/apply-jippi-jiyuu.sql の
  //     update daikome.dk_expense_kinds ★k★
  //        set label = s.other_label
  //   が ★門を すり抜けていた★（棚と set の 間に 別名が 入る 形）。
  //   ★上の 2本の 試験は どちらも 別名なし★だったので 誰も 気付けなかった。
  //   ★わざと 壊して 見た★：直した 形を 前の /update\s+[a-z_][\w.]*\s+set/ に
  //   戻すと この 5本の うち ★4本が 赤★ に なる（別名なしの 1本だけ 緑）。
  describe('★別名つきの update も 止める★', () => {
    const kaku = {
      別名: 'update daikome.dk_expense_kinds k\n   set label = 1;',
      'as つき': 'update daikome.dk_trips as t set fare_yen = 0;',
      'only つき': 'update only daikome.dk_trips set fare_yen = 0;',
      引用符つき: 'update "daikome"."dk_trips" t set fare_yen = 0;',
      別名なし: 'update daikome.dk_trips set fare_yen = 0;',
    };
    for (const [na, sql] of Object.entries(kaku)) {
      it(na, () => {
        expect(
          G.findDangerous(sql).map((d) => d.kind),
          na + ' を 見逃した'
        ).toContain('update');
        expect(G.guard(sql).ok, na + ' を 門が 通した').toBe(false);
      });
    }
  });

  it('★足すだけの 形を 巻き添えにしない（偽の赤が 出ないか）★', () => {
    expect(G.guard('alter table if exists daikome.dk_x add column if not exists a int;').ok).toBe(
      true
    );
    expect(
      G.guard('create or replace view public.dk_y as select a from daikome.dk_x;').ok,
      '窓を 作るだけで 止めた'
    ).toBe(true);
  });
});

// ============================================================
// ★★2026-09-29 対立役に 叩かれて 足した 段★★
//   上の 段は 一つも 書き換えていない。★隣に 足しただけ★。
//   （★自分の 思い込みを 見張りに 書くと 機械が 守り続ける★ので、
//     既に 在る 試験を 新しい 考えに 合わせて 変える のを やめた）
//
//   ▼何が 起きていたか（実測）
//     対立役の 攻撃 SQL 60本中 42本が 通った。
//     私が そのうち 23本を 選んで 自分で 当て直したら ★21本が 通った★。
//     今は ★22/23 が 止まる★（残り1本は A22。通す 訳を sql-guard.mjs の 頭に 書いた）。
//
//   ▼★★わざと壊した 記録（2026-09-29・自分で 1つずつ 戻して 測った）★★
//     「わざと壊して 赤 1個で 信用するな」なので ★赤の 数を 並べる★。
//     壊す前 ……………………………………………………… 赤  0 / 全 73
//     ① ドル引用を `$$` だけに 戻す（門が 盲目）…… ★赤  3★ / 全 73
//     ② 引用符の 名前を 潰す（棚の壁が 外れる）… ★赤  2★ / 全 73
//     ③ 白名簿の 判定を 外す（黒名簿だけに 戻る） ★赤 14★ / 全 73
//     ④ anon への 書き換えを 常に 許す………… ★赤  2★ / 全 73
//     ⑤ RLS+決まりの 見方を 外す（偽の赤が 戻る） ★赤  1★ / 全 73
//     戻した後 ……………………………………………………… 赤  0 / 全 73
//
//     ★①は はじめ 赤 1本しか 出なかった★。その後 足した 2本が
//     実は その 直しに 頼っていなかった（後ろに もう 1つ `'` が 無いと 食われない）。
//     「壊したのに 赤に ならない＝まず 壊れているか」で 見つけて 直した（1本 → 3本）。
//     ★⑤は 赤 1本のまま★＝「偽の赤が 戻っていないか」は その 1本でしか 見ていない。
//     水増しするより 残しておく。
// ============================================================
describe('★対立役の 攻撃 SQL（通ったら 負け）★', () => {
  // ★門が「盲目」に なる 2つ★—— この 2つが 死んでいると 他の 札は 全部 効かない
  it('★ドル引用の 中の アポストロフィで 1文 丸ごと 消えない★', () => {
    const sql =
      "create table daikome.dk_note (a text default $q$it's$q$);\n" +
      'update daikou.meisai set amount = 0;\n' +
      "comment on table daikome.dk_note is 'ok';";
    // 前は 門が 見る 字が
    //   create table daikome.dk_note (a text default $q$it''ok';
    // に なって ★update が 丸ごと 消えていた★
    expect(G.stripNoise(sql), '★update が 門から 消えている★').toContain(
      'update daikou.meisai set amount = 0'
    );
    expect(G.findDangerous(sql).map((d) => d.kind)).toContain('update');
    expect(G.guard(sql).ok).toBe(false);
  });

  // ★上の 1本だけだと 「わざと 壊して 赤 1個」に なる★ので 形を 変えて 2本 足す。
  //   （ドル引用を `$$` だけに 戻すと この 3本が 赤に なる）
  it('★ドル引用の 後ろの grant が 食われない★', () => {
    const sql =
      "create table daikome.dk_n2 (a text default $tag$don't$tag$);\n" +
      'grant select, insert, update, delete on daikome.dk_n2 to anon;\n' +
      "comment on table daikome.dk_n2 is 'x';"; // ★この ' と 対に なって 食われる★
    expect(G.stripNoise(sql), '★grant が 門から 消えている★').toContain('to anon');
    const r = G.guard(sql);
    expect(r.ok).toBe(false);
    expect(r.reasons.join()).toContain('anon');
  });

  it('★ドル引用の 後ろの policy が 食われない★', () => {
    const sql =
      "create table daikome.dk_n3 (a text default $b$it's$b$);\n" +
      'create policy p on daikome.dk_n3 for all to anon using (true);\n' +
      "comment on table daikome.dk_n3 is 'x';"; // ★この ' と 対に なって 食われる★
    expect(G.stripNoise(sql), '★policy が 門から 消えている★').toContain('for all to anon');
    expect(G.guard(sql).ok).toBe(false);
  });

  it('★引用符つきの 名前で 棚の壁が 外れない★', () => {
    const sql = 'alter table "public"."meisai" add column hack int;\nselect 1;';
    // 前は `""` に 潰していたので findTargetTables が ★0件★を 返し、
    //   ★部屋/棚の壁（この門の 本体）が 丸ごと 外れていた★
    //   ＝「道具が返した0件を根拠にするな」に 正面から 当たっていた
    expect(G.findTargetTables(sql), '★棚を 1つも 拾えていない★').toContain('public.meisai');
    expect(G.guard(sql).ok).toBe(false);
  });

  const kougeki = {
    'A2 $x$ の do ブロック':
      "do $x$ begin execute 'update daikou.meisai set amount=0'; end $x$;\nselect 1;",
    'A4 引用符で 他部屋に 棚を create': 'create table "public"."evil" (a int);\nselect 1;',
    'A5 引用符で 他部屋に policy':
      'create policy "p" on public.meisai for select using (true);\nselect 1;',
    'A6 引用符で 他部屋に index': 'create index "i1" on public.meisai (amount);\nselect 1;',
    // ★これが 前の 直し（view を 丸ごと 止める）を 破った 字★
    //   `recursive` の 1語で 札を すり抜けていた。今は ★窓の 名前★ で 止める。
    'A7 recursive の 窓で 金額を 0 に':
      'create or replace recursive view public.meisai (amount) as select 0 as amount;',
    'A8 誰でも(anon)に 書き換えを 許す policy':
      'create policy p on daikome.dk_sales for all to anon using (true) with check (true);',
    'A9 set local role': 'set local role postgres;\nselect 1;',
    'A10 create role': 'create role hack login;\nselect 1;',
    'A11 drop owned by anon': 'drop owned by anon;\nselect 1;',
    'A12 copy の 列を 20個 並べて from を 遠くへ':
      'copy daikou.meisai (id,amount,a1,a2,a3,a4,a5,a6,a7,a8,a9,b1,b2,b3,b4,b5,b6,b7,b8,b9) from stdin;',
    'A13 後ろの 仕掛け(trigger)を 入に する':
      'alter table daikome.dk_sales enable always trigger t;\nselect 1;',
    'A14 引用符つき 別名の update': 'update only daikou.meisai "m" set amount=0;\nselect 1;',
    'A15 列名を rename（事務所が 黙って 落ちる）':
      'alter table daikome.dk_sales rename column amount to amount_old;',
    'A16 数字を 文字に する（戻せない）':
      'alter table daikome.dk_sales alter column amount type text;',
    'A17 行の守り(RLS)を 切る': 'alter table daikome.dk_sales disable row level security;',
    'A18 連番を 1に 戻す': 'alter sequence daikou.meisai_id_seq restart with 1;\nselect 1;',
    'A19 本番の 明細を 止める': 'lock table daikou.meisai in access exclusive mode;\nselect 1;',
    'A20 select into で 丸ごと 複製': 'select * into daikome.dk_leak from daikou.meisai;',
    'A21 create table as で 複製': 'create table daikome.dk_leak2 as select * from daikou.meisai;',
    'A23 窓を「作った人の権限で動く」に 戻す':
      'alter view public.meisai set (security_invoker=false);\nselect 1;',
  };
  for (const [na, sql] of Object.entries(kougeki)) {
    it(na, () => {
      expect(G.guard(sql, { room: 'daikome', prefix: 'dk_' }).ok, na + ' を 門が 通した').toBe(
        false
      );
    });
  }

  it('★merge で 金額を 0 に（これが 最初に 見つかった 穴）★', () => {
    const sql =
      'merge into daikou.meisai m using (select 1) x on true ' +
      'when matched then update set amount = 0; select 1;';
    expect(G.guard(sql, { room: 'daikou', prefix: 'meisai' }).ok).toBe(false);
  });

  it('★apply-meisai-sql.mjs の 設定では public に 窓を 置けない★', () => {
    // prefix='meisai' だと public.meisai が 名前として 当たってしまうので
    // その 道具は madoPublic:false で 呼ぶ。これが 外れていないか 見張る。
    const sql = 'create or replace view public.meisai as select 0 as amount;';
    expect(G.guard(sql, { room: 'daikou', prefix: 'meisai', madoPublic: false }).ok).toBe(false);
  });
});

describe('★偽の赤を 出さない（repo の 実績で 確かめる）★', () => {
  // ★窓の 決まりは 私の 思いつきでは ない★
  //   supabase/*.sql の 窓 38本中 38本が public.dk_◯◯（例外 0本・機械で 数えた）
  it('public.dk_◯◯ の 窓は 通す', () => {
    expect(
      G.guard('create or replace view public.dk_shift_edits as select a from daikome.dk_x;').ok
    ).toBe(true);
  });
  it('security_invoker = true に するのは 通す（repo に 24箇所）', () => {
    expect(G.guard('alter view public.dk_shifts set (security_invoker = true);').ok).toBe(true);
  });
  it('読むだけの select は 通す', () => {
    expect(G.guard("select tablename from pg_tables where schemaname = 'public';").ok).toBe(true);
  });
  it('列名が grant でも 通す（語を 見ているだけに なっていないか）', () => {
    expect(G.guard('create table daikome.dk_g (grant int);').ok).toBe(true);
  });
  it('grant select を authenticated に は 通す', () => {
    expect(G.guard('grant select on daikome.dk_admins to authenticated;').ok).toBe(true);
  });
  it('★grant の 書き換えを anon に は 通さない★（誰が開けるかは 先に 訊く）', () => {
    const r = G.guard('grant select, insert, update, delete on daikome.dk_day_extras to anon;');
    expect(r.ok).toBe(false);
    expect(r.reasons.join()).toContain('anon');
  });

  // ★★ここは 1度 言い過ぎて 測って 直した 所★★
  //   はじめは 「`to anon` の 書き換えは 全部 赤」に したが、
  //   本番を 読んだら その 6棚は ★RLS が 6/6 入・決まりも 1～4本 在る★。
  //   ＝Supabase の 普通の 形 で それ単体では 開いていない★偽の赤★だった。
  it('★同じ 紙で RLS+決まりを 入れていれば anon の 書き換えも 通す★', () => {
    const sql =
      'alter table daikome.dk_ok enable row level security;' +
      ' create policy p on daikome.dk_ok for select using (true);' +
      ' grant select, insert, update, delete on daikome.dk_ok to anon;';
    const r = G.guard(sql);
    expect(r.ok, '★偽の赤（repo の 普通の 形を 止めている）★: ' + r.reasons.join()).toBe(true);
  });

  it('★using(true) で anon に 書き換えを 許す 決まりは 止める★', () => {
    expect(G.guard('create policy p on daikome.dk_x for all to anon using (true);').ok).toBe(false);
  });
});
