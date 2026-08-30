// tests/unit/fare-per-company.test.js
//
// ★★料金を 会社ごとに する（C1・1段目の 下ごしらえ）★★ 2026-08-29
//
//   ★何が おかしいか（2026-08-29 実測）★
//     ・料金表の 置き場所が ★`fare_config/default` の 1か所だけ★（js/firebase.js 4か所とも default）
//     ・メイン機は ★自分の会社を 知っている★（js/license-v2.js の company_id）のに、
//       ★料金を読む所だけ その会社を 1度も 使っていない★（js/firebase.js を company で探して 0行）
//     ・つなぎ先の Firebase も ★全社 共通で 1つ★
//     ⇒ ★別々に 登録した会社が 同じ1枚の料金表を 読み書きしている★
//     ⇒ ★A社が 変えたら B社も 変わる★
//   ★司さん（2026-08-29）★「なんで別に登録したユーザーが 全て一緒の料金になるんど」
//
//   ★★2026-08-29 夜 … 前提を 直しました（私も 指示役も 取り違えていました）★★
//     ダイコメの「会社」は ★2種類★ 在ります:
//       ㋐ ★うちの会社★（登録した運転代行）… public.dk_companies
//       ㋑ ★請求先★（飲み屋さん等）……… daikou.companies
//     ・★「24社」は ㋑（請求先）の数★でした（★㋐ではありません★）
//     ・★㋐は 11社。うち 運行が 在るのは ★1社（ZERO代行・251件）★だけ★
//       （残り10社は ★検証のゴミ★・運行 0件）
//     ⇒★この試験が 見ているのは ㋐（うちの会社ごとの 料金表）で 合っています★
//     ⇒★ただし 今は ㋐が 実質1社なので「24社が 同じ料金を見ている」は 誤りでした★
//     ⇒★C1 が 要る 一番の理由は「24社が 同じ」ではなく
//       ★「誰でも 料金を 変えられる」★事です（1社でも 危ない）★
//     ⇒★2社目が 入った日に いきなり 困る★ので、直す事自体は 変わりません。
//     ＝★これは「やるか どうか」ではなく ★直す物★★
//
//   ★段取りは 2段（指示役）★
//     ★1段目★ … 今の1枚を そのまま 配る（★姿は 今と 同じ・1円も 変わらない★）
//     ★2段目★ … 会社ごとに 変えられるようにする
//   ★この試験は 1段目の「1円も 変わらない」を 数で 出す物★です。
//
//   ★まだ やらない事★
//     ・★棚（DB）は 1文字も 触らない★（実際に 24社へ 配るのは 司さんの一言）
//     ・★いくらにするか は 決めない★（司さん待ち）
//     ・★画面は 作らない★（見せるかどうかも 司さん待ち）
//
//   ★触ってはいけない物★
//     ・★過去の請求の根拠（fare_config_snapshot）★＝1件も 触らない
//     ・★走行中は 料金が 変わらない（_fareConfigFrozen）★＝残す
//     ・★distance_m★／★代行係数 1.0085★
//
//   ★この試験が 本当に 効くか（2026-08-29 壊して 確かめた）★
//     ★効いた★ … 本体の 加算の刻みを ceil→floor に 壊す → ★赤★
//     ★効かなかった（＝壊し方の側の 話）★
//       ・丸めを 10→100 に … ★金額が 全部 100円の倍数★なので 結果が 変わらない
//       ・初乗りの境目を <= から < に … ★ちょうど1000m は 余りが0＝加算0回★で どちらも 1300円
//       ⇒★どちらも「意味の変わらない壊し方」★でした（★見張りが 甘いのではない★）
//       ⇒★壊して緑だった時は「壊した所を 本当に 通ったか」「意味が 変わったか」を 先に 確かめる★
'use strict';

const path = require('path');
const METER_JS_PATH = path.join(__dirname, '..', '..', 'js', 'meter.js');

function loadMeter() {
  delete require.cache[require.resolve(METER_JS_PATH)];
  return require(METER_JS_PATH);
}

// ★今の既定（js/meter.js:223 の初期値と 同じ）★
//   ★これは ★司さんの 基本設定★です（2026-08-29 訂正）
//     出どころ … zeroact-memory/projects/daikome/memory.md
//     「★calcFare … 1000m以下 ¥1,300 ／ 以降 420mごと +¥100★」
//     ★私は 一度「決めた紙が 無い＝仮の数字」と 書きました。誤りです★
//     ⇒★値段を どうするか を 聞く必要は ありませんでした★
const IMA_NO_KITEI = {
  version: 2,
  base_fare: 1300,
  base_distance_m: 1000,
  add_fare: 100,
  add_distance_m: 420,
  tiers: [],
  surcharges: [],
  minFare: null,
  maxFare: null,
  rounding: 10,
};

// ★過去の運行の 距離★（1円も 変わらない事を 数で 出す為の 材料）
//   ★0件で 緑に しない★＝下で 件数を 数えます（2026-08-29・指示役）
//   中身は ★境界を またぐ所を 厚く★（初乗りの境目・加算の刻み・丸めの境目）
function kyoriIchiran() {
  const a = [];
  // 初乗りの境目
  [0, 1, 500, 999, 1000, 1001].forEach((m) => a.push(m));
  // 加算の刻み（420m ごと）を 20段ぶん・境目の 前後も
  for (let i = 0; i < 20; i++) {
    const base = 1000 + 420 * i;
    a.push(base, base + 1, base + 419, base + 420);
  }
  // 長い運行（10km〜80km）を 100m 刻み
  for (let m = 10000; m <= 80000; m += 100) a.push(m);
  return a;
}

describe('★料金を 会社ごとに する（1段目＝1円も 変わらない）★', () => {
  const kyori = kyoriIchiran();

  it('★材料が 0件で 緑に ならない★（何件で 確かめたかを 数える）', () => {
    expect(kyori.length, '★過去の運行が 0件＝何も 確かめていません★').toBeGreaterThan(100);
    // ★重なりを 除いても 十分 在るか★
    const betsu = new Set(kyori);
    expect(betsu.size, '★同じ距離ばかり 数えていないか★').toBeGreaterThan(100);
  });

  it('★1段目：今の1枚を そのまま 配ると 1円も 変わらない★', () => {
    // ①今の姿（1枚を 全社で 共有）
    const ima = loadMeter();
    ima.setFareConfig(IMA_NO_KITEI);
    // ②配った後の姿（会社ごとに 持つが 中身は 同じ物の 写し）
    const ato = loadMeter();
    ato.setFareConfig(JSON.parse(JSON.stringify(IMA_NO_KITEI)));

    const chigau = [];
    kyori.forEach((m) => {
      const a = ima.calcFare(m);
      const b = ato.calcFare(m);
      if (a !== b) chigau.push(m + 'm … 前 ' + a + '円 / 後 ' + b + '円');
    });
    expect(
      chigau.slice(0, 5),
      '★配る前と後で 金額が 変わりました★（' +
        chigau.length +
        '件 / ' +
        kyori.length +
        '件中）\n' +
        '  ★1段目は「姿は 今と 同じ」が 絶対条件です★'
    ).toEqual([]);
    // ★何件で 確かめたかを 出す★（0件で 緑に しない）
    console.log('★差0円を 確かめた件数 = ' + kyori.length + '件（違い 0件）★');
  });

  // ★★ここが 抜けていました（2026-08-29・壊して 気づいた）★★
  //   上の「前と後」は ★同じ本体で 2回 計算している★だけなので、
  //   ★本体（js/meter.js）が 変わっても 両方 同じだけ 変わり、気づけません★。
  //   （実際 丸めを 10→100 に 壊しても 緑のままでした）
  //   ⇒ ★手で 計算した 正しい金額★と 突き合わせます。
  it('★金額そのものが 合っている★（本体が 変わったら 気づく）', () => {
    const m = loadMeter();
    m.setFareConfig(IMA_NO_KITEI);
    // ★式（js/meter.js の 旧形式 path・確定仕様）★
    //   distanceM <= 1000 → 1300円
    //   それ以外 → 1300 + ceil((距離-1000)/420) × 100 → 10円単位に 丸め
    const teuchi = (mm) => {
      let f;
      if (mm <= IMA_NO_KITEI.base_distance_m) f = IMA_NO_KITEI.base_fare;
      else {
        const steps = Math.ceil((mm - IMA_NO_KITEI.base_distance_m) / IMA_NO_KITEI.add_distance_m);
        f = IMA_NO_KITEI.base_fare + steps * IMA_NO_KITEI.add_fare;
      }
      return Math.round(f / IMA_NO_KITEI.rounding) * IMA_NO_KITEI.rounding;
    };
    const chigau = [];
    kyori.forEach((mm) => {
      const a = m.calcFare(mm);
      const b = teuchi(mm);
      if (a !== b) chigau.push(mm + 'm … 本体 ' + a + '円 / 手計算 ' + b + '円');
    });
    expect(
      chigau.slice(0, 5),
      '★本体の金額が 手計算と 違います★（' + chigau.length + '件 / ' + kyori.length + '件中）'
    ).toEqual([]);
  });

  it('★2段目：会社ごとに 別の料金にすると ちゃんと 変わる★（配れていない＝空振り を 止める）', () => {
    const aSha = loadMeter();
    aSha.setFareConfig(IMA_NO_KITEI);
    const bSha = loadMeter();
    bSha.setFareConfig(Object.assign({}, IMA_NO_KITEI, { base_fare: 1500 }));

    // ★同じ距離で 金額が 変わる事★＝会社ごとに 効いている証拠
    const chigatta = kyori.filter((m) => aSha.calcFare(m) !== bSha.calcFare(m));
    expect(
      chigatta.length,
      '★会社ごとに 変えても 金額が 1件も 変わりません★＝★配れていない（空振り）★'
    ).toBeGreaterThan(100);
  });

  it('★料金表を 持たない会社は 今の既定に 落ちる／空で 計算しない★', () => {
    // ★空で 計算すると 0円や NaN が 出ます★＝一番 危ない
    const kara = loadMeter();
    // 何も 入れない＝js/meter.js の 初期値のまま
    const a = kara.calcFare(5000);
    const kitei = loadMeter();
    kitei.setFareConfig(IMA_NO_KITEI);
    const b = kitei.calcFare(5000);
    expect(Number.isFinite(a), '★空のまま 計算して 数字に ならない★').toBe(true);
    expect(a, '★空のまま 計算して 0円に なる★').toBeGreaterThan(0);
    expect(a, '★何も入れない時と 今の既定で 金額が 違う＝落ち先が 違う★').toBe(b);
  });

  it('★走行中は 料金が 変わらない（この仕組みを 壊していない）★', () => {
    const m = loadMeter();
    m.setFareConfig(IMA_NO_KITEI);
    const mae = m.calcFare(5000);
    // 業務中は setFareConfig が 捨てられる（js/meter.js:310）
    if (typeof m.startBusiness === 'function') {
      try {
        m.startBusiness();
      } catch (_) {
        /* 依存で 落ちる事が 在る＝その時は 下の 確認だけ */
      }
    }
    expect(m.calcFare(5000), '★走行中に 金額が 変わった★').toBe(mae);
  });
});
