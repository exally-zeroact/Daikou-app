// tests/unit/veh-registry.test.js
// ★車レジストリ(多台＋車別K永続)★ 純ロジックを fake storage で検証。distance_m/課金に無関係。
const VR = require('../../js/veh-registry.js');

// localStorage 互換の fake(Map)。
function fakeStore(seed) {
  const m = new Map(Object.entries(seed || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _dump: () => Object.fromEntries(m),
  };
}

describe('VehRegistry 移行(単一→リスト)', () => {
  it('旧 dk_veh_active(単一) を 1台目としてリスト化し active に設定', () => {
    const s = fakeStore({
      dk_veh_active: JSON.stringify({
        model: 'アルト',
        tire: '155/65R14',
        calibKs: [1.018, 1.02, 1.016],
      }),
    });
    const l = VR.migrate(s);
    expect(l.length).toBe(1);
    expect(l[0].id).toBe('v1');
    expect(l[0].name).toBe('アルト'); // name 無し→model で補完
    expect(VR.getActiveId(s)).toBe('v1');
    expect(VR.getCalibKs(s, 'v1')).toEqual([1.018, 1.02, 1.016]); // ★旧Kが消えない★
  });

  it('旧データ無し→空リスト・冪等(2回呼んでも壊れない)', () => {
    const s = fakeStore({});
    expect(VR.migrate(s)).toEqual([]);
    VR.save(s, { name: 'A' });
    expect(VR.migrate(s).length).toBe(1); // 既存listは触らない
  });
});

describe('VehRegistry CRUD', () => {
  it('追加=連番id・更新=同id上書き・名前補完', () => {
    const s = fakeStore({});
    const a = VR.save(s, { name: 'アルト' });
    const b = VR.save(s, { name: '司の軽' });
    expect(a.id).toBe('v1');
    expect(b.id).toBe('v2');
    expect(VR.list(s).length).toBe(2);
    // 更新
    VR.save(s, { id: 'v1', name: 'アルト改', calibKs: [1.02, 1.03, 1.025] });
    expect(VR.get(s, 'v1').name).toBe('アルト改');
    expect(VR.list(s).length).toBe(2); // 増えない
  });

  it('★改名してもKは保持(idがキー・名前は表示用)★', () => {
    const s = fakeStore({});
    const a = VR.save(s, { name: 'アルト', calibKs: [1.018, 1.02, 1.016] });
    VR.save(s, { id: a.id, name: '白いやつ', calibKs: VR.getCalibKs(s, a.id) });
    expect(VR.get(s, a.id).name).toBe('白いやつ');
    expect(VR.getCalibKs(s, a.id)).toEqual([1.018, 1.02, 1.016]); // Kは消えない
  });

  it('削除=リストから除外・active削除なら先頭へ', () => {
    const s = fakeStore({});
    VR.save(s, { id: 'v1', name: 'A' });
    VR.save(s, { id: 'v2', name: 'B' });
    VR.setActive(s, 'v2');
    VR.remove(s, 'v2');
    expect(VR.list(s).length).toBe(1);
    expect(VR.getActiveId(s)).toBe('v1'); // active消えたら先頭
  });

  it('全削除→active=null', () => {
    const s = fakeStore({});
    VR.save(s, { id: 'v1', name: 'A' });
    VR.remove(s, 'v1');
    expect(VR.list(s)).toEqual([]);
    expect(VR.getActiveId(s)).toBeNull();
  });
});

describe('VehRegistry active 選択', () => {
  it('未選択なら先頭をactive扱い・存在しないidは選べない', () => {
    const s = fakeStore({});
    VR.save(s, { id: 'v1', name: 'A' });
    VR.save(s, { id: 'v2', name: 'B' });
    const s2 = fakeStore(s._dump());
    s2.removeItem('dk_veh_active_id');
    expect(VR.getActive(s2).id).toBe('v1'); // 未選択→先頭
    expect(VR.setActive(s2, 'nope')).toBe(false); // 不正idは拒否
    expect(VR.setActive(s2, 'v2')).toBe(true);
    expect(VR.getActive(s2).id).toBe('v2');
  });

  it('車別 calibKs の保存/取得', () => {
    const s = fakeStore({});
    VR.save(s, { id: 'v1', name: 'A' });
    expect(VR.getCalibKs(s, 'v1')).toEqual([]);
    VR.setCalibKs(s, 'v1', [1.02, 1.025, 1.03]);
    expect(VR.getCalibKs(s, 'v1')).toEqual([1.02, 1.025, 1.03]);
    // 別車には影響しない
    VR.save(s, { id: 'v2', name: 'B' });
    expect(VR.getCalibKs(s, 'v2')).toEqual([]);
  });
});
