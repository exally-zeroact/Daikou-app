// ★物差し★ 2026-08-28 … ★距離の採点では ありません★
//   ・この file が 赤にするのは 下に書いてある 別の基準です（配線・較正・採点の道具 など）。
//   ・タクシー認定モード（過大不可）／代行モード（天井 +0.5〜6%）の どちらの線でも 判定していません。
// tests/unit/k-calib.test.js
// ★1km自動較正K (js/k-calib.js) 純関数テスト★ — [[project_daikome_distance_method_DECIDED_2026-06-26]]
//   K=(良GPS距離)÷(OBD∫v) を窓×複数→中央値で学習。★対立監査P0是正(2026-06-26)★:
//   3窓未満は学習Kを距離に焼かない / 健全域外の外れ窓はプール除外 / 確定Kは絶対クランプ[0.85,1.08]。
//   distance_m/課金には触らない(較正係数を作るだけ)。

const KCalib = require('../../js/k-calib.js');

function feed(cal, pairs) {
  for (const p of pairs) cal.addPair(p.g, p.v, p.dt, p.acc != null ? p.acc : 5);
}

describe('KCalib.median', () => {
  it('奇数/偶数の中央値', () => {
    expect(KCalib.median([3, 1, 2])).toBe(2);
    expect(KCalib.median([4, 1, 2, 3])).toBe(2.5);
  });
  it('空は null', () => {
    expect(KCalib.median([])).toBeNull();
  });
});

describe('KCalib.createKCalibrator', () => {
  // ★窓がちょうど1000mで閉じる合成★: GPS=10m/step固定、OBD速度=10/K(m/s) → 100step(GPS1000m)で窓K=K。
  function steps(K, n) {
    const a = [];
    for (let i = 0; i < n; i++) a.push({ g: 10, v: 10 / K, dt: 1, acc: 5 });
    return a;
  }

  it('★3窓未満は学習Kを距離に焼かない(getK=null)・provisionalで参考値のみ★', () => {
    const cal = KCalib.createKCalibrator({ calibKm: 1.0 }); // coldStartKなし
    feed(cal, steps(1.025, 100)); // 1窓
    expect(cal.windows()).toBe(1);
    expect(cal.confident()).toBe(false);
    expect(cal.getK()).toBeNull(); // ★過大請求バグ封鎖: 単発1.037等を距離に焼かない
    expect(cal.provisionalK()).toBeCloseTo(1.025, 3); // 参考表示用は出る
  });

  it('3窓以上で窓中央値を確定K(代表性ノイズ回避)', () => {
    const cal = KCalib.createKCalibrator({ calibKm: 1.0 });
    feed(cal, steps(1.02, 100));
    feed(cal, steps(1.03, 100));
    feed(cal, steps(1.025, 100));
    expect(cal.windows()).toBe(3);
    expect(cal.confident()).toBe(true);
    expect(cal.getK()).toBeCloseTo(1.025, 3); // median([1.02,1.025,1.03])
  });

  it('健全域外の外れ窓はプールに入れない(悪GPS区間のK暴れ1.15を除外)', () => {
    const cal = KCalib.createKCalibrator({ calibKm: 1.0 });
    feed(cal, steps(1.15, 100)); // 健全域[0.95,1.11]外 → reject
    feed(cal, steps(1.02, 100));
    feed(cal, steps(1.03, 100));
    feed(cal, steps(1.025, 100));
    expect(cal.windows()).toBe(3);
    expect(cal.rejectedWindows()).toBe(1);
    expect(cal.getK()).toBeCloseTo(1.025, 3); // 1.15に引っ張られない
  });

  it('確定Kは絶対クランプ[0.85,1.08]を超えない', () => {
    const cal = KCalib.createKCalibrator({ calibKm: 1.0, kHealthHi: 1.3 }); // 健全域広げて高Kを通す
    feed(cal, steps(1.15, 100));
    feed(cal, steps(1.16, 100));
    feed(cal, steps(1.17, 100));
    expect(cal.windows()).toBe(3);
    expect(cal.getK()).toBeLessThanOrEqual(1.08 + 1e-9);
    expect(cal.getK()).toBeCloseTo(1.08, 3); // median1.16→clamp1.08
  });

  it('coldStartK: 3窓未満はcoldStartK・3窓以上は学習K優先', () => {
    const cal = KCalib.createKCalibrator({ coldStartK: 1.018, calibKm: 1.0 });
    expect(cal.getK()).toBe(1.018); // 未較正=タイヤ入力由来coldStart
    feed(cal, steps(1.025, 100));
    feed(cal, steps(1.025, 100));
    expect(cal.getK()).toBe(1.018); // 2窓=まだcoldStart(3窓未満)
    feed(cal, steps(1.025, 100));
    expect(cal.getK()).toBeCloseTo(1.025, 3); // 3窓で学習K採用
  });

  it('coldStartK無しの未較正(3窓未満)は null=距離に焼かない', () => {
    expect(KCalib.createKCalibrator({}).getK()).toBeNull();
  });

  it('NaN/0 の coldStartK は無効(null扱い・NaN Kを距離に乗せない)', () => {
    expect(KCalib.createKCalibrator({ coldStartK: NaN }).getK()).toBeNull();
    expect(KCalib.createKCalibrator({ coldStartK: 0 }).getK()).toBeNull();
  });

  it('悪GPS(acc大)・OBD欠落(負)・GPS飛び・異常速度・dt超過 は較正に入れない', () => {
    const cal = KCalib.createKCalibrator({
      calibKm: 1.0,
      accMax: 20,
      maxJumpM: 200,
      maxSpeedMps: 60,
    });
    cal.addPair(10, 10, 1, 50); // acc>20
    cal.addPair(10, -1, 1, 5); // OBD欠落
    cal.addPair(300, 10, 1, 5); // GPS飛び
    cal.addPair(10, 100, 1, 5); // 異常速度
    cal.addPair(10, 10, 10, 5); // dt>5
    expect(cal.windows()).toBe(0);
    expect(cal.getK()).toBeNull();
  });

  it('reset で状態クリア', () => {
    const cal = KCalib.createKCalibrator({ calibKm: 1.0 });
    feed(cal, steps(1.025, 100));
    feed(cal, steps(1.025, 100));
    feed(cal, steps(1.025, 100));
    expect(cal.confident()).toBe(true);
    cal.reset();
    expect(cal.windows()).toBe(0);
    expect(cal.getK()).toBeNull();
  });
});

describe('KCalib.decideCalibToast (見える化トースト判定・対立監査P0/P1是正)', () => {
  it('autoCalibK OFF(null)は何も出さない', () => {
    const r = KCalib.decideCalibToast(null, { lastN: -1, done: false });
    expect(r.toast).toBeNull();
    expect(r.long).toBeNull();
  });

  it('windows=0は何も出さない', () => {
    const r = KCalib.decideCalibToast({ windows: 0, confident: false }, { lastN: -1, done: false });
    expect(r.toast).toBeNull();
    expect(r.long).toBeNull();
  });

  it('進捗: 1/3 → 2/3 を窓増分で1回ずつ', () => {
    let st = { lastN: -1, done: false };
    let r = KCalib.decideCalibToast({ windows: 1, confident: false }, st);
    expect(r.toast).toBe('OBD較正中 1/3');
    st = r.state;
    // 同じwindows=1で再tick → 出さない(連発しない)
    r = KCalib.decideCalibToast({ windows: 1, confident: false }, st);
    expect(r.toast).toBeNull();
    st = r.state;
    r = KCalib.decideCalibToast({ windows: 2, confident: false }, st);
    expect(r.toast).toBe('OBD較正中 2/3');
  });

  it('★完了は1回だけ★(windows=3→4→5 で連発しない=確定を嘘で名乗らない)', () => {
    let st = { lastN: 2, done: false };
    let r = KCalib.decideCalibToast({ windows: 3, confident: true, K: 1.025 }, st);
    expect(r.long).toBe('OBD較正 完了\nこの区間の K = 1.025');
    st = r.state;
    expect(st.done).toBe(true);
    // windows=4(まだ走行中・Kも動く)→ もう出さない
    r = KCalib.decideCalibToast({ windows: 4, confident: true, K: 1.03 }, st);
    expect(r.long).toBeNull();
    expect(r.toast).toBeNull();
    st = r.state;
    r = KCalib.decideCalibToast({ windows: 5, confident: true, K: 1.028 }, st);
    expect(r.long).toBeNull();
  });

  it('★新tracker(業務/県跨ぎ=windows減)で巻き戻し→再表示★', () => {
    // 完了済み状態
    let st = { lastN: 5, done: true };
    // 2業務目/別県: windows が 1 に落ちる → 検知して 1/3 から再表示
    let r = KCalib.decideCalibToast({ windows: 1, confident: false }, st);
    expect(r.toast).toBe('OBD較正中 1/3');
    expect(r.state.done).toBe(false);
    st = r.state;
    // その後 3窓で再び完了1回
    r = KCalib.decideCalibToast({ windows: 3, confident: true, K: 1.02 }, st);
    expect(r.long).toContain('K = 1.020');
  });
});

describe('KCalib serialize/restoreKs (車別K永続化)', () => {
  function steps(K, n) {
    const a = [];
    for (let i = 0; i < n; i++) a.push({ g: 10, v: 10 / K, dt: 1, acc: 5 });
    return a;
  }
  function feed(cal, pairs) {
    for (const p of pairs) cal.addPair(p.g, p.v, p.dt, p.acc);
  }

  it('★serialize→restoreで getK/confident/windows が完全一致(往復不変)★', () => {
    const a = KCalib.createKCalibrator({ calibKm: 1.0 });
    feed(a, steps(1.02, 100));
    feed(a, steps(1.03, 100));
    feed(a, steps(1.025, 100));
    const blob = a.serialize();
    expect(blob.ks.length).toBe(3);
    // 別インスタンスへ復元
    const b = KCalib.createKCalibrator({ calibKm: 1.0, restoreKs: blob.ks });
    expect(b.windows()).toBe(3);
    expect(b.confident()).toBe(true);
    expect(b.getK()).toBeCloseTo(a.getK(), 6);
  });

  it('★復元すれば接続即confident(再較正不要)★', () => {
    const b = KCalib.createKCalibrator({ calibKm: 1.0, restoreKs: [1.02, 1.025, 1.03] });
    expect(b.confident()).toBe(true);
    expect(b.getK()).toBeCloseTo(1.025, 3);
  });

  it('健全域外/非有限/非配列は復元時に捨てる(壊れた保存で誤K焼かない)', () => {
    // 1.5(健全域外),NaN,文字列を混ぜても健全な3個だけ残る
    const b = KCalib.createKCalibrator({
      calibKm: 1.0,
      restoreKs: [1.5, NaN, '1.02', 1.02, 1.025, 1.03],
    });
    expect(b.windows()).toBe(3);
    expect(b.getK()).toBeCloseTo(1.025, 3);
  });

  it('復元データが空/不正なら未較正(getK=null or coldStartK)', () => {
    expect(KCalib.createKCalibrator({ restoreKs: [] }).getK()).toBeNull();
    expect(KCalib.createKCalibrator({ restoreKs: null }).getK()).toBeNull();
    expect(KCalib.createKCalibrator({ restoreKs: 'broken' }).getK()).toBeNull();
    expect(KCalib.createKCalibrator({ restoreKs: [1.02], coldStartK: 1.018 }).getK()).toBe(1.018); // 1窓<3=coldStart
  });

  it('ksCapで直近N窓に丸める(永続肥大防止)', () => {
    const a = KCalib.createKCalibrator({ calibKm: 1.0, ksCap: 5 });
    for (let i = 0; i < 10; i++) feed(a, steps(1.025, 100)); // 10窓
    expect(a.windows()).toBe(5); // capで5に丸め
    expect(a.serialize().ks.length).toBe(5);
  });

  it('restoreKs()メソッドで後から再注入できる', () => {
    const a = KCalib.createKCalibrator({ calibKm: 1.0 });
    expect(a.getK()).toBeNull();
    a.restoreKs([1.02, 1.025, 1.03]);
    expect(a.confident()).toBe(true);
    expect(a.getK()).toBeCloseTo(1.025, 3);
  });
});
