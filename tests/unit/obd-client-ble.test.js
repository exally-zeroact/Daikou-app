// tests/unit/obd-client-ble.test.js
// ★OBD BLE 経路の統合テスト (2026-06-05・監査修正のカバレッジ追加)★
//   実機BLEが無いので navigator.bluetooth をモックし、connect→ELM327初期化→010Dポーリング→
//   速度取得→分割応答再結合→切断 の一連を実コードで通す。監査指摘 M-1/M-2 のガードも検証。
//   絶対ルール: distance_m/calcFare に依存しない独立部品であることの担保。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const OBD_PATH = path.join(__dirname, '..', '..', 'js', 'obd-client.js');

function loadOBD(bluetooth) {
  const src = fs.readFileSync(OBD_PATH, 'utf8');
  const sandbox = {
    console,
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
  vm.runInContext(src, sandbox, { filename: 'obd-client.js' });
  return sandbox.OBDClient;
}

function strToDataView(s) {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return new DataView(b.buffer);
}

// 既知 fff0 プロファイルの ELM327 BLE アダプターをモック。
//   opts.responder(cmd) -> 応答文字列 | null(=自動応答しない=手動 dispatch 用)
function makeMockBluetooth(opts) {
  opts = opts || {};
  const responder =
    opts.responder ||
    function (cmd) {
      // ★_warmup の 0100 には 41 00(supported PIDs)を返し確立成功させる(retry待ち回避)★
      if (cmd === '0100') return '41 00 BE 3E B8 11\r\r>';
      return cmd === '010D' ? '41 0D 3C\r\r>' : 'OK\r\r>';
    };
  let notifyHandler = null;
  let disconnectHandler = null;
  let connected = true;
  const writes = [];

  function dispatch(s) {
    if (notifyHandler) notifyHandler({ target: { value: strToDataView(s) } });
  }
  const notifyChar = {
    startNotifications() {
      return Promise.resolve(notifyChar);
    },
    addEventListener(t, h) {
      if (t === 'characteristicvaluechanged') notifyHandler = h;
    },
    removeEventListener() {},
  };
  const writeChar = {
    writeValueWithoutResponse(buf) {
      let s = '';
      for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
      const cmd = s.replace(/\r/g, '').trim();
      writes.push(cmd);
      const resp = responder(cmd);
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
      connected = false;
    },
  };
  const device = {
    gatt: {
      connect() {
        return Promise.resolve(server);
      },
      get connected() {
        return connected;
      },
    },
    addEventListener(t, h) {
      if (t === 'gattserverdisconnected') disconnectHandler = h;
    },
  };
  return {
    bluetooth: {
      requestDevice() {
        return Promise.resolve(device);
      },
    },
    dispatch,
    writes,
    fireDisconnect() {
      connected = false;
      if (disconnectHandler) disconnectHandler();
    },
  };
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms || 20));

describe('OBDClient BLE 経路 (モック実機)', () => {
  it('connect → ELM327初期化 → 010Dポーリング → 速度60km/h を取得', async () => {
    const mock = makeMockBluetooth();
    const O = loadOBD(mock.bluetooth);
    const ok = await O.connect();
    expect(ok).toBe(true);
    expect(O.isConnected()).toBe(true);
    expect(O.getStatus()).toBe('connected');
    // ELM327 初期化コマンドと速度PIDが送信された
    expect(mock.writes).toContain('ATZ');
    expect(mock.writes).toContain('ATE0');
    expect(mock.writes).toContain('010D');
    await tick();
    const sp = O.getSpeed();
    expect(sp.valid).toBe(true);
    expect(sp.kmh).toBe(60);
    expect(Math.abs(sp.mps - 60 / 3.6)).toBeLessThan(1e-9);
    // speedProvider(未配線APIだが鮮度OKなら m/s)
    expect(Math.abs(O.speedProvider({}) - 60 / 3.6)).toBeLessThan(1e-9);
    O.disconnect();
    expect(O.getStatus()).toBe('idle');
  });

  it('BLE 20byte分割の応答を ">" まで再結合して解決する', async () => {
    // AT* は自動応答・010D は手動 dispatch で分割を再現
    const mock = makeMockBluetooth({
      responder: (cmd) =>
        cmd.indexOf('AT') === 0
          ? 'OK\r>'
          : cmd === '0100'
            ? '41 00 BE 3E B8 11\r>'
            : cmd === '010D'
              ? null
              : 'NO DATA\r>',
    });
    const O = loadOBD(mock.bluetooth);
    await O.connect(); // init 完了後 010D が pending(未応答)
    // 010D の応答を 2 チャンクに分けて送る
    mock.dispatch('41 0D ');
    mock.dispatch('50\r>'); // 0x50 = 80km/h
    await tick();
    expect(O.getSpeed().kmh).toBe(80);
    O.disconnect();
  });

  it('予期せぬ切断 → status=disconnected・速度invalid・in-flightが宙吊りにならない (M-2)', async () => {
    const mock = makeMockBluetooth({
      responder: (cmd) =>
        cmd.indexOf('AT') === 0
          ? 'OK\r>'
          : cmd === '0100'
            ? '41 00 BE 3E B8 11\r>'
            : cmd === '010D'
              ? null
              : 'NO DATA\r>', // 010D 未応答=in-flight
    });
    const O = loadOBD(mock.bluetooth);
    await O.connect(); // 010D pending
    mock.fireDisconnect(); // gattserverdisconnected
    expect(O.getStatus()).toBe('disconnected');
    expect(O.getSpeed().valid).toBe(false);
    expect(O.getSpeed().mps).toBe(-1);
    // 解放後に getSpeed を呼んでも安定 (例外なし)
    await tick();
    expect(O.getSpeed().valid).toBe(false);
  });

  it('切断後の迷子通知は破棄され速度を汚染しない (M-1 クロストーク防止)', async () => {
    const mock = makeMockBluetooth({
      responder: (cmd) =>
        cmd.indexOf('AT') === 0
          ? 'OK\r>'
          : cmd === '0100'
            ? '41 00 BE 3E B8 11\r>'
            : cmd === '010D'
              ? null
              : 'NO DATA\r>',
    });
    const O = loadOBD(mock.bluetooth);
    await O.connect();
    // まず正常応答で 60 を入れる
    mock.dispatch('41 0D 3C\r>');
    await tick(5);
    expect(O.getSpeed().kmh).toBe(60);
    O.disconnect(); // pending 解放・ポーリング停止 → 以降 _pendingResolve は null
    // 迷子の遅延応答(255km/h)が来ても破棄される
    mock.dispatch('41 0D FF\r>');
    await tick(5);
    expect(O.getSpeed().kmh).not.toBe(255);
  });

  it('Web Bluetooth 非対応環境では connect が reject し status=error', async () => {
    const O = loadOBD(undefined); // navigator.bluetooth なし
    expect(O.isSupported()).toBe(false);
    await expect(O.connect()).rejects.toBeTruthy();
    expect(O.getStatus()).toBe('error');
  });

  it('NO DATA / 別PID 応答では速度を更新しない', async () => {
    const mock = makeMockBluetooth({
      responder: (cmd) =>
        cmd.indexOf('AT') === 0 ? 'OK\r>' : cmd === '0100' ? '41 00 BE 3E B8 11\r>' : 'NO DATA\r>',
    });
    const O = loadOBD(mock.bluetooth);
    await O.connect();
    await tick();
    expect(O.getSpeed().valid).toBe(false); // NO DATA → 速度据え置き(初期invalid)
    O.disconnect();
  });
});

// 監査修正(M-1/M-2)のガードがソースから消えていないことの静的ガード
describe('OBDClient 監査修正の保全 (静的)', () => {
  const src = fs.readFileSync(OBD_PATH, 'utf8');
  it('M-1: _onNotify が待機中以外の通知を破棄するガードを持つ', () => {
    expect(/if\s*\(\s*!_pendingResolve\s*\)/.test(src)).toBe(true);
  });
  it('M-1: _send 冒頭で _rxBuffer をクリアする', () => {
    expect(/_rxBuffer\s*=\s*''/.test(src)).toBe(true);
  });
  it('M-2: _onDisconnected が pending を解放する', () => {
    const m = src.match(/function _onDisconnected[\s\S]*?\n {2}\}/);
    expect(m).toBeTruthy();
    expect(/_pendingResolve\s*=\s*null/.test(m[0])).toBe(true);
  });
});
