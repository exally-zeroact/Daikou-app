// ============================================================
// data-registry.js (2026-05-13 新規)
// ★設計変更宣言: 全データファイルの metadata を一元管理
//   どのファイルがどこに必要か (worker / main) を宣言的に記述
//
// 構造:
//   PREFECTURES_47: 全国 47 県リスト (ROADS_DL と同一順序)
//   DATA_REGISTRY:
//     .global  全国共通 (18 件 + backbone + DEM = 20 件)
//     .perPref 都道府県別 (7 種 × 47 = 329 件)
//
// 用途:
//   mm-data-pipeline.js が DATA_REGISTRY を参照して順次ロード
//   target='worker' なら postMessage(msgType, data)
//   target='main'   なら window[globalKey] に格納 (main 側で findNearest 等)
// ============================================================

(function(global){
  'use strict';

  const PREFECTURES_47 = [
    'hokkaido','aomori','iwate','miyagi','akita','yamagata','fukushima',
    'ibaraki','tochigi','gunma','saitama','chiba','tokyo','kanagawa',
    'niigata','toyama','ishikawa','fukui','yamanashi','nagano','gifu',
    'shizuoka','aichi','mie','shiga','kyoto','osaka','hyogo','nara',
    'wakayama','tottori','shimane','okayama','hiroshima','yamaguchi',
    'tokushima','kagawa','ehime','kochi','fukuoka','saga','nagasaki',
    'kumamoto','oita','miyazaki','kagoshima','okinawa',
  ];

  function _prefUpper(pref){
    return pref.toUpperCase().replace(/-/g, '_');
  }

  const DATA_REGISTRY = {
    // ─── 全国共通データ (起動時 1 回ロード) ───
    global: [
      // MM 精度向上 (worker 接続・5 件)
      { url: '/data/coarse-jp.js',         globalKey: 'COARSE_JP',
        target: 'worker', msgType: 'loadCoarse' },
      { url: '/data/pref-borders-jp.js',   globalKey: 'PREF_BORDERS_JP',
        target: 'worker', msgType: 'loadPrefBorders' },
      { url: '/data/highways-jp.js',       globalKey: 'HIGHWAYS_JP',
        target: 'worker', msgType: 'loadHighways' },
      { url: '/data/coastline-jp.js',      globalKey: 'COASTLINE_JP',
        target: 'worker', msgType: 'loadCoastline' },
      { url: '/data/railways-jp.js',       globalKey: 'RAILWAYS_JP',
        target: 'worker', msgType: 'loadRailways' },

      // 業務 UX + 災害対応 (main 接続・9 件)
      // ★設計変更宣言 (2026-05-13): waterways/peaks/hiking-trails/misc は
      //   ダイコメ機能上絶対使わないため registry から除外。
      //   data/ ファイル自体は残置 (他プロジェクト利用)・ロードのみ停止。
      { url: '/data/shelters-jp.js',           globalKey: 'SHELTERS_JP',          target: 'main' },
      { url: '/data/emergency-medical-jp.js',  globalKey: 'EMERGENCY_MEDICAL_JP', target: 'main' },
      { url: '/data/stations-jp.js',           globalKey: 'STATIONS_JP',          target: 'main' },
      { url: '/data/airports-jp.js',           globalKey: 'AIRPORTS_JP',          target: 'main' },
      { url: '/data/ports-jp.js',              globalKey: 'PORTS_JP',             target: 'main' },
      { url: '/data/night-clinics-jp.js',      globalKey: 'NIGHT_CLINICS_JP',     target: 'main' },
      { url: '/data/michinoeki-jp.js',         globalKey: 'MICHINOEKI_JP',        target: 'main' },
      { url: '/data/faults-jp.js',             globalKey: 'FAULTS_JP',            target: 'main' },
      { url: '/data/hazard-cliff-jp.js',       globalKey: 'HAZARD_CLIFF_JP',      target: 'main' },

      // 任意 (worker 接続)
      { url: '/data/road-graph-backbone-jp.js', globalKey: 'ROAD_GRAPH_BACKBONE_JP',
        target: 'worker', msgType: 'loadBackbone', optional: true },
      { url: '/data/dem-jp.js', globalKey: 'DEM_JP',
        target: 'worker', msgType: 'loadDem', optional: true },
    ],

    // ─── 都道府県別データ (起動時に全 47 県ロード) ───
    perPref: [
      // 主データ (worker 接続・必須)
      { kind: 'roads',
        template: '/data/roads-{pref}.js',
        globalKeyFn: function(pref){ return 'ROADS_' + _prefUpper(pref); },
        target: 'worker',
        msgType: 'loadRoads',
        // ★ pois / conditionalRestrictions は roadsData の field なので
        //   pipeline 側で分割して送信する (handler='loadRoadsBundle')
        handler: 'loadRoadsBundle' },

      // 補助データ (main 接続)
      { kind: 'tunnels',
        template: '/data/tunnels-{pref}.js',
        globalKeyFn: function(pref){ return 'TUNNELS_' + _prefUpper(pref); },
        target: 'main' },
      { kind: 'bridges',
        template: '/data/bridges-{pref}.js',
        globalKeyFn: function(pref){ return 'BRIDGES_' + _prefUpper(pref); },
        target: 'main' },

      // attrs / flood / jizen / yobo (main 接続・任意・無くても稼働)
      { kind: 'road-attrs',
        template: '/data/road-attrs-{pref}.js',
        globalKeyFn: function(pref){ return 'ROAD_ATTRS_' + _prefUpper(pref); },
        target: 'main', optional: true },
      { kind: 'road-flood',
        template: '/data/road-flood-{pref}.js',
        globalKeyFn: function(pref){ return 'ROAD_FLOOD_' + _prefUpper(pref); },
        target: 'main', optional: true },
      { kind: 'road-jizen',
        template: '/data/road-jizen-{pref}.js',
        globalKeyFn: function(pref){ return 'ROAD_JIZEN_' + _prefUpper(pref); },
        target: 'main', optional: true },
      { kind: 'road-yobo',
        template: '/data/road-yobo-{pref}.js',
        globalKeyFn: function(pref){ return 'ROAD_YOBO_' + _prefUpper(pref); },
        target: 'main', optional: true },
    ],
  };

  // ヘルパ: 47 県のエントリ展開
  function expandPerPref(perPrefDef){
    return PREFECTURES_47.map(function(pref){
      return {
        url: perPrefDef.template.replace('{pref}', pref),
        globalKey: perPrefDef.globalKeyFn(pref),
        target: perPrefDef.target,
        msgType: perPrefDef.msgType,
        handler: perPrefDef.handler,
        kind: perPrefDef.kind,
        optional: perPrefDef.optional,
        pref: pref,
      };
    });
  }

  // ★設計変更宣言 (2026-05-13・warmup 永続マーカー versioning):
  //   localStorage 'daikome_warmup_v1' のバージョン管理に使用。
  //   データ構造変更 (registry 改修・新規県/補助種追加) 時に bump すると
  //   既存マーカー invalidate → 全クライアントで再 warmup 起動。
  const VERSION = '2026-05-13-v1';

  global.DataRegistry = {
    PREFECTURES_47: PREFECTURES_47,
    DATA_REGISTRY: DATA_REGISTRY,
    expandPerPref: expandPerPref,
    VERSION: VERSION,
  };
})(typeof window !== 'undefined' ? window
   : typeof self !== 'undefined' ? self
   : typeof globalThis !== 'undefined' ? globalThis
   : this);
