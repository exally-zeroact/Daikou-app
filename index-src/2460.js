      (function migrateDakomeKeys() {
        try {
          var keys = Object.keys(localStorage);
          var migrated = 0;
          for (var i = 0; i < keys.length; i++) {
            var oldKey = keys[i];
            if (oldKey.indexOf('dakome_') === 0) {
              var newKey = 'daikou_' + oldKey.substring(7);
              if (localStorage.getItem(newKey) === null) {
                localStorage.setItem(newKey, localStorage.getItem(oldKey));
              }
              localStorage.removeItem(oldKey);
              migrated++;
            }
          }
          if (migrated > 0 && typeof dlog === 'function') {
            dlog('[migrate] dakome to daikou: ' + migrated + ' keys');
          }
        } catch (e) {
          if (typeof dlog === 'function') dlog('[migrate] error', e);
        }
      })();
