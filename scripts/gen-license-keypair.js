#!/usr/bin/env node
'use strict';
// ============================================================================
// ダイコメ ライセンス署名鍵 生成 (2026-07-31・独立プロジェクト移設用)
//
//   ★何をする道具か★
//     ライセンス(署名トークン)には「はんこ」と「はんこの照合表」が要る。
//       ・はんこ本体(秘密鍵) = サーバ(Supabase)だけが持つ。絶対に外に出さない。
//       ・照合表(公開鍵)     = アプリに埋め込む。公開してよい。
//     新しい Supabase プロジェクトへ引っ越すと、はんこも新しく作り直しになる
//     (古いはんこは元のプロジェクトの中にあり、二度と取り出せないため)。
//
//   ★使い方(司さんの手・1回だけ)★
//     node scripts/gen-license-keypair.js
//
//     → 秘密鍵は「クリップボード」に入る(画面にもチャットにも出さない)。
//       そのまま Supabase の Edge Function secret `DK_LICENSE_PRIVKEY` の欄に Ctrl+V で貼る。
//     → 画面に出るのは「公開鍵」と「テスト用トークン」だけ。これはClaudeに渡してよい(公開して安全)。
//
//   ★出力の使い道★
//     PUBLIC_KEY     → js/license-v2.js の PUBLIC_KEY 定数に入れる(Claudeがやる)
//     FIXTURE_TOKEN  → tests/unit/license-v2-embedded-key.test.js の REAL_TOKEN に入れる(Claudeがやる)
//                      = 「アプリの公開鍵とサーバの秘密鍵が噛み合っている」ことを毎回テストで守るための固定値
//
//   オプション:
//     --print    クリップボードが使えない環境で、秘密鍵を画面に出す(★人が見ている端末でのみ★)
//     --no-clip  秘密鍵をどこにも出さない(動作確認用。鍵は捨てられる)
// ============================================================================

const crypto = require('crypto');
const { execFileSync } = require('child_process');

// テスト固定トークンの中身(既存の回帰テストと同じ形にそろえる)
const FIXTURE_PAYLOAD = {
  company_id: 'test-co',
  device_id: 'test-dev',
  vin: '',
  status: 'on',
  exp: 4102444800000, // 西暦2100年 = テスト中に期限切れしない
};

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function copyToClipboard(text) {
  try {
    if (process.platform === 'win32') {
      execFileSync('clip.exe', { input: text });
      return true;
    }
    if (process.platform === 'darwin') {
      execFileSync('pbcopy', { input: text });
      return true;
    }
    execFileSync('xclip', ['-selection', 'clipboard'], { input: text });
    return true;
  } catch (_) {
    return false;
  }
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

// 公開鍵: raw 32byte を base64url で(= WebCrypto / tweetnacl が取り込める形)
const PUBLIC_KEY = publicKey.export({ format: 'jwk' }).x;

// 秘密鍵: pkcs8 PEM(= Edge Function が importKey する形)
const PRIVATE_PEM = privateKey.export({ format: 'pem', type: 'pkcs8' });

// テスト固定トークン: payloadB64 の「文字列のバイト」に署名する(トークン契約)
const payloadB64 = b64url(Buffer.from(JSON.stringify(FIXTURE_PAYLOAD), 'utf8'));
const sig = crypto.sign(null, Buffer.from(payloadB64, 'utf8'), privateKey);
const FIXTURE_TOKEN = payloadB64 + '.' + b64url(sig);

// 自己検証: 作ったばかりの鍵で、その場で検証が通ることを確かめる(壊れた鍵を配らない)
const verified = crypto.verify(
  null,
  Buffer.from(payloadB64, 'utf8'),
  publicKey,
  Buffer.from(FIXTURE_TOKEN.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64')
);

console.log('');
console.log('==== ダイコメ ライセンス署名鍵 を新しく作りました ====');
console.log('');
console.log(
  '自己検証: ' + (verified ? '✅ 鍵ペアは正しく噛み合っています' : '❌ 異常。作り直してください')
);
console.log('');

if (process.argv.includes('--no-clip')) {
  console.log(
    '🧪 動作確認モード(--no-clip): 秘密鍵はどこにも出していません。この鍵は使えません(捨ててください)。'
  );
} else if (process.argv.includes('--print')) {
  console.log('---- 秘密鍵 (Supabase の DK_LICENSE_PRIVKEY に貼る・★他に出さない★) ----');
  console.log(PRIVATE_PEM);
} else {
  const copied = copyToClipboard(PRIVATE_PEM);
  if (copied) {
    console.log('🔑 秘密鍵は【クリップボードに入れました】。画面には出していません。');
    console.log(
      '   → Supabase → Edge Functions → Secrets → 名前 DK_LICENSE_PRIVKEY に Ctrl+V で貼ってください。'
    );
    console.log('   → 貼り終わったら、何か別の物をコピーしてクリップボードを上書きしてください。');
  } else {
    console.log(
      '⚠️ クリップボードに入れられませんでした。--print を付けて実行し、画面から手で写してください。'
    );
    console.log('   node scripts/gen-license-keypair.js --print');
  }
}

console.log('');
console.log('---- ここから下は公開して安全。Claudeにそのまま渡してください ----');
console.log('');
console.log('PUBLIC_KEY=' + PUBLIC_KEY);
console.log('');
console.log('FIXTURE_TOKEN=' + FIXTURE_TOKEN);
console.log('');
console.log('★秘密鍵はこのPCのどこにも保存していません(クリップボードのみ)。');
console.log('  Supabase に貼り損ねた場合は、このコマンドをもう一度実行して作り直してください。');
console.log('  作り直したら PUBLIC_KEY / FIXTURE_TOKEN も新しい方に差し替えが必要です。★');
console.log('');

process.exit(verified ? 0 : 1);
