'use strict';
// ============================================================
// ★4ホストの組み合わせを機械で縛る 2026-08-02★
//
//   司さん「テスト用も本番用も要るやろ」＝それまで本番しか見ていなかった。
//
//   ★一番こわい間違い★
//     本番の事務所が出すQRが「テストのメーター」を指すこと。
//     読んだ従業員は★全員テスト版で走り始める★。実績は本番に1件も入らない。
//     しかも画面はいつもどおり動くので、誰も気づかない。
//
//   ここでは「表そのものが矛盾していないか」を見る（ネットに出ない）。
//   実物のホストが表どおりかは scripts/check-hosts.mjs（実配信を叩く）で見る。
// ============================================================
const path = require('path');

let H;
beforeAll(async () => {
  H = await import('../../scripts/dk-hosts.mjs');
});

describe('★4ホスト揃っていること★', () => {
  it('メーター2つ・事務所2つ', () => {
    const roles = Object.values(H.HOSTS).map((h) => h.role);
    expect(roles.filter((r) => r === 'meter').length).toBe(2);
    expect(roles.filter((r) => r === 'office').length).toBe(2);
  });

  it('テスト側・本番側が それぞれ メーター1＋事務所1', () => {
    ['test', 'prod'].forEach((side) => {
      const s = Object.values(H.HOSTS).filter((h) => h.side === side);
      expect(s.filter((h) => h.role === 'meter').length).toBe(1);
      expect(s.filter((h) => h.role === 'office').length).toBe(1);
    });
  });
});

describe('★事務所とメーターの取り違えを止める★', () => {
  it('いまの表は矛盾していない', () => {
    expect(H.checkPairing()).toEqual([]);
  });

  it('★本番の事務所は本番のメーターを指す★', () => {
    expect(H.expectedAppBase('daikome-jimusho.vercel.app')).toBe('https://daikou-app.vercel.app');
  });

  it('★テストの事務所はテストのメーターを指す★', () => {
    expect(H.expectedAppBase('daikome-jimusho-test.vercel.app')).toBe(
      'https://daikou-app-test.vercel.app'
    );
  });

  it('メーターは自分自身を指す（QRは自分のホストへ）', () => {
    expect(H.expectedAppBase('daikou-app.vercel.app')).toBe('https://daikou-app.vercel.app');
    expect(H.expectedAppBase('daikou-app-test.vercel.app')).toBe(
      'https://daikou-app-test.vercel.app'
    );
  });

  it('★側をまたいだら検出できる（わざと壊して確かめる）★', async () => {
    const mod = await import('../../scripts/dk-hosts.mjs');
    const saved = mod.HOSTS['daikome-jimusho.vercel.app'];
    // 本番の事務所がテストのメーターを指した状態を作る
    mod.HOSTS['daikome-jimusho.vercel.app'] = Object.assign({}, saved, {
      proxyOf: 'daikou-app-test.vercel.app',
    });
    const bad = mod.checkPairing();
    mod.HOSTS['daikome-jimusho.vercel.app'] = saved; // 戻す
    expect(bad.length).toBeGreaterThan(0);
    expect(bad.join()).toContain('側が違う');
  });

  it('★事務所にサービスワーカーを置いたら検出できる★', async () => {
    const mod = await import('../../scripts/dk-hosts.mjs');
    const saved = mod.HOSTS['daikome-jimusho.vercel.app'];
    mod.HOSTS['daikome-jimusho.vercel.app'] = Object.assign({}, saved, { serviceWorker: true });
    const bad = mod.checkPairing();
    mod.HOSTS['daikome-jimusho.vercel.app'] = saved;
    expect(bad.join()).toContain('serviceWorker');
  });
});

describe('★事務所にサービスワーカーは置かない★', () => {
  it('事務所2つとも serviceWorker=false', () => {
    Object.entries(H.HOSTS)
      .filter(([, h]) => h.role === 'office')
      .forEach(([host, h]) => {
        expect(h.serviceWorker, host).toBe(false);
      });
  });

  it('メーター2つは serviceWorker=true（圏外で動く必要がある）', () => {
    Object.entries(H.HOSTS)
      .filter(([, h]) => h.role === 'meter')
      .forEach(([host, h]) => {
        expect(h.serviceWorker, host).toBe(true);
      });
  });
});

describe('repo と メーターの対応', () => {
  it('2つのrepoがそれぞれのメーターに対応している', () => {
    expect(H.REPO_TO_METER['Daikou-app-test']).toBe('daikou-app-test.vercel.app');
    expect(H.REPO_TO_METER['Daikou-app']).toBe('daikou-app.vercel.app');
  });

  it('表に出てくるrepoは全部 REPO_TO_METER に在る', () => {
    Object.values(H.HOSTS)
      .filter((h) => h.repo)
      .forEach((h) => expect(H.REPO_TO_METER[h.repo]).toBeTruthy());
  });

  it('道具のファイルが実在する', () => {
    const fs = require('fs');
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'scripts', 'dk-hosts.mjs'))).toBe(true);
  });
});
