// ============================================================
// ★★事務所が 読む 物が 実配信で 本当に 引けるか★★ 2026-09-05
//
//   ★なぜ 作ったか（私が 踏んだ）★
//     ・2026-08-31 に ★事務所の 配信は 別repo（daikome-jimusho-host）に 分けた★
//     ・その後 私は ★Daikou-app の office-host/vercel.json★ を 2回 直した
//       ⇒ ★そこは もう 使われていない★（repo に 残っている 写し）
//       ⇒ ★本物の 名簿に 無いので 本番で HTTP 404★
//       ⇒ ★画面は 動くのに 下の 帯だけ 出ない★＝「入った」が「使える」に なっていない
//     ・repo の 中を いくら 見ても 気づけない
//       ⇒ ★実配信を 直に 叩いて 数える★のが 唯一の 確かめ方
//
//   ★★わざと壊して 赤に なる事を 見た（2026-09-05 実測）★★
//     ①名簿に 無い js を 見に行く（js/aru-hazu-ga-nai.js）… ★赤★（404 が 出る）
//     ②数える 本数を 0 に する ……………………………… ★赤★（「1本も 見ていません」）
//     ★本物の 直しでも 確かめた★
//       名簿に 足す 前 … jimusho-footer.js が ★404★
//       足した 後 …………………………………… ★200★（25本 全部 200）
// ============================================================
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

// ★どちらの 事務所を 見るか★（テスト線の repo なら テスト線の 事務所）
function jimusho() {
  const cfg = fs.readFileSync(path.join(ROOT, 'js', 'dk-config.js'), 'utf8');
  return cfg.indexOf('khawdrnvssdenumbiwfg') >= 0
    ? 'https://daikome-jimusho-test.vercel.app'
    : 'https://daikome-jimusho.vercel.app';
}

// ★事務所の 画面が 読み込む 物を 機械で 集める★（手書きの 名簿を 作らない）
function yomikomu() {
  const gamen = ['dashboard.html', 'kyuryo.html', 'uriage.html', 'shukei.html', 'ryokinhyou.html'];
  const dete = {};
  // ★飛ばす書き方は しない★（無い物を 黙って 通すと 見張りが 嘘に なる）
  const aru = gamen.filter((g) => fs.existsSync(path.join(ROOT, g)));
  aru.forEach((g) => {
    const p = path.join(ROOT, g);
    const s = fs.readFileSync(p, 'utf8');
    (s.match(/(?:src|href)="((?:js|vendor)\/[^"]+)"/g) || []).forEach((m) => {
      const u = m.replace(/.*"(.*)"/, '$1');
      if (!dete[u]) dete[u] = [];
      dete[u].push(g);
    });
  });
  return dete;
}

test('★事務所が 読む 物が 実配信で 全部 引ける★', async ({ request }) => {
  test.setTimeout(120000);
  const base = jimusho();
  const dete = yomikomu();
  const mono = Object.keys(dete).sort();
  // eslint-disable-next-line no-console
  console.log('★見る 先★ ' + base + ' ／ ★読み込む 物 ' + mono.length + '本★');
  // ★0本を 見て 緑に しない★
  expect(mono.length, '★読み込む 物を 1本も 見つけられていません★').toBeGreaterThan(5);

  const warui = [];
  for (const u of mono) {
    const r = await request.get(base + '/' + u, { failOnStatusCode: false });
    if (r.status() !== 200)
      warui.push(u + ' … HTTP ' + r.status() + '（' + dete[u].join('・') + ' が 読む）');
  }
  // eslint-disable-next-line no-console
  console.log('★200で ない 物 … ' + warui.length + '本★ ' + JSON.stringify(warui));
  expect(
    warui,
    '★事務所の 配信の 名簿（daikome-jimusho-host repo）に 足りない 物が あります★'
  ).toEqual([]);
});
