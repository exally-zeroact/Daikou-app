      // ─── GPS error 駆動の失効検知（2026/05/02・Phase 1） ───
      // 業界標準の確実な検知方法：navigator.geolocation のエラーコードで判定
      //
      // 仕組み：
      //   gps.js の GPSStatus（既存・前回 BUG-6 で実装）と連携
      //   - error.code === 1 (PERMISSION_DENIED) → status = 'denied' → バナー + 音
      //   - error.code === 2 (POSITION_UNAVAILABLE) → トンネル等・無視
      //   - error.code === 3 (TIMEOUT) → 一時的・無視
      //
      // 復活時：
      //   - status = 'granted' → バナー非表示 + 復活音
      //
      // 誤検知ゼロ：
      //   - PERMISSION_DENIED は確実な失効シグナル
      //   - トンネル/橋は code 2 なので発火しない
      //   - 既存のメーター動作・1.28% 精度に影響なし
      window._sensorLapsed = false; // 失効中フラグ（外部参照用）

      // ─── 音通知（2026/05/02 Phase 1） ───
      // 既存の AudioContext を活用（NoSleep で動作確認済）
      // 失効時：ピッピッピッ（800Hz × 3回）
      function playSensorAlert() {
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          const ctx = new AC();
          for (let i = 0; i < 3; i++) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.frequency.value = 800;
            gain.gain.value = 0.3;
            osc.connect(gain);
            gain.connect(ctx.destination);
            const startAt = ctx.currentTime + i * 0.3;
            osc.start(startAt);
            osc.stop(startAt + 0.2);
          }
          // コンテキストは1.5秒後に閉じる（リソース解放）
          setTimeout(() => {
            try {
              ctx.close();
            } catch (e) {}
          }, 1500);
          if (typeof dlog === 'function') dlog('[Sensor] alert sound played');
        } catch (e) {
          console.error('[Sensor] alert sound error:', e);
        }
      }
      // 復活時：ポーン♪（1200Hz × 1回）
      function playSensorRecover() {
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          const ctx = new AC();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.frequency.value = 1200;
          gain.gain.value = 0.3;
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.3);
          setTimeout(() => {
            try {
              ctx.close();
            } catch (e) {}
          }, 1000);
          if (typeof dlog === 'function') dlog('[Sensor] recover sound played');
        } catch (e) {
          console.error('[Sensor] recover sound error:', e);
        }
      }

      // ─── GPSStatus と連携（2026/05/02 Phase 1） ───
      // 既存の GPS.onStatusChange リスナー登録
      // gps.js が既に実装してるエラー検知を利用
      (function () {
        try {
          if (typeof GPS === 'undefined' || typeof GPS.onStatusChange !== 'function') {
            console.error('[Sensor] GPS module not available');
            return;
          }
          GPS.onStatusChange(function (status) {
            try {
              if (status.state === 'denied') {
                // PERMISSION_DENIED：本当の失効
                if (!window._sensorLapsed) {
                  window._sensorLapsed = true;
                  window._compassGranted = false;
                  window._motionGranted = false;
                  // バナー表示
                  showSensorBannerIfNeeded();
                  // 音通知（ピッピッピッ）
                  playSensorAlert();
                  if (typeof dlog === 'function') dlog('[Sensor] GPS denied: バナー + 音');
                }
              } else if (status.state === 'granted') {
                // GPS 動作中：GPS 自体の失効状態だけ解除
                // 2026/05/03 修正：_compassGranted/_motionGranted は GPS と別の permission のため触らない
                //   旧コード：GPS granted で全部 true にしてバナー強制非表示
                //   問題：iOS PWA では DeviceMotion/Orientation は session 毎に失効するので
                //         GPS が永続化で granted のままでも、これらは未許可状態のことがある
                //         → タスクキル後など、バナー出るべきなのに出ない
                //   修正：GPS の状態と DeviceMotion/Orientation の状態を独立管理
                window._sensorLapsed = false;
                // バナー判定は showSensorBannerIfNeeded に委ねる（_compass/_motion の実状態で判断）
                showSensorBannerIfNeeded();
                // 失効状態から復活した場合のみ音を鳴らす（通常起動時は鳴らさない）
                if (status.lastState === 'denied') {
                  playSensorRecover();
                  if (typeof dlog === 'function') dlog('[Sensor] GPS granted: 復活音');
                }
              }
              // unavailable / timeout は無視（トンネル等の一時的な失敗）
            } catch (e) {
              console.error('[Sensor] status change handler error:', e);
            }
          });
          if (typeof dlog === 'function') dlog('[Sensor] GPS.onStatusChange listener registered');
        } catch (e) {
          console.error('[Sensor] listener setup error:', e);
        }
      })();

      // ─── ServiceWorker登録（PWA化・オフライン対応） ───
      if ('serviceWorker' in navigator) {
        // ★設計変更宣言 (2026-05-13・SW update 時の自動 reload):
        //   問題: 新 SW が install → activate → claim しても、起動中の page は
        //   古い JS を memory 上で持ち続け、reload しないと新 code が反映されない。
        //   iOS PWA で「履歴→戻る」レベルの navigation では強制 reload にならず、
        //   ユーザーは古い code を見続ける (実機スクショで Phase D/E 表示が出ない例)。
        //   対策: controllerchange event で新 SW が controller を取った瞬間に reload。
        //   初回登録 (controller=null → SW) では reload しない (無限 loop 防止)。
        const _hadSWController = !!navigator.serviceWorker.controller;
        let _swReloaded = false;
        let _swHatsukaiMita = false; // ★初回登録の controllerchange を 1回だけ 見送る印 (2026-09-28)
        // ★★業務中は 新しい版を 当てない（読み直さない）★★ 2026-09-06（司さん）
        //   ★司さんの言葉★「なんで距離や課金変わらんってあれだけゆうて変わったんど」
        //
        //   ★何が 起きていたか（実測 2026-09-06）★
        //     事務所の 画面しか 直していなくても sw.js の 版が 変わります。
        //     版が 変わると ここが ★走行中でも location.reload()★ を していました。
        //     読み直すと:
        //       ①★OBD の Bluetooth が 切れる★（画面が 作り直される）
        //       ②★「OBDが切れました」の 赤バーが 出ない★
        //          ＝ _obdWasConnected が ただの変数で 0 に 戻る為（下で 直した）
        //       ③自動で 繋ぎ直すのは ★Android Chrome だけ★（obd の 自動接続の 注記）
        //       ④OBD が 死んだ間の 穴は ★位置の直線★で 埋まる＝★道より 短い★
        //     ⇒★★画面は まとも・距離だけ 少ない★★＝今回 従業員が 気づいた形。
        //     ⇒★09-04 17:29〜09-05 16:16 に 版が 6回 変わった＝「今までなかった」の 正体★
        //
        //   ★直し★ ★業務中は 読み直さない★／★業務が 終わってから 当てる★。
        //     ・新しい版は SW に 入ったまま（消えません・次に 当たります）
        //     ・業務が 終わったら 5秒以内に 自分で 読み直します
        //   ★距離にも 料金にも 1文字も 触っていません★（★いつ 読み直すか★ だけ）
        let _swReloadMachi = false;
        // ★★2026-09-28 直し★★ 司さん「タスクキルせな バージョンが 更新されない」
        //
        //   ★何が 起きていたか（コードを 読んで 特定）★
        //     ここは 「業務中は 読み直さない」（2026-09-06 司さん・走行中に 読み直すと
        //     OBD が 切れて 距離が 短く 出た）ために 止めている。
        //     ところが 判定が `!!(s && s.start_time)` ＝★start_time が 在るか★ だけだった。
        //     `start_time` は [業務終了] を 押しても ★消えない★（business.js:end は
        //     ended=true に するだけ・消えるのは [終了]=abandon か 次の 業務開始の 時）。
        //     ⇒ ★仕事と 仕事の 間ずっと「業務中」扱い★＝読み直しが 永久に 止まる。
        //     ⇒ 新しい 服（sw.js）は 入っているのに 画面の js が 古いまま
        //        ＝★タスクキルしないと 変わらない★（司さんが 見ていた 形）。
        //
        //   ★直し★ 止めるのは ★業務が 動いている間（active）だけ★ に する。
        //     ・active=true  … GPS/OBD/メーターが 動いている ⇒ ★読み直さない★（09-06 の 決まりは そのまま）
        //     ・limbo（[業務終了]を 押した後・active=false）⇒ ★読み直してよい★
        //       　業務の 中身は localStorage に 在り、読み直しても そのまま 戻る。
        //       　★勝手に 再開しない★（再開は [続ける] を 押した時だけ＝onResumeFromStart）。
        //     ・業務なし ⇒ 読み直してよい
        //   ★距離にも 料金にも 1文字も 触っていません★（★いつ 読み直すか★ だけ）
        //
        //   ★試験から 呼べるように 外に 出す★（画面の 中だけに 書くと 誰も 測れない）
        //   ★★2026-09-28 その2＝対立役に 叩かれて 3つ 足した★★
        //     はじめ 「Business.active だけ」で 止めていた。★それでは 足りない★と 指摘され、
        //     ★1つずつ 自分で コードを 読んで 裏を 取った★（下の 行番号は その時 数えた 物）:
        //
        //     ①★OBD が 繋がっている時★（index.html:8725 が 唯一の 接続点）
        //        [業務終了] は OBD を 切らない＝limbo でも ★繋がったまま★。
        //        読み直すと GATT ごと 消えるが ★[続ける](onBusinessResume) は 繋ぎ直さない★。
        //        自動の 繋ぎ直しは `navigator.bluetooth.getDevices` が 要る＝端末次第で 戻らない。
        //        ⇒ OBD 無しで 走り出し ★穴が 位置の直線で 埋まって 道より 短く なる★
        //          ＝2026-09-06 の 実害 そのもの。★繋がっている間は 止める★。
        //     ②★メーターが 回っている時（Meter.running）★
        //        課金距離の 門は js/meter.js:383 の `state.running` ★だけ★で
        //        business_active を 見ていない。しかも index.html:10590 の `_askCarryOver` は
        //        `Business.end()` を 呼ぶが ★`Meter.businessEnd()` を 呼ばない★
        //        ⇒ ★active=false なのに 実車の 課金が 回っている★ 状態が 実在する。
        //     ③★日報（業務報告）を 見ている時★
        //        起動の 画面分岐は limbo を businessStart に 送る（index.html:10772 の 注記）
        //        ＝読み直すと ★その勤務の 日報に 二度と 戻れない★。
        //        送信の 知らせ（_syncAfterEnd の トースト）も ここで 消える。
        //   ★どれも「いつ 読み直すか」だけ。距離にも 料金にも 1文字も 触っていません★
        function _swYominaoshiteYoiKa() {
          // ★見えない物は 止める側に 倒さない★（道具が 無い端末で 永久に 古いままに なる）
          //   ただし ★在るのに 繋がっている／回っている★ 時は 必ず 止める。
          try {
            // ★window. を 付けて 呼ぶ★（素の OBDClient だと
            //   tests/integration/index-inline-noundef.test.js が「未定義」で 赤に する。
            //   ★一覧に 足して 逃げず★ 呼び方の 方を 直す）
            if (
              window.OBDClient &&
              typeof window.OBDClient.isConnected === 'function' &&
              window.OBDClient.isConnected()
            ) {
              return { ok: false, wake: 'obd_tsunagatteru' };
            }
          } catch (_) {
            /* OBD が 読めない＝繋がっていない扱い */
          }
          try {
            if (typeof Meter !== 'undefined' && typeof Meter.getState === 'function') {
              const m = Meter.getState();
              if (m && m.running) return { ok: false, wake: 'meter_mawatteru' };
            }
          } catch (_) {
            /* メーターが 読めない＝回っていない扱い */
          }
          try {
            const el = document.getElementById('screenBusinessReport');
            if (el && getComputedStyle(el).display !== 'none') {
              return { ok: false, wake: 'nippou_miteru' };
            }
          } catch (_) {
            /* 画面が 読めない＝見ていない扱い */
          }
          try {
            const s =
              typeof Business !== 'undefined' && typeof Business.getState === 'function'
                ? Business.getState()
                : null;
            if (!s || !s.start_time) return { ok: true, wake: 'business_nashi' };
            if (s.active) return { ok: false, wake: 'gyoumu_chuu' };
            return { ok: true, wake: 'limbo' }; // ★[業務終了]の 後＝止めない★
          } catch (_) {
            // ★分からない時は 読み直してよい＝今まで通り★
            //   （ここに来るのは Business が まだ 読めていない＝起動直後＝失う物が 無い）
            return { ok: true, wake: 'wakaranai' };
          }
        }
        window.__swYominaoshiteYoiKa = _swYominaoshiteYoiKa;

        function _atotemawashi(doko) {
          if (_swReloaded) return;
          const h = _swYominaoshiteYoiKa();
          if (!h.ok) {
            _swReloadMachi = true;
            if (typeof dlog === 'function')
              dlog('[SW] ' + doko + ' → 業務中なので 読み直さない（業務が 終わるまで 待つ）');
            return;
          }
          _swReloaded = true;
          if (typeof dlog === 'function')
            dlog('[SW] ' + doko + ' → reload (新 code 適用・訳=' + h.wake + ')');
          window.location.reload();
        }

        navigator.serviceWorker.addEventListener('controllerchange', function () {
          if (_swReloaded) return;
          // ★初回登録（この画面が 服を 着ていなかった）時の 1回目だけ 見送る★
          //   ★前は `if (!_hadSWController) return;` で ★その画面では 二度と 読み直さなかった★。
          //   服を 着ていない 状態で 開く事は ふつうに 起きる（初回・強制再読込・服の 入れ替え中）。
          //   ⇒ 見送るのは ★1回だけ★ に して、2回目からは 当てる。
          if (!_hadSWController && !_swHatsukaiMita) {
            _swHatsukaiMita = true;
            if (typeof dlog === 'function') dlog('[SW] controllerchange（初回）→ 見送る');
            return;
          }
          _atotemawashi('controllerchange');
        });
        // ★業務が 終わったら 当てる★（待たせた 分を 取りに行く）
        setInterval(function () {
          if (!_swReloadMachi) return;
          _atotemawashi('業務が 終わった');
        }, 5000);
        // ★画面に 戻った時にも 当てる★（5秒の 待ちを 挟まない・裏で 待たされたままに しない）
        try {
          document.addEventListener('visibilitychange', function () {
            if (document.visibilityState !== 'visible') return;
            if (!_swReloadMachi) return;
            _atotemawashi('画面に 戻った');
          });
        } catch (_) {
          /* ignore */
        }
        navigator.serviceWorker
          .register('/sw.js')
          .then(function (reg) {
            dlog('[SW] 登録完了:', reg.scope);
            // ★設計変更宣言 (2026-05-19・Sentry ノイズ抑制・reg.update() Promise reject 握り潰し):
            //   reg.update() は Promise 返却・try/catch は同期 throw のみ捕捉。
            //   network blip 等で reject すると onunhandledrejection で Sentry 通知発火。
            //   .catch() で握り潰し・他 error は引き続き Sentry に届く。
            reg.update().catch(function () {
              /* network blip 等で reject する場合あり・無害なので握り潰す */
            });
            // ★設計変更宣言 (2026-05-15・SW 自動更新確実化):
            //   旧: register 直後の reg.update() 1 回のみ・以降は browser 任せ (24h cycle)
            //       → iOS PWA 長時間起動で新版 SW を取得し損ねる事象 (司さん「キャッシュクリア
            //         手動」必要だった件) を解消するため、visibilitychange + 5 分間隔 polling
            //         で能動的に update check する。
            //   挙動: タスクキル復帰 / 別タブ復帰 / 5 分経過 のいずれかで reg.update() 発火。
            //         新 SW があれば install → skipWaiting → activate → controllerchange →
            //         location.reload (既存 handler L7621-7627) で自動切替。
            //   業務影響: reg.update() は HEAD 相当の軽量チェック・通信 100KB 未満・
            //             業務継続 (GPS / Meter / Worker B) には影響なし。
            try {
              document.addEventListener('visibilitychange', function () {
                if (document.visibilityState === 'visible') {
                  reg.update().catch(function () {
                    /* network blip 握り潰し */
                  });
                }
              });
            } catch (_) {}
            try {
              setInterval(
                function () {
                  reg.update().catch(function () {
                    /* network blip 握り潰し */
                  });
                },
                5 * 60 * 1000
              );
            } catch (_) {}
          })
          .catch(function (err) {
            dlog('[SW] 登録失敗（開発環境では正常）:', err.message);
          });
        // ★設計変更宣言 (2026-05-13・Phase 6-6): cachePutFailed handler 整理
        //   旧: DakomeDL.markPrefUndone + _mmPipeline.enqueueRetry の両経路
        //   新: DakomeDL 廃止 (Phase 6-2) に伴い markPrefUndone 経路を削除
        //       _mmPipeline.enqueueRetry のみで cache.put 失敗を救済
        //   _loadOne 内の 3 回 retry (Phase 1 修正1-A) + 60 秒 cooldown で
        //   重複防止しながら再 load を試行する。
        navigator.serviceWorker.addEventListener('message', function (ev) {
          try {
            const m = ev && ev.data;
            if (!m || m.type !== 'cachePutFailed' || !m.url) return;
            // 新パイプライン経路: enqueueRetry で再 load (3 回 retry 自動・cooldown 60 秒)
            if (window._mmPipeline && typeof window._mmPipeline.enqueueRetry === 'function') {
              window._mmPipeline.enqueueRetry(m.url).catch(function (e) {
                if (typeof dlog === 'function')
                  dlog('[SW] enqueueRetry エラー: ' + (e && e.message));
              });
            } else {
              if (typeof dlog === 'function')
                dlog('[SW] _mmPipeline 未初期化・enqueueRetry skip: ' + m.url);
            }
          } catch (_) {}
        });
      }

      // P13 (2026-05-09) 停車 5 分以上で実車終了候補バナー setInterval:
      //   2026-05-24 お節介ルール (= 2026-05-23 制定) 適用・完全削除済。
      //   ★ isStationary 判定本体 (= window._lastStationary / Meter._isStationary) は・触らず ★
      //   関連 HTML 要素 (= stopCandidateBanner / stopCandidateMin) + 変数 (= _stopStartedAt /
      //   STOP_CANDIDATE_THRESHOLD_MS) も同時削除。実車終了の・確定操作経路は・既存 btn-row 維持。

