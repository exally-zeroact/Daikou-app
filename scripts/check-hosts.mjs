// ============================================================
// scripts/check-hosts.mjs
// ★4ホストの実物を叩いて、表(scripts/dk-hosts.mjs)どおりかを見る★ 2026-08-02
//
//   dk-hosts-pairing.test.js は「表が矛盾していないか」しか見ない（ネットに出ない）。
//   ★表が正しくても、実際に配信されている中身が違えば意味がない★ ので、ここで実物を見る。
//
//   ★目が足りていなかった (2026-08-02 22:00 指示役の指摘)★
//     事務所ホストの `/` しか見ていなかったので、
//     ★事務所の4画面(売上表・給料・月次集計)が全部404でも通していた★。
//     実際にその状態が10分ほど起きた:
//       事務所は「メーターの /office/… 」を見に行く作りだが、その入口は
//       メーター側のデプロイが vercel.json の _comment で落ちていて★まだ無かった★。
//       事務所は上流の404をそのまま返していた(X-Vercel-Error: NOT_FOUND が透過)。
//     → ★開けるべき画面が全部開けること★を目に足した。
//       この目は tests/unit/check-hosts-eyes.test.js が偽の応答で「赤になること」を固定している。
//
//   見る物（読むだけ・1文字も変えない）:
//     1. / が開くか
//     2. ★事務所の4画面(dashboard/kyuryo/uriage/shukei)が全部 200 か★
//     3. js/dk-config.js の APP_BASE が、そのホストに正しい値か
//        ＝★事務所のQRが「別の側のメーター」を指していないか★（一番こわい取り違え）
//     4. 事務所に sw.js が居ないか（居ると「どのURLもメーターに化ける」事故が戻る）
//     5. 事務所の /index.html でメーター本体が出ないか
//     6. メーターの /dashboard.html が事務所へ 308 で送られているか
//        ★ただし送り先が開けない時は「308を乗せてはいけない」として赤にする★
//
//   ★先頭に #!/usr/bin/env node を書かないこと (2026-08-02)★
//     書くと、この道具を import しているテスト(tests/unit/check-hosts-eyes.test.js)が
//     「SyntaxError: Invalid or unexpected token」で丸ごと落ちる（# を読めない）。
//     しかも落ちるのはテストファイルの方なので、原因がここだと分かりにくい。
//     呼び出しは必ず `node scripts/check-hosts.mjs` なのでシェバンは要らない。
//
//   使い方:
//     node scripts/check-hosts.mjs
//     node scripts/check-hosts.mjs --side prod
//     node scripts/check-hosts.mjs --json
//
//   終了コード: 0=全部一致 / 1=違いあり
// ============================================================
import { HOSTS, sideOf } from './dk-hosts.mjs';

// 事務所で必ず開けなければいけない画面
export const OFFICE_SCREENS = [
  '/',
  '/dashboard.html',
  '/kyuryo.html',
  '/uriage.html',
  '/shukei.html',
];

// ★事務所に絶対に出してはいけない物 (2026-08-02)★
//   指示役の実測で、これが全部200で出ていた（総当たりproxyの素通り）。
//   ★manifest.json が一番効く★:
//     事務所のページが1箇所でも相対参照で読んだ瞬間、
//     iPhoneのホーム画面に「事務所」の顔でメーターが入る。
//   ここは「代表として必ず見る物」。本当の守りは
//   ★通す物だけ通す（office-host/vercel.json に総当たりを置かない）★ 側。
export const MUST_NOT_LEAK = [
  '/index.html',
  '/sw.js',
  '/manifest.json',
  '/fare.html',
  '/settings.html',
  '/history.html',
  '/help.html',
  '/js/meter.js',
  '/js/gps.js',
  '/js/map-matcher.js',
  '/data/coarse-jp.js',
];

// ------------------------------------------------------------
// 実際に叩く部分。テストから差し替えられるように外に出してある。
// ------------------------------------------------------------
export function realProbe() {
  return {
    async head(url) {
      try {
        const res = await fetch(url, { redirect: 'manual' });
        return { status: res.status, location: res.headers.get('location') || null };
      } catch (e) {
        return { status: 0, error: String((e && e.message) || e) };
      }
    },
    async text(url) {
      try {
        const res = await fetch(url);
        if (!res.ok) return { status: res.status, body: null };
        return { status: res.status, body: await res.text() };
      } catch (e) {
        return { status: 0, error: String((e && e.message) || e) };
      }
    },
  };
}

function appBaseOf(body) {
  if (!body) return null;
  const m = body.match(/const\s+APP_BASE\s*=\s*'([^']+)'/);
  return m ? m[1] : null;
}

// ------------------------------------------------------------
// 1ホストぶんの判定。★ここが目の本体★（純粋な判定・ネットは probe 経由）
// ------------------------------------------------------------
export async function checkHost(host, spec, probe, hosts = HOSTS, mustPass = null) {
  const base = 'https://' + host;
  const out = { host, role: spec.role, side: spec.side, codes: {}, ng: [] };

  const root = await probe.head(base + '/');
  out.root = root.status;
  out.codes['/'] = root.status;
  if (root.status !== 200) out.ng.push(`/ が ${root.status}（開かない）`);

  // ★事務所は4画面が全部開けること★
  //   ここが無かったせいで「全部404の事務所」を通していた。
  if (spec.role === 'office') {
    for (const p of OFFICE_SCREENS) {
      if (p === '/') continue;
      const r = await probe.head(base + p);
      out.codes[p] = r.status;
      if (r.status !== 200) {
        out.ng.push(`★事務所の ${p} が ${r.status}（社長が使う画面が開けない）★`);
      }
    }
  }

  const cfg = await probe.text(base + '/js/dk-config.js');
  out.appBase = appBaseOf(cfg.body);
  if (!out.appBase) {
    out.ng.push(`js/dk-config.js から APP_BASE を読めない（HTTP ${cfg.status}）`);
  } else if (out.appBase !== spec.appBase) {
    const other = sideOf(out.appBase.replace('https://', ''));
    out.ng.push(
      `★APP_BASE が違う: 実物=${out.appBase} / 表=${spec.appBase}★` +
        (other && other !== spec.side ? ' ＝★側をまたいでいる。QRが反対側のメーターを指す★' : '')
    );
  }

  const sw = await probe.head(base + '/sw.js');
  out.sw = sw.status;
  out.codes['/sw.js'] = sw.status;
  if (spec.serviceWorker) {
    if (sw.status !== 200) out.ng.push(`メーターなのに sw.js が ${sw.status}（圏外で動かなくなる）`);
  } else if (sw.status === 200) {
    out.ng.push('★事務所に sw.js が居る（どのURLもメーターに化ける事故が戻る）★');
  }

  if (spec.role === 'office') {
    // ★通す物だけ通す＝一覧に無い物が200で出たら赤 (2026-08-02 追加)★
    //
    //   それまでは /sw.js と /index.html だけ名指しで塞いでいた。
    //   実測すると、これが全部200で出ていた:
    //     fare.html / settings.html / history.html / help.html /
    //     ★manifest.json★ / js/meter.js / js/gps.js / data/coarse-jp.js
    //   ＝★新しい画面が増えるたびに塞ぎ忘れる★形（今回の事故そのもの）。
    //
    //   特に manifest.json。事務所のページが1箇所でも相対参照で読んだ瞬間、
    //   ★iPhoneのホーム画面に「事務所」の顔でメーターが入る★。
    for (const p of MUST_NOT_LEAK) {
      const r = await probe.head(base + p);
      out.codes[p] = r.status;
      if (r.status === 200) {
        out.ng.push(
          `★事務所で ${p} が200（メーターの物が事務所の住所で出る）★` +
            (p === '/manifest.json'
              ? ' ＝ホーム画面に「事務所」の顔でメーターが入る'
              : '')
        );
      }
    }
    const top = await probe.text(base + '/');
    if (top.body && !/事務所|売上表|月次集計|ログイン/.test(top.body)) {
      out.ng.push('★事務所のトップが事務所の画面でない（メーターが出ている可能性）★');
    }

    // ★逆向きの確認 (2026-08-02)★
    //   塞ぎすぎて「通すはずの物まで404」になっていないか。
    //   ここが抜けると、画面は開くのに js が1本落ちて★押しても何も起きない★になる。
    //   （通す物の一覧は scripts/office-allow.mjs が HTML から機械で作る）
    if (mustPass && mustPass.length) {
      for (const p of mustPass) {
        if (p === '/') continue;
        const r = await probe.head(base + p);
        out.codes[p] = r.status;
        if (r.status !== 200) {
          out.ng.push(`★事務所で ${p} が ${r.status}（通すはずの物が出ない＝画面が動かない）★`);
        }
      }
    }
  }

  // メーターの /dashboard.html は事務所へ送る
  if (spec.role === 'meter') {
    const dash = await probe.head(base + '/dashboard.html');
    out.dashboard = dash.status;
    out.dashboardTo = dash.location;
    out.codes['/dashboard.html'] = dash.status;
    const office = Object.entries(hosts).find(([, h]) => h.role === 'office' && h.side === spec.side);
    const officeHost = office ? office[0] : null;
    if (dash.status !== 308 && dash.status !== 301) {
      out.ng.push(`/dashboard.html が ${dash.status}（事務所へ送っていない）`);
    } else if (officeHost && !(dash.location || '').includes(officeHost)) {
      out.ng.push(`/dashboard.html の行き先が ${dash.location}（${officeHost} ではない）`);
    } else if (officeHost) {
      // ★送り先が開けないなら、308を乗せてはいけない★
      //   開けない住所へ飛ばすと「今まで開けていた事務所が開けなくなる」。
      const there = await probe.head('https://' + officeHost + '/');
      if (there.status !== 200) {
        out.ng.push(
          `★308の送り先 ${officeHost} が ${there.status}（開けない住所へ飛ばしている）★` +
            ' → 事務所が開けるようになるまで308を外すこと'
        );
      }
    }
  }

  return out;
}

// ------------------------------------------------------------
// ★ログインのメールが、その住所へ戻ってこられるか (2026-08-02 追加)★
//
//   ダイコメのログインは「メールのリンクを踏んで戻ってくる」方式。
//   Supabase は戻り先が許可リストに無いと★弾かずに、既定の戻り先へ黙って飛ばす★。
//   実測すると daikome-jimusho-test の戻り先は
//     https://exally-test.vercel.app/daikou-seikyu.html（請求書アプリ）
//   になっていた。＝★事務所にログインしたつもりが別のアプリに着く★。
//   エラーも出ないので、これは画面を見ても気づけない。だから機械で見る。
//
//   ★メールは1通も送らない★ わざと通らないトークンで verify を叩き、
//   「どこへ返されるか」だけを見る。
// ------------------------------------------------------------
export async function checkLoginReturn(host, authBase, probe) {
  const back = `https://${host}/dashboard.html`;
  const url =
    `${authBase}/auth/v1/verify?token=invalid&type=magiclink&redirect_to=` + encodeURIComponent(back);
  const r = await probe.head(url);
  const to = r.location || '';
  const ok = to.startsWith(`https://${host}/`);
  return {
    host,
    returnsTo: to.split('#')[0] || null,
    ok,
    ng: ok
      ? []
      : [
          `★ログインの戻り先が ${to.split('#')[0] || '(不明)'} ★` +
            ' ＝この住所が許可リストに無い。ログインしたつもりで別のアプリに着く。' +
            ' → node scripts/auth-redirect-allow.mjs --apply',
        ],
  };
}

export async function checkAll(side, probe, hosts = HOSTS, mustPass = null) {
  const targets = Object.entries(hosts).filter(([, s]) => !side || s.side === side);
  const out = [];
  for (const [host, spec] of targets)
    out.push(await checkHost(host, spec, probe, hosts, mustPass));
  return out;
}

// ------------------------------------------------------------
// コマンドとして動かした時だけ実行
// ------------------------------------------------------------
const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('check-hosts.mjs');
if (isMain) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--side');
  const onlySide = i >= 0 ? argv[i + 1] : null;
  const asJson = argv.includes('--json');

  const probe = realProbe();
  // ★通すはずの物の一覧は HTML から機械で作る★（目視で決めない）
  const { buildAllowList } = await import('./office-allow.mjs');
  const { allow } = buildAllowList();
  const results = await checkAll(onlySide, probe, HOSTS, allow);

  // ログインの戻り先（メールは送らない）
  // ★2026-08-22 本番とテストの許可リストを分けた★
  //   ここは前まで ★本番の倉庫だけをベタ書きで見ていた★ ので、
  //   分けた瞬間に テスト側の2ホストが「戻り先が違う」と赤くなった。
  //   ＝ ★見張りの側が間違っていた★（テストのログインは テストの倉庫を通る）。
  //   ⇒ ★そのホストの側(prod/test)に合う倉庫で見る★
  const AUTH_BY_SIDE = {
    prod: 'https://tnfwipbgfgjaymlszeid.supabase.co',
    test: 'https://khawdrnvssdenumbiwfg.supabase.co',
  };
  for (const r of results) {
    const AUTH = AUTH_BY_SIDE[r.side];
    if (!AUTH) {
      r.ng.push(`★このホストの側(${r.side})に合う倉庫が分からない＝見張りが数えられていない★`);
      continue;
    }
    const lr = await checkLoginReturn(r.host, AUTH, probe);
    r.loginReturnsTo = lr.returnsTo;
    r.ng.push(...lr.ng);
  }

  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log('★4ホストの実物を見た結果★');
    for (const r of results) {
      const mark = r.ng.length ? '✗' : '✓';
      const codes = Object.entries(r.codes)
        .map(([p, c]) => `${p}=${c}`)
        .join('  ');
      console.log(
        `\n${mark} ${r.host}  [${r.role}/${r.side}]` +
          `\n    ${codes}` +
          (r.dashboardTo ? `\n    → ${r.dashboardTo}` : '') +
          `\n    APP_BASE=${r.appBase}` +
          `\n    ログインの戻り先=${r.loginReturnsTo || '-'}`
      );
      r.ng.forEach((n) => console.log('    ! ' + n));
    }
  }

  const bad = results.filter((r) => r.ng.length);
  if (bad.length) {
    console.error(`\n★${bad.length}ホストが表と違います★`);
    process.exit(1);
  }
  console.log('\n全ホストが表どおりです。');
}
