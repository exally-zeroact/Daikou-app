'use strict';
// ============================================================
// ★履歴から直せる、が本当に画面につながっていること★ 2026-08-05
//
//   司さん「その業務押したら追加料金や値引きや請求書などちゃんと編集できな
//           忘れとる時があると思うから」
//
//   ★核(js/trip-edit.js)が正しくても、画面につながっていなければ意味が無い★
//     前に同じ穴を踏んでいる:
//       ・業務終了で履歴は積むのに★送っていなかった★(⑤の配線漏れ)
//       ・給料明細のUUIDを1箇所だけ直して★別の経路が残っていた★
//     なので「呼んでいるか」を1つずつ見る。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const HTML = read('index.html');
const SW = read('sw.js');

describe('★道具が読み込まれていること★', () => {
  it('js/trip-edit.js がある', () => {
    expect(fs.existsSync(path.join(ROOT, 'js', 'trip-edit.js'))).toBe(true);
  });

  it('メーターが読み込んでいる', () => {
    expect(HTML, '★読み込んでいない＝押しても何も起きない★').toContain('src="js/trip-edit.js"');
  });

  it('★使う側(business.js)より先に読み込む★', () => {
    const te = HTML.indexOf('src="js/trip-edit.js"');
    const bz = HTML.indexOf('src="js/business.js"');
    expect(te).toBeGreaterThan(-1);
    expect(te, 'trip-edit.js が business.js より後にある').toBeLessThan(bz);
  });

  it('★オフラインでも動くよう先に取っておく★（完全オフライン前提）', () => {
    expect(SW, '★圏外で入れ直した端末で直せない★').toContain("'/js/trip-edit.js'");
  });

  it('★前に入れ忘れていた2本も入っている★（距離を覚える／前日の業務に気づく）', () => {
    expect(SW, 'meter-persist.js が先取りされていない').toContain("'/js/meter-persist.js'");
    expect(SW, 'carryover.js が先取りされていない').toContain("'/js/carryover.js'");
  });
});

describe('★履歴の行が押せること★', () => {
  it('押せる行に印を付けている', () => {
    expect(HTML).toContain("item.className += ' tappable'");
    expect(HTML, '押せることが見た目で分からない').toContain('.ride-item.tappable');
  });

  it('★突き合わせる鍵を持たせている★（無いと直しても反映されない）', () => {
    expect(HTML).toContain('item.dataset.tripKey');
    expect(HTML).toContain('item.dataset.rideKey');
  });

  it('★鍵の無い古い履歴は押せなくしている★（押せると「直したのに変わらない」が起きる）', () => {
    expect(HTML).toMatch(/if \(ride\.trip_key\) \{[\s\S]{0,200}tappable/);
  });

  it('押したら開く所につながっている', () => {
    expect(HTML).toContain("closest('.ride-item.tappable')");
    expect(HTML).toContain('window._te_open(');
  });
});

describe('★直す画面が3つとも扱えること★', () => {
  it('追加料金・値引き・請求書のどれも足せる', () => {
    ["_te_pick('extra')", "_te_pick('discount')", "_te_pick('customer')"].forEach((s) => {
      expect(HTML, s + ' が無い').toContain(s);
    });
  });

  it('足した物を消せる', () => {
    expect(HTML).toContain('window._te_del =');
  });

  it('★合計が計算しなおされて出る★', () => {
    expect(HTML).toContain('TripEdit.totalOf(');
    expect(HTML, '直す前との差が出ない').toContain('teDiff');
  });

  it('★走った分の料金は道具から読むだけ（画面で作り直さない）★', () => {
    expect(HTML).toContain('TripEdit.meterFareOf(');
  });
});

describe('★保存が3つの帳面に届くこと★', () => {
  it('保存は道具(TripEdit.apply)を通す', () => {
    expect(HTML, '★画面が自分で localStorage を書いている＝ずれる★').toContain('TripEdit.apply({');
  });

  it('★直したら事務所へ送り直す★', () => {
    expect(HTML, '★直しが事務所に届かない★').toMatch(
      /if \(r\.resend\)[\s\S]{0,300}JobSync\.sync\(\)/
    );
  });

  it('直したら履歴を描き直す', () => {
    expect(HTML).toMatch(/_te_save[\s\S]{0,900}_hist_render\(\)/);
  });

  it('直したら待機画面の集計も合わせる', () => {
    expect(HTML).toMatch(/_te_save[\s\S]{0,900}updateBusinessDashboard\(\)/);
  });
});

describe('★走行中の代行を巻き込まないこと★', () => {
  it('★走行中の追加料金モーダルを流用していない★（流用すると走行中の金額が変わる）', () => {
    const i = HTML.indexOf('window._te_open');
    const j = HTML.indexOf('window._te_save');
    const block = HTML.slice(i, j > i ? j + 2000 : i + 12000);
    ['openExtraModal(', 'openDiscountModal(', 'openInvoiceModal('].forEach((f) => {
      expect(block, '★走行中のモーダル ' + f + ' を呼んでいる★').not.toContain(f);
    });
  });

  it('★走行中のグローバル extras/discounts を書き換えていない★', () => {
    const i = HTML.indexOf('window._te_open');
    const j = HTML.indexOf('window._te_save');
    const block = HTML.slice(i, j > i ? j + 2000 : i + 12000);
    expect(block, '★走行中の追加料金を書き換えている★').not.toMatch(/^\s*extras\s*=/m);
    expect(block, '★走行中の値引きを書き換えている★').not.toMatch(/^\s*discounts\s*=/m);
  });

  it('★Meter / 距離に触っていない★（距離コアは触らない）', () => {
    const src = read('js/trip-edit.js');
    ['Meter.', 'calcFare', 'distance_m =', 'setDistance'].forEach((w) => {
      expect(src, '★' + w + ' に触っている＝距離コアを触っている★').not.toContain(w);
    });
  });
});

describe('★直せるだけの中身を履歴に残していること★', () => {
  it('★走った分の料金を残している★（無いと戻し計算しかできない）', () => {
    expect(HTML, '★meter_fare を保存していない★').toContain('meter_fare: fare,');
  });

  it('★値引きを残している★（今まで残していなかった）', () => {
    expect(HTML).toContain('discounts: Array.isArray(discounts) ? [...discounts] : []');
  });

  it('★請求先を残している★', () => {
    expect(HTML).toContain('customer_id: _trip ? _trip.customer_id || null : null');
  });

  it('直した印が画面に出る', () => {
    expect(HTML).toContain('ride-edited');
    expect(HTML).toContain('修正済み');
  });

  it('★値引き・請求先が履歴に見えている★（見えないと直したか分からない）', () => {
    expect(HTML).toMatch(/ride\.discounts\) && ride\.discounts\.length/);
    expect(HTML).toMatch(/ride\.customer_id && ride\.customer_name/);
  });
});
