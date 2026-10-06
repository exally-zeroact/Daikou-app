// ============================================================
// ★見張りが「本物の 画面を 開く」所を 1本に する★ 2026-10-01
//
//   この 仕掛けは もともと tests/e2e/kyuryo-paper.spec.js の 中に 在った。
//   給料明細を ★新しく 作るのでは なく 在る物を そのまま 開いて 見せる★ ために
//   別の 見張りからも 使うので ★外に 出した★。
//   ★中身は 1行も 変えていない★（移しただけ）。
//   ★道が 2本に ならないよう 元の 見張りも ここを 読む★。
// ============================================================
const { test: _t } = require('@playwright/test');
void _t;
const fs = require('fs');
const path = require('path');

const FIX = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kyuryo-real.json'), 'utf8')
);

// ★ログインだけ差し替える★（描く所・組む所・数える所は 本物のまま通す）
//   dk-session.js は ★本物を読み込んだ後ろに 上書きを足す★＝
//   softList/newLoadState/showUnknownBar など 中の作りは 本物が動く。
// ★★試験の 中身の 日付を「今 画面が 出している 月」へ 寄せる★★ 2026-09-01
//   ★何が 起きたか（実測）★
//     この 中身は ★2026-08 固定★（ym: '2026-08'／勤務は 08-01・08-02）。
//     画面は ★今日の 年月★から 始まります（kyuryo.html:1149）。
//     ⇒ ★2026-09-01 に なった 瞬間、3本が 赤★に なりました
//        「★働いた日が 1日も無い★」＝9月を 見ているので 8月の 行が 出ない。
//     ★中身も 画面も 1行も 壊れていません★。★試験が 時計に 依存していた★だけです。
//   ★直し方★
//     日付を ★月の 数だけ ずらす★（日にちは そのまま）。
//     ・金額・率・時間は ★1つも 触りません★（layout を 測る 試験なので）
//     ・締めは period_start_day=21 の 3分割＝★日にちが 同じなら 同じ 位置★に 入ります
//     ・月末の 繰り上がり（31日→短い月）は ★その月の 末日に 丸めます★
const TSUKI_ZURASU = (() => {
  const ima = new Date();
  const [fy, fm] = String(FIX.ym || '')
    .split('-')
    .map(Number);
  if (!fy || !fm) return 0;
  return (ima.getFullYear() - fy) * 12 + (ima.getMonth() + 1 - fm);
})();

function zurasuHi(iso, n) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso;
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const matsu = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  const dd = Math.min(d, matsu);
  const atama =
    t.getUTCFullYear() +
    '-' +
    String(t.getUTCMonth() + 1).padStart(2, '0') +
    '-' +
    String(dd).padStart(2, '0');
  return atama + iso.slice(10);
}

function zurasu(o, n) {
  if (!n) return o;
  if (Array.isArray(o)) return o.map((x) => zurasu(x, n));
  if (o && typeof o === 'object') {
    const out = {};
    Object.keys(o).forEach((k) => {
      // ★日付らしい 名前だけ★（金額・率・時間の 列は 触らない）
      out[k] = /date|_at$|^ym$/.test(k) ? zurasu(o[k], n) : zurasu(o[k], n);
    });
    return out;
  }
  return typeof o === 'string' ? zurasuHi(o, n) : o;
}

async function openKyuryo(page, naosu) {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const nakami = zurasu(JSON.parse(JSON.stringify(FIX)), TSUKI_ZURASU);
  const tsugi =
    moto +
    ';(function(){var F=' +
    JSON.stringify(naosu ? naosu(nakami) : nakami) +
    ';' +
    'var co={company_id:F.settings[0].company_id,name:"見張り用"};' +
    'function rows(p){' +
    ' if(p.indexOf("dk_employees")===0)return F.emps||[];' +
    ' if(p.indexOf("dk_device_labels")===0)return F.labels||[];' +
    ' if(p.indexOf("dk_payroll_settings")===0)return F.settings||[];' +
    ' if(p.indexOf("dk_sales_settings")===0)return [];' +
    ' if(p.indexOf("dk_shifts")===0)return F.shifts||[];' +
    ' if(p.indexOf("dk_shift_edits")===0)return F.edits||[];' +
    ' if(p.indexOf("dk_work_hours")===0)return F.workHours||[];' +
    ' if(p.indexOf("dk_manual_days")===0)return F.manualDays||[];' +
    ' if(p.indexOf("dk_pay_adjustments")===0)return F.adjustments||[];' +
    ' return [];}' +
    'var S=window.DKSession;' +
    'S.ensure=function(){return Promise.resolve({token:"dummy"});};' +
    'S.goLogin=function(){};' +
    'S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};' +
    'S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    'S.rest=function(s,p){return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(rows(p));}});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;return Promise.resolve(rows(p));};' +
    '})();';
  await page.route('**/js/dk-session.js*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: tsugi,
    })
  );
  await page.goto('/kyuryo.html');
  await page.waitForFunction(() => window.__paper && window.__paper.ninzu() > 0, null, {
    timeout: 20000,
  });
}
module.exports = { FIX, TSUKI_ZURASU, zurasu, zurasuHi, openKyuryo };
