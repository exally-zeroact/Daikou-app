// tests/unit/obd-tsunagi-joutai.test.js
// ★OBD の 繋ぎの 状態機械（線＝sen）の 試験★ 2026-11-08（司さん「めちゃくちゃの構造やないかぼけ・ちゃんとやれや」）
//   設計の紙＝C:/Users/zeroa/sekkei_obd_tsunagi_2026-11-08.md（v2＋作り方の決め V1〜V7）
//   見る事：繋ぎは 同時に 1本／古い 線は 新しい 線へ 1字も 書かない／殺すと 待たずに 降りる／
//           外の status の 立ち落ちは 前と 同じ／各段に 時間切れ。
//   偽の機械は obd-client-ble の makeMockBluetooth を 写して、
//   機械を 複数・gatt.connect を 止める・切れた 知らせを 遅らせる（実機と 同じ）を 足した。
/* global vi */ // vitest の globals（vitest.config.js globals: true）

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const OBD_PATH = path.join(__dirname, '..', '..', 'js', 'obd-client.js');
const SRC = fs.readFileSync(OBD_PATH, 'utf8');

function loadOBD(bluetooth, kioku, src) {
  const _ls = Object.assign({}, kioku || {});
  const sandbox = {
    localStorage: {
      getItem(k) {
        return Object.prototype.hasOwnProperty.call(_ls, k) ? _ls[k] : null;
      },
      setItem(k, v) {
        _ls[k] = String(v);
      },
      removeItem(k) {
        delete _ls[k];
      },
    },
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout,
    clearTimeout,
    Date,
    Promise,
    Uint8Array,
    DataView,
    Number,
    Math,
    navigator: { bluetooth: bluetooth },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src || SRC, sandbox, { filename: 'obd-client.js' });
  const O = sandbox.OBDClient;
  const rec = { status: [], error: [], dan: [] };
  O.on('status', (s) => rec.status.push(s));
  O.on('error', (e) => rec.error.push(e));
  O.on('dan', (d) => rec.dan.push(d));
  return { O, ls: _ls, rec };
}

function strToDataView(s) {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return new DataView(b.buffer);
}

function ichiban(cmd) {
  if (cmd === '0100') return '41 00 BE 3E B8 11\r\r>';
  if (cmd === '010D') return '41 0D 3C\r\r>';
  return 'OK\r\r>';
}

// ★偽の 機械 1台★
//   opts.responder(cmd) -> 応答 | null（返さない）
//   opts.tomeru＝true なら gatt.connect が 返らない（kaihou() で 返す）
function makeDev(id, opts) {
  opts = opts || {};
  const dev = {
    id,
    writes: [], // { cmd, t }
    connectCalls: 0,
    tomeru: !!opts.tomeru,
    responder: opts.responder || ichiban,
  };
  let notifyHandler = null;
  let connected = false;
  const listeners = new Set();
  let matsu = [];
  function dispatch(s) {
    if (notifyHandler) notifyHandler({ target: { value: strToDataView(s) } });
  }
  // ★実機と 同じ★ 切れた 知らせは 後で（次の 回し）来る
  function shiraseru() {
    setTimeout(() => {
      Array.from(listeners).forEach((h) => h());
    }, 0);
  }
  const notifyChar = {
    startNotifications() {
      return Promise.resolve(notifyChar);
    },
    addEventListener(t, h) {
      if (t === 'characteristicvaluechanged') notifyHandler = h;
    },
    removeEventListener(t, h) {
      if (notifyHandler === h) notifyHandler = null;
    },
  };
  const writeChar = {
    writeValueWithoutResponse(buf) {
      let s = '';
      for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
      const cmd = s.replace(/\r/g, '').trim();
      dev.writes.push({ cmd, t: Date.now() });
      const resp = dev.responder(cmd);
      if (resp !== null) Promise.resolve().then(() => dispatch(resp));
      return Promise.resolve();
    },
  };
  const service = {
    getCharacteristic(uuid) {
      const isNotify = uuid.indexOf('fff1') >= 0 || uuid.indexOf('6e400003') >= 0;
      return Promise.resolve(isNotify ? notifyChar : writeChar);
    },
  };
  const server = {
    get connected() {
      return connected;
    },
    getPrimaryService(uuid) {
      return uuid.indexOf('fff0') >= 0
        ? Promise.resolve(service)
        : Promise.reject(new Error('no service'));
    },
    disconnect() {
      if (!connected) return;
      connected = false;
      shiraseru();
    },
  };
  dev.server = server;
  dev.gatt = {
    connect() {
      dev.connectCalls++;
      if (dev.tomeru) {
        return new Promise((r) => {
          matsu.push(() => {
            connected = true;
            r(server);
          });
        });
      }
      connected = true;
      return Promise.resolve(server);
    },
    disconnect() {
      server.disconnect();
    },
    get connected() {
      return connected;
    },
  };
  dev.addEventListener = (t, h) => {
    if (t === 'gattserverdisconnected') listeners.add(h);
  };
  dev.removeEventListener = (t, h) => {
    if (t === 'gattserverdisconnected') listeners.delete(h);
  };
  dev.kaihou = () => {
    dev.tomeru = false;
    const m = matsu;
    matsu = [];
    m.forEach((f) => f());
  };
  // 走行中の 瞬断（機械の 側から 切れた）
  dev.kireru = () => {
    connected = false;
    shiraseru();
  };
  dev.count = (cmd) => dev.writes.filter((w) => w.cmd === cmd).length;
  dev.listenerCount = () => listeners.size;
  return dev;
}

// requestDevice の 並び（機械 か 'yameru'（選ぶ 画面を やめた）か 'matsu'（返さない））
function makeBT(devices, opts) {
  opts = opts || {};
  const queue = [];
  const bt = {
    requestCalls: 0,
    getDevicesCalls: 0,
    nextPick(x) {
      queue.push(x);
    },
    pending: [],
    requestDevice() {
      bt.requestCalls++;
      const x = queue.length ? queue.shift() : devices[0];
      if (x === 'yameru') {
        const e = new Error('User cancelled the requestDevice() chooser.');
        e.name = 'NotFoundError';
        return Promise.reject(e);
      }
      if (x === 'matsu') {
        return new Promise((r) => bt.pending.push(r));
      }
      return Promise.resolve(x);
    },
    getDevices() {
      bt.getDevicesCalls++;
      if (opts.getDevicesOsoku) {
        return new Promise((r) => setTimeout(() => r(devices.slice()), opts.getDevicesOsoku));
      }
      return Promise.resolve(devices.slice());
    },
  };
  return bt;
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms == null ? 20 : ms));
async function made(fn, ms) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > (ms || 2000)) return false;
    await tick(5);
  }
  return true;
}
// 010D の 書きの 間が 一番 短い 所（polling が 2本 走ると 100ms より ずっと 短く なる）
function minGap(dev, cmd) {
  const ts = dev.writes.filter((w) => w.cmd === (cmd || '010D')).map((w) => w.t);
  let m = Infinity;
  for (let i = 1; i < ts.length; i++) m = Math.min(m, ts[i] - ts[i - 1]);
  return { m, n: ts.length };
}

describe('OBD 繋ぎの 線（同時に 1本）', () => {
  it('T1: 緑の 後に「切る→チップで 繋ぐ」→ polling は 1本（010D の 間が 100ms を 割らない）', async () => {
    const d1 = makeDev('A');
    const bt = makeBT([d1]);
    const { O } = loadOBD(bt);
    await O.connect();
    expect(O.getDan()).toBe('tsunagatta');
    O.disconnect();
    await O.connect();
    expect(O.getDan()).toBe('tsunagatta');
    const n0 = d1.count('010D');
    await tick(450);
    const g = minGap(d1);
    expect(d1.count('010D') - n0).toBeGreaterThanOrEqual(2);
    expect(g.m).toBeGreaterThanOrEqual(90);
    O.disconnect();
  });

  it('T1b: 繋いだ まま もう一度 人で 繋ぐ（同じ 機械）→ polling は 1本・聞き手は 1つ', async () => {
    const d1 = makeDev('A');
    const bt = makeBT([d1]);
    const { O } = loadOBD(bt);
    await O.connect();
    await O.connect();
    await tick(450);
    expect(minGap(d1).m).toBeGreaterThanOrEqual(90);
    expect(d1.listenerCount()).toBe(1);
    expect(O.getStatus()).toBe('connected');
    O.disconnect();
    expect(d1.listenerCount()).toBe(0);
  });

  it('T2: 手で 切った 後に 遅れて 来る 切断の 知らせ → status は idle だけ・繋ぎ直し 0', async () => {
    const d1 = makeDev('A');
    const bt = makeBT([d1]);
    const { O, rec } = loadOBD(bt);
    O._setReconnectDelayForTest(10);
    await O.connect();
    const c0 = d1.connectCalls;
    rec.status.length = 0;
    O.disconnect();
    await tick(120);
    expect(rec.status).toEqual(['idle']);
    expect(d1.connectCalls).toBe(c0);
    expect(O.getDare()).toBe(null);
  });

  it('T2b: 人で 繋ぎ直した 時の 古い 線の 切断の 知らせ → 繋ぎ直し（G）0・status は connected のまま', async () => {
    const d1 = makeDev('A');
    const d2 = makeDev('B');
    const bt = makeBT([d1, d2]);
    const { O, rec } = loadOBD(bt);
    O._setReconnectDelayForTest(10);
    await O.connect(); // A
    rec.status.length = 0; // 古い 線の 知らせは 2本目の connect の 間に 来る＝その 前から 数える
    bt.nextPick(d2);
    await O.connect(); // B（A の 線は 殺す＝A の 切断の 知らせが 遅れて 来る）
    const c1 = d1.connectCalls;
    await tick(150);
    expect(d1.connectCalls).toBe(c1);
    expect(rec.status).not.toContain('disconnected');
    expect(O.getStatus()).toBe('connected');
    expect(O.getDare()).toBe('hito');
    O.disconnect();
  });

  it('S4: 同じ 機械を 選び直した 後、本当に 切れたら disconnected・段 tsunagi_naoshi（新しい 線の 聞き手が 生きている）', async () => {
    const d1 = makeDev('A');
    const bt = makeBT([d1]);
    const { O, rec } = loadOBD(bt);
    O._setReconnectDelayForTest(30);
    await O.connect();
    await O.connect(); // 同じ 機械
    await tick(30); // 古い 切断の 知らせは 捨てられる（新しい server が 生きている）
    expect(O.getStatus()).toBe('connected');
    rec.status.length = 0;
    d1.kireru();
    await tick(5);
    expect(rec.status[0]).toBe('disconnected');
    expect(O.getDan()).toBe('tsunagi_naoshi');
    expect(await made(() => O.getStatus() === 'connected', 1000)).toBe(true);
    O.disconnect();
  });

  it('T3: 繋ぎ直し（G）の 途中で 人が 繋ぐ → G の 試みは 増えない', async () => {
    const d1 = makeDev('A');
    const d2 = makeDev('B');
    const bt = makeBT([d1, d2]);
    const { O } = loadOBD(bt);
    O._setReconnectDelayForTest(10);
    await O.connect(); // A
    const ate0 = d1.count('ATE0');
    d1.tomeru = true; // 繋ぎ直しは 返らない
    d1.kireru();
    expect(await made(() => d1.connectCalls >= 2, 500)).toBe(true);
    expect(O.getDare()).toBe('G');
    bt.nextPick(d2);
    await O.connect(); // 人が B を 選ぶ
    const c = d1.connectCalls;
    d1.kaihou(); // 古い G の gatt.connect が 遅れて 返る
    await tick(300);
    expect(d1.connectCalls).toBe(c);
    expect(O.getDare()).toBe('hito');
    expect(d1.count('ATE0')).toBe(ate0); // 古い G の 線は 初期化を 書かない
    expect(minGap(d2).m).toBeGreaterThanOrEqual(90);
    O.disconnect();
  });

  it('V4: 本当に 切れた → G の tryOnce が 呼ばれて 戻る（getDare は G）', async () => {
    const d1 = makeDev('A');
    const bt = makeBT([d1]);
    const { O, rec } = loadOBD(bt);
    O._setReconnectDelayForTest(20);
    await O.connect();
    rec.status.length = 0;
    d1.kireru();
    await tick(5);
    expect(O.getDare()).toBe('G');
    expect(await made(() => O.getStatus() === 'connected', 1000)).toBe(true);
    expect(d1.connectCalls).toBe(2);
    expect(rec.status).toEqual(['disconnected', 'connected']);
    O.disconnect();
  });
});

describe('OBD 古い 線は 新しい 線へ 書かない（T4・U1・V1・V2）', () => {
  it('T4: 古い 線を 初期化の 途中で 殺す → 記憶の 上書き0・誤りの 字0・connected は 新しい 線の 1回だけ', async () => {
    const d1 = makeDev('A', {
      responder: (c) => (c === 'ATE0' || c === 'ATZ' ? null : ichiban(c)),
    });
    const d2 = makeDev('B');
    const bt = makeBT([d1, d2]);
    const { O, ls, rec } = loadOBD(bt, { dk_obd_device_id: 'A' });
    O.tryAutoConnect(); // A＝自動の 線（初期化で 止まる）
    expect(await made(() => d1.count('ATE0') >= 1, 500)).toBe(true);
    bt.nextPick(d2);
    await O.connect(); // 人が B
    await tick(1500); // 古い 線が 起きる 時間
    expect(ls.dk_obd_device_id).toBe('B');
    expect(rec.error).toEqual([]);
    expect(rec.status.filter((s) => s === 'connected')).toEqual(['connected']);
    expect(d1.count('010D')).toBe(0);
    expect(O.getDare()).toBe('hito');
    O.disconnect();
  });

  it('T4b: 古い 線を warmup の 途中で 殺す →「車から 返事が ありません」等の 字0・記憶は 新しい 機械', async () => {
    const d1 = makeDev('A', { responder: (c) => (c === '0100' ? null : ichiban(c)) });
    const d2 = makeDev('B');
    const bt = makeBT([d1, d2]);
    const { O, ls, rec } = loadOBD(bt);
    O.connect().catch(() => {}); // A（warmup の 0100 で 止まる）
    expect(await made(() => d1.count('0100') >= 1, 1000)).toBe(true);
    expect(O.getDan()).toBe('hanasu');
    bt.nextPick(d2);
    await O.connect();
    await tick(300);
    expect(rec.error).toEqual([]);
    expect(ls.dk_obd_device_id).toBe('B');
    expect(O.getDan()).toBe('tsunagatta');
    expect(d1.count('010D')).toBe(0);
    O.disconnect();
  });

  it('T4c: 古い 自動の 線の warmup（0100 に NO DATA・寝ている 途中）で 人が 繋ぐ → 新しい 機械への 書きは まっさらと 同じ（叩き 注1）', async () => {
    const r = await BAMEN.atarashiiKikai(SRC);
    expect(r.atarashii).toEqual(r.kijun);
  });

  it('U1: gatt.connect が 返らない 自動の 線 → 人が 繋ぐと 待たずに 繋がる（25秒 待たない）', async () => {
    const d1 = makeDev('A', { tomeru: true });
    const d2 = makeDev('B');
    const bt = makeBT([d1, d2]);
    const { O } = loadOBD(bt, { dk_obd_device_id: 'A' });
    O.tryAutoConnect();
    expect(await made(() => d1.connectCalls === 1, 500)).toBe(true);
    expect(O.getDare()).toBe('auto');
    bt.nextPick(d2);
    const t0 = Date.now();
    await O.connect();
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(O.getStatus()).toBe('connected');
    d1.kaihou(); // 遅れて 返っても 何も しない
    await tick(200);
    expect(d1.count('ATE0')).toBe(0);
    expect(O.getDare()).toBe('hito');
    O.disconnect();
  });

  it('V1: 走行中の 立て直し（H）の 途中で 人が 繋ぐ → 待たずに 繋がる・古い H は 書かない', async () => {
    let shinu = false;
    const d1 = makeDev('A', {
      responder: (c) => {
        if (c === '010D') return 'NO DATA\r\r>';
        if (c === '0100') return shinu ? null : ichiban(c);
        return ichiban(c);
      },
    });
    const d2 = makeDev('B');
    const bt = makeBT([d1, d2]);
    const { O } = loadOBD(bt);
    await O.connect();
    shinu = true; // ここから 0100 は 返らない（H は 長い 待ちに 入る）
    const n0 = d1.count('0100');
    expect(await made(() => d1.count('0100') > n0, 3000)).toBe(true);
    bt.nextPick(d2);
    const t0 = Date.now();
    await O.connect();
    expect(Date.now() - t0).toBeLessThan(1000);
    const nA = d1.writes.length;
    await tick(400);
    expect(d1.writes.length).toBe(nA);
    expect(O.getStatus()).toBe('connected');
    O.disconnect();
  });

  it('V2: _sleep の 途中で 殺す → 即 起きて 降りる（新しい 線は 待たずに 繋がる）', async () => {
    // ATE0 が 返らない ⇒ ATZ 経路（ATZ の 後に 寝る）へ 入る
    const d1 = makeDev('A', { responder: (c) => (c === 'ATE0' ? null : ichiban(c)) });
    const d2 = makeDev('B');
    const bt = makeBT([d1, d2]);
    const { O } = loadOBD(bt);
    O.connect().catch(() => {});
    expect(await made(() => d1.count('ATZ') >= 1, 3000)).toBe(true);
    bt.nextPick(d2);
    const t0 = Date.now();
    await O.connect();
    expect(Date.now() - t0).toBeLessThan(500);
    const nA = d1.writes.length;
    await tick(1500);
    expect(d1.writes.length).toBe(nA);
    O.disconnect();
  });
});

describe('OBD 押しの 口×今の 形（T5・T6 差①〜④）と 段', () => {
  it('差①: 自動の 線の 途中に 人が 押して 選ぶ 画面を やめた → status は そのまま・自動の 線は 生きて 繋がる', async () => {
    const d1 = makeDev('A', { tomeru: true });
    const bt = makeBT([d1]);
    const { O, rec } = loadOBD(bt, { dk_obd_device_id: 'A' });
    const auto = O.tryAutoConnect();
    expect(await made(() => d1.connectCalls === 1, 500)).toBe(true);
    bt.nextPick('yameru');
    await expect(O.connect()).rejects.toBeTruthy();
    expect(rec.status).toEqual(['connecting']);
    expect(rec.error).toEqual([]);
    expect(O.getDare()).toBe('auto');
    d1.kaihou();
    expect(await auto).toBe(true);
    expect(O.getStatus()).toBe('connected');
    O.disconnect();
  });

  it('差①b: 線が 無い 時に 選ぶ 画面を やめた → 前と 同じ error（字は 出さない）', async () => {
    const bt = makeBT([makeDev('A')]);
    const { O, rec } = loadOBD(bt);
    bt.nextPick('yameru');
    await expect(O.connect()).rejects.toBeTruthy();
    expect(rec.status).toEqual(['connecting', 'error']);
    expect(rec.error).toEqual([]);
    expect(O.getDan()).toBe('yasumi');
  });

  it('差②: 選ぶ 画面が 開いている 間に もう一度 押す → 2つ目の 選ぶ 画面は 出ない', async () => {
    const d1 = makeDev('A');
    const bt = makeBT([d1]);
    const { O } = loadOBD(bt);
    bt.nextPick('matsu');
    const p1 = O.connect();
    expect(O.getDare()).toBe('hito');
    await expect(O.connect()).rejects.toBeTruthy();
    expect(bt.requestCalls).toBe(1);
    bt.pending.shift()(d1);
    expect(await p1).toBe(true);
    O.disconnect();
  });

  it('差③: 繋ぎ直し（G）の 待ちの 間は getDare が G（業務開始の 2本目を 止める 門）', async () => {
    const d1 = makeDev('A');
    const bt = makeBT([d1]);
    const { O } = loadOBD(bt);
    O._setReconnectDelayForTest(200);
    await O.connect();
    d1.kireru();
    await tick(10);
    expect(O.getStatus()).toBe('disconnected');
    expect(O.getDare()).toBe('G');
    O.disconnect();
    expect(O.getDare()).toBe(null);
    await tick(300);
    expect(d1.connectCalls).toBe(1);
  });

  it('差④: gatt.connect が 返らない → 人は 25秒で error・自動は idle・G は disconnected のまま次へ', async () => {
    vi.useFakeTimers();
    try {
      // 人
      let d1 = makeDev('A', { tomeru: true });
      let bt = makeBT([d1]);
      let L = loadOBD(bt);
      const p = L.O.connect().catch(() => 'ng');
      await vi.advanceTimersByTimeAsync(24000);
      expect(L.O.getStatus()).toBe('connecting');
      await vi.advanceTimersByTimeAsync(1500);
      expect(await p).toBe('ng');
      expect(L.O.getStatus()).toBe('error');
      expect(L.rec.error.length).toBeGreaterThanOrEqual(1);
      expect(L.O.getDare()).toBe(null);
      // 自動
      d1 = makeDev('A', { tomeru: true });
      bt = makeBT([d1]);
      L = loadOBD(bt, { dk_obd_device_id: 'A' });
      const a = L.O.tryAutoConnect();
      await vi.advanceTimersByTimeAsync(25500);
      expect(await a).toBe(false);
      expect(L.O.getStatus()).toBe('idle');
      expect(L.O.getDan()).toBe('yasumi');
      // G
      d1 = makeDev('A');
      bt = makeBT([d1]);
      L = loadOBD(bt);
      L.O._setReconnectDelayForTest(10);
      const c = L.O.connect();
      await vi.advanceTimersByTimeAsync(2000);
      await c;
      d1.tomeru = true;
      d1.kireru();
      await vi.advanceTimersByTimeAsync(26000);
      expect(L.O.getStatus()).toBe('disconnected');
      expect(d1.connectCalls).toBeGreaterThanOrEqual(3); // 1回目の 時間切れの 後に 次の 試み
      L.O.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });

  it('§5: connected が 立つのは 初期化（ATE0）の 後・warmup が 駄目でも connected のまま・段は kuruma_machi', async () => {
    const d1 = makeDev('A', {
      responder: (c) => (c === '0100' || c === '010D' ? 'NO DATA\r\r>' : ichiban(c)),
    });
    const bt = makeBT([d1]);
    const { O, rec } = loadOBD(bt);
    let mi = null;
    O.on('status', (s) => {
      if (s === 'connected') mi = { ate0: d1.count('ATE0'), p0100: d1.count('0100') };
    });
    await O.connect();
    // 初期化（ATE0）の 後・warmup（0100）の 前
    expect(mi.ate0).toBeGreaterThanOrEqual(1);
    expect(mi.p0100).toBe(0);
    expect(rec.status).toEqual(['connecting', 'connected']);
    expect(O.getStatus()).toBe('connected');
    expect(O.getDan()).toBe('kuruma_machi');
    expect(rec.error.length).toBe(1); // 訳を 名指しで 1回
    O.disconnect();
  });

  it('段の 並び（人）：erabu→gatt→kata→okosu→hanasu→tsunagatta→（切る）yasumi', async () => {
    const bt = makeBT([makeDev('A')]);
    const { O, rec } = loadOBD(bt);
    await O.connect();
    O.disconnect();
    expect(rec.dan).toEqual(['erabu', 'gatt', 'kata', 'okosu', 'hanasu', 'tsunagatta', 'yasumi']);
  });

  it('V5: 起動の 自動接続（getDevices が 遅い）の 間に 人が 繋ぐ → 人の 線が 生き残る', async () => {
    const d1 = makeDev('A');
    const d2 = makeDev('B');
    const bt = makeBT([d1, d2], { getDevicesOsoku: 100 });
    const { O } = loadOBD(bt, { dk_obd_device_id: 'A' });
    const a = O.tryAutoConnect();
    bt.nextPick(d2);
    await O.connect();
    expect(await a).toBe(false);
    await tick(50);
    expect(O.getDare()).toBe('hito');
    expect(d1.connectCalls).toBe(0);
    O.disconnect();
  });

  it('差⑤: 覚えた id が 無い・合わない 端末は 起動で 繋がない（別の 機械へ 行かない）', async () => {
    const d1 = makeDev('X');
    const bt = makeBT([d1]);
    let L = loadOBD(bt);
    expect(await L.O.tryAutoConnect()).toBe(false);
    L = loadOBD(bt, { dk_obd_device_id: 'A' });
    expect(await L.O.tryAutoConnect()).toBe(false);
    expect(d1.connectCalls).toBe(0);
  });

  it('手で 切っても 記憶（dk_obd_device_id）は 消さない', async () => {
    const bt = makeBT([makeDev('A')]);
    const { O, ls } = loadOBD(bt);
    await O.connect();
    O.disconnect();
    expect(ls.dk_obd_device_id).toBe('A');
  });
});

// ★★車が 黙った（段 kuruma_machi）間に 押すと 人で 繋ぐ★★ 2026-11-09
//   画面の _obdOsu は kuruma_machi の 時 チップ・業務ボタン・設定の 接続で connect() を 呼ぶ（e2e obd-matsu-oshi）。
//   ここは その connect() の 側＝古い 線が 生きた まま 呼ばれても 壊れない 事を 見る（設計 v1 の unit）。
describe('OBD 車が 黙った 線の 上で 人が 繋ぐ（kuruma_machi→connect）', () => {
  const damaru = (c) => (c === '0100' || c === '010D' ? 'NO DATA\r\r>' : ichiban(c));

  // ★新しい 訳は 出さない（やめたのは 間違いでは ない）★。前の 訳の 出し直し 1本だけ（SU6・11-09 本番前 taiketsu 止め 2回目）
  it('選ぶ 画面を やめた → 段は kuruma_machi に 戻る・status は connected の まま・古い 線は 生きた まま・新しい 訳は 出さない（前の 訳を 出し直す）', async () => {
    const d1 = makeDev('A', { responder: damaru });
    const bt = makeBT([d1]);
    const { O, rec } = loadOBD(bt);
    await O.connect();
    expect(O.getDan()).toBe('kuruma_machi');
    const errMae = rec.error.length;
    const yakuMae = rec.error[errMae - 1];
    bt.nextPick('yameru');
    await expect(O.connect()).rejects.toBeTruthy();
    expect(O.getDan()).toBe('kuruma_machi');
    expect(O.getStatus()).toBe('connected');
    expect(O.getDare()).toBe('hito');
    expect(d1.server.connected).toBe(true);
    expect(rec.error.slice(errMae)).toEqual([yakuMae]);
    expect(rec.status).toEqual(['connecting', 'connected']);
    O.disconnect();
  });

  it('選んだ → 古い 線の 書き 0・新しい 機械と 話せて tsunagatta・status に idle／error は 出ない', async () => {
    const d1 = makeDev('A', { responder: damaru });
    const d2 = makeDev('B');
    const bt = makeBT([d1, d2]);
    const { O, rec } = loadOBD(bt);
    await O.connect();
    expect(O.getDan()).toBe('kuruma_machi');
    bt.nextPick(d2);
    const p = O.connect();
    expect(await p).toBe(true);
    const aAto = d1.writes.length;
    await tick(400);
    expect(d1.writes.length - aAto).toBe(0);
    expect(d1.server.connected).toBe(false);
    expect(O.getDan()).toBe('tsunagatta');
    expect(O.getStatus()).toBe('connected');
    // 古い 線を 降ろした 後 connecting を 立て直す（設計 v1 任意1 の 差）＝idle・error・disconnected は 出ない
    expect(rec.status).toEqual(['connecting', 'connected', 'connecting', 'connected']);
    O.disconnect();
  });
});

// ★わざと 壊す★ 前の 穴の 形に 戻した 写しで、上の 場面が 本当に 赤に なるかを 数える。
//   守りが 2重の 所（聞き手を 外す＋知らせを 捨てる・race＋mada）は 2つとも 外して 前の 形に する。
function kowasu(pairs) {
  let src = SRC;
  pairs.forEach(([from, to]) => {
    expect(src.indexOf(from)).toBeGreaterThanOrEqual(0);
    src = src.replace(from, to);
  });
  return src;
}

// 場面（src を 変えて 回す）。戻りの ok＝上の 試験と 同じ 物差しで 正しいか
const BAMEN = {
  // T4c の 形：新しい 機械（B）が 010D を 書き始める 前の 並びを、まっさらに 繋いだ 時と 比べる
  async atarashiiKikai(src) {
    const mae = (d) => {
      const i = d.writes.findIndex((w) => w.cmd === '010D');
      return d.writes.slice(0, i < 0 ? d.writes.length : i).map((w) => w.cmd);
    };
    const k = makeDev('B');
    const L0 = loadOBD(makeBT([k]), null, src);
    await L0.O.connect();
    await tick(800);
    L0.O.disconnect();
    const d1 = makeDev('A', { responder: (c) => (c === '0100' ? 'NO DATA\r\r>' : ichiban(c)) });
    const d2 = makeDev('B');
    const bt = makeBT([d1, d2]);
    const { O } = loadOBD(bt, { dk_obd_device_id: 'A' }, src);
    O.tryAutoConnect().catch(() => {});
    await made(() => d1.count('0100') >= 1, 3000);
    bt.nextPick(d2);
    await O.connect().catch(() => {});
    await tick(800);
    O.disconnect();
    const atarashii = mae(d2);
    const kijun = mae(k);
    return { ok: JSON.stringify(atarashii) === JSON.stringify(kijun), atarashii, kijun };
  },
  // T1b の 形：繋いだ まま もう一度 人で 繋ぐ
  async nihon(src) {
    const d1 = makeDev('A');
    const bt = makeBT([d1]);
    const { O } = loadOBD(bt, null, src);
    await O.connect();
    await O.connect().catch(() => {});
    await tick(450);
    const g = minGap(d1);
    const n = d1.listenerCount();
    O.disconnect();
    return { ok: g.m >= 90 && n === 1, gap: g.m, kikite: n };
  },
  // T4b の 形：古い 線を warmup の 途中で 殺す
  async furuiKaku(src) {
    const d1 = makeDev('A', { responder: (c) => (c === '0100' ? null : ichiban(c)) });
    const d2 = makeDev('B');
    const bt = makeBT([d1, d2]);
    const { O, ls, rec } = loadOBD(bt, null, src);
    O.connect().catch(() => {});
    await made(() => d1.count('0100') >= 1, 1000);
    bt.nextPick(d2);
    await O.connect().catch(() => {});
    await tick(300);
    const r = {
      ok: rec.error.length === 0 && ls.dk_obd_device_id === 'B' && O.getDan() === 'tsunagatta',
      error: rec.error.length,
      id: ls.dk_obd_device_id,
      dan: O.getDan(),
    };
    O.disconnect();
    return r;
  },
  // T2b の 形：人で 繋ぎ直した 時の 古い 線の 切断の 知らせ
  async furuiKireta(src) {
    const d1 = makeDev('A');
    const d2 = makeDev('B');
    const bt = makeBT([d1, d2]);
    const { O, rec } = loadOBD(bt, null, src);
    O._setReconnectDelayForTest(10);
    await O.connect();
    rec.status.length = 0;
    bt.nextPick(d2);
    await O.connect().catch(() => {});
    const c1 = d1.connectCalls;
    await tick(150);
    const r = {
      ok: d1.connectCalls === c1 && rec.status.indexOf('disconnected') < 0,
      G: d1.connectCalls - c1,
      status: rec.status.slice(),
    };
    O.disconnect();
    await tick(50);
    return r;
  },
  // U1 の 形：返らない 自動の 線を 人が 待たされない
  async matanai(src) {
    const d1 = makeDev('A', { tomeru: true });
    const d2 = makeDev('B');
    const bt = makeBT([d1, d2]);
    const { O } = loadOBD(bt, { dk_obd_device_id: 'A' }, src);
    O.tryAutoConnect().catch(() => {});
    await made(() => d1.connectCalls === 1, 500);
    bt.nextPick(d2);
    let owatta = false;
    O.connect().then(
      () => (owatta = true),
      () => (owatta = true)
    );
    await tick(600);
    const r = { ok: owatta && O.getStatus() === 'connected', owatta };
    O.disconnect();
    d1.kaihou();
    await tick(20);
    return r;
  },
  // 差⑤ の 形：覚えた id に 合わない 機械へ 行かない
  async betsuKikai(src) {
    const d1 = makeDev('X');
    const bt = makeBT([d1]);
    const { O } = loadOBD(bt, { dk_obd_device_id: 'A' }, src);
    await O.tryAutoConnect();
    const r = { ok: d1.connectCalls === 0, connect: d1.connectCalls };
    O.disconnect();
    return r;
  },
};

describe('わざと 壊す（前の 穴の 形に 戻すと 赤に なる事）', () => {
  it('今の コードでは 6つの 場面が 全部 正しい', async () => {
    for (const k of Object.keys(BAMEN)) {
      const r = await BAMEN[k](SRC);
      expect({ k, ok: r.ok }).toEqual({ k, ok: true });
    }
  });

  it('壊1: 人で 繋ぐ 時に 古い 線を 殺さない（前の 2本目）→ 2本 走る', async () => {
    const src = kowasu([['        _korosu(furui);\n', '        _sen = null;\n']]);
    const r = await BAMEN.nihon(src);
    expect(r.ok).toBe(false);
  });

  it('壊2: 古い 線の「死んだら 降りる」（race と mada）を 両方 外す → 古い 線が 字・段を 書く', async () => {
    const src = kowasu([
      ['return _race(sen, _uchi(sen, _warmup(sen)));', 'return _uchi(sen, _warmup(sen));'],
      ['if (sen.shinda || _sen !== sen) throw _shindaErr();', '/* kowashita */'],
    ]);
    const r = await BAMEN.furuiKaku(src);
    expect(r.ok).toBe(false);
  });

  it('壊3: 殺した 線の 切断の 聞き手を 外さず・知らせも 捨てない（前の 共有の 聞き手）→ 繋ぎ直しが 走る', async () => {
    const src = kowasu([
      [
        "        sen.device.removeEventListener('gattserverdisconnected', sen.onDisc);",
        '        /* kowashita */',
      ],
      [
        'if (sen !== _sen || sen.shinda) return;\n    if (sen.server && sen.server.connected) return;',
        'if (sen.server && sen.server.connected) return;',
      ],
    ]);
    const r = await BAMEN.furuiKireta(src);
    expect(r.ok).toBe(false);
  });

  it('壊6: race の 中の 生の 連なり（_uchi）を 待たない → 古い warmup が 新しい 機械へ 0100 を 書く', async () => {
    const src = kowasu([
      [
        '[sen.ima, sen.loopIma, sen.hIma].concat(sen.uchi).map(',
        '[sen.ima, sen.loopIma, sen.hIma].map(',
      ],
    ]);
    const r = await BAMEN.atarashiiKikai(src);
    expect(r.ok).toBe(false);
  });

  it('壊4: gatt.connect の race を 外す → 返らない 自動の 線を 人が 待たされる', async () => {
    const src = kowasu([
      [
        'const p = _race(\n      sen,\n      _jikangire(',
        'const p = (function (_s, x) { return x; })(\n      sen,\n      _jikangire(',
      ],
    ]);
    const r = await BAMEN.matanai(src);
    expect(r.ok).toBe(false);
  });

  it('壊5: 起動の 自動接続で id を 見ない（前の devices[0]）→ 別の 機械へ 行く', async () => {
    const src = kowasu([['return d && d.id === wantId;', 'return !!d;']]);
    const r = await BAMEN.betsuKikai(src);
    expect(r.ok).toBe(false);
  });
});

// ★★進みの 字（susumi）が 画面の 受け口に 届く★★ 2026-11-09（09-08 司さん「直せや」の 直しが 届いていなかった）
//   ★前★ _listeners に susumi が 無く、on('susumi') は 登録されず、_emit('susumi') は 何もせずに 戻っていた
//     ＝帯の「機械を 起こしています（あと 約4秒）」は 09-08 から 1回も 出ていなかった
describe('OBD 進みの 字（susumi）が 届く', () => {
  function kikuSusumi(O) {
    const ji = [];
    O.on('susumi', (x) => ji.push(x && x.ji));
    return ji;
  }
  it('SU1: 本物の on→_emit で 人の 繋ぎの 段ごとに 字が 届く', async () => {
    const bt = makeBT([makeDev('A')]);
    const { O } = loadOBD(bt);
    const ji = kikuSusumi(O);
    await O.connect();
    await tick(50);
    O.disconnect();
    expect(ji[0]).toBe('機械を 選んでください');
    expect(ji).toContain('機械に つないでいます');
    expect(ji).toContain('つながりました');
  });
});

describe('OBD 進みの 字（susumi）の 順と 線', () => {
  function kiku(O) {
    const jun = [];
    O.on('susumi', (x) => jun.push('s:' + (x && x.ji)));
    O.on('error', (e) => jun.push('e:' + e));
    return jun;
  }
  function yameruErabu(bt) {
    const h = { yameru: null };
    bt.requestDevice = () =>
      new Promise((_, rej) => {
        h.yameru = () => {
          const e = new Error('User cancelled the requestDevice() chooser.');
          e.name = 'NotFoundError';
          rej(e);
        };
      });
    return h;
  }
  it('SU0: _emit で 出す 名前は 全部 _listeners に 在る（無いと on が 黙って 捨てる）', () => {
    const i = SRC.indexOf('const _listeners = {');
    const blk = SRC.slice(i, SRC.indexOf('};', i));
    const names = Array.from(
      new Set(Array.from(SRC.matchAll(/_emit\('([a-z]+)'/g)).map((m) => m[1]))
    );
    expect(names.length).toBeGreaterThanOrEqual(8);
    const nai = names.filter((n) => !new RegExp('\\b' + n + ':\\s*\\[\\]').test(blk));
    expect(nai).toEqual([]);
  });
  it('SU2: 車が 黙る（kuruma_machi）→「つながりませんでした」の 後に 訳＝帯に 残るのは 訳', async () => {
    // 車が 黙る＝0100 も 010D も NO DATA（§5 と 同じ）
    const d = makeDev('A', {
      responder: (c) => (c === '0100' || c === '010D' ? 'NO DATA\r\r>' : ichiban(c)),
    });
    const { O } = loadOBD(makeBT([d]));
    const jun = kiku(O);
    await O.connect();
    expect(O.getDan()).toBe('kuruma_machi');
    await tick(50);
    O.disconnect();
    const a = jun.indexOf('s:つながりませんでした');
    expect(a).toBeGreaterThan(-1);
    expect(jun[a + 1]).toBe(
      'e:車から 返事が ありません。エンジンを かけた まま もう一度 押してください。'
    );
    expect(jun.slice(a + 2).filter((x) => x.indexOf('s:') === 0)).toEqual([]);
  }, 20000);
  // ★本番前 taiketsu 止め（11-09）★ kuruma_machi の 間も 速度の 問い合わせは 続く→5回 しくじると 走りの 途中の 回復（_warmup）
  //   前は 回復の 進みの 字が 訳を 上書きし、後で 切れた 帯が「切れました」になって 訳（エンジン／抜き挿し）が 消えた
  it('SU5: 車が 黙った まま 走りの 途中の 回復が 走っても 訳の 後に 進みの 字は 来ない', async () => {
    const d = makeDev('A', {
      responder: (c) => (c === '0100' || c === '010D' ? 'NO DATA\r\r>' : ichiban(c)),
    });
    const { O } = loadOBD(makeBT([d]));
    const jun = kiku(O);
    await O.connect();
    expect(O.getDan()).toBe('kuruma_machi');
    const n0 = d.writes.length;
    await tick(2000);
    // 回復が 本当に 走った（ATSP を 打ち直した）
    expect(d.writes.slice(n0).filter((w) => /^ATSP/.test(w.cmd)).length).toBeGreaterThan(0);
    O.disconnect();
    const a = jun.indexOf('s:つながりませんでした');
    expect(a).toBeGreaterThan(-1);
    expect(jun[a + 1].indexOf('e:')).toBe(0);
    expect(jun.slice(a + 2).filter((x) => x.indexOf('s:') === 0)).toEqual([]);
  }, 20000);
  it('SU3: 線が 生きた まま 人が 選ぶ 画面を 開く → 線の 字は 預かる・やめたら 線の 今の 字を 出し直す', async () => {
    const d = makeDev('A', { responder: (c) => (c === '0100' ? 'NO DATA\r\r>' : ichiban(c)) });
    const bt = makeBT([d]);
    const { O } = loadOBD(bt);
    const jun = kiku(O);
    O.connect().catch(() => {});
    expect(await made(() => d.count('ATSP6') >= 1, 3000)).toBe(true);
    const h = yameruErabu(bt);
    O.connect().catch(() => {});
    const k = jun.length;
    expect(jun[k - 1]).toBe('s:機械を 選んでください');
    // 線は 方式 2 へ 進む（字は 預かる）
    expect(await made(() => d.count('ATSP0') >= 1, 4000)).toBe(true);
    await tick(20);
    expect(jun.slice(k)).toEqual([]);
    h.yameru();
    await tick(20);
    expect(jun.slice(k)[0]).toBe('s:車と 話しています（方式 2/3）');
    O.disconnect();
  }, 20000);
  // ★本番前 taiketsu 止め（11-09 2回目）★ 車待ち（kuruma_machi）で 言われた 通り 押す→選ぶ 画面を やめる
  //   前は 出し直した「つながりませんでした」が 最後＝字の 出どころが 進みの まま→後で 切れた 帯で 訳が 消えた
  it('SU6: 車待ちの 線の 上で 選ぶ 画面を やめる → 最後に 出るのは 訳（エンジン）', async () => {
    const d = makeDev('A', {
      responder: (c) => (c === '0100' || c === '010D' ? 'NO DATA\r\r>' : ichiban(c)),
    });
    const bt = makeBT([d]);
    const { O } = loadOBD(bt);
    const jun = kiku(O);
    await O.connect();
    expect(O.getDan()).toBe('kuruma_machi');
    const h = yameruErabu(bt);
    O.connect().catch(() => {});
    const k = jun.length;
    expect(jun[k - 1]).toBe('s:機械を 選んでください');
    h.yameru();
    await tick(20);
    expect(O.getDan()).toBe('kuruma_machi');
    expect(jun.slice(k)[0]).toBe('s:つながりませんでした');
    expect(jun[jun.length - 1]).toBe(
      'e:車から 返事が ありません。エンジンを かけた まま もう一度 押してください。'
    );
    O.disconnect();
  }, 20000);
  it('SU7: 車待ちから 車が 話して 緑（tsunagatta）に なった 後に 選ぶ 画面を やめる → 古い 訳は 出し直さない', async () => {
    const d = makeDev('A', {
      responder: (c) => (c === '0100' || c === '010D' ? 'NO DATA\r\r>' : ichiban(c)),
    });
    const bt = makeBT([d]);
    const { O } = loadOBD(bt);
    const jun = kiku(O);
    await O.connect();
    expect(O.getDan()).toBe('kuruma_machi');
    d.responder = ichiban; // エンジンが かかった＝次の 車速で 緑
    expect(await made(() => O.getDan() === 'tsunagatta', 3000)).toBe(true);
    const h = yameruErabu(bt);
    O.connect().catch(() => {});
    const k = jun.length;
    h.yameru();
    await tick(20);
    expect(jun.slice(k).filter((x) => x.indexOf('e:') === 0)).toEqual([]);
    // ★出し直されるのは「つながりました」（緑に なった 時の 字）★ 2026-11-09 候補①
    expect(jun.slice(k)).toEqual(['s:つながりました']);
    O.disconnect();
  }, 20000);
  // ★候補①（11-09）★ 車待ち（訳を 出した 後）から 黙って 緑に 戻ると 字の 出どころが 訳の まま
  //   ⇒ 後で 切れた 帯に 古い 訳が 出て「切れました」が 出なかった＝緑に なったら「つながりました」を 出す
  it('SU8: 車待ちから 最初の 正しい 車速で 緑 → 訳の 後に「つながりました」・その 後は 字が 増えない', async () => {
    const d = makeDev('A', {
      responder: (c) => (c === '0100' || c === '010D' ? 'NO DATA\r\r>' : ichiban(c)),
    });
    const { O } = loadOBD(makeBT([d]));
    const jun = kiku(O);
    await O.connect();
    expect(O.getDan()).toBe('kuruma_machi');
    const a = jun.length;
    expect(jun[a - 1].indexOf('e:')).toBe(0);
    d.responder = ichiban; // エンジンが かかった＝次の 車速で 緑
    expect(await made(() => O.getDan() === 'tsunagatta', 3000)).toBe(true);
    await tick(1500); // 車速が 何回 来ても 字は 1回だけ
    expect(jun.slice(a)).toEqual(['s:つながりました']);
    O.disconnect();
  }, 20000);
  it('SU9: 車待ちから 走りの 途中の 回復（_warmup）で 緑 → 訳の 後に「つながりました」', async () => {
    const d = makeDev('A', {
      responder: (c) => (c === '0100' || c === '010D' ? 'NO DATA\r\r>' : ichiban(c)),
    });
    const { O } = loadOBD(makeBT([d]));
    const jun = kiku(O);
    await O.connect();
    expect(O.getDan()).toBe('kuruma_machi');
    const a = jun.length;
    // 車速（010D）は 黙った まま・0100 だけ 返す＝回復の _warmup だけが 緑に する
    d.responder = (c) => (c === '010D' ? 'NO DATA\r\r>' : ichiban(c));
    const n0 = d.writes.length;
    expect(await made(() => O.getDan() === 'tsunagatta', 8000)).toBe(true);
    expect(d.writes.slice(n0).filter((w) => /^ATSP/.test(w.cmd)).length).toBeGreaterThan(0);
    expect(jun.slice(a)).toEqual(['s:つながりました']);
    O.disconnect();
  }, 20000);
  // ★任意1（11-09 叩き直し）★ 選ぶ 画面を 開いている 間に 車が 話した → やめたら 緑・古い 訳を 出し直さない
  it('SU10: 車待ちで 選ぶ 画面を 開いている 間に 車が 話す → やめた 直後に 緑・字は「つながりました」だけ', async () => {
    const d = makeDev('A', {
      responder: (c) => (c === '0100' || c === '010D' ? 'NO DATA\r\r>' : ichiban(c)),
    });
    const bt = makeBT([d]);
    const { O } = loadOBD(bt);
    const jun = kiku(O);
    await O.connect();
    expect(O.getDan()).toBe('kuruma_machi');
    const h = yameruErabu(bt);
    O.connect().catch(() => {});
    expect(O.getDan()).toBe('erabu');
    const n0 = d.writes.length;
    d.responder = ichiban; // 選ぶ 画面の 間に エンジンが かかった
    expect(await made(() => d.writes.slice(n0).some((w) => w.cmd === '010D'), 3000)).toBe(true);
    await tick(300);
    expect(O.getDan()).toBe('erabu');
    const k = jun.length;
    h.yameru();
    await tick(20);
    expect(O.getDan()).toBe('tsunagatta');
    expect(jun.slice(k)).toEqual(['s:つながりました']);
    O.disconnect();
  }, 20000);
  it('SU4: 殺した 線（warmup の 途中）からは 新しい 線の 字の 後に 古い 字が 来ない', async () => {
    const d1 = makeDev('A', { responder: (c) => (c === '0100' ? null : ichiban(c)) });
    const d2 = makeDev('B');
    const bt = makeBT([d1, d2]);
    const { O } = loadOBD(bt);
    const jun = kiku(O);
    O.connect().catch(() => {});
    expect(await made(() => d1.count('0100') >= 1, 1000)).toBe(true);
    bt.nextPick(d2);
    await O.connect();
    await tick(300);
    O.disconnect();
    const a = jun.lastIndexOf('s:機械に つないでいます');
    expect(jun.slice(a)).toEqual([
      's:機械に つないでいます',
      's:話し方を 探しています',
      's:機械を 起こしています',
      's:車と 話しています（方式 1/3）',
      's:つながりました',
    ]);
  });
});
