'use strict';
// ============================================================
// ★★車ごとの URL／QR＝消しても 同じ席に 戻る★★ 2026-09-19（司さん）
//
//   ★司さんの言葉★
//     「このURLとQRコードは車ごとに出さないかんことないか？
//       忘れたり消してしまったらもとのメーターに戻れんやないか」
//     「車ごとに出さな何のために較正しよんど」
//
//   ★前まで（実測 2026-09-19）★
//     ・URL は ★会社に 1本★（?c=url_token）だけ
//     ・端末の 番号は ★そのスマホの 中で 作る ただの 乱数★（crypto.randomUUID → localStorage）
//     ⇒ 消す／機種変／入れ直し で ★別の 端末★ に なる
//     ⇒ 席が 埋まっていれば ★断られる（seat_limit）＝現場が 止まる★
//       事務所で 古い席を「外す」まで 動けなかった。
//     ⇒ しかも ★較正は 車（VIN）ごと★（index.html「VINキーで localStorage 保存」）
//       なのに 席は スマホごと ＝ ★噛み合っていなかった★
//     ・実測 … 倉庫に ★車の表も 較正の表も 1つも 無い★（daikome の 20表 全部 見た）
//
//   ★これから★
//     車ごとの URL に ★&d=その席の 番号★。開いた 時に 引き継ぐ。
//     ⇒ 倉庫から 見ると ★同じ 端末が 戻ってきただけ★
//       （dk-issue-license は 既に 在る device_id なら ★席を 数え直さない＝冪等★）
//     ⇒ ★★席は 増えない／事務所の 操作は 要らない★★
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-19 実測 ＝ 下に 書く）★★
//     ①c が 無くても d を 受けるように する ………………… ★赤★
//     ②adoptDeviceId の 形の 門（長さ・使える字）を 外す … ★赤★
//     ③activate の 後に 引き継ぐ 並びに する …………………★赤★
// ============================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const yomu = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const LA = require('../../js/license-activate.js');
const INDEX = yomu('index.html');
const DASH = yomu('dashboard.html');
const FN = yomu('supabase/functions/dk-issue-license/index.ts');

describe('★①席を 引き継ぐ（実際に 動かす）★', () => {
  const KEY = 'DAIKOME_DEVICE_ID';
  beforeEach(() => {
    const mem = {};
    global.localStorage = {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => {
        mem[k] = String(v);
      },
      removeItem: (k) => {
        delete mem[k];
      },
    };
  });

  it('★まともな 番号は 引き継ぐ★', () => {
    expect(LA.adoptDeviceId('22849fdb-cde7-4f1d-afc7-47009a6e08c8')).toBe(true);
    expect(global.localStorage.getItem(KEY)).toBe('22849fdb-cde7-4f1d-afc7-47009a6e08c8');
  });

  it('★★形が おかしい 物は 受けない（乗っ取り・打ち間違い）★★', () => {
    const dame = [
      '', // 空
      'abc', // 短すぎ
      'x'.repeat(65), // 長すぎ
      '../../etc/passwd', // 道を 混ぜる
      "' or 1=1--", // 倉庫へ 混ぜる
      '<script>x</script>',
      'aaaa aaaa', // 隙間
    ];
    dame.forEach((v) => {
      expect(
        LA.adoptDeviceId(v),
        '★受けては いけない 値を 受けました★： ' + JSON.stringify(v)
      ).toBe(false);
    });
  });

  it('★同じ 番号なら 書き込まない（無駄に 触らない）★', () => {
    const id = '22849fdb-cde7-4f1d-afc7-47009a6e08c8';
    LA.adoptDeviceId(id);
    let kaita = 0;
    const moto = global.localStorage.setItem;
    global.localStorage.setItem = function (k, v) {
      kaita++;
      return moto.call(global.localStorage, k, v);
    };
    expect(LA.adoptDeviceId(id)).toBe(true);
    expect(kaita, '★同じ 番号なのに 書き込んでいます★').toBe(0);
  });

  it('★引き継いだ 番号を そのまま 名乗る★', () => {
    LA.adoptDeviceId('7e1919ef-4aaa-411e-8db0-ba0424d1fe53');
    expect(LA.deviceId()).toBe('7e1919ef-4aaa-411e-8db0-ba0424d1fe53');
  });
});

describe('★②メーターの 繋ぎ方★', () => {
  it('★★c（会社）が 在る 時だけ d を 受ける★★', () => {
    // d だけ 流れてきた URL で 席を 取られないように する
    const i = INDEX.indexOf('adoptDeviceId');
    expect(i, '★メーターが adoptDeviceId を 呼んでいません★').toBeGreaterThan(0);
    // if (_c) { … adoptDeviceId … } の 中に 在る事を 見る
    const mae = INDEX.slice(0, i);
    const ifC = mae.lastIndexOf('if (_c) {');
    const katsu = mae.lastIndexOf('activate(_c)');
    expect(
      ifC > 0 && ifC > katsu,
      '★adoptDeviceId が「c が 在る時」の 外に 出ています★＝d だけで 席を 取られます'
    ).toBe(true);
  });

  it('★★引き継ぎは activate より 先★★', () => {
    // 後に すると activate が 古い 番号で 席を 取り、席が 1つ 増える
    const a = INDEX.indexOf('adoptDeviceId');
    const b = INDEX.indexOf('LicenseActivate.activate(_c)');
    expect(a > 0 && b > 0, '見つかりません').toBe(true);
    expect(
      a < b,
      '★引き継ぎが activate より 後に なっています★\n' +
        '  ＝古い 番号で 席を 取り ★席が 1つ 増えます★（4/4 なら 断られます）'
    ).toBe(true);
  });

  it('★d を 履歴に 残さない★', () => {
    expect(
      /searchParams\.delete\('d'\)/.test(INDEX),
      '★d を URL から 消していません★＝人に 見えたまま に なります'
    ).toBe(true);
  });
});

describe('★③事務所が 車ごとに 出す★', () => {
  it('★行ごとに &d= を 付けた URL を 作る★', () => {
    expect(
      /currentUrl \+ '&d=' \+ encodeURIComponent\(d\.device_id\)/.test(DASH),
      '★車ごとの URL を 作っていません★'
    ).toBe(true);
  });

  it('★★行き先が 違う 時は 配らない（QR_BLOCKED）★★', () => {
    const i = DASH.indexOf("var carUrl = currentUrl + '&d='");
    expect(i, '車ごとの URL が 見つかりません').toBeGreaterThan(0);
    const mae = DASH.slice(Math.max(0, i - 400), i);
    expect(
      /if \(!QR_BLOCKED && currentUrl\)/.test(mae),
      '★行き先が 違う 時でも 配って しまいます★（2026-08-21 の 決まり）'
    ).toBe(true);
  });

  it('★コピーと QR の 両方を 出す★', () => {
    expect(DASH.indexOf('この車のURLをコピー') > 0, '★コピーが 在りません★').toBe(true);
    expect(/qr\.addData\(carUrl\)/.test(DASH), '★QR が 車ごとの URL を 使っていません★').toBe(true);
  });
});

describe('★④席が 増えない（倉庫の 側）★', () => {
  it('★★既に 在る 端末は 席を 数え直さない（冪等）★★', () => {
    // ここが 壊れると 引き継いでも ★席が 増えて 断られる★
    expect(
      /if \(!dev\)/.test(FN),
      '★既に 在る 端末を 素通しする 作りが 在りません★＝引き継ぎが 効きません'
    ).toBe(true);
    const i = FN.indexOf('if (!dev)');
    const naka = FN.slice(i, i + 500);
    expect(/seat_limit/.test(naka), '★席の 数え直しが「初めての 端末」の 中に 在りません★').toBe(
      true
    );
  });
});
