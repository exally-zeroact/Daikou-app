// ============================================================
// scripts/sql-guard.mjs
// ★共有本番の倉庫にSQLを当てる前の門番（純ロジック・テスト対象）2026-08-01★
//
//   ダイコメの倉庫 tnfwipbgfgjaymlszeid には
//   ★Kyually本番 / Exally本番 / 代行請求（明細1000件超）の実データが同居している★。
//   だから「足すだけ」以外は絶対に通さない。ここはその関所。
//
//   ▼止める物
//     ・消す/書き換える系（drop / truncate / delete / update / insert / revoke / drop column）
//     ・dk_ で始まらない棚をいじる物（他アプリの棚に触れない）
//   ▼通す物
//     create table / create index / alter table ... add column / enable row level security /
//     create policy / comment on / select（確認用） / 窓(view)を public.dk_◯◯ に 配る
//
//   ※ migrate-standalone.sql は drop policy を含むので★ここで弾かれるのが正しい★
//     （あれは新しい空プロジェクト用。共有本番には持ち込まない）
//
// ============================================================
// ★★2026-09-29 作り直し＝★黒名簿を やめて 白名簿に した★★★
//
//   ★なぜ 作り直したか（対立役に 叩かれ、私も 自分で 数え直した）★
//     この門は 頭に「足すだけ以外は絶対に通さない」＝★白名簿★と 書いて あるのに、
//     中身は ★「この語が 出たら 止める」の 黒名簿★ だった。
//     ・対立役の 攻撃 SQL 60本中 ★42本が 通った★
//     ・私が その中の 23本を 選んで 自分で 当て直したら ★21本が 通った★
//     黒名簿に 札を 足しても、相手は 毎回 新しい 語を 持ってくる。終わらない。
//
//   ★一番 悪かった 2つ＝門が「盲目」に なる（他の 札が 全部 無効に なる）★
//     ① ドル引用の 中の アポストロフィで 文字列剥がしが ずれ、★1文 まるごと 消えた★
//          入れた字   create table daikome.dk_note (a text default $q$it's$q$);
//                     update daikou.meisai set amount = 0;      ← ★これ★
//                     comment on table daikome.dk_note is 'ok';
//          門が見た字 create table daikome.dk_note (a text default $q$it''ok';
//        ＝★update が 門から 消えていた★。札を 何枚 足しても 意味が 無い。
//        ⇒ ★ドル引用を 一番 先に 落とす★（タグは $$ だけで なく $なんとか$ も）。
//     ② 引用識別子 "public"."meisai" を `""` に 潰していたので
//        findTargetTables が ★0件★ を 返し、★部屋/棚の壁（この門の 本体）が 丸ごと 外れた★。
//          alter table "public"."meisai" add column hack int;  ← 通っていた
//        ⇒ ★安全な 名前なら 引用を 外して 名前に 戻す★（危ない 字なら _q_ に する）。
//        ＝「道具が返した0件を根拠にするな」に 正面から 当たっていた。
//
//   ★白名簿の 形★
//     ・stripNoise で ドル引用・コメント・文字列・引用識別子 を 落とす
//       （★10-02 から 左から 1字ずつ 読む 1回の 読み★。「順に 剥がす」は 囲いの 中の 印で ずれた）
//     ・`;` で ★1文ずつ★ に 分ける（前は 丸ごと 1本の 字として 見ていた）
//     ・1文ずつ ALLOW の どれかに ★頭から★ 当たらなければ 赤
//     ・当たっても 中身を もう一度 見る（窓の 名前／grant の 相手／RLS の 向き）
//     ・その上で 今までどおり 黒名簿(DANGER)と 部屋/棚の壁も 通す（二重にする）
//
//   ★窓(view)の 決まりは 私の 思い込みでは なく repo の 実績★
//     supabase/*.sql の 窓 ★38本 中 38本が public.dk_◯◯★（例外 0本・機械で 数えた）。
//     ＝「公開する窓は public の 頭 dk_ だけ」。public.meisai の 差し替えは 赤。
//
//   ★残した 穴（なぜ しなかったか）★
//     ・窓の 名前を public に 許すのは ★頭が prefix の 時だけ★ だが、
//       prefix='meisai' の 道具（apply-meisai-sql.mjs）だと public.meisai が
//       名前として 当たってしまう。⇒ ★その道具は madoPublic:false で 呼ぶ★ 事で 塞いだ。
//     ・PG が 本当に その 字を 受けるかは ★倉庫に 当てて 確かめていない＝見立て★。
//       門は「受けるかも しれない 字」を 全部 止める 側に 倒してある。
//     ・★`references 他アプリの棚` は 今まで どおり 通す（壁に 掛けない）★
//       ＝2026-08 に 決めて 試験(★dk_ を参照するだけ…は止めない★)に 書いて 在る 決め。
//       対立役は「他アプリの 行が 消える 道」と 言ったが ★向きが 逆★：
//       `A references B on delete cascade` で 消えるのは ★A（こちら）の 行★ で B では ない。
//       ⇒ 決めを 覆す 根拠に ならない ので ★今日は 変えない★。
//       ただし 別の 効きは 本当に 在る：外部キーは 既定(RESTRICT)で
//       ★相手アプリが 自分の 行を 消せなく なる★。これは 司さんに 別に 報告する。
//     ・`copy (…) to stdout`（読むだけの COPY）は ★白名簿に 入れていない＝赤★。
//       repo の 36本で 使っている 所が 0本 なので、当てる 先を 広げない。
// ============================================================

// ★コメントと 文字列と ドル引用を 消す（regex が 中身に 引っかからないように）★
//   09-29 は ★順番が 命★ と して ドル引用 → コメント → 文字列 → 引用識別子 の 順に 剥がした
//   （その前は 文字列が 先で、ドル引用の 中の ' が 外の ' と 対に なり ★1文 まるごと 食われていた★＝上の ①）。
//
// ★★2026-10-02 作り直し＝「順に 剥がす」を やめて ★左から 1字ずつ 読む 1回の 読み★ に した★★
//   Exally の 席が 字で 読んで 知らせてくれた（ダイコメの 席が 当てて 測った）。
//   ★「どれを 先に 剥がすか」の 順番が 在る 限り、別の 囲いの 中に 印を 書けば ずれる★：
//     comment on table daikome.dk_a is '$x$';     ← 文字列の 中の $x$ を ドル引用と 読み、
//     update daikou.meisai set amount = 0;        ← ★この 1文が 丸ごと 消えて 通った★
//     comment on table daikome.dk_a is '$x$';
//   同じく ★"$x$" の 引用名★・★E'it\'s' の 逃がし★ でも 次の 1文が 消えて 通った（3つとも 実測）。
//   ⇒ PG と 同じく ★先に 出てきた 囲いが 勝つ★ 読み方に した。
//   ★読めない 物（閉じていない 文字列/コメント/ドル引用）は $yomenai$ を 残して 赤★。
//     「読めない字を 通す 門」は 盲目と 同じ。
export function stripNoise(sql) {
  const s = String(sql == null ? '' : sql);
  const YOMENAI = ' $yomenai$ ';
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    const c2 = s[i + 1];
    // 行コメント
    if (c === '-' && c2 === '-') {
      const e = s.indexOf('\n', i);
      i = e < 0 ? n : e;
      out += ' ';
      continue;
    }
    // ブロックコメント（PG は ★入れ子★ を 数える）
    if (c === '/' && c2 === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (s[j] === '/' && s[j + 1] === '*') (depth++, (j += 2));
        else if (s[j] === '*' && s[j + 1] === '/') (depth--, (j += 2));
        else j++;
      }
      if (depth > 0) return out + YOMENAI;
      out += ' ';
      i = j;
      continue;
    }
    // 文字列 '…'（E'…' は \ で 逃がせる）
    if (c === "'") {
      const prev = out.slice(-1);
      const eStr = /[eE]/.test(prev) && !/[A-Za-z0-9_$]/.test(out.slice(-2, -1));
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (eStr && s[j] === '\\') {
          j += 2;
          continue;
        }
        if (s[j] === "'") {
          if (s[j + 1] === "'") {
            j += 2;
            continue;
          }
          closed = true;
          break;
        }
        j++;
      }
      if (!closed) return out + YOMENAI;
      out += "''";
      i = j + 1;
      continue;
    }
    // ★引用識別子は 潰さずに 名前に 戻す★（潰すと 棚の壁が 外れる＝上の ②）
    //   安全な 名前だけ 戻し、空白や 記号入りは _q_（＝どの prefix にも 当たらない）に する
    if (c === '"') {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (s[j] === '"') {
          if (s[j + 1] === '"') {
            j += 2;
            continue;
          }
          closed = true;
          break;
        }
        j++;
      }
      if (!closed) return out + YOMENAI;
      const naka = s.slice(i + 1, j);
      out += /^[A-Za-z_][A-Za-z0-9_$]*$/.test(naka) ? naka : '_q_';
      i = j + 1;
      continue;
    }
    // ドル引用 $$…$$ / $do$…$do$ / $q$…$q$ … ★タグは 何でもよい★
    //   名前の 途中の $（a$b）や $1 は ドル引用では ない（PG と 同じ）
    //   中身は 読めないので $do$ の 印だけ 残す（DANGER の do-block が 拾う）
    if (c === '$' && !/[A-Za-z0-9_$]/.test(out.slice(-1))) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(s.slice(i));
      if (m) {
        const tag = m[0];
        const e = s.indexOf(tag, i + tag.length);
        if (e < 0) return out + YOMENAI;
        out += ' $do$ ';
        i = e + tag.length;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

// ★`;` で 1文ずつ に 分ける★（文字列・コメント・ドル引用は もう 落ちている）
export function splitStatements(sql) {
  return stripNoise(sql)
    .split(';')
    .map((x) => x.trim().replace(/\s+/g, ' '))
    .filter((x) => x.length > 0);
}

const DANGER = [
  {
    name: 'drop',
    re: /\bdrop\s+(table|policy|column|index|schema|view|function|trigger|type|database|role|owned)\b/i,
  },
  { name: 'truncate', re: /\btruncate\b/i },
  { name: 'delete', re: /\bdelete\s+from\b/i },
  // ★2026-09-26 直し★：★別名つきの update を 見逃していた★
  //   update daikome.dk_expense_kinds ★k★ set label = … ← 棚と set の 間に 別名が 入ると
  //   前の形 /update\s+[a-z_][\w.]*\s+set/ は 当たらず ★書き換えが 門を すり抜けた★。
  //   ★試験も 別名なしの 2本しか 無かった★ので 何年も 気付けない 形だった。
  { name: 'update', re: /\bupdate\s+(?:only\s+)?[a-z_"][\w."]*(?:\s+(?:as\s+)?[a-z_]\w*)?\s+set\b/i },
  { name: 'insert', re: /\binsert\s+into\b/i },
  { name: 'revoke', re: /\brevoke\b/i },
  { name: 'alter-drop', re: /\balter\s+table\s+[^;]*\bdrop\b/i },
  { name: 'do-block', re: /\$do\$/ }, // 中身を読めない塊は通さない
  { name: '読めない(閉じていない 囲い)', re: /\$yomenai\$/ }, // stripNoise が 残す 印
  // ★★2026-09-29 追加＝対立役に 叩かれて 見つけた「今 開いていた 穴」★★
  //   ★`select 1;` を 1行 足すだけで 通っていた★。どれも「足すだけ」では ない。
  //   ※ 札は 白名簿の ★裏打ち★。札だけでは 抜けられる（recursive view 等）ので
  //     ★止めているのは 白名簿の 方★ だと 思って 読む事。
  { name: 'merge', re: /\bmerge\s+into\b/i }, // when matched then update/delete が 書ける
  { name: 'trigger', re: /\bcreate\s+(or\s+replace\s+)?(constraint\s+)?trigger\b/i },
  { name: 'rule', re: /\bcreate\s+(or\s+replace\s+)?rule\b/i }, // do instead で すり替える
  { name: 'function', re: /\bcreate\s+(or\s+replace\s+)?(function|procedure)\b/i }, // 中身を 読めない
  {
    name: 'security',
    re: /\b(alter\s+(default\s+)?privileges|set\s+(local\s+)?role|security\s+definer|create\s+role|alter\s+role)\b/i,
  },
  // ★COPY は 「流し込む(from)」だけ 止める。`copy (…) to stdout` は 読むだけ なので 通す★
  //   前の形 /copy[\s\S]{0,80}?from/ は ①列を 20個 並べると 外れ ②副問い合わせの from を 掴んで
  //   ★読むだけの COPY…TO を 偽の赤に していた★（両方 実測 2026-09-29）。
  { name: 'copy-from', re: /\bcopy\b(?![\s\S]*?\bto\s+stdout\b)[\s\S]*?\bfrom\b/i },
];

// 危ない書き方が入っていないか
export function findDangerous(sql) {
  const s = stripNoise(sql);
  const hits = [];
  for (const d of DANGER) {
    const m = s.match(d.re);
    if (m) hits.push({ kind: d.name, at: m[0].replace(/\s+/g, ' ').trim() });
  }
  return hits;
}

// このSQLが作り変える棚の名前をぜんぶ拾う
//   ★窓(view)の 名前は ここに 入れない★。窓は public.dk_◯◯ が 正しい 置き場 なので
//   ここの 壁（部屋は room だけ）に 掛けると ★repo の 38本 全部が 偽の赤★ に なる。
//   窓は 下の madoWoMiru() で 別に 見る。
export function findTargetTables(sql) {
  const s = stripNoise(sql);
  const out = new Set();
  const pats = [
    /\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?((?:[a-z_][\w]*\.)?[a-z_][\w]*)/gi,
    /\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?((?:[a-z_][\w]*\.)?[a-z_][\w]*)/gi,
    /\balter\s+sequence\s+(?:if\s+exists\s+)?((?:[a-z_][\w]*\.)?[a-z_][\w]*)/gi,
    /\bcreate\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?[\w]+\s+on\s+((?:[a-z_][\w]*\.)?[a-z_][\w]*)/gi,
    /\bcreate\s+policy\s+[\w]+\s+on\s+((?:[a-z_][\w]*\.)?[a-z_][\w]*)/gi,
    /\bcomment\s+on\s+column\s+((?:[a-z_][\w]*\.)?[a-z_][\w]*)\./gi,
    /\bcomment\s+on\s+table\s+((?:[a-z_][\w]*\.)?[a-z_][\w]*)/gi,
    // 鍵を 配る 相手の 棚／止める 棚
    /\bgrant\b[\s\S]*?\bon\s+(?:table\s+)?((?:[a-z_][\w]*\.)?[a-z_][\w]*)/gi,
    /\block\s+(?:table\s+)?((?:[a-z_][\w]*\.)?[a-z_][\w]*)/gi,
    /\bcluster\s+((?:[a-z_][\w]*\.)?[a-z_][\w]*)\s+using\b/gi,
  ];
  for (const re of pats) {
    let m;
    while ((m = re.exec(s)) !== null) out.add(m[1].toLowerCase());
  }
  // ★grant execute on function … は 棚では ない（関数）★ ので 棚の壁からは 外す
  out.delete('function');
  return Array.from(out).sort();
}

// ★窓(view)の 名前を 拾う★（create view / alter view / refresh materialized view）
export function madoNoNamae(bun) {
  const m = String(bun).match(
    /\b(?:create\s+(?:or\s+replace\s+)?(?:temp\w*\s+)?(?:recursive\s+)?(?:materialized\s+)?view|alter\s+(?:materialized\s+)?view|refresh\s+materialized\s+view(?:\s+concurrently)?)\s+(?:if\s+exists\s+)?((?:[a-z_][\w]*\.)?[a-z_][\w]*)/i
  );
  return m ? m[1].toLowerCase() : null;
}

function mijikaku(s) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > 70 ? t.slice(0, 70) + '…' : t;
}

// 名前が 「触ってよい 置き場」か
function tanaGaYoiKa(name, o) {
  const p = String(name).split('.');
  if (p.length === 2) {
    if (p[0] !== o.room)
      return (
        '他アプリの部屋に触ろうとしている: ' + name + '（この repo が触ってよいのは ' + o.room + ' だけ）'
      );
    if (p[1].indexOf(o.prefix) !== 0) return '他アプリの棚に触ろうとしている: ' + name;
    return null;
  }
  if (p[0].indexOf(o.prefix) !== 0) return '他アプリの棚に触ろうとしている: ' + name;
  return null;
}

// ★窓の 置き場を 見る★ repo の 実績＝38/38 が public.dk_◯◯
function madoWoMiru(bun, o) {
  const na = madoNoNamae(bun);
  if (!na) return '窓の 名前が 読み取れない';
  const p = na.split('.');
  if (p.length === 2 && p[0] === 'public') {
    if (!o.madoPublic) return '窓を public に 置こうとしている（この道具では 許していない）: ' + na;
    return p[1].indexOf(o.prefix) === 0
      ? null
      : '窓の 名前が ' +
          o.prefix +
          ' で 始まっていない（public に 置けるのは ' +
          o.prefix +
          '◯◯ だけ）: ' +
          na;
  }
  return tanaGaYoiKa(na, o);
}

// ★「誰が 開けるか」が 変わる 行を 見る★
//   司さんの 決まり：★「誰が開けるか」が 変わる 事は 先に 訊く★
//
//   ★ここは 1度 言い過ぎた。測って 直した（2026-09-29）★
//     はじめは 「`to anon` で 書き換えを 渡すのは 全部 赤」に した。
//     だが 本番を 読んだら その 6棚は ★RLS が 6/6 入・決まりも 1～4本 在る★。
//     ＝`grant … to anon` は Supabase の 普通の 形 で、★それ単体では 開いていない★。
//     本当の 門は RLS の 決まりの 方。丸ごと 赤に するのは ★偽の赤★だった。
//   ⇒ 今の 決まり：★anon に 書き換えを 渡すなら、同じ 紙の 中で
//      その 棚の RLS を 入れ、決まり(policy)も 作っている 事★。無ければ 赤。
//      （repo の 2本は どちらも 同じ 紙で RLS+policy を 入れている＝偽の赤 0本）
function dareNiHiraku(bun, o) {
  const aite = /\bto\s+([a-z_, ]+)/i.exec(bun);
  const dare = aite ? aite[1].toLowerCase() : '';
  if (!/\b(anon|public)\b/.test(dare)) return null;

  if (/^grant\s/i.test(bun)) {
    const onIdx = bun.toLowerCase().indexOf(' on ');
    const kengen = (onIdx > 0 ? bun.slice(5, onIdx) : bun.slice(5)).toLowerCase();
    if (!/\b(insert|update|delete|truncate|all)\b/.test(kengen)) return null; // 読むだけは 通す
    const na = /\bon\s+(?:table\s+)?((?:[a-z_][\w]*\.)?[a-z_][\w]*)/i.exec(bun);
    const tan = na ? na[1].toLowerCase().split('.').pop() : '';
    if (tan && o.mamotteru && o.mamotteru.has(tan)) return null; // 同じ紙で RLS+決まりを 入れている
    return (
      '★anon(誰でも)に 書き換えの 鍵を 渡すのに、同じ 紙で ' +
      (tan || 'その棚') +
      ' の 行の守り(RLS)と 決まり(policy)を 入れていない★（先に 司さんに 訊く）'
    );
  }
  // create policy … for all to anon using (true) … ★誤頃な 決まりは 止める★
  if (/\bfor\s+(all|insert|update|delete)\b/i.test(bun) && /\busing\s*\(\s*true\s*\)/i.test(bun))
    return '★anon(誰でも)に using(true) で 書き換えを 許す 守り(policy)★（先に 司さんに 訊く）';
  return null;
}

// ★同じ 紙の 中で RLS を 入れて 決まりも 作っている 棚の 名簿★
function mamotteruTana(sql) {
  const s = stripNoise(sql);
  const rls = new Set();
  let m;
  const r1 = /\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?((?:[a-z_][\w]*\.)?[a-z_][\w]*)\s+enable\s+row\s+level\s+security/gi;
  while ((m = r1.exec(s)) !== null) rls.add(m[1].toLowerCase().split('.').pop());
  const pol = new Set();
  const r2 = /\bcreate\s+policy\s+[\w]+\s+on\s+((?:[a-z_][\w]*\.)?[a-z_][\w]*)/gi;
  while ((m = r2.exec(s)) !== null) pol.add(m[1].toLowerCase().split('.').pop());
  const out = new Set();
  rls.forEach((x) => {
    if (pol.has(x)) out.add(x);
  });
  return out;
}

// ★★白名簿＝ここに 在る 形だけ 通す★★
//   `re` は ★文の 頭から★ 当てる。`mi` が 在れば 中身を もう一度 見る。
const ALLOW = [
  {
    name: '読むだけ(select)',
    re: /^(with\s|select\s|table\s|show\s|explain\s)/i,
    // select … into 棚 は ★他アプリの 実データを 丸ごと 複製できる★ ので 赤
    mi: (b) =>
      /\binto\b/i.test(b) ? '読むだけの select に into が 入っている（棚が 作られる）' : null,
  },
  {
    name: '棚を 足す',
    // ★`(` を 必ず 要る事に する★＝`create table x as select …` を 許さない
    re: /^create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?[\w.]+\s*\(/i,
  },
  {
    name: '索引を 張る',
    re: /^create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?[\w]+\s+on\s+/i,
  },
  {
    name: '列/決まりを 足す・RLS を 入れる',
    re: /^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?[\w.]+\s+(?:add\s+column|add\s+constraint|enable\s+row\s+level\s+security|force\s+row\s+level\s+security|alter\s+column\s+[\w]+\s+set\s+default|owner\s+to)\b/i,
    // ★RLS を 切る 向きは 赤★（disable / no force）
    mi: (b) =>
      /\b(disable\s+row\s+level\s+security|no\s+force\s+row\s+level\s+security)\b/i.test(b)
        ? '行の守り(RLS)を 切ろうとしている'
        : null,
  },
  { name: '守り(policy)を 作る', re: /^create\s+policy\s+/i, mi: (b, o) => dareNiHiraku(b, o) },
  { name: '覚書(comment)', re: /^comment\s+on\s+/i },
  {
    name: '窓(view)を 配る',
    re: /^create\s+(?:or\s+replace\s+)?(?:temp\w*\s+)?(?:recursive\s+)?(?:materialized\s+)?view\s+/i,
    mi: (b, o) => madoWoMiru(b, o),
  },
  {
    name: '窓の 決まりを 直す',
    // repo の 定型は `alter view public.dk_◯◯ set (security_invoker = true)` が 24箇所
    re: /^alter\s+(?:materialized\s+)?view\s+[\w.]+\s+(?:set|owner\s+to)\b/i,
    mi: (b, o) =>
      /security_invoker\s*=\s*(?:false|off|0)/i.test(b)
        ? '窓を「作った人の権限で動く」に 戻そうとしている（security_invoker=false）'
        : madoWoMiru(b, o),
  },
  { name: '鍵を 配る(grant)', re: /^grant\s+/i, mi: (b, o) => dareNiHiraku(b, o) },
];

// ★門★ 通すか止めるか
export function guard(sql, opts) {
  const prefix = (opts && opts.prefix) || 'dk_';
  // ★ダイコメの部屋(schema)★。部屋つきの名前は この部屋の物だけ通す。
  const room = (opts && opts.room) || 'daikome';
  // 窓を public.<prefix>◯◯ に 置く事を 許すか（既定は 許す＝apply-supabase-sql.mjs の 実績 38本）
  const madoPublic = !(opts && opts.madoPublic === false);
  // 同じ 紙の 中で RLS+決まりを 入れている 棚（grant の 判断に 使う）
  const o = { prefix, room, madoPublic, mamotteru: mamotteruTana(sql) };
  const reasons = [];

  // ── ① 黒名簿（裏打ち） ──
  const danger = findDangerous(sql);
  for (const d of danger)
    reasons.push('消す/書き換える書き方が入っている: ' + d.kind + ' → ' + d.at);

  // ── ② ★白名簿＝1文ずつ★（ここが 本体） ──
  const bunList = splitStatements(sql);
  if (!bunList.length) reasons.push('何をする物か読み取れない（中身が 空）');
  for (const bun of bunList) {
    const a = ALLOW.find((x) => x.re.test(bun));
    if (!a) {
      reasons.push('★許した形に 無い文★: ' + mijikaku(bun));
      continue;
    }
    const ng = a.mi ? a.mi(bun, o) : null;
    if (ng) reasons.push(ng + ' → ' + mijikaku(bun));
  }

  // ── ③ 部屋/棚の壁 ──
  // ★2026-08-25 直し★：棚の名前に ★部屋(schema)が付いている書き方★ を読めていなかった。
  //   daikome.dk_payroll_settings を「daikome という棚」と読んで、
  //   ★自分の棚なのに「他アプリの棚」と言って止めていた★（司さんの作業が1回 止まった）。
  //   通す … daikome.dk_◯◯ ／ dk_◯◯　止める … 他の部屋 ／ dk_ で始まらない棚
  const tables = findTargetTables(sql);
  for (const t of tables) {
    const ng = tanaGaYoiKa(t, o);
    if (ng) reasons.push(ng);
  }

  return { ok: reasons.length === 0, reasons, tables, danger };
}
