// tests/integration/index-inline-noundef.test.js
//
// ★index.html インライン JS の no-undef 自動ガード (2026-05-30 新設)★
//   背景: 本番 Sentry DAIKOME-4 "ReferenceError: Can't find variable: total" は、
//   _renderMeterReadout 一本化で uiTimer 内の total/fare/extraTotal 算出が消え参照だけ残った
//   未定義変数バグ。husky の eslint は *.js のみ・stylelint は CSS のみで、
//   ★index.html のインライン JS は no-undef 検査を一切通らずすり抜けて本番クラッシュ★ した。
//
//   本テストは index.html の全インライン JS ブロックを連結 (= block 間の関数/変数は
//   互いにグローバルとして解決される) し、ESLint no-undef を実行して「total クラッシュ類の
//   未定義変数」を 0 件であることを CI の test ジョブで自動保証する。
//
//   ★新しい外部グローバル (別 <script src> で定義され index.html が参照する名前) を増やしたら
//     下の EXTERNAL_GLOBALS に追記すること。追記漏れは false-fail で気付ける (安全側)。★

const fs = require('fs');
const path = require('path');
const { ESLint } = require('eslint');

const INDEX_HTML = path.join(__dirname, '..', '..', 'index.html');

// 別ファイル (<script src>) で定義され index.html インライン JS から参照される外部グローバル。
// + サードパーティ / Web API で env:browser に含まれないもの。
// ※各名は「js/*.js で定義」or「typeof ガード付きオプショナル」or「CDN lib」と検証済 (2026-05-30)。
//   total クラッシュ類 = 無防備な未定義使用のみを検出対象とし、下記の正当グローバルは許可する。
const EXTERNAL_GLOBALS = [
  // ダイコメ自前モジュール (js/*.js で定義・別 <script src> load)
  'Meter',
  'GPS',
  'FB',
  'Business',
  'RegionHelper',
  'RoadDecoder',
  'PipelineDistance',
  'DataLoader',
  'MMDataPipeline',
  'PageLifecycle',
  'RoadGraphTileLoader',
  'TrainingCollector',
  'TrainingUploader',
  'dlog',
  'DEBUG',
  '_autoLoadNearbyRoads',
  'debugConfig',
  // typeof ガード付きオプショナル config (未 load 環境あり・defensive 参照)
  'DaikomeABConfig',
  'DaikomeOpenReplayConfig',
  'DaikomeSentryConfig',
  // サードパーティ (CDN / 別 load)
  'firebase',
  'eruda',
  'Sentry',
  'NoSleep',
  'Chart',
  // Web API / env:browser 外
  'structuredClone',
  'gtag',
  'dataLayer',
  'webkitAudioContext',
  'WakeLock',
  'Buffer',
];

// index.html から JS の <script> ブロックのみ抽出 (src 付き / JSON-LD 等 非 JS は除外)。
function extractInlineJs(htmlRaw) {
  // ★HTML コメントを先に除去★: コメント文中に "<script>" という文字列が含まれる箇所があり
  //   (例 L4935 "旧 fine-jp.js の <script> ロードは削除")、regex が誤って script 開始と誤認する。
  //   コメントアウトされた内容は lint 対象外で正しい。
  const html = htmlRaw.replace(/<!--[\s\S]*?-->/g, '');
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  let out = '';
  let kept = 0;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    if (/\bsrc=/.test(attrs)) continue; // 外部 src は対象外
    const tm = attrs.match(/type\s*=\s*["']([^"']+)["']/);
    const type = tm ? tm[1].toLowerCase() : '';
    // type 無し / JavaScript / module のみ JS とみなす (application/ld+json 等は除外)
    if (type && !/^(text\/javascript|application\/javascript|module|text\/babel)$/.test(type)) {
      continue;
    }
    out += '\n// === inline block ===\n' + m[2] + '\n;\n';
    kept++;
  }
  return { code: out, blocks: kept };
}

describe('static: index.html インライン JS no-undef ガード (Sentry DAIKOME-4 total 再発防止)', () => {
  it('index.html の全インライン JS に未定義変数 (total クラッシュ類) が 0 件', async () => {
    const html = fs.readFileSync(INDEX_HTML, 'utf8');
    const { code, blocks } = extractInlineJs(html);
    expect(blocks).toBeGreaterThan(0); // 抽出できている事の保証 (regex 破綻検知)

    const globals = {};
    for (const g of EXTERNAL_GLOBALS) globals[g] = 'readonly';

    const eslint = new ESLint({
      useEslintrc: false,
      overrideConfig: {
        env: { browser: true, es2021: true, worker: true },
        parserOptions: { ecmaVersion: 2022, sourceType: 'script' },
        globals,
        rules: { 'no-undef': 'error' },
      },
    });

    const results = await eslint.lintText(code, { filePath: 'index-inline.js' });
    const messages = (results[0] && results[0].messages) || [];

    // パースエラー (fatal) は検査が成立しないので即失敗 (= 静かに pass させない)。
    const fatal = messages.filter((m) => m.fatal);
    if (fatal.length) {
      throw new Error(
        'index.html インライン JS の抽出/パースに失敗 (検査不成立): ' +
          fatal.map((m) => 'L' + m.line + ' ' + m.message).join(' / ')
      );
    }

    const undef = messages.filter((m) => m.ruleId === 'no-undef');
    if (undef.length) {
      const detail = undef.map((m) => 'L' + m.line + ':' + m.column + '  ' + m.message).join('\n');
      throw new Error(
        '★index.html インライン JS に未定義変数 (Sentry DAIKOME-4 "total" クラッシュ類) が ' +
          undef.length +
          ' 件★\n' +
          detail +
          '\n→ 変数の宣言漏れ (リファクタで算出ブロックが消えた等) を修正するか、' +
          '正当な外部グローバルなら tests/integration/index-inline-noundef.test.js の EXTERNAL_GLOBALS に追記。'
      );
    }

    expect(undef.length).toBe(0);
  });
});
