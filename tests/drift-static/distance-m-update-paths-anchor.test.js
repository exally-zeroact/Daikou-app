// ★物差し★ 2026-08-28 … ★①タクシー認定モードの線（過大ゼロ）で 判定しています★
//   ・この見張りが 赤にするのは ★distance_m ≤ 真距離（過大不可）★ を 破った時（この file 自身に そう書いてある）
//   ・★代行は 検定対象外★＝法として「真距離を超えるな」は 課されていません。
//     代行の実上限は ★DM Light／タイヤ真値 ＋0.5〜6%★ という 緩い天井（係数 1.0085 で わざと上乗せ）。
//   ⇒★ここが赤でも「代行で 過大請求している」とは 限りません★。
//     うちは ★内側の約束★として 過大ゼロを 守っています（2026-08-23 の誤読を 二度と させない為 明記）。
// tests/drift-static/distance-m-update-paths-anchor.test.js
//
// ★白紙書き直し (2026-05-30・clean-rebuild-pipeline・新挙動へ更新)★
//   旧: distance_m += は 5 経路 (mm commit / retro Off-Road / gap fill / Off-Road incremental /
//       setDistance)・GPS.calcDistance は 5 箇所、という ★旧 accrual 内部★ を行アンカーで検証。
//   新: distance_m は ★pipeline-distance エンジンの delta 1 経路★ で駆動する。
//       meter.js 内の state.distance_m 書込は ★2 経路のみ★:
//         (1) _onMmWorkerMessage: state.distance_m += delta  (= pipelineDeltaM・running gate)
//         (2) setDistance:        state.distance_m = v        (= 復元用 外部代入)
//       GPS.calcDistance / haversine は meter.js から ★消滅★ (= pipeline-distance.js /
//       map-matcher.js 内に集約)。よって meter.js 内の GPS.calcDistance 呼出は 0 件。
//
//   この test は「白紙の単一駆動経路」を構造的に固定し、将来の継ぎ足し
//   (= 旧 5 経路 tangle / GPS 直線課金の再混入) を即座に検出する。

'use strict';

const fs = require('fs');
const path = require('path');

const METER_JS_PATH = path.join(__dirname, '..', '..', 'js', 'meter.js');

function loadMeterSource() {
  return fs.readFileSync(METER_JS_PATH, 'utf8');
}

describe('drift-static: meter.js 距離駆動は pipeline delta 単一経路 (白紙書き直し・clean-rebuild-pipeline)', () => {
  it('C1: state.distance_m への代入/加算は meter.js 内で 3 経路のみ (= += delta / += gapM / = v)', () => {
    const source = loadMeterSource();
    const lines = source.split('\n');
    const matchedLines = [];
    const writePattern = /^\s*state\.distance_m\s*[+]?=\s*[^=]/;
    for (let i = 0; i < lines.length; i++) {
      if (writePattern.test(lines[i])) {
        matchedLines.push({ lineNo: i + 1, content: lines[i].trim() });
      }
    }
    // ★白紙書き直し後 distance_m 書込経路は 3 経路 (2026-06-09・随伴車別k校正を反映):
    //   #1 += cal    : pipeline delta の source-aware k校正 (cal = delta × _kForDelta・OBD駆動のみ随伴車k)
    //   #2 += gapCal : gap補完 (gapCal = gapM × 1.0・GPS速度×時間・k非適用=過大ゼロ)
    //   #3 = v       : setDistance 復元代入
    //   いずれも GPS 直線 (haversine) 課金ではない (C3 で GPS.calcDistance 0 を別途保証)。
    //   ★k は ★同一 pipeline delta / gapM に対するスカラー器差★ であり新規距離源ではない
    //     (cal/gapCal の定義が delta×k / gapM×k であることを下で検証=単一源不変を強化)。
    if (matchedLines.length !== 3) {
      throw new Error(
        '述語 C 違反: 白紙書き直し後 distance_m 書込経路は 3 経路 ' +
          '(= += cal + += gapCal + = v) のはず。検出: ' +
          JSON.stringify(matchedLines, null, 2)
      );
    }
    // 経路 #1 は pipeline delta の k 校正加算 (= 道路 snap 道なり区間増分・running gate 内)
    if (!/\+=\s*cal\b/.test(matchedLines[0].content)) {
      throw new Error(
        '述語 C 違反: 経路 #1 は state.distance_m += cal (= pipelineDeltaM×k) のはず。実検出: ' +
          matchedLines[0].content
      );
    }
    // 経路 #2 は gap補完の k 校正 (= Worker B 不在時・速度×時間×k)
    if (!/\+=\s*gapCal\b/.test(matchedLines[1].content)) {
      throw new Error(
        '述語 C 違反: 経路 #2 は state.distance_m += gapCal (= gap補完 gapM×k) のはず。実検出: ' +
          matchedLines[1].content
      );
    }
    // 経路 #3 は setDistance の復元代入
    if (!/=\s*v\b/.test(matchedLines[2].content)) {
      throw new Error(
        '述語 C 違反: 経路 #3 は state.distance_m = v (= setDistance 復元) のはず。実検出: ' +
          matchedLines[2].content
      );
    }
    // ★単一源不変の強化 (source-aware・2026-06-12)★: cal は pipeline delta × _kForDelta(OBD駆動のみk)
    //   × _daikouDistFactor、gapCal は gapM × _daikouDistFactor。別距離源(haversine等)でない事を検証。
    //   ★_daikouDistFactor (2026-06-18・司さん確定): 代行DM−0.2%着地を距離計算式に入れるスカラー(既定1.0=byte不変)★。
    if (!/const\s+cal\s*=\s*delta\s*\*\s*_kForDelta\s*\*\s*_daikouDistFactor\b/.test(source)) {
      throw new Error('述語 C 違反: cal は `delta * _kForDelta * _daikouDistFactor` のはず');
    }
    if (!/const\s+gapCal\s*=\s*gapM\s*\*\s*_daikouDistFactor\b/.test(source)) {
      throw new Error('述語 C 違反: gapCal は `gapM * _daikouDistFactor` のはず');
    }
  });

  it('C3: meter.js 内に GPS.calcDistance / GPS 直線課金は存在しない (= haversine は pipeline へ集約)', () => {
    const source = loadMeterSource();
    const lines = source.split('\n');
    const calls = [];
    for (let i = 0; i < lines.length; i++) {
      if (/GPS\.calcDistance\(/.test(lines[i]) && !/^\s*\/\//.test(lines[i])) {
        calls.push({ lineNo: i + 1, content: lines[i].trim() });
      }
    }
    if (calls.length !== 0) {
      throw new Error(
        '白紙書き直し違反: meter.js 内 GPS.calcDistance 呼出は 0 件のはず (= 距離は pipeline-distance 駆動)。実検出 ' +
          calls.length +
          ' 件・' +
          JSON.stringify(calls)
      );
    }
  });
});
