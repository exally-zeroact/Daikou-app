// ============================================================
// scripts/honban-tome.mjs
// ★倉庫に 書く 道具の 本番の 止め（1か所）★ 2026-10-17
//
//   前は 道具ごとに 書くか、書いていなかった：
//     apply-supabase-sql.mjs だけ 止めが 在り（10-17 N7）、
//     apply-meisai-sql.mjs（請求明細 daikou.meisai に 当てる）・deploy-edge-function.mjs（本番の 関数を 配る）は
//     --honban の 字が 0件＝本番の 手元で 打つと そのまま 本番に 当たった（対立役 10-17）。
//   ★白名簿★ テストの 倉庫は 通す・本番は --honban の 時だけ・★知らない 倉庫は 当てない★
//     （前の 形は 本番の 名前 1つだけを 見る 黒名簿で、知らない 向き先を 通した・対立役 小さい-2）
//   ★呼ぶ 所★ 向き先を 読んだ 直後・★倉庫に 届く 前★（読むだけの 時は 止めない）
// ============================================================
export const HONBAN_REF = 'tnfwipbgfgjaymlszeid';
export const TEST_REF = 'khawdrnvssdenumbiwfg';

export function honbanNoTome(ref, args, yomuDake) {
  if (yomuDake) return null;
  if (ref === TEST_REF) return null;
  if (ref === HONBAN_REF) {
    return args.includes('--honban')
      ? null
      : 'NG: 向き先が 本番。本番に 当てるのは --honban を 付けた 時だけ（1文字も 当てていない）';
  }
  return 'NG: 向き先 ' + ref + ' は 知らない 倉庫（テストでも 本番でも ない）。当てない';
}
