// ============================================================
// scripts/gate-run-report.mjs
// ★認定ゲートが「本当に11本走ったか」を実物のCIから出す★ 2026-08-03
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
//   使い方:
//     node scripts/gate-run-report.mjs                 … 自分のrepoの最新run
//     node scripts/gate-run-report.mjs --repo exally-zeroact/Daikou-app
//     node scripts/gate-run-report.mjs --run 123456789
//
//   gh CLI を使う（読むだけ・何も直さない）。
// ============================================================
import { execSync } from 'node:child_process';

// この11本が並んでいるはず（cert-gate.yml の matrix と同じ）
export const EXPECTED_GATES = [
  'snap-accuracy',
  'sim-cert',
  'truedist-kp',
  'obd-engine',
  'obd-quant',
  'doppler-rejection',
  'cert-3env',
  'device-spread',
  'tunnel-continuity',
  'bg-freeze',
  'gnss-degraded',
];

// 走ったと認めてよい結末（★skipped と cancelled は認めない★）
const RAN = new Set(['success', 'failure']);

// ★2026-08-03 自分の道具が甘かったので直した★
//   最初の版は「走ったか」しか見ていなかった。
//   ところが cert-gate は4本を soft(continue-on-error) にしている。
//   ★continue-on-error は、落ちても GitHub の API 上 success に見せる★。
//   そのせいで「11本すべて走りました／終了コード0」と報告してしまい、
//   実際には4本落ちていた（device-spread / tunnel-continuity / bg-freeze / gnss-degraded）。
//   ＝★success だけで満足しない、の一段深い版★。
//   なので結末ではなく ★ログの ##[error] Process completed with exit code★ を見る。
export function failedFromLog(log, gate) {
  if (!log) return null; // ログが無い＝判定できない（緑扱いしない）
  const lines = String(log).split('\n');
  const mine = lines.filter((l) => l.includes(gate));
  return mine.some((l) => /##\[error\]Process completed with exit code [1-9]/.test(l));
}

export function judge(jobs, expected = EXPECTED_GATES, log = null) {
  const byName = new Map();
  for (const j of jobs) {
    // matrix ジョブの表示名から ゲート名を拾う
    const hit = expected.find((g) => (j.name || '').includes(g));
    if (hit) byName.set(hit, j);
  }
  const rows = expected.map((g) => {
    const j = byName.get(g);
    const ran = !!j && RAN.has(j.conclusion);
    const softFail = ran ? failedFromLog(log, g) : null;
    return {
      gate: g,
      conclusion: j ? j.conclusion || j.status : '（ジョブが無い）',
      ran,
      // true=落ちた / false=通った / null=ログが無くて分からない
      failed: softFail,
    };
  });
  return {
    rows,
    notRun: rows.filter((r) => !r.ran),
    // ★softで隠れて落ちている物★
    hiddenFail: rows.filter((r) => r.ran && r.failed === true),
    unknown: rows.filter((r) => r.ran && r.failed === null),
  };
}

function gh(args) {
  return execSync('gh ' + args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

const isMain =
  process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('gate-run-report.mjs');
if (isMain) {
  const argv = process.argv.slice(2);
  const at = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : null;
  };
  const repo = at('--repo');
  const repoArg = repo ? ` --repo ${repo}` : '';

  let runId = at('--run');
  if (!runId) {
    const list = JSON.parse(
      gh(`run list${repoArg} --workflow cert-gate.yml --limit 1 --json databaseId,conclusion,status,createdAt`)
    );
    if (!list.length) {
      console.error('cert-gate の実行が1回もありません。');
      process.exitCode = 1;
    } else {
      runId = String(list[0].databaseId);
      console.log(`最新run: ${runId}  （${list[0].conclusion || list[0].status}  ${list[0].createdAt}）`);
    }
  }

  if (runId) {
    const jobs = JSON.parse(gh(`run view ${runId}${repoArg} --json jobs`)).jobs || [];
    // ★ログまで見る★ 結末だけだと soft(continue-on-error) の失敗が success に見える
    let log = null;
    try {
      log = gh(`run view ${runId}${repoArg} --log`);
    } catch (_) {
      /* ログが取れない時は「分からない」として緑にしない */
    }
    const { rows, notRun, hiddenFail, unknown } = judge(jobs, EXPECTED_GATES, log);

    console.log('\n★ゲート1本ずつ★');
    for (const r of rows) {
      const mark = !r.ran
        ? '★走っていない★'
        : r.failed === true
          ? '★走ったが落ちた★'
          : r.failed === null
            ? '（通ったか不明）'
            : '通った';
      console.log(`  ${r.gate.padEnd(20)} ${String(r.conclusion).padEnd(12)} ${mark}`);
    }

    console.log(`\nジョブ総数 ${jobs.length} / 走った ${rows.filter((r) => r.ran).length}本`);

    let bad = false;
    if (notRun.length) {
      console.error(
        `\n★${notRun.length}本 走っていません★ ` +
          notRun.map((r) => `${r.gate}(${r.conclusion})`).join(' / ')
      );
      console.error('★skipped / cancelled は「守れている」ではありません★');
      bad = true;
    }
    if (hiddenFail.length) {
      console.error(
        `\n★${hiddenFail.length}本 落ちています（soft指定で success に見えている）★ ` +
          hiddenFail.map((r) => r.gate).join(' / ')
      );
      console.error(
        '★continue-on-error は「落ちても success に見せる」だけで、通ったわけではありません★'
      );
      bad = true;
    }
    if (unknown.length) {
      console.error(`\n★${unknown.length}本 通ったか分かりません★（ログが取れなかった）`);
      bad = true;
    }
    if (!bad) console.log('\n11本すべて走って、すべて通りました。');
    process.exitCode = bad ? 1 : 0;
  }
}
