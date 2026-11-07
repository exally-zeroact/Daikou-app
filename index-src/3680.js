      // ★設計変更宣言 (2026-05-14・MA-4 settings overlay 動作 JS):
      //   元 settings.html の <script> ロジック (常時表示部分のみ) を index.html に取り込み。
      //   公開関数は window._st_ prefix で attach し、既存 toggleSurcharge / saveAll 等
      //   (index.html 業務側) との衝突を完全回避。内部状態は IIFE クロージャに封じ込め。
      //   起動時 1 回 _init で resetTime input / training トグル / DL 状況を反映する。
      //   overlay 表示 (window.showOverlay('settings')) は MA-6 で wire up・本 phase は
      //   Eruda Console テスト経由で動作確認可能。
      (function () {
        const PREFECTURES_DL = [
          'hokkaido',
          'aomori',
          'iwate',
          'miyagi',
          'akita',
          'yamagata',
          'fukushima',
          'ibaraki',
          'tochigi',
          'gunma',
          'saitama',
          'chiba',
          'tokyo',
          'kanagawa',
          'niigata',
          'toyama',
          'ishikawa',
          'fukui',
          'yamanashi',
          'nagano',
          'gifu',
          'shizuoka',
          'aichi',
          'mie',
          'shiga',
          'kyoto',
          'osaka',
          'hyogo',
          'nara',
          'wakayama',
          'tottori',
          'shimane',
          'okayama',
          'hiroshima',
          'yamaguchi',
          'tokushima',
          'kagawa',
          'ehime',
          'kochi',
          'fukuoka',
          'saga',
          'nagasaki',
          'kumamoto',
          'oita',
          'miyazaki',
          'kagoshima',
          'okinawa',
        ];
        const PREF_EN_TO_JP = {
          hokkaido: '北海道',
          aomori: '青森',
          iwate: '岩手',
          miyagi: '宮城',
          akita: '秋田',
          yamagata: '山形',
          fukushima: '福島',
          ibaraki: '茨城',
          tochigi: '栃木',
          gunma: '群馬',
          saitama: '埼玉',
          chiba: '千葉',
          tokyo: '東京',
          kanagawa: '神奈川',
          niigata: '新潟',
          toyama: '富山',
          ishikawa: '石川',
          fukui: '福井',
          yamanashi: '山梨',
          nagano: '長野',
          gifu: '岐阜',
          shizuoka: '静岡',
          aichi: '愛知',
          mie: '三重',
          shiga: '滋賀',
          kyoto: '京都',
          osaka: '大阪',
          hyogo: '兵庫',
          nara: '奈良',
          wakayama: '和歌山',
          tottori: '鳥取',
          shimane: '島根',
          okayama: '岡山',
          hiroshima: '広島',
          yamaguchi: '山口',
          tokushima: '徳島',
          kagawa: '香川',
          ehime: '愛媛',
          kochi: '高知',
          fukuoka: '福岡',
          saga: '佐賀',
          nagasaki: '長崎',
          kumamoto: '熊本',
          oita: '大分',
          miyazaki: '宮崎',
          kagoshima: '鹿児島',
          okinawa: '沖縄',
        };
        let _toastTimer = null;

        function _showToast(msg) {
          const t = document.getElementById('_st_settingsToast');
          // ★設定画面が 閉じている 時は 走行画面の #toast へ★（10-12）
          //   この 箱は #overlaySettings の 中＝閉じていると 見えない。業務終了の「事務所に送りました」・
          //   便の 直しの「直しました」は 設定画面の 外で 呼ばれ、一度も 見えていなかった。
          const ov = document.getElementById('overlaySettings');
          const hiraiteiru = !!ov && ov.getClientRects().length > 0;
          if ((!t || !hiraiteiru) && typeof window.showToast === 'function') {
            window.showToast(msg);
            return;
          }
          if (!t) return;
          t.textContent = msg;
          t.classList.add('show');
          if (_toastTimer) clearTimeout(_toastTimer);
          _toastTimer = setTimeout(function () {
            t.classList.remove('show');
            _toastTimer = null;
          }, 2500);
        }
        // ★別のスクリプト塊からも使えるようにする (2026-08-04)★
        //   メーターの控えを戻した時に「前回の続きから 1,850円 / 5.3km」を出すため。
        //   ★トーストの実装を2つ持たない★（表示がバラつくと運転手が混乱する）。
        window._showToast = _showToast;

        function _trainingIsEnabled() {
          try {
            const explicit = localStorage.getItem('daikome_training_enabled');
            if (explicit !== null) return explicit === 'true';
            const consent = localStorage.getItem('daikome_training_consent');
            return consent !== null;
          } catch (_) {
            return false;
          }
        }
        function _refreshTrainingToggleUI() {
          const tg = document.getElementById('_st_trainingToggle');
          if (!tg) return;
          if (_trainingIsEnabled()) tg.classList.add('on');
          else tg.classList.remove('on');
        }
        function _trainingGetDeviceId() {
          try {
            return localStorage.getItem('daikome_anonymous_id') || null;
          } catch (_) {
            return null;
          }
        }
        function _trainingClearIndexedDB() {
          return new Promise(function (resolve) {
            if (typeof indexedDB === 'undefined') return resolve(0);
            try {
              const req = indexedDB.open('daikome-training', 1);
              req.onsuccess = function (e) {
                const db = e.target.result;
                try {
                  if (!db.objectStoreNames.contains('samples')) {
                    db.close();
                    return resolve(0);
                  }
                  const tx = db.transaction(['samples'], 'readwrite');
                  const store = tx.objectStore('samples');
                  const cnt = store.count();
                  let n = 0;
                  cnt.onsuccess = function () {
                    n = cnt.result;
                  };
                  store.clear();
                  tx.oncomplete = function () {
                    db.close();
                    resolve(n);
                  };
                  tx.onerror = function () {
                    db.close();
                    resolve(0);
                  };
                } catch (_) {
                  db.close();
                  resolve(0);
                }
              };
              req.onerror = function () {
                resolve(0);
              };
            } catch (_) {
              resolve(0);
            }
          });
        }

        // ★設計変更宣言 (2026-05-29 PM rev3・アプリ バージョン表示):
        //   司さん指示「CACHE_NAME どこ？」 で・設定画面に SW CACHE_NAME を表示。
        //   sw.js の message handler ({ type: 'GET_CACHE_NAME' }) に MessageChannel で問合せ。
        //   SW 未登録 (= 開発環境 / 初回 install 直後) は「(SW 未登録)」 表示で fallback。
        // ★どのアプリを開いているか（本番／テスト用）を 版と一緒に出す★ 2026-08-21
        //   ホーム画面アプリ(PWA)は ★アドレスバーが出ない★＝司さんが自分で確かめる道が無かった。
        //   ⇒ ★アプリの中に出す★（判定は location.host＝中の設定を信じない）
        // ★★本番には 何も 付けない★★ 2026-09-09
        //   ★司さん★「バージョンも 本番って いれるな
        //     テスト版には テストって 入れて ええけど」
        //   ★前★ 版 ＋「本番」＋ 配り先
        //   ★今★ 本番は ★何も 付けない★（版 ＋ 配り先）
        //   ★テストは 今まで通り★
        //   ★一番 高い 事故＝本番に「テスト用」と 出る★ は 今まで通り 起きません
        //     （判定は location.host＝中の 設定を 信じない）
        function _envLabel() {
          const h = location.host || '';
          // ★★枝ごとの 配信も 拾う★★ 2026-09-09（監査で 見つけた 穴）
          //   ★前★ /-test\./ と /-test$/ だけ
          //     ⇒ ★daikou-app-test-git-obd-…vercel.app★（テスト線の 枝ごとの 配信）が
          //       素通りして ★「本番」と 出ていた★＝一番 危ない 出方。
          //   ★今★ ★-test- も 拾う★（本番の 配り先に -test- は 1つも 無い事を 実測）
          //     daikou-app.vercel.app ／ daikome-jimusho.vercel.app
          if (/-test[.\-]/.test(h) || /-test$/.test(h)) return 'テスト用';
          // ★★枝ごとの 配信は『確かめ用』と 出す★★ 2026-09-10（指示役の 監査③）
          //   ★塞げていなかった 向き★
          //     daikou-app-git-<枝>-…vercel.app（★本番repo の 枝配信★）は
          //     -test- を 1つも 含まないので ★本番と 同じ 見た目★だった。
          //     ⇒ 司さんが 確かめ用の 配信を 開いて ★本番だと 思い込む★。
          //   ★本番の 配り先は -git- を 持ちません★（試験で 固定）
          if (/-git-/.test(h)) return '確かめ用';
          return '';
        }
        function _withEnv(v) {
          const e = _envLabel();
          return v + (e ? '  /  ' + e : '') + '  /  ' + (location.host || '');
        }
        function _loadAppVersion() {
          const el = document.getElementById('_st_appVersionLine');
          if (!el) return;
          if (!navigator.serviceWorker || !navigator.serviceWorker.controller) {
            el.textContent = _withEnv('(SW 未登録)');
            return;
          }
          let received = false;
          try {
            const ch = new MessageChannel();
            ch.port1.onmessage = function (ev) {
              received = true;
              if (ev && ev.data && ev.data.type === 'CACHE_NAME' && ev.data.value) {
                el.textContent = _withEnv(ev.data.value);
                window.DK_SW_CACHE = ev.data.value; // ★自己診断trace用にビルド名を保持
              } else {
                el.textContent = _withEnv('(取得失敗)');
              }
            };
            navigator.serviceWorker.controller.postMessage({ type: 'GET_CACHE_NAME' }, [ch.port2]);
            setTimeout(function () {
              if (!received) el.textContent = _withEnv('(応答なし)');
            }, 2000);
          } catch (_) {
            el.textContent = _withEnv('(取得失敗)');
          }
        }

        async function _loadDlStatus() {
          const updateEl = document.getElementById('_st_dataLastUpdateLine');
          const statusEl = document.getElementById('_st_dataDlStatusLine');
          const pendingRow = document.getElementById('_st_dataPendingRow');
          const pendingEl = document.getElementById('_st_dataPendingLine');
          if (!updateEl && !statusEl) return;
          function setText(el, txt) {
            if (el) el.textContent = txt;
          }
          const TOTAL = PREFECTURES_DL.length;
          try {
            let doneSet = new Set();
            if (typeof caches !== 'undefined' && typeof caches.has === 'function') {
              const exists = await caches.has('daikome-roads-v1');
              if (exists) {
                const cache = await caches.open('daikome-roads-v1');
                const reqs = await cache.keys();
                for (const r of reqs) {
                  const m = /\/data\/roads-([^./?]+)\.js/.exec(r.url);
                  if (m) doneSet.add(m[1]);
                }
              }
            }
            const pending = PREFECTURES_DL.filter(function (p) {
              return !doneSet.has(p);
            });
            const doneCount = TOTAL - pending.length;
            if (doneCount === 0) {
              setText(updateEl, '未取得');
              setText(statusEl, '0/' + TOTAL + ' 県');
              if (pendingRow) pendingRow.style.display = 'none';
              return;
            }
            setText(updateEl, '─');
            if (pending.length === 0) {
              setText(statusEl, doneCount + '/' + TOTAL + ' 県完了 ✅');
              if (pendingRow) pendingRow.style.display = 'none';
            } else {
              setText(statusEl, doneCount + '/' + TOTAL + ' 県完了');
              const names = pending
                .map(function (p) {
                  return PREF_EN_TO_JP[p] || p;
                })
                .join('・');
              setText(pendingEl, names);
              if (pendingRow) pendingRow.style.display = 'flex';
            }
          } catch (e) {
            console.error('[Settings] DL状態読込失敗:', e);
            setText(updateEl, '取得失敗');
            setText(statusEl, '取得失敗');
            if (pendingRow) pendingRow.style.display = 'none';
          }
        }

        // ★2026-08-03 作り直し★ 司さん「46県で止まる」「完了するまでもくそ遅い」
        //
        //   ★元の作りの問題（実測で確定）★
        //     1. ★47都道府県ぶん・合計204MB★ を落としていた（roads 47件・最大は北海道11.2MB）。
        //        パソコンの回線でも1件2〜2.5秒。携帯のWi-Fiなら1件10〜30秒＝★10〜25分★。
        //        司さんが走るのは愛媛（4.4MB・1件）。★残り46県・約200MBは一生使わない。★
        //     2. fetch に ★制限時間が無かった★。1県の応答が返らないと
        //        ★永久に46/47のまま止まる★。エラーも出ない。これが「46で止まる」の正体。
        //     3. cache:'reload' ＝ ★もう持っている県も毎回ぜんぶ落とし直す★。
        //
        //   ★直した中身★
        //     ・既定は「今いる県＋隣」だけ（js/dl-plan.js が決める）。全国は明示で選ぶ。
        //     ・1県ごとに制限時間（AbortController）。★止まらない★。
        //     ・持っている県は取り直さない（cache:'reload' をやめる）。
        //     ・今いる県を必ず1番目に落とす（先にこれが揃えば仕事は始められる）。
        //   ★距離・料金・業務の流れには一切触っていない（落とすファイルを選ぶだけ）。★
        const DL_TIMEOUT_MS = 45000; // 1県ぶんの制限時間（11MBの県でも足りる）

        function _dlCurrentPref() {
          try {
            if (window.RegionHelper && typeof window.RegionHelper.getCurrentPref === 'function') {
              const p = window.RegionHelper.getCurrentPref();
              if (p && typeof p === 'string') return p;
              if (p && p.pref) return p.pref;
            }
          } catch (_) {
            /* 分からなければ null */
          }
          return null;
        }

        // 落とす県を決める。all=true なら全国（今いる県から順に）
        function _dlTargets(all) {
          const pref = _dlCurrentPref();
          if (all) {
            return window.DLPlan
              ? window.DLPlan.orderFor(pref, PREFECTURES_DL)
              : PREFECTURES_DL.slice();
          }
          const near = window.DLPlan ? window.DLPlan.planFor(pref) : null;
          // ★県が分からない時は全国に落とす（少なく落として「地図が無い」より安全）★
          if (!near) return PREFECTURES_DL.slice();
          return near.filter(function (p) {
            return PREFECTURES_DL.indexOf(p) >= 0;
          });
        }

        async function _onCheckUpdate(all) {
          const btn = document.getElementById('_st_dlUpdateBtn');
          if (!btn) return;
          btn.disabled = true;
          const originalText = btn.textContent;
          btn.textContent = '⏳ 確認中...';
          try {
            const list = _dlTargets(all === true);
            const total = list.length;
            const queue = list.slice();
            const PARALLEL = 2,
              MAX_RETRY = 3;
            let ok = 0,
              failed = 0,
              processed = 0;
            const failedList = [];
            async function worker() {
              while (queue.length > 0) {
                const pref = queue.shift();
                let success = false,
                  lastErr = null;
                for (let attempt = 1; attempt <= MAX_RETRY && !success; attempt++) {
                  // ★制限時間★ これが無いと1県で永久に止まる（46/47のまま）
                  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
                  const timer = ac
                    ? setTimeout(function () {
                        ac.abort();
                      }, DL_TIMEOUT_MS)
                    : null;
                  try {
                    const url = '/data/roads-' + pref + '.js';
                    // ★cache:'reload' を使わない★＝もう持っている県は取り直さない
                    const res = await fetch(url, ac ? { signal: ac.signal } : {});
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    await res.blob();
                    success = true;
                  } catch (e) {
                    lastErr = e;
                    if (attempt < MAX_RETRY)
                      await new Promise((r) => setTimeout(r, 1000 * attempt));
                  } finally {
                    if (timer) clearTimeout(timer);
                  }
                }
                if (success) ok++;
                else {
                  failed++;
                  failedList.push(pref);
                  console.warn('[Settings] DL失敗:', pref, lastErr);
                }
                processed++;
                btn.textContent = '⏳ ' + processed + '/' + total + '県確認中...';
              }
            }
            const workers = [];
            for (let i = 0; i < PARALLEL; i++) workers.push(worker());
            await Promise.all(workers);
            if (ok === total) _showToast('✅ ' + total + '県ぶん確認しました');
            else if (ok > 0)
              _showToast(
                '⚠️ ' +
                  ok +
                  '県成功・' +
                  failed +
                  '県失敗 (失敗: ' +
                  failedList.slice(0, 3).join(',') +
                  (failedList.length > 3 ? '…' : '') +
                  ')'
              );
            else _showToast('❌ 更新に失敗しました (オフライン?)');
            await _loadDlStatus();
          } catch (e) {
            console.error('[Settings] 更新チェック失敗:', e);
            _showToast('❌ エラーが発生しました');
          } finally {
            btn.disabled = false;
            btn.textContent = originalText;
          }
        }
        window._st_onCheckUpdate = _onCheckUpdate;
        // 全国ぶんを落とす（長距離を走る時だけ。既定は使わない）
        window._st_onCheckUpdateAll = function () {
          return _onCheckUpdate(true);
        };

        window._st_toggleTrainingEnabled = function () {
          const next = !_trainingIsEnabled();
          try {
            localStorage.setItem('daikome_training_enabled', String(next));
            if (localStorage.getItem('daikome_training_consent') === null) {
              localStorage.setItem('daikome_training_consent', next ? 'agreed' : 'declined');
            }
          } catch (_) {}
          _refreshTrainingToggleUI();
          _showToast(next ? '学習データ提供を ON にしました' : '学習データ提供を OFF にしました');
        };

        window._st_toggleTrainingDetails = function () {
          const body = document.getElementById('_st_trainingDetailsBody');
          const chev = document.getElementById('_st_trainingDetailsChevron');
          if (!body) return;
          const open = body.style.display !== 'none';
          body.style.display = open ? 'none' : 'block';
          if (chev) chev.textContent = open ? '▼' : '▲';
        };

        window._st_deleteTrainingData = function () {
          if (
            !confirm(
              '過去に蓄積された学習データを全て削除します。\nIndexedDB と Firebase の両方から削除されます。\nよろしいですか?'
            )
          )
            return;
          const btn = document.getElementById('_st_trainingDeleteBtn');
          const status = document.getElementById('_st_trainingDeleteStatus');
          if (btn) btn.disabled = true;
          if (status) status.textContent = '削除中...';
          const deviceId = _trainingGetDeviceId();
          const idbP = _trainingClearIndexedDB();
          const fbP =
            typeof FB !== 'undefined' && FB.deleteAllTrainingData && deviceId
              ? FB.deleteAllTrainingData(deviceId).catch(function (e) {
                  return { error: e.message };
                })
              : Promise.resolve({ deleted: 0, skipped: 'no_fb_or_device_id' });
          Promise.all([idbP, fbP])
            .then(function (results) {
              const idbN = results[0];
              const fbR = results[1] || {};
              let msg = 'IndexedDB ' + idbN + ' 件削除';
              if (fbR.deleted != null) msg += '・Firebase ' + fbR.deleted + ' 件削除';
              if (fbR.error) msg += ' (Firebase err: ' + fbR.error + ')';
              if (status) status.textContent = msg;
              if (btn) btn.disabled = false;
              _showToast('学習データを削除しました');
              try {
                localStorage.removeItem('daikome_training_last_upload');
              } catch (_) {}
            })
            .catch(function (e) {
              if (status) status.textContent = '削除エラー: ' + (e && e.message);
              if (btn) btn.disabled = false;
            });
        };

        // ★設計変更宣言 (2026-05-14・MA-4 バグ修正):
        //   バグ 1: 保存後 overlay が閉じず業務画面に戻れなかった (旧 settings.html saveAll は
        //          location.href='index.html' でホーム遷移していた) → hideAllOverlays() 呼出を追加
        //   バグ 2: 保存後 autoResetCheck が新しい resetTime を即時評価しないと「効いてない」感が出る
        //          (setInterval は 60s 毎・タイミング次第で最大 60s ずれる) → 保存直後に明示呼出
        //   どちらも localStorage 書込み後の追加処理・既存 key / JSON パス / 判定式 (一致確認済) は無変更
        window._st_saveAll = function () {
          try {
            // ★設計変更宣言 (2026-05-14): resetTime 入力は撤去済 (時刻ベース廃止)・保存対象なし
            //   _st_saveAll は overlay 閉じる動作のみ残置 (将来追加設定項目が増えた時の枠)
            const msg = document.getElementById('_st_saveMsg');
            if (msg) {
              msg.textContent = '保存しました';
              setTimeout(function () {
                msg.textContent = '';
              }, 2000);
            }
            _showToast('保存しました');
            // 600ms 後に overlay を自動 close → 業務画面 (旧 location.href='index.html' 相当)
            setTimeout(function () {
              try {
                if (typeof window.hideAllOverlays === 'function') window.hideAllOverlays();
              } catch (_) {}
            }, 600);
          } catch (e) {
            console.error('[Settings] saveAll error:', e);
            _showToast('保存に失敗しました');
          }
        };

        function _init() {
          // ★設計変更宣言 (2026-05-14): resetTime restore 撤去 (時刻ベース廃止)
          _refreshTrainingToggleUI();
          _loadDlStatus();
          _loadAppVersion();
        }
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', _init);
        } else {
          _init();
        }
      })();

