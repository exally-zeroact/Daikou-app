      // 乗車の 記録の 保存に 失敗した 知らせを 1回だけ 出す 印（成功で・新しい 乗車で 戻す）
      var _histHozonShippaiShirase = false; // var＝描き直しが この行より 先に 走っても 落ちない
      var _kyouMiHozon = false; // 履歴は 書けて 今日の 合計だけ 書けていない

      // ★今日の 合計を 書く★（書けたら true）
      function _kyouWoKaku(ls, dist, count, fare, total) {
        try {
          ls.setItem(
            'daikou_today',
            JSON.stringify({
              date: new Date().toDateString(),
              dist: dist,
              count: count,
              fare: fare,
              total: total, // ★総走行距離の命綱も残す★
            })
          );
          return true;
        } catch (_) {
          return false;
        }
      }

      // ★乗車の 記録を 保存する★（10-11）
      //   前は 今日の 合計を 先に 書き・履歴を 後に 書き・受け皿が 無かった＝空きが 足りないと
      //   今日の 合計だけ 増えて 履歴の 1件が 残らず・書き直しも されず・運転手に 何も 出なかった。
      //   ①履歴を 先に 書く。転んだら 何も 変えずに histSaved を 戻す（次の 描き直しで 全部 もう一度）。
      //   ②履歴が 書けたら 手元の 合計は 進める（履歴に 在る 乗車は 合計に 入れる＝次の 描き直しは 同じ 乗車の 上書きで 差分 0）。
      //   ③今日の 合計で 転んだら kyouMiHozon を 立てて 合計だけ 書き直す。
      //   返す：{ kekka: 'ok'|'rireki-dame'|'kyou-dame', susumeru, histSaved, kyouMiHozon }
      function _jouShaKirokuHozon(ls, histKey, r, total) {
        try {
          ls.setItem(histKey, JSON.stringify(r.hist));
        } catch (_) {
          return { kekka: 'rireki-dame', susumeru: false, histSaved: false, kyouMiHozon: false };
        }
        const ok = _kyouWoKaku(ls, r.today.dist, r.today.count, r.today.fareYen, total);
        return {
          kekka: ok ? 'ok' : 'kyou-dame',
          susumeru: true,
          histSaved: true,
          kyouMiHozon: !ok,
        };
      }

      // ★設計変更宣言 (2026-05-23・履歴3個重複バグ修正・pure helper 関数):
      //   hist 保存 logic を・pure function に抽出・冪等化を集約。
      //   引数:
      //     prevHist        ・既存 localStorage hist 配列 (= 読み込み済)
      //     newEntry        ・今回確定の・新 entry (= trip_key 付き)
      //     prevTodayState  ・{dist, count, fareYen} (= 既存 todayDist 等)
      //     distanceM       ・s.distance_m (= float・差分計算用)
      //     fare            ・total (= 整数・差分計算用)
      //   戻り値:
      //     { hist: newHist, today: {dist, count, fareYen}, isReConfirm: bool, action: 'push'|'update' }
      //   挙動:
      //     ・直前 entry が・同 trip_key & trip_key != null → 上書き update (= 反復確定の最新値)
      //       todayDist += distanceM - prev.distance_m  (= 差分のみ)
      //       todayFareYen += fare - prev.fare           (= 差分のみ)
      //       todayCount は・変えない (= 同 trip = 1 回)
      //     ・違えば・新規 push (= 既存挙動・後方互換)
      //       todayDist / todayCount / todayFareYen は・全加算
      //   distance_m / calcFare / Meter / Worker B には・1 byte も触れない。
      //   window._historyDedupeUpsert として export (= vitest test 用)。
      function _historyDedupeUpsert(prevHist, newEntry, prevTodayState, distanceM, fare) {
        const tripKey = newEntry && newEntry.trip_key;
        const last = prevHist && prevHist.length > 0 ? prevHist[prevHist.length - 1] : null;
        const isReConfirm = !!(last && tripKey != null && last.trip_key === tripKey);
        const newHist = prevHist ? prevHist.slice() : [];
        let nextDist = (prevTodayState && prevTodayState.dist) || 0;
        let nextCount = (prevTodayState && prevTodayState.count) || 0;
        let nextFareYen = (prevTodayState && prevTodayState.fareYen) || 0;
        if (isReConfirm) {
          nextDist += distanceM - (last.distance_m || 0);
          nextFareYen += fare - (last.fare || 0);
          // count は不変
          newHist[newHist.length - 1] = newEntry;
        } else {
          nextDist += distanceM;
          nextCount += 1;
          nextFareYen += fare;
          newHist.push(newEntry);
        }
        return {
          hist: newHist,
          today: { dist: nextDist, count: nextCount, fareYen: nextFareYen },
          isReConfirm,
          action: isReConfirm ? 'update' : 'push',
        };
      }
      if (typeof window !== 'undefined') {
        // test 用 export (= 本番動作には影響なし・read-only attach)
        window._historyDedupeUpsert = _historyDedupeUpsert;
      }

      function row(lbl, val, cls = '') {
        return `<div class="breakdown-row"><span class="lbl">${lbl}</span><span class="val ${cls}">${val}</span></div>`;
      }

      // ─── 空車ボタン ───
      function onIdle() {
        // ★センサーの許可は要求しない (2026-08-07・司さん指摘)★
        //   iPhoneは一度アプリを離れると許可が切れる。終わらせる操作で止めると詰む。
        if (appState === 'driving') {
          // 走行中は空車に戻れない
          showToast('先に「確定」を押してください');
          return;
        }
        // 空車成立時の補正用データを取得（reset前に）
        let correctionDistanceM = 0;
        let correctionTotal = 0;
        // 業務管理連携用（Step 5・2026/05/01追加）
        let tripDistanceM = 0;
        let tripFareYen = 0;
        let tripStartTime = null;
        if (appState === 'fare') {
          // ★履歴が 書けていないまま 精算終了＝その 乗車は 履歴に 残らない★ことを 知らせる（10-11）
          //   事務所へ 送る 業務の 記録（Business の trips）は 履歴とは 別の 道なので 止めない（止めると 詰む）。
          //   ただし Business の 保存も 空き不足を 黙って 飲む（js/business.js の save）＝「送ります」とは 約束しない
          if (!histSaved)
            showToastLong(
              'この 乗車は 履歴に 残せませんでした（端末の 空きが 足りない 等）。\n事務所へ 送る 業務の 記録は、履歴とは 別です。'
            );
          const s = Meter.getState();
          correctionDistanceM = s.distance_m;
          let fare = s.fare_yen;
          if (surchargeOn) fare = Math.round(fare * surchargeRate);
          correctionTotal = Math.max(
            0,
            fare + extras.reduce((a, b) => a + b.amount, 0) - _discountTotal()
          );
          // 業務管理連携用に保持（reset前に）★値引き反映済みの実請求額を記録★
          tripDistanceM = s.distance_m;
          tripFareYen = correctionTotal;
          // 仕事開始時刻を取得
          const lastStart = parseInt(localStorage.getItem('daikou_last_start') || '0');
          tripStartTime = lastStart > 0 ? lastStart : null;
          // TestMode 走行終了記録は H-3 対応で削除済

          // ─── 走行サマリートースト（5秒表示）───
          // ★設計変更宣言 (2026-05-14・サマリートーストを距離課金の機能内訳表示に変更):
          //   旧: hasPosData=false ハードコード → 常に「座標: 未取得⚠️」と嘘表示・gap fill 1 行のみ
          //   新: 距離計上に貢献した全機能 (MM / GPS補完 / 圏外補完 / 待機・値>0 のもののみ) を行表示
          //        + GPS 精度 + センサー有無 を表示・dead code 撤去
          try {
            const _lines = [
              `✅ ${(correctionDistanceM / 1000).toFixed(2)}km ¥${correctionTotal.toLocaleString()}`,
            ];
            // MM 距離 (mm_distance_m > 0 のみ・道路距離経由の主経路)
            if (s.mm_distance_m && s.mm_distance_m > 0) {
              _lines.push(`MM: ${(s.mm_distance_m / 1000).toFixed(2)}km`);
            }
            // GPS 補完 (gap_fill_count > 0 のみ・5 秒以上空白の速度×時間補完)
            if (s.gap_fill_count && s.gap_fill_count > 0) {
              _lines.push(`GPS補完: ${s.gap_fill_count}回 ${Math.round(s.gap_fill_total_m || 0)}m`);
            }
            // 圏外補完 (offroad_count > 0 のみ・snap 5 回連続失敗で Kalman GPS 累積)
            if (s.offroad_count && s.offroad_count > 0) {
              _lines.push(
                `圏外補完: ${s.offroad_count}回 ${Math.round(s.offroad_distance_m || 0)}m`
              );
            }
            // 待機時間 (>=60s のみ・課金は wait.enabled+freeMins 超えで calcFare に反映)
            if ((s.wait_sec || 0) >= 60) {
              _lines.push(`待機: ${Math.floor(s.wait_sec / 60)}分`);
            }
            // GPS 精度 (#gpsDot の data-acc から取得・表示は「GPS」固定にしたので dot data 属性が真値源)
            try {
              const _dot = document.getElementById('gpsDot');
              const _acc = _dot ? _dot.dataset.acc : '';
              if (_acc) {
                _lines.push(`GPS精度: ${_acc}m`);
              }
            } catch (_) {}
            // センサー有無 (常時表示・compass + motion 両方許可で「あり」)
            _lines.push(
              `センサー: ${window._compassGranted && window._motionGranted ? 'あり' : 'なし'}`
            );
            // ★司さん要望2026-06-27: トリップ終了の黒いサマリートーストは不要→非表示★
            //   (距離/料金は画面と履歴で見える・GPS精度/センサー等のデバッグ表示も邪魔)
            // showToastLong(_lines.join('\n'));  // 無効化
          } catch (e) {
            /* サマリー表示エラーは無視 */
          }

          // 確定画面からのみ空車に戻れる
          Meter.stop();
          if (uiTimer) {
            clearInterval(uiTimer);
            uiTimer = null;
          }
          // ★設計変更宣言 (2026-05-24・案 B・rAF 描画ループ stop):
          //   uiTimer stop と・同じタイミングで・rAF も停止 (= 待機画面で・無駄 frame 抑制)
          stopRafDisplay();
        }
        appState = 'idle';
        extras = [];
        discounts = [];
        surchargeOn = false;
        Meter.reset();
        // リロード復元データ削除・バナー非表示
        localStorage.removeItem('daikou_driving_state');
        document.getElementById('restoreBanner').classList.remove('show');
        try {
          FB.setIdle();
        } catch (e) {}

        // ─── 業務管理連携（Step 5・2026/05/01追加）───
        // 実車終了を Business に通知して累計加算（実車距離・売上・営業回数）
        // ✅ 修正済み 2026-05-05：tripDistanceM > 0（距離0は誤タップ扱い）
        try {
          if (
            typeof Business !== 'undefined' &&
            tripDistanceM > 0 &&
            appState === 'idle' /* fareから来た時のみ */
          ) {
            // appState は既に 'idle' に書き換わってるので、tripStartTime を使って fare から来たか判定
            // tripStartTime は fare 経由の時のみセットされる
            if (tripStartTime !== null) {
              // ★設計変更宣言 (2026-05-14): 診断 dlog 追加・state.active が false なら理由表示
              //   onTripEnd の internal !state.active gate で ignored される事象を可視化
              if (typeof dlog === 'function') {
                const _bsBefore = Business.getState();
                dlog(
                  '[Business] preTripEnd: active=' +
                    _bsBefore.active +
                    ' start_time=' +
                    (_bsBefore.start_time ? 'set' : 'null') +
                    ' ended=' +
                    _bsBefore.ended +
                    ' tripDist=' +
                    Math.round(tripDistanceM) +
                    ' tripFare=' +
                    tripFareYen
                );
              }
              const _ok = Business.onTripEnd(tripDistanceM, tripFareYen, tripStartTime);
              if (typeof dlog === 'function')
                dlog('[Business] onTripEnd result=' + _ok + ' (active gate ignored?=' + !_ok + ')');
            }
          }
        } catch (e) {
          console.error('[Business] onTripEnd error:', e);
        }

        // 旧仕様の today 表示はBusiness連携後にダッシュボード更新で上書きされる
        document.getElementById('todayDist').textContent = (todayDist / 1000).toFixed(2);
        document.getElementById('todayCount').textContent = todayCount;
        showScreen('idle');
        // 業務管理ダッシュボード即時更新（Step 5・2026/05/01追加）
        try {
          updateBusinessDashboard();
        } catch (e) {
          console.error('[Dashboard] update error:', e);
        }
        document.getElementById('appbarTitle').textContent = '空　車';
        document.getElementById('surchargeInfo').style.display = 'none';
        updateSurchargeBadge();
        // 空車5時間後に画面暗転（NoSleepは継続・タイマーのみリセット）
        if (dimTimer) {
          clearTimeout(dimTimer);
          dimTimer = null;
        }
        dimTimer = setTimeout(
          function () {
            document.documentElement.style.filter = 'brightness(0)';
          },
          DIM_MINUTES * 60 * 1000
        );

        // OSRM削除済（2026/04/26）：GPS+IMU融合エンジンへ移行
      }

      // ★設計変更宣言 (2026-05-15・修正1): onMenuClick() 削除済。
      //   旧 ≡ ハンバーガーメニューボタン (menuBtn) からのみ呼び出されていた関数で、
      //   bottom-nav 設定タブの showOverlay('settings') に役割を完全に吸収済のため不要。

