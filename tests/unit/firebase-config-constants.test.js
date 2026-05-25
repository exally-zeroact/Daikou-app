// tests/unit/firebase-config-constants.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step P3-⑳ / 全32件・P3 完了)
//
// 検証対象: firebase-config.js firebaseConfig 定数 + firebase.initializeApp 呼出
//   apiKey / authDomain / databaseURL / projectId / storageBucket / messagingSenderId / appId
//
// 絶対ルール準拠:
//   js/firebase-config.js は触らない absolute・vm sandbox + firebase mock。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FC_PATH = path.join(__dirname, '..', '..', 'js', 'firebase-config.js');

function loadSource() {
  return fs.readFileSync(FC_PATH, 'utf8');
}

describe('firebase-config.js firebaseConfig (P3-⑳)', () => {
  it('S1: firebaseConfig 定義 + initializeApp 呼出', () => {
    const source = loadSource();
    if (!/const\s+firebaseConfig\s*=\s*\{/.test(source)) {
      throw new Error('firebaseConfig 定数定義未検出');
    }
    if (!/firebase\.initializeApp\s*\(\s*firebaseConfig\s*\)/.test(source)) {
      throw new Error('firebase.initializeApp(firebaseConfig) 呼出未検出');
    }
  });

  it('S2: 必須 key (apiKey/authDomain/databaseURL/projectId/storageBucket/messagingSenderId/appId)', () => {
    const source = loadSource();
    const requiredKeys = [
      'apiKey',
      'authDomain',
      'databaseURL',
      'projectId',
      'storageBucket',
      'messagingSenderId',
      'appId',
    ];
    for (const key of requiredKeys) {
      if (!new RegExp(key + '\\s*:\\s*[\'"]').test(source)) {
        throw new Error('必須 key 未検出: ' + key);
      }
    }
  });

  it('S3: projectId = daikou-app-c821a (= ダイコメ Firebase プロジェクト)', () => {
    const source = loadSource();
    if (!/projectId\s*:\s*['"]daikou-app-c821a['"]/.test(source)) {
      throw new Error('projectId=daikou-app-c821a 未検出');
    }
  });

  it('S4: databaseURL が asia-southeast1 region (= 日本最寄)', () => {
    const source = loadSource();
    if (!/asia-southeast1/.test(source)) {
      throw new Error('databaseURL に asia-southeast1 region 未検出');
    }
  });

  it('D1: vm 実行で firebaseConfig が正しく構築される', () => {
    const ctx = { console: console };
    ctx.firebase = { initializeApp: () => ({ name: '[DEFAULT]' }) };
    vm.createContext(ctx);
    // const firebaseConfig は vm context に expose されないため末尾 append
    vm.runInContext(loadSource() + '\nglobalThis.firebaseConfig = firebaseConfig;', ctx, {
      filename: 'js/firebase-config.js',
    });
    expect(ctx.firebaseConfig).toBeDefined();
    expect(ctx.firebaseConfig.projectId).toBe('daikou-app-c821a');
  });

  it('D2: apiKey が AIza で始まる (= Google API key 形式)', () => {
    const ctx = { console: console };
    ctx.firebase = { initializeApp: () => ({ name: '[DEFAULT]' }) };
    vm.createContext(ctx);
    // const firebaseConfig は vm context に expose されないため末尾 append
    vm.runInContext(loadSource() + '\nglobalThis.firebaseConfig = firebaseConfig;', ctx, {
      filename: 'js/firebase-config.js',
    });
    expect(typeof ctx.firebaseConfig.apiKey).toBe('string');
    expect(ctx.firebaseConfig.apiKey).toMatch(/^AIza/);
  });

  it('D3: authDomain が *.firebaseapp.com', () => {
    const ctx = { console: console };
    ctx.firebase = { initializeApp: () => ({ name: '[DEFAULT]' }) };
    vm.createContext(ctx);
    // const firebaseConfig は vm context に expose されないため末尾 append
    vm.runInContext(loadSource() + '\nglobalThis.firebaseConfig = firebaseConfig;', ctx, {
      filename: 'js/firebase-config.js',
    });
    expect(ctx.firebaseConfig.authDomain).toMatch(/\.firebaseapp\.com$/);
  });

  it('D4: storageBucket が *.firebasestorage.app または *.appspot.com', () => {
    const ctx = { console: console };
    ctx.firebase = { initializeApp: () => ({ name: '[DEFAULT]' }) };
    vm.createContext(ctx);
    // const firebaseConfig は vm context に expose されないため末尾 append
    vm.runInContext(loadSource() + '\nglobalThis.firebaseConfig = firebaseConfig;', ctx, {
      filename: 'js/firebase-config.js',
    });
    expect(ctx.firebaseConfig.storageBucket).toMatch(/\.(firebasestorage\.app|appspot\.com)$/);
  });

  it('D5: appId が web app 形式 (= 1:xxx:web:xxx)', () => {
    const ctx = { console: console };
    ctx.firebase = { initializeApp: () => ({ name: '[DEFAULT]' }) };
    vm.createContext(ctx);
    // const firebaseConfig は vm context に expose されないため末尾 append
    vm.runInContext(loadSource() + '\nglobalThis.firebaseConfig = firebaseConfig;', ctx, {
      filename: 'js/firebase-config.js',
    });
    expect(ctx.firebaseConfig.appId).toMatch(/^1:\d+:web:[a-f0-9]+$/);
  });

  it('D6: messagingSenderId が数値文字列', () => {
    const ctx = { console: console };
    ctx.firebase = { initializeApp: () => ({ name: '[DEFAULT]' }) };
    vm.createContext(ctx);
    // const firebaseConfig は vm context に expose されないため末尾 append
    vm.runInContext(loadSource() + '\nglobalThis.firebaseConfig = firebaseConfig;', ctx, {
      filename: 'js/firebase-config.js',
    });
    expect(ctx.firebaseConfig.messagingSenderId).toMatch(/^\d+$/);
  });

  it('D7: initializeApp が firebaseConfig 引数で呼ばれる', () => {
    let capturedConfig = null;
    const ctx = { console: console };
    ctx.firebase = {
      initializeApp: (cfg) => {
        capturedConfig = cfg;
        return { name: '[DEFAULT]' };
      },
    };
    vm.createContext(ctx);
    // const firebaseConfig は vm context に expose されないため末尾 append
    vm.runInContext(loadSource() + '\nglobalThis.firebaseConfig = firebaseConfig;', ctx, {
      filename: 'js/firebase-config.js',
    });
    expect(capturedConfig).toBeDefined();
    expect(capturedConfig.projectId).toBe('daikou-app-c821a');
  });
});
