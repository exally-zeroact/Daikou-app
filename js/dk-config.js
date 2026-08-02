// ============================================================
// js/dk-config.js
// ★★Supabase 接続先の「単一の真実源」(2026-07-31)★★
//
//   ダイコメが繋ぐ倉庫(Supabaseプロジェクト)と、自分自身の公開URLを、このファイル1箇所だけで持つ。
//   他のどのファイルにも接続先を書かない。書いたら tests/unit/dk-config-single-source.test.js が赤になる。
//
//   ▼なぜ1箇所か
//     ダイコメを Exally 系(Kyually/代行請求)から独立させる = 別 Supabase プロジェクトへ引っ越す。
//     接続先が散らばっていると、1箇所でも直し忘れた瞬間「一部の画面だけ旧倉庫を読む」という
//     一番たちの悪い壊れ方をする(見た目は動くのにデータが合わない)。ここだけ直せば全部移る。
//
//   ▼引っ越し手順(このファイルでやること)
//     新しい Supabase プロジェクトの URL と anonキー を SB_URL / ANON_KEY に入れ替えるだけ。
//     ※ anonキーは「公開してよい鍵」(RLS とサーバ側関数で守る設計)。秘密鍵ではない。
//     ※ APP_BASE はダイコメ自身の公開URL。会社URL(?c=...)やQRの組み立てに使う。
//
//   ▼オフライン安全性
//     このファイルは通信しない。ただの定数。読めなくても業務(メーター/距離/課金)には一切影響しない。
//     消費側は DKConfig が無ければ「オフライン扱い」に落ちるだけ(業務は絶対に止めない)。
// ============================================================
(function (global) {
  'use strict';

  // ▼倉庫(Supabaseプロジェクト) --------------------------------------------
  //   現在: Exally 共有プロジェクト。★独立時はこの2つを新プロジェクトの値に差し替える★
  const SB_URL = 'https://tnfwipbgfgjaymlszeid.supabase.co';
  const ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRuZndpcGJnZmdqYXltbHN6ZWlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1Nzk4MzQsImV4cCI6MjA5NzE1NTgzNH0.zhKPLSlW4zxsdjsXNvqDHvtP3wBqp-EKaxbjqLGW_ek';

  // ▼ダイコメ自身の公開URL(末尾スラッシュなし) -------------------------------
  //   会社URL = APP_BASE + '/?c=' + url_token。本番ドメイン確定時はここを差し替える。
  //
  //   ★★ここはrepoごとに値が違う。同期でコピーしてはいけない唯一の場所★★
  //     テストrepo(Daikou-app-test) → daikou-app-test / daikome-jimusho-test
  //     本番repo (Daikou-app)      → daikou-app      / daikome-jimusho
  //   間違えると★本番の事務所が出したQRを読んだ従業員が全員テスト版で走り出す★。
  //   画面はいつもどおり動くので誰も気づかない。だから tests/unit/dk-config-app-base-host.test.js
  //   が git の remote(＝同期でコピーされない所)から素性を取って機械で縛っている。
  const APP_BASE = 'https://daikou-app.vercel.app'; // メーター(ドライバーが使う)
  const OFFICE_BASE = 'https://daikome-jimusho.vercel.app'; // 事務所(社長が使う)

  const api = {
    SB_URL: SB_URL,
    ANON_KEY: ANON_KEY,
    REST_BASE: SB_URL + '/rest/v1',
    FN_BASE: SB_URL + '/functions/v1',
    APP_BASE: APP_BASE,
    OFFICE_BASE: OFFICE_BASE,

    // Edge Function の URL を名前から組み立てる: fn('dk-issue-license')
    fn: function (name) {
      return SB_URL + '/functions/v1/' + name;
    },
    // REST(PostgREST) の URL を組み立てる: rest('dk_companies?select=*')
    rest: function (pathAndQuery) {
      return SB_URL + '/rest/v1/' + String(pathAndQuery || '').replace(/^\/+/, '');
    },
    // anonキーを載せた共通ヘッダ。userToken があればそのユーザーとして呼ぶ(RLS が効く)。
    headers: function (userToken) {
      return {
        apikey: ANON_KEY,
        Authorization: 'Bearer ' + (userToken || ANON_KEY),
        'Content-Type': 'application/json',
      };
    },
  };

  if (global) global.DKConfig = api;
  /* eslint-disable no-undef */
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }
  /* eslint-enable no-undef */
})(typeof window !== 'undefined' ? window : globalThis);
