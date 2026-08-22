// js/dk-migrate.js
// ============================================================
// ★今回限りの「引っ越し」（2026-08-22）★
//
//   ★なぜ在るか★
//     2026-08-21、司さんの端末3台が ★テストのアドレス(daikou-app-test)★ に入っていた。
//     ダイコメは ★較正K・車の一覧・端末ID・営業の履歴・設定を アドレスごとに持つ★ ので、
//     本番のQRを読み直すと ★全部やり直し（較正はOBDを繋いで走り直し）★ になる。
//     ⇒ ★読み直させない。中身をそのまま本番へ運ぶ★ 為の物。
//
//   ★今回限りである事★
//     テスト版は 2026-08-21 から ★ホーム画面に入れられない(display=browser)★・
//     事務所は ★反対側のQRを出せない★ ので、同じ状態は もう作れない。
//     ⇒ ★常設しない★。★撤去の期限 = 2026-09-30★。
//        期限を過ぎて残っていたら ★tests/unit/migrate-removal-deadline.test.js が赤になる★。
//        （「やめると決めた物が26日 生き続けた」を二度とやらない為。口約束にしない）
//
//   ★守る事★
//     ・受け取るのは ★送り元がテスト線の時だけ★（origin を1つずつ突き合わせる）
//     ・★既に中身が在るキーは 1つも上書きしない★（本番で使っている端末を壊さない）
//     ・★走行中の状態(daikou_driving_state)は運ばない★（途中の走行を別の端末で復活させない）
//     ・distance_m / 料金には一切 触れない（保存層だけ）
// ============================================================
(function () {
  'use strict';

  let TEST_ORIGIN = 'https://daikou-app-test.vercel.app';
  let PROD_ORIGIN = 'https://daikou-app.vercel.app';

  // ★手元で実際に押して確かめる為の逃げ道★
  //   localhost の時だけ。★本物の2つのアドレスでは 上の定数から1文字も動かない★
  const isLocal =
    typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname || '');
  if (isLocal) {
    const q = new URLSearchParams(location.search);
    if (q.get('from')) TEST_ORIGIN = q.get('from');
    if (q.get('to')) PROD_ORIGIN = q.get('to');
  }

  // ★運ぶ物（一覧に書く。勝手に全部は運ばない）★
  const KEYS = [
    'dk_veh_list', // 車の一覧（★較正K = calibKs はこの中★）
    'dk_veh_active_id', // 選んでいる車
    'dk_veh_active', // 旧・単一の車（移行元）
    'DAIKOME_DEVICE_ID', // ★端末ID（これを運ぶので 席は増えない）★
    'DAIKOME_DEVICE_LABEL',
    'daikou_business_history', // 営業の履歴（30日）
    'daikou_business_state',
    'daikou_today',
    'daikou_settings',
    'daikou_discounts',
    'daikou_extras',
    'daikou_last_start',
    'dk_can_wheel_map',
    'dk_customers_cache',
    'daikome_anonymous_id',
    'DK_AUTO_CALIB_K_OFF',
  ];
  const PREFIXES = ['dk_veh_', 'dk_wsmap_'];
  // ★運ばない物★（理由つき）
  //   daikou_driving_state … 走行中の状態。運ぶと 別の端末で走行が復活する
  //   daikou_gh_pat        … 鍵。運ばない
  const NEVER = ['daikou_driving_state', 'daikou_gh_pat'];

  function wanted(k) {
    if (!k) return false;
    if (NEVER.indexOf(k) >= 0) return false;
    if (KEYS.indexOf(k) >= 0) return true;
    for (let i = 0; i < PREFIXES.length; i++) if (k.indexOf(PREFIXES[i]) === 0) return true;
    return false;
  }

  function collect(store) {
    const out = {};
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (wanted(k)) out[k] = store.getItem(k);
    }
    return out;
  }

  // ★何が運べたかを「人の言葉」で数える★（キーの数ではなく 車の台数・較正済み・履歴の日数）
  function summarize(store) {
    let cars = [];
    try {
      cars = JSON.parse(store.getItem('dk_veh_list') || '[]') || [];
    } catch (_) {
      cars = [];
    }
    if (!Array.isArray(cars)) cars = [];
    let calibrated = 0;
    for (let i = 0; i < cars.length; i++) {
      const ks = cars[i] && cars[i].calibKs;
      if (Array.isArray(ks) && ks.length >= 3) calibrated++;
    }
    let days = 0;
    try {
      const h = JSON.parse(store.getItem('daikou_business_history') || '[]');
      if (Array.isArray(h)) days = h.length;
    } catch (_) {
      days = 0;
    }
    return {
      cars: cars.length,
      calibrated: calibrated,
      days: days,
      deviceId: store.getItem('DAIKOME_DEVICE_ID') || '',
    };
  }

  // ★「在る」と「空っぽ」を分ける★
  //   2026-08-22 実測：本番のアプリは 開いた瞬間に自分で
  //   dk_veh_list='[]' / DAIKOME_DEVICE_ID=新しい番号 / daikou_business_state … を書く。
  //   ★これを「もう在る」と読むと、引っ越しが1件も入らない★
  //   （実際に押して確かめたら ★車0台・端末IDは新しい番号★ になった＝5台目になる所だった）
  function hasReal(store, k) {
    const v = store.getItem(k);
    if (v === null) return false;
    const t = String(v).trim();
    return !(t === '' || t === '[]' || t === '{}' || t === 'null' || t === 'undefined');
  }

  // ★この端末（受け取る側）は まだ使われていないか★
  //   車が0台 かつ 営業の履歴が0日 = ★開いただけの端末★ → 引っ越しの中身で丸ごと入れ替える
  //   1台でも車が在る / 履歴が在る = ★本番で使っている端末★ → 空いている所だけ埋める
  function isFresh(store) {
    const s = summarize(store);
    return s.cars === 0 && s.days === 0;
  }

  // 端末IDを引き継いだ時に消す物（古い判定が残ると ライセンスが通らない）
  const CLEAR_ON_TAKEOVER = ['DAIKOME_LICENSE_CACHE'];

  // ★受け取る側（本番）★
  function apply(store, data) {
    const wrote = [];
    const kept = [];
    const fresh = isFresh(store);
    let tookOverDevice = false;
    for (const k in data) {
      if (!Object.prototype.hasOwnProperty.call(data, k)) continue;
      if (!wanted(k)) continue; // 一覧に無い物は受け取らない
      if (!fresh && hasReal(store, k)) {
        kept.push(k); // ★本番で使っている端末の中身は 1つも上書きしない★
        continue;
      }
      try {
        const wasDevice = k === 'DAIKOME_DEVICE_ID' && store.getItem(k) !== data[k];
        store.setItem(k, data[k]);
        wrote.push(k);
        if (wasDevice) tookOverDevice = true;
      } catch (_) {
        /* 満杯などは 下の数で分かる */
      }
    }
    if (tookOverDevice && typeof store.removeItem === 'function') {
      for (let j = 0; j < CLEAR_ON_TAKEOVER.length; j++) {
        try {
          store.removeItem(CLEAR_ON_TAKEOVER[j]);
        } catch (_) {
          /* 消せなくても 次の確認で取り直す */
        }
      }
    }
    return { wrote: wrote, kept: kept, fresh: fresh, tookOverDevice: tookOverDevice, after: summarize(store) };
  }

  const api = {
    TEST_ORIGIN: TEST_ORIGIN,
    PROD_ORIGIN: PROD_ORIGIN,
    KEYS: KEYS,
    PREFIXES: PREFIXES,
    NEVER: NEVER,
    wanted: wanted,
    hasReal: hasReal,
    isFresh: isFresh,
    collect: collect,
    summarize: summarize,
    apply: apply,
  };

  // eslint-disable-next-line no-undef -- Node で試験する為の出口（js/veh-registry.js と同じ書き方）
  if (typeof module === 'object' && module.exports) {
    // eslint-disable-next-line no-undef
    module.exports = api;
    return;
  }
  if (typeof window === 'undefined') return;
  window.DKMigrate = api;

  // ------------------------------------------------------------
  // 画面（1枚だけ・押す物は1つ）
  // ------------------------------------------------------------
  function panel(title) {
    const d = document.createElement('div');
    d.id = 'dkMigratePanel';
    d.setAttribute(
      'style',
      'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;background:#ffffff;' +
        'color:#333333;font-family:"Noto Sans JP",sans-serif;padding:24px 18px;overflow:auto'
    );
    const h = document.createElement('div');
    h.setAttribute('style', 'font-size:18px;font-weight:700;color:#333333;margin-bottom:14px');
    h.textContent = title;
    const body = document.createElement('div');
    body.id = 'dkMigrateBody';
    body.setAttribute('style', 'font-size:15px;line-height:1.9;color:#333333');
    d.appendChild(h);
    d.appendChild(body);
    document.body.appendChild(d);
    return body;
  }

  function line(body, text, strong) {
    const p = document.createElement('div');
    p.setAttribute(
      'style',
      'margin:6px 0;color:#333333;' + (strong ? 'font-weight:700;font-size:16px' : '')
    );
    p.textContent = text;
    body.appendChild(p);
    return p;
  }

  function bigButton(label, bg, fg, border) {
    const b = document.createElement('button');
    b.setAttribute(
      'style',
      'margin-top:14px;width:100%;padding:16px;font-size:17px;font-weight:700;border-radius:12px;' +
        'background:' +
        bg +
        ';color:' +
        fg +
        ';border:' +
        (border || '0')
    );
    b.textContent = label;
    return b;
  }

  // ------------------------------------------------------------
  // 本番側 = 受け取る（?migrate=1 の時だけ動く）
  // ------------------------------------------------------------
  function startReceiver() {
    const body = panel('本番へ引っ越しています');
    const wait = line(body, 'テスト版から中身を受け取っています…');
    let done = false;
    window.addEventListener('message', function (ev) {
      if (ev.origin !== TEST_ORIGIN) return; // ★送り元がテスト線の時だけ★
      const m = ev.data;
      if (!m || m.type !== 'DK_MIGRATE_DATA') return;
      const res = apply(window.localStorage, m.data || {});
      done = true;
      try {
        if (ev.source) ev.source.postMessage({ type: 'DK_MIGRATE_DONE', result: res }, TEST_ORIGIN);
      } catch (_) {
        /* 送り返せなくても こちらの画面には出す */
      }
      if (wait.parentNode) wait.parentNode.removeChild(wait);
      line(body, '引っ越しました。', true);
      line(body, '車 ' + res.after.cars + ' 台（うち較正済み ' + res.after.calibrated + ' 台）');
      line(body, '営業の履歴 ' + res.after.days + ' 日ぶん');
      line(
        body,
        '端末の番号 ' +
          (res.after.deviceId ? res.after.deviceId.slice(0, 8) + '…' : '（無し）') +
          // ★2026-08-22 実際に押して読んだら 言葉が逆だった★
          //   アプリは開いた瞬間に自分で端末IDを作るので「元から在った」が常に出ていた。
          //   ★実際に引き継いだか(tookOverDevice)で言い分ける★
          (res.tookOverDevice
            ? '（テスト版から引き継ぎました＝席は増えません）'
            : '（この端末に元から在った物を そのまま使いました）')
      );
      if (res.kept.length) {
        line(body, 'この端末に元から在った物は そのままにしました（' + res.kept.length + ' 件）');
      }
      const b = bigButton('ダイコメを開く', '#007aff', '#ffffff');
      b.id = 'dkMigrateOpen';
      b.onclick = function () {
        location.replace(PROD_ORIGIN + '/');
      };
      body.appendChild(b);
    });
    try {
      if (window.opener) window.opener.postMessage({ type: 'DK_MIGRATE_READY' }, TEST_ORIGIN);
    } catch (_) {
      /* 開き方が違う時は下の案内が出る */
    }
    setTimeout(function () {
      if (!done && wait.parentNode) {
        wait.textContent =
          'テスト版からの引っ越しではない為、受け取る物がありません。' +
          'テスト版の赤い帯の「本番へ引っ越す」から開いてください。';
      }
    }, 8000);
  }

  // ------------------------------------------------------------
  // テスト側 = 送る
  // ------------------------------------------------------------
  function startSender() {
    if (document.getElementById('dkMigratePanel')) return;
    const mine = summarize(window.localStorage);
    const data = collect(window.localStorage);
    const body = panel('本番へ引っ越します');
    line(body, 'この端末（テスト版）に入っている物：');
    line(body, '車 ' + mine.cars + ' 台（うち較正済み ' + mine.calibrated + ' 台）');
    line(body, '営業の履歴 ' + mine.days + ' 日ぶん');
    line(body, 'これを本番へ そのまま運びます。較正のやり直しはありません。', true);

    const status = line(body, '');
    let sent = false;
    function onMsg(ev) {
      if (ev.origin !== PROD_ORIGIN) return;
      const m = ev.data;
      if (m && m.type === 'DK_MIGRATE_READY' && !sent) {
        sent = true;
        try {
          ev.source.postMessage({ type: 'DK_MIGRATE_DATA', data: data }, PROD_ORIGIN);
        } catch (_) {
          status.textContent = '運べませんでした。もう一度 押してください。';
        }
      }
      if (m && m.type === 'DK_MIGRATE_DONE' && m.result) {
        status.textContent =
          '本番へ運びました（車 ' +
          m.result.after.cars +
          ' 台・較正済み ' +
          m.result.after.calibrated +
          ' 台）。開いた本番の画面を そのまま使ってください。';
      }
    }
    window.addEventListener('message', onMsg);

    const go = bigButton('本番へ引っ越す', '#007aff', '#ffffff');
    go.id = 'dkMigrateGo';
    go.onclick = function () {
      status.textContent = '本番を開いています…';
      let url = PROD_ORIGIN + '/?migrate=1';
      // 手元で押して確かめる時だけ、相手にも同じ2つのアドレスを渡す（本物では付かない）
      if (isLocal) {
        url += '&from=' + encodeURIComponent(TEST_ORIGIN) + '&to=' + encodeURIComponent(PROD_ORIGIN);
      }
      const w = window.open(url, 'dkMigrate');
      if (!w) {
        status.textContent =
          '本番の画面が開けませんでした（ブラウザに止められました）。もう一度 押してください。';
      }
    };
    body.appendChild(go);

    const cancel = bigButton('やめる', '#ffffff', '#333333', '1px solid #c7c7cc');
    cancel.id = 'dkMigrateCancel';
    cancel.onclick = function () {
      const el = document.getElementById('dkMigratePanel');
      if (el && el.parentNode) el.parentNode.removeChild(el);
      window.removeEventListener('message', onMsg);
    };
    body.appendChild(cancel);
  }

  api.startSender = startSender;
  window.DKMigrateStart = startSender;

  function boot() {
    if (location.search.indexOf('migrate=1') >= 0 && (location.origin === PROD_ORIGIN || isLocal)) {
      startReceiver();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
