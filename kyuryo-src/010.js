  // ★★今の 日本時間（年・月・日の 欄が 日本時間に なる Date）★★ 2026-10-08（司さん「対応させろや」）
  //   日の 切り方を 給料（payroll-daily.js の 日本時間）と 入力の 画面に 揃える。日本の 端末では 1つも 変わらない
  function jstNow() {
    var t = new Date(Date.now() + 9 * 3600 * 1000);
    return new Date(
      t.getUTCFullYear(),
      t.getUTCMonth(),
      t.getUTCDate(),
      t.getUTCHours(),
      t.getUTCMinutes()
    );
  }
  var SESS = null;
  var COMPANY = null;
  var TAB = 'slip';
  var YM = { year: jstNow().getFullYear(), month: jstNow().getMonth() + 1 };
  var PERIODS = []; // その月の期（司さんは月3回払い＝3つ）
  var PIDX = 0; // いま見ている期
  var PERIOD = null;
  var SET = null; // dk_payroll_settings の行（生）
  var RAW = {
    shifts: [],
    edits: [],
    labels: [],
    employees: [],
    workHours: [],
    manualDays: [], // 手で入れた1日分（スマホが無くても給料を出せる）
    payrollSettings: null,
    // ★人ごとの 歩合・保証・役割の 変えた 記録（何日から）★ 2026-10-18＝null は 読めなかった（計算が 止める）
    rireki: [],
    // ★役割の 決まりの 変えた 記録（何日から）★ 2026-10-18＝null は 読めなかった（計算が 止める）
    yakuRireki: [],
    // ★締めの 形の 変えた 記録（何日から）★ 2026-10-19＝null は 読めなかった（区切りが 止める）
    shimeRireki: [],
  };
  var CTX = null;
  var REP = null;

  // ★画面に出す車の名前 (2026-08-04)★
  //   司さん「売上1の横の英語のやつ邪魔でしょうがない」
  //   名前が無い時に端末ID(UUID)をそのまま出していたのをやめる。
  //   番号は「その会社の端末を並べた順」で決める＝★開くたびに車1と車2が入れ替わらない★。
  var _CAR_NAMES = null;
  function _carNames() {
    if (_CAR_NAMES) return _CAR_NAMES;
    var ids = [];
    // ★★名前を 付けた 車は 走っていなくても 数える★★ 2026-09-04（司さん）
    //   「★なんで 1173って 登録しとるやつが 反映されてないんど★」
    //   ★実測★ 1173（端末 22849fdb）は 倉庫に 登録ずみ。
    //     でも 最後に 走ったのは ★8/3★ ⇒ 9月の 記録には 出てこない
    //     ⇒ ここで 名前の 元に 入らず ★「車」と 出ていた★
    //   ★nameMap の 決まりは「その会社の端末ID全部」★（js/car-name.js）
    //     ＝★走った 記録だけ 渡していたのが 間違い★
    // ★★選ぶ欄に 出す 車と 同じ 元を 使う★★（別々に 数えない）
    //   CTX.devices ＝ 名前を 付けた 車 ＋ 走った 車 ＋ 手で 入れた 車
    //   ★前は ここだけ「走った 記録」しか 見ておらず、
    //     ★登録しただけの 1173 が 「車」と 出ていました★（司さん 2026-09-04）
    ((CTX && CTX.devices) || []).forEach(function (d) {
      if (typeof d === 'string' && d) ids.push(d);
    });
    // ★CTX が まだ 出来ていない時の 逃げ道★（同じ 物を 直に 集める）
    (RAW.labels || []).forEach(function (l) {
      if (l && typeof l.device_id === 'string' && l.device_id) ids.push(l.device_id);
    });
    (RAW.shifts || []).forEach(function (s) {
      if (s && typeof s.device_id === 'string' && s.device_id) ids.push(s.device_id);
    });
    (RAW.workHours || []).forEach(function (w) {
      if (w && typeof w.device_id === 'string' && w.device_id) ids.push(w.device_id);
    });
    (RAW.manualDays || []).forEach(function (m) {
      if (m && typeof m.device_id === 'string' && m.device_id) ids.push(m.device_id);
    });
    _CAR_NAMES = window.CarName ? window.CarName.nameMap(ids, RAW.labels) : {};
    return _CAR_NAMES;
  }
  function _carName(deviceId) {
    var m = _carNames();
    return m[deviceId] || '車'; // ★どんな時もUUIDは出さない★
  }

  var $ = function (id) {
    return document.getElementById(id);
  };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c];
    });
  }
  function showErr(m) {
    // 期の 計算が 転んだ 間は 他の 成功で 訳を 消さない（対立役 3回目 直す-2：画面が 直って 見えるのに 断られた）
    if (!m && typeof KEISAN_NG !== 'undefined' && KEISAN_NG) m = KEISAN_NG_JI;
    $('err').textContent = m || '';
    $('err').style.display = m ? 'block' : 'none';
  }
