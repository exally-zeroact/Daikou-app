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
  // ★車の札 (2026-09-03・司さん)★
  //   一覧は extra の dk_car / dk_car_no で ★車ごとに 分けて 早い順★ に 並べる。
  //   ★これが 無いと 全部「手で入れた分」に まとめられる★（8/25以降 実際に そうなっていた）。
  //   出どころ … 事務所で 付けた札 daikome.dk_device_labels（label＝車の名前 / sort_order＝並び順）
  //   ★取れない時は 足さない★＝空文字や 0 を 作らない（＝「車が無い」と 読まれる物を 作らない）
  const carLabel =
    typeof opts.carLabel === 'string' && opts.carLabel.trim() ? opts.carLabel.trim() : null;
  const _carNoRaw = Number(opts.carNo);
  const carNo = isFinite(_carNoRaw) && _carNoRaw > 0 ? _carNoRaw : null;

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
      //   標様建設は請求書を備考で分けて小計を出す。ここが空だと★その行だけ仕分けから外れる★。
      //   分け方を使わない会社では今までどおり空(司さんが後から書く場所を奪わない)。
      note: typeof t.customer_note === 'string' ? t.customer_note : '',
      extra: {
        dk_ref: refOf(deviceId, shiftStart, t.seq), // 二重登録を防ぐ鍵
        // ★2026-08-25 直し（司さん）★ 出発地も 到着地と同じ決まりで書く（地元の市は落とす）。
        //   ここだけ ★生の住所のまま★ だったので、一覧では
        //   「今治市松本町〜東鳥生町」と ★出発地にだけ 今治市が残る★ 形になっていた。
        //   （到着地は 2026-08-09 から placeText を通していた＝片方だけ直っていた）
        dk_from: placeText(t.start_address, homeCity), // 出発地（標準の列に無い）
        dk_source: 'daikome',
        dk_distance_m: typeof t.distance_m === 'number' ? t.distance_m : null, // ★正確な距離★
        // ★★メーターが その時 出していた 金額 (2026-09-29)★★
        //   ★これが 無いと「事務所が 手で 直した」と「メーターが 変わった」を 見分けられない★。
        //   下の planMeisaiWrite は この 値と くらべて、
        //   ★メーターが 変わった時だけ amount を 直す★（詳しくは そちらの 注記）。
        // ★amount と ★同じ 丸め方★ に する（2026-09-29）
        //   前は amount = Math.round(fare_yen) なのに 印だけ 丸めていなかった。
        //   今の 本番は fare_yen の 小数 ★0件★（実測）なので まだ 踏んでいないが、
        //   1件でも 小数が 出た日から ★毎回 「メーターが 変わった」と 読んで 上書きし続ける★。
        dk_meter_yen: typeof t.fare_yen === 'number' ? Math.round(t.fare_yen) : null,
        // ★車の札 (2026-09-03)★ 取れた時だけ 足す（無い時は キーごと 作らない）
        ...(carLabel === null ? {} : { dk_car: carLabel }),
        ...(carNo === null ? {} : { dk_car_no: carNo }),
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
    // ★★事務所が 消した 行には 一切 触らない（2026-09-29）★★
    //   本番実測：dk_ref 付き 150行中 ★32行が deleted_at 付き★。
    //   見ていなかったので ★消した 行に 印を 打ち、条件次第で 金額も 戻していた★。
    //   消したのは 人の 決め なので ★生き返らせない・書き換えない★。
    //   （insert も しない＝索引が 弾くので どうせ 入らない）
    if (cur.deleted_at) return;
    const patch = {};
    // ★★2026-09-29＝金額は「メーターが 変わった時だけ」直す（司さん「1.2両方やれや」）★★
    //   ★何が 起きていたか（対立役2人＋私が 別々に 数えて 一致）★
    //     amount は 名簿(UPDATABLE)に 載っているだけで ★守りが 1つも 無かった★。
    //     ⇒ 事務所（代行請求書アプリ）で 手で 直した 金額が、送り直しの たびに
    //       ★メーターの 値に 黙って 戻る★。
    //     本番の 実測(2026-09-29・私が その場で 数え直した):
    //       dk_ref で 突き合わせた 150行 中 ★143行は 同じ・7行だけ 違う★。
    //       ★向き★（前に 1回 逆に 書いて 司さんに 逆で 伝えた。ここが 正しい 向き）:
    //         ・明細が メーターより ★低い★ …… 6行・計 ★1,400円★（＝取りっぱぐれ側）
    //         ・明細が メーターより ★高い★ …… 1行・  ★2,000円★（＝多く 請求 側）
    //       ★どちらが 動いたかは 分からない（見立て）★
    //         … daikou.meisai に updated_at が 無い ので
    //           「事務所が 直した」のか「メーター側が 後から 変わった」のかは 決められない。
    //       （全部 8月分＝端末の 30日の 外＝★たまたま 射程外だっただけ★）
    //   ★見分け方★ 書く時に `extra.dk_meter_yen`（その時の メーターの 額）を 一緒に 残す。
    //     ・印と 今の メーターが ★同じ★ … メーターは 変わっていない
    //        ⇒ 金額が 違うのは ★事務所が 直したから★ ⇒ ★触らない★
    //     ・印と 今の メーターが ★違う★ … 運転手が 値引き等で 直した
    //        ⇒ ★直す★（今までどおり 届ける）
    //     ・印が ★無い★（この直しより 前に 入った 行）
    //        ⇒ ★ここが 2026-09-29 に 対立役に 叩かれて 直った 所★（下に 書く）
    //   ★備考・人数・名前は 今までどおり 触らない。距離や 日付は 今までどおり 直す。★
    //
    //   ★★印が 無い 行の 扱い＝はじめ 逆の 穴を 開けていた（実測で 再現した）★★
    //     最初の 形は「触らない＋印は 今の メーターの 額に 進める」だった。
    //     ⇒ 運転手が 値引きを 入れると
    //        1回目: 金額は 触らず ★印だけ 値引き後の 額に 進む★
    //        2回目: 印と メーターが 同じ ＝「変わっていない」⇒ ★もう 二度と 直さない★
    //       ＝★値引きが 一生 届かない★（実測: 請求書 3,000／メーター 2,500／ずれ 500円 固定）
    //     ★「1回 取りこぼす」では なく「永久に 取りこぼす」だった。★
    //   ★★印が 無い 行の 扱い＝2回 やり直して ここに 落ち着いた★★
    //     1回目「触らない＋印を 進める」… ★値引きが 一生 届かない★（実測 500円 固定）
    //     2回目「触らない＋印も 付けない（人の裁き待ち）」
    //        … ★交換比が 逆★だった（対立役の 指摘・本番で 数えた）:
    //          守る 相手 7行（低い6行 1,400円＋高い1行 2,000円）は
    //            ★全部 30日の 外＝もう 送られない＝元から 安全★
    //          塞ぐ 相手 83行・169,500円 は ★これから 毎日 使う「値引きが 届く 道」★
    //        さらに 返事に 出した 裁き待ちは ★誰も 読んでいなかった★（j.meisai の 読み手 0箇所）
    //        ＝「黙って 放置しない」と 言いながら 実際は 放置。
    //     3回目（今）★読んで 直すのを やめ 構造で 直す★:
    //        ・印が 無い 行は ★今までどおり 直す★（＝値引きは 届く）
    //        ・印は ★書いた 時に 必ず 付く★（buildMeisaiRows）ので 新しい行は 最初から 守られる
    //        ・既に 在る 行は ★1回きりの 埋め戻し★で 印を 入れる
    //          （supabase/apply-meisai-dkmeteryen-backfill.sql・印は ★メーターの額★ で 埋めるので
    //            ずれている 7行も そのまま 守られる）
    const meterIma = r.amount === undefined ? null : r.amount;
    const meterMae = cur.extra ? cur.extra.dk_meter_yen : undefined;
    const inGaAru = meterMae !== undefined && meterMae !== null;
    // 印が 在る … メーターが 変わった時だけ 直す（＝事務所の 直しを 守る）
    // 印が 無い … 今までどおり 直す（守りは 埋め戻しが 済むまでの 間だけ 効かない）
    const kanekoWoNaosu = !inGaAru || !_same(meterMae, meterIma);
    UPDATABLE.forEach((c) => {
      if (c === 'amount' && !kanekoWoNaosu) return; // ★事務所の 直しを 守る★
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
    const kyoriGaChigau =
      String(curM === undefined ? null : curM) !== String(r.extra.dk_distance_m);
    // ★メーターの 額の 印★ … 今の メーターの 額に 揃える（無ければ 付く・変われば 進む）
    const inGaChigau = String(meterMae === undefined ? null : meterMae) !== String(meterIma);
    if (kyoriGaChigau || inGaChigau) {
      patch.extra = Object.assign({}, cur.extra, { dk_distance_m: r.extra.dk_distance_m });
      if (inGaChigau) patch.extra.dk_meter_yen = meterIma;
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
