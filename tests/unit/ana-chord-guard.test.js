'use strict';
// ============================================================
// ★★穴を 直線で 埋める時の ガード★★ 2026-08-30（指示役の指摘で 追加）
//
//   ★どちらの物差しか★
//     ★お金（距離）そのもの★を 見ます。上（多すぎ）を 止める門です。
//     タクシー認定モードでも 代行モード（係数1.0085・検定対象外・DM Light基準）でも
//     ★走っていない分を 足すのは おかしい★＝物差しを 選びません。
//
//   ★★なぜ この門が 要るか（指示役の指摘・2026-08-30）★★
//     穴を 直線で 埋める時、★天井の式にも 同じ直線を 足しています★（片側だけ 緩めない為）。
//     ⇒★両側で 相殺されるので、天井の門は「直線が 正しいか」を ★1度も 見ません★★
//     ⇒★GPS が 飛んでも 誰も 止められません★（都市部・トンネル出口の マルチパス）
//     ⇒★だから ここで 見ます★
//
//   ★見る事 2つ★
//     ①★長すぎる 途切れは 埋めない★（3分）
//     ②★速すぎる（＝位置が 飛んだ）物は 埋めない★（110km/h）
//     ★どちらも 境目の 両側で 測ります★
//
//   ★110km/h の 根拠（実測 2026-08-30）★
//     ・8月の 実車 277本の ★平均速度★ … 真ん中 20.8km/h ／ 上位1% 42.9 ／ ★最速 45.6★
//     ・車が 出した ★瞬間の 最速★（OBDの 生値・手元の 走行 全部）… ★96 km/h★
//     ⇒★穴の間の「平均」が 瞬間の最速を 超える事は 物理的に 有り得ない★ので
//       ★96 の 上＝110km/h★ に 置く。
//   ★3分の 根拠（実測）★
//     ・実車中の 途切れ … 10-30秒 23回／30-60秒 5回／1-3分 10回／3-10分 2回／★10分超 9回★
//     ・一番 危ないの ★22.5分・直線2,540m・平均6.8km/h＝ほぼ停車★（走ったのでは ない）
// ============================================================
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const mod = require(path.join(ROOT, 'js', 'pipeline-distance.js'));
const { createDistanceTracker } = mod;

const stubDec = {
  snapToNearestRoad() {
    return null;
  },
  getRoadsNear() {
    return [];
  },
  calcRoadDistance() {
    return null;
  },
  decodeRoadAt() {
    return null;
  },
};

const LAT = 34.0;
// ★エンジンと 同じ物差しで 作る★（EARTH_R=6371000 の まん丸の地球）
const M_PER_DEG_LNG = (Math.PI / 180) * 6371000 * Math.cos((LAT * Math.PI) / 180);
const LNG_PER_M = 1 / M_PER_DEG_LNG;
const T0 = 1700000000000;

// 穴を anaSec 秒 開けて、その間に susundaM メートル 位置が 進む走行
function hashiru(anaSec, susundaM) {
  const tk = createDistanceTracker(stubDec, { useSnapCache: false, enableRouting: false });
  tk.ingest({ lat: LAT, lng: 133.0, t: T0, acc: 5, spd: 20, synthetic: false, obd: true });
  tk.ingest({
    lat: LAT,
    lng: 133.0 + LNG_PER_M * 20,
    t: T0 + 1000,
    acc: 5,
    spd: 20,
    synthetic: false,
    obd: true,
  });
  const mae = tk.totalM();
  tk.ingest({
    lat: LAT,
    lng: 133.0 + LNG_PER_M * (20 + susundaM),
    t: T0 + 1000 + anaSec * 1000,
    acc: 5,
    spd: 20,
    synthetic: false,
    obd: true,
  });
  tk.flush();
  return { mae: mae, total: tk.totalM(), umeta: tk.totalM() - mae };
}

describe('★穴を 直線で 埋める時の ガード★', () => {
  it('★普通の 途切れは 埋める★（2分・80km/h ぶん）', () => {
    const r = hashiru(126, 2826);
    expect(r.umeta, '★埋めていません★').toBeGreaterThan(2700);
  });

  it('★長すぎる 途切れは 埋めない（3分の 境目・両側）★', () => {
    const uchi = hashiru(180, 2000); // ちょうど 3分 … 埋める
    const soto = hashiru(181, 2000); // 3分＋1秒 … 埋めない
    expect(uchi.umeta, '★3分ちょうどで 埋めていません★').toBeGreaterThan(1900);
    expect(soto.umeta, '★3分を 超えたのに 埋めています★').toBeLessThan(30);
  });

  it('★★速すぎる（＝位置が 飛んだ）物は 埋めない（110km/h の 境目・両側）★★', () => {
    // ★境目を 数で 出す★: 110 km/h ÷ 3.6 × 60秒 ＝ ★1,833.33 m★
    const sakai = (110 / 3.6) * 60;
    expect(Math.round(sakai * 100) / 100, '★境目の 計算が 変わりました★').toBe(1833.33);

    const uchi = hashiru(60, 1800); // 108.0 km/h … 埋める
    const soto = hashiru(60, 1900); // 114.0 km/h … ★埋めない★
    expect(uchi.umeta, '★110km/h の 内側なのに 埋めていません★').toBeGreaterThan(1700);
    expect(
      soto.umeta,
      '★110km/h を 超えているのに 埋めています★\n' +
        '  ＝GPS が 飛んだ時に 客へ 多く 請求します（天井の門は 相殺されて 気づけません）'
    ).toBeLessThan(30);
  });

  // ★★境目 ちょうどを 試す（2026-08-30・指示役の指摘）★★
  //   ★うちの決まり＝境界（等号・端）を 実物で 測れ★
  //   1,800 と 1,900 は 境目（1,833.33m）を 挟んでいるだけで ★境目 そのものを 見ていません★でした。
  //   ★等号の 向き★: コードは `_anaChord > _anaUwa` で 弾くので
  //   ★ちょうど（＝110km/h ぴったり）は 通します★。
  it('★★境目 ちょうど（1,833m）と その 1m 外（1,834m）★★', () => {
    const uchi = hashiru(60, 1833); // 1,833 ≤ 1,833.33 … ★通す★
    const soto = hashiru(60, 1834); // 1,834 > 1,833.33 … ★弾く★
    expect(uchi.umeta, '★境目の 内側（1,833m）を 弾いています★').toBeGreaterThan(1700);
    expect(soto.umeta, '★境目の 外側（1,834m）を 通しています★').toBeLessThan(30);
  });

  // ★★等号の 向きは 実際には 効きません（2026-08-30・調べた結果を そのまま 書きます）★★
  //   指示役から「★ちょうどの 時に 通すのか 弾くのか を はっきりさせろ★」と 言われ、
  //   ★ぴったり 1,100.00m に なる 36秒★で 試しました。
  //   ⇒★わざと `>` を `>=` に 変えても ★緑のまま★でした★
  //   ⇒ 理由を 数で 見ました:
  //       作った 1,100m の 実際の 直線 ＝ ★1099.999999377 m★
  //       上限（110km/h × 36秒）    ＝ ★1100.000000000 m★
  //       差 ★−6.2×10⁻⁷ m★＝★ぴったり 一致は 起きません★
  //   ⇒★直線は 緯度経度から 計算した 小数なので、上限と ぴったり 同じに なる事は
  //     事実上 ありません★。★だから 等号の 向きは 結果を 変えません★。
  //   ⇒★「決めていない」のでは なく「決めても 効かない」★と 分かったので、
  //     ★1m 単位の 両側★（下の試験）で 見ます。それが 実際に 効く線です。
  //   ★もし 将来 上限を 整数の m で 持つように 変えたら、ここを 見直してください★
  it('★等号の 向きは 効かない（ぴったり 一致は 起きない）★', () => {
    const byou = 36;
    const uwa = (110 / 3.6) * byou; // 1,100.00 m ぴったり
    expect(uwa).toBe(1100);
    const chodo = hashiru(byou, 1100);
    const ue = hashiru(byou, 1101);
    // ★1,100m を 作っても 実際の 直線は 1099.9999994m＝上限の 下★
    expect(chodo.umeta, '★上限の すぐ下を 弾いています★').toBeGreaterThan(1000);
    expect(ue.umeta, '★上限の 上（1,101m）を 通しています★').toBeLessThan(30);
  });

  it('★★時間の 境目 ちょうど（180秒）と その 1秒 外（181秒）★★', () => {
    // ★等号の 向き★: コードは `dtObd > _anaMaxSec` で 弾くので ★180秒ちょうどは 通す★
    const uchi = hashiru(180, 2000); // 40 km/h … 通す
    const soto = hashiru(181, 2000); // 3分を 1秒 超え … 弾く
    expect(uchi.umeta, '★180秒ちょうどを 弾いています★').toBeGreaterThan(1900);
    expect(soto.umeta, '★181秒を 通しています★').toBeLessThan(30);
  });

  it('★GPS が 大きく 飛んだ時（25km）は 1mも 埋めない★', () => {
    const r = hashiru(60, 25000); // 60秒で 25km ＝ 1,500km/h
    expect(r.umeta, '★飛んだ位置を 足しています★').toBeLessThan(30);
  });

  it('★止まっていたら 0m（前後が 同じ場所）★', () => {
    const r = hashiru(120, 0);
    expect(r.umeta).toBeLessThan(30);
  });

  it('★捨てた分を 数えている（黙って 落とさない）★', () => {
    const src = require('fs').readFileSync(path.join(ROOT, 'js', 'pipeline-distance.js'), 'utf8');
    ['anaTooLongM', 'anaTooFastM', 'anaChordSkippedM'].forEach((k) => {
      expect(src.includes(k), '★' + k + ' を 数えていません★').toBe(true);
    });
  });

  it('★天井の式にも 同じ ガードが 掛かっている（片側だけに しない）★', () => {
    const p = path.join(ROOT, 'tests', 'integration', 'obd-main-distance-engine.test.js');
    const src = require('fs').readFileSync(p, 'utf8');
    expect(src.includes('(110 / 3.6) * dt'), '★天井の 速さの 上限が 違います★').toBe(true);
    expect(/dt > 180/.test(src), '★天井の 時間の 上限が ありません★').toBe(true);
  });
});
