'use strict';
// ============================================================
// ★業務終了で送る＋取りこぼしを黙って消さない 2026-08-04★
//
//   ★指示役が実配信のコードを端から端まで読んで見つけた★
//     7本の配線のうち★⑤（履歴 → クラウド）1本だけ切れていた★。
//       js/job-sync.js init() は
//         run();                                  ← アプリを開いた時に1回
//         addEventListener('online', run);        ← 圏外から復帰した時
//       ★これだけ。業務終了で送る配線が無い★。
//
//   ★今夜の流れに当てはめると★
//     ①オフラインで走る ②画面を閉じる
//     ③家でWi-Fiに繋いで開く → sync は走るが★まだ業務終了していないので履歴が空★
//       （既に繋がっているので online イベントも起きない）
//     ④業務終了を押す → 履歴に積まれる
//     ⑤★誰も sync を呼ばない★ → 上がるのは翌日アプリを開いた時
//
//   ★なぜこうなったか（同じ形をもう作らないために）★
//     job-sync.js は7月31日に作った時、★業務終了で履歴に積んでいなかった★
//     （次の業務開始で積む設計）ので「開いた時に送る」で辻褄が合っていた。
//     今日「終了で積む」に直したのに、★送る側は7月31日のまま★だった。
//     ＝★片方だけ直して、もう片方を見なかった★。
//     ⇒ ★何かのタイミングを変えたら、そのタイミングに依存している所を必ず洗う★
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const IDX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const JS = require(path.join(ROOT, 'js', 'job-sync.js'));

describe('★業務終了で送ること（⑤の配線）★', () => {
  it('★業務終了する所すべてから送信を呼んでいる★', () => {
    // Business.end() を呼ぶ所は複数ある（代行中からの終了／日報からの終了）。
    // ★1箇所でも漏らすと、その道から終わった夜は翌日まで上がらない★ので全部見る。
    const hits = Array.from(IDX.matchAll(/Business\.end\(\);/g)).map((m) => m.index);
    expect(hits.length, 'Business.end() が見つからない').toBeGreaterThan(0);
    const missing = hits.filter((i) => !/_syncAfterEnd\(\)/.test(IDX.slice(i, i + 200)));
    expect(missing.length, '★業務終了で送っていない道がある＝その夜は翌日まで上がらない★').toBe(0);
  });

  it('送信の中身が JobSync を呼んでいる', () => {
    const i = IDX.indexOf('function _syncAfterEnd');
    expect(i).toBeGreaterThan(-1);
    expect(IDX.slice(i, i + 1600)).toContain('JobSync.sync()');
  });

  it('送る処理が業務を止めないように囲ってある', () => {
    const i = IDX.indexOf('function _syncAfterEnd');
    expect(i, '_syncAfterEnd が無い').toBeGreaterThan(-1);
    const body = IDX.slice(i, i + 1200);
    expect(body).toContain('try {');
    expect(body).toContain('catch');
  });

  it('★「送りました／あとで送ります」を出す★（黙って終わらない）', () => {
    const i = IDX.indexOf('function _syncAfterEnd');
    const body = IDX.slice(i, i + 1200);
    expect(body, '★運転手が上がったかどうかを知る手段が無い★').toContain('_showToast');
  });
});

describe('★取りこぼしを黙って消さないこと（【3】）★', () => {
  it('サーバは accepted を必ず返す（実物で確認済み）', () => {
    const fn = path.join(ROOT, 'supabase', 'functions', 'dk-sync-jobs', 'index.ts');
    if (!fs.existsSync(fn)) return; // 本番repoには置いていない
    const t = fs.readFileSync(fn, 'utf8');
    expect(t).toContain('return json({ ok: true, accepted });');
  });

  it('★accepted が空なら「送信済み」にしない★（次回また送る）', () => {
    const marked = JS.acceptedKeysOf({ ok: true, accepted: [] }, [{ start_time: 100 }]);
    expect(marked, '★サーバが受け取っていないのに送信済みにしている★').toEqual([]);
  });

  it('★accepted が無い応答でも「送信済み」にしない★', () => {
    const marked = JS.acceptedKeysOf({ ok: true }, [{ start_time: 100 }, { start_time: 200 }]);
    expect(marked, '★受け取ったか分からないのに送信済みにしている★').toEqual([]);
  });

  it('accepted が返ってきたら、その分だけ送信済みにする', () => {
    const marked = JS.acceptedKeysOf({ ok: true, accepted: [100] }, [
      { start_time: 100 },
      { start_time: 200 },
    ]);
    expect(marked).toEqual([100]);
  });

  it('★一部だけ受け取られた時、残りは次回また送る★', () => {
    const shifts = [{ start_time: 100 }, { start_time: 200 }, { start_time: 300 }];
    const marked = JS.acceptedKeysOf({ ok: true, accepted: [100, 300] }, shifts);
    const synced = JS.mergeSynced([], marked);
    const left = JS.selectUnsynced(shifts, synced);
    expect(
      left.map((s) => s.start_time),
      '受け取られなかった分が消えた'
    ).toEqual([200]);
  });

  it('壊れた応答でも落ちない・送信済みにしない', () => {
    expect(JS.acceptedKeysOf(null, [{ start_time: 1 }])).toEqual([]);
    expect(JS.acceptedKeysOf('こわれている', [{ start_time: 1 }])).toEqual([]);
    expect(JS.acceptedKeysOf({ accepted: 'こわれている' }, [{ start_time: 1 }])).toEqual([]);
  });
});

describe('★端末に残っている過去ぶんも送られること（【2】）★', () => {
  it('履歴に古い勤務が複数あれば、まとめて送る対象になる', () => {
    const hist = [
      { start_time: 100, total_distance_m: 5320 },
      { start_time: 200, total_distance_m: 4100 },
      { start_time: 300, total_distance_m: 6800 },
    ];
    const targets = JS.selectUnsynced(hist, []);
    expect(targets.length, '★今夜の分より前の記録が拾われない★').toBe(3);
  });

  it('★古い順に送る★（先に走った分が先に上がる）', () => {
    const hist = [{ start_time: 300 }, { start_time: 100 }, { start_time: 200 }];
    const targets = JS.selectUnsynced(hist, []);
    expect(targets.map((s) => s.start_time)).toEqual([100, 200, 300]);
  });

  it('一度に送る上限を超えても、残りは次回に残る', () => {
    const hist = [];
    for (let i = 1; i <= JS.MAX_BATCH + 5; i++) hist.push({ start_time: i });
    const first = JS.selectUnsynced(hist, []);
    expect(first.length).toBe(JS.MAX_BATCH);
    const synced = JS.mergeSynced(
      [],
      first.map((s) => String(s.start_time))
    );
    const second = JS.selectUnsynced(hist, synced);
    expect(second.length, '残りが送られない').toBe(5);
  });
});

describe('★2回押しても二重に送らないこと★', () => {
  it('送信済みの勤務は二度と対象にならない', () => {
    const hist = [{ start_time: 100 }];
    const synced = JS.mergeSynced([], ['100']);
    expect(JS.selectUnsynced(hist, synced), '★同じ勤務を2回送る＝二重請求の芽★').toEqual([]);
  });
});
