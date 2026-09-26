// ============================================================
// scripts/torimodoshi-kazoeru.mjs
// ★取り戻しで 何件 戻ったかを 機械で 数える（2026-09-26）★
//
//   ★何のため★
//     [終了]→(Wi-Fiで送信)→[続ける]→[終了] の時、business.js が
//     ★送信済みの印を 外していなかった★ので「続きを足した版」が二度と上がらず、
//     事務所には ★途中までの 件数・距離・売上・勤務時間★ しか残っていなかった。
//     直し(js/business.js resume + js/job-sync.js resendOnce)を配ったので、
//     ★運転手が 端末を 開き直すと 手元の版が 送り直される★。
//     その時 ★どの勤務が どれだけ 戻ったか★ を 目でなく 機械で 出す。
//
//   ★倉庫からは 見分けが つかない★ ので 前後で 比べるしかない
//     途中までの版は ★それ自体で 辻褄が 合っている★（trip_count と dk_trips の数も一致）。
//     だから「今の一枚」を見ても 欠けは 分からない。★開き直す前に 控えを取る★こと。
//
//   使い方（★読むだけ。1行も 書かない★）:
//     node scripts/torimodoshi-kazoeru.mjs --save mae     … 開き直して もらう前
//     …運転手に 端末を 開き直して もらう…
//     node scripts/torimodoshi-kazoeru.mjs --diff mae     … 何が 戻ったか
//
//   ★控えは repo に 入れない★ … 置き場 %TEMP%\daikome-torimodoshi-<名前>.json
//     Daikou-app / Daikou-app-test は ★どちらも 公開 repo★（2026-09-26 に確認）。
//     売上・端末IDを 置くと そのまま 外に 出る。
//
//   向き先は ★js/dk-config.js から読む★（このrepoの向き先以外には当たらない）。
// ============================================================
/* eslint-env node */
/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { readToken, whereWeLooked } from './db-token.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HIBI = 35; // 端末の履歴は30日で捨てられる。少し広めに見る

function projectRef() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'dk-config.js'), 'utf8');
  const m = src.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  if (!m) throw new Error('js/dk-config.js から 向き先が 読めない');
  return m[1];
}

function snapPath(name) {
  return path.join(os.tmpdir(), 'daikome-torimodoshi-' + String(name) + '.json');
}

async function toru() {
  // ★readToken は {token, from} を返す（文字列では ない）★
  //   取り違えて Bearer [object Object] を送り 401 を1回 もらっている（2026-09-26）。
  const kagi = readToken();
  if (!kagi || !kagi.token) {
    throw new Error('鍵が見つからない（探した所: ' + whereWeLooked().join(' / ') + '）');
  }
  const token = kagi.token;
  const ref = projectRef();
  const query = `
    select s.shift_id::text as id, s.device_id as dev,
           s.started_at::text as hajime, s.ended_at::text as owari,
           s.elapsed_sec, s.trip_count, s.fare_total_yen, s.actual_total_m,
           (select count(*) from daikome.dk_trips t where t.shift_id = s.shift_id) as trips
      from daikome.dk_shifts s
     where s.started_at > now() - interval '${HIBI} days'
     order by s.started_at`;
  if (!/^\s*select\b/i.test(query)) throw new Error('読むだけの文しか投げない');
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // ★User-Agent が 無いと Cloudflare が 1010 で 弾く（2026-09 実測）★
      'User-Agent': 'daikome-torimodoshi',
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    throw new Error('倉庫に届かない ' + res.status + ' ' + (await res.text()).slice(0, 200));
  }
  return { ref, rows: await res.json() };
}

const yen = (v) => Number(v || 0).toLocaleString('ja-JP');
const gokei = (rows, k) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);

function matome(ref, rows) {
  console.log(`向き先: ${ref}（読むだけ）`);
  console.log(
    `直近${HIBI}日  勤務 ${rows.length} 件 / 代行 ${gokei(rows, 'trips')} 件 / 売上 ${yen(
      gokei(rows, 'fare_total_yen')
    )} 円`
  );
}

async function main() {
  const args = process.argv.slice(2);
  const { ref, rows } = await toru();
  matome(ref, rows);

  if (args[0] === '--save') {
    const name = args[1] || 'mae';
    fs.writeFileSync(snapPath(name), JSON.stringify(rows, null, 2), 'utf8');
    console.log('★控えを 取った★ ' + snapPath(name));
    console.log('  ⇒ 運転手に 端末を 開き直して もらってから --diff ' + name);
    return;
  }

  if (args[0] === '--diff') {
    const name = args[1] || 'mae';
    const p = snapPath(name);
    if (!fs.existsSync(p)) {
      console.log('★控えが 無い★ ' + p + '（先に --save ' + name + '）');
      process.exitCode = 2;
      return;
    }
    const mae = new Map(JSON.parse(fs.readFileSync(p, 'utf8')).map((r) => [r.id, r]));
    let modotta = 0;
    let fuetaTrips = 0;
    let fuetaYen = 0;
    let atarashii = 0;
    for (const r of rows) {
      const m = mae.get(r.id);
      if (!m) {
        atarashii++;
        continue; // 開き直した後に 走った 新しい勤務（取り戻しでは ない）
      }
      const dt = Number(r.trips) - Number(m.trips);
      const dy = Number(r.fare_total_yen || 0) - Number(m.fare_total_yen || 0);
      if (dt === 0 && dy === 0) continue;
      modotta++;
      fuetaTrips += dt;
      fuetaYen += dy;
      console.log(
        `  ★戻った★ ${r.hajime.slice(0, 16)} 端末${String(r.dev).slice(0, 8)} ` +
          `代行 ${m.trips}→${r.trips} 件 / 売上 ${yen(m.fare_total_yen)}→${yen(
            r.fare_total_yen
          )} 円 / 終了 ${String(m.owari || '').slice(0, 16)}→${String(r.owari || '').slice(0, 16)}`
      );
      if (dt < 0 || dy < 0) {
        console.log('   ★★減っている＝取り戻しでは 起きないはず。止めて 調べること★★');
      }
    }
    console.log('');
    console.log(`★戻った 勤務 ${modotta} 件 / 代行 +${fuetaTrips} 件 / 売上 +${yen(fuetaYen)} 円★`);
    if (atarashii) console.log(`（控えの後に 走った 新しい勤務 ${atarashii} 件は 数に 入れていない）`);
    if (modotta === 0) {
      console.log('★0件★ … 端末が まだ 開き直されていない か、欠けが そもそも 無かった。');
      console.log('   ★「0件＝直っている」では ない★（どちらかを 端末側で 確かめること）');
    }
    return;
  }

  console.log('');
  console.log('使い方: --save <名前>（開き直す前）/ --diff <名前>（開き直した後）');
}

main().catch((e) => {
  console.error('NG: ' + e.message);
  process.exitCode = 1;
});
