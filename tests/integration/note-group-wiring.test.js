'use strict';
// ============================================================
// ★誰が乗ったか（会長／社長／専務）をメーターで選べること★ 2026-08-05
//
//   ★司さんの指摘★
//     「備考欄で名前選ぶようにしてる会社ではメーター機の方でどうなってる？」
//
//   ★実物を見て分かったこと（本番 companies を実測）★
//     藤原建設株式会社 だけ config.noteGroups = ["会長","社長","専務"]
//     items に「備考」を入れ、noteSummary:true で★備考ごとに小計を出す★設定。
//     実績17件とも備考に 社長/専務 が入っている。
//     ところがメーターには★誰が乗ったかを選ぶ所が無かった★。
//     ＝自動投入すると、その会社の行だけ備考が空で上がり、仕分けから外れる。
//
//   ★分け方は事務所の会社設定が唯一の正★
//     会社が増えても、分け方が変わっても、メーター側は直さない。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const HTML = read('index.html');
const CM = require(path.join(ROOT, 'js', 'customer-master.js'));
const B = require(path.join(ROOT, 'js', 'business.js'));
const TE = require(path.join(ROOT, 'js', 'trip-edit.js'));

// ★Edge Function はテストrepoにしか置いていない★（本番repoでは飛ばす・他のテストと同じ作法）
const FN_DIR = path.join(ROOT, 'supabase', 'functions');
const HAS_FN = fs.existsSync(path.join(FN_DIR, 'dk-sync-jobs', 'meisai-row.js'));

describe('★分け方が事務所から端末へ届くこと★', () => {
  it('サーバが分け方を返している（Edge Function）', () => {
    // ★2026-08-28: 前は 黙って return＝★読む人には 合格に見える★。
    //   Edge Function は ★repo によって 在る/無い★（本番repoには 置いていない）。
    //   ⇒★赤にはしません★が ★未測定★と はっきり言います（0件と 混ぜない）。
    if (!HAS_FN) {
      console.warn('★未測定★ supabase/functions/dk-sync-jobs/meisai-row.js が 在りません');
      console.warn('  MISOKUTEI=1 reason=edge-function-not-in-this-repo');
      return;
    }
    const fn = read('supabase/functions/dk-customers/index.ts');
    expect(fn, '会社設定を読んでいない').toContain("select('id, name, config')");
    expect(fn, '分け方を返していない').toContain('note_groups');
    expect(fn, 'noteGroups を見ていない').toContain('noteGroups');
  });

  it('★分け方を使う会社にだけ付ける★（使わない会社の端末を重くしない）', () => {
    const out = CM.normalize([
      { id: '1', name: '藤原建設株式会社', note_groups: ['会長', '社長', '専務'] },
      { id: '2', name: 'エスプリ アマン' },
    ]);
    expect(out[0].note_groups).toEqual(['会長', '社長', '専務']);
    expect(out[1].note_groups, '聞かない会社にも付いている').toBeUndefined();
  });

  it('壊れた分け方は捨てる（空文字・数字・入れ子）', () => {
    const out = CM.normalize([{ id: '1', name: 'A', note_groups: ['社長', '', 5, null, '  '] }]);
    expect(out[0].note_groups).toEqual(['社長']);
  });

  it('分け方が全部壊れていたら「聞かない会社」として扱う', () => {
    const out = CM.normalize([{ id: '1', name: 'A', note_groups: ['', null] }]);
    expect(out[0].note_groups).toBeUndefined();
  });

  it('分け方が配列でなくても落ちない', () => {
    expect(() => CM.normalize([{ id: '1', name: 'A', note_groups: 'こわれている' }])).not.toThrow();
    expect(CM.normalize([{ id: '1', name: 'A', note_groups: 'x' }])[0].note_groups).toBeUndefined();
  });
});

describe('★代行に「誰が乗ったか」を貼れること★', () => {
  beforeEach(() => {
    B.abandon();
    B.start();
    B.onTripStart(34.06, 132.99, 5);
  });

  it('会社と一緒に貼れる', () => {
    B.setTripCustomer('c1', '藤原建設株式会社', '社長');
    expect(B.getTripCustomer()).toEqual({
      customer_id: 'c1',
      customer_name: '藤原建設株式会社',
      customer_note: '社長',
    });
  });

  it('あとから名前だけ貼れる（会社を選んだ後に聞くため）', () => {
    B.setTripCustomer('c1', '藤原建設株式会社');
    expect(B.getTripCustomer().customer_note).toBe(null);
    B.setTripCustomerNote('専務');
    expect(B.getTripCustomer().customer_note).toBe('専務');
  });

  it('★会社を選び直したら消える★（前の客の名前が残ったら請求書が狂う）', () => {
    B.setTripCustomer('c1', '藤原建設株式会社', '社長');
    B.setTripCustomer('c2', 'エスプリ アマン');
    expect(B.getTripCustomer().customer_note, '★前の客の名前が残っている★').toBe(null);
  });

  it('現金に戻したら消える', () => {
    B.setTripCustomer('c1', '藤原建設株式会社', '社長');
    B.setTripCustomer(null);
    expect(B.getTripCustomer()).toBe(null);
  });

  it('会社未選択のまま名前だけ貼ろうとしても付かない', () => {
    expect(B.setTripCustomerNote('社長')).toBe(false);
    expect(B.getTripCustomer()).toBe(null);
  });

  it('★代行を終えたら、その代行に焼き付く★', () => {
    B.setTripCustomer('c1', '藤原建設株式会社', '社長');
    B.onTripEnd(3000, 1800, Date.now());
    const t = B.getState().trips.slice(-1)[0];
    expect(t.customer_note).toBe('社長');
    expect(t.payment_type).toBe('invoice');
  });

  it('★次の代行に前の名前を持ち越さない★', () => {
    B.setTripCustomer('c1', '藤原建設株式会社', '社長');
    B.onTripEnd(3000, 1800, Date.now());
    B.onTripStart(34.06, 132.99, 5);
    expect(B.getTripCustomer(), '★次の代行に前の客が付いている★').toBe(null);
  });

  it('変な値でも落ちない', () => {
    expect(() => B.setTripCustomer('c1', 'A', { x: 1 })).not.toThrow();
    expect(B.getTripCustomer().customer_note).toBe(null);
  });
});

describe('★事務所まで運ばれること★', () => {
  it('送る中身に入っている', () => {
    const js = read('js/job-sync.js');
    expect(js, '★運んでいない＝その会社の行だけ仕分けから外れる★').toContain(
      'customer_note: custId ? _str(t.customer_note)'
    );
  });

  it('サーバが倉庫に入れている', () => {
    if (!HAS_FN) return;
    const fn = read('supabase/functions/dk-sync-jobs/index.ts');
    expect(fn).toContain('customer_note: str(t.customer_note)');
  });

  it('★請求書の備考に入る★', () => {
    if (!HAS_FN) return;
    const row = read('supabase/functions/dk-sync-jobs/meisai-row.js');
    expect(row, '備考が空のまま上がる').toContain(
      "note: typeof t.customer_note === 'string' ? t.customer_note : ''"
    );
  });
});

describe.skipIf(!HAS_FN)('★請求書の備考を、消さずに直せること★', () => {
  // ★本番repoには Edge Function を置いていないので、読み込み自体を条件にする★
  //   (describe.skipIf でも中身は一度読まれるため、require をここで包む)
  const M = HAS_FN ? require(path.join(FN_DIR, 'dk-sync-jobs', 'meisai-row.js')) : null;

  const rows = (note) =>
    M.buildMeisaiRows({
      ownerId: 'o',
      deviceId: 'd',
      shiftStartMs: 1785835513046,
      trips: [
        {
          seq: 1,
          distance_m: 3000,
          fare_yen: 1800,
          payment_type: 'invoice',
          customer_name: '藤原建設株式会社',
          customer_note: note,
          end_address: '祇園',
        },
      ],
    });

  const exist = (note) => ({
    id: 'r1',
    extra: { dk_ref: 'd:1785835513046:1', dk_source: 'daikome', dk_distance_m: 3000 },
    company: '藤原建設株式会社',
    date: '2026-08-04',
    destination: '祇園',
    amount: 1800,
    distance: 3,
    note: note,
  });

  it('はじめて入る時は備考も一緒に入る', () => {
    expect(M.planMeisaiWrite(rows('社長'), []).inserts[0].note).toBe('社長');
  });

  it('★運転手が「社長」→「専務」に直したら、請求書も直る★', () => {
    const p = M.planMeisaiWrite(rows('専務'), [exist('社長')]);
    expect(p.updates[0].patch.note, '★直しても古いまま★').toBe('専務');
  });

  it('★メーターが名前を持っていない時は、司さんの備考を絶対に消さない★', () => {
    const p = M.planMeisaiWrite(rows(''), [exist('司さんが書いた備考')]);
    const patch = p.updates.length ? p.updates[0].patch : {};
    expect(
      Object.prototype.hasOwnProperty.call(patch, 'note'),
      '★空で上書きして司さんの備考を消している★'
    ).toBe(false);
  });

  it('同じ名前なら書きに行かない', () => {
    expect(M.planMeisaiWrite(rows('社長'), [exist('社長')]).updates.length).toBe(0);
  });

  it('分け方を使わない会社は、今までどおり備考が空', () => {
    const r = M.buildMeisaiRows({
      ownerId: 'o',
      deviceId: 'd',
      shiftStartMs: 1785835513046,
      trips: [
        {
          seq: 1,
          distance_m: 3000,
          fare_yen: 1800,
          payment_type: 'invoice',
          customer_name: 'エスプリ アマン',
        },
      ],
    });
    expect(r[0].note).toBe('');
  });
});

describe('★履歴からも直せること（忘れた時の受け皿）★', () => {
  const ride = {
    trip_key: 1,
    distance_m: 3000,
    fare: 1800,
    meter_fare: 1800,
    extras: [],
    discounts: [],
    customer_id: 'c1',
    customer_name: '藤原建設株式会社',
    customer_note: null,
  };

  it('あとから名前を入れられる', () => {
    const out = TE.applyToRide(ride, { customerNote: '専務' });
    expect(out.customer_note).toBe('専務');
    expect(out.fare, '★金額が動いた★').toBe(1800);
  });

  it('★会社を変えたら名前は消える★', () => {
    const withNote = TE.applyToRide(ride, { customerNote: '専務' });
    const out = TE.applyToRide(withNote, {
      customer: { customer_id: 'c2', customer_name: 'エスプリ アマン' },
    });
    expect(out.customer_note, '★前の客の名前が残っている★').toBe(null);
  });

  it('現金に戻したら名前も消える', () => {
    const withNote = TE.applyToRide(ride, { customerNote: '専務' });
    expect(TE.applyToRide(withNote, { customer: null }).customer_note).toBe(null);
  });

  it('事務所へ上げる代行にも乗る', () => {
    const out = TE.applyToRide(ride, { customerNote: '専務' });
    const t = TE.applyToTrip({ start_time: 1, distance_m: 3000, fare_yen: 1800 }, out);
    expect(t.customer_note).toBe('専務');
    expect(t.payment_type).toBe('invoice');
  });

  it('触らなければ今のままを保つ', () => {
    const withNote = TE.applyToRide(ride, { customerNote: '専務' });
    expect(TE.applyToRide(withNote, { extras: [{ name: 'x', amount: 100 }] }).customer_note).toBe(
      '専務'
    );
  });
});

describe('★選び忘れに気づけること（見えないと直しようがない）★', () => {
  it('メーターの実車画面に「誰？」と出る', () => {
    expect(HTML, '★聞く会社なのに未選択が見えない★').toContain('誰？');
    expect(HTML, '押しても選び直せない').toContain('reopenNoteGroup()');
  });

  it('履歴の一覧にも名前が出る', () => {
    expect(HTML).toMatch(/ride\.customer_note \? '（'/);
  });

  it('直す画面にも出て、その場で選べる', () => {
    // 直す画面の中では JS 文字列の中に埋めているので \' で書かれている
    expect(HTML, '★直す画面から名前を選べない★').toMatch(/_te_pick\(\\?'note\\?'\)/);
    expect(HTML, "選ぶ画面が 'note' を扱っていない").toContain("if (_pickMode === 'note')");
    expect(HTML, '会社ごとの分け方を引いていない').toContain('_te_noteGroupsOf(');
    expect(HTML, '選んだ名前を保存に渡していない').toContain('customerNote: _cur.customerNote');
  });

  it('請求先を選んだら続けて聞く', () => {
    expect(HTML, '★会社を選んでも誰かを聞かない★').toContain('_openNoteGroupModal(');
    expect(HTML).toMatch(/picked\.note_groups[\s\S]{0,120}_openNoteGroupModal/);
  });

  it('★聞かない会社では出さない★（毎回じゃまにしない）', () => {
    expect(HTML).toMatch(/Array\.isArray\(picked\.note_groups\) && picked\.note_groups\.length/);
  });

  it('★選ばなくても代行は続く★（「あとで」で閉じられる）', () => {
    expect(HTML).toContain('closeNoteGroupModal()');
    expect(HTML).toContain('>あとで<');
  });
});
