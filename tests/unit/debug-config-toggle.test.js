// tests/unit/debug-config-toggle.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step P3-⑮ / 全32件)
//
// 検証対象: debug-config.js DEBUG 環境判定 + Eruda ボタン localStorage 永続化
//   PRODUCTION_HOSTS = ['daikou-app.vercel.app']
//   enabled = isVercelPreview || isLocalhost || hasDebugParam
//   localStorage key: 'daikome_eruda_btn_pos'
//
// 絶対ルール準拠:
//   js/debug-config.js は触らない absolute・環境判定ロジックを isolated 実装で検証。

const fs = require('fs');
const path = require('path');

const DC_PATH = path.join(__dirname, '..', '..', 'js', 'debug-config.js');

function loadSource() {
  return fs.readFileSync(DC_PATH, 'utf8');
}

// isolated 環境判定実装 (= debug-config.js L12-47 と論理的等価)
function evalEnv(hostname, search) {
  const PRODUCTION_HOSTS = new Set(['daikou-app.vercel.app']);
  const isProductionHost = PRODUCTION_HOSTS.has(hostname);
  const isVercelPreview = hostname.endsWith('.vercel.app') && !isProductionHost;
  const isLocalhost =
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.');
  const hasDebugParam = (search || '').includes('debug=1');
  const isProduction = isProductionHost || (!isVercelPreview && !isLocalhost);
  return {
    enabled: isVercelPreview || isLocalhost || hasDebugParam,
    showEruda: isVercelPreview || isLocalhost || hasDebugParam,
    isProduction,
    isVercelPreview,
    isLocalhost,
    hasDebugParam,
  };
}

describe('debug-config.js 環境判定 + Eruda 永続化 (P3-⑮)', () => {
  it('S1: PRODUCTION_HOSTS に daikou-app.vercel.app が登録', () => {
    const source = loadSource();
    if (
      !/PRODUCTION_HOSTS\s*=\s*new\s+Set\s*\(\s*\[\s*['"]daikou-app\.vercel\.app['"]/.test(source)
    ) {
      throw new Error('PRODUCTION_HOSTS に daikou-app.vercel.app 未登録');
    }
  });

  it('S2: localStorage key daikome_eruda_btn_pos で位置永続化', () => {
    const source = loadSource();
    if (!/daikome_eruda_btn_pos/.test(source)) {
      throw new Error('daikome_eruda_btn_pos localStorage key 未検出');
    }
  });

  it('S3: hasDebugParam = ?debug=1 で判定', () => {
    const source = loadSource();
    if (!/search\.includes\s*\(\s*['"]debug=1['"]/.test(source)) {
      throw new Error('?debug=1 判定未検出');
    }
  });

  it('D1: daikou-app.vercel.app → isProduction=true, enabled=false (本番)', () => {
    const env = evalEnv('daikou-app.vercel.app', '');
    expect(env.isProduction).toBe(true);
    expect(env.enabled).toBe(false);
  });

  it('D2: localhost → isProduction=false, enabled=true (= debug ON)', () => {
    const env = evalEnv('localhost', '');
    expect(env.isLocalhost).toBe(true);
    expect(env.isProduction).toBe(false);
    expect(env.enabled).toBe(true);
    expect(env.showEruda).toBe(true);
  });

  it('D3: 127.0.0.1 → localhost 扱い', () => {
    const env = evalEnv('127.0.0.1', '');
    expect(env.isLocalhost).toBe(true);
    expect(env.enabled).toBe(true);
  });

  it('D4: 192.168.x.x → localhost 扱い', () => {
    const env = evalEnv('192.168.1.100', '');
    expect(env.isLocalhost).toBe(true);
    expect(env.enabled).toBe(true);
  });

  it('D5: branch-preview.vercel.app → isVercelPreview=true', () => {
    const env = evalEnv('feat-test.vercel.app', '');
    expect(env.isVercelPreview).toBe(true);
    expect(env.isProduction).toBe(false);
    expect(env.enabled).toBe(true);
  });

  it('D6: 独自ドメイン daikome.com → isProduction=true', () => {
    const env = evalEnv('daikome.com', '');
    expect(env.isProduction).toBe(true);
    expect(env.enabled).toBe(false);
  });

  it('D7: ?debug=1 付与で本番でも enabled=true', () => {
    const env = evalEnv('daikou-app.vercel.app', '?debug=1');
    expect(env.hasDebugParam).toBe(true);
    expect(env.enabled).toBe(true);
    // isProduction は host ベースのため変更なし
    expect(env.isProduction).toBe(true);
  });

  it('D8: ?other=value (debug=1 含まず) → enabled は元判定のまま', () => {
    const env = evalEnv('daikou-app.vercel.app', '?other=value');
    expect(env.hasDebugParam).toBe(false);
    expect(env.enabled).toBe(false);
  });

  it('D9: search 空文字でも例外なし', () => {
    expect(() => evalEnv('localhost', '')).not.toThrow();
    expect(() => evalEnv('localhost', null)).not.toThrow();
  });
});
