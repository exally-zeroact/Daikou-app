// tests/integration/firebase-remote-config-ab-variant.test.js
// ZEROact 共通テスト基盤 (2026-05-18 新規・Step ㉛ / 全32件・真の完全網羅 3/4)
//
// 検証対象: Firebase Remote Config A/B variant 切替経路
//   index.html L4291 firebase.remoteConfig 利用
//   scripts/zeroact-test-commons/observability/ab-config.js fetchAndActivate
//
// 絶対ルール準拠:
//   index.html は触らない absolute・ab-config.js は scripts/ で touch 可能だが
//   本 test は新規追加のみ・既存無変更。

const fs = require('fs');
const path = require('path');

const INDEX_HTML = path.join(__dirname, '..', '..', 'index.html');
const AB_CONFIG = path.join(
  __dirname,
  '..',
  '..',
  'scripts',
  'zeroact-test-commons',
  'observability',
  'ab-config.js'
);

describe('Firebase Remote Config A/B variant (㉛)', () => {
  it('S1: index.html が firebase.remoteConfig() を利用', () => {
    const src = fs.readFileSync(INDEX_HTML, 'utf8');
    if (!/firebase\.remoteConfig\s*\(\s*\)/.test(src)) {
      throw new Error('firebase.remoteConfig() 呼出未検出 in index.html');
    }
  });

  it('S2: ab-config.js が fetchAndActivate() 経路を持つ', () => {
    if (!fs.existsSync(AB_CONFIG)) {
      throw new Error('ab-config.js ファイル未存在');
    }
    const src = fs.readFileSync(AB_CONFIG, 'utf8');
    if (!/fetchAndActivate\s*\(\s*\)/.test(src)) {
      throw new Error('fetchAndActivate() 呼出未検出');
    }
  });

  it('S3: ab-config.js が remoteConfig instance を受け取る (= 起動時注入)', () => {
    const src = fs.readFileSync(AB_CONFIG, 'utf8');
    if (!/rcInstance/.test(src)) {
      throw new Error('rcInstance 利用未検出');
    }
  });

  it('S4: index.html L4291 周辺で typeof firebase.remoteConfig 確認', () => {
    const src = fs.readFileSync(INDEX_HTML, 'utf8');
    if (!/typeof\s+firebase\.remoteConfig\s*===\s*['"]function['"]/.test(src)) {
      throw new Error('typeof firebase.remoteConfig === function ガード未検出');
    }
  });

  it('S5: __rcInstance 変数で Remote Config を保持', () => {
    const src = fs.readFileSync(INDEX_HTML, 'utf8');
    if (!/__rcInstance\s*=\s*firebase\.remoteConfig/.test(src)) {
      throw new Error('__rcInstance 代入未検出');
    }
  });

  it('S6: variant 切替で getValue / getBoolean / getString 経路 (= 一般的 API)', () => {
    const src = fs.readFileSync(AB_CONFIG, 'utf8');
    const hasGetValue =
      /getValue\s*\(/.test(src) ||
      /getBoolean\s*\(/.test(src) ||
      /getString\s*\(/.test(src) ||
      /getNumber\s*\(/.test(src);
    if (!hasGetValue) {
      throw new Error('Remote Config getValue/getBoolean/getString/getNumber 経路未検出');
    }
  });
});
