// ============================================================
// ★★本体に 足した 列が「窓（view）」に 映っているか★★ 2026-09-06（司さん「直せ」）
//
//   ★何が 起きたか（実測 2026-09-06）★
//     お客さんの 画面が 叩くのは ★public の 窓（VIEW）★。本体は daikome。
//     私は 列を ★本体にだけ★ 足して ★窓を 作り直していませんでした★。
//       dk_payroll_settings … show_car_sales が 窓に 無い
//       dk_employees ……… slip_cars    が 窓に 無い
//       dk_device_labels …… show_in_slip  が 窓に 無い
//     ⇒ 倉庫の API は「そんな列は 知らない（PGRST204）」で ★400★
//     ⇒ ★8/25 頃から 保存が 1回も 通っていなかった★（棚 0行／7人とも 空）
//     ⇒ 画面には「保存できませんでした」しか 出ず ★誰も 気づけなかった★
//
//   ★なぜ 見張りが 要るか★
//     repo の SQL には ★私が 自分で★ こう 書いていました：
//       「窓は 列を 名指ししているので 直さないと 見えない」
//     ★書いてあるだけでは 守れませんでした★。機械に 数えさせます。
//
//   ★この 見張りが する事★
//     supabase/*.sql の 中から
//       ①本体に 列を 足している所（alter table … add column）
//       ②窓を 作り直している所（create or replace view … select …）
//     を 読み、★①で 足した 列が ②の 窓にも 出ているか★ を 数える。
//     ★倉庫には 繋ぎません★（repo の 中だけで 完結＝CI でも 走る）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-06 実測）★★
//     apply-mado-atarashii-retsu.sql から show_car_sales を 消す … ★赤★
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SQLDIR = path.join(ROOT, 'supabase');

// ★本体に 足された 列を 集める★（alter table … add column …）
function hontaiNoRetsu() {
  const out = {}; // 表の名前 → 列の集合
  fs.readdirSync(SQLDIR)
    .filter((f) => /\.sql$/i.test(f))
    .forEach((f) => {
      const s = fs.readFileSync(path.join(SQLDIR, f), 'utf8');
      // ★注意書き（-- の行）は 外す★＝説明文の 中の 言葉を 拾わない為
      const naka = s
        .split('\n')
        .filter((x) => !x.trim().startsWith('--'))
        .join('\n');
      const re = /alter\s+table\s+(?:if\s+exists\s+)?daikome\.(\w+)([\s\S]*?);/gi;
      let m;
      while ((m = re.exec(naka))) {
        const tbl = m[1];
        const body = m[2];
        const re2 = /add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)/gi;
        let m2;
        while ((m2 = re2.exec(body))) {
          (out[tbl] = out[tbl] || new Set()).add(m2[1]);
        }
      }
    });
  return out;
}

// ★窓が 映している 列を 集める★（create or replace view public.X … select … from daikome.Y）
function madoNoRetsu() {
  const out = {};
  fs.readdirSync(SQLDIR)
    .filter((f) => /\.sql$/i.test(f))
    .forEach((f) => {
      const s = fs.readFileSync(path.join(SQLDIR, f), 'utf8');
      const naka = s
        .split('\n')
        .filter((x) => !x.trim().startsWith('--'))
        .join('\n');
      const re =
        /create\s+or\s+replace\s+view\s+public\.(\w+)[\s\S]*?select([\s\S]*?)from\s+daikome\.(\w+)/gi;
      let m;
      while ((m = re.exec(naka))) {
        const tbl = m[3];
        const cols = m[2]
          .split(',')
          .map((x) => x.trim().split(/\s+/).pop())
          .filter(Boolean);
        // ★★どれか 1つの ファイルで 足していれば よい★★
        //   ★ファイル名の 順＝当てた 順では ありません★（windows-public.sql が 一番 最後に 来るが
        //   実際は 一番 最初に 当てた 元の 定義）。★後勝ちに すると 嘘に なる★ので 足し合わせる。
        out[tbl] = out[tbl] || new Set();
        cols.forEach((c) => out[tbl].add(c));
      }
    });
  return out;
}

describe('★本体に 足した 列が 窓に 映っているか★', () => {
  const hontai = hontaiNoRetsu();
  const mado = madoNoRetsu();

  it('★窓を 持つ 表は、足した 列が 窓にも 出ている★', () => {
    const nukete = [];
    Object.keys(hontai).forEach((tbl) => {
      const m = mado[tbl];
      if (!m) return; // ★窓を repo で 作っていない 表は この見張りの 対象外★
      hontai[tbl].forEach((c) => {
        if (!m.has(c)) nukete.push(tbl + '.' + c);
      });
    });
    expect(
      nukete,
      '★本体に 足したのに ★窓に 映っていない 列★が あります★\n' +
        '  ⇒ 倉庫の API は その列を 知らず、保存が ★400（PGRST204）★ で 落ちます。\n' +
        '  ⇒ 画面には「保存できませんでした」としか 出ません（今回 これで 2週間 止まっていました）。\n' +
        '  ★直し方★ supabase/ に `create or replace view public.<表> with (security_invoker = true) as …`\n' +
        '            を 足して、★列を 名指しで 全部 書く★。'
    ).toEqual([]);
  });

  it('★窓を 作り直す 時は security_invoker を 付け直している★', () => {
    const warui = [];
    fs.readdirSync(SQLDIR)
      .filter((f) => /\.sql$/i.test(f))
      .forEach((f) => {
        const naka = fs
          .readFileSync(path.join(SQLDIR, f), 'utf8')
          .split('\n')
          .filter((x) => !x.trim().startsWith('--'))
          .join('\n');
        // ★書き方は 2通り 在ります（どちらでも よい）★
        //   ① create or replace view public.X ★with (security_invoker = true)★ as …
        //   ② create or replace view public.X as … ; ★alter view public.X set (security_invoker = true);★
        //   ★windows-public.sql は ②の 書き方★（元の 定義ファイル）
        const re = /create\s+or\s+replace\s+view\s+public\.(\w+)([\s\S]*?)\bas\b/gi;
        let m;
        while ((m = re.exec(naka))) {
          const na = m[1];
          // ★書き方は true でも on でも 同じ 意味★（実物に 両方 在る）
          const inline = /security_invoker\s*=\s*(?:true|on)\b/i.test(m[2]);
          const ato = new RegExp(
            'alter\\s+view\\s+public\\.' +
              na +
              '\\s+set\\s*\\(\\s*security_invoker\\s*=\\s*(?:true|on)\\b',
            'i'
          ).test(naka);
          if (!inline && !ato) warui.push(f + ' → ' + na);
        }
      });
    expect(
      warui,
      '★`create or replace view` は security_invoker を ★落とします★★\n' +
        '  ⇒ 付け直さないと 鍵（RLS）が 効かなくなる／効きすぎる。必ず with (security_invoker = true)。'
    ).toEqual([]);
  });
});
