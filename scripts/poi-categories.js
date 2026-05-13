// POI カテゴリ ID 定義（共有）
// 既存 9（0〜8）は維持・新規 32 は 10 番台以降のグループに振る

const CATEGORIES = {
  // 既存 9
  0:  'hotel',                  // ホテル・宿泊
  1:  'restaurant_bar',         // 飲食・バー（既存「飲食・バー」）
  2:  'convenience_store',      // コンビニ
  3:  'gas_station',            // GS
  4:  'hospital',               // 病院
  5:  'station',                // 駅
  6:  'school',                 // 学校
  7:  'public_facility',        // 公共施設
  8:  'sightseeing',            // 観光スポット

  // 飲食系（追加 6）
  10: 'fast_food',
  11: 'cafe',
  12: 'ramen',
  13: 'sushi',
  14: 'yakiniku',
  15: 'izakaya',

  // 医療系（追加 3）
  20: 'clinic',
  21: 'dental',
  22: 'pharmacy_drugstore',

  // 買い物系（追加 4）
  30: 'supermarket',
  31: 'home_center',
  32: 'department_sc',
  33: 'hundred_yen',

  // 行政系（追加 5）
  40: 'city_office',
  41: 'post_office',
  42: 'police_koban',
  43: 'fire_station',
  44: 'library',

  // 金融系（追加 2）
  50: 'atm',
  51: 'bank',

  // レジャー系（追加 5）
  60: 'onsen_sento',
  61: 'karaoke',
  62: 'pachinko',
  63: 'cinema',
  64: 'golf',

  // ドライブ系（追加 4）
  70: 'michinoeki',
  71: 'sapa',
  72: 'bicycle_parking',
  73: 'taxi_stand',

  // 交通系（追加 2）
  80: 'bus_stop',
  81: 'airport',

  // 防災系（追加 1）
  90: 'aed',

  // 公衆電話（追加 1・2026/05）
  91: 'public_phone',

  // 拡張 5（2026/05/B-2 追加）
  92: 'traffic_signals',  // 信号機 (highway=traffic_signals)
  93: 'level_crossing',   // 踏切   (railway=level_crossing|crossing)
  94: 'peak',             // 山頂   (natural=peak|volcano)
  95: 'parking',          // 駐車場 (amenity=parking)
  96: 'toilets',          // 公衆トイレ (amenity=toilets)
};

// 名前→ID 逆引き（入力 GeoJSON が文字列カテゴリの場合に使用）
const CATEGORY_NAME_TO_ID = {};
for (const [id, name] of Object.entries(CATEGORIES)) CATEGORY_NAME_TO_ID[name] = +id;

// 属性キーの統一規約（短縮）
//   h24:1                24時間営業
//   open:"7:00-22:00"    営業時間
//   fee:"30min/200円"   駐車料金
//   height_m:2.1         駐車場 高さ制限
//   cap:120              駐車場 収容台数
//   self:1 / full:1      GS セルフ／フル
//   diesel:1             GS 軽油対応
//   er:1                 病院 救急
//   kind:"elem"|"jhs"|"hs"|"univ"|"voc"  学校種別

// OSM tags → 内部カテゴリ名（osmium 由来の生 OSM タグから自動分類するときに使う）
function classifyOsmTags(tags) {
  if (!tags) return null;
  const am = tags.amenity, sh = tags.shop, lz = tags.leisure, to = tags.tourism;
  const rw = tags.railway, hw = tags.highway, ay = tags.aeroway, em = tags.emergency;
  const cu = tags.cuisine || '';
  const name = tags.name || '';

  // 名前先頭が "道の駅" であれば amenity/shop に関わらず michinoeki と判定
  // （amenity=marketplace 以外にも tourism=information / shop=convenience 等で
  //   タグ付けされている例がある）
  if (/^\s*道の駅/.test(name)) return 'michinoeki';

  if (em === 'defibrillator') return 'aed';
  if (am === 'telephone')     return 'public_phone';
  // 拡張 5 (B-2)
  if (hw === 'traffic_signals') return 'traffic_signals';
  if (rw === 'level_crossing' || rw === 'crossing') return 'level_crossing';
  if (tags.natural === 'peak' || tags.natural === 'volcano') return 'peak';
  if (am === 'parking')         return 'parking';
  if (am === 'toilets')         return 'toilets';
  if (ay === 'aerodrome' || ay === 'terminal') return 'airport';
  if (hw === 'bus_stop')        return 'bus_stop';
  if (rw === 'station')         return 'station';
  if (am === 'taxi')            return 'taxi_stand';
  if (am === 'bicycle_parking') return 'bicycle_parking';
  if (hw === 'services')        return 'sapa';
  if (lz === 'golf_course')     return 'golf';
  if (am === 'cinema')          return 'cinema';
  if (lz === 'adult_gaming_centre') return 'pachinko';
  if (am === 'karaoke_box')     return 'karaoke';
  if (am === 'public_bath' || lz === 'hot_spring') return 'onsen_sento';
  if (am === 'atm')             return 'atm';
  if (am === 'bank')            return 'bank';
  if (am === 'library')         return 'library';
  if (am === 'fire_station')    return 'fire_station';
  if (am === 'police')          return 'police_koban';
  if (am === 'post_office')     return 'post_office';
  if (am === 'townhall')        return 'city_office';
  // 公共施設（市役所以外の community/civic/government 系）
  if (am === 'community_centre' || am === 'public_building' || am === 'civic'
      || am === 'social_facility' || am === 'courthouse' || am === 'embassy'
      || tags.office === 'government') return 'public_facility';
  if (sh === 'variety_store')   return 'hundred_yen';
  if (sh === 'department_store' || sh === 'mall') return 'department_sc';
  if (sh === 'doityourself' || sh === 'hardware') return 'home_center';
  if (sh === 'supermarket')     return 'supermarket';
  if (sh === 'chemist' || am === 'pharmacy') return 'pharmacy_drugstore';
  if (am === 'dentist')         return 'dental';
  if (am === 'clinic' || am === 'doctors') return 'clinic';
  if (am === 'fast_food')       return 'fast_food';
  if (am === 'cafe')            return 'cafe';
  if (am === 'restaurant' || am === 'bar' || am === 'pub') {
    if (cu === 'ramen')         return 'ramen';
    if (cu === 'sushi')         return 'sushi';
    if (cu === 'yakiniku' || cu === 'korean') return 'yakiniku';
    if (cu === 'izakaya')       return 'izakaya';
    return 'restaurant_bar';
  }
  if (to === 'hotel' || to === 'hostel' || to === 'guest_house' || to === 'motel') return 'hotel';
  if (sh === 'convenience')     return 'convenience_store';
  if (am === 'fuel')            return 'gas_station';
  if (am === 'hospital')        return 'hospital';
  if (am === 'school' || am === 'kindergarten' || am === 'college' || am === 'university') return 'school';
  if (to === 'attraction' || to === 'museum' || to === 'viewpoint' || to === 'artwork') return 'sightseeing';
  return null;
}

function extractAttrsFromOsmTags(tags, category) {
  const a = {};
  const oh = tags.opening_hours;
  if (oh === '24/7') a.h24 = 1;
  else if (oh && oh.length < 80) a.open = oh;
  if (category === 'gas_station') {
    if (tags.self_service === 'yes') a.self = 1;
    if (tags.self_service === 'no')  a.full = 1;
    if (tags['fuel:diesel'] === 'yes') a.diesel = 1;
  }
  if (category === 'hospital') {
    if (tags.emergency === 'yes') a.er = 1;
  }
  if (category === 'parking') {
    if (tags.fee && tags.fee !== 'no') a.fee = tags.fee === 'yes' ? 'yes' : tags.fee;
    if (tags.maxheight) {
      const m = String(tags.maxheight).match(/[\d.]+/);
      if (m) a.height_m = parseFloat(m[0]);
    }
    if (tags.capacity) {
      const c = parseInt(tags.capacity, 10);
      if (!isNaN(c)) a.cap = c;
    }
    if (tags.parking === 'underground' || tags.parking === 'multi-storey') a.kind = tags.parking;
  }
  if (category === 'peak') {
    if (tags.natural === 'volcano') a.kind = 'volcano';
    const ele = parseFloat(tags.ele);
    if (!isNaN(ele) && ele >= -500 && ele <= 4000) a.ele = Math.round(ele);
  }
  if (category === 'level_crossing') {
    if (tags.crossing === 'unbarriered' || tags.crossing_barrier === 'no') a.kind = 'unbarriered';
  }
  if (category === 'toilets') {
    if (tags.fee === 'yes') a.fee = 'yes';
    if (tags.wheelchair === 'yes') a.wc = 1;
  }
  if (category === 'school') {
    const am = tags.amenity;
    if (am === 'kindergarten')      a.kind = 'kg';
    else if (am === 'college')      a.kind = 'voc';
    else if (am === 'university')   a.kind = 'univ';
    else if (am === 'school') {
      const isced = tags['isced:level'] || '';
      if (isced.includes('1'))      a.kind = 'elem';
      else if (isced.includes('2')) a.kind = 'jhs';
      else if (isced.includes('3')) a.kind = 'hs';
      else if (/(高校|高等)/.test(tags.name || '')) a.kind = 'hs';
      else if (/中学/.test(tags.name || ''))        a.kind = 'jhs';
      else if (/小学/.test(tags.name || ''))        a.kind = 'elem';
    }
  }
  return Object.keys(a).length ? a : null;
}

module.exports = {
  CATEGORIES, CATEGORY_NAME_TO_ID,
  classifyOsmTags, extractAttrsFromOsmTags,
};
