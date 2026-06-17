// ============================================================
// js/obd-wheelspeed-map.js  (ダイコメ ABS各輪速 CANシード表・2026-06-15 / 2026-06-16 網羅拡充)
//
// ★目的★: ELM327(ATH1+ATMA)で傍受した生CANから「どのCAN IDの・どの係数で車輪速になるか」を
//   車種を撃つ前に知るための ★事前シード表★。標準OBD2 010D(1km/h floor=系統-2%過小)を、ABS各輪速の
//   高分解能(0.005〜0.057 km/h/LSB=010Dの18〜200倍細かい)に置換し floor量子化を発生源から消す。
//
// ★出典★: commaai/opendbc の各メーカー .dbc を verbatim 確認(2026-06-16 網羅調査・全ID/bit/係数に raw URL)。
//   ★捏造ゼロ方針★: 確認できた値のみ。opendbc未収録(スズキ/ダイハツ/三菱の自社車)は「要プローブ発見」。
//
// ★2026-06-16 重要訂正★: TOYOTA 0xAA は ★15bit 非バイト整列(bitStarts FR6/FL22/RR38/RL54)★ が正。
//   旧 16bit byte整列(wheelByteOffsets)は誤デコード→修正。Subaru pre-global(0xD4)/Hyundai-Kia(0x386)新規。
//
// ★絶対ルール準拠★: read-only の参照データ。距離コア(pipeline-distance.js)/課金/Viterbi に依存しない・触らない。
//   現状は ★端末内識別の正解照合(lookupById)＋将来の decode シード用★(距離未配線)。
//
// 構造: WHEELSPEED_SEED[maker] = { makers, seedable, variants:[{ id, message, factor, offsetK, endian('BE'|'LE'),
//   lenBits, wheelByteOffsets|bitStarts, resolutionKmhPerLsb, models, years, busReachable, elm327Readable, source }] }。
//   メーカー内で車種/年式により id/係数が違う(Subaru global vs pre-global 等)ため variants で持つ。
//   SEED_BY_ID は全 variant を id→params で逆引き(撃ったIDが誰のものか即照合)。
//   decode: value_kmh = raw * factor + offsetK。endian 'BE'=Motorola(@0) / 'LE'=Intel(@1)。
// ============================================================
(function (global) {
  'use strict';

  const WHEELSPEED_SEED = {
    TOYOTA: {
      makers: ['Toyota', 'Lexus'],
      seedable: true,
      variants: [
        {
          id: '0AA', // BO_ 170
          message: 'WHEEL_SPEEDS',
          factor: 0.01,
          offsetK: -67.67,
          endian: 'BE',
          lenBits: 15, // ★15bit 非バイト整列(byte境界でなくbit抽出)★
          wheelByteOffsets: null,
          bitStarts: { FR: 6, FL: 22, RR: 38, RL: 54 }, // DBC startbit(Motorola)・順序 FR→FL→RR→RL
          resolutionKmhPerLsb: 0.01,
          models: 'TSS/TSS2 全車(corolla/rav4/camry/prius/lexus等)',
          years: '~2023+',
          busReachable: 'bus0(確定・carstate Bus.pt)',
          source:
            'https://raw.githubusercontent.com/commaai/opendbc/master/opendbc/dbc/generator/toyota/_toyota_2017.dbc',
        },
      ],
      note: '最も堅い(bus0確定)。Daihatsuは多くがトヨタOEMで0xAA最有力(推測)。旧プリウス2010系のみ別仕様(要実機確認)。',
    },
    HONDA: {
      makers: ['Honda', 'Acura'],
      seedable: true,
      variants: [
        {
          id: '1D0', // BO_ 464・送信元VSA
          message: 'WHEEL_SPEEDS',
          factor: 0.01,
          offsetK: 0,
          endian: 'BE',
          lenBits: 15, // 非バイト整列
          wheelByteOffsets: null,
          bitStarts: { FL: 7, FR: 8, RL: 25, RR: 42 },
          resolutionKmhPerLsb: 0.01,
          models: 'nidec/Bosch 全車共通',
          years: '~2022+',
          busReachable: 'bus0(carstate Bus.pt)',
          source:
            'https://raw.githubusercontent.com/commaai/opendbc/master/opendbc/dbc/generator/honda/_honda_common.dbc',
        },
      ],
      note: '単一定義で全車カバー。リポ直下 acura_ilx_2016_nidec.dbc はレーダーdbcで輪速無し=使うな。',
    },
    NISSAN: {
      makers: ['Nissan'],
      seedable: true,
      variants: [
        {
          id: '284', // BO_ 644 Leaf FRONT
          message: 'WHEEL_SPEEDS_FRONT',
          factor: 0.005,
          offsetK: 0,
          endian: 'BE',
          lenBits: 16,
          wheelByteOffsets: { FR: 0, FL: 2 },
          resolutionKmhPerLsb: 0.005,
          models: 'Leaf',
          years: '2018+',
          busReachable: 'bus0(carstate Bus.pt)',
          source:
            'https://raw.githubusercontent.com/commaai/opendbc/master/opendbc/dbc/generator/nissan/nissan_leaf_2018.dbc',
        },
        {
          id: '29A', // BO_ 666 X-Trail FRONT
          message: 'WHEEL_SPEEDS_FRONT',
          factor: 0.005,
          offsetK: 0,
          endian: 'BE',
          lenBits: 16,
          wheelByteOffsets: { FR: 0, FL: 2 },
          resolutionKmhPerLsb: 0.005,
          models: 'X-Trail(Rogue)',
          years: '2017+',
          busReachable: 'bus0',
          source:
            'https://raw.githubusercontent.com/commaai/opendbc/master/opendbc/dbc/generator/nissan/nissan_x_trail_2017.dbc',
        },
        {
          id: '285', // BO_ 645 REAR 共通
          message: 'WHEEL_SPEEDS_REAR',
          factor: 0.005,
          offsetK: 0,
          endian: 'BE',
          lenBits: 16,
          wheelByteOffsets: { RR: 0, RL: 2 },
          resolutionKmhPerLsb: 0.005, // ★最も細かい(010Dの200倍)★
          models: 'Leaf/X-Trail/Altima 共通',
          years: '2017+',
          busReachable: 'bus0(★Altimaのみbus1=OBD不可達→010Dフォールバック★)',
          source:
            'https://raw.githubusercontent.com/commaai/opendbc/master/opendbc/dbc/generator/nissan/_nissan_common.dbc',
        },
      ],
      note: 'FRONTのIDが車種別(Leaf 0x284/X-Trail 0x29A)・REAR共通0x285。Infinitiはopendbc未収録だが0x284系を試す価値(推測)。',
    },
    SUBARU: {
      makers: ['Subaru'],
      seedable: true,
      variants: [
        {
          id: '13A', // BO_ 314 Global
          message: 'Wheel_Speeds',
          factor: 0.057,
          offsetK: 0,
          endian: 'LE',
          lenBits: 13, // 非連続(CHECKSUM/COUNTER挟む)
          wheelByteOffsets: null,
          bitStarts: { FR: 12, RR: 25, RL: 38, FL: 51 },
          resolutionKmhPerLsb: 0.057,
          models: 'Global全車(Impreza/Crosstrek/Forester/Outback/Legacy/Ascent)',
          years: '2017+',
          busReachable: '要実機確認(GW裏の可能性)',
          source:
            'https://raw.githubusercontent.com/commaai/opendbc/master/opendbc/dbc/generator/subaru/_subaru_globalCAN.dbc',
        },
        {
          id: '0D4', // BO_ 212 pre-global ★verbatim確定(旧推測を昇格)★
          message: 'Wheel_Speeds',
          factor: 0.0592,
          offsetK: 0,
          endian: 'LE',
          lenBits: 16,
          wheelByteOffsets: { FL: 0, FR: 2, RL: 4, RR: 6 },
          resolutionKmhPerLsb: 0.0592,
          models: 'Outback/Legacy/Forester (pre-global)',
          years: '2015-2018',
          busReachable: '要実機確認',
          source:
            'https://raw.githubusercontent.com/commaai/opendbc/master/opendbc/dbc/generator/subaru/_subaru_preglobal_2015.dbc',
        },
      ],
      note: 'Global(0x13A)とpre-global(0xD4)でID/係数が違う。FR/RR入替修正PR履歴あり=コーナーラベル実車照合推奨。',
    },
    MAZDA: {
      makers: ['Mazda'],
      seedable: true,
      variants: [
        {
          id: '215', // BO_ 533
          message: 'WHEEL_SPEEDS',
          factor: 0.01,
          offsetK: -100,
          endian: 'BE',
          lenBits: 16,
          wheelByteOffsets: { FL: 0, FR: 2, RL: 4, RR: 6 },
          resolutionKmhPerLsb: 0.01,
          models: 'CX-5/CX-9/Mazda6/Mazda3(~2018)',
          years: '2017+',
          busReachable: '要実機確認',
          source:
            'https://raw.githubusercontent.com/commaai/opendbc/master/opendbc/dbc/mazda_2017.dbc',
        },
        {
          id: '01C', // BO_ 28 Mazda3 2019
          message: 'WHEEL_SPEEDS',
          factor: 0.01,
          offsetK: -100, // ★RLのみ -102★
          endian: 'BE',
          lenBits: 16,
          wheelByteOffsets: { FL: 0, FR: 2, RL: 4, RR: 6 },
          resolutionKmhPerLsb: 0.01,
          models: 'Mazda3(BP)',
          years: '2019+',
          busReachable: '要実機確認',
          source:
            'https://raw.githubusercontent.com/commaai/opendbc/master/opendbc/dbc/mazda_3_2019.dbc',
        },
      ],
      note: '車種でID違い(0x215/0x1C)。Mazda3 2019 の RL のみ offsetK -102。',
    },
    HYUNDAI: {
      makers: ['Hyundai', 'Kia', 'Genesis'],
      seedable: true,
      variants: [
        {
          id: '386', // BO_ 902 WHL_SPD11・classic CAN・送信元ABS
          message: 'WHL_SPD11',
          factor: 0.03125,
          offsetK: 0,
          endian: 'LE',
          lenBits: 14,
          wheelByteOffsets: { FL: 0, FR: 2, RL: 4, RR: 6 },
          resolutionKmhPerLsb: 0.03125,
          models: 'classic CAN 全車',
          years: '~2022(non-CANFD)',
          busReachable: 'classic CCANは多くbus0到達(要実機確認)',
          source:
            'https://raw.githubusercontent.com/commaai/opendbc/master/opendbc/dbc/generator/hyundai/hyundai_kia_generic.dbc',
        },
        {
          id: '0A0', // BO_ 160 CAN-FD ★ELM327(classic CAN)では物理的に取得不可★
          message: 'WHEEL_SPEEDS',
          factor: 0.03125,
          offsetK: 0,
          endian: 'LE',
          lenBits: 14,
          wheelByteOffsets: { FL: 8, FR: 10, RL: 12, RR: 14 },
          resolutionKmhPerLsb: 0.03125,
          models: 'CAN-FD車(Ioniq5/6,Tucson NX4,Sportage,EV6,GV60等)',
          years: '2021+',
          busReachable: '★CAN-FD=ELM327では取得不可・bus0不可達★',
          elm327Readable: false, // ★ELM327(classic CAN)では読めない→SEED_BY_IDから除外★
          source:
            'https://raw.githubusercontent.com/commaai/opendbc/master/opendbc/dbc/generator/hyundai/hyundai_canfd.dbc',
        },
      ],
      note: '輸入車補足。classic(0x386)はELM327で読める。CAN-FD(0xA0)はELM327非対応=シード照合から除外。',
    },
    // ─── opendbc 未収録 = プローブ発見待ち(010Dフォールバック) ───
    PROBE_ONLY: {
      makers: ['Suzuki', 'Daihatsu', 'Mitsubishi', 'Infiniti'],
      seedable: false,
      variants: [],
      note: 'opendbc未収録=要プローブ発見。★OEMリバッジ注意: 車はバッジでなく"製造元"のCANに従う★。Daihatsu=トヨタ100%子会社・多くがトヨタOEM→0xAA(Toyota)を最初に試す価値(推論・未検証)。Suzuki自社車は輪速ID不明=discovery。★日産モコ(型式MG33S)はバッジ日産だが中身スズキMRワゴンOEM=スズキ製CAN=opendbc未収録=discovery(=スズキとして扱う)★。Mitsubishi/Infinitiも要プローブ。全社フォールバック=標準OBD2 010D。日本市場のバッジ→実製造元 網羅は別途リサーチ(2026-06-16)。',
    },
  };

  // 発見ID → メーカー/係数 逆引き(解析ツール/端末内識別が「撃ったIDが既知の誰か」を照合)。
  //   ELM327で読めない CAN-FD(elm327Readable:false) は除外。
  const SEED_BY_ID = {};
  Object.keys(WHEELSPEED_SEED).forEach(function (key) {
    const e = WHEELSPEED_SEED[key];
    if (!e.seedable || !e.variants) return;
    e.variants.forEach(function (v) {
      if (v.elm327Readable === false) return;
      SEED_BY_ID[String(v.id).toUpperCase()] = {
        group: key,
        makers: e.makers,
        models: v.models,
        id: v.id,
        factor: v.factor,
        offsetK: v.offsetK,
        endian: v.endian,
        lenBits: v.lenBits,
        resolutionKmhPerLsb: v.resolutionKmhPerLsb,
        note: e.note,
        source: v.source,
      };
    });
  });

  // ============================================================
  // ★OEMリバッジ解決(2026-06-16・バッジ≠製造元)★
  //   車のCAN/ECUは「バッジ」でなく「実製造元」に従う(例: 日産モコ=スズキMRワゴンOEM=スズキCAN)。
  //   バッジから実製造元を解決し、正しいシード/discovery戦略を返す。出典=2026-06-16 OEMリバッジ網羅調査
  //   (Wikipedia/メーカー公式・各リバッジ関係を裏取り)。★read-only・距離コア非関与★。
  // ============================================================
  // 製造元(builder)が seed メーカーなら その seed group(輪速IDを持つ)
  const SEEDED_BUILDERS = {
    TOYOTA: 'TOYOTA',
    LEXUS: 'TOYOTA',
    HONDA: 'HONDA',
    ACURA: 'HONDA',
    NISSAN: 'NISSAN',
    SUBARU: 'SUBARU',
    MAZDA: 'MAZDA',
    HYUNDAI: 'HYUNDAI',
    KIA: 'HYUNDAI',
    GENESIS: 'HYUNDAI',
  };
  // seed group → 第一候補ID(discoveryで最初に試す/hypothesisの当て先)
  const SEED_PRIMARY_ID = {
    TOYOTA: '0AA',
    HONDA: '1D0',
    NISSAN: '285',
    SUBARU: '13A',
    MAZDA: '215',
    HYUNDAI: '386',
  };

  // バッジ→実製造元 リバッジ表(★型式優先・無ければモデル名★)。バッジが実製造元と違う車だけ載せる。
  const REBADGE_MAP = [
    // ── スズキ製(opendbc未収録=discovery) ──
    {
      badge: 'NISSAN',
      modelsJa: ['モコ'],
      modelsEn: ['moco'],
      katashiki: ['MG21S', 'MG22S', 'MG33S'],
      builder: 'SUZUKI',
      base: 'スズキMRワゴンOEM',
    },
    {
      badge: 'NISSAN',
      modelsJa: ['ピノ'],
      modelsEn: ['pino'],
      katashiki: [],
      builder: 'SUZUKI',
      base: 'スズキアルトOEM',
    },
    {
      badge: 'NISSAN',
      modelsJa: ['クリッパー', 'NV100'],
      modelsEn: ['clipper', 'nv100'],
      katashiki: [],
      builder: 'SUZUKI',
      base: '現行=スズキエブリイOEM(旧は三菱)・要型式確認',
    },
    {
      badge: 'MAZDA',
      modelsJa: ['フレア'],
      modelsEn: ['flair'],
      katashiki: [],
      builder: 'SUZUKI',
      base: 'スズキワゴンR/ハスラーOEM',
    },
    {
      badge: 'MAZDA',
      modelsJa: ['キャロル'],
      modelsEn: ['carol'],
      katashiki: [],
      builder: 'SUZUKI',
      base: 'スズキアルトOEM',
    },
    {
      badge: 'MAZDA',
      modelsJa: ['スクラム'],
      modelsEn: ['scrum'],
      katashiki: [],
      builder: 'SUZUKI',
      base: 'スズキエブリイOEM',
    },
    {
      badge: 'MAZDA',
      modelsJa: ['AZワゴン', 'AZ-ワゴン'],
      modelsEn: ['az-wagon', 'azwagon'],
      katashiki: [],
      builder: 'SUZUKI',
      base: 'スズキワゴンROEM',
    },
    {
      badge: 'MITSUBISHI',
      modelsJa: ['デリカD:2', 'デリカd2'],
      modelsEn: ['delica d:2', 'delicad2'],
      katashiki: [],
      builder: 'SUZUKI',
      base: 'スズキソリオOEM',
    },
    // ── ダイハツ製(opendbc未収録=discovery・0xAA第一候補) ──
    {
      badge: 'TOYOTA',
      modelsJa: ['ルーミー', 'タンク'],
      modelsEn: ['roomy', 'tank'],
      katashiki: ['M900A', 'M910A'],
      builder: 'DAIHATSU',
      base: 'ダイハツトールOEM',
    },
    {
      badge: 'TOYOTA',
      modelsJa: ['ライズ'],
      modelsEn: ['raize'],
      katashiki: ['A200A', 'A210A'],
      builder: 'DAIHATSU',
      base: 'ダイハツロッキーOEM',
    },
    {
      badge: 'TOYOTA',
      modelsJa: ['ピクシス'],
      modelsEn: ['pixis'],
      katashiki: [],
      builder: 'DAIHATSU',
      base: 'ダイハツ各車OEM(ムーヴ/タント/ハイゼット等)',
    },
    {
      badge: 'SUBARU',
      modelsJa: ['ジャスティ'],
      modelsEn: ['justy'],
      katashiki: [],
      builder: 'DAIHATSU',
      base: 'ダイハツトールOEM',
    },
    {
      badge: 'SUBARU',
      modelsJa: ['シフォン'],
      modelsEn: ['chiffon'],
      katashiki: [],
      builder: 'DAIHATSU',
      base: 'ダイハツタントOEM',
    },
    {
      badge: 'SUBARU',
      modelsJa: ['ステラ'],
      modelsEn: ['stella'],
      katashiki: [],
      builder: 'DAIHATSU',
      base: 'ダイハツムーヴOEM',
    },
    {
      badge: 'SUBARU',
      modelsJa: ['プレオ'],
      modelsEn: ['pleo'],
      katashiki: [],
      builder: 'DAIHATSU',
      base: 'ダイハツミラOEM',
    },
    {
      badge: 'SUBARU',
      modelsJa: ['サンバー'],
      modelsEn: ['sambar'],
      katashiki: [],
      builder: 'DAIHATSU',
      base: 'ダイハツハイゼットOEM',
    },
    // ── 三菱製/NMKV(opendbc未収録=discovery)・★日産バッジ軽の実体は三菱★ ──
    {
      badge: 'NISSAN',
      modelsJa: ['デイズ'],
      modelsEn: ['dayz'],
      katashiki: ['B21W', 'B44W', 'B45W'],
      builder: 'MITSUBISHI',
      base: 'NMKV(三菱水島製)・三菱eK同体',
    },
    {
      badge: 'NISSAN',
      modelsJa: ['ルークス'],
      modelsEn: ['roox'],
      katashiki: ['B44A', 'B45A', 'B47A', 'B48A'],
      builder: 'MITSUBISHI',
      base: '2代目=NMKV(三菱製)・初代はスズキ製(要型式)',
    },
    {
      badge: 'NISSAN',
      modelsJa: ['サクラ'],
      modelsEn: ['sakura'],
      katashiki: ['B6AW'],
      builder: 'MITSUBISHI',
      base: 'NMKV(三菱製)・三菱eKクロスEV同体',
    },
    // ── 製造元がseedメーカーのリバッジ(hypothesis=そのseedで読める見込み・要プローブ) ──
    {
      badge: 'TOYOTA',
      modelsJa: ['86', 'GR86'],
      modelsEn: ['86', 'gr86'],
      katashiki: ['ZN6', 'ZN8'],
      builder: 'SUBARU',
      base: 'スバルBRZ同体=スバルCAN',
    },
    {
      badge: 'SUBARU',
      modelsJa: ['ソルテラ'],
      modelsEn: ['solterra'],
      katashiki: [],
      builder: 'TOYOTA',
      base: 'トヨタbZ4X同体=トヨタCAN',
    },
  ];

  function _norm(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/[\s:]/g, ''); // \s は全角スペースも含む(U+3000)
  }
  // メーカー名(日本語/英語/表記揺れ)→ 正規の製造元キー(英語大文字)
  const MAKER_ALIAS = {
    トヨタ: 'TOYOTA',
    レクサス: 'LEXUS',
    ホンダ: 'HONDA',
    日産: 'NISSAN',
    ニッサン: 'NISSAN',
    マツダ: 'MAZDA',
    スバル: 'SUBARU',
    スズキ: 'SUZUKI',
    ダイハツ: 'DAIHATSU',
    三菱: 'MITSUBISHI',
    ミツビシ: 'MITSUBISHI',
    ヒュンダイ: 'HYUNDAI',
    ヒョンデ: 'HYUNDAI',
    起亜: 'KIA',
    キア: 'KIA',
    インフィニティ: 'INFINITI',
    toyota: 'TOYOTA',
    lexus: 'LEXUS',
    honda: 'HONDA',
    acura: 'ACURA',
    nissan: 'NISSAN',
    infiniti: 'INFINITI',
    mazda: 'MAZDA',
    subaru: 'SUBARU',
    suzuki: 'SUZUKI',
    daihatsu: 'DAIHATSU',
    mitsubishi: 'MITSUBISHI',
    hyundai: 'HYUNDAI',
    kia: 'KIA',
    genesis: 'GENESIS',
  };
  function _canonMaker(maker) {
    const n = _norm(maker);
    if (!n) return '';
    if (MAKER_ALIAS[n]) return MAKER_ALIAS[n];
    const keys = Object.keys(MAKER_ALIAS);
    for (let i = 0; i < keys.length; i++) {
      if (n.indexOf(_norm(keys[i])) >= 0) return MAKER_ALIAS[keys[i]]; // 「トヨタ自動車」等の部分一致
    }
    return n.toUpperCase();
  }

  // バッジ(maker)/モデル/型式 から ★実製造元と読み取り戦略★ を解決(read-only・距離非関与)。
  //   返り値: { builder, layer('verified'|'hypothesis'|'discovery'), seedGroup|null, probeFirst|null, base }
  function resolveBuilder(maker, model, katashiki) {
    const canonMk = _canonMaker(maker), // 製造元キー(英語大文字・日本語名も解決)
      md = _norm(model),
      kt = _norm(katashiki);
    function result(builder, base, selfBuilt) {
      const B = String(builder || '').toUpperCase();
      const seedGroup = SEEDED_BUILDERS[B] || null;
      let layer;
      if (selfBuilt && seedGroup)
        layer = 'verified'; // バッジ=製造元=seedメーカーの自社車
      else if (seedGroup)
        layer = 'hypothesis'; // 製造元はseedメーカーだがリバッジ→要プローブ
      else layer = 'discovery'; // 非seed製造元(スズキ/ダイハツ/三菱)
      // 第一候補ID: seedメーカー製はそのseed primary / ダイハツはトヨタ0xAA(推論) / それ以外なし
      let probeFirst = seedGroup ? SEED_PRIMARY_ID[seedGroup] : null;
      if (!probeFirst && B === 'DAIHATSU') probeFirst = '0AA'; // ★ダイハツ=トヨタ子会社→0xAA第一候補(未検証)★
      return {
        builder: B,
        layer: layer,
        seedGroup: seedGroup,
        probeFirst: probeFirst,
        base: base || null,
      };
    }
    // 1) リバッジ表を 型式(前方一致) → モデル名(部分一致+バッジ整合) の順で照合
    for (let i = 0; i < REBADGE_MAP.length; i++) {
      const r = REBADGE_MAP[i];
      if (kt && r.katashiki && r.katashiki.some((k) => k && kt.indexOf(_norm(k)) === 0)) {
        return result(r.builder, r.base, false);
      }
    }
    for (let i = 0; i < REBADGE_MAP.length; i++) {
      const r = REBADGE_MAP[i];
      const nameHit =
        (r.modelsJa || []).some((m) => m && md.indexOf(_norm(m)) >= 0) ||
        (r.modelsEn || []).some((m) => m && md.indexOf(_norm(m)) >= 0);
      if (!nameHit) continue;
      // 同名異車の誤判定防止: バッジ(製造元キー)も整合する時だけ採用
      const badgeOk = !r.badge || canonMk === String(r.badge).toUpperCase();
      if (md && badgeOk) return result(r.builder, r.base, false);
    }
    // 2) リバッジ表に無い = 自社製と仮定。バッジが seed メーカーなら そのseed(verified)。
    return result(canonMk, null, true);
  }

  // 撃った生CAN IDが既知シードのどれかに一致するか(3桁hex正規化して照合)
  function lookupById(idHex) {
    if (typeof idHex !== 'string') return null;
    let id = idHex.toUpperCase().replace(/^0X/, '');
    if (/^[0-9A-F]{1,3}$/.test(id)) id = id.padStart(3, '0'); // 11bitは3桁へ
    return SEED_BY_ID[id] || null;
  }

  function listSeedableMakers() {
    const out = [];
    Object.keys(WHEELSPEED_SEED).forEach(function (k) {
      if (WHEELSPEED_SEED[k].seedable) out.push.apply(out, WHEELSPEED_SEED[k].makers);
    });
    return out;
  }

  // シード可能な ID 一覧(ELM327で読める分のみ)
  function seededIds() {
    return Object.keys(SEED_BY_ID);
  }

  const api = {
    WHEELSPEED_SEED: WHEELSPEED_SEED,
    SEED_BY_ID: SEED_BY_ID,
    REBADGE_MAP: REBADGE_MAP,
    lookupById: lookupById,
    resolveBuilder: resolveBuilder, // ★バッジ→実製造元→読み取り戦略(OEMリバッジ解決)★
    listSeedableMakers: listSeedableMakers,
    seededIds: seededIds,
  };
  // eslint-disable-next-line no-undef
  if (typeof module !== 'undefined' && module.exports) {
    // eslint-disable-next-line no-undef
    module.exports = api;
  }
  global.OBDWheelSpeedMap = api;
})(
  typeof window !== 'undefined'
    ? window
    : typeof self !== 'undefined'
      ? self
      : typeof globalThis !== 'undefined'
        ? globalThis
        : this
);
