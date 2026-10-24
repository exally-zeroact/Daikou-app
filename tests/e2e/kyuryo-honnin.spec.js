// ============================================================
// ★★本人モード（従業員が 自分の 給料明細だけ 見る）★★ 2026-09-03
//
//   ★司さんの言葉★
//     「Rakunallyみたいに 従業員ごとに QRコードや URLを 配って
//       個人が 勝手に 確認できるようにも しろやぼけ」
//
//   ★ここで 見張る 事★
//     ①パスワードの 決め方（数字 4桁で ない／確認と 違う → 断る・2026-10-20 から 4桁）
//     ②2回目は パスワードだけ（違えば 断る）
//     ③★事務所の 物を 出さない★（タブ・全員印刷・事務所へのリンク）
//     ④★事務所の 読み込みを 1度も 呼ばない★（材料は 倉庫の 関数だけ）
//     ⑤★★本人に 見せては いけない 物が 出ていない★★
//        「会社に残る分」「つかさの取り分」「みんなの給料」「売上合計」
//        ⇒★これは 実際に 漏れていた★（2026-09-03・絵を 開いて 見て 気づいた）
//          数字だけ 見ていたら 気づかない＝★絵を 開いて 見る★の 決まりが 効いた所。
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-03 実測）★★
//     ①「会社に残る分」を 本人にも 出す ……… ★4本中 1本 赤★
//     ②タブを 隠すのを やめる ………………… ★4本中 1本 赤★
//     ③8文字の 線を 外す ……………………… ★4本中 1本 赤★
//     戻した後 … ★4本とも 緑★
// ============================================================
const { test, expect } = require('@playwright/test');

const EMP = {
  employee_id: 'e1',
  company_id: 'c1',
  name: '見張り太郎',
  role: '甲',
  active: true,
  sort_order: 1,
};
const SET = {
  company_id: 'c1',
  period_start_day: 21,
  period_end_mode: 'thirds', // ★10-07：前は 'month3'（知らない 値＝黙って 月3回）。今は 止まるので 本当の 値に
  period_days: 11,
  show_car_sales: true,
  roles: { 甲: { rate: 0.3, floor: 1000 } },
};

// ★倉庫の 関数を 差し替える（本物の 形の 返事だけ 返す）★
//   ★事務所の 読み込み（/rest/v1/dk_◯◯）は 数える★＝呼んだら 赤
async function nise(page, hajimete, mazeru) {
  const kazoe = { jimusho: 0 };
  // ★本物の 関数と 同じ 答え★（2026-10-21）：パスワードが 空（null）＝開いた 時の 探り は、
  //   まだ 決めていない 人に pw_4keta を 返す（何も 書かない）。決める 時だけ ok
  await page.route('**/rest/v1/rpc/dk_kyuryo_pw_set', (r) => {
    const b = JSON.parse(r.request().postData() || '{}');
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(b.p_pw == null ? { ok: false, reason: 'pw_4keta' } : { ok: true }),
    });
  });
  await page.route('**/rest/v1/rpc/dk_kyuryo_{verify,fuda}', (r) => {
    const b = JSON.parse(r.request().postData() || '{}');
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        b.p_pw === 'abcd1234' ? { ok: true, name: EMP.name } : { ok: false, reason: 'bad_pw' }
      ),
    });
  });
  await page.route('**/rest/v1/rpc/dk_kyuryo_get', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        emp: EMP,
        settings: [SET],
        labels: [
          { company_id: 'c1', device_id: 'd1', label: '1466', sort_order: 1, show_in_slip: true },
        ],
        shifts: [],
        edits: [],
        workHours: [],
        adjustments: [], // ★本物の 関数は 必ず 返す（10-07：返らない 時は 止める 様に した）★
        rireki: [], // ★本物の 関数は 必ず 返す（10-18：返らない 時は 止める）★
        yakuRireki: [],
        uriageRireki: [],
        shimeRireki: [],
        uriageNaoshi: true, // 売上の 直しを 返す 版の 印（10-14：無い 時は 止める）
        tebikiJippi: true, // 手入力の 日の 足した 実費を 返す 版の 印（10-20：無い 時は 止める）
        manualDays: [],
        ...(mazeru || {}),
      }),
    })
  );
  await page.route('**/rest/v1/dk_**', (r) => {
    kazoe.jimusho++;
    return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.goto('/kyuryo.html?t=TOK' + (hajimete ? '&c=INIT12345' : ''));
  await page.waitForTimeout(1000);
  return kazoe;
}

// ★2026-10-20 司さん「パスワードは 4桁に しろ」★（前は 8文字 以上）
//   わざと壊す：hnGo の /^[0-9]{4}$/ を 外す ⇒ 赤（abcd で 倉庫へ 送った）
test('★① はじめて＝パスワードの 線（数字 4桁・確認）★', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await nise(page, true);
  await expect(page.locator('#hnGo')).toHaveText('パスワードを 決める');
  await expect(page.locator('#hnPw')).toHaveAttribute('inputmode', 'numeric');
  await expect(page.locator('#hnPw')).toHaveAttribute('maxlength', '4');
  await expect(page.locator('#slips')).toContainText(
    '銀行などの 暗証番号と 同じに しないでください'
  );
  let okutta = 0;
  page.on('request', (q) => {
    if (q.url().includes('dk_kyuryo_pw_set')) okutta++;
  });
  await page.fill('#hnPw', 'abcd');
  await page.fill('#hnPw2', 'abcd');
  await page.click('#hnGo');
  await expect(page.locator('#hnErr')).toContainText('数字 4桁');
  await page.fill('#hnPw', '123');
  await page.fill('#hnPw2', '123');
  await page.click('#hnGo');
  await expect(page.locator('#hnErr')).toContainText('数字 4桁');
  await page.fill('#hnPw', '1234');
  await page.fill('#hnPw2', '1235');
  await page.click('#hnGo');
  await expect(page.locator('#hnErr')).toContainText('違います');
  expect(okutta, '★形の 違う パスワードを 倉庫へ 送った★').toBe(0);
});

test('★② 2回目＝パスワードだけ（違えば 断る）★', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await nise(page, false);
  await expect(page.locator('#hnGo')).toHaveText('見る');
  await page.fill('#hnPw', 'chigau123');
  await page.click('#hnGo');
  await expect(page.locator('#hnErr')).toContainText('違います');
});

test('★③ 事務所の 物を 出さない／事務所の 読み込みを 呼ばない★', async ({ page }) => {
  // ★★2026-10-01 測り方を 変えた：札(style.display)でなく ★本当に 見えるか★★
  //   前は `btnPrint.style.display === 'none'` を 見ていた。
  //   だが ★親を 隠しても 子の style は 空のまま★ なので、
  //   「見えていない のに 赤」にも、「見えている のに 緑」にも なる。
  //   ＝[[見張りは 印(class)でなく 絵が 変わったか]]。★見えるかで 測る★。
  await page.setViewportSize({ width: 430, height: 900 });
  const kazoe = await nise(page, false);
  await page.fill('#hnPw', 'abcd1234');
  await page.click('#hnGo');
  await page.waitForTimeout(1200);
  for (const id of ['tabs', 'btnPrint', 'jimushoLinks', 'monthCard', 'paneEmp', 'paneSet'])
    await expect(page.locator('#' + id), '★本人に 見えています: #' + id + '★').toBeHidden();
  expect(kazoe.jimusho, '★事務所の 読み込みを 呼んでいます★').toBe(0);
});

test('★★★⑥ 本人の 画面に「他の人を 選べる」口が 1つも 無い★★★', async ({ page }) => {
  // ★司さん（2026-10-01）★
  //   「LINEで給料明細送った画面になんで赤丸のところが見えるんど
  //    個別で送ったんやけん人とか選べたらいかんやろが」
  //   実際に 本番の 画面で 出ていた：
  //     「PDFで 見る（給料表）」の #kamiCard
  //       → 「月ごと（全体）」「日ごと（全員）」「個別（選んだ人）」
  //   因：本人モードが ★隠す物の 名簿★ だったので、
  //      後から 足した カードが 名簿に 入らず 漏れた。
  //   直し：★出してよい 物だけ 出す（白名簿）★に したので
  //      ★新しい カードを 足しても 既定で 出ない★。
  await page.setViewportSize({ width: 430, height: 900 });
  await nise(page, false);
  await page.fill('#hnPw', 'abcd1234');
  await page.click('#hnGo');
  await page.waitForTimeout(1200);

  // ① 名指し：問題の カード
  await expect(page.locator('#kamiCard'), '★PDFの カードが 本人に 見えています★').toBeHidden();

  // ② 字：他人を 選べる 言葉が 1つも 見えていない
  const mieru = await page.evaluate(() => document.body.innerText || '');
  for (const w of ['全体', '全員', '選んだ人', '年ごと', '給料表'])
    expect(mieru.indexOf(w), '★本人に 見えています: ' + w + '★').toBe(-1);

  // ③ ★次に カードを 足しても 漏れない★
  //   明細の 置き場(#paneSlip)の 中で 見えていてよい のは #slips だけ
  const hoka = await page.evaluate(() => {
    const ps = document.getElementById('paneSlip');
    if (!ps) return ['paneSlip が 無い'];
    return Array.from(ps.children)
      .filter((el) => el.id !== 'slips' && el.offsetParent !== null)
      .map((el) => el.id || el.className || el.tagName);
  });
  expect(hoka, '★明細の 置き場に 他の 物が 見えています★').toEqual([]);

  // ④ ★何も 出ていないだけ の 緑に しない★
  await expect(page.locator('#slips')).toContainText(EMP.name);
});

test('★★④ 本人に 見せては いけない 物が 出ていない★★', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await nise(page, false);
  await page.fill('#hnPw', 'abcd1234');
  await page.click('#hnGo');
  await page.waitForTimeout(1200);
  // ★自分の 明細は 出ている（何も 出ていないだけの 緑に しない）★
  await expect(page.locator('#slips')).toContainText('給料明細');
  await expect(page.locator('#slips')).toContainText(EMP.name);
  const zenbu = await page.evaluate(() => document.body.innerText || '');
  for (const w of ['会社に残る分', 'つかさの取り分', 'みんなの給料', '売上合計']) {
    expect(zenbu.indexOf(w), '★本人に 見えています: ' + w + '★').toBe(-1);
  }
});

// ── 売上の 直し（dk_shift_edits.uriage_yen）2026-10-14 ─────────────────
//   ★わざと壊して 赤に なるのを 見た★：止める 前の kyuryo.html で 下の 2本とも 赤（明細が 出た）
test('本人の 関数が 古い（売上の 直しの 印が 無い）時は 明細を 出さない', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await nise(page, false, { uriageNaoshi: undefined });
  await page.fill('#hnPw', 'abcd1234');
  await page.click('#hnGo');
  await page.waitForTimeout(1200);
  await expect(page.locator('#slips')).toContainText('売上の 直しを 読めなかった');
});

// ★売上から 引く 物の 記録・設定は もう 使わない★ 2026-10-24 件J（入れた 実費は 全部 引く）
//   前（10-18）は 記録を 返さない（古い 倉庫の 関数）時に 止めた。倉庫の 関数は 変えない（返って きても 見ない）
//   ＝返って こなくても 明細を 出す
test('本人の 関数が 売上から 引く 物の 記録・設定を 返さなくても 明細を 出す', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await nise(page, false, { uriageRireki: undefined, salesSettings: undefined });
  await page.fill('#hnPw', 'abcd1234');
  await page.click('#hnGo');
  await page.waitForTimeout(1200);
  await expect(page.locator('#slips')).toContainText('給料明細');
  await expect(page.locator('#slips')).toContainText(EMP.name);
  await expect(page.locator('#slips')).not.toContainText('売上から 引く 物の 記録を 読めなかった');
});

// ★締めの 形の 記録を 返さない（古い 倉庫の 関数）★ 2026-10-19（列の 形で 黙って 区切らない）
//   わざと壊して 赤：kyuryo.html の Array.isArray(r.shimeRireki) の 止めを 外す ⇒ 赤（明細が 出た）
test('本人の 関数が 締めの 記録を 返さない 時は 明細を 出さない', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await nise(page, false, { shimeRireki: undefined });
  await page.fill('#hnPw', 'abcd1234');
  await page.click('#hnGo');
  await page.waitForTimeout(1200);
  await expect(page.locator('#slips')).toContainText(
    '締めの 記録を 読めなかったので 出せません。会社に 知らせてください。'
  );
});

// ★締めの 変え方で 空いた 月★ 2026-10-19（0円の 明細を 出さない・本人は 設定を 触れない＝会社に 知らせて）
//   わざと壊して 赤：kyuryo.html の 本人の kikanKowareta の 止めを 外す ⇒ 赤（空いた 月で 明細の 枠が 出た）
test('締めの 変え方で 空いた 月は 本人の 明細を 出さずに 訳', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await page.clock.setFixedTime(new Date('2026-10-07T12:00:00+09:00'));
  await nise(page, false, {
    settings: [
      Object.assign({}, SET, {
        period_end_mode: 'shime',
        period_shime: { kind: 'tsuki', hi: [20], nazuke: 'hajime' },
      }),
    ],
    shimeRireki: [
      {
        rireki_id: 'r1',
        company_id: 'c1',
        from_date: '2026-09-10',
        value: { kind: 'tsuki', hi: [1], nazuke: 'shime' },
      },
    ],
  });
  await page.fill('#hnPw', 'abcd1234');
  await page.click('#hnGo');
  await page.waitForTimeout(1200);
  // 今日（10/7）は 11月分（10/2〜11/1）→ 10月分 → 9月分（空いた 月）
  await page.click('#hnMae');
  await page.waitForTimeout(800);
  await page.click('#hnMae');
  await expect(page.locator('#slips')).toContainText(
    '締めの 変え方で この 月の 給料が 無くなっています。会社に 知らせてください。'
  );
});

test('売上の 直しが 読めない 業務が 在れば 本人の 明細を 出さない（事務所と 同じ 門）', async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  const t = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  await nise(page, false, {
    shifts: [
      {
        shift_id: 's1',
        device_id: 'd1',
        started_at: t + 'T03:00:00+00:00',
        fare_total_yen: 10000,
        elapsed_sec: 3600,
      },
    ],
    edits: [{ shift_id: 's1', uriage_yen: -5 }],
  });
  await page.fill('#hnPw', 'abcd1234');
  await page.click('#hnGo');
  await page.waitForTimeout(1200);
  await expect(page.locator('#slips')).toContainText('売上の 直しが 読めない');
});

// ★本人の 関数が 古い（変えた 記録 rireki を 返さない）時は 明細を 出さない★ 2026-10-18（何日から・対立役）
//   前の 列の 値で 出すと、事務所が 記録の 日から 新しい 歩合で 出す 額と ずれる
//   ★わざと壊して 赤★：kyuryo.html の RAW.rireki = Array.isArray(r.rireki) ? r.rireki : null を || [] に すると 明細が 出る
test('本人の 関数が 古い（変えた 記録を 返さない）時は 明細を 出さない', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  const t = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  await nise(page, false, {
    rireki: undefined,
    shifts: [
      {
        shift_id: 's1',
        device_id: 'd1',
        started_at: t + 'T03:00:00+00:00',
        fare_total_yen: 10000,
        elapsed_sec: 3600,
      },
    ],
    workHours: [{ work_date: t, employee_id: 'e1', device_id: 'd1', hours: 1 }],
  });
  await page.fill('#hnPw', 'abcd1234');
  await page.click('#hnGo');
  await page.waitForTimeout(1200);
  await expect(page.locator('#slips')).toContainText('変えた 記録を 読めませんでした');
});

// ============================================================
// ★★3回 続けて 間違えたら 止める・作り直しで 戻る★★ 2026-10-20（docs/pw-4keta.md）
//   司さん 10-19「3回 間違えたら」「新しく URL や QR コードを 作成し直す」・10-20「続けて 3回」
// ============================================================
async function verifyNoKotae(page, kotae) {
  await page.route('**/rest/v1/rpc/dk_kyuryo_{verify,fuda}', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(kotae) })
  );
}
// わざと壊す：verify の 返りで nokori を 見ない ⇒ 赤（「あと 2回」が 出ない）
test('違う 時は「あと N回 間違えると 止まります」', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await nise(page, false);
  await verifyNoKotae(page, { ok: false, reason: 'bad_pw', nokori: 2 });
  await page.fill('#hnPw', '0000');
  await page.click('#hnGo');
  await expect(page.locator('#hnErr')).toContainText('あと 2回 間違えると 止まります');
});
// わざと壊す：honninTomeru を 呼ばず err だけ ⇒ 赤（欄が 残って 打ち続けられる）
test('止まった 時は 訳だけ 出して 欄を 消す（会社に 作り直しを 頼む）', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await nise(page, false);
  await verifyNoKotae(page, { ok: false, reason: 'tomatta' });
  await page.fill('#hnPw', '0000');
  await page.click('#hnGo');
  await expect(page.locator('#slips')).toContainText('3回 続けて 間違えたので 止めました');
  await expect(page.locator('#hnPw')).toHaveCount(0);
});
test('作り直された リンク（no_token）は 新しい リンクを もらう 訳', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await nise(page, false);
  await verifyNoKotae(page, { ok: false, reason: 'no_token' });
  await page.fill('#hnPw', '1234');
  await page.click('#hnGo');
  await expect(page.locator('#slips')).toContainText('この リンクは 作り直されました');
  await expect(page.locator('#hnPw')).toHaveCount(0);
});
// わざと壊す：get の tomatta を 見ない ⇒ 赤（「出せませんでした」で 止まる 訳が 出ない）
test('明細を 取る 途中で 止まったら 訳を 出す', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await nise(page, false);
  await page.route('**/rest/v1/rpc/dk_kyuryo_get', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, reason: 'tomatta' }),
    })
  );
  await page.fill('#hnPw', 'abcd1234');
  await page.click('#hnGo');
  await expect(page.locator('#slips')).toContainText('3回 続けて 間違えたので 止めました');
});
// わざと壊す：already_set で 2回目の 画面へ 回さない ⇒ 赤（はじめての 画面の まま）
test('もう 決めた 人が 初回の リンクを 開き直したら 2回目の 画面へ', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await nise(page, true);
  await page.route('**/rest/v1/rpc/dk_kyuryo_pw_set', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, reason: 'already_set' }),
    })
  );
  await page.fill('#hnPw', '1234');
  await page.fill('#hnPw2', '1234');
  await page.click('#hnGo');
  await expect(page.locator('#hnGo')).toHaveText('見る');
  await expect(page.locator('#hnErr')).toContainText('もう パスワードを 決めてあります');
  await expect(page.locator('#hnPw2')).toHaveCount(0);
});
// ★★もう 決めた 人が ホーム画面（c= 付きの リンク）から 開いたら、最初から「入れる」画面★★ 2026-10-21 司さん
//   わざと壊す：honninStart の 探り（p_pw:null の pw_set）を 外す ⇒ 赤（「はじめての 方」が 出る）
test('もう 決めた 人が c= 付きの リンクを 開いたら 最初から 入れる 画面（決める 画面を 出さない）', async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  let saguri = 0;
  let kaita = 0;
  await page.route('**/rest/v1/rpc/dk_kyuryo_pw_set', (r) => {
    const b = JSON.parse(r.request().postData() || '{}');
    // ★鍵ごと 省かず null で 送る★（省くと 引数 2つの 関数を 探して 落ちる）
    if ('p_pw' in b && b.p_pw === null) saguri++;
    else kaita++;
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, reason: 'already_set' }),
    });
  });
  await page.route('**/rest/v1/rpc/dk_kyuryo_{verify,fuda}', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"ok":false,"reason":"bad_pw"}',
    })
  );
  await page.goto('/kyuryo.html?t=TOK&c=INIT12345');
  await expect(page.locator('#hnGo')).toHaveText('見る');
  await expect(page.locator('#slips')).not.toContainText('はじめての 方');
  await expect(page.locator('#hnPw2')).toHaveCount(0);
  await expect(page.locator('#hnErr')).toBeHidden();
  expect(saguri, '開いた 時に 1回だけ 訊く').toBe(1);
  expect(kaita, '決める 方の 呼び出しは 0').toBe(0);
});
// 作り直された リンクを ホーム画面から 開いたら、決める 画面を 出さずに 新しい リンクを もらう 訳
test('作り直された c= 付きの リンクは 開いた 時に 新しい リンクを もらう 訳', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await page.route('**/rest/v1/rpc/dk_kyuryo_pw_set', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"ok":false,"reason":"no_token"}',
    })
  );
  await page.goto('/kyuryo.html?t=TOK&c=INIT12345');
  await expect(page.locator('#slips')).toContainText('この リンクは 作り直されました');
  await expect(page.locator('#hnGo')).toHaveCount(0);
});
// 電波が 弱くて 探りが 返らない 時は 5秒で 打ち切って 今までの「はじめて」の 画面（欄が 出ないまま に しない）
//   わざと壊す：打ち切りの 時計を 外す ⇒ 赤（読み込み中の まま）
test('開いた 時の 探りが 返らない 時は 5秒で はじめての 画面', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await page.route('**/rest/v1/rpc/dk_kyuryo_pw_set', () => {
    /* 返さない（固まった 通信） */
  });
  await page.goto('/kyuryo.html?t=TOK&c=INIT12345');
  await expect(page.locator('#slips')).toContainText('読み込み中');
  await expect(page.locator('#hnGo')).toHaveText('パスワードを 決める', { timeout: 8000 });
});
// 打ち切った 後に 遅れて 答えが 来ても 描き直さない（打っている 途中の 欄が 消えない）
//   わざと壊す：答えの 側の「if (kaetta) return;」を 外す ⇒ 赤（遅れた no_token で 作り直しの 訳に 替わる）
test('打ち切った 後に 遅れて 来た 探りの 答えでは 描き直さない', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await page.route('**/rest/v1/rpc/dk_kyuryo_pw_set', async (r) => {
    await new Promise((res) => setTimeout(res, 6500));
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"ok":false,"reason":"no_token"}',
    });
  });
  await page.goto('/kyuryo.html?t=TOK&c=INIT12345');
  await expect(page.locator('#hnGo')).toHaveText('パスワードを 決める', { timeout: 8000 });
  await page.waitForTimeout(3000); // 遅れた 答え（6.5秒）が 届いた 後まで 待つ
  await expect(page.locator('#hnGo')).toHaveText('パスワードを 決める');
  await expect(page.locator('#slips')).not.toContainText('この リンクは 作り直されました');
});
// 全角の 数字は 半角に 直して 送る（決める・入れる 両方で 同じ）
test('全角の 数字で 決めても 半角で 送る', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await nise(page, true);
  let okutta = null;
  await page.route('**/rest/v1/rpc/dk_kyuryo_pw_set', (r) => {
    okutta = JSON.parse(r.request().postData() || '{}').p_pw;
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.fill('#hnPw', '１２３４');
  await page.fill('#hnPw2', '１２３４');
  await page.click('#hnGo');
  await expect.poll(() => okutta).toBe('1234');
});
