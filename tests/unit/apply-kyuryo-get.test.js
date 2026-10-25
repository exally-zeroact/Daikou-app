'use strict';
// ============================================================
// ★scripts/apply-kyuryo-get.mjs＝dk_kyuryo_get 1本だけ 当てる 道具の 見張り★ 2026-10-02
//
//   ① repo の SQL から ★その 1本だけ★ 切り出せる（pw_set／verify／grant は 入らない）
//   ② 囲いの 外に 別の 文を 紛れ込ませると 投げる
//   ③ 読むだけの 関数に 書き換えの 字が 入ると 投げる
//   ④ 読み戻した 関数の 数え（直す前の 形は NG・今の 形は OK）
//
//   ★わざと壊して 赤に なるのを 見た（2026-10-02）★
//     kiridasu の「囲いの 外の ; は 1つ」を 外す ⇒ ② が 赤
//     NAI から to_jsonb(w) を 外す ⇒ ④-2 が 赤
//       ★はじめ「④ が 赤になる」と 書いたが 測ったら 緑のまま だった★
//       （直す前の 形は ARU が 欠けて 別の 理由で NG に なる＝NAI を 見ていなかった）⇒ ④-2 を 足した
//     戻すと 全部 緑。テスト倉庫では 当てる前 KAKUNIN まだ → 当てた後 OK（実測）
//   ⑤ 2026-10-17：ARU から 足した 3つの 字を 外す ⇒ ⑤ が 赤（外す 前は「'taishoku'」の 字だけで 古い 版も OK だった）
// ============================================================
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const SQL = fs.readFileSync(path.join(ROOT, 'supabase/apply-kyuryo-honnin-kansuu.sql'), 'utf8');
let T;
beforeAll(async () => {
  T = await import('../../scripts/apply-kyuryo-get.mjs');
});

describe('★dk_kyuryo_get だけを 当てる 道具★', () => {
  it('① その 1本だけ 切り出す', () => {
    const b = T.kiridasu(SQL);
    expect(b.startsWith('create or replace function public.dk_kyuryo_get(')).toBe(true);
    expect(b.trimEnd().endsWith('$fn$;')).toBe(true);
    expect(b).not.toMatch(/dk_kyuryo_pw_set|dk_kyuryo_verify|grant execute/);
    expect(T.kazoeru(b).ok, '★repo の 関数が 直した 形に なっていない★').toBe(true);
  });
  it('② 囲いの 外に 別の 文が 在れば 投げる', () => {
    const lf = SQL.replace(/\r\n/g, '\n');
    const atama = 'p_from date, p_to date)\nreturns json\n';
    expect(lf.split(atama).length, '★置き換える 所が 1か所 でない（試験が 空回り）★').toBe(2);
    const warui = lf.replace(atama, atama + 'drop table daikome.dk_shifts;\n');
    expect(() => T.kiridasu(warui)).toThrow();
  });
  it('③ 読むだけの 関数に 書き換えの 字が 在れば 投げる', () => {
    const warui = SQL.replace(/\r\n/g, '\n').replace(
      '  if p_from is null',
      '  delete from daikome.dk_shifts;\n  if p_from is null'
    );
    expect(() => T.kiridasu(warui)).toThrow(/delete/);
  });
  it('④ 直す前の 形（行ごと 丸ごと・本人で 絞らない）は NG', () => {
    const mae =
      'select to_jsonb(ed) from daikome.dk_shift_edits ed; select to_jsonb(w) from daikome.dk_work_hours w; select to_jsonb(m) from daikome.dk_manual_days m;';
    expect(T.kazoeru(mae).ok).toBe(false);
    expect(T.kazoeru('').ok, '★空を OK に しない★').toBe(false);
  });
  it('④-2 在って ほしい 字が 揃っていても 行ごと 丸ごとが 残っていれば NG', () => {
    const b = T.kiridasu(SQL);
    const mazari = b + '\n-- 残り: select to_jsonb(w) from daikome.dk_work_hours w';
    expect(T.kazoeru(mazari).ok, '★to_jsonb(w) が 残っているのに OK★').toBe(false);
  });
  it('⑤ 辞めた 人の 門の 古い 版・欠けた 版は NG（10-17 対立役 N7）', () => {
    const b = T.kiridasu(SQL);
    const kaeru = [
      ['(p_to - p_from) > 93', '(p_to - p_from) > 62'],
      [
        'select sh2.shift_id from daikome.dk_shifts sh2',
        'select sh2.id from daikome.dk_shifts sh2',
      ],
      // 2026-10-17 手当・控除だけの 月を 通す・切る 日を 分ける（前の 版＝手当・控除を 見ない／1本の p_to で 全部 切る）
      ['select 1 from daikome.dk_pay_adjustments a', 'select 1 from daikome.dk_work_hours a'],
      [
        "p_to := least(p_to, (date_trunc('month', v_saigo_a)",
        "p_to := least(p_to, (date_trunc('month', v_saigo)",
      ],
      [
        "v_kaisha_to := least(p_to, (date_trunc('month', v_saigo)",
        "v_kaisha_to := least(p_to, (date_trunc('month', v_saigo_a)",
      ],
      ['v_kaisha_to := p_from - 1', 'v_kaisha_to := p_to'],
      [
        "and (sh.started_at at time zone 'Asia/Tokyo')::date between p_from and v_kaisha_to",
        "and (sh.started_at at time zone 'Asia/Tokyo')::date between p_from and p_to",
      ],
      ['m.work_date between p_from and v_kaisha_to', 'm.work_date between p_from and p_to'],
    ];
    for (const [a, z] of kaeru) {
      expect(b.split(a).length, '★置き換える 所が 1か所 でない（' + a + '）★').toBe(2);
      expect(T.kazoeru(b.replace(a, z)).ok, '★' + a + ' が 無いのに OK★').toBe(false);
    }
  });
});

// ★4桁の 件の 後に 当てる md5 の 門★ 2026-10-20（司さん「揃えろ」）
//   わざと壊す：門の 判じの 1つを 外す ⇒ 下の どれかが 赤
describe('★4桁の 後の md5 の 門（yonketaNoMon）★', () => {
  it('倉庫が 4桁の 版・塊が 道具に 書いた 版 ⇒ 通す', () => {
    const b = T.kiridasu(SQL);
    expect(T.yonketaNoMon(b, T.MAE_4KETA)).toEqual([]);
  });
  it('倉庫が 知らない 版（4桁の 前の 版 等）⇒ 止める', () => {
    const b = T.kiridasu(SQL);
    expect(T.yonketaNoMon(b, '695e805f903928247b788f3f22e9d563').length).toBe(1);
  });
  it('塊が 道具に 書いた 版と 違う（1字 変えた）⇒ 止める', () => {
    const b = T.kiridasu(SQL).replace("'tebikiJippi', true", "'tebikiJippi', false");
    expect(T.yonketaNoMon(b, T.MAE_4KETA).length).toBeGreaterThan(0);
  });
  it('4桁の 守りの 字（3回で 止める）が 無い 塊 ⇒ 止める', () => {
    const b = T.kiridasu(SQL).replace('set pw_miss = least(pw_miss + 1, 3),', 'set pw_miss = 0,');
    const ng = T.yonketaNoMon(b, T.MAE_4KETA);
    expect(ng.some((x) => x.indexOf('4桁の 守り') >= 0)).toBe(true);
  });
});

// ★回数・距離の 直しの 列が 3列 無い 倉庫には 当てない★ 2026-10-25（対立役 2回目 止1）
//   わざと壊す：kazuRetsuNoMon が いつも '' を 返す ⇒ 赤
describe('★回数・距離の 直しの 列の 門（kazuRetsuNoMon）★', () => {
  it('3列 在れば 通す・0列／2列／読めない は 止める', () => {
    expect(T.kazuRetsuNoMon([{ n: 3 }])).toBe('');
    expect(T.kazuRetsuNoMon([{ n: 0 }])).toMatch(/apply-kazu-naoshi\.sql/);
    expect(T.kazuRetsuNoMon([{ n: 2 }])).not.toBe('');
    expect(T.kazuRetsuNoMon(null)).not.toBe('');
    expect(T.kazuRetsuNoMon([])).not.toBe('');
  });
  it('問いは 3つの 列を 名指しで 数える', () => {
    ['trip_count_naoshi', 'actual_total_m_naoshi', 'total_distance_m_naoshi'].forEach((c) =>
      expect(T.KAZU_RETSU_Q).toContain("'" + c + "'")
    );
  });
});
