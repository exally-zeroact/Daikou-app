// tests/unit/trace-outbox.test.js
// ★trace/log オフライン永続送信キュー 検証 (2026-06-16)★
//   js/trace-outbox.js の createOutbox(キュー本体)を in-memory store で決定論テスト。
//   オフライン走行→閉じても消えず、オンラインで古い順に確実再送・容量/期間で間引く、を固定する。
//   ★距離コアには触れない(送信経路の永続化のみ)★。
const OB = require('../../js/trace-outbox.js');

function mk(nowRef) {
  const store = OB.createMemStore();
  const outbox = OB.createOutbox(store, { now: () => nowRef.t });
  return { store, outbox };
}

describe('trace-outbox: enqueue / count', () => {
  it('★enqueue した分だけ count が増える', async () => {
    const nowRef = { t: 1000 };
    const { outbox } = mk(nowRef);
    await outbox.enqueue({ meta: { kind: 'console_log' }, samples: [1] });
    await outbox.enqueue({ meta: { kind: 'GPS' }, samples: [2] });
    expect(await outbox.count()).toBe(2);
  });
});

describe('trace-outbox: drain(古い順・成功削除・失敗停止)', () => {
  it('★全成功 → 全削除・送信数を返す', async () => {
    const nowRef = { t: 1000 };
    const { outbox } = mk(nowRef);
    await outbox.enqueue({ n: 1 });
    await outbox.enqueue({ n: 2 });
    const order = [];
    const sent = await outbox.drain((body) => {
      order.push(body.n);
      return Promise.resolve(true);
    });
    expect(sent).toBe(2);
    expect(order).toEqual([1, 2]); // 古い順
    expect(await outbox.count()).toBe(0);
  });

  it('★オフラインで失敗 → そこで停止・全部残す(=次回再送)', async () => {
    const nowRef = { t: 1000 };
    const { outbox } = mk(nowRef);
    await outbox.enqueue({ n: 1 });
    await outbox.enqueue({ n: 2 });
    await outbox.enqueue({ n: 3 });
    const sent = await outbox.drain(() => Promise.resolve(false), { isOnline: () => false });
    expect(sent).toBe(0); // オフライン=1件も送れない
    expect(await outbox.count()).toBe(3); // 全部残る
  });

  it('★postFn が throw(オフライン) → 失敗扱いで停止(クラッシュしない)', async () => {
    const nowRef = { t: 1000 };
    const { outbox } = mk(nowRef);
    await outbox.enqueue({ n: 1 });
    await outbox.enqueue({ n: 2 });
    const sent = await outbox.drain(
      () => {
        throw new Error('network down');
      },
      { isOnline: () => false }
    );
    expect(sent).toBe(0);
    expect(await outbox.count()).toBe(2); // 全部残る
  });

  it('★オンラインで1件拒否(poison) → skipして後続は送る(head-of-line blocking回避)', async () => {
    const nowRef = { t: 1000 };
    const { outbox } = mk(nowRef);
    await outbox.enqueue({ n: 1 }); // 拒否される poison
    await outbox.enqueue({ n: 2 });
    await outbox.enqueue({ n: 3 });
    const sent = await outbox.drain((b) => Promise.resolve(b.n !== 1), { isOnline: () => true });
    expect(sent).toBe(2); // n=2,3 は送れた(n=1で止まらない)
    expect(await outbox.count()).toBe(1); // poison n=1 だけ残る(tries=1)
  });

  it('★オンラインで maxTries 連続拒否 → poison を破棄(永久詰まり防止)', async () => {
    const nowRef = { t: 1000 };
    const { outbox } = mk(nowRef);
    await outbox.enqueue({ n: 1 });
    const post = () => Promise.resolve(false); // 常に拒否
    for (let i = 0; i < 2; i++) await outbox.drain(post, { isOnline: () => true, maxTries: 3 });
    expect(await outbox.count()).toBe(1); // 2回(tries=2)はまだ残る
    await outbox.drain(post, { isOnline: () => true, maxTries: 3 }); // 3回目でtries=3=破棄
    expect(await outbox.count()).toBe(0);
  });

  it('★再オンラインで drain 再実行 → 残りが送れる', async () => {
    const nowRef = { t: 1000 };
    const { outbox } = mk(nowRef);
    await outbox.enqueue({ n: 1 });
    await outbox.enqueue({ n: 2 });
    let online = false;
    const post = () => Promise.resolve(online);
    expect(await outbox.drain(post, { isOnline: () => online })).toBe(0); // オフライン
    online = true; // 復帰
    expect(await outbox.drain(post, { isOnline: () => online })).toBe(2);
    expect(await outbox.count()).toBe(0);
  });
});

describe('trace-outbox: trim(容量/期間ガード)', () => {
  it('★maxRecords 超過 → 古い側を間引き・新しい方を残す', async () => {
    const nowRef = { t: 1000 };
    const { outbox } = mk(nowRef);
    for (let i = 1; i <= 5; i++) {
      nowRef.t = 1000 + i;
      await outbox.enqueue({ n: i });
    }
    const removed = await outbox.trim(2, null, 2000); // 最新2件だけ残す
    expect(removed).toBe(3);
    const left = [];
    await outbox.drain((b) => {
      left.push(b.n);
      return Promise.resolve(true);
    });
    expect(left).toEqual([4, 5]); // 古い1,2,3が間引かれ新しい4,5残る
  });

  it('★maxAgeMs より古い未送信を破棄', async () => {
    const nowRef = { t: 0 };
    const { outbox } = mk(nowRef);
    nowRef.t = 1000;
    await outbox.enqueue({ n: 'old' });
    nowRef.t = 100000;
    await outbox.enqueue({ n: 'new' });
    const removed = await outbox.trim(1000, 5000, 100000); // age>5000を破棄(old=99000古い)
    expect(removed).toBe(1);
    const left = [];
    await outbox.drain((b) => {
      left.push(b.n);
      return Promise.resolve(true);
    });
    expect(left).toEqual(['new']);
  });
});

describe('trace-outbox: 公開API存在 / 永続状態(S2)', () => {
  it('★submit/drainNow/count/getStatus/isPersistent が生えてる(uploaderから呼べる)', () => {
    expect(typeof OB.submit).toBe('function');
    expect(typeof OB.drainNow).toBe('function');
    expect(typeof OB.count).toBe('function');
    expect(typeof OB.getStatus).toBe('function');
    expect(typeof OB.isPersistent).toBe('function');
  });
  it('★S2: IndexedDB が無い環境(node)では非永続を正直に申告(黙消防止)', () => {
    // node には indexedDB が無い → mem退避 → isPersistent=false(実機でこれが出たら永続できてない印)
    expect(OB.isPersistent()).toBe(false);
    expect(OB.getStatus().persistent).toBe(false);
  });
});
