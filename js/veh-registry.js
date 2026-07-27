// js/veh-registry.js
// ★車レジストリ (2026-06-26・多台対応＋車別K永続)★
//   司さんの「6台を回しても各車一生に1回較正→以降ロードだけ」を成立させる保存層。
//   保存を「1台(dk_veh_active 単一)」→「リスト(dk_veh_list 配列)」へ移行し、各車に calibKs(較正Ks)を持たせる。
//   ★純ロジック(storage を引数注入)=Node で単体テスト可。distance_m/課金には一切触れない(表示/保存層のみ)。★
//   キー: dk_veh_list(配列) / dk_veh_active_id(選択中の車id) / dk_veh_active(旧・単一・移行元)。
//   id は名前でなく安定な内部id(v1,v2,…)=★改名してもKが消えない★(名前=表示用)。
(function (root, factory) {
  // eslint-disable-next-line no-undef
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VehRegistry = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const LIST_KEY = 'dk_veh_list';
  const ACTIVE_KEY = 'dk_veh_active_id';
  const LEGACY_KEY = 'dk_veh_active';

  function _read(store, key) {
    try {
      return JSON.parse(store.getItem(key) || 'null');
    } catch (_) {
      return null;
    }
  }
  function _write(store, key, val) {
    try {
      store.setItem(key, JSON.stringify(val));
    } catch (_) {
      /* storage不可は無害(次回再試行) */
    }
  }
  // 衝突しない安定id(v+連番)。既存の最大連番+1。Date/randomを使わない=再現性あり。
  function _genId(existing) {
    let max = 0;
    for (let i = 0; i < existing.length; i++) {
      const id = existing[i] && existing[i].id;
      const m = typeof id === 'string' && /^v(\d+)$/.exec(id);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
    return 'v' + (max + 1);
  }

  // 旧 dk_veh_active(単一) → dk_veh_list(配列) へ一度だけ移行。既に list があれば触らない(冪等)。
  function migrate(store) {
    let l = _read(store, LIST_KEY);
    if (Array.isArray(l)) return l;
    l = [];
    const legacy = _read(store, LEGACY_KEY);
    if (legacy && (legacy.name || legacy.model || legacy.katashiki || legacy.tire)) {
      const car = Object.assign({}, legacy);
      if (!car.id) car.id = 'v1';
      if (!car.name) car.name = car.model || car.katashiki || '1台目';
      if (!Array.isArray(car.calibKs)) car.calibKs = [];
      l.push(car);
      _write(store, LIST_KEY, l);
      if (!_read(store, ACTIVE_KEY)) _write(store, ACTIVE_KEY, car.id);
    } else {
      _write(store, LIST_KEY, l);
    }
    return l;
  }

  function list(store) {
    const l = _read(store, LIST_KEY);
    return Array.isArray(l) ? l : migrate(store);
  }
  function get(store, id) {
    const l = list(store);
    for (let i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  function getActiveId(store) {
    return _read(store, ACTIVE_KEY) || null;
  }
  // 選択中の車。未選択/不正なら先頭。1台も無ければ null。
  function getActive(store) {
    const id = getActiveId(store);
    const l = list(store);
    if (id) {
      for (let i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    }
    return l.length ? l[0] : null;
  }
  function setActive(store, id) {
    if (get(store, id)) {
      _write(store, ACTIVE_KEY, id);
      return true;
    }
    return false;
  }
  // id 無し=新規採番して追加 / id 有り=更新。名前空なら model/katashiki/id で補完。返り=保存後の car。
  function save(store, car) {
    const l = list(store);
    car = Object.assign({}, car);
    if (!Array.isArray(car.calibKs)) car.calibKs = [];
    if (!car.id) {
      car.id = _genId(l);
      l.push(car);
    } else {
      let found = false;
      for (let i = 0; i < l.length; i++) {
        if (l[i].id === car.id) {
          l[i] = car;
          found = true;
          break;
        }
      }
      if (!found) l.push(car);
    }
    if (!car.name) car.name = car.model || car.katashiki || car.id;
    _write(store, LIST_KEY, l);
    if (!getActiveId(store)) _write(store, ACTIVE_KEY, car.id);
    return car;
  }
  function remove(store, id) {
    const l = list(store).filter(function (c) {
      return c.id !== id;
    });
    _write(store, LIST_KEY, l);
    if (getActiveId(store) === id) _write(store, ACTIVE_KEY, l.length ? l[0].id : null);
    return l;
  }
  // ★車別K(calibKs)★: 較正完了で setCalibKs 保存→接続/選択で getCalibKs ロード(=一度較正→ずっと正確)。
  function getCalibKs(store, id) {
    const c = get(store, id);
    return c && Array.isArray(c.calibKs) ? c.calibKs : [];
  }
  function setCalibKs(store, id, ks) {
    const c = get(store, id);
    if (!c) return false;
    c.calibKs = Array.isArray(ks) ? ks : [];
    save(store, c);
    return true;
  }

  return {
    migrate: migrate,
    list: list,
    get: get,
    getActiveId: getActiveId,
    getActive: getActive,
    setActive: setActive,
    save: save,
    remove: remove,
    getCalibKs: getCalibKs,
    setCalibKs: setCalibKs,
    _genId: _genId,
  };
});
