'use strict';
// ============================================================
// ★業務の 記録が 保存できない 時に 黙って 消さない（10-11）★
//   前は ①業務終了で 履歴に 積めない（端末の 空きが 足りない・履歴が 壊れている）と、
//   次の 業務開始の abandon() が 積み直しに 転んでも state を 消した＝その晩の 業務が
//   事務所へ 上がらずに 消えた（代行10件・25,000円の 業務で 測ると 履歴に 残るのは 0円の 1件）。
//   ②壊れた 履歴は 毎回 積めなかった。③2回目の end() が 終了時刻を 書き直し 勤務時間が 伸びた。
//   ④save() の 失敗は dlog だけ。
//   ★本物の js/business.js を 回す★（写しを 持たない）。画面の 側は 本物の 字で 縛る。
//   ★積めない 時に 業務開始を 止める 形は やめた★：いつも 書けない 端末（非公開の 閲覧 等）では 毎晩 働けない
//     行き止まりに なる。⇒ 始めて、積めなかった 報告は mae_tsumenai に 持ち越し、業務終了・次の 開始の 度に 積み直す。
//   ★持ち越しは state に 入れず 別の 鍵（dk_business_mae_tsumenai）に 業務開始・終了の 時だけ 書く★（state に 入れると
//     1秒ごとの 保存が 膨らみ、満杯の 端末で 欠けた 晩が 届いた＝下の 字数の 上限つき 倉庫の 試験で 縛る）。
//   ★持ち越しが 鍵に 書けて いない 時は「閉じると 消える」と 言う（mae_kakenai は 書けた 結果で 決める）★
//   ★読めない 持ち越しの 鍵は 退けてから 空に・壊れた 字の 写しは 同じ 字なら 同じ 鍵★（直す 前の 版で 2本 赤を 確かめた）
//   ★読めない 字を 退けられない 間は 鍵に 触らない・業務中の load() で 手元にしか 無い 持ち越しを 消さない★（直す 前の 版で 2本 赤）
//   ★わざと壊して 赤に なった 記録（10-11・22通り 全部 赤）★：書けない 印を 立てない 1本／開始で 知らせを 呼ばない 1本／知らせが 印を 見ない 1本／終了の 知らせが 印を 見ない 1本／持ち越しを state に 入れる 1本／鍵に 書かない 2本／abandon の 守りを 外す 1本／start で 持ち越さない 4本／
//     持ち越しを 引き継がない 1本／end で 持ち越しを 積み直さない 2本／load で 戻さない 1本／2回目 end で 時刻を 書き直す 1本／
//     壊れを 退けない 3本／退けずに 上書き 3本／中身の 無い 札を 落とさない 2本／知らせを 毎回 1本／新しい 業務で 印を 戻さない 1本／
//     save が true を 返さない 1本／画面の 持ち越し知らせを 外す 1本／終了で 持ち越しを 見ない 1本／終了の 知らせを 外す 1本／送る 結果を 出す 1本。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BJS = path.join(ROOT, 'js', 'business.js');
const H = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const HK = 'daikou_business_history';

function makeStorage() {
  const m = {};
  let dame = () => false;
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null),
    setItem: (k, v) => {
      if (dame(k)) {
        const e = new Error('QuotaExceededError');
        e.name = 'QuotaExceededError';
        throw e;
      }
      m[k] = String(v);
    },
    removeItem: (k) => {
      delete m[k];
    },
    key: (i) => Object.keys(m)[i] || null,
    get length() {
      return Object.keys(m).length;
    },
    m,
    setDame(f) {
      dame = f;
    },
  };
}

function makeMeter() {
  const s = {
    business_active: false,
    business_distance_m: 0,
    business_display_distance_m: 0,
    distance_m: 0,
  };
  return {
    getState: () => s,
    setBusinessActive: (v) => {
      s.business_active = !!v;
    },
    setBusinessDistance: (v) => {
      s.business_distance_m = v;
      s.business_display_distance_m = v;
    },
  };
}

function load(storage) {
  global.localStorage = storage;
  global.Meter = makeMeter();
  delete require.cache[require.resolve(BJS)];
  return require(BJS);
}
const hist = (s) => {
  try {
    return JSON.parse(s.getItem(HK) || '[]');
  } catch (_) {
    return null;
  }
};
const zenbu = () => true;
const rirekiDake = (k) => k === HK;

function hitoban(B) {
  B.start();
  for (let i = 0; i < 10; i++) B.onTripEnd(1000, 2500, Date.now());
}

describe('★業務の 記録が 保存できない 時に 黙って 消さない（10-11）★', () => {
  it('終了で 積めず・次の 開始でも 積めない → 始まる（行き止まりに しない）・前の 25,000円は 持ち越す → 空きが できた 業務終了で 2件 積む', () => {
    const ls = makeStorage();
    const B = load(ls);
    hitoban(B);
    ls.setDame(rirekiDake);
    B.end();
    expect(B.getState().history_pushed).toBe(false);
    expect(B.start()).toBe(true);
    expect(B.getState().active).toBe(true);
    const mae = B.getState().mae_tsumenai;
    expect(mae.length).toBe(1);
    expect({ f: mae[0].fare_total_yen, c: mae[0].trip_count }).toEqual({ f: 25000, c: 10 });
    for (let i = 0; i < 2; i++) B.onTripEnd(1000, 3000, Date.now());
    ls.setDame(() => false);
    B.end();
    expect(B.getState().mae_tsumenai.length).toBe(0);
    const h = hist(ls);
    expect(h.map((x) => x.fare_total_yen).sort()).toEqual([25000, 6000]);
    B.start(); // 次の 開始で 増えない
    expect(hist(ls).length).toBe(2);
  });

  it('いつも 書けない 端末（非公開の 閲覧 等）でも 毎晩 始められる・持ち越しは 手元で 溜まる', () => {
    const ls = makeStorage();
    const B = load(ls);
    ls.setDame(zenbu);
    for (let n = 0; n < 3; n++) {
      expect(B.start()).toBe(true);
      B.onTripEnd(1000, 2500, Date.now());
      B.end();
    }
    expect(B.getState().mae_tsumenai.length).toBe(2);
    expect(B.start()).toBe(true);
    expect(B.getState().mae_tsumenai.length).toBe(3);
  });

  it('持ち越しは 開き直し（load）でも 消えない', () => {
    const ls = makeStorage();
    let B = load(ls);
    hitoban(B);
    ls.setDame(rirekiDake);
    B.end();
    B.start();
    B = load(ls); // 開き直し
    B.load();
    expect(B.getState().mae_tsumenai.length).toBe(1);
    expect(B.getState().mae_tsumenai[0].fare_total_yen).toBe(25000);
    ls.setDame(() => false);
    B.end();
    expect(hist(ls).some((x) => x.fare_total_yen === 25000)).toBe(true);
  });

  it('abandon() は 積めなければ false で state を 消さない', () => {
    const ls = makeStorage();
    const B = load(ls);
    hitoban(B);
    ls.setDame(rirekiDake);
    B.end();
    expect(B.abandon()).toBe(false);
    expect(B.getState().start_time).not.toBe(null);
    expect(B.getState().fare_total_yen).toBe(25000);
  });

  for (const kowareta of ['{bad', '{"a":1}', 'null']) {
    it(`壊れた 履歴（${kowareta}）→ 退けて 積む（毎晩 積めない・始められない に ならない）・退けた 字は 残す`, () => {
      const ls = makeStorage();
      ls.m[HK] = kowareta;
      const B = load(ls);
      hitoban(B);
      B.end();
      expect(B.getState().history_pushed).toBe(true);
      expect(hist(ls).length).toBe(1);
      expect(hist(ls)[0].fare_total_yen).toBe(25000);
      const nokoshi = Object.keys(ls.m).filter((k) =>
        k.startsWith('dk_business_history_kowareta_')
      );
      expect(nokoshi.length).toBe(1);
      expect(ls.m[nokoshi[0]]).toBe(kowareta);
      expect(B.start()).toBe(true);
    });
  }

  for (const nakami of [
    '[null]',
    '[{"start_time":1,"end_time":2,"fare_total_yen":100}, null, 5]',
  ]) {
    it(`履歴に 中身の 無い 札（${nakami.length}字）→ 落として 積む・元の 業務は 残す・次も 始まる`, () => {
      const ls = makeStorage();
      ls.m[HK] = nakami;
      const B = load(ls);
      hitoban(B);
      B.end();
      expect(B.getState().history_pushed).toBe(true);
      const h = hist(ls);
      expect(h.every((x) => x && typeof x === 'object')).toBe(true);
      expect(h[0].fare_total_yen).toBe(25000);
      expect(h.length).toBe(nakami.startsWith('[null]') ? 1 : 2);
      expect(B.start()).toBe(true);
    });
  }

  it('壊れた 履歴で 履歴に 書けない まま 5晩 回しても 退けた 写しは 1本（呼ぶ 度に 増えない）', () => {
    const ls = makeStorage();
    ls.m[HK] = '{bad';
    const B = load(ls);
    ls.setDame(rirekiDake);
    const nowOrig = Date.now;
    let t = nowOrig();
    Date.now = () => (t += 60000); // 晩ごとに 時刻が 進む（同じ ミリ秒で 鍵が 重なって 緑に ならない）
    try {
      for (let n = 0; n < 5; n++) {
        B.start();
        B.onTripEnd(1000, 2500, Date.now());
        B.end();
      }
    } finally {
      Date.now = nowOrig;
    }
    const nokoshi = Object.keys(ls.m).filter((k) => k.startsWith('dk_business_history_kowareta_'));
    expect(nokoshi.length).toBe(1);
    expect(ls.m[nokoshi[0]]).toBe('{bad');
  });

  it('読めない 持ち越しの 鍵は 退けてから 空に する（黙って 消さない）', () => {
    const ls = makeStorage();
    ls.m.dk_business_mae_tsumenai = '[{"start_time":1,"fare';
    const B = load(ls);
    B.load();
    expect(B.getState().mae_tsumenai.length).toBe(0);
    hitoban(B);
    B.end(); // 持ち越しが 空＝鍵を 消す
    expect(ls.m.dk_business_mae_tsumenai).toBe(undefined);
    const nokoshi = Object.keys(ls.m).filter((k) =>
      k.startsWith('dk_business_mae_tsumenai_kowareta_')
    );
    expect(nokoshi.length).toBe(1);
    expect(ls.m[nokoshi[0]]).toBe('[{"start_time":1,"fare');
  });

  it('読めない 持ち越しを 退ける 空きも 無い → 鍵を 消さない・上書きしない', () => {
    const ls = makeStorage();
    ls.m.dk_business_mae_tsumenai = '{x';
    ls.setDame((k) => k.startsWith('dk_business_mae_tsumenai_kowareta_'));
    const B = load(ls);
    B.load();
    hitoban(B);
    B.end();
    B.start();
    expect(ls.m.dk_business_mae_tsumenai).toBe('{x');
  });

  it('手元にしか 無い 持ち越しは 業務中の load()（便の 直し）で 消えず・印も 下りない → 空きが できたら 積む', () => {
    const ls = makeStorage();
    const B = load(ls);
    hitoban(B);
    ls.setDame((k) => k === HK || k === 'dk_business_mae_tsumenai');
    B.end();
    B.start();
    expect(B.getState().mae_kakenai).toBe(true);
    B.load(); // js/trip-edit.js が 便を 直した 後に 呼ぶ
    expect(B.getState().mae_tsumenai.length).toBe(1);
    expect(B.getState().mae_kakenai).toBe(true);
    ls.setDame(() => false);
    B.end();
    expect(hist(ls).some((x) => x.fare_total_yen === 25000)).toBe(true);
    expect(B.getState().mae_tsumenai.length).toBe(0);
  });

  it('読めない 持ち越しを 退けられず・持ち越しが 在る → 「閉じると 消える」の 印が 立つ', () => {
    const ls = makeStorage();
    ls.m.dk_business_mae_tsumenai = '{x';
    ls.setDame((k) => k === HK || k.startsWith('dk_business_mae_tsumenai_kowareta_'));
    const B = load(ls);
    B.load();
    hitoban(B);
    B.end();
    B.start();
    expect(B.getState().mae_tsumenai.length).toBe(1);
    expect(B.getState().mae_kakenai).toBe(true);
    expect(ls.m.dk_business_mae_tsumenai).toBe('{x');
  });

  it('手元 [A,B]・倉庫 [A] で 業務中の load() → 重ねず 2件・空きが できたら 同じ 晩の 2件 無し', () => {
    const ls = makeStorage();
    const nowOrig = Date.now;
    let t = nowOrig();
    Date.now = () => (t += 60000);
    try {
      const B = load(ls);
      hitoban(B); // 晩 A
      ls.setDame(rirekiDake);
      B.end();
      B.start(); // A を 持ち越し・鍵に 書ける
      expect(JSON.parse(ls.m.dk_business_mae_tsumenai).length).toBe(1);
      B.onTripEnd(1000, 3000, Date.now()); // 晩 B
      ls.setDame((k) => k === HK || k === 'dk_business_mae_tsumenai');
      B.end();
      B.start(); // 手元 [A,B]・倉庫 [A]
      expect(B.getState().mae_tsumenai.length).toBe(2);
      B.load();
      expect(B.getState().mae_tsumenai.length).toBe(2);
      ls.setDame(() => false);
      B.end();
      const kazu = {};
      hist(ls).forEach((r) => {
        kazu[r.start_time] = (kazu[r.start_time] || 0) + 1;
      });
      expect(Object.values(kazu).every((c) => c === 1)).toBe(true);
      expect(hist(ls).length).toBe(3);
    } finally {
      Date.now = nowOrig;
    }
  });

  it('壊れた 履歴を 退ける 空きも 無い → 積めない（壊れた 字は 上書きしない）', () => {
    const ls = makeStorage();
    ls.m[HK] = '{bad';
    const B = load(ls);
    hitoban(B);
    ls.setDame((k) => k === HK || k.startsWith('dk_business_history_kowareta_'));
    B.end();
    expect(B.getState().history_pushed).toBe(false);
    expect(ls.m[HK]).toBe('{bad');
    expect(B.start()).toBe(true); // 始まる・前の 業務は 持ち越す
    expect(B.getState().mae_tsumenai.length).toBe(1);
    expect(ls.m[HK]).toBe('{bad');
  });

  it('積めなかった 業務の 2回目の end() は 終了時刻を 変えない（勤務時間が 伸びない）・積めたら 1件', () => {
    const ls = makeStorage();
    const B = load(ls);
    hitoban(B);
    ls.setDame(rirekiDake);
    B.end();
    const t1 = B.getState().end_time;
    const e1 = B.getReport().elapsed_sec;
    const nowOrig = Date.now;
    Date.now = () => nowOrig() + 3600 * 1000; // 日報画面に 1時間 いた
    try {
      ls.setDame(() => false);
      B.end();
    } finally {
      Date.now = nowOrig;
    }
    expect(B.getState().end_time).toBe(t1);
    expect(B.getState().history_pushed).toBe(true);
    expect(hist(ls).length).toBe(1);
    expect(hist(ls)[0].elapsed_sec).toBe(e1);
    B.end(); // 3回目も 増えない
    expect(hist(ls).length).toBe(1);
  });

  it('save() の 失敗は 1つの 業務で 1回だけ 知らせる・新しい 業務で もう一度', () => {
    const ls = makeStorage();
    const B = load(ls);
    let n = 0;
    B.onHozonShippai(() => n++);
    B.start();
    ls.setDame((k) => k !== HK);
    for (let i = 0; i < 5; i++) expect(B.save()).toBe(false);
    expect(n).toBe(1);
    ls.setDame(() => false);
    expect(B.save()).toBe(true);
    ls.setDame((k) => k !== HK);
    B.save();
    expect(n).toBe(1); // 揺れても 同じ 業務では 1回
    ls.setDame(() => false);
    B.end();
    B.start();
    ls.setDame((k) => k !== HK);
    B.save();
    expect(n).toBe(2);
  });

  it('全部 書けない 端末でも 転ばない（start は false でなく 業務は 手元で 動く）', () => {
    const ls = makeStorage();
    const B = load(ls);
    ls.setDame(zenbu);
    expect(() => hitoban(B)).not.toThrow();
    expect(B.getState().fare_total_yen).toBe(25000);
  });

  it('画面：業務開始の すぐ 後で 持ち越しを 知らせる（止めない・本物の 字で 縛る）', () => {
    const i = H.indexOf('function onBusinessStart()');
    const body = H.slice(i, H.indexOf('\n      }\n', i));
    expect(body).toMatch(/Business\.start\(\);\s*_maeShirase\(\);/);
  });

  // ★本物の _maeShirase を index.html から 切り出して 回す★
  function maeShirase(bs) {
    const i = H.indexOf('function _maeShirase() {');
    const f = H.slice(i, H.indexOf('\n      }\n', i) + 8);
    const deta = [];
    // eslint-disable-next-line no-new-func
    new Function('Business', 'showToastLong', f + '\n_maeShirase();')({ getState: () => bs }, (m) =>
      deta.push(m)
    );
    return deta;
  }

  it('画面：持ち越しが 端末に 書けて いない 時は「閉じると 消える」・書けて いれば「もう一度 保存」・無ければ 出さない', () => {
    expect(maeShirase({ mae_tsumenai: [] })).toEqual([]);
    const kakenai = maeShirase({ mae_tsumenai: [{}], mae_kakenai: true });
    expect(kakenai.length).toBe(1);
    expect(kakenai[0]).toMatch(/^前の 業務が まだ 端末に 保存できていません/);
    expect(kakenai[0]).toMatch(/アプリを 閉じると 前の 業務が 消えます/);
    expect(kakenai[0]).not.toMatch(/もう一度 保存します/);
    const kaketa = maeShirase({ mae_tsumenai: [{}], mae_kakenai: false });
    expect(kaketa[0]).toMatch(/業務終了の 時に もう一度 保存します/);
    expect(kaketa[0]).not.toMatch(/閉じると/);
  });

  it('持ち越しの 鍵が 書けない → mae_kakenai・書ける → 消える 印は 立たない・開き直しで 読めたら 書けている', () => {
    const ls = makeStorage();
    let B = load(ls);
    hitoban(B);
    ls.setDame((k) => k === HK || k === 'dk_business_mae_tsumenai');
    B.end();
    B.start();
    expect(B.getState().mae_tsumenai.length).toBe(1);
    expect(B.getState().mae_kakenai).toBe(true);
    ls.setDame(rirekiDake);
    B.end(); // 鍵は 書ける・履歴は まだ だめ
    expect(B.getState().mae_tsumenai.length).toBe(1);
    expect(B.getState().mae_kakenai).toBe(false);
    B = load(ls);
    B.load();
    expect(B.getState().mae_tsumenai.length).toBe(1);
    expect(B.getState().mae_kakenai).toBe(false);
  });

  it('画面：業務終了で 積めていなければ（持ち越しも）知らせ・送る 結果の 知らせは 出さない', () => {
    const i = H.indexOf('function _syncAfterEnd() {');
    const f = H.slice(i, H.indexOf('\n      }\n', i));
    expect(f).toMatch(
      /const tsumenai =\s*!!_bs && \(_bs\.history_pushed !== true \|\| \(_bs\.mae_tsumenai \|\| \[\]\)\.length > 0\);/
    );
    expect(f).toMatch(/if \(tsumenai\)\s*showToastLong\(/);
    expect(f).toMatch(/\(_bs\.mae_kakenai \? 'アプリを 閉じると 前の 業務が 消えます。' : ''\)/);
    expect(f).toMatch(/'この 業務は 端末に 保存できませんでした/);
    expect(f).toMatch(/const say = function \(msg\) \{\s*if \(tsumenai\) return;/);
  });

  it('画面：保存の 失敗の 受け口を 登録している', () => {
    expect(H).toMatch(
      /Business\.onHozonShippai\(function \(\) \{\s*showToastLong\(\s*'業務の 記録が 端末に 保存できませんでした/
    );
  });
});

// ★字数の 合計に 上限が ある 倉庫（本物の 端末の 保存枠に 近い 形）で 回す★（10-11・taiketsu の 物差しを 移した）
//   鍵ごとに 失敗させる 偽物（rirekiDake）だけでは、持ち越しを state に 入れて 1秒ごとの 保存が 膨らみ、
//   開き直すと 途中の 件数の 晩が 事務所へ 届く 道（244/321 通り）を 捕まえられなかった。
//   3晩 積んでから 空きを F 字だけ 残し、毎晩 開き直して 10件ずつ 6晩。最後に 枠を 外して 履歴を 見る。
function makeCapStorage() {
  const m = {};
  const used = () => Object.keys(m).reduce((a, k) => a + k.length + m[k].length, 0);
  return {
    m,
    cap: 1e12,
    used,
    getItem: (k) => (k in m ? m[k] : null),
    setItem(k, v) {
      v = String(v);
      const nu = used() - (k in m ? k.length + m[k].length : 0) + k.length + v.length;
      if (nu > this.cap) {
        const e = new Error('QuotaExceededError');
        e.name = 'QuotaExceededError';
        throw e;
      }
      m[k] = v;
    },
    removeItem: (k) => {
      delete m[k];
    },
    key: (i) => Object.keys(m)[i] || null,
    get length() {
      return Object.keys(m).length;
    },
  };
}

describe('★保存枠が 一杯の 端末で 件数の 欠けた 晩・同じ 晩の 2件が 届かない（10-11）★', () => {
  it('空き 0〜8000字（250字刻み 33通り）で 欠けた 晩 0・同じ start_time の 2件 0', () => {
    const nowOrig = Date.now;
    let t = Date.UTC(2026, 9, 1);
    Date.now = () => (t += 60000);
    const boot = (ls) => {
      const B = load(ls);
      B.load();
      return B;
    };
    let kaketa = 0;
    let nijuu = 0;
    try {
      for (let F = 0; F <= 8000; F += 250) {
        const ls = makeCapStorage();
        let B = boot(ls);
        for (let d = 0; d < 3; d++) {
          B.start();
          for (let i = 0; i < 10; i++) {
            B.onTripEnd(1000, 1000, Date.now());
            B.save();
          }
          B.end();
        }
        ls.cap = ls.used() + F;
        const ryokin = [2001, 2002, 2003, 2004, 2005, 2006];
        for (const f of ryokin) {
          B = boot(ls);
          if (B.getState().active) B.end();
          B.start();
          for (let i = 0; i < 10; i++) {
            B.onTripEnd(1000, f, Date.now());
            B.save();
          }
          B.end();
        }
        ls.cap = 1e12;
        B = boot(ls);
        if (B.getState().active) B.end();
        B.start();
        B.end();
        const h = JSON.parse(ls.getItem(HK));
        const kazu = {};
        h.forEach((r) => {
          kazu[r.start_time] = (kazu[r.start_time] || 0) + 1;
        });
        if (Object.values(kazu).some((c) => c > 1)) nijuu++;
        if (
          ryokin.some((f) =>
            h.some(
              (r) => r.trip_count && r.fare_total_yen / r.trip_count === f && r.trip_count < 10
            )
          )
        )
          kaketa++;
      }
    } finally {
      Date.now = nowOrig;
    }
    expect({ kaketa, nijuu }).toEqual({ kaketa: 0, nijuu: 0 });
  });

  it('1秒ごとに 書く 業務の state に 持ち越しを 入れない', () => {
    const ls = makeStorage();
    const B = load(ls);
    hitoban(B);
    ls.setDame(rirekiDake);
    B.end();
    B.start();
    expect(B.getState().mae_tsumenai.length).toBe(1);
    expect(ls.m['daikou_business_state'] || '').not.toMatch(/mae_tsumenai/);
    expect(JSON.parse(ls.m.dk_business_mae_tsumenai).length).toBe(1);
    B.onTripEnd(1000, 3000, Date.now());
    B.save();
    B.end(); // 今夜も 積めない＝持ち越し 1件のまま（今夜は 終えた state に 残る）・state には やはり 入れない
    expect(ls.m['daikou_business_state'] || '').not.toMatch(/mae_tsumenai/);
  });
});
