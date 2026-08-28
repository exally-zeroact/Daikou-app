// tests/unit/mada-naoshite-inai.test.js
//
// ★★「まだ直していない（赤で正しい）」の組★★ 2026-08-28（指示役の裁定②-2）
//
//   ★線を緩めて緑にするのは 絶対に不可★（それをやると 何も見ていない緑になる）
//   ★でも 黙って赤のまま置くのが 一番いけない★
//   ⇒ ★ここに 名前と理由と「今の数」を書いて、毎回 本数を数えます★
//     ・★中身が増えたら 気づける★（本数が変わったら 赤）
//     ・★直したら ここから消す★（消し忘れも 赤）
//
//   ★なぜ赤のままで正しいのか★
//     ダイコメは ★テスト先行★（[[feedback_daikome_test_tools_first_ALWAYS]]）。
//     ★直す物より先に 試験を書く★ので、書いた直後は ★赤で正しい★。
//     ★線は 思いつきではなく 根拠つき★（下の1本ずつに 書いてあります）。
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

// ★まだ直していない物（赤で正しい）★
//   直したら ここから消す。増えたら ここに足す。★どちらも 本数が変わるので 赤になります★
const MADA = {
  'verify-display-frame-clamp.js': {
    実測: '2026-08-28 … 1フレーム飛び ★22.7m★ > 上限10m（戻り値1）',
    なぜ赤で正しいか:
      '★試験を先に書いてある★（同ファイル17行「EXPECT_FAIL=1 で clamp 前の飛びを確認」）。' +
      '直す物（画面の追従の上限）が まだ入っていないので 赤が正しい。',
    直す物: '★DISP_RATE_MAX_MPS=55 の固定をやめ「直近の速度から作る上限」にする★',
    お金への影響: '★無し★（★画面の見え方だけ★・課金距離には触れない）',
  },
  'verify-display-gap-recovery.js': {
    実測: '2026-08-28 … 復帰の追従速度 ★29.70 m/s★ > 上限25m/s（戻り値1）',
    なぜ赤で正しいか:
      '★線に 根拠が書いてある★（同ファイル19-20行「直近走行速度 11.1m/s の ~2.2倍＝' +
      '25m/s（90km/h）を妥当上限」「現行は DISP_RATE_MAX_MPS=55 に張り付くため FAILするはず' +
      '（＝trivial-greenでない証明）」）。',
    直す物: '★同上（55固定をやめる）★',
    お金への影響: '★無し★（画面の見え方だけ）',
  },
};

describe('★まだ直していない（赤で正しい）の組★', () => {
  it('★本数が 変わっていない★（増えたら足す・直したら消す）', () => {
    const ima = Object.keys(MADA).length;
    // ★2026-08-28 時点 … 2本★
    expect(
      ima,
      '★「まだ直していない」の本数が 2本から変わりました★\n' +
        '  ・増えた … ★新しく赤になった物を ここに 名前と理由と実測で 足してください★\n' +
        '  ・減った … ★直したなら ここから消す（消し忘れも ここで止まります）★\n' +
        '  ★黙って赤のまま置くのが 一番いけない★（指示役 2026-08-28）'
    ).toBe(2);
  });

  it('★1本ずつ 実物が在る★（消えた物の理由が 残っていない）', () => {
    const nai = Object.keys(MADA).filter((f) => !fs.existsSync(path.join(ROOT, 'tests', f)));
    expect(nai, '★tests/ に無い物が 書いてあります★').toEqual([]);
  });

  it('★1本ずつ「実測・なぜ赤で正しいか・直す物・お金への影響」が 書いてある★', () => {
    const tarinai = [];
    Object.keys(MADA).forEach((f) => {
      ['実測', 'なぜ赤で正しいか', '直す物', 'お金への影響'].forEach((k) => {
        if (!MADA[f][k] || String(MADA[f][k]).trim().length < 5) tarinai.push(f + ' の ' + k);
      });
    });
    expect(tarinai, '★書けていない所が あります★').toEqual([]);
  });

  it('★お金に関わる物を ここに入れていない★（逃げ道にしない）', () => {
    const okane = Object.keys(MADA).filter((f) => !/無し/.test(String(MADA[f]['お金への影響'])));
    expect(
      okane,
      '★お金が動く物を「まだ直していない」に入れています★\n' +
        '  ＝★この組は 画面の見え方など お金に触れない物だけ★。\n' +
        '  お金が動く物は ★止めて 指示役へ★（[[feedback_daikome_absolute_rules]]）'
    ).toEqual([]);
  });
});

// ★配る物に「作った時刻」を焼き付けない★ 2026-08-28（指示役の裁定③）
//   道路のデータ（data/roads-*.js）に「// Generated: <時刻>」が入っていたため、
//   ★中身が1本も違わなくても 刷り直す度に「テスト線と本番で違う」★になっていました
//   （2026-08-22 の 19分違いで 実際に鳴りました）。
//   この行は ★誰も読んでいません★（js/ tests/ scripts/ を grep して 0件）。
//   いつ作ったかは ★git のコミットが持っています★。
describe('★配る物に 作った時刻を 焼き付けない★', () => {
  it('★build-roads.js が 時刻を書かない★', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'build-roads.js'), 'utf8');
    expect(
      src,
      '★roads-*.js に 作った時刻を 焼き付けています★\n' +
        '  ＝中身が同じでも 刷り直す度に「両側が違う」と 永久に鳴ります。\n' +
        '  ★いつ作ったかは git が持っています★'
    ).not.toContain('// Generated: ${new Date().toISOString()}');
  });

  it('★今 repo に在る道路データにも 時刻が入っていない★（入っていたら 刷り直しが要る）', () => {
    const dir = path.join(ROOT, 'data');
    const roads = fs.readdirSync(dir).filter((f) => /^roads-[a-z]+\.js$/.test(f));
    expect(roads.length, '★道路データが 1本も無い★').toBeGreaterThan(0);
    // ★頭だけ読む★（1本 4.6MB × 47本 = 200MB を丸ごと読むと 8秒かかり、
    //   全部まとめて回した時に 他の試験とぶつかって 不安定になりました・2026-08-28 実測）
    //   ★2026-08-29: ここが ★たまに赤★でした（同じ中身なのに まとめて回した時だけ 落ちる）。
    //     原因 … ★readSync が 400バイト 読めない事が 在る★（1回で 全部 返るとは 限らない）。
    //     ★読めた分だけで 判定していたので、短いと「時刻が 無い」に 見えていました★。
    //     ⇒ ★読めるまで 読む★（0が返る＝もう無い、まで）。
    const atama = (fp) => {
      const fd = fs.openSync(fp, 'r');
      try {
        const buf = Buffer.alloc(400);
        let yonda = 0;
        for (;;) {
          const n = fs.readSync(fd, buf, yonda, 400 - yonda, yonda);
          if (!n) break;
          yonda += n;
          if (yonda >= 400) break;
        }
        return buf.slice(0, yonda).toString('utf8');
      } finally {
        fs.closeSync(fd);
      }
    };
    const nokotteru = roads.filter((f) => /\/\/ Generated: \d{4}-/.test(atama(path.join(dir, f))));
    // ★今は 47本 全部に 残っています（2026-08-28 実測）★
    //   次に osm-update（毎週）が回って 刷り直されると 0本 に減ります。
    //   ⇒ ★減ったら ここを 0 に直す★（そのままだと 消えた事に 気づけません）
    //   ★自分の値と自分を比べない★（それだと 何も見ていないのに いつも緑）
    expect(
      nokotteru.length,
      '★道路データの「Generated:」の本数が 47本から 変わりました★\n' +
        '  ・減った … ★刷り直しで 消えました。ここを 今の本数（0のはず）に 直してください★\n' +
        '  ・増えた … ★別の作り方で 時刻が また入りました★'
    ).toBe(47);
  });
});

// ★★外の物が要る見張り＝「未測定」と言う（黙って緑にしない）★★ 2026-08-28（指示役）
//   外の鍵・外のサービス・遠くの倉庫が要る物は ★正しい★。CIでは 測れません。
//   ⇒ ★「skipping (no failure)」のような言い方をやめ ★未測定★ と はっきり出す★
//   ⇒ ★毎回の報告に「未測定 ◯本」を 数で載せる★（増えても 気づけるように）
const MISOKUTEI = {
  'tier1-osrm.js': '★外のサービス★ OSRM_ENDPOINT が要る（この環境では 未測定）',
  'tier4-google.js': '★外の鍵★ GOOGLE_DIRECTIONS_API_KEY が要る（この環境では 未測定）',
  'real-trace-compare.js': '★外のサービス＋遠くの倉庫★ OSRM/Google と debug_traces が要る',
  'real-trace-roadsnap.js':
    '★遠くの倉庫★ debug_traces が要る（2026-08-28 に 赤で終わる形へ直した）',
  // ★2026-08-28 追加（3本）★ … 住所の生成物は ★repo に置いていない★（build で作る物）。
  //   実測で 3本とも 無い（data/addresses-*-ehime.js）。★赤にはしない★（無いのが 普通）。
  //   ただし 前は「skip」と出して 緑で終わっていた＝★未測定と はっきり言う形へ直した★。
  'integration/address-chiban-build.test.js':
    '★生成物が要る★ data/addresses-chiban-ehime.js（build 未実行なら 未測定）',
  'integration/address-rsdt-build.test.js':
    '★生成物が要る★ data/addresses-rsdt-ehime.js（build 未実行なら 未測定）',
  'integration/address-street-build.test.js':
    '★生成物が要る★ data/addresses-street-ehime.js（build 未実行なら 未測定）',
};

describe('★外の物が要る見張りは「未測定」と言う★', () => {
  it('★本数が 変わっていない★（増えたら足す・要らなくなったら消す）', () => {
    expect(
      Object.keys(MISOKUTEI).length,
      '★「未測定」の本数が 4本から 変わりました★\n' +
        '  ・増えた … ★外の物が要る見張りが 増えました。名前と理由を ここに足してください★\n' +
        '  ・減った … ★中で測れるようになったなら ここから消す★'
    ).toBe(7);
  });

  it('★1本ずつ 実物が在る★', () => {
    const nai = Object.keys(MISOKUTEI).filter((f) => !fs.existsSync(path.join(ROOT, 'tests', f)));
    expect(nai, '★tests/ に無い物が 書いてあります★').toEqual([]);
  });

  // ★数える前に コメントを外す★ 2026-08-28（指示役）
  //   ★文字列で探すと 自分の説明文まで拾います★
  //   （実際 この見張りが 私の書いたコメントを拾って 赤になりました）
  //   ＝「名前で探すな」と 同じ型。★誤検出は 道具の側で 潰します★
  const komentoWoKesu = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

  it('★「未測定」と はっきり書いてある★（skipping で済ませない）', () => {
    const dame = [];
    Object.keys(MISOKUTEI).forEach((f) => {
      const src = komentoWoKesu(fs.readFileSync(path.join(ROOT, 'tests', f), 'utf8'));
      if (src.indexOf('未測定') < 0) dame.push(f + ' … 「未測定」と 画面に出していない');
      if (/skipping \(no failure\)/.test(src))
        dame.push(f + ' … 「skipping (no failure)」が残っている');
    });
    expect(
      dame,
      '★読む人に「合格」と見える言い方が 残っています★（0件と未測定を 混ぜない）'
    ).toEqual([]);
  });
});

// ★★非ブロック指定（soft: true）の棚卸し★★ 2026-08-28（指示役の裁定③・★一番大事★）
//   cert-gate.yml の soft は continue-on-error ＝ ★赤でも ✓ が出ます★。
//   ＝「無い時に緑」と ★同じ型★（読む人には 合格に見える）。
//   ⇒ ★1本ずつ「なぜ soft か・いつ外すか」を書き、本数を 機械が数えます★
//     ・yml で 1つ足したら ★本数が合わなくなって 赤★（黙って増やせない）
//     ・ここから消したのに yml に残っていても ★赤★
//   ★報告に「soft ◯本」を 毎回 載せる★（未測定と同じ扱い・指示役 2026-08-28）
const SOFT = {
  'device-spread': {
    なぜsoft:
      '★赤で正しい★（2026-08-29 に 実物を repo へ 運んだ）。それまでは ' +
      'tests/gate-realdevice-spread.js が repo に無く MODULE_NOT_FOUND を soft が ✓ に見せていた（CI 33146596665）。' +
      '見ているのは ★同じ走行を3台で測った距離の開きが 運賃刻み(420m)を割らないか＝運賃割れ防止★。',
    いつ外すか:
      '★seam（穴の継ぎ目の連続化）が 入った日★。それまでは (A)(C) が 赤で 正しい（試験が先）。' +
      '★距離の本体は 不可侵★なので 直すのは 指示役の指示があってから。',
    実測:
      '2026-08-29 手元 298.7秒・戻り値1 … ★3台とも 測れた★' +
      '（Android 10,183.5m ／ iPhoneSE 9,467.2m ／ iPhone13-noisy 9,393.3m）。' +
      '(A)3台収束 ★FAIL spread=790.2m(7.76%)★（条件420m未満）／' +
      '(B)過大ゼロ PASS（iP13 8,313.7m vs 真値8,390＝−0.91%）／(C)creep ★FAIL 23.86m（上限5m）★／(D)seam=NO。' +
      '★当時 679.9m → 今 790.2m＝開きが 広がっている★',
    お金への影響:
      '★有り（運賃割れ）★ … 同じ走行でも 台によって 運賃の段が 変わり得る。' +
      'ただし ★多く取る／少なく取る どちらかは 未測定★（真値と比べていない）。' +
      '(C)の creep 23.86m は ★末尾に60秒の停車を足した合成★の上での値で、実機そのままは 0.00m＝材料が違う。',
  },
  'tunnel-continuity': {
    なぜsoft:
      '★赤で正しい★（実機の走行データ） 2026-08-28 に ★.slim へ向け直して 本当に測れるようにした★。' +
      '前は full（shimanami-*.json）を見ていたが 両repoに 1本も無く throw していた（＝未測定を soft が隠していた）。',
    いつ外すか:
      '★穴の出口で 一括計上しない実装が 入った日★（bg-freeze と 同じ直し＝tick 予算）。' +
      '★距離の本体は 不可侵★なので 直すのは 指示役の指示があってから。',
    実測:
      '2026-08-28 … iPhoneSE で ★1フレーム 296.54m（上限 30.8m）★ @穴の出口（dt=12秒の本物のトンネル・' +
      '直線で 247.60m・その間 約20.5m/s で走行）。' +
      '★2026-08-29 訂正：前は「Android/iPhone13 は 違反0」と 書いていましたが 嘘でした★' +
      '（tail で 終わりだけ 見て、見ていない2台を 断言した）。' +
      '★実測＝3台とも 違反：Android 1,492.67m @i1830（2フレーム）／' +
      'iPhone13 1,443.78m @i865（3フレーム）／iPhoneSE 296.54m @i1578（1フレーム）★' +
      '★手元と CI は 完全に 一致（食い違いは 在りませんでした）★。' +
      '★材料が切り貼りでない事も確認（1〜2秒で100m超 動く点=0個）★',
    お金への影響:
      '★有り（別の組で数える）★ … 一括で乗る。多く取っているかは ★未測定★（道なりなら 直線より長いのが普通）',
  },
  'bg-freeze': {
    なぜsoft:
      '★赤で正しい★ 試験が先に在り 本体（pipeline-distance.js の coast 枝に tick 予算が無い）が未修正。' +
      '画面ロック中は OS が tick を止め、復帰の ★1フレームで 凍結中の経過分を 一括計上★ する。',
    いつ外すか:
      '★coast を tick 予算でクランプした日★。' +
      '★距離の本体＝distance_m は 不可侵★なので 直すのは 指示役の指示があってから。',
    実測:
      '2026-08-28 3.3秒 … (A)ドン無し ★FAIL 単フレ 180.00m（予算 9.50m）★ ／ ' +
      '(B)順序不変 PASS ／ (C)過大ゼロ PASS(184.50m ≤ 189.50m)',
    お金への影響:
      '★「距離に乗る赤」の組で 数える★ … ★総額は 増えない（直すと 増える）★。残す理由は 停車中の「幻」（最大 120.7m）',
  },
  'gnss-degraded': {
    なぜsoft:
      '★赤・ただし「試験が先」ではない★＝この見張りは ★PASS する前提★で書かれており、' +
      '今は ★合わせるべき線に 届いていない★。実機3台の走行に 生弦+10%膨張を注入すると 平滑後が 真値を超える。',
    いつ外すか:
      '★①線(ε=0.5%)が正しいか ②実機の劣化GPSで再現するか を測って 決着した日★。' +
      '線を緩めて緑にするのは ★不可★（それをやると 何も見ていない緑）。',
    実測:
      '2026-08-28 18.9秒 … android +0.49% OK ／ ★iphonese +0.85% NG★ ／ ★iphone13-noisy +0.83% NG★（許容 0.5%）' +
      '／実機そのままの走行では 過大ゼロ・タイヤ計比 −0.93%（別測定）',
    お金への影響:
      '★有り★（過大＝認定アウトの側。ただし ★赤は 合成ノイズの上での話・実機の劣化での再現は 未測定★）',
  },
};

describe('★非ブロック指定（soft）の棚卸し★', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'cert-gate.yml'), 'utf8');
  // ★コメントを外してから数える★（自分の説明文を拾って赤になった事が 2回あります）
  const naka = yml.replace(/^[ \t]*#.*$/gm, '');

  it('★本数が 変わっていない★（黙って soft を足せない）', () => {
    expect(
      Object.keys(SOFT).length,
      '★soft の本数が 4本から 変わりました★\n' +
        '  ・足した … ★なぜsoft・いつ外すか・実測・お金への影響 を ここに書いてください★\n' +
        '  ・外した … ★ここからも消す★（soft は 赤でも ✓ が出ます＝黙って置くのが 一番いけない）'
    ).toBe(4);
  });

  it('★yml の soft と ここの本数が 合っている★', () => {
    const ymlKazu = (naka.match(/soft:\s*true/g) || []).length;
    expect(
      ymlKazu,
      '★yml の soft と ここの本数が 合っていません★\n' +
        '  ＝どちらかを 直してください（yml で 黙って増やす／ここで 消し忘れる を 止めます）'
    ).toBe(Object.keys(SOFT).length);
  });

  it('★1本ずつ yml に その名前で 載っている★', () => {
    const nai = Object.keys(SOFT).filter((n) => naka.indexOf('- name: ' + n) < 0);
    expect(nai, '★yml に 無い名前が 書いてあります★（名前を変えたら ここも直す）').toEqual([]);
  });

  it('★1本ずつ「なぜsoft・いつ外すか・実測・お金への影響」が 書いてある★', () => {
    const tarinai = [];
    Object.keys(SOFT).forEach((n) => {
      ['なぜsoft', 'いつ外すか', '実測', 'お金への影響'].forEach((k) => {
        if (!SOFT[n][k] || String(SOFT[n][k]).trim().length < 10) tarinai.push(n + ' の ' + k);
      });
    });
    expect(tarinai, '★書けていない所が あります★').toEqual([]);
  });

  // ★★中身の内訳も 数える★★ 2026-08-29（指示役の裁定2）
  //   ★CI では soft は「pass」と出ます。step の結論も「success」です★
  //   ＝★色でも step でも 見分けが つきません。ログの中身を 読むしか ありません★
  //   ⇒ ★人が 毎回 読むのをやめ、ここで 内訳を 数えます★（人が 居なくても 残る）
  //   ⇒ ★増えても 減っても 赤★。減った時は ★1本ずつ 目で見る★（数だけ 合わせない）
  it('★soft の 中身の内訳が 変わっていない★（赤4・未測定0）', () => {
    const aka = Object.keys(SOFT).filter((n) =>
      /★赤で正しい★|★赤・/.test(String(SOFT[n]['なぜsoft']))
    );
    const misokutei = Object.keys(SOFT).filter((n) => /★未測定★/.test(String(SOFT[n]['なぜsoft'])));
    expect(
      { 赤: aka.length, 未測定: misokutei.length },
      '★soft の 中身の内訳が 変わりました★\n' +
        '  ・★CIが緑でも 中身は 赤です★（soft は 赤でも ✓ が出ます）\n' +
        '  ・増えた … ★新しく soft を足したなら 理由と実測を 書いてください★\n' +
        '  ・減った … ★1本ずつ 目で見て から この数を 直してください★（数だけ 合わせない）'
    ).toEqual({ 赤: 4, 未測定: 0 });
  });

  it('★赤と未測定の どちらでもない soft が 無い★（言い方を 揃える）', () => {
    const fumei = Object.keys(SOFT).filter(
      (n) => !/★赤で正しい★|★赤・|★未測定★/.test(String(SOFT[n]['なぜsoft']))
    );
    expect(fumei, '★「なぜsoft」の頭に ★赤で正しい★ か ★未測定★ を 書いてください★').toEqual([]);
  });

  // ★★見ていない物を 断言していないか★★ 2026-08-29
  //   ★私は tail で 終わりの14行だけ 見て、見ていない2台を「違反0」と 書きました★。
  //   3台を 見る見張り（tunnel-continuity / device-spread）は
  //   ★実測に 3台ぶん 全部の名前が 出ている事★を 機械が 確かめます。
  //   ＝★1台だけ 見て 全体を 語る★を 止めます。
  it('★3台を見る見張りは 実測に 3台とも 出ている★（1台だけ見て 語らない）', () => {
    // ★名前は 表ごとに 違います★（SOFT は 'tunnel-continuity'／KYORI_AKA は 'gate-tunnel-continuity.js'）
    //   ★2026-08-29: 片方の 書き方だけで 照合して 1本も 拾えていませんでした（＝何も見ずに 緑）★
    //   ⇒ ★どちらの 書き方でも 当たる形★にし、★拾えた本数も 数えます★
    const SANDAI = /tunnel-continuity|realdevice-spread|device-spread/;
    const DEVICES = ['Android', 'iPhone13', 'iPhoneSE'];
    const tarinai = [];
    let hirotta = 0; // ★何本 拾えたか（0本なら 何も見ていない）★
    [SOFT, KYORI_AKA].forEach((hyou) => {
      Object.keys(hyou).forEach((n) => {
        if (!SANDAI.test(n)) return;
        hirotta++;
        const jissoku = String(hyou[n]['実測'] || '');
        DEVICES.forEach((d) => {
          if (jissoku.indexOf(d) < 0) tarinai.push(n + ' の実測に ' + d + ' が 無い');
        });
      });
    });
    // ★0本なら 何も見ていない★（名前の書き方が 変わった時に 黙って緑にならない為）
    expect(
      hirotta,
      '★3台を見る見張りを 1本も 拾えていません（名前の書き方が 変わった？）★'
    ).toBeGreaterThan(1);
    expect(
      tarinai,
      '★3台を見る見張りなのに 実測に 出ていない台が あります★\n' +
        '  ＝★見ていない台を「違反0」と 書いてしまう形★（2026-08-29 に 実際に やりました）'
    ).toEqual([]);
  });

  it('★実測に 日付が 入っている★（いつ測ったか分からない物を 置かない）', () => {
    const furui = Object.keys(SOFT).filter(
      (n) => !/20\d\d-\d\d-\d\d/.test(String(SOFT[n]['実測']))
    );
    expect(furui, '★実測に 日付が 無い物が あります★（読んだ人が 古さを判断できません）').toEqual(
      []
    );
  });
});

// ★★距離に乗る赤★★ 2026-08-28（指示役の裁定・旧「お金に関わる赤」から 改名）
//   ★なぜ「お金に関わる赤」から 改名したか★（指示役 2026-08-28）
//     ★お金に関わるかどうかは 真値と比べないと 言えません★。
//     今 分かっているのは ★「1フレームに まとめて乗る」★という事だけです。
//     「お金に関わる」と名乗ったまま置くと ★次の人が「過大請求だ」と読みます★
//     ＝★2026-08-23 に 実際に そう読んで 司さんへ上げてしまった★型。
//   ★「赤で正しい」組は お金に触れない物だけ★と決めてあるので、ここは 別の組として 数える。
//   ★止めて 指示役へ★（[[feedback_daikome_absolute_rules]]）＝ここに在る間は 直さない。
const KYORI_AKA = {
  'gate-bg-freeze.js': {
    何が起きるか:
      '★画面ロック/背景で OS が tick を止め、復帰の1フレームで「速度×凍結時間」を 一括計上する★。' +
      '位置は据え置き（動いていない）ので、★凍結中に 実際に停まっていたら その分は 幻★。',
    門はあるか:
      '★振る舞いで探した（変数名で探していない）★ … 門は 2つだけ:' +
      '①dt>10秒 なら 0m（obdMaxDtS）②ホールド速度が 9km/h 未満まで減衰したら その穴は以後 0m（≒22秒以上の凍結）。' +
      '★1フレームあたりの上限（tick 予算）は 無い★。',
    実測:
      '2026-08-28 ★実 gps.js を node で駆動★ … 凍結中に停まっていた場合に乗る幻の最大 = ' +
      '40km/h:48.3m ／ 60km/h:72.4m ／ 72km/h:86.9m ／ ★100km/h:120.7m★（どれも 凍結10秒の時）。' +
      '11秒以上の凍結は 0m。1秒の凍結も 0m（穴と見なす前）。',
    向き:
      '★多く取っているのでは ありません★ … gate の材料では 総額 184.50m = 184.50m（同じ）。' +
      '実 gps.js では ★直すと 増える★（9秒の凍結 84.99m → 刻むと 117.34m）。' +
      '★残す理由＝凍結中に 実際に停まっていた時に「幻」が乗る事★。' +
      '最大 = ★10秒凍結・100km/h で 120.7m★（72km/h なら 86.9m）／11秒以上は 0m／1秒も 0m。' +
      '★1フレームあたりの上限が 実装に 無い★。',
    直す線の根拠:
      '★1フレームで許すのは 直近速度 × タイマー周期(0.15秒) × 1.5 ＝ 20m/s なら 4.5m＋余裕5m＝9.5m★' +
      '（gate-bg-freeze.js の TICK_BUDGET_M と同じ式・never-over cap と同型）。' +
      '★線を先に決めた★：実測に合わせて 後から緩めない。',
    直し方の裏取り:
      '2026-08-28 … ★NEG=1（復帰を tick 刻みに割る）で GATE PASS★（単フレ 3.00m ≤ 予算 9.50m）＝直し方は効く。',
    誰待ちか: '★指示役★（distance_m は不可侵・直すのは指示があってから）',
  },
  'gate-tunnel-continuity.js': {
    何が起きるか:
      '★トンネル（GPSの穴）の出口で 1フレームに 穴の分を まとめて計上する★。' +
      'bg-freeze と ★同じ型★だが、こちらは ★合成ではなく 実機の走行データで 出た★。',
    門はあるか:
      '★見張りの線★＝dDelta ≤ max(10m, 直近確立速度×dt×1.5)。★1フレームの上限は 実装に 無い★。',
    実測:
      '2026-08-28 … ①実機 shimanami-iPhoneSE.slim(5000点) で ★1フレーム 296.54m（上限 30.8m）★' +
      '（穴 dt=12秒・直線 247.60m・約20.5m/s で走行中）。' +
      '★2026-08-29 実測＝3台とも 違反（Android 1,492.67m／iPhone13 1,443.78m／iPhoneSE 296.54m）★' +
      '★手元と CI は 一致★。前の「Android/iPhone13 は 違反0」は ★私の読み落とし★。' +
      '②★真値(DM Light)を持つ 代行実走 realtrace-0617-daiko-dm(5273点)★ でも ' +
      '★1フレーム 1,003.13m（上限 12.65m）★（穴 dt=65.44秒・直線 759.2m・約15.3m/s で走行中・reason=doppler）。' +
      '★材料は綺麗★＝5秒以内に 300m超 動く点は ★0個★（GPSのワープでは ない）。',
    向き:
      '★真値と 比べました（2026-08-28・既存の道具 tests/tools/realtest-dm-score.js）★:' +
      '★実車1 −1.36% ／ 実車2 −1.51%（DM Light 11.43km / 6.77km に対して 少ない）★' +
      '＝★天井(+0.5〜6%)の 中どころか 下★。OBD主体でも −1.34% / −2.07%。' +
      '★ただし 1,003m が乗った 実車4 には DM の読みが 無い＝その区間だけは ★未測定★★。' +
      '⇒★今 分かっているのは「1フレームに まとめて乗る」事だけ。多く取っているとは 言えない★。',
    直す線の根拠:
      '★1フレームで許すのは 直近確立速度 × dt × 1.5（床10m）★＝この見張りが 既に持っている線。' +
      '★線を先に決めた★：実測に合わせて 後から緩めない。',
    直し方の裏取り:
      '★未実施★ … bg-freeze では NEG=1（tick 刻みに割る）で PASS を確認済。' +
      'こちらも 同じ直しで 消えるはずだが ★まだ 確かめていない★。',
    誰待ちか: '★指示役★（distance_m は不可侵）',
  },
};

describe('★距離に乗る赤（別に数える）★', () => {
  it('★本数が 変わっていない★', () => {
    expect(
      Object.keys(KYORI_AKA).length,
      '★「距離に乗る赤」の本数が 2本から 変わりました★\n' +
        '  ・増えた … ★1フレームに まとめて乗る赤は ここに 実測つきで 足す（「赤で正しい」へ入れない）★\n' +
        '  ・減った … ★直したなら ここから消す★'
    ).toBe(2);
  });

  it('★1本ずつ 実物が在る★', () => {
    const nai = Object.keys(KYORI_AKA).filter((f) => !fs.existsSync(path.join(ROOT, 'tests', f)));
    expect(nai, '★tests/ に無い物が 書いてあります★').toEqual([]);
  });

  it('★1本ずつ「何が・門・実測・向き・線の根拠・裏取り・誰待ち」が 書いてある★', () => {
    const tarinai = [];
    Object.keys(KYORI_AKA).forEach((f) => {
      [
        '何が起きるか',
        '門はあるか',
        '実測',
        '向き',
        '直す線の根拠',
        '直し方の裏取り',
        '誰待ちか',
      ].forEach((k) => {
        if (!KYORI_AKA[f][k] || String(KYORI_AKA[f][k]).trim().length < 10)
          tarinai.push(f + ' の ' + k);
      });
    });
    expect(tarinai, '★書けていない所が あります★').toEqual([]);
  });

  it('★「赤で正しい」組と 二重に置いていない★', () => {
    const daburi = Object.keys(KYORI_AKA).filter((f) => Object.keys(MADA).indexOf(f) >= 0);
    expect(daburi, '★同じ物が 2つの組に 在ります★（本数が二重になります）').toEqual([]);
  });
});
