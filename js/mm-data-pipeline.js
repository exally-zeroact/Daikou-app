// ============================================================
// mm-data-pipeline.js (2026-05-13 新規)
// ★設計変更宣言: 起動時の段階的データロード制御
//   ダイコメ設計思想「全 47 県データを内包・どこでも即起動」を実現
//
// 段階:
//   Phase A: 全国共通データ (20 件) ロード (worker / main 振り分け)
//   Phase B: 47 県 roads データロード (worker・並列度 4)
//   Phase C: 47 県補助データ (tunnels / bridges / attrs 等) ロード (main・並列度 4)
//   Phase D: GPS 初回 fix 待ち (timeout 30 秒)
//   Phase E: MM warmup (worker から mmResult.committed=1 待ち・timeout 10 秒)
//
// API:
//   const pipeline = new MMDataPipeline({ worker, loader, onProgress });
//   await pipeline.warmup();
//   pipeline.ready の各フラグで状態確認
//
// 依存:
//   - window.DataLoader (data-loader.js)
//   - window.DataRegistry (data-registry.js)
//   - worker (map-matcher.js Worker instance)
// ============================================================

(function (global) {
  'use strict';

  const DEFAULT_CONCURRENCY = 4;
  const GPS_TIMEOUT_MS = 30000;
  // ★設計変更宣言 (2026-05-13): MM warmup timeout を 10000 → 5000ms に短縮
  //   走行中なら 1-3 秒で committed=true 来るため 5 秒で十分。
  //   屋内停車中で commit 来ない場合の待ち時間を半減 → 起動時間 -5 秒
  //   timeout 後も resolve するため致命的影響なし。
  const MM_WARMUP_TIMEOUT_MS = 5000;

  class MMDataPipeline {
    constructor(opts) {
      this.worker = (opts && opts.worker) || null;
      this.loader = (opts && opts.loader) || global.DataLoader;
      this.onProgress = (opts && opts.onProgress) || null;
      this.ready = {
        globalLoaded: false,
        roadsLoaded: false,
        auxLoaded: false,
        gpsAcquired: false,
        mmWarmed: false,
      };
      this.stats = {
        globalOk: 0,
        globalFailed: [],
        roadsOk: 0,
        roadsFailed: [],
        auxOk: 0,
        auxFailed: [],
      };
      this._gpsResolver = null;
      this._mmResolver = null;
      this._loadedWorkerPrefs = new Set(); // roadsLoaded 受信 pref 記録用
      // ★設計変更宣言 (2026-05-23・X4 方式E・即時+背景+priority load):
      //   _loadedPrefs: priority load 完了した・県 (= 重複 load 防止)
      //   _bgLoadStarted: background load 起動済 flag (= 多重起動防止)
      //   _bgLoadDone: background load 完了 flag (= 完了 後の・余計な priority skip 用)
      this._loadedPrefs = new Set();
      this._bgLoadStarted = false;
      this._bgLoadDone = false;
    }

    _emit(phase, current, total, label) {
      if (typeof this.onProgress === 'function') {
        try {
          this.onProgress({ phase, current, total, label });
        } catch (_) {
          // 進捗 callback の・例外で・load を・止めない (= 業務継続性最優先)
        }
      }
    }

    // ★設計変更宣言 (2026-05-13・Phase 1 修正1-A): retry 機構追加
    //   loadFromCache → eval → postMessage / window 代入の一連を 1 unit として
    //   network / cache miss / eval / postMessage 失敗を最大 3 回・2 秒間隔で retry
    //   最終失敗のみ stats.roadsFailed (等) に push される
    //   ロード信頼性向上 (例: 一時的 network 不安定・SW 未活性時の救済)
    async _loadOne(entry, isOptional) {
      const MAX_RETRY = 3;
      const RETRY_INTERVAL_MS = 2000;
      let lastReason = null;
      for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
        try {
          const data = await this.loader.loadFromCache(entry.url);
          const value = data[entry.globalKey];
          if (!value) {
            if (typeof dlog === 'function') {
              dlog('[Pipeline] ' + entry.url + ' 変数 ' + entry.globalKey + ' 未設定');
            }
            if (!isOptional) return { ok: false, entry: entry, reason: 'no global var' };
            return { ok: true, entry: entry, skipped: true };
          }
          if (entry.target === 'worker') {
            if (!this.worker) {
              return { ok: false, entry: entry, reason: 'worker not ready' };
            }
            if (entry.handler === 'loadRoadsBundle') {
              // roads は roadsData / pois / conditionalRestrictions に分割送信
              this.worker.postMessage({ type: 'loadRoads', pref: entry.pref, roadsData: value });
              if (Array.isArray(value.pois) && value.pois.length > 0) {
                this.worker.postMessage({ type: 'loadPois', pref: entry.pref, points: value.pois });
              }
              if (
                Array.isArray(value.conditionalRestrictions) &&
                value.conditionalRestrictions.length > 0
              ) {
                this.worker.postMessage({
                  type: 'loadConditionalRestrictions',
                  pref: entry.pref,
                  list: value.conditionalRestrictions,
                });
              }
            } else if (entry.msgType) {
              this.worker.postMessage({ type: entry.msgType, data: value });
            }
          } else if (entry.target === 'main') {
            // main 側で findNearest 等が読む既存 window グローバルへ
            global[entry.globalKey] = value;
          }
          if (attempt > 1 && typeof dlog === 'function') {
            dlog('[Pipeline] ' + entry.url + ' attempt ' + attempt + ' で成功');
          }
          return { ok: true, entry: entry };
        } catch (e) {
          lastReason = e && e.message;
          if (typeof dlog === 'function') {
            dlog(
              '[Pipeline] ' +
                entry.url +
                ' attempt ' +
                attempt +
                '/' +
                MAX_RETRY +
                ' 失敗: ' +
                lastReason
            );
          }
          if (attempt < MAX_RETRY) {
            await new Promise(function (r) {
              setTimeout(r, RETRY_INTERVAL_MS);
            });
          }
        }
      }
      // 全 attempt 失敗
      if (typeof dlog === 'function') {
        dlog('[Pipeline] ' + entry.url + ' 全 ' + MAX_RETRY + ' 回 retry 失敗・諦め');
      }
      return { ok: false, entry: entry, reason: lastReason };
    }

    async _loadParallel(entries, concurrency, phase) {
      const total = entries.length;
      const queue = entries.slice();
      let done = 0;
      const results = [];
      const workers = [];
      for (let i = 0; i < concurrency; i++) {
        workers.push(
          (async () => {
            while (queue.length > 0) {
              const e = queue.shift();
              const r = await this._loadOne(e, !!e.optional);
              results.push(r);
              done++;
              this._emit(phase, done, total, e.url);
            }
          })()
        );
      }
      await Promise.all(workers);
      return results;
    }

    async loadGlobalData() {
      const entries = global.DataRegistry.DATA_REGISTRY.global;
      const results = await this._loadParallel(entries, DEFAULT_CONCURRENCY, 'global');
      for (const r of results) {
        if (r.ok && !r.skipped) this.stats.globalOk++;
        else if (!r.ok) this.stats.globalFailed.push(r.entry.url);
      }
      this.ready.globalLoaded = true;
    }

    async loadRoadsData() {
      const def = global.DataRegistry.DATA_REGISTRY.perPref.find((d) => d.kind === 'roads');
      if (!def) return;
      const entries = global.DataRegistry.expandPerPref(def);
      const results = await this._loadParallel(entries, DEFAULT_CONCURRENCY, 'roads');
      for (const r of results) {
        if (r.ok) this.stats.roadsOk++;
        else this.stats.roadsFailed.push(r.entry.url);
      }
      this.ready.roadsLoaded = true;
    }

    async loadAuxData() {
      // ★設計変更宣言 (2026-05-23・住所① fine 配線・loadAuxData に 'addresses-fine' 追加):
      //   旧: auxKinds に・addresses-fine 無し → 起動時 background load で・fine 配線せず
      //       → window.ADDRESSES_FINE_{PREF}=undefined → getNearestAddress coarse fallback 止まり
      //   新: 'addresses-fine' を・auxKinds に・1 種別追加 (= data-registry L221-229 既登録)
      //       → background load で・全 47 県 fine 配信・priority load (X4) でも fine 即時 load
      //   絶対ルール準拠:
      //     ✓ distance_m / calcFare / Worker B 本体 / Kalman / Viterbi: 完全無関係
      //     ✓ Phase 制御 / load gate / postMessage は・1 byte 不変
      //     ✓ optional=true (= data-registry 登録時に・指定済)・404 等は・graceful fallback
      //     ✓ window.XXX 互換: addresses-fine entries は・既存 main target = global 代入で同一
      const auxKinds = [
        'tunnels',
        'bridges',
        'road-attrs',
        'road-flood',
        'road-jizen',
        'road-yobo',
        'addresses-fine',
        // ★設計変更宣言 (2026-05-23・住所① 案 C 高精度版・town-polygons 配線):
        //   data-registry 既登録の・町丁字 polygon を・auxKinds に追加。
        //   background load + priority load (= X4 _getPrefEntries) 両経路で・配信。
        //   business.js PIP 入力 = 住所判定主経路。distance_m / Worker B 本体は不変。
        'town-polygons',
      ];
      for (const kind of auxKinds) {
        const def = global.DataRegistry.DATA_REGISTRY.perPref.find((d) => d.kind === kind);
        if (!def) continue;
        const entries = global.DataRegistry.expandPerPref(def);
        const results = await this._loadParallel(entries, DEFAULT_CONCURRENCY, 'aux-' + kind);
        for (const r of results) {
          if (r.ok) this.stats.auxOk++;
          else this.stats.auxFailed.push(r.entry.url);
        }
      }
      this.ready.auxLoaded = true;
    }

    // GPS 初回 fix 待ち (外部から notifyGpsFix() で resolve される)
    async waitForGPS(timeoutMs) {
      if (this.ready.gpsAcquired) return;
      return new Promise((resolve) => {
        this._gpsResolver = resolve;
        const t = setTimeout(() => {
          if (this._gpsResolver) {
            this._gpsResolver = null;
            if (typeof dlog === 'function') dlog('[Pipeline] GPS timeout');
            resolve(); // タイムアウトでも resolve (後追い)
          }
        }, timeoutMs || GPS_TIMEOUT_MS);
        // resolve 時に clear するため保持
        this._gpsTimer = t;
      });
    }
    notifyGpsFix(lat, lng, accuracy) {
      this.ready.gpsAcquired = true;
      if (this._gpsResolver) {
        const r = this._gpsResolver;
        this._gpsResolver = null;
        if (this._gpsTimer) clearTimeout(this._gpsTimer);
        r();
      }
      // ★設計変更宣言 (2026-05-16・Step7・cache miss 検知 + 自動補修):
      //   GPS first fix のタイミングで RegionHelper を使い現在地県を判定。
      //   該当県の roads / aux データが warmup で load 失敗していて、かつオンラインなら
      //   enqueueRetry で再 fetch する。オフラインなら何もしない (= cache 内データのみ
      //   使用・絶対ルール「業務継続性最優先」遵守)。
      //   全 47 県一括 cache 戦略は不変・本機能は障害復旧の安全網のみ。
      //   distance_m / fare_yen / 業務ロジックには触れない (= データ層の補修)。
      //   引数 lat/lng/accuracy は optional・未指定なら従来動作のみ。
      if (typeof lat === 'number' && typeof lng === 'number') {
        try {
          this._checkAndRetryCurrentPref(lat, lng, accuracy);
        } catch (e) {
          // 補修失敗は業務継続性に影響させない (= silent fail)
          if (typeof dlog === 'function') {
            dlog('[Pipeline] _checkAndRetryCurrentPref error: ' + (e && e.message));
          }
        }
        // ★設計変更宣言 (2026-05-23・X4 方式E・現在地県 priority load):
        //   warmup() は全国共通のみで resolve した。 GPS first fix で現在地県を特定し
        //   該当県の全 perPref entries (roads + tunnels + bridges + road-attrs +
        //   road-flood + road-jizen + road-yobo + addresses-fine = 8 件) を
        //   最優先で並列 load → Worker B が・最速で・現在地県の・MM を開始可能。
        //   現在地県検出 fail (= GPS 精度悪 / 海上 / 国外) → 何もしない・background
        //   load の全 47 県 継続で・救済 (= 業務継続性 損なわず)。
        try {
          this._priorityLoadCurrentPref(lat, lng, accuracy);
        } catch (e) {
          // priority load 失敗は業務継続性に影響させない
          if (typeof dlog === 'function') {
            dlog('[Pipeline] _priorityLoadCurrentPref error: ' + (e && e.message));
          }
        }
      }
    }

    // ★設計変更宣言 (2026-05-16・Step7・現在地県の cache miss を再 fetch):
    //   オンライン時のみ動作・オフラインでは何もしない (= 既存 cache を信頼)。
    //   全 47 県戦略は維持・本機能は cache 失敗時の自動復旧のみ担当。
    // ★設計変更宣言 (2026-05-16・Step7 拡張・全失敗県を一括 retry):
    //   旧: 現在地県の URL のみ retry (= 隣県跨ぎで失敗継続)
    //   新: stats.roadsFailed / auxFailed の全 URL を一括 retry
    //   背景: 実機で roadsOk:4 (47県中4県のみ成功) が発生・43県失敗で Worker B が
    //         動作不可になる事象。GPS first fix を契機に全失敗 URL を再 fetch し、
    //         ネット復旧していれば全県 cache 完成 → Worker B 完全動作を目指す。
    //   absolute ルール準拠:
    //     ・オフライン時は何もしない (= 業務継続性最優先)
    //     ・全 47 県 cache 戦略は不変
    //     ・distance_m / fare_yen / 業務ロジックには触れない
    //     ・retry は既存 enqueueRetry 経路 (= 60 秒重複防止・3 回自動 retry)
    _checkAndRetryCurrentPref(lat, lng, accuracy) {
      // オフラインなら何もしない (= 業務継続性最優先・既存 cache を使う)
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (typeof dlog === 'function') dlog('[Pipeline] cache 補修 skip (offline)');
        return;
      }
      // 現在地県の判定 (= ログ用・retry 対象は全失敗 URL に拡張)
      let currentPref = null;
      if (
        typeof global.RegionHelper !== 'undefined' &&
        typeof global.RegionHelper.getCurrentPref === 'function'
      ) {
        currentPref = global.RegionHelper.getCurrentPref(lat, lng, accuracy);
      }
      // ★ stats.roadsFailed / auxFailed の全 URL を一括 retry (旧版の「現在地県のみ」を拡張)
      const failedRoads = (this.stats && this.stats.roadsFailed) || [];
      const failedAux = (this.stats && this.stats.auxFailed) || [];
      const allFailed = failedRoads.concat(failedAux);
      let retryCount = 0;
      for (const url of allFailed) {
        if (!url) continue;
        this.enqueueRetry(url).catch(function () {});
        retryCount++;
      }
      if (typeof dlog === 'function') {
        if (retryCount > 0) {
          dlog(
            '[Pipeline] cache 補修 起動 currentPref=' +
              (currentPref || 'unknown') +
              ' retryCount=' +
              retryCount +
              ' (online・全失敗 URL を一括 retry)'
          );
        } else {
          dlog(
            '[Pipeline] cache 補修 skip (no failed entries・currentPref=' +
              (currentPref || 'unknown') +
              ')'
          );
        }
      }
    }

    // MM warmup (worker から mmResult.committed=1 を 1 回受信で resolve)
    async waitForMMWarmup(timeoutMs) {
      if (this.ready.mmWarmed) return;
      return new Promise((resolve) => {
        this._mmResolver = resolve;
        const t = setTimeout(() => {
          if (this._mmResolver) {
            this._mmResolver = null;
            if (typeof dlog === 'function') dlog('[Pipeline] MM warmup timeout');
            resolve(); // タイムアウトでも resolve
          }
        }, timeoutMs || MM_WARMUP_TIMEOUT_MS);
        this._mmTimer = t;
      });
    }
    notifyMMCommit() {
      this.ready.mmWarmed = true;
      if (this._mmResolver) {
        const r = this._mmResolver;
        this._mmResolver = null;
        if (this._mmTimer) clearTimeout(this._mmTimer);
        r();
      }
    }

    // ★設計変更宣言 (2026-05-13・Phase 1 修正1-B): retry queue API
    //   SW から cachePutFailed 通知を受けた URL を再 load する method。
    //   data-registry から該当 entry を逆引きして _loadOne を再呼出。
    //   _loadOne 内部の retry 機構 (修正1-A) で 3 回まで自動 retry。
    //   重複防止: 直前 60 秒以内に同 URL が enqueue 済なら skip。
    _findEntryByUrl(url) {
      try {
        const path = new URL(url, global.location ? global.location.href : 'https://x/').pathname;
        const reg = global.DataRegistry;
        if (!reg) return null;
        // global entries
        for (const e of reg.DATA_REGISTRY.global) {
          if (e.url === path) return e;
        }
        // perPref entries (展開して検索)
        for (const def of reg.DATA_REGISTRY.perPref) {
          const entries = reg.expandPerPref(def);
          for (const e of entries) {
            if (e.url === path) return e;
          }
        }
      } catch (_) {
        // URL 解析失敗 (= 不正 url 等) → null fallback
      }
      return null;
    }
    async enqueueRetry(url) {
      if (!url) return;
      // 重複防止: cooldown 60 秒
      if (!this._retryCooldown) this._retryCooldown = new Map();
      const now = Date.now();
      const last = this._retryCooldown.get(url) || 0;
      if (now - last < 60000) {
        if (typeof dlog === 'function') dlog('[Pipeline] enqueueRetry skip (cooldown): ' + url);
        return;
      }
      this._retryCooldown.set(url, now);
      const entry = this._findEntryByUrl(url);
      if (!entry) {
        if (typeof dlog === 'function') dlog('[Pipeline] enqueueRetry: entry 見つからず ' + url);
        return;
      }
      if (typeof dlog === 'function') dlog('[Pipeline] enqueueRetry 起動: ' + url);
      // _loadOne 内で 3 回 retry が走る (修正1-A)
      await this._loadOne(entry, !!entry.optional);
    }

    // ─────────────────────────────────────────────────────────────
    // ★ X4 方式E・新規 method 群 (2026-05-23)
    // ─────────────────────────────────────────────────────────────

    // ★ background load の trigger (= requestIdleCallback / setTimeout)
    //   warmup() resolve 直後・fire-and-forget で・残り 47 県 roads + 282 件 aux を gradually load。
    //   多重起動防止 (= _bgLoadStarted)。
    _scheduleBackgroundLoad() {
      if (this._bgLoadStarted) return;
      this._bgLoadStarted = true;
      const self = this;
      const start = function () {
        self._backgroundLoadAll().catch(function (e) {
          if (typeof dlog === 'function') {
            dlog('[Pipeline] bg load error: ' + (e && e.message));
          }
        });
      };
      // requestIdleCallback (= iOS Safari 16.4+ / Android Chrome 全対応)
      // 未対応 (= iOS Safari 16.3 以下) は setTimeout fallback
      if (typeof requestIdleCallback === 'function') {
        try {
          requestIdleCallback(start, { timeout: 5000 });
        } catch (_) {
          setTimeout(start, 100);
        }
      } else {
        setTimeout(start, 100);
      }
    }

    // ★ background で・47 県 roads + 補助 6 種 を・gradually load
    //   既存 loadRoadsData / loadAuxData を・呼ぶだけ (= 既 method 流用・無重複)
    //   既 priority load 済 県 (= _loadedPrefs に含まれる) は・loadRoadsData / loadAuxData
    //   が・worker / window グローバル代入を再実行しても・既 load 済 data が・上書きされるだけ・
    //   挙動は・変わらない (= window.XXX 互換 維持)。重複 fetch コストのみ発生・許容。
    async _backgroundLoadAll() {
      const t0 = Date.now();
      if (typeof dlog === 'function') dlog('[Pipeline] background load 開始');
      // Phase B: 47 県 roads
      await this.loadRoadsData();
      if (typeof dlog === 'function') {
        dlog(
          '[Pipeline] Phase B (bg) 完了 ok=' +
            this.stats.roadsOk +
            ' failed=' +
            this.stats.roadsFailed.length
        );
      }
      // Phase C: 47 県 × 6 種 補助
      await this.loadAuxData();
      if (typeof dlog === 'function') {
        dlog(
          '[Pipeline] Phase C (bg) 完了 ok=' +
            this.stats.auxOk +
            ' failed=' +
            this.stats.auxFailed.length
        );
      }
      // ★設計変更宣言 (2026-05-17・症状A 修正・Phase B/C 完了直後の自動 retry):
      //   X4 でも・同じ retry 経路を・background load 完了後に維持。
      //   失敗 URL を・on-demand 経路 (= enqueueRetry) に・流す。
      if (typeof navigator === 'undefined' || navigator.onLine !== false) {
        const _failedRoads = (this.stats && this.stats.roadsFailed) || [];
        const _failedAux = (this.stats && this.stats.auxFailed) || [];
        const _allFailed = _failedRoads.concat(_failedAux);
        let _retryCount = 0;
        for (const url of _allFailed) {
          if (!url) continue;
          this.enqueueRetry(url).catch(function () {});
          _retryCount++;
        }
        if (typeof dlog === 'function' && _retryCount > 0) {
          dlog(
            '[Pipeline] bg load 完了 retry 起動 count=' + _retryCount + ' (= 失敗 URL 一括 retry)'
          );
        }
      } else if (typeof dlog === 'function') {
        dlog('[Pipeline] bg load 完了 retry skip (offline)');
      }
      this._bgLoadDone = true;
      const dur = Date.now() - t0;
      if (typeof dlog === 'function') dlog('[Pipeline] background load 完了: ' + dur + 'ms');
    }

    // ★ 現在地県の・全 perPref entries を・priority load
    //   GPS first fix の・lat/lng から RegionHelper.getCurrentPref で・現在地県判定。
    //   該当県の・roads + tunnels + bridges + road-attrs + road-flood + road-jizen +
    //   road-yobo + addresses-fine = 最大 8 件 を・並列 8 で・即時 load。
    //   既 _loadedPrefs に・含まれてれば・skip (= 重複防止)。
    //   検出失敗 (= null) → 何もしない (= background load 継続で・救済)。
    async _priorityLoadCurrentPref(lat, lng, accuracy) {
      // 既に priority load 完了済の県は skip
      let currentPref = null;
      if (
        typeof global.RegionHelper !== 'undefined' &&
        typeof global.RegionHelper.getCurrentPref === 'function'
      ) {
        currentPref = global.RegionHelper.getCurrentPref(lat, lng, accuracy);
      }
      if (!currentPref) {
        if (typeof dlog === 'function') {
          dlog('[Pipeline] priority load skip (= currentPref 検出 fail)');
        }
        return;
      }
      if (this._loadedPrefs.has(currentPref)) {
        if (typeof dlog === 'function') {
          dlog('[Pipeline] priority load skip (= ' + currentPref + ' 既 load 済)');
        }
        return;
      }
      const entries = this._getPrefEntries(currentPref);
      if (!entries || entries.length === 0) {
        if (typeof dlog === 'function') {
          dlog('[Pipeline] priority load skip (= ' + currentPref + ' entries 0)');
        }
        return;
      }
      this._loadedPrefs.add(currentPref);
      if (typeof dlog === 'function') {
        dlog('[Pipeline] priority load 開始 ' + currentPref + ' entries=' + entries.length);
      }
      // 並列度 8 (= 該当県の 8 entries を 1 度に load)
      const results = await this._loadParallel(entries, entries.length, 'priority-' + currentPref);
      const ok = results.filter(function (r) {
        return r.ok;
      }).length;
      if (typeof dlog === 'function') {
        dlog('[Pipeline] priority load 完了 ' + currentPref + ' ok=' + ok + '/' + entries.length);
      }
    }

    // ★ 特定県の・全 perPref entries を返す (= roads + tunnels + bridges + road-attrs +
    //   road-flood + road-jizen + road-yobo + addresses-fine = 最大 8 件)
    _getPrefEntries(pref) {
      const result = [];
      try {
        const reg = global.DataRegistry;
        if (!reg) return result;
        for (const def of reg.DATA_REGISTRY.perPref) {
          const entries = reg.expandPerPref(def);
          for (const e of entries) {
            if (e.pref === pref) {
              result.push(e);
              break;
            }
          }
        }
      } catch (_) {
        // DataRegistry 未 load 等 → 空 array fallback (= priority load skip)
      }
      return result;
    }

    // ★ 県別 load 状態 確認 API (= future use・on-demand fallback 用)
    getPrefStatus(pref) {
      return {
        loaded: this._loadedPrefs.has(pref),
        bgLoadStarted: this._bgLoadStarted,
        bgLoadDone: this._bgLoadDone,
      };
    }

    // ★設計変更宣言 (2026-06-05・★Worker B 再起動時の roads 再 forward・しまなみ SE 距離フリーズ根治★):
    //   Worker B は iOS で画面ロック/バックグラウンドにより suspend され、visibility ping watchdog が
    //   ★新しい Worker に作り直す★ことがある。だが旧実装は新 Worker に ★道路データを再 load しない★ため
    //   (loaded=0県/0本)、全 snap が失敗し distance が永久フリーズ (実機 SE: 34km 走行で 1.6km しか計上=−95%)。
    //   本 method = 新 Worker に、これまで load 済の ★全 worker-target データ (global + _loadedPrefs の県別
    //   roads/pois/aux)★ を ★cache から★再送する (= 高速・オフラインでも cache 内なら成功)。
    //   絶対ルール準拠: 既存 _loadOne の postMessage 経路をそのまま使う・distance_m / calcFare / Viterbi
    //   本体は 1 byte 不変・新 Worker の状態を ★元の Worker と同一に戻すだけ★。
    async reforwardToWorker(newWorker) {
      if (!newWorker) return;
      this.worker = newWorker; // 以降の priority/background load も新 Worker へ向ける
      this._loadedWorkerPrefs = new Set(); // 新 Worker は roadsLoaded 未受信状態
      const tasks = [];
      try {
        // (1) 全国共通の worker-target データ (backbone / DEM 等)
        const g = global.DataRegistry && global.DataRegistry.DATA_REGISTRY;
        if (g && Array.isArray(g.global)) {
          for (const e of g.global) {
            if (e && e.target === 'worker') tasks.push(e);
          }
        }
      } catch (_) {
        /* registry 未 load → 県別のみ再送 */
      }
      // (2) これまで load 済の全県の worker-target entries (roads/pois/conditionalRestrictions/aux)
      for (const pref of Array.from(this._loadedPrefs)) {
        const entries = this._getPrefEntries(pref);
        for (const e of entries) {
          if (e && e.target === 'worker') tasks.push(e);
        }
      }
      if (typeof dlog === 'function') {
        dlog(
          '[Pipeline] reforwardToWorker 開始: ' +
            tasks.length +
            ' entries / ' +
            this._loadedPrefs.size +
            '県 (Worker 再起動 recovery)'
        );
      }
      // optional=true で送る (= 1 件失敗しても他を止めない・業務継続性最優先)。並列度は控えめ。
      const results = await this._loadParallel(tasks, DEFAULT_CONCURRENCY, 'reforward');
      const ok = results.filter((r) => r.ok).length;
      if (typeof dlog === 'function') {
        dlog('[Pipeline] reforwardToWorker 完了: ok=' + ok + '/' + tasks.length);
      }
      return { ok, total: tasks.length };
    }

    async warmup() {
      // ★設計変更宣言 (2026-05-13): warmup 多重起動ガード
      //   visibility 復帰 / bfcache / 想定外の再呼出で warmup が再実行される事故を防ぐ。
      //   既に起動済なら同じ Promise を返して全 phase 重複実行を回避。
      if (this._warmupStarted) {
        if (typeof dlog === 'function') dlog('[Pipeline] warmup 既に起動済・skip');
        return this._warmupPromise || Promise.resolve();
      }
      this._warmupStarted = true;
      this._warmupPromise = this._warmupInternal();
      return this._warmupPromise;
    }

    async _warmupInternal() {
      const t0 = Date.now();
      if (typeof dlog === 'function') dlog('[Pipeline] warmup 開始 (= X4 方式E)');
      // Phase A: 全国共通 (= 必須・即時)
      await this.loadGlobalData();
      if (typeof dlog === 'function') {
        dlog(
          '[Pipeline] Phase A 完了 ok=' +
            this.stats.globalOk +
            ' failed=' +
            this.stats.globalFailed.length
        );
      }
      // ★設計変更宣言 (2026-05-23・X4 方式E・即時+背景遅延・mm-data-pipeline.js 改造):
      //   旧 (= 2026-05-13 同期化): Phase A → await B (= 47 県 roads) → await C (= 282 件 aux)
      //       → 全 60+282 件 await で・起動 10-25 秒 (= 律速)・index.html overlay は・閉じない
      //   新 (= X4 方式E): Phase A 完了で warmup() resolve・overlay 閉じる
      //       Phase B (= 47 県 roads) + Phase C (= 282 件 aux) は・background fire-and-forget
      //       GPS first fix → 現在地県 priority load (= notifyGpsFix → _priorityLoadCurrentPref)
      //       未 load 県は・on-demand fetch (= 既存 enqueueRetry 経路)
      //   絶対ルール準拠:
      //     ✓ window.XXX 互換 完全維持 (= load 順序のみ変更・出力 sandbox / postMessage 同一)
      //     ✓ distance_m / 課金 / Worker B 本体 logic 完全無関係
      //     ✓ 現在地県検出 fail → background 全 47 load 継続で・救済 (= 業務継続性最優先)
      //     ✓ 業務中 未 load 県 → on-demand priority load (= 既存 enqueueRetry)
      //     ✓ iOS Safari / Android Chrome 共通 (= 既存 RegionHelper / async API のみ)
      this._scheduleBackgroundLoad();
      // ★設計変更宣言 (2026-05-13・Phase D/E を warmup から外す):
      //   旧: Phase D (waitForGPS) + Phase E (waitForMMWarmup) を warmup() で待つ
      //   問題: startGPS() は「業務開始」ボタンで呼ばれる仕様 (index.html:2739 参照)
      //   → warmup 時点では watchPosition 未起動 → notifyGpsFix が永遠に呼ばれない
      //   → Phase D は 30 秒 timeout まで無駄待ち、Phase E も commit 来ず timeout
      //   新: warmup() は Phase A/B/C (データ DL) のみで完了
      //   GPS / MM warmup は業務開始ボタン押下後の通常フローに任せる (仕様通り)
      //   waitForGPS / waitForMMWarmup / notifyGpsFix / notifyMMCommit は別用途
      //   (将来 driving 画面で進捗 UI 等が必要になった時) のため method 自体は残置
      const dur = Date.now() - t0;
      if (typeof dlog === 'function') dlog('[Pipeline] warmup 完了: ' + dur + 'ms');
      // ★設計変更宣言 (2026-05-13・warmup 完了マーカー永続化):
      //   旧: this.ready がインスタンス変数 = ページ再ロードで揮発
      //       → 履歴→戻る等で / 再ロード = 毎回 warmup 全実行 + overlay 表示
      //   新: localStorage に完了マーカーを永続化
      //   起動時に index.html 側がマーカー確認 → 有 = overlay skip + warmup bg
      //   バージョン: DataRegistry.VERSION (構造変更時に bump で invalidate)
      try {
        const reg = global.DataRegistry;
        const marker = {
          version: (reg && reg.VERSION) || '0',
          ts: Date.now(),
          globalOk: this.stats.globalOk,
          roadsOk: this.stats.roadsOk,
          auxOk: this.stats.auxOk,
          durMs: dur,
        };
        if (typeof global.localStorage !== 'undefined') {
          global.localStorage.setItem('daikome_warmup_v1', JSON.stringify(marker));
          if (typeof dlog === 'function')
            dlog('[Pipeline] 完了マーカー永続化 ' + JSON.stringify(marker));
        }
      } catch (e) {
        if (typeof dlog === 'function') dlog('[Pipeline] マーカー保存失敗: ' + (e && e.message));
      }
    }
  }

  global.MMDataPipeline = MMDataPipeline;
})(
  typeof window !== 'undefined'
    ? window
    : typeof self !== 'undefined'
      ? self
      : typeof globalThis !== 'undefined'
        ? globalThis
        : this
);
