// ============================================================
// ★請求書アプリ(代行請求書)の meisai に入れる1行を作る★ 2026-08-05
//
//   ★なぜ切り出したか★
//     `distance` に 5.4 を入れていたが、請求書アプリの distance は★整数の列★。
//     Postgres に弾かれ、しかも Edge Function 側の catch が握り潰していたので、
//     ★自動投入を立てても黙って1件も入らなかった★（立てた当日に発覚）。
//     関数の中に埋まっていると外から試せないので、ここに出してテストから触れるようにする。
//
//   ★入れ先の列の型（本物のDBを見て写した・2026-08-05実測）★
//     この表とずれた値を作ったらテストが赤になる。
// ============================================================

// ============================================================
// ★倉庫(dk_trips)の列★ 実測 2026-08-05（本番 tnfwipbgfgjaymlszeid）
//
//   ★同じ穴を2回踏んだので表にした★
//     1回目: meisai.distance が整数の列なのに 5.4 を入れて、★1件も入らなかった★
//     2回目: dk_trips に customer_note の列が無いのに書きに行き、
//            ★勤務ごと受け取られず accepted:[] になった★（＝実績が丸ごと上がらない）
//   どちらも「入れ先の形を見ずに書いた」。列を足したら★必ずここにも足す★。
// ============================================================
const DK_TRIPS_COLUMNS = [
  'trip_id',
  'shift_id',
  'company_id',
  'seq',
  'distance_m',
  'fare_yen',
  'customer_id',
  'customer_name',
  'customer_note', // 誰が乗ったか(会長/社長/専務など) 2026-08-05 追加
  'payment_type',
  'started_at',
  'ended_at',
  'start_address',
  'end_address',
  'waypoints',
  'created_at',
];

// 実測: information_schema.columns（本番 tnfwipbgfgjaymlszeid）
const MEISAI_COLUMNS = {
  user_id: 'uuid',
  company: 'text',
  date: 'date',
  destination: 'text',
  amount: 'integer',
  note: 'text',
  // ★2026-08-05 integer → numeric(8,2) に広げた★
  //   司さん「5.36kmなら5.36kmってだせやぼけ なんで切り上げしとんど ごまかさすな」
  //   整数の列だったので 5.36km が「5km」になっていた。実測どおり出す。
  //   (既存1102件は distance が空か整数だったので、広げても何も失われていない)
  distance: 'numeric2', // km・小数2桁（メーターの画面と同じ桁）
  people: 'integer',
  name: 'text',
  extra: 'jsonb',
};

// ★行き先の書き方（司さんの手入力と同じ形）★ 2026-08-09
//
//   司さん「今治市は除けて町までつける、市外だけ松山市とかつける」
//   ・地元の市は ★市名を落として 町名だけ★
//   ・市外は ★市名を付けたまま★
//   ・出発〜経由〜到着 を「〜」でつなぐ
//   ・同じ所が続く時はまとめる／取れていない所は とばす（★勝手に埋めない★）
//
//   ★地元の市★ は今は既定「今治市」。会社ごとに変えられるよう opts.homeCity で渡せる。
//   （会社の設定に持たせるのが本筋。倉庫に列を足す時に移す）
const HOME_CITY_DEFAULT = '今治市';

// 1つの地点の書き方
function placeText(addr, homeCity) {
  const s = String(addr == null ? '' : addr).trim();
  if (!s) return '';
  const home = String(homeCity || HOME_CITY_DEFAULT);
  if (!home || !s.startsWith(home)) return s; // 市外はそのまま
  const rest = s.slice(home.length).trim();
  // ★町名が取れていない時は落とさない★（「付近」だけにしない）
  if (!rest || rest === '付近') return s;
  return rest;
}

// 1件の代行の 行き先の文字
function routeText(trip, homeCity) {
  if (!trip) return '';
  const ways = Array.isArray(trip.waypoints) ? trip.waypoints : [];
  const raw = [trip.start_address]
    .concat(ways.map((w) => (w && w.address) || w))
    .concat([trip.end_address]);
  const parts = raw.map((a) => placeText(a, homeCity)).filter((x) => !!x);
  const out = parts.filter((p, i) => i === 0 || p !== parts[i - 1]); // 同じ所が続けばまとめる
  return out.join('〜');
}
// 業務開始の日（日本時間）— 給料・売上表と同じ切り方
function businessDate(shiftStartMs) {
  if (!shiftStartMs || !isFinite(shiftStartMs)) return null;
  const d = new Date(shiftStartMs + 9 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function refOf(deviceId, shiftStartMs, seq) {
  return `${deviceId}:${shiftStartMs}:${seq}`;
}

// trips は dk_trips に入れたのと同じ形。done は既に入っている dk_ref の集合。
function buildMeisaiRows(opts) {
  const ownerId = opts.ownerId;
  const deviceId = opts.deviceId;
  const shiftStart = opts.shiftStartMs;
  const trips = Array.isArray(opts.trips) ? opts.trips : [];
  const done = opts.done instanceof Set ? opts.done : new Set(opts.done || []);
  const homeCity = opts.homeCity || HOME_CITY_DEFAULT; // ★地元の市（既定 今治市）★

  const date = businessDate(shiftStart);
  if (!date) return [];

  return trips
    .filter((t) => t && t.payment_type === 'invoice' && t.customer_name)
    .filter((t) => !done.has(refOf(deviceId, shiftStart, t.seq)))
    .map((t) => ({
      user_id: ownerId,
      company: String(t.customer_name || ''), // 請求先（companies.name と同じ文字列）
      date: date, // ★同じ晩は同じ日付★
      // ★2026-08-09: 到着地だけ → 出発〜経由〜到着 に（司さんの手入力と同じ形）★
      //   地元の市は市名を落とし、市外だけ市名を付ける。取れていない所はとばす。
      destination: routeText(t, homeCity),
      amount: typeof t.fare_yen === 'number' ? Math.round(t.fare_yen) : null, // メーター確定の料金
      // ★実測どおりの km（小数2桁）★ 5362m → 5.36km
      //   ★メーターの画面と1桁も食い違わせない★ため、
      //   メーターが使っているのと同じ式 (m/1000).toFixed(2) をそのまま使う。
      //   (Math.round(m/10)/100 だと 3425m で メーター3.42 / 請求書3.43 とズレた。
      //    3.425 は2進数だとほんの少し小さいので、丸め方で答えが変わる)
      distance: typeof t.distance_m === 'number' ? Number((t.distance_m / 1000).toFixed(2)) : null,
      name: '',
      // ★誰が乗ったか(会長/社長/専務など) 2026-08-05★
      //   藤原建設は請求書を備考で分けて小計を出す。ここが空だと★その行だけ仕分けから外れる★。
      //   分け方を使わない会社では今までどおり空(司さんが後から書く場所を奪わない)。
      note: typeof t.customer_note === 'string' ? t.customer_note : '',
      extra: {
        dk_ref: refOf(deviceId, shiftStart, t.seq), // 二重登録を防ぐ鍵
        dk_from: String(t.start_address || ''), // 出発地（標準の列に無い）
        dk_source: 'daikome',
        dk_distance_m: typeof t.distance_m === 'number' ? t.distance_m : null, // ★正確な距離★
      },
    }));
}

// ============================================================
// ★直した代行を請求書アプリにも届ける★ 2026-08-05
//
//   司さん「その業務押したら追加料金や値引きや請求書などちゃんと編集できな」
//   メーターの履歴で金額や請求先を直すと、その業務は送り直される。
//   ところが★既に入っている行は飛ばす★作りだったので、
//   ★請求書アプリだけ古い金額のまま残る★。それを塞ぐ。
//
//   ▼直す時に触る列は限る
//     金額 / 距離 / 請求先 / 日付 / 行き先 だけ。
//     ★備考(note)・人数(people)・名前(name) は司さんが後から書いた物なので絶対に触らない★
//   ▼中身が同じなら何もしない（無駄な書き込みをしない）
// ============================================================
const UPDATABLE = ['company', 'date', 'destination', 'amount', 'distance'];

// 同じ中身か。★数はDBから文字で返る★ので、文字くらべだと 5.30 と 5.3 が
// 「違う」と見えて、送るたびに毎回書き込んでしまう（無駄な更新が一生続く）。
// 数として読めるものは数でくらべる。
function _same(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  const na = Number(a);
  const nb = Number(b);
  if (String(a).trim() !== '' && String(b).trim() !== '' && isFinite(na) && isFinite(nb)) {
    return Math.abs(na - nb) < 1e-9;
  }
  return String(a) === String(b);
}

// rows = これから入れたい行 / existing = 既に入っている行 [{id, extra, company, date, ...}]
function planMeisaiWrite(rows, existing) {
  const byRef = new Map();
  (Array.isArray(existing) ? existing : []).forEach((e) => {
    const ref = e && e.extra && e.extra.dk_ref;
    if (ref) byRef.set(String(ref), e);
  });

  const inserts = [];
  const updates = [];
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    const cur = byRef.get(String(r.extra.dk_ref));
    if (!cur) return inserts.push(r);
    const patch = {};
    UPDATABLE.forEach((c) => {
      const a = cur[c] === undefined ? null : cur[c];
      const b = r[c] === undefined ? null : r[c];
      if (!_same(a, b)) patch[c] = b;
    });
    // ★備考だけは特別扱い (2026-08-05)★
    //   ふつうは司さんが後から書く欄なので絶対に触らない。
    //   ただし「会長/社長/専務」で分ける会社は★メーターが誰かを持っている★ので、
    //   運転手が後から直したらそれを通す。★メーター側が空の時は絶対に触らない★
    //   （空で上書きすると司さんが書いた備考を消してしまう）。
    const newNote = typeof r.note === 'string' ? r.note : '';
    if (newNote && !_same(cur.note === undefined ? null : cur.note, newNote)) patch.note = newNote;
    // 正確な距離も更新する（extra は自分の物なので、司さんの書いた列とは別）
    const curM = cur.extra ? cur.extra.dk_distance_m : undefined;
    if (String(curM === undefined ? null : curM) !== String(r.extra.dk_distance_m)) {
      patch.extra = Object.assign({}, cur.extra, { dk_distance_m: r.extra.dk_distance_m });
    }
    if (Object.keys(patch).length) updates.push({ id: cur.id, patch: patch });
  });
  return { inserts, updates };
}

export {
  MEISAI_COLUMNS,
  placeText,
  routeText,
  DK_TRIPS_COLUMNS,
  businessDate,
  refOf,
  buildMeisaiRows,
  planMeisaiWrite,
  UPDATABLE,
};
