'use strict';
// ============================================================
// dk-session 共通土台 テスト (2026-08-01)
//
//   ★何のための部品か★
//   ダイコメの会社向け画面（管理画面 / 売上表 / 給料明細 / 月次集計）を
//   **同じログイン・同じ session の扱い**で作るための土台。
//   これを共通化しておかないと、最後に管理画面へまとめる時に全部書き直しになる。
//
//   ★ダイコメのログインはマジックリンク★（メール+パスワードの exally-login.js とは別物）。
//   混ぜると同じ人が別扱いになるので、ここに寄せる。
//
//   ★守る性質★
//     1. 何が来ても throw しない（画面が真っ白にならない）
//     2. 期限切れ / 期限間近を正しく判定する（切れたまま使わない）
//     3. 壊れた保存値でログイン状態を偽らない
// ============================================================
const DKSession = require('../../js/dk-session.js');

describe('マジックリンクの戻り（URLの#）から session を取り出す', () => {
  it('access_token と refresh_token を取り出す', () => {
    const s = DKSession.parseHash(
      '#access_token=AAA&refresh_token=BBB&expires_in=3600&token_type=bearer'
    );
    expect(s.access_token).toBe('AAA');
    expect(s.refresh_token).toBe('BBB');
    expect(s.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('expires_at が入っていればそれを使う', () => {
    const s = DKSession.parseHash('#access_token=AAA&expires_at=2000000000');
    expect(s.expires_at).toBe(2000000000);
  });

  it('access_token が無ければ null（ログインしたことにしない）', () => {
    expect(DKSession.parseHash('#refresh_token=BBB')).toBeNull();
    expect(DKSession.parseHash('')).toBeNull();
    expect(DKSession.parseHash('#')).toBeNull();
  });

  it('★何が来ても throw しない★', () => {
    expect(() => DKSession.parseHash(null)).not.toThrow();
    expect(() => DKSession.parseHash(undefined)).not.toThrow();
    expect(() => DKSession.parseHash({})).not.toThrow();
    expect(DKSession.parseHash(null)).toBeNull();
  });
});

describe('期限の判定', () => {
  const now = 1000000;

  it('期限が先ならまだ使える', () => {
    expect(DKSession.needsRefresh({ access_token: 'a', expires_at: now + 3600 }, now)).toBe(false);
  });

  it('期限切れは要更新', () => {
    expect(DKSession.needsRefresh({ access_token: 'a', expires_at: now - 1 }, now)).toBe(true);
  });

  it('★期限の直前も要更新（画面を開いた直後に切れるのを防ぐ）★', () => {
    expect(DKSession.needsRefresh({ access_token: 'a', expires_at: now + 30 }, now)).toBe(true);
  });

  it('壊れた値は「使えない」と判定する（ログイン状態を偽らない）', () => {
    expect(DKSession.needsRefresh(null, now)).toBe(true);
    expect(DKSession.needsRefresh({}, now)).toBe(true);
    expect(DKSession.needsRefresh({ access_token: '' }, now)).toBe(true);
    expect(DKSession.needsRefresh({ access_token: 'a' }, now)).toBe(true); // 期限不明
  });

  it('★何が来ても throw しない★', () => {
    expect(() => DKSession.needsRefresh('x', now)).not.toThrow();
    expect(() => DKSession.needsRefresh(undefined, undefined)).not.toThrow();
  });
});

describe('保存と読み出し', () => {
  it('保存した session を読み出せる', () => {
    const store = {};
    const ls = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        store[k] = String(v);
      },
      removeItem: (k) => {
        delete store[k];
      },
    };
    DKSession._setStore(ls);
    DKSession.save({ access_token: 'A', refresh_token: 'B', expires_at: 123 });
    expect(DKSession.load()).toEqual({ access_token: 'A', refresh_token: 'B', expires_at: 123 });
    DKSession.clear();
    expect(DKSession.load()).toBeNull();
    DKSession._setStore(null);
  });

  it('壊れた保存値なら null（ログイン状態を偽らない）', () => {
    const ls = {
      getItem: () => '{{{ not json',
      setItem: () => {},
      removeItem: () => {},
    };
    DKSession._setStore(ls);
    expect(DKSession.load()).toBeNull();
    DKSession._setStore(null);
  });

  it('★保存できない環境でも throw しない★', () => {
    const ls = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    DKSession._setStore(ls);
    expect(() => DKSession.save({ access_token: 'A' })).not.toThrow();
    expect(() => DKSession.load()).not.toThrow();
    expect(() => DKSession.clear()).not.toThrow();
    expect(DKSession.load()).toBeNull();
    DKSession._setStore(null);
  });

  it('★管理画面と同じ保存キーを使う（同じログインを共有する）★', () => {
    expect(DKSession.KEY).toBe('dk_dash_sess');
  });
});

// ============================================================
// ★「毎回ログイン」を起こさない（司さんの指摘 2026-08-01）★
//
//   起きていたこと:
//     ① 通信が一瞬こけただけでログイン画面に飛ばしていた
//     ② 管理画面が独自のログイン処理を持ち、タブの中の画面と同時にトークンを更新
//        → 片方が使った refresh_token が無効になり、もう片方が弾かれる
// ============================================================
describe('★通信できないだけでログアウトさせない★', () => {
  const OLD_FETCH = global.fetch;
  let store;

  function useStore(sess) {
    store = {
      _v: {},
      getItem(k) {
        return this._v[k] === undefined ? null : this._v[k];
      },
      setItem(k, v) {
        this._v[k] = String(v);
      },
      removeItem(k) {
        delete this._v[k];
      },
    };
    if (sess) store.setItem('dk_dash_sess', JSON.stringify(sess));
    DKSession._setStore(store);
    DKSession._resetLock();
  }

  const EXPIRED = {
    access_token: 'old',
    refresh_token: 'r1',
    expires_at: Math.floor(Date.now() / 1000) - 100,
  };

  afterEach(() => {
    global.fetch = OLD_FETCH;
    DKSession._setStore(null);
    DKSession._resetLock();
  });

  it('★繋がらない時は 保存してある session をそのまま返す（null にしない）★', async () => {
    useStore(EXPIRED);
    global.fetch = () => Promise.reject(new Error('offline'));
    const s = await DKSession.ensure();
    expect(s).toBeTruthy();
    expect(s.access_token).toBe('old'); // ログインは切らない
    // 保存も消えていない
    expect(JSON.parse(store.getItem('dk_dash_sess')).refresh_token).toBe('r1');
  });

  it('サーバーが 500 の時もログアウトさせない', async () => {
    useStore(EXPIRED);
    global.fetch = () => Promise.resolve({ ok: false, status: 500 });
    const s = await DKSession.ensure();
    expect(s).toBeTruthy();
    expect(s.access_token).toBe('old');
  });

  it('★401（鍵が無効）の時だけ null＝本当にログインが要る★', async () => {
    useStore(EXPIRED);
    global.fetch = () => Promise.resolve({ ok: false, status: 401 });
    const s = await DKSession.ensure();
    expect(s).toBe(null);
  });

  it('400（invalid_grant）も本当に切れた扱い', async () => {
    useStore(EXPIRED);
    global.fetch = () => Promise.resolve({ ok: false, status: 400 });
    expect(await DKSession.ensure()).toBe(null);
  });

  it('更新できたら新しい session を返して保存する', async () => {
    useStore(EXPIRED);
    global.fetch = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 }),
      });
    const s = await DKSession.ensure();
    expect(s.access_token).toBe('new');
    expect(JSON.parse(store.getItem('dk_dash_sess')).refresh_token).toBe('r2');
  });

  it('そもそも session が無ければ null（ログインが要る）', async () => {
    useStore(null);
    expect(await DKSession.ensure()).toBe(null);
  });
});

describe('★更新は一度に1つだけ（取り合いでログアウトしない）★', () => {
  const OLD_FETCH = global.fetch;
  afterEach(() => {
    global.fetch = OLD_FETCH;
    DKSession._setStore(null);
    DKSession._resetLock();
  });

  it('同時に呼んでも サーバーへは1回しか行かない', async () => {
    const store = {
      _v: {
        dk_dash_sess: JSON.stringify({
          access_token: 'old',
          refresh_token: 'r1',
          expires_at: Math.floor(Date.now() / 1000) - 100,
        }),
      },
      getItem(k) {
        return this._v[k] === undefined ? null : this._v[k];
      },
      setItem(k, v) {
        this._v[k] = String(v);
      },
      removeItem(k) {
        delete this._v[k];
      },
    };
    DKSession._setStore(store);
    DKSession._resetLock();

    let calls = 0;
    global.fetch = () => {
      calls++;
      return new Promise((res) =>
        setTimeout(
          () =>
            res({
              ok: true,
              status: 200,
              json: () =>
                Promise.resolve({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 }),
            }),
          30
        )
      );
    };

    const [a, b, c] = await Promise.all([
      DKSession.ensure(),
      DKSession.ensure(),
      DKSession.ensure(),
    ]);
    expect(calls).toBe(1); // ★3回叩かない★
    expect(a.access_token).toBe('new');
    expect(b.access_token).toBe('new');
    expect(c.access_token).toBe('new');
  });
});

describe('★本当にログインが切れたのかの判定★', () => {
  it('401 / 403 だけが「切れた」', () => {
    expect(DKSession.isAuthError({ status: 401 })).toBe(true);
    expect(DKSession.isAuthError({ status: 403 })).toBe(true);
  });
  it('繋がらなかった・500・404 は切れていない', () => {
    expect(DKSession.isAuthError(null)).toBe(false);
    expect(DKSession.isAuthError(undefined)).toBe(false);
    expect(DKSession.isAuthError({ status: 500 })).toBe(false);
    expect(DKSession.isAuthError({ status: 404 })).toBe(false);
    expect(DKSession.isAuthError({ status: 200 })).toBe(false);
  });
});
