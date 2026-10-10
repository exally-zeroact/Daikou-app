// ============================================================
// scripts/gate-run-report.mjs
// ★認定ゲートが「本当に全部走ったか」を実物のCIから出す★ 2026-08-03（2026-10-10 作り直し）
//
//   ★なぜ作ったか★
//     前回の事故は「★走ってすらいなかった★」。1ジョブに詰め込んでいて20分で打ち切られ、
//     gate-spread / cert-3env / tunnel / bg-freeze / gnss-degraded は実行にすら至っていなかった。
//     しかも cancelled は緑でも赤でもないので、GitHubの画面を見ても気づけない。
//     ＝★「success だった」だけでは、守れている証拠にならない★。
//
//   だから「どのゲートが実行され、どれが skip / cancelled か」を1本ずつ出す。
//   ★1本でも走っていなければ 終了コード1★（skip も cancelled も緑扱いしない）。
//
//   ★2026-10-10 作り直し（Exally の席から渡された候補を 実物で数えて 当たった物）★
//     ① 前は「最新の1回」だけを読んでいた＝★別の commit の回でも 緑と言えた★
//        → ★sha を必ず指す★。その sha の cert-gate の回を ★全部★ 見る（1回も無ければ 赤）。
//     ② 前は 期待の11本を コードに決め打ち＝matrix は 23本に増えていて ★12本を見ていなかった★
//        → ★その sha の cert-gate.yml から 名簿を取る★（git show で 読む）。
//     ③ 前は argv[1] の 名前の終わりで 起動を決めた＝別名で呼ぶと ★何も出さず exit 0★
//        → 本物の場所（realpath）で比べる・★既定は exit 1、緑の1か所でだけ 0★。
//     ④ 前は includes(gate) の 部分一致＝★bg-freeze-nagaana が bg-freeze に当たった★
//        → ジョブ名は ★完全一致★。ログの行も「ジョブ名＋タブ」で 始まる物だけ。
//
//     ⑤ 対立役（10-10）の指摘で 足した物：名簿に無いジョブは赤・総合結果が success でなければ赤・
//        ゲートの手順（手順名＝ゲート名）が走っていなければ赤・再実行の前の attempt も全部見る・
//        どの倉庫の回を読んだかを出す・yml の項目が読めなければ 黙って落とさず 止める。
//     ★残っている形★ 別の道具から import して呼ぶと 何も走らず exit 0（呼ぶ物は今0本）。
//        包んで呼ぶ日が来たら、その道具の側で 終了コードを 見ること。
//
//   使い方:
//     node scripts/gate-run-report.mjs --sha <commit>
//     node scripts/gate-run-report.mjs --sha <commit> --repo exally-zeroact/Daikou-app
//
//   gh CLI と git を使う（読むだけ・何も直さない）。
// ============================================================
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 走ったと認めてよい結末（★skipped と cancelled は認めない★）
const RAN = new Set(['success', 'failure']);

// cert-gate.yml の jobs.gate.strategy.matrix.include から ゲートの名簿を取る。
//   返り値: [{ name, soft }]（name はジョブの表示名＝${{ matrix.name }} と同じ字）
export function gatesFromYml(yml) {
  const lines = String(yml).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let inJobs = false;
  let inGate = false;
  let inInclude = false;
  let itemIndent = -1;
  for (const line of lines) {
    if (/^\s*(#|$)/.test(line)) continue;
    if (/^\S/.test(line)) {
      inJobs = /^jobs:\s*$/.test(line);
      inGate = false;
      inInclude = false;
      continue;
    }
    if (!inJobs) continue;
    if (/^ {2}\S/.test(line)) {
      inGate = /^ {2}gate:\s*$/.test(line);
      inInclude = false;
      continue;
    }
    if (!inGate) continue;
    if (/^\s+include:\s*$/.test(line)) {
      inInclude = true;
      itemIndent = -1;
      continue;
    }
    if (!inInclude) continue;
    const ind = line.match(/^ */)[0].length;
    const isItem = /^ *-(\s|$)/.test(line);
    if (isItem && itemIndent < 0) itemIndent = ind;
    if (isItem && ind === itemIndent) {
      // ★項目の最初の鍵は name に限る★。違う形は 黙って落とさず 止める
      //   （前は 落とした上に soft を1つ前の項目へ付けていた）
      const item = line.match(/^ *-\s+name:\s*(.*)$/);
      const name = item ? unquote(item[1].replace(/\s+#.*$/, '').trim()) : '';
      if (!name) throw new Error(`cert-gate.yml の matrix の項目が読めません: ${line.trim()}`);
      out.push({ name, soft: false });
      continue;
    }
    if (itemIndent >= 0 && ind <= itemIndent) {
      inInclude = false;
      continue;
    }
    const soft = line.match(/^\s+soft:\s*(\S+)/);
    if (soft && out.length) out[out.length - 1].soft = /^["']?true["']?$/i.test(soft[1]);
  }
  return out;
}

function unquote(v) {
  const m = v.match(/^(["'])(.*)\1$/);
  return m ? m[2] : v;
}

// 総合結果のジョブ（cert-gate.yml の cert-gate-result）の表示名
export const RESULT_JOB = 'cert-gate 総合結果';

// ログ（gh run view --log）から そのジョブが exit 1以上で落ちたかを見る。
//   行の形は「ジョブ名<TAB>手順名<TAB>時刻 字」。★ジョブ名は完全一致★（部分一致で 別のジョブを拾わない）
export function failedFromLog(log, gate) {
  if (!log) return null; // ログが無い＝判定できない（緑扱いしない）
  const head = gate + '\t';
  const mine = String(log)
    .split('\n')
    .filter((l) => l.startsWith(head));
  if (!mine.length) return null; // そのジョブの行が1行も無い＝分からない
  return mine.some((l) => /##\[error\]Process completed with exit code [1-9]/.test(l));
}

// expected は [{ name, soft }]
export function judge(jobs, expected, log = null) {
  const byName = new Map();
  for (const j of jobs) {
    const n = j.name || '';
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push(j);
  }
  const rows = expected.map(({ name, soft }) => {
    const js = byName.get(name) || [];
    const j = js.length === 1 ? js[0] : null;
    // ★ジョブが走っただけでなく、ゲートの手順（手順名＝ゲート名）が走ったか★
    //   （手順が skipped でも、ログに error の行が出ないので「通った」に見える）
    const step = j && Array.isArray(j.steps) ? j.steps.filter((s) => s.name === name) : [];
    const stepRan = step.length === 1 && RAN.has(step[0].conclusion);
    const ran = !!j && RAN.has(j.conclusion) && stepRan;
    let conclusion = '（ジョブが無い）';
    if (js.length > 1) conclusion = `（同じ名前のジョブが${js.length}本）`;
    else if (j && RAN.has(j.conclusion) && !stepRan) conclusion = '（ゲートの手順が走っていない）';
    else if (j) conclusion = j.conclusion || j.status;
    return {
      gate: name,
      soft: !!soft,
      conclusion,
      ran,
      // true=落ちた / false=通った / null=ログが無くて分からない
      failed: ran ? failedFromLog(log, name) : null,
    };
  });
  // ★名簿に無いジョブは 赤★（組を足した・名簿の読みが割れた日に 黙って緑にしない）
  const known = new Set(expected.map((g) => g.name));
  const extra = jobs.filter((j) => !known.has(j.name) && j.name !== RESULT_JOB);
  // ★総合結果が success でなければ 赤★（hard の取りこぼしを 別の道で照らす）
  const results = byName.get(RESULT_JOB) || [];
  const resultOk = results.length === 1 && results[0].conclusion === 'success';
  return {
    rows,
    extra,
    resultOk,
    resultConclusion:
      results.length === 1 ? results[0].conclusion || results[0].status : `（${results.length}本）`,
    notRun: rows.filter((r) => !r.ran),
    // conclusion が failure の物（hard の赤）と、soft で success に見えている赤の両方
    failed: rows.filter((r) => r.ran && (r.conclusion === 'failure' || r.failed === true)),
    unknown: rows.filter((r) => r.ran && r.conclusion !== 'failure' && r.failed === null),
  };
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

export function isMainModule(argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(argv1);
  } catch (_) {
    return false;
  }
}

// 1回の attempt を読んで、赤なら true を返す（runGh は 試験で 差し替える口）
export function judgeAttempt(runId, at, attempts, repoArgs, expected, runGh = gh) {
  const view = ['run', 'view', String(runId), ...repoArgs, '--attempt', String(at)];
  if (attempts > 1) console.log(`  ・attempt ${at}/${attempts}`);
  const jobs = JSON.parse(runGh([...view, '--json', 'jobs'])).jobs || [];
  // ★ログまで見る★ 結末だけだと soft(continue-on-error) の失敗が success に見える
  let log = null;
  try {
    log = runGh([...view, '--log']);
  } catch (_) {
    /* ログが取れない時は「分からない」として緑にしない */
  }
  const { rows, extra, resultOk, resultConclusion, notRun, failed, unknown } = judge(
    jobs,
    expected,
    log
  );
  for (const r of rows) {
    let mark = '通った';
    if (!r.ran) mark = '★走っていない★';
    else if (r.conclusion === 'failure' || r.failed === true)
      mark = r.soft ? '★落ちた（soft＝success に見えている）★' : '★落ちた★';
    else if (r.failed === null) mark = '（通ったか不明）';
    console.log(`  ${r.gate.padEnd(24)} ${String(r.conclusion).padEnd(10)} ${mark}`);
  }
  console.log(
    `  ジョブ総数 ${jobs.length} / 名簿 ${expected.length} / 走った ${rows.filter((r) => r.ran).length} / 落ちた ${failed.length} / 不明 ${unknown.length} / 名簿に無い ${extra.length} / 総合結果 ${resultConclusion}`
  );
  let bad = false;
  if (notRun.length) {
    console.error(
      `  ★${notRun.length}本 走っていません★ ` +
        notRun.map((r) => `${r.gate}(${r.conclusion})`).join(' / ')
    );
    bad = true;
  }
  if (failed.length) {
    console.error(
      `  ★${failed.length}本 落ちています★ ` +
        failed.map((r) => r.gate + (r.soft ? '(soft)' : '')).join(' / ')
    );
    bad = true;
  }
  if (unknown.length) {
    console.error(`  ★${unknown.length}本 通ったか分かりません★（ログが取れなかった）`);
    bad = true;
  }
  if (extra.length) {
    console.error(
      `  ★名簿に無いジョブ ${extra.length}本★（名簿の読みか 組の分け方が変わった）: ` +
        extra.map((j) => `${j.name}(${j.conclusion || j.status})`).join(' / ')
    );
    bad = true;
  }
  if (!resultOk) {
    console.error(`  ★総合結果が success ではありません★（${resultConclusion}）`);
    bad = true;
  }
  return bad;
}

// ★再実行の前の回も 全部 見る★（attempt 1 の赤を attempt 2 の緑で 隠さない）。1つでも赤なら true
export function judgeAllAttempts(run, repoArgs, expected, runGh = gh) {
  const attempts = Math.max(1, Number(run.attempt) || 1);
  let bad = false;
  for (let at = 1; at <= attempts; at++) {
    if (judgeAttempt(run.databaseId, at, attempts, repoArgs, expected, runGh)) bad = true;
  }
  return bad;
}

function main() {
  const argv = process.argv.slice(2);
  const at = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : null;
  };
  const sha = at('--sha');
  if (!sha || !/^[0-9a-f]{7,40}$/i.test(sha)) {
    console.error('使い方: node scripts/gate-run-report.mjs --sha <commit> [--repo owner/name]');
    console.error(
      '★sha を指さない「最新の1回」は 読まない★（別の commit の回で 緑と言えてしまう）'
    );
    return;
  }
  const repo = at('--repo');
  const repoArgs = repo ? ['--repo', repo] : [];

  // 40桁に（短い sha のまま 照らすと 別の物に当たる）
  const full = execFileSync('git', ['rev-parse', '--verify', `${sha}^{commit}`], {
    encoding: 'utf8',
  }).trim();
  const expected = gatesFromYml(
    execFileSync('git', ['show', `${full}:.github/workflows/cert-gate.yml`], { encoding: 'utf8' })
  );
  // ★どの倉庫の回を読んだかを 必ず出す★（--repo を付け忘れると origin の倉庫を読む）
  const repoName = JSON.parse(
    gh(['repo', 'view', ...(repo ? [repo] : []), '--json', 'nameWithOwner'])
  ).nameWithOwner;
  console.log(`倉庫 ${repoName}`);
  console.log(`commit ${full}`);
  console.log(
    `その commit の cert-gate.yml のゲート ${expected.length}本（soft ${expected.filter((g) => g.soft).length}本）`
  );
  if (!expected.length) {
    console.error('★cert-gate.yml から ゲートが1本も読めません★');
    return;
  }

  const runs = JSON.parse(
    gh([
      'run',
      'list',
      ...repoArgs,
      '--workflow',
      'cert-gate.yml',
      '--commit',
      full,
      '--limit',
      '100',
      '--json',
      'databaseId,attempt,event,status,conclusion,headSha,createdAt',
    ])
  ).filter((r) => r.headSha === full);
  console.log(`その commit の cert-gate の回 ${runs.length}回`);
  if (!runs.length) {
    console.error(
      '★その commit で cert-gate が1回も走っていません★（走らなかった回は 守れている証拠ではない）'
    );
    return;
  }

  let bad = false;
  for (const run of runs) {
    console.log(
      `\n── run ${run.databaseId}（attempt ${run.attempt}・${run.event}・${run.status}/${run.conclusion || '-'}・${run.createdAt}）`
    );
    if (run.status !== 'completed') {
      console.error('  ★まだ終わっていません★');
      bad = true;
      continue;
    }
    if (judgeAllAttempts(run, repoArgs, expected)) bad = true;
  }
  if (!bad) {
    console.log(`\n${runs.length}回とも ${expected.length}本すべて走って、すべて通りました。`);
    process.exitCode = 0;
  }
}

if (isMainModule()) {
  // ★既定は 赤★。緑の1か所でだけ 0 にする（途中で 抜けても 0 にならない）
  process.exitCode = 1;
  main();
}
