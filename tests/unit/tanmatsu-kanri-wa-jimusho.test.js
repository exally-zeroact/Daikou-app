'use strict';
// ============================================================
// ★★端末の 管理は 事務所 1か所★★ 2026-08-31（別件② 2026-08-30 積み分）
//
//   ★司さん（2026-08-31）★
//     「なんでメーター機側でせやいかんの？
//       そもそも事務所のQRコードかURLからしか入れんのやないんか？」
//     ⇒ ★その通りでした★
//
//   ★実物で 確かめた 事★
//     ①端末は ★会社URL（/?c=<url_token>）／QR★で 入る
//       js/daikome-admin.js（2026-08-07）
//       「★運転手はQRで有効化するだけなので、持ち主が空でもメーターは今日から使える★」
//       ⇒ ★メーターに ログインは 要らない★
//     ②事務所（dashboard.html）に ★もう 全部 有る★
//       一覧（dk_company_devices）／名前（dk_device_labels）／並べ替え／★外す（DELETE）★
//     ③メーターの #deviceAdminCard は ★QR方式より 前(2026-06-29)の 作り★で、
//       ★出す所が 1か所も 無く、実ブラウザで 高さ0★だった（2026-08-30・08-31 実測）
//     ⇒ ★同じ事を する 場所が 2つ ある★状態だったので メーター側を 外した。
//
//   ★ここで 見張る事★
//     ①メーターに ★端末管理の ログインが 生えていない★（また 2か所に ならない）
//     ②事務所に ★一覧・名前・外す★が 揃っている（外した先が 空だと ただの 機能減）
//
//   ★ここでは 見張れない 物（★「無い時に 緑」に しない★）★
//     倉庫の 仕掛け（dk_register_device / dk_list_my_devices / dk_remove_device）は
//     ★この repo に 1本も 書かれていません★（2026-08-31 実測・supabase/*.sql に 0件）。
//     倉庫にだけ 在る物なので ★repo の 試験では 確かめられません★。
//     ⇒ ここで「在る事」を 試すと ★中身が 無くても 緑★に なるので ★書きません★。
//     ⇒ 消していない事は ★倉庫を 直接 見て 確かめます★（今回 1行も 触っていません）。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const meter = () => fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const jimusho = () => fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');

describe('★端末の 管理は 事務所 1か所★', () => {
  it('★★① メーターに 端末管理の ログインが 無い★★', () => {
    const s = meter();
    [
      'deviceAdminCard',
      'devAdminEmail',
      'devAdminPass',
      'devAdminLoginBtn',
      'DK_ADMIN_TOKEN',
    ].forEach((k) => {
      expect(s.includes(k), `★メーターに ${k} が 生えています（事務所と 2か所に なります）★`).toBe(
        false
      );
    });
  });

  it('★★② 外した先（事務所）に 一覧・名前・外す が 揃っている★★', () => {
    const s = jimusho();
    expect(s, '★事務所に 端末の 一覧が ありません★').toContain('dk_company_devices');
    expect(s, '★事務所に 名前を 付ける所が ありません★').toContain('dk_device_labels');
    // ★外す＝DELETE を 実際に 投げている事★（札の 字だけ 在っても 意味が 無い）
    expect(
      /dk_company_devices\?company_id=eq\.[\s\S]{0,400}?method: 'DELETE'/.test(s),
      '★事務所に「外す」が ありません（メーターから 外しただけに なります）★'
    ).toBe(true);
  });

  it('★③ 端末は QR／会社URL で 入る（作りの 前提）★', () => {
    const s = fs.readFileSync(path.join(ROOT, 'js', 'daikome-admin.js'), 'utf8');
    expect(s, '★会社URL を 作る所が ありません★').toContain("'/?c=' + res.data[0].url_token");
  });
});
