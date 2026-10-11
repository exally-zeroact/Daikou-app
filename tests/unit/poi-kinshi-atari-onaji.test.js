'use strict';
// ============================================================
// ★店データの 道具（scripts/poi-kinshi-atari.mjs）と 見張りの 本体が ★同じ 当たり★ を 返すかの 見張り★ 2026-10-11
//   道具の matchIdx は 見張りの 本体（tests/kinshi-ji.test.mjs・凍結の 版）の 写し。本体は matchIdx を 書き出していないので、
//   見張りを 直した 日に 道具だけ 黙って ずれる。⇒ 見張りの 本体が 書き出している scan（CLI と 同じ 当て方の 本体）と
//   道具に 同じ 見本の 文を 当て、当たる 語の 番号が 1つも 違わない事を 見る（指示役の 決め・見張りの 本体には 触らない）。
//   ★わざと壊して 赤に なった 記録（10-11・測った）★：道具の matchIdx の 和字を normJa でなく normAscii で 均す→2本 赤／
//     英字を 均さずに 当てる→1本 赤／ファイル全体の 行を つなぐ 2本（"" と " "）を 外す→1本 赤
//     （"" の 1本だけを 外すのは " " の 方が 同じ 働きを するので 動きが 変わらない＝弱めていない）／
//     タグの 枝を 外す→1本 赤／英字を 小文字に してから 当てる→2本 赤。
//   ★在る 事が 分かっている 違い★：欄の 中の 改行・タブ（JSON の 逃がしの 2字）は 見張りが 字のまま 読むので 当てず、
//     道具（JSON を ほどく）は 当てる＝道具の 方が 多く 出す（安全な 側・見張りの 本体の 穴として 指示役へ 渡した）。
// ============================================================
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const GO = [
  '見本太郎',
  'みほんはなこ',
  'SAMPLE Co',
  'mihon@example.test',
  '架空区見本台1-2-3',
  'Mihon', // 英字1語＝大文字小文字を 区別する 語
];

// 見本の 文（施設の 名前の 欄に 入れる）。当たる 形・当たらない 形を 混ぜる
const MIHON = [
  'ミホンハナコの店', // ひらがなの 語を カタカナで
  '見本​太郎', // 幅0の 空白
  '見本­太郎', // 見えない ハイフン
  'ｓａｍｐｌｅ　ｃｏ', // 全角
  'SAMPLE-Co', // 区切りが ハイフン
  'samplecox', // 語の 境が 無い＝当たらない
  'MIHON@EXAMPLE.TEST', // メールの 形は 大文字小文字を 問わない
  '架空区見本台１－２－３', // 全角の 数字と ダッシュ
  '架空区見本台1−2−3', // マイナスの 字
  'ふつうの店', // 当たらない
  'Mihon店', // 英字1語の 語（大文字が 合う）
  'mihon 店', // 英字1語の 語の 小文字＝当たらない（区別する）
];

function mise(names) {
  return (
    'window.POI_TEST = ' +
    JSON.stringify({
      v: 2,
      cats: { 0: 'hotel' },
      pois: names.map((n, i) => ({ c: 0, lat: i, lng: i, n })),
    }) +
    ';\n'
  );
}

describe('★店データの 道具と 見張りの 本体が 同じ 当たりを 返す（10-11）★', () => {
  let K;
  let T;
  let words;
  beforeAll(async () => {
    K = await import(pathToFileURL(path.join(ROOT, 'tests', 'kinshi-ji.test.mjs')).href);
    T = await import(pathToFileURL(path.join(ROOT, 'scripts', 'poi-kinshi-atari.mjs')).href);
    words = K.loadWords({ env: { KINSHI_JI: GO.join('\n') }, file: null }).words;
  });

  // 見張りの 本体の scan に 1本の ファイルとして 渡し、当たった 語の 番号（1 から）を 返す
  function mihariNoGo(text) {
    const buf = Buffer.from(text, 'utf8');
    const r = K.scan({
      root: ROOT,
      files: ['data/poi-test.js'],
      words,
      src: {
        kind: () => 'file',
        read: () => buf,
        id: () => '',
        shiroText: () => null,
        partial: true,
      },
    });
    const s = new Set();
    for (const h of r.hits) {
      const m = /一覧の (\d+) 番目/.exec(h);
      if (m) s.add(Number(m[1]));
    }
    return [...s].sort((a, b) => a - b);
  }

  it('見本の 文 1つずつで、見張りと 道具（施設ごと・ファイル全体）の 当たる 語の 番号が 同じ', () => {
    let atatta = 0;
    for (const n of MIHON) {
      const text = mise([n]);
      const mihari = mihariNoGo(text);
      const dougu = [...new Set(T.atari(T.yomuMise(text), words).map((x) => x.go))].sort(
        (a, b) => a - b
      );
      const zentai = [...T.zentaiNoGo(text, words)].sort((a, b) => a - b);
      expect({ n: [...n].length, dougu }).toEqual({ n: [...n].length, dougu: mihari });
      expect({ n: [...n].length, zentai }).toEqual({ n: [...n].length, zentai: mihari });
      if (mihari.length) atatta++;
    }
    // 見本が 当たる 形と 当たらない 形の 両方を 持つ（全部 0 で 緑に しない）
    expect(atatta).toBeGreaterThanOrEqual(8);
    expect(atatta).toBeLessThan(MIHON.length);
  });

  it('行を またいで つながる 語（頭の 注釈）も ファイル全体の 当て方は 見張りと 同じ', () => {
    const text = ['// 見本', '太郎 の 注', mise(['ふつうの店'])].join('\n');
    const mihari = mihariNoGo(text);
    expect(mihari).toEqual([1]);
    expect([...T.zentaiNoGo(text, words)].sort((a, b) => a - b)).toEqual(mihari);
  });

  it('欄の 中の タグ（見本<T>太郎）：ファイル全体の 当たりは 見張りと 同じ・施設ごとには 結べない＝道具は 止まる 側', () => {
    const text = mise(['見本<T>太郎']);
    const mihari = mihariNoGo(text);
    expect(mihari).toEqual([1]);
    expect([...T.zentaiNoGo(text, words)].sort((a, b) => a - b)).toEqual(mihari);
    // 施設ごとには 当たらない＝道具は「施設に 結べない 当たり」で 終わり値 2（main の 照らし）
    expect(T.atari(T.yomuMise(text), words).length).toBe(0);
  });

  it('全部の 見本を 1本に 並べても 同じ', () => {
    const text = mise(MIHON);
    const mihari = mihariNoGo(text);
    const dougu = [...new Set(T.atari(T.yomuMise(text), words).map((x) => x.go))].sort(
      (a, b) => a - b
    );
    expect(dougu).toEqual(mihari);
    expect(mihari.length).toBe(GO.length);
  });
});
