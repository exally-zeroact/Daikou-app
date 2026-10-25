// ============================================================
// ★入力の 画面（nyuryoku.html）と 給料の 画面を 同じ 作り物の 倉庫で 開く★ 2026-10-23
//
//   時数・乗った人を 入力の 画面へ 移した（司さん 10-23）ので、
//   「入力で 打つ → 倉庫に 入る → 給料の 明細が その 行で 計算する」を 1本で 通す 為の 仕掛け。
//   倉庫は 頁の 中の 1つの 入れ物（window.__F）。POST（on_conflict）は 重ねて 入れ、DELETE は 消す。
//   読みは 本物と 同じく eq / gte / lt / lte で 絞り、select= の 列だけ 返す。
//   ★本物の DKSession を 読んだ 後ろに 上書きを 足す★（softList・newLoadState などの 中身は 本物が 動く）
// ============================================================
const fs = require('fs');
const path = require('path');

const F0 = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kyuryo-real.json'), 'utf8')
);
const CO = F0.settings[0].company_id;
const CAR1 = '00000000-0000-4000-9000-000000000001';
const CAR2 = '00000000-0000-4000-9000-000000000002';
const TARO = 'ec8d275b-38c0-4d9f-b471-eeb10226a6a9';
const JIRO = '46a60d53-02b7-47ef-829e-6fd03cee1a31';
const SABURO = 'd5d0c7da-4b13-455a-92e4-462137f4424c';
const S1 = '00000000-0000-4000-a000-000000000001';
const S9 = '00000000-0000-4000-a000-000000000009';

// 8/1 は 乗った人を 空に し、1号車に 2回目の 業務（1時間・1,000円）を 足す
//   ＝今の 給料の「時数を入れる」で 同じ 入力を した 時の 額を 測った 材料（下の KIJUN）
function zairyou(tweak) {
  const F = JSON.parse(JSON.stringify(F0));
  F.workHours = F.workHours.filter((w) => w.work_date !== '2026-08-01');
  F.shifts.push({
    shift_id: S9,
    device_id: CAR1,
    started_at: '2026-08-01 05:00:00+00',
    ended_at: '2026-08-01 06:00:00+00',
    elapsed_sec: 3600,
    fare_total_yen: 1000,
    trip_count: 1,
  });
  // 本物の 業務の 行は 会社を 持つ（画面は 会社で 絞って 読む）
  F.shifts.forEach((x) => (x.company_id = CO));
  F.edits = F.edits || [];
  F.manualDays = (F.manualDays || []).filter((m) => m.company_id === CO);
  if (tweak) tweak(F);
  F.shifts.forEach((x) => (x.company_id = x.company_id || CO));
  return F;
}

const TABLE = {
  dk_employees: 'emps',
  dk_device_labels: 'labels',
  dk_payroll_settings: 'settings',
  dk_shifts: 'shifts',
  dk_shift_edits: 'edits',
  dk_work_hours: 'workHours',
  dk_manual_days: 'manualDays',
  dk_pay_adjustments: 'adjustments',
};

// 頁の 中で 動く 作り物（文字に して 本物の dk-session.js の 後ろに 足す）
function soukoJs(F, o) {
  const opt = o || {};
  return (
    ';(function(){var F=' +
    JSON.stringify(F) +
    ';var T=' +
    JSON.stringify(TABLE) +
    ';var OPT=' +
    JSON.stringify(opt) +
    ';var co={company_id:' +
    JSON.stringify(CO) +
    ',name:"作り物代行"};window.__F=F;window.__calls=[];' +
    'function tb(p){var t=String(p).split("?")[0];return T[t]?t:null;}' +
    'function prm(p){var q=String(p).split("?")[1]||"";return q.split("&").filter(Boolean).map(function(x){var i=x.indexOf("=");return [decodeURIComponent(x.slice(0,i)),decodeURIComponent(x.slice(i+1))];});}' +
    'function tm(x){return Date.parse(String(x).replace(" ","T").replace(/([+-][0-9][0-9])$/,"$1:00"));}' +
    'function cmpv(a,b,k){if(k==="started_at"){return tm(a)-tm(b);}a=String(a==null?"":a);b=String(b);return a<b?-1:a>b?1:0;}' +
    'function hit(r,ps){return ps.every(function(kv){var k=kv[0],v=kv[1];if(["select","order","limit","offset","on_conflict"].indexOf(k)>=0)return true;var i=v.indexOf(".");var op=v.slice(0,i),val=v.slice(i+1);' +
    'if(op==="eq")return String(r[k]==null?"":r[k]).slice(0,val.length===10&&/date/.test(k)?10:undefined)===val;if(op==="gte")return cmpv(r[k],val,k)>=0;if(op==="lt")return cmpv(r[k],val,k)<0;if(op==="lte")return cmpv(r[k],val,k)<=0;' +
    'if(op==="not"&&val==="is.true")return r[k]!==true;return true;});}' +
    // 会社の 壁（本物の 倉庫の RLS と 同じ＝別の 会社の 行は 見えない）
    'function rows(p){var t=tb(p);if(!t)return [];var ps=prm(p);var a=(F[T[t]]||[]).filter(function(r){return (!r.company_id||r.company_id===co.company_id)&&hit(r,ps);});' +
    'var sel=ps.filter(function(x){return x[0]==="select";})[0];if(sel&&sel[1]!=="*"){var c=sel[1].split(",");a=a.map(function(r){var o={};c.forEach(function(k){if(k in r)o[k]=r[k];});return o;});}' +
    'return JSON.parse(JSON.stringify(a));}' +
    'function kaku(p,o){var t=tb(p);var m=o.method;var ps=prm(p);if(!t)return;var arr=F[T[t]]=F[T[t]]||[];' +
    'if(m==="DELETE"){F[T[t]]=arr.filter(function(r){return !hit(r,ps);});return;}' +
    'var b=JSON.parse(o.body);var oc=(ps.filter(function(x){return x[0]==="on_conflict";})[0]||[0,""])[1].split(",").filter(Boolean);' +
    'var f=null;arr.forEach(function(r){if(oc.length&&oc.every(function(k){return String(r[k])===String(b[k]);}))f=r;});' +
    'if(f)Object.assign(f,b);else arr.push(b);}' +
    'var S=window.DKSession;if(!S){window.__dameSession=1;return;}' +
    'S.ensure=function(){return Promise.resolve({access_token:"t"});};S.goLogin=function(){};S.logout=function(){};' +
    'S.rememberedCompanyId=function(){return co.company_id;};S.pickCompany=function(){return {mode:"one",company:co};};' +
    'S.myCompanies=function(){return Promise.resolve({ok:true,json:function(){return Promise.resolve([co]);}});};' +
    // OPT.osoi＝{表の 頭: ミリ秒}（その 書き込みの 返事を 遅らせる）／OPT.dame＝[表の 頭]（その 書き込みを 断る）
    'function henji(ok,st,j){return {ok:ok,status:st,text:function(){return Promise.resolve("");},json:function(){return Promise.resolve(j);}};}' +
    // OPT.yomiDame＝[道の 頭]（その 読みを 500 で 断る＝通信で 読めない 形）2026-10-25
    //   OPT.yomiSt＝その 断り方（数＝その status で 返す・"throw"＝通信が 切れて fetch が 投げる 形）
    'S.rest=function(s,p,o){var m=(o&&o.method)||"GET";if(m==="GET"&&(OPT.yomiDame||[]).some(function(x){return String(p).indexOf(x)===0;})){if(OPT.yomiSt==="throw")return Promise.reject(new Error("Failed to fetch"));return Promise.resolve(henji(false,OPT.yomiSt||500,{}));}if(m==="GET")return Promise.resolve(henji(true,200,rows(p)));' +
    'window.__calls.push({p:p,m:m,b:o&&o.body?JSON.parse(o.body):null});var t=tb(p)||"";' +
    'var dame=(OPT.dame||[]).indexOf(t)>=0;var ms=(OPT.osoi||{})[t]||0;' +
    'return new Promise(function(ok){setTimeout(function(){if(dame){ok(henji(false,500,{}));return;}kaku(p,o);ok(henji(true,201,[]));},ms);});};' +
    'S.softList=function(s,p,st){if(st)st.tried++;if((OPT.yomenai||[]).indexOf(tb(p))>=0){if(st)st.failed++;return Promise.resolve([]);}return Promise.resolve(rows(p));};' +
    '})();'
  );
}

async function sessWoKaeru(page, F, o) {
  const moto = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'dk-session.js'), 'utf8');
  const body = moto + soukoJs(F, o);
  await page.route('**/js/dk-session.js*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: body })
  );
  await page.route('**/auth/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1"}' })
  );
}

// 入力の 画面を その 日で 開く（日本の 2026-08-05 12時に 時計を 止める）
async function nyuryokuWoHiraku(page, F, hi, o) {
  await sessWoKaeru(page, F, o);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.clock.setFixedTime(new Date('2026-08-05T03:00:00Z'));
  await page.goto('/nyuryoku.html?hi=' + hi, { waitUntil: 'domcontentloaded' });
  // 読み終わる まで 待つ（o.tomeOk＝止めの 字が 出たまま の 道を 見る 時）
  await page.waitForFunction(
    (tomeOk) =>
      document.querySelectorAll('#shaList .sha[data-car]').length > 0 &&
      (tomeOk
        ? !/読み込み中/.test((document.getElementById('tomeJi') || {}).textContent || '')
        : !document.getElementById('tomeJi')),
    !!(o && o.tomeOk),
    { timeout: 15000 }
  );
}

function kuruma(page, dev) {
  return page.locator('#shaList .sha[data-car="' + dev + '"]');
}
// ★開いてから 打つ★（畳んで いる 車は 名前を 押して 開く）
async function akeru(page, dev) {
  const k = kuruma(page, dev);
  if (!(await k.locator('.sha-atama[data-akeru]').count())) return k; // 畳まない 形（畳む 前の 版）
  if (!/\baku\b/.test((await k.getAttribute('class')) || '')) await k.locator('.sha-atama').click();
  await page.waitForFunction((d) => {
    const el = document.querySelector('#shaList .sha[data-car="' + d + '"]');
    return el && el.classList.contains('aku');
  }, dev);
  return k;
}
// 打って 欄を 離れる（change）＝保存が 走る
async function utsu(loc, v) {
  await loc.fill(v);
  await loc.blur();
}
// 書き込みの 返事を 全部 待つ（順番待ちの 数が 0）
async function machi(page) {
  await page.waitForTimeout(500);
}

// 給料の 画面を 同じ 倉庫で 開き、8月 1〜10日の 明細の 額を 読む
async function kyuryoNoGaku(page, F) {
  await sessWoKaeru(page, F);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.clock.setFixedTime(new Date('2026-08-05T03:00:00Z'));
  await page.goto('/kyuryo.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__paper && window.__paper.ninzu() > 0, null, {
    timeout: 20000,
  });
  return page.evaluate(() => {
    const P = window.__paper;
    const r = {};
    for (let i = 0; i < P.ninzu(); i++) {
      const e = P.emp(i);
      r[e.employee_id] = { totalPay: e.totalPay, totalHours: e.totalHours };
    }
    return r;
  });
}

module.exports = {
  F0,
  CO,
  CAR1,
  CAR2,
  TARO,
  JIRO,
  SABURO,
  S1,
  S9,
  zairyou,
  sessWoKaeru,
  nyuryokuWoHiraku,
  kuruma,
  akeru,
  utsu,
  machi,
  kyuryoNoGaku,
};
