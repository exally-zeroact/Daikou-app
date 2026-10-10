'use strict';
// ============================================================
// ★tests/ の下の 記録になりうるファイルの白名簿の門★ 2026-10-10
//
//   公開 repo の tests/fixtures に 実機の走りの記録（GPS）が入っていて、
//   家のそばの点や 客の乗り降りの場所が 誰でも取れた（配信からは .vercelignore で外した）。
//   今ある実機の記録22本は 試験の真値の材料なので 残すが、★これから先は 足させない★。
//
//   見る範囲：tests/fixtures の全部と、tests/ の下の json・jsonl・gpx・csv・geojson・kml・nmea
//   名簿 = tests/fixtures-shiromeibo.json（名前・git の中身の sha256・種類）
//     ・名簿に無いファイルが足された → 赤
//     ・名簿の sha256 と中身が違う → 赤
//     ・★凍結（実機の走りの記録・実物の給与の数）は 下の FROZEN に 名前と sha256 を焼いてある★
//       ＝名簿の json を書き換えても 足せない・差し替えられない（消すのはよい）
//     ・新しく足せるのは「合成」「公」だけ
//     ・「合成（中身は道具が更新）」は osm-update 等が書き換えるので 名前だけで縛る
//   新しい実機の記録は repo の外（tests/lib/trace-zairyou.js の DK_TRACE_DIR の先例）に置き、手元で走らせる。
//
//   sha256 は 作業木でなく git の中身（blob）から取る＝Windows の改行の変換で ずれない。
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const MEIBO = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tests', 'fixtures-shiromeibo.json'), 'utf8')
);
const KINDS = new Set([
  '実機（凍結）',
  '実物の数（凍結）',
  '合成',
  '公',
  '合成（中身は道具が更新）',
]);
const DATA = /\.(json|jsonl|gpx|csv|geojson|kml|nmea)$/i;
const SELF = 'tests/fixtures-shiromeibo.json';

// 2026-10-10 に凍結した物（名前 → git の中身の sha256）。ここに無い名前を凍結の種類で足すのは 赤
const FROZEN = {
  'tests/fixtures/0606-Android.slim.json':
    '78880866cdd3b9b3039f4b11ddf41e24ec80a118cd9feda395a8fea43e031623',
  'tests/fixtures/0606-iPhone13.slim.json':
    '83e685349a0ba57e00661e25de3fc45264eb83b167f7589703e7b314c6acf4e6',
  'tests/fixtures/0606-iPhoneSE.slim.json':
    '3e81d020c26f961444c729a64d6267da01b227adedd6861eef7682e66c2d8eb6',
  'tests/fixtures/0610-Android.json':
    '15ad981ef0a4399f18a7da7bf8703dd3adb581225e2f986f066a9c375e49cd8a',
  'tests/fixtures/0610-iPhone13.json':
    'a98dde76ca0e7c8d23af5aa098886d9dd7fbd26e810492346f522ab98bfd0741',
  'tests/fixtures/0610-iPhoneSE.json':
    'fccaef4e56fe729c41043bd3a8b88684bf3ce410307e146826256d96dec5e660',
  'tests/fixtures/0610b-Android.json':
    'e05250a54df4d6842d424230f9d4430ab91f47cb9b9f8e7498f26ba28d364018',
  'tests/fixtures/daiko-month-jan2026.json':
    'fdfc4edb9bd2cf5e1be021757d958f61308ab5d52a2b71497bbc124891bc5bfc',
  'tests/fixtures/daiko-payroll-jan2026.json':
    '2b624ef8e07f9d924896b35dbc021b804c6d644de468165aa725eaa5117dec0f',
  'tests/fixtures/real-trace-iphone13-8.39km-tire.json':
    '539b0881d1cd7ccfd23695b7d6475d2e89ffee1b7547532f8528af80d9061580',
  'tests/fixtures/real-trace-iphone13-親-16min.json':
    '6beb728d41742b6b601de2993c0bb9e5533e1678dd037f479bfd05fea4d1d212',
  'tests/fixtures/real-trace-iphone13-親-7min-after-38ed5e46.json':
    'eb3c3f43e719caabf9d1717f90dc4e58a70c6f40a2f03ce02b1917cfda46fd41',
  'tests/fixtures/real-trace-iphoneSE-5km-tire5.0.json':
    'cde418a9f5faab44d242664bcc414b9469b08fe9cb14ed38d8a96356aa2ae86f',
  'tests/fixtures/realdevice-android.json':
    'f421337f0898c8ea3cdfbc9df2227bde6c086ab75345fd359d4cc3ba1c2d8176',
  'tests/fixtures/realdevice-iphone13-noisy.json':
    'e27951f8f01d0cb1f4592868ede81bd7f51f4520c5a0643d446129f83c95f775',
  'tests/fixtures/realdevice-iphonese.json':
    'd494035c49ff607777c16ffe020059955ddaa4e70003ef4d4d694fd17f6f2a20',
  'tests/fixtures/realtest3-Android.slim.json':
    '8165027260171112673d23e62592d29e3f13bad178612c048e5c807fa48a776b',
  'tests/fixtures/realtest3-iPhoneSE.slim.json':
    '766ab260d79d9437da72fa1cc8cb67719ce29793a20adb6c67f07f86d751f462',
  'tests/fixtures/realtrace-0609-Android-OBD.json':
    'f90a8260fcd73f84955a67ab14282346d5c7dc9c54e37fadccf296de3af6d208',
  'tests/fixtures/realtrace-0617-daiko-dm.json':
    'd5f00db3580b6a302d4da5e76c0e08f32d70d2ef98322498da8872fb733a7dc5',
  'tests/fixtures/realtrace-0618-shimanami-obd.json':
    '124a670d4ec04946f5e08c7fead73b68e424e5adab14310bf384c4ba6e594e86',
  'tests/fixtures/shimanami-Android.slim.json':
    '32e69db563b0f028ab80d5ce28ccc6dd28b9f770eff9dacdf8273888bf62019f',
  'tests/fixtures/shimanami-iPhone13.slim.json':
    '2823b84a6d58474554c30a4fd468313699358b9b8917bd9b8dc644bf811b6f2e',
  'tests/fixtures/shimanami-iPhoneSE.slim.json':
    '29f7f0b1c3f3d025e26800f3785e8d8251a800e3ff38f6d61c6dc8067528c1ae',
};

export function mieruka(p) {
  return p !== SELF && (p.startsWith('tests/fixtures/') || DATA.test(p));
}

// git が追っている 見る範囲の 名前 → sha256（git の中身から）
function oiteAru() {
  const out = execFileSync('git', ['-C', ROOT, 'ls-files', '-s', '-z', 'tests'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const m = new Map();
  for (const rec of out.split('\0').filter(Boolean)) {
    const [meta, p] = rec.split('\t');
    if (!mieruka(p)) continue;
    const oid = meta.split(' ')[1];
    const buf = execFileSync('git', ['-C', ROOT, 'cat-file', 'blob', oid], {
      maxBuffer: 256 * 1024 * 1024,
    });
    m.set(p, crypto.createHash('sha256').update(buf).digest('hex'));
  }
  return m;
}

export function terasu(aru, meibo, frozen = FROZEN) {
  const bad = [];
  for (const [name, sha] of aru) {
    const it = meibo[name];
    if (!it) bad.push(`名簿に無い: ${name}`);
    else if (it.kind !== '合成（中身は道具が更新）' && it.sha256 !== sha)
      bad.push(`中身が名簿と違う: ${name}`);
    if (it && it.kind.endsWith('（凍結）') && frozen[name] !== sha)
      bad.push(`凍結の物の中身が違う: ${name}`);
  }
  for (const [name, it] of Object.entries(meibo)) {
    if (!KINDS.has(it.kind)) bad.push(`種類が読めない: ${name}`);
    if (it.kind.endsWith('（凍結）') && !frozen[name])
      bad.push(`新しい凍結の物（実機の記録など）: ${name}`);
    if (!aru.has(name)) bad.push(`名簿にだけ在る（消したら名簿からも消す）: ${name}`);
  }
  return bad;
}

describe('★tests/ の白名簿★', () => {
  const aru = oiteAru();

  it('★見る相手が 本当に居る★（git が読めずに 0本で緑にならない）', () => {
    expect(aru.size).toBeGreaterThan(30);
  });

  it('★名簿と 名前・中身が 全部 合う★', () => {
    expect(terasu(aru, MEIBO.items)).toEqual([]);
  });

  it('凍結の物は 焼いた表を超えない', () => {
    const n = Object.values(MEIBO.items).filter((i) => i.kind.endsWith('（凍結）')).length;
    expect(n).toBeLessThanOrEqual(Object.keys(FROZEN).length);
  });
});

describe('★門の歯（わざと壊して 赤になる）★', () => {
  const fz = { 'tests/fixtures/real-a.json': 'r1' };
  const aru = new Map([
    ['tests/fixtures/real-a.json', 'r1'],
    ['tests/fixtures/synthetic-b.jsonl', 'x2'],
    ['tests/replay-mm-worker/fixtures/c.json', 'y1'],
  ]);
  const ok = {
    'tests/fixtures/real-a.json': { sha256: 'r1', kind: '実機（凍結）' },
    'tests/fixtures/synthetic-b.jsonl': { sha256: 'x2', kind: '合成' },
    'tests/replay-mm-worker/fixtures/c.json': { kind: '合成（中身は道具が更新）' },
  };

  it('合う時は 何も出ない', () => {
    expect(terasu(aru, ok, fz)).toEqual([]);
  });

  it('★名簿に無いファイルを足すと 赤★（tests/fixtures の外でも）', () => {
    const a2 = new Map(aru).set('tests/elsewhere/new-trace.json', 'x3');
    expect(terasu(a2, ok, fz)).toContain('名簿に無い: tests/elsewhere/new-trace.json');
    expect(mieruka('tests/elsewhere/new-trace.json')).toBe(true);
    expect(mieruka('tests/elsewhere/x.gpx')).toBe(true);
  });

  it('★名前はそのまま 中身を差し替えると 赤★', () => {
    const a2 = new Map(aru).set('tests/fixtures/synthetic-b.jsonl', 'zz');
    expect(terasu(a2, ok, fz)).toContain('中身が名簿と違う: tests/fixtures/synthetic-b.jsonl');
  });

  it('★凍結の物は 名簿の sha256 も一緒に書き換えても 赤★', () => {
    const a2 = new Map(aru).set('tests/fixtures/real-a.json', 'new');
    const m2 = { ...ok, 'tests/fixtures/real-a.json': { sha256: 'new', kind: '実機（凍結）' } };
    expect(terasu(a2, m2, fz)).toContain('凍結の物の中身が違う: tests/fixtures/real-a.json');
  });

  it('★新しい実機の記録を 名簿に「実機」で足しても 赤★', () => {
    const a2 = new Map(aru).set('tests/fixtures/realtrace-1231.json', 'x4');
    const m2 = {
      ...ok,
      'tests/fixtures/realtrace-1231.json': { sha256: 'x4', kind: '実機（凍結）' },
    };
    expect(terasu(a2, m2, fz)).toContain(
      '新しい凍結の物（実機の記録など）: tests/fixtures/realtrace-1231.json'
    );
  });

  it('道具が書き換える物は 中身が変わっても 緑（名前だけ縛る）', () => {
    const a2 = new Map(aru).set('tests/replay-mm-worker/fixtures/c.json', 'y2');
    expect(terasu(a2, ok, fz)).toEqual([]);
  });

  it('名簿にだけ在る名前は 赤（名簿を古いまま残さない）', () => {
    const m2 = { ...ok, 'tests/fixtures/gone.json': { sha256: 'x9', kind: '合成' } };
    expect(terasu(aru, m2, fz)).toContain(
      '名簿にだけ在る（消したら名簿からも消す）: tests/fixtures/gone.json'
    );
  });
});
