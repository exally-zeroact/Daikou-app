'use strict';
// ============================================================
// ★自分の会社だけを、決まった順で取る／2社以上は黙って選ばない★ 2026-08-08
//
//   ★何が起きたか（司さんの申告 2件の真因）★
//     「給料が手で入力できない」「台数が使っているのに0」
//     → 事務所の画面が ★別の会社(自社(テスト)・検証ゴミ)★ を表示していた。
//     ・dashboard.html は /dk_companies?select=... を ★並び順の指定なし★ で取り、
//       ★返ってきた最初の1件★ を無条件に採用していた（COMPANY = cos[0]）。
//     ・kyuryo / uriage / shukei も同じ形（さらに limit=1）。
//     ・2026-08-07 に司さんを dk_admins に入れた結果、RLS の is_dk_admin() で
//       ★11社 全部が見える★ようになり、一番古い検証ゴミが先頭で返っていた。
//     ・書き込みの条件は owner_id = 自分 なので、その会社には ★保存できない★。
//
//   ★直す形★
//     ① 自分が持ち主の会社だけを、必ず同じ順で取る
//     ② ★1件ならそのまま／2件以上は黙って選ばない（選ばせる）／0件は登録へ★
//        ＝ 司さんが2社目を持った日に、同じ事故が黙って再発しないようにする
// ============================================================
const DK = require('../../js/dk-session.js');

// uid=11111111-2222-3333-4444-555555555555 の偽トークン
function fakeSess(uid) {
  const payload = Buffer.from(JSON.stringify({ sub: uid }), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return { access_token: 'x.' + payload + '.y' };
}
const UID = '11111111-2222-3333-4444-555555555555';

const co = (id, name) => ({ company_id: id, name });

describe('★自分の会社だけを、決まった順で取る★', () => {
  it('問い合わせに ★自分の持ち主しぼり★ と ★並び順★ の両方が入る', () => {
    const q = DK.myCompaniesQuery(fakeSess(UID));
    expect(q, '★持ち主でしぼっていない＝他人の会社が混ざる★').toContain('owner_id=eq.' + UID);
    expect(q, '★並び順がない＝毎回ちがう会社が先頭に来うる★').toContain('order=created_at');
    expect(q, '★limit=1 は使わない（何件あるか分からなくなる）★').not.toContain('limit=1');
  });

  it('★自分のidが読めない時は 問い合わせ自体をしない★（絞りが外れて全社が返るのを防ぐ）', () => {
    // ★2026-08-08 仕様変更★
    //   旧: uid が無ければ「並び順だけ付けて全社取る」形だった。
    //       司さんは dk_admins に入っているので ★11社が返り、検証ゴミが選択画面に並ぶ★。
    //       そこで1つ選ぶと覚えてしまい ★元の事故に戻る★。
    //   新: uid が無いなら ★問い合わせをしない★（画面は「読み込み中」のまま）。
    //       空でも0でも登録画面でもない。
    expect(DK.myCompaniesQuery({ access_token: 'こわれている' })).toBe(null);
    expect(DK.myCompaniesQuery(null)).toBe(null);
  });

  it('★自分のidが読めない時は 通信に行かず「まだ分からない」と返す★', async () => {
    let called = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = () => {
      called++;
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    };
    try {
      const r = await DK.myCompanies({ access_token: 'こわれている' });
      expect(called, '★通信に行ってしまった＝全社が返る道が残っている★').toBe(0);
      expect(r.ok).toBe(false);
      expect(r.noUid, '★「まだ分からない」と言えていない★').toBe(true);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe('★2社以上は黙って選ばない★', () => {
  it('0件 → 登録へ', () => {
    expect(DK.pickCompany([]).mode).toBe('none');
  });

  it('1件 → そのまま使う', () => {
    const r = DK.pickCompany([co('a', 'ZERO代行')]);
    expect(r.mode).toBe('one');
    expect(r.company.name).toBe('ZERO代行');
  });

  it('★2件 → 黙って先頭を選ばない（選ばせる）★', () => {
    const r = DK.pickCompany([co('a', 'ZERO代行'), co('b', '2社目')]);
    expect(r.mode, '★黙って先頭を採った＝同じ事故が再発する★').toBe('choose');
    expect(r.company, '選ばせる時は会社を決めない').toBe(null);
    expect(r.list.length).toBe(2);
  });

  it('2件でも ★前に選んだ会社を覚えていれば★ それを使う', () => {
    const r = DK.pickCompany([co('a', 'ZERO代行'), co('b', '2社目')], 'b');
    expect(r.mode).toBe('one');
    expect(r.company.name).toBe('2社目');
  });

  it('覚えていた会社が もう無い時は 黙って別のを選ばない', () => {
    const r = DK.pickCompany([co('a', 'ZERO代行'), co('b', '2社目')], 'すでに無いid');
    expect(r.mode).toBe('choose');
  });

  it('壊れた入力でも落ちない（業務を止めない）', () => {
    expect(DK.pickCompany(null).mode).toBe('none');
    expect(DK.pickCompany([null, undefined]).mode).toBe('none');
  });
});
