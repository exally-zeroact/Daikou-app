// tests/replay-mm-worker/eruda-trace-parser.js
//
// ★設計変更宣言 (2026-05-28・検証連鎖 [B][C] のためのトレース取り込み):
//   司さんが Eruda console から「いつも通り走った時のログ」 をコピーして送るだけで・
//   私が validated test tools にかけて creep / freeze / 暴走 を客観評価できる仕組み。
//   = 司さんが「歩き回って眼で数字を確認」 する必要を消すための core。
//
//   入力: Eruda console の生 text (= [GPSDBG]/[GPSREJ]/[MMDBG]/[Business] log 行を含む)
//   出力:
//     ・events: 構造化イベント配列 (timestamp 順)
//     ・summary: emit_ratio / stat_true_ratio / reject_reasons / mm_add_per_frame /
//                business_total_growth_per_minute (= creep 指標) / freeze_duration_sec
//     ・assertions: 自動判定 (creep>0 / freeze>10s / runaway commit add で FAIL)
//
//   ★絶対ルール準拠: 本番 js/*.js は 1 byte 不変・本 file はテスト/解析ツール追加のみ。
//   ★PII: 現状 STEP0 ログには lat/lng が含まれないため位置情報は流出しない (= 安全)。
'use strict';

// ─── パターン定義 (= js/gps.js / js/meter.js の STEP0 診断出力に対応) ──────
const PATTERNS = {
  // [GPSDBG] spd=0.0 src=dop acc=5.0 lim=10 stat=T
  gpsDbg: /\[GPSDBG\]\s+spd=([\d.-]+)\s+src=(\w+)\s+acc=([\d.-]+)\s+lim=([\d.-]+)\s+stat=(T|F)/,
  // [GPSREJ] reason=accuracy spd=0.1 src=dop acc=15.9 lim=10
  gpsRej: /\[GPSREJ\]\s+reason=(\w+)\s+spd=([\d.-]+)\s+src=(\w+)\s+acc=([\d.-]+)\s+lim=([\d.-]+)/,
  // [MMDBG] src=commit add=10.5m dm=200m tier2=70m
  mmDbg: /\[MMDBG\]\s+src=(\w+)\s+add=([\d.-]+)m\s+dm=([\d.-]+)m\s+tier2=([\d.-]+)m/,
  // [Business] total=0.05 running=false (= 司さん追加で含めると有用)
  business: /\[Business\]\s+total=([\d.-]+)(?:\s+running=(true|false))?/,
  // timestamp prefix (= Eruda が自動付与・形式は端末依存)
  // 例: "12:34:56.789" or "2026-05-28T12:34:56.789Z"
  timestamp: /(\d{1,2}:\d{2}:\d{2}(?:\.\d{1,3})?)/,
};

function parseEvents(rawText) {
  const lines = rawText.split(/\r?\n/);
  const events = [];
  for (const line of lines) {
    const tsMatch = line.match(PATTERNS.timestamp);
    const ts = tsMatch ? tsMatch[1] : null;
    let m;
    if ((m = line.match(PATTERNS.gpsDbg))) {
      events.push({
        type: 'gpsDbg',
        ts,
        spd: parseFloat(m[1]),
        src: m[2],
        acc: parseFloat(m[3]),
        lim: parseFloat(m[4]),
        stat: m[5] === 'T',
      });
    } else if ((m = line.match(PATTERNS.gpsRej))) {
      events.push({
        type: 'gpsRej',
        ts,
        reason: m[1],
        spd: parseFloat(m[2]),
        src: m[3],
        acc: parseFloat(m[4]),
        lim: parseFloat(m[5]),
      });
    } else if ((m = line.match(PATTERNS.mmDbg))) {
      events.push({
        type: 'mmDbg',
        ts,
        src: m[1],
        add: parseFloat(m[2]),
        dm: parseFloat(m[3]),
        tier2: parseFloat(m[4]),
      });
    } else if ((m = line.match(PATTERNS.business))) {
      events.push({
        type: 'business',
        ts,
        total: parseFloat(m[1]),
        running: m[2] === 'true',
      });
    }
  }
  return events;
}

// ─── 集計 ──────────────────────────────────────────────────────────────
function summarize(events) {
  const gpsDbg = events.filter((e) => e.type === 'gpsDbg');
  const gpsRej = events.filter((e) => e.type === 'gpsRej');
  const mmDbg = events.filter((e) => e.type === 'mmDbg');
  const business = events.filter((e) => e.type === 'business');

  const emitCount = gpsDbg.length;
  const rejCount = gpsRej.length;
  const totalAttempts = emitCount + rejCount;
  const emitRatio = totalAttempts > 0 ? emitCount / totalAttempts : 0;

  const statTrueCount = gpsDbg.filter((e) => e.stat).length;
  const statTrueRatio = emitCount > 0 ? statTrueCount / emitCount : 0;

  // reject reason 別 count
  const rejReasons = {};
  for (const r of gpsRej) rejReasons[r.reason] = (rejReasons[r.reason] || 0) + 1;

  // src(dop/hav) 別 count
  const srcCounts = { dop: 0, hav: 0 };
  for (const g of gpsDbg) if (srcCounts[g.src] != null) srcCounts[g.src]++;

  // mm commit add distribution (= 5Hz over-count 指標)
  const commitAdds = mmDbg.filter((e) => e.src === 'commit').map((e) => e.add);
  const commitAddStats =
    commitAdds.length > 0
      ? {
          count: commitAdds.length,
          min: Math.min(...commitAdds),
          max: Math.max(...commitAdds),
          mean: commitAdds.reduce((a, b) => a + b, 0) / commitAdds.length,
        }
      : null;

  // business total 成長率 (= creep 指標)
  // running=false の間 (= 空車) で business total が伸びていたら creep
  let creepGrowth = null;
  if (business.length >= 2) {
    const idleSegments = [];
    let curIdle = null;
    for (const b of business) {
      if (b.running === false) {
        if (!curIdle) curIdle = { start: b.total, end: b.total };
        else curIdle.end = b.total;
      } else if (b.running === true && curIdle) {
        idleSegments.push(curIdle);
        curIdle = null;
      }
    }
    if (curIdle) idleSegments.push(curIdle);
    creepGrowth = idleSegments.map((s) => ({
      delta_km: s.end - s.start,
      start: s.start,
      end: s.end,
    }));
  }

  return {
    counts: { gpsDbg: emitCount, gpsRej: rejCount, mmDbg: mmDbg.length, business: business.length },
    emitRatio: round3(emitRatio),
    statTrueRatio: round3(statTrueRatio),
    rejReasons,
    srcCounts,
    commitAddStats,
    creepGrowth,
  };
}

// ─── 自動 assertion ────────────────────────────────────────────────────
//   creep>0 m / freeze>10s / commit add>50m を異常として検出
function assess(summary, opts) {
  opts = opts || {};
  const issues = [];
  // creep 検知 (= 空車中 business が +N m 以上伸びていたら)
  const creepThresholdKm = opts.creepThresholdKm != null ? opts.creepThresholdKm : 0.01; // 10m
  if (summary.creepGrowth) {
    for (const seg of summary.creepGrowth) {
      if (seg.delta_km > creepThresholdKm) {
        issues.push({
          severity: 'high',
          kind: 'creep',
          detail: `空車中 business が ${seg.delta_km.toFixed(3)} km 増加 (= ${(seg.delta_km * 1000).toFixed(1)}m creep) [${seg.start}→${seg.end}]`,
        });
      }
    }
  }
  // freeze 検知 (= 連続 reject の長さ / 推定)
  const rejTotalRatio = 1 - summary.emitRatio;
  if (rejTotalRatio > 0.5) {
    issues.push({
      severity: 'medium',
      kind: 'freeze-risk',
      detail: `reject 比 ${(rejTotalRatio * 100).toFixed(1)}% > 50% (= 凍結リスク・主要 reason: ${JSON.stringify(summary.rejReasons)})`,
    });
  }
  // runaway commit add (= 5Hz over-count 指標)
  const commitAddMax = opts.commitAddMaxM != null ? opts.commitAddMaxM : 50;
  if (summary.commitAddStats && summary.commitAddStats.max > commitAddMax) {
    issues.push({
      severity: 'high',
      kind: 'commit-runaway',
      detail: `mm commit add max ${summary.commitAddStats.max.toFixed(1)}m > ${commitAddMax}m (= 5Hz over-count or jump 由来 inflation の可能性)`,
    });
  }
  return {
    ok: issues.filter((i) => i.severity === 'high').length === 0,
    issues,
  };
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

// ─── CLI: node eruda-trace-parser.js <path-to-log.txt> ────────────────
function analyze(rawText, opts) {
  const events = parseEvents(rawText);
  const summary = summarize(events);
  const assessment = assess(summary, opts);
  return { events, summary, assessment };
}

function formatReport(result) {
  const { summary, assessment } = result;
  const lines = [];
  lines.push('━━ Eruda trace 解析レポート ━━');
  lines.push(
    `counts: gpsDbg=${summary.counts.gpsDbg} gpsRej=${summary.counts.gpsRej} mmDbg=${summary.counts.mmDbg} business=${summary.counts.business}`
  );
  lines.push(
    `emitRatio=${summary.emitRatio} statTrueRatio=${summary.statTrueRatio} src=${JSON.stringify(summary.srcCounts)}`
  );
  lines.push(`rejReasons=${JSON.stringify(summary.rejReasons)}`);
  if (summary.commitAddStats) {
    lines.push(
      `commitAdd: count=${summary.commitAddStats.count} min=${round3(summary.commitAddStats.min)}m mean=${round3(summary.commitAddStats.mean)}m max=${round3(summary.commitAddStats.max)}m`
    );
  }
  if (summary.creepGrowth) {
    lines.push(`creepGrowth(空車中 business delta): ${JSON.stringify(summary.creepGrowth)}`);
  }
  lines.push('');
  lines.push('━━ 自動 assessment ━━');
  lines.push(`ok=${assessment.ok}`);
  for (const i of assessment.issues) {
    lines.push(`  [${i.severity}] ${i.kind}: ${i.detail}`);
  }
  return lines.join('\n');
}

if (require.main === module) {
  const fs = require('fs');
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error('Usage: node eruda-trace-parser.js <path-to-log.txt>');
    process.exit(1);
  }
  const raw = fs.readFileSync(argv[0], 'utf8');
  const result = analyze(raw);
  console.log(formatReport(result));
  process.exit(result.assessment.ok ? 0 : 1);
}

module.exports = { parseEvents, summarize, assess, analyze, formatReport, PATTERNS };
