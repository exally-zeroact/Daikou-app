      // Phase 3 バナー表示制御
      (function () {
        function _hasConsent() {
          try {
            return localStorage.getItem('daikome_training_consent') !== null;
          } catch (_) {
            return true;
          }
        }
        function _showBanner() {
          // ★★出しません（司さん 2026-09-01「Firebaseは使うな」）★★
          //   この帯は ★学習データを Firebase Storage へ 上げてよいか★を 聞く 物でした。
          //   Firebase を 外したので ★どこにも 上がりません★。
          //   ⇒ ★上げないのに「送ります」と 聞くのは 嘘★なので 出しません。
          //   （中の 仕掛けは 消していません＝別の 上げ先に 付け替える時に そのまま 使えます）
          return;
        }
        function _hideBanner() {
          const el = document.getElementById('trainingConsentBanner');
          if (el) el.style.display = 'none';
        }
        function _saveConsent(value) {
          try {
            localStorage.setItem('daikome_training_consent', value);
            // OK/閉じる いずれも default ON
            localStorage.setItem('daikome_training_enabled', 'true');
          } catch (_) {}
          if (
            typeof TrainingCollector !== 'undefined' &&
            TrainingCollector.refreshEnabledFromStorage
          ) {
            try {
              TrainingCollector.refreshEnabledFromStorage();
            } catch (_) {}
          }
          if (
            typeof TrainingUploader !== 'undefined' &&
            TrainingUploader.refreshEnabledFromStorage
          ) {
            try {
              TrainingUploader.refreshEnabledFromStorage();
            } catch (_) {}
          }
        }
        window.agreeTrainingBanner = function () {
          _saveConsent('agreed');
          _hideBanner();
        };
        window.dismissTrainingBanner = function () {
          _saveConsent('dismissed');
          _hideBanner();
        };
        // ★2026-06-30 司さん裁定A「起動オンボーディングはいらない」: データ収集バナーを自動表示しない
        //   (false && で無効化)。データ収集(訓練/trace)は設定からのopt-inのみ・規約同意は外販時LP側へ。
        if (false && !_hasConsent()) {
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', _showBanner);
          } else {
            _showBanner();
          }
        }
      })();
