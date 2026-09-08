'use strict';
// ============================================================
// ★★OBD＝繋がらない 時に どれだけで 諦めるか★★ 2026-09-08
//
//   ★司さん★「短くしろよ」
//
//   ★前（実測の 計算）★
//     1つの 方式 … ATSP(2.5s)＋落ち着き(0.3s)＋0100×3(7s)＋再送待ち×2(0.7s) ＝ ★25.2秒★
//     3つ 全部 … 75.6秒 ＋ ATZ/初期化 4秒 ＝ ★約80秒★
//
//   ★今★ ★意味の 無い 待ちだけ★を 切った
//     ①機械が ★一度も 返事を しない★ ⇒ 方式を 変えても 無駄 ⇒ 1つ目で 打ち切り
//     ②ATSP0（自動）は 機械が 自分で 全部 探す 物 ⇒ 駄目なら ATSP7 は 同じ 事
//        ⇒ 2つ目で 打ち切り
//   ★繋がる 車の 道は 1つも 短くしていません★（方式1で 通れば 今まで通り）
//
//   ★ここでは 何を 測るか★
//     ★偽の OBD 機械★を 作って ★何回 0100 を 撃ったか★を 数える。
//     時間そのものでは なく ★撃った 回数★で 見る（試験が 80秒 かからない）
//       前 … 3方式 × 3回 ＝ ★9回★
//       今 … 機械が 黙る＝★3回★（1方式）／車が 黙る＝★6回★（2方式）
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-08 実測）★★
//     ①打ち切りを 外す（3方式 全部 試す）… ★赤★（9回に なる）
// ============================================================
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'obd-client.js'), 'utf8');

// ★_warmup の 中身を そのまま 取り出して 動かす★
//   （本物の ファイルから 切り出す＝写しを 作らない）
function tsukuru(kotae) {
  const utta = [];
  // ★偽の 機械★：0100 に 何を 返すか を 呼ぶ側が 決める
  const _send = (cmd, _to) => {
    if (/^0100/.test(cmd)) {
      utta.push(cmd);
      const r = kotae(utta.length);
      return r === null ? Promise.reject(new Error('OBD timeout: ' + cmd)) : Promise.resolve(r);
    }
    return Promise.resolve('OK');
  };
  const _sleep = () => Promise.resolve();
  const susumi = [];
  const _susumi = (ji) => susumi.push(ji);

  const WARMUP_RETRIES = 3;
  const WARMUP_RETRY_WAIT_MS = 700;
  const PROTOCOL_TIMEOUT_MS = 7000;
  const _WARMUP_PROTOS = ['6', '0', '7'];

  // ★本物の _warmup を 切り出す★
  const i = SRC.indexOf('  function _warmup() {');
  const j = SRC.indexOf('\n  }\n', i) + 4;
  const honmono = SRC.slice(i, j);

  const _ecuKotae = false;
  // eslint-disable-next-line no-new-func
  const f = new Function(
    '_send',
    '_sleep',
    '_susumi',
    'WARMUP_RETRIES',
    'WARMUP_RETRY_WAIT_MS',
    'PROTOCOL_TIMEOUT_MS',
    '_WARMUP_PROTOS',
    '_WARMUP_ONE_MS',
    '_ecuKotae',
    honmono + '; return _warmup;'
  );
  const warmup = f(
    _send,
    _sleep,
    _susumi,
    WARMUP_RETRIES,
    WARMUP_RETRY_WAIT_MS,
    PROTOCOL_TIMEOUT_MS,
    _WARMUP_PROTOS,
    25200,
    _ecuKotae
  );
  return { warmup, utta, susumi };
}

describe('★繋がらない 時に どれだけで 諦めるか★', () => {
  it('★① 機械が 一度も 返事を しない ⇒ 1方式（3回）で 諦める★', async () => {
    const t = tsukuru(() => null); // 全部 timeout ＝ 機械が 黙っている
    const ok = await t.warmup();
    // eslint-disable-next-line no-console
    console.log('★機械が 黙る★ 撃った回数=' + t.utta.length + ' 進み=' + JSON.stringify(t.susumi));
    expect(ok, '★繋がったと 言っています★').toBe(false);
    expect(
      t.utta.length,
      '★機械が 黙っているのに 方式を 変えて 待っています★（前は 9回＝約80秒）'
    ).toBe(3);
  });

  it('★② 車が 黙っている（機械は 返事する）⇒ 2方式（6回）で 諦める★', async () => {
    // ★SEARCHING / UNABLE = 機械は 生きている が 車が 答えない★
    const t = tsukuru(() => 'SEARCHING...UNABLE TO CONNECT');
    const ok = await t.warmup();
    // eslint-disable-next-line no-console
    console.log('★車が 黙る★ 撃った回数=' + t.utta.length);
    expect(ok, '★繋がったと 言っています★').toBe(false);
    expect(t.utta.length, '★自動で 駄目なのに もう1方式 試しています★（前は 9回）').toBe(6);
  });

  it('★③ 繋がる 車は 今まで通り 1回で 済む★（道を 短くしていない）', async () => {
    const t = tsukuru(() => '41 00 BE 3E A8 11');
    const ok = await t.warmup();
    // eslint-disable-next-line no-console
    console.log('★繋がる★ 撃った回数=' + t.utta.length);
    expect(ok, '★繋がりません★').toBe(true);
    expect(t.utta.length, '★繋がる 車で 余計に 撃っています★').toBe(1);
  });
});
