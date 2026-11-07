  // ★★役割の 名前の 直しの 控え★★ 2026-10-17
  //   前は 名前を 直すと 決まりの 鍵だけ 変わり、人の 役割（辞めた 人も）は 古い 名前の まま＝
  //   歩合0・保証0で 計算されていた。保存の 時に 倉庫の 関数 dk_yaku_namae_naoshi が
  //   決まり・日給/段階歩合・人の 役割を 1つの 取引で 一緒に 直す。
  //   YAKU_MOTO＝{ 今の 名前: 読み込んだ 時の 名前 }（A→B→C や 入れ替えも 読み込んだ 名前から 数える）
  var YAKU_MOTO = {};
  var YAKU_YOMI = []; // 読み込んだ 時の 役割の 名前
  function yakuMotoKesu() {
    YAKU_MOTO = {};
    // 設定の 行が まだ 無い 会社も 画面は 既定の 役割を 出している＝その 名前を 直したら 人も 直す（対立役 S2）
    YAKU_YOMI =
      SET && SET.yomenai ? [] : Object.keys(PayrollDaily.normSettings(SET, RAW.shimeRireki).roles);
  }
  // その 役割の 人（辞めた 人も）の 名前。人の 役割は 保存までは 読み込んだ 時の 名前の まま
  function yakuNoHito(r) {
    var moto = Object.prototype.hasOwnProperty.call(YAKU_MOTO, r) ? YAKU_MOTO[r] : r;
    return (RAW.employees || [])
      .filter(function (e) {
        if (!Array.isArray(RAW.rireki)) return true; // ★記録を 読めない 時は 全員を「使う 人」に 数える＝消させない★
        // ★変えた 記録で その 役割に なる 人も★（何日から・10-18＝記録だけで 使う 役割を 消すと その 日から 止まる）
        return (
          e &&
          ((e.role || '') === moto ||
            (RAW.rireki || []).some(function (x) {
              return x && x.employee_id === e.employee_id && x.key === 'role' && x.value === moto;
            }))
        );
      })
      .map(function (e) {
        return (e.name || '名前の 無い 人') + (e.active === false ? '（退職）' : '');
      });
  }
  // 倉庫へ 送る { 読み込んだ 時の 名前: 今の 名前 }（この 画面で 足した 役割は 倉庫に 無いので 入れない）
  function yakuMap() {
    var m = {};
    Object.keys(YAKU_MOTO).forEach(function (ima) {
      var moto = YAKU_MOTO[ima];
      if (moto !== ima && YAKU_YOMI.indexOf(moto) >= 0) m[moto] = ima;
    });
    return m;
  }
  // ★倉庫の 時刻を ミリ秒に★（'2026-08-06 14:59:12.00606+00' と ISO の 'Z' を 同じ 数に 読む・空は null）
  //   読めない 字は 字の まま 返す（数に ならない 物どうしを 同じと 見ない＝NaN !== NaN で 毎回 止まらない 様に）
  function tokiMs(v) {
    if (v === null || v === undefined || v === '') return null;
    var t = String(v)
      .replace(' ', 'T')
      .replace(/([+-]\d\d)$/, '$1:00')
      .replace(/(\.\d{3})\d+/, '$1');
    var ms = Date.parse(t);
    return isNaN(ms) ? String(v) : ms;
  }
  var YAKU_NAOSHI_WAKE = {
    not_yours: '自分の 会社では ありません',
    exists: '直さない 役割と 同じ 名前に なります',
    dup: '同じ 名前が 2つ に なります',
    not_found:
      '直す 前の 役割が 見つかりません（他の 画面で 変わった かも しれません。開き直してください）',
    blank: '名前が 空です',
    empty: '直す 物が ありません',
    no_roles: '役割の 決まりが 読めません',
    kiroku_nokori:
      'その 名前の 役割の 変えた 記録が 残っています。「給料の 設定」の 残った 記録を 消してから 直してください',
  };

