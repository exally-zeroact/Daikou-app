'use strict';
// ============================================================
// ★店データ（poi-update）と 道（osm-update）の 定時は ずらす★ 2026-10-16
//   同じ 時刻だと 2本が 約11分 差で 始まる（本番の 9-01・10-01 実測）。poi の push が osm の checkout の 後に 入ると、
//   osm の push（やり直し 無し）が 拒否されて 道の データが 1か月 古い まま 残る（対立役 W-b・指示役）。
//   poi は 長い 月で 19分、見張り・書き継ぎ・積み直しの 見張りで 約7分 延びる＝30分 程度。
//   枠が 違うと 定時の 遅れも 違う（3時間 離れた 枠で 最大 1時間28分 違った・対立役 実測）＝3時間 離す。
//   ★見る 事★ YAML の schedule を 全部 読み（1行目 だけで ない・注釈は 読まない）、どの 組でも osm は poi より
//     月の 頭からの 分で 180分 以上 後。分・時・日は 数で、月と 曜日は *（数でない・範囲・曜日の 指定は 読めない＝赤）。
//   ★わざと壊して 赤に なった 記録（2026-10-16）★：osm を '0 18 1 * *' に 戻す／'0 20 1 * *'（2時間）／
//     2行目に '0 18 1 * *' を 足す／注釈に 本物と 違う cron を 書いて 本物を 18 に／poi '0 23 1 * *'・osm '0 0 2 * *'
// ============================================================
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const WF = path.resolve(__dirname, '..', '..', '.github', 'workflows');
function teiji(f) {
  const y = yaml.load(fs.readFileSync(path.join(WF, f), 'utf8'));
  // js-yaml は on: を true の 鍵に 読む事が ある（YAML 1.1）
  const on = y.on || y[true] || {};
  const s = Array.isArray(on.schedule) ? on.schedule : [];
  return s.map((x) => {
    const [mi, h, d, mo, w] = String(x && x.cron)
      .trim()
      .split(/\s+/);
    const kazu = (v) => (/^\d+$/.test(v) ? Number(v) : NaN);
    return { cron: x && x.cron, fun: kazu(d) * 1440 + kazu(h) * 60 + kazu(mi), mo, w };
  });
}

describe('★店データと 道の 定時は ずらす★', () => {
  it('osm-update は どの 組でも poi-update より 180分 以上 後に 始まる', () => {
    const poi = teiji('poi-update.yml');
    const osm = teiji('osm-update.yml');
    expect(poi.length, 'poi-update の 定時が 無い').toBeGreaterThan(0);
    expect(osm.length, 'osm-update の 定時が 無い').toBeGreaterThan(0);
    for (const t of [...poi, ...osm]) {
      expect(Number.isFinite(t.fun), '分・時・日が 数で ない: ' + t.cron).toBe(true);
      // 字の 範囲（GitHub が 受け付けない cron は 定時が 1度も 走らない）・日は 28 まで（月の 境目を またがない）
      const [mi, h, d] = String(t.cron).trim().split(/\s+/).map(Number);
      expect(
        mi >= 0 && mi <= 59 && h >= 0 && h <= 23 && d >= 1 && d <= 28,
        '分・時・日が 範囲の 外: ' + t.cron
      ).toBe(true);
      expect(t.mo + ' ' + t.w, '月・曜日の 指定が 在る: ' + t.cron).toBe('* *');
    }
    for (const p of poi)
      for (const o of osm)
        expect(
          o.fun - p.fun,
          '★osm（' + o.cron + '）が poi（' + p.cron + '）と 近すぎる（分）★'
        ).toBeGreaterThanOrEqual(180);
  });
});
