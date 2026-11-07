      function _restoreMeterSnapshot() {
        try {
          if (typeof MeterPersist === 'undefined' || typeof Meter === 'undefined') return;
          const cur = Meter.getState();
          const ctx = _meterCtx();
          ctx.cur = cur;
          const r = MeterPersist.restore(null, ctx);
          if (!r || !r.restored) return;
          // ★待機は 同じ 代行の 時だけ・距離より 先に 戻す★（10-11・setDistance が 待機込みで 料金を 出す）
          if (r.fare_restored && r.wait_sec != null && typeof Meter.setWaitSec === 'function') {
            Meter.setWaitSec(r.wait_sec);
          }
          // ★必ず上書き（足し算にしない）★ 2回呼んでも2倍にならない
          if (typeof Meter.setDistance === 'function' && r.distance_m != null) {
            Meter.setDistance(r.distance_m);
          }
          if (typeof Meter.setBusinessDistance === 'function' && r.business_distance_m != null) {
            Meter.setBusinessDistance(r.business_distance_m);
          }
          // ★今の 経過時間より 短い 控えでは 上書きしない★（10-11・0 で 上書きして 数え直しに なっていた）
          if (
            typeof Meter.setElapsedAccumulated === 'function' &&
            r.elapsed_accumulated_sec != null &&
            r.elapsed_accumulated_sec >= (Number(cur.elapsed_sec) || 0) * 1000
          ) {
            Meter.setElapsedAccumulated(r.elapsed_accumulated_sec);
          }
          // ★黙って金額を戻さない★ 運転手が目で見て、違えば止められるようにする
          //   ★出す 先は 走行画面の #toast（showToastLong・同じ script 塊の 関数宣言＝ここで 呼べる）★（10-11）
          //   前は window._showToast を 呼んでいたが、置かれるのは この後に 走る 設定画面の 塊で
          //   ここでは いつも undefined、箱も 設定画面の 中（_st_settingsToast）＝一度も 出ていなかった。
          if (r.fare_restored && r.notice) {
            try {
              if (typeof showToastLong === 'function') showToastLong(r.notice);
            } catch (_) {
              /* 出せなくても業務は止めない */
            }
            if (typeof dlog === 'function') dlog('[MeterPersist] ' + r.notice);
          }
          // ★確定した 後に 落ちた 時は 確定を 戻し、確定画面へ 戻す★（10-11）
          //   checkDrivingRestore の Meter.start() で 凍結が 外れ、走行画面の まま
          //   停車中の 待機が 確定額の 上に 積み増されていた（客の 払いが 確定額より 上がる）。
          if (r.fare_restored && r.billing_frozen && typeof Meter.freezeBilling === 'function') {
            Meter.freezeBilling();
            if (appState === 'driving' && typeof onSend === 'function') onSend();
          }
        } catch (_) {
          /* ★戻せなくても業務は止めない★ */
        }
      }

      // ★前の日の業務が終わっていないことを知らせる (2026-08-05)★
      //
      //   ★何が起きていたか（司さんの指摘）★
      //     業務終了を押し忘れたまま次の日を迎えると、
      //     ★業務開始が効かない★（business.js: state.active なら return false）。
      //     画面も「業務中」のままなので前の日の業務がそのまま続き、
      //     2晩ぶんが1つの勤務にまとまって ★日付がずれる★（その日の売上表が空になる）。
      //
      //   ★決まり★
      //     ・★勝手に締めない★。締めた時刻までの距離しか残らず、そのあと走った分が飛ぶ。
      //       運転手に選ばせる。
      //     ・★普通の夜勤（18時→翌9時）では出さない★。20時間を超えた時だけ。
      //       毎晩出たら、ただのじゃまになって誰も読まなくなる。
      //     ・出せなくても業務は止めない。
      function _askCarryOver() {
        try {
          if (typeof CarryOver === 'undefined' || typeof Business === 'undefined') return;
          const info = CarryOver.check(Business.getState(), Date.now());
          if (!info || !info.carryOver) return;

          const msg = CarryOver.message(info);
          if (typeof dlog === 'function') dlog('[CarryOver] ' + msg);

          // 画面が出来てから聞く（起動直後だと押せない）
          setTimeout(function () {
            try {
              // eslint-disable-next-line no-alert
              const yes = window.confirm(
                msg + '\n\n「OK」= 終わらせて事務所に送る\n「キャンセル」= このまま続ける'
              );
              if (!yes) return; // ★続ける＝何もしない（勝手に締めない）★
              Business.end();
              _syncAfterEnd();
              appState = 'businessStart';
              if (typeof showScreen === 'function') showScreen('businessStart');
            } catch (_) {
              /* 聞けなくても業務は止めない */
            }
          }, 1500);
        } catch (_) {
          /* ★気づかせられなくても業務は絶対に止めない★ */
        }
      }

      // ★業務終了で、その場でクラウドへ送る (2026-08-04)★
      //
      //   ★直した穴★ 送る配線は job-sync.js の init() だけだった:
      //     run();                                  ← アプリを開いた時に1回
      //     addEventListener('online', run);        ← 圏外から復帰した時
      //   ＝業務終了で送る配線が無く、★上がるのは翌日アプリを開いた時★だった。
      //
      //   ★なぜ見落としたか★ job-sync.js を作った7/31時点では
      //   「業務終了で履歴に積んでいなかった」ので「開いた時に送る」で辻褄が合っていた。
      //   今日「終了で積む」に直したのに、送る側は7/31のままだった。
      //   ＝★片方だけ直して、もう片方を見なかった★。
      //
      //   ▼決まり
      //     ・オフラインなら送らずに終わる。★業務は絶対に止めない★
      //     ・送れなかった分は次に繋がった時に自動で送る（online の配線は既にある）
      //     ・★「送りました／あとで送ります」を必ず出す★
      //       運転手が「上がったのか」を知る手段が無かった。★黙って終わらない★
      // ★前の 業務を まだ 履歴に 積めていない（持ち越し）＝事務所へ 未送信★を 知らせる (2026-10-11)
      //   持ち越しが 端末に 書けて いない（mae_kakenai）時は「閉じると 消える」と 言う
      //   （「もう一度 保存します」だけだと 客は 残っていると 思って 閉じ、前の 晩が 黙って 消える）。
      function _maeShirase() {
        try {
          const bs = Business.getState();
          if (!(bs.mae_tsumenai || []).length) return;
          showToastLong(
            '前の 業務が まだ 端末に 保存できていません（アプリの 保存場所が 一杯 等）。\n事務所へ まだ 送れていません。' +
              (bs.mae_kakenai
                ? 'アプリを 閉じると 前の 業務が 消えます。閉じずに 業務終了まで 続けてください。'
                : '業務終了の 時に もう一度 保存します。アプリや サイトの データは 消さないでください。') +
              '事務所へ 連絡してください。'
          );
        } catch (_) {
          /* 知らせで 転んでも 業務は 止めない */
        }
      }

      // ★業務の 記録の 保存に 失敗したら 1回 知らせる (2026-10-11)★（Business.save が 呼ぶ・1つの 業務で 1回）
      try {
        if (typeof Business !== 'undefined' && typeof Business.onHozonShippai === 'function')
          Business.onHozonShippai(function () {
            showToastLong(
              '業務の 記録が 端末に 保存できませんでした（アプリの 保存場所が 一杯 等）。\nアプリを 閉じると 今の 業務の 記録が 消えます。事務所へ 連絡してください。'
            );
          });
      } catch (_) {
        /* 登録できなくても 業務は 止めない */
      }

      function _syncAfterEnd() {
        try {
          // ★この 業務を 履歴に 積めなかった＝事務所へ まだ 送れない★ことを 知らせる (2026-10-11)
          //   前は 「送るものはありません」と 言った（積めていない 業務は 送る 名簿に 無いので）。
          //   この時は 送る 結果の 知らせを 出さない（前の 晩の 分が 送れても「送りました」は 誤解の 元）。
          const _bs = typeof Business !== 'undefined' ? Business.getState() : null;
          const tsumenai =
            !!_bs && (_bs.history_pushed !== true || (_bs.mae_tsumenai || []).length > 0);
          if (tsumenai)
            showToastLong(
              (_bs.history_pushed !== true
                ? 'この 業務は 端末に 保存できませんでした（アプリの 保存場所が 一杯 等）。'
                : '前の 業務が まだ 端末に 保存できていません（アプリの 保存場所が 一杯 等）。') +
                '\n事務所へ まだ 送れていません。' +
                (_bs.mae_kakenai ? 'アプリを 閉じると 前の 業務が 消えます。' : '') +
                '事務所へ 連絡してください。'
            );
          if (!window.JobSync || typeof window.JobSync.sync !== 'function') return;
          const say = function (msg) {
            if (tsumenai) return;
            try {
              if (typeof window._showToast === 'function') window._showToast(msg);
            } catch (_) {
              /* 出せなくても業務は止めない */
            }
          };
          window.JobSync.sync()
            .then(function (r) {
              if (r && r.ok && r.sent > 0) say('事務所に送りました（' + r.sent + '件）');
              else if (r && r.reason === 'offline') say('圏外です。つながったら自動で送ります');
              else if (r && r.reason === 'not_activated')
                say('この端末はまだ会社に登録されていません');
              else if (r && r.ok && r.sent === 0) say('送るものはありません');
              else say('あとで自動で送ります');
            })
            .catch(function () {
              say('あとで自動で送ります');
            });
        } catch (_) {
          /* ★送れなくても業務は絶対に止めない★ */
        }
      }

      // ★画面が隠れた瞬間に書く（今回の穴はここ）★
      //   閉じる・ホームに戻る・タスクキル・電池切れの直前を拾う。
      try {
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'hidden') _saveMeterSnapshot();
        });
        window.addEventListener('pagehide', _saveMeterSnapshot);
      } catch (_) {
        /* 付けられなくても業務は止めない */
      }

      // ─── 業務管理スーパー機能の初期化（2026/05/01追加） ───
      // 永続化された業務状態を復元 + 3時間経過チェック（自動 abandon）
      // Business.load() 内で checkAutoAbandon() も呼ばれるが、保険で明示呼出
      try {
        // ★設計変更宣言 (2026-05-10): Business 未定義/未初期化でも screenBusinessStart に必ず遷移
        //   旧: Business 未定義時は何も起こらず screenIdle (初期 display:flex) のまま → 業務開始ボタンが見えないバグ
        //   新: Business 未定義 fallback で showScreen('businessStart') を呼ぶ
        if (typeof Business === 'undefined') {
          appState = 'businessStart';
          if (typeof showScreen === 'function') showScreen('businessStart');
        }
        if (typeof Business !== 'undefined') {
          Business.load();
          // ★前の日の業務が開きっぱなしなら気づかせる (2026-08-05)★
          //   業務終了を押し忘れると★業務開始が効かない★（active なら return false）ので、
          //   前の日の業務がそのまま続き、2晩ぶんが1つにまとまって日付がずれる。
          //   ★勝手に締めない★ ─ 締めた時刻までの距離しか残らず、そのあと走った分が飛ぶため。
          _askCarryOver();

          // ★メーターの控えを戻す (2026-08-04)★
          //   ★Business.load() の直後・起動時に1回だけ★（何度も呼ぶと足し込まれる恐れがある）。
          //   戻すのは「同じ業務」の時だけ。時間の長さでは切らない
          //   （18時→翌9時=15時間の夜勤で消えるのが一番まずいため）。
          _restoreMeterSnapshot();
          if (typeof dlog === 'function') {
            const s = Business.getState();
            dlog(
              '[Business] init state: active=' +
                s.active +
                ' ended=' +
                s.ended +
                ' trips=' +
                s.trip_count
            );
          }
          // 起動時の画面分岐：
          //   active=true  → 業務中の待機画面（screenIdle）
          //   ended=true   → 業務終了済み・3時間以内なら日報画面（screenBusinessReport）で再開可
          //   active=false かつ ended=false → 業務未開始（screenBusinessStart）
          //     ※ 直前の履歴が3時間以内なら「続きから再開」ボタン表示
          const bs = Business.getState();
          if (bs.active) {
            // ★設計変更宣言 (2026-05-10): 業務中タスクキルからの復元フロー
            //   旧: appState ロジック委ね だけで showScreen 呼ばず
            //       → screenIdle (display:none) のまま businessStart (display:flex) が
            //         残って「業務中なのにセンサー許可画面」と表示されるバグ
            //   新: appState が driving/fare に既に復元されてなければ idle に遷移
            //       (driving/fare は checkDrivingRestore (loadSettings 内) で先に復元される)
            //       sensor 未許可なら orange banner で許可導線 (画面は idle のまま)
            updateBusinessDashboard();
            if (appState !== 'driving' && appState !== 'fare') {
              appState = 'idle';
              showScreen('idle');
              const _t = document.getElementById('appbarTitle');
              if (_t) _t.textContent = '空　車';
            }
            // ★Android GPS「待機中」固定 根治 (2026-06-05・司さん報告)★:
            //   業務 active 復元時、iOS は下の sensor banner / btnSensorPermission 経由で GPS が
            //   起動するが、★Android はセンサー許可バナー自体が出ない設計★のため startGPS が永久に
            //   呼ばれず GPS が「待機中」で固定される (司さん: 毎回「業務終了→最初→業務開始」で復帰
            //   させる手間が発生)。Android(非iOS)は geolocation/sensor 権限が永続かつ user gesture
            //   不要なので、業務 active 復元時に ★自動で startGPS()★ する。
            //   ・gpsStarted guard で二重起動防止 ・iOS は従来通り banner 経由 (挙動不変)
            //   ・driving/fare は checkDrivingRestore が既に startGPS 済 (二重は guard で無害)
            try {
              const _isIOSrestore = /iPad|iPhone|iPod/.test(navigator.userAgent);
              if (!_isIOSrestore) {
                startGPS();
                // ★画面が暗くなる/消える 根治 (2026-06-05・司さん報告)★:
                //   業務中タスクキル→コールド再起動では visibilitychange の hidden→visible 遷移が
                //   起きないため L5271 の WakeLock 再取得が発火せず、★画面が OS のタイムアウトで消える★。
                //   (dimTimer は空車5時間なので別)。Android は user gesture 不要で WakeLock 取得可能なので
                //   復元時に即 acquireWakeLock() し、業務中の画面常時 ON を復活させる。
                try {
                  acquireWakeLock();
                } catch (_) {}
                if (typeof dlog === 'function')
                  dlog(
                    '[Business] active 復元: Android 自動 startGPS + WakeLock (待機固定/画面消え 根治)'
                  );
              }
            } catch (_) {
              /* startGPS 失敗は致命ではない・既存 banner/業務開始 経路で復帰可能 */
            }
            // ★設計変更宣言 (2026-05-10): 自動 startGPS() を削除 (iOS は user gesture 必須のため)
            //   旧: startGPS();  ← bs.active 復元時の自動発火 (全OS)
            //   新: iOS は btnSensorPermission 押下時のみ・Android は上で自動 startGPS
            // ★設計変更宣言 (2026-05-10): 業務復元時は iOS PWA で permission lost の
            //   可能性が高い (タスクキルで失効) → orange banner を強制 overlay 表示し
            //   ユーザーに「センサー再起動」の導線を明示
            //   sessionStorage active が '1' なら同 session 内 (= GPS 稼働中) なので skip
            try {
              if (
                _isIOS &&
                window.navigator.standalone === true &&
                sessionStorage.getItem('sensor_permission_active') !== '1'
              ) {
                // ★設計変更宣言 (2026-05-10): businessStart 画面では青ボタン表示・orange 抑制
                const _bs = document.getElementById('screenBusinessStart');
                const _onBs = _bs && _bs.style.display !== 'none';
                if (_onBs) {
                  const _btn = document.getElementById('btnSensorPermission');
                  if (_btn) _btn.style.display = 'block';
                  if (typeof dlog === 'function')
                    dlog('[Business] active 復元: businessStart 中 → 青ボタン表示');
                } else {
                  const _b = document.getElementById('sensorRestoreBanner');
                  if (_b) _b.style.display = 'block';
                  if (typeof dlog === 'function')
                    dlog('[Business] active 復元: orange banner 強制表示');
                }
              }
            } catch (_) {}
            if (typeof dlog === 'function') dlog('[Business] active 復元: appState=' + appState);
          } else {
            // ★設計変更宣言 (2026-05-14): 起動時 routing 統一・limbo (ended=true) も businessStart に route
            //   旧: limbo → businessReport (日報) に直行・resume button が businessStart で出番なかった
            //   新: 業務未開始 / limbo どちらも businessStart 画面に集約
            //       limbo の場合は updateResumeFromStartVisibility が resume button を表示する
            //       (start_time !== null && !active が limbo の判定条件)
            //   業務終了直後の businessReport 画面は onBusinessEnd の直接遷移で見せるので維持
            appState = 'businessStart';
            showScreen('businessStart');
            document.getElementById('appbarTitle').textContent = 'ダイコメ';
            // ちらつき修正: Business.load() (L3656) は既に完了済なので state は確定
            // updateResumeFromStartVisibility は同期実行・初期 display:none → 判定後に確定
            updateResumeFromStartVisibility();
            // 2026/05/01：未許可ならバナー表示（許可済みなら何もしない）
            showSensorBannerIfNeeded();
            // ★設計変更宣言 (2026-05-13): 旧 DataUpdateBanner.checkAndShow 呼出削除
            //   meta.json ベース差分検知実装まで dataUpdateBanner 機能停止中 (Phase 6-5)
          }
        }
      } catch (e) {
        console.error('[Business] init error:', e);
      }

