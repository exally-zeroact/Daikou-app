'use strict';
// ============================================================
// ★終わらせる操作を、センサー許可で止めないこと★ 2026-08-07
//
//   ★司さんの報告★
//     「事務所に戻るとOBDきれるのに警告のせいで業務終了が押せない」
//
//   ★何が起きていたか★
//     司さんは iPhone。iPhoneのアプリは★一度離れて戻ると
//     加速度・方位センサーの許可が切れる★（iOSの決まり）。
//     その状態でボタンを押すと blockIfSensorNotGranted() に止められ、
//     「センサーを許可して」の警告が出るだけで★何も起きない★。
//     ＝業務終了を押しても終われない。事務所に戻った時に必ず起きる。
//
//   ★決めた線引き★
//     許可が要るのは ★これから測り始める操作★ だけ:
//         代行開始 / 業務再開 / 前の業務を引き継ぐ / 経由地点
//     許可が要らないのは ★終わらせる・見る操作★:
//         業務終了 / 終了確定 / 確定(精算) / 空車に戻る / 取消 / 履歴
//     終わらせる操作は「もう測った分を締める」だけで、センサーは要らない。
//     ここを止めると★精算できずに詰む★（お金が絡む所なので特に危ない）。
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// その関数の中で、センサーの許可で止めているか
function gated(fnName) {
  const i = HTML.indexOf('function ' + fnName + '()');
  if (i < 0) return null; // 関数が無い
  // 次の関数定義までを、その関数の中身とみなす
  const next = HTML.indexOf('\n      function ', i + 10);
  const body = HTML.slice(i, next > i ? next : i + 4000);
  return /blockIfSensorNotGranted\(\)\)\s*return/.test(body);
}

describe('★終わらせる・見る操作は止めないこと★', () => {
  const FINISH = [
    ['onBusinessEnd', '業務終了'],
    ['onBusinessConfirm', '終了確定'],
    ['onSend', '確定（精算）'],
    ['onIdle', '空車に戻る'],
    ['onCancelTrip', '取消'],
    ['onHistory', '履歴'],
  ];

  FINISH.forEach(function ([fn, label]) {
    it(label + '（' + fn + '）は センサー許可で止めない', () => {
      const g = gated(fn);
      expect(g, fn + ' が見つからない').not.toBe(null);
      expect(g, '★' + label + 'がセンサー許可で止まる＝iPhoneで事務所に戻ると押せなくなる★').toBe(
        false
      );
    });
  });

  it('★特に「業務終了」と「確定」は絶対に止めない★（終われない・精算できない）', () => {
    expect(gated('onBusinessEnd'), '★終われなくなる★').toBe(false);
    expect(gated('onSend'), '★精算できずに詰む★').toBe(false);
  });
});

describe('★測り始める操作は今までどおり止めること★', () => {
  const START = [
    ['onMainBtn', '代行開始'],
    ['onBusinessResume', '業務再開'],
    ['onResumeFromStart', '前の業務を引き継ぐ'],
    ['onWaypointBtn', '経由地点'],
  ];

  START.forEach(function ([fn, label]) {
    it(label + '（' + fn + '）は 許可を確かめる', () => {
      const g = gated(fn);
      expect(g, fn + ' が見つからない').not.toBe(null);
      expect(g, '★' + label + 'が許可なしで動く＝測れないまま走り出す★').toBe(true);
    });
  });
});

describe('★仕掛けそのものは消していないこと★', () => {
  it('blockIfSensorNotGranted は残っている（測り始める側で使う）', () => {
    expect(HTML).toContain('function blockIfSensorNotGranted()');
  });

  it('センサーを許し直す案内も残っている', () => {
    expect(HTML).toContain('センサー再起動が必要です');
  });

  it('★なぜ外したかが書いてある★（次に見た人が戻さないように）', () => {
    expect(HTML).toMatch(/センサーの許可は要求しない[\s\S]{0,400}iPhone/);
  });
});
