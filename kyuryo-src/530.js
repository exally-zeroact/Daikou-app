  // ★★倉庫の 設定 → 画面の 欄★★
  //   tsuyoku＝触った 欄も 倉庫の 形に 戻す（保存・記録の 読み直しの 後だけ）
  //   ★触った 欄は 役割の 足し消し・タブ・日付の 変更で 黙って 戻さない★（対立役 2回目 直3）
  function shimeKataIreru(tsuyoku) {
    if (SHIME_SAWATTA && !tsuyoku) {
      kikanDashiwake();
      return;
    }
    var sh = SET && SET.period_shime;
    var mo = SET && SET.period_end_mode;
    // ★日付が 在る＝その 日に 効く 形を 出す★（何日から 2026-10-19・列の 形を 出すと 直した 後に 戻って 見える）
    var hiNoK = shimeNoHiKata(shimeHi());
    if (hiNoK) {
      if (hiNoK.kind === 'thirds') {
        sh = null;
        mo = 'thirds';
      } else {
        sh = hiNoK;
        mo = 'shime';
      }
    }
    SHIME_SAWATTA = false;
    shimeRanNiIreru(sh, mo);
    kikanDashiwake();
  }
  // ★締めの 形 → 払い方の 欄★（倉庫の 形を 出す 時と テンプレを 選んだ 時の 1か所・2026-10-24）
  //   sh＝{kind,hi,youbi,nazuke}（無い 時は mo で 月3回 か 選び直し）
  function shimeRanNiIreru(sh, mo) {
    $('pShimeHi').value = '';
    $('pNarabe').value = '';
    $('pYoubi').value = '0';
    $('pNazuke').value = '';
    if (sh && typeof sh === 'object') {
      if (sh.nazuke) $('pNazuke').value = sh.nazuke;
      var hi = Array.isArray(sh.hi) ? sh.hi : [];
      var j = hi.join(',');
      if (sh.kind === 'hi') $('pMode').value = 'hi';
      else if (sh.kind === 'shuu') {
        $('pMode').value = 'shuu';
        $('pYoubi').value = String(sh.youbi);
      } else if (sh.kind === 'tsuki' && j === '15,0') $('pMode').value = 'tsuki2';
      else if (sh.kind === 'tsuki' && j === '0') $('pMode').value = 'matsu';
      else if (sh.kind === 'tsuki' && hi.length === 1) {
        $('pMode').value = 'tsuki1';
        $('pShimeHi').value = String(hi[0]);
      } else if (sh.kind === 'tsuki') {
        $('pMode').value = 'narabe';
        $('pNarabe').value = hi
          .map(function (x) {
            return x === 0 ? '末' : String(x);
          })
          .join(',');
      } else $('pMode').value = '';
    } else if (!mo || mo === 'thirds') {
      $('pMode').value = 'thirds';
    } else {
      // ★昔の month_end／days は 今の 作りでは 読めない＝選び直して もらう★
      $('pMode').value = '';
    }
  }

  function renderSet() {
    var st = PayrollDaily.normSettings(SET, RAW.shimeRireki);
    kikanDashiwake();
    renderRoles();
    hokaKaku(st);

    $('poolMode').value = st.poolMode;
    $('resPool').value = Math.round(st.reservePoolRate * 1000) / 10;
    $('resOwner').value = Math.round(st.reserveOwnerRate * 1000) / 10;
    $('resFirst').checked = !!st.deductReserveBeforeRate;
    // ★既定は 載せる（true）★＝倉庫にまだ無い会社も 今までと同じ見た目
    $('showCarSales').checked = !(SET && SET.show_car_sales === false);
    shimeKataIreru(); // ★締めの 形★ 2026-10-07
    renderShimeRireki(); // ★締めの 何日から★ 2026-10-19

    var devs = ((CTX && CTX.devices) || []).slice();
    // ★今の 自分の 車が 名簿に 無くても 選び肢に 残す★ 2026-10-16 対立役
    //   （名前が 無く この 期に 走っていない 車だと「決めていない」に なり、保存で 黙って 空に なった＝
    //     売上の 分け方「自分の車を 除いた 全部」の 取り分が 変わる）
    if (st.ownerDeviceId && devs.indexOf(st.ownerDeviceId) < 0) devs.push(st.ownerDeviceId);
    $('ownerDev').innerHTML =
      '<option value="">（決めていない）</option>' +
      devs
        .map(function (d) {
          var lab = _carName(d); // ★UUIDは出さない (2026-08-05)★
          return (
            '<option value="' +
            esc(d) +
            '"' +
            (d === st.ownerDeviceId ? ' selected' : '') +
            '>' +
            esc(lab) +
            '</option>'
          );
        })
        .join('');
  }

  // ★役割の 表だけ 描き直す★ 2026-10-18（何日から・対立役 3回目 直2）
  //   日付・記録・値の 直しで renderSet を 呼ぶと、打っただけで 保存していない 積立・締め 等の 欄が SET の 値に 戻った
  function renderRoles() {
    var st = PayrollDaily.normSettings(SET, RAW.shimeRireki);
    var html = '';
    // data-l は★スマホで1行1枚にした時の見出し★（横スクロールさせない）
    //   ★欄には 選んだ 日に 効く 値★（何日から 10-18・対立役 止2＝列の 値を 出すと 直した 後に 戻って 見える）
    Object.keys(st.roles).forEach(function (r) {
      var v = yakuNoHiAtai(r, yakuHi(r)) || st.roles[r];
      var n = yakuRirekiNo(yakuMotoNo(r)).length;
      html +=
        '<tr><td data-l="役割"><input class="txt" data-role="' +
        esc(r) +
        '" data-f="name" value="' +
        esc(r) +
        '"></td>' +
        // ★日付は 値の 前★（値を 打ってから 日付を 変えると 前の 日付で 書かれる・対立役 直3）
        '<td data-l="何日から"><input type="date" class="hi-in" data-yh="' +
        esc(r) +
        '" value="' +
        esc(yakuHi(r)) +
        '"> <button class="btn ghost" type="button" data-yrk="' +
        esc(r) +
        '">記録 ' +
        (Array.isArray(RAW.yakuRireki) ? n : '?') +
        '</button>' +
        yakuHiNoChui(r) +
        '<span class="saved" data-yk-saved="' +
        esc(r) +
        '"></span></td>' +
        '<td data-l="歩合"><input class="hrs" data-role="' +
        esc(r) +
        '" data-f="rate" value="' +
        v.rate +
        '"></td>' +
        '<td data-l="最低保証"><input class="yen" data-role="' +
        esc(r) +
        '" data-f="floor" value="' +
        v.floor +
        '"> 円</td>' +
        '<td data-l="消す"><button class="xbtn" data-role-del="' +
        esc(r) +
        '">✕</button></td></tr>';
      if (YAKU_RIREKI_HIRAKU[r]) html += yakuRirekiNoGyou(yakuMotoNo(r), st.roles[r]);
    });
    // ★決まりに 無い 役割の 記録（残った 記録）も 出して 消せる 様に★（対立役 2回目 止1）
    yakuNokoriNo(st).forEach(function (y) {
      html += yakuRirekiNoGyou(y, null);
    });
    $('roleBody').innerHTML = html;
    yakuRirekiNoBotan();
    Array.prototype.forEach.call(document.querySelectorAll('[data-role-del]'), function (b) {
      b.onclick = function () {
        var r = b.getAttribute('data-role-del');
        var st2 = PayrollDaily.normSettings(SET, RAW.shimeRireki);
        // ★最後の 1つは 消させない★（空に すると 既定の 役割に 黙って 戻る）2026-10-17
        if (Object.keys(st2.roles).length <= 1)
          return showErr('役割を 全部 消す 事は できません。1つは 残してください。');
        // ★その 役割の 人（辞めた 人も）が 居れば 消させない★（消すと その人の 給料が 計算できない）
        var hito = yakuNoHito(r);
        if (hito.length)
          return showErr(
            '「' +
              r +
              '」の 人が 居るので 消せません：' +
              hito.slice(0, 5).join('・') +
              (hito.length > 5 ? ' ほか ' + (hito.length - 5) + '人' : '') +
              '。先に「従業員」で その 人の 役割を 変えてください。'
          );
        // ★変えた 記録の 在る 役割は 消させない★（何日から 10-18＝同じ 名前を 足すと 古い 記録が 黙って 効く）
        if (!Array.isArray(RAW.yakuRireki))
          return showErr('役割の 変えた 記録を 読めていないので 消せません。開き直してください。');
        if (yakuRirekiNo(yakuMotoNo(r)).length)
          return showErr(
            '「' + r + '」には 変えた 記録が 在るので 消せません。先に「記録」で 消してください。'
          );
        delete st2.roles[r];
        delete YAKU_MOTO[r];
        stageRoles(st2.roles);
        renderSet();
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-role]'), function (i) {
      i.onchange = function () {
        var st2 = PayrollDaily.normSettings(SET, RAW.shimeRireki);
        var old = i.getAttribute('data-role');
        var f = i.getAttribute('data-f');
        var cur = st2.roles[old] || { rate: 0, floor: 0 };
        if (f === 'name') {
          var nv = String(i.value || '').trim();
          if (!nv || nv === old) {
            i.value = old;
            return;
          }
          // ★在る 名前には 直させない★（その 役割の 決まりが 上書きされる）2026-10-17
          if (Object.prototype.hasOwnProperty.call(st2.roles, nv)) {
            i.value = old;
            return showErr('「' + nv + '」は もう 在る 役割です。同じ 名前には できません。');
          }
          // ★この 画面で 消した 名前には 保存の 前に 直させない★（倉庫には まだ 在る＝保存で「同じ 名前」と 断られる）
          if (
            YAKU_YOMI.indexOf(nv) >= 0 &&
            !Object.keys(YAKU_MOTO).some(function (ima) {
              return YAKU_MOTO[ima] === nv;
            })
          ) {
            i.value = old;
            return showErr(
              '「' +
                nv +
                '」は この 画面で 消した 名前です。一度 保存してから その 名前に 直してください。'
            );
          }
          // ★変えた 記録が 残っている 名前には 直させない★（その 記録が 黙って 効く・対立役 2回目 止1）
          if (
            (RAW.yakuRireki || []).some(function (x) {
              return x && x.yaku === nv;
            }) &&
            !Object.keys(YAKU_MOTO).some(function (ima) {
              return YAKU_MOTO[ima] === nv;
            })
          ) {
            i.value = old;
            return showErr(
              '「' + nv + '」には 変えた 記録が 残っています。先に その 記録を 消してください。'
            );
          }
          if (Object.prototype.hasOwnProperty.call(YAKU_HI, old)) {
            YAKU_HI[nv] = YAKU_HI[old];
            delete YAKU_HI[old];
          }
          // 覚えた 日も 新しい 名前へ 付け替える（古い 名前の 覚えを 残さない・2026-10-25）
          var oboe = hiOboeHiku('yaku', old);
          hiOboeKaku('yaku', old, null);
          if (oboe !== null) hiOboeKaku('yaku', nv, oboe);
          delete st2.roles[old];
          st2.roles[nv] = cur;
          // ★日給・段階歩合も 新しい 名前へ 一緒に 移す★（前は 古い 名前の まま 残り、保存で 消えた）
          var px = hokaYomu();
          if (px && px.roles && px.roles[old]) {
            px = JSON.parse(JSON.stringify(px));
            px.roles[nv] = px.roles[old];
            delete px.roles[old];
          }
          if (px) {
            SET = SET || {};
            SET.pay_extra = px;
          }
          // 読み込んだ 時の 名前を 控える（保存の 時に 人の 役割も 倉庫で 一緒に 直す）
          var moto = Object.prototype.hasOwnProperty.call(YAKU_MOTO, old) ? YAKU_MOTO[old] : old;
          delete YAKU_MOTO[old];
          YAKU_MOTO[nv] = moto;
        } else {
          // ★日付が 在る＝その 日から の 記録を その場で 書く★（列は 変えない・何日から 10-18）
          if (hiHiGawariTomeru()) return;
          var yh = yakuHi(old);
          if (yh) return saveYakuRireki(old, f, i.value, yh);
          cur[f] = num(i.value);
          st2.roles[old] = cur;
          stageRoles(st2.roles);
          return renderRoles();
        }
        stageRoles(st2.roles);
        renderSet();
      };
    });
  }

  // ── 車の名前と並び (2026-08-05) ─────────────────
  //   司さん「売上1,2.3とかもここで並べ変えや名前を決めれるようにしたら楽」
  //   ★保存はその場★（役割の決まりと違い「保存」ボタンを押させない）
  function renderCars() {
    var devs = (CTX && CTX.devices) || [];
    var rows = (RAW && RAW.labels) || [];
    var byId = {};
    rows.forEach(function (l) {
      if (l && l.device_id) byId[l.device_id] = l;
    });
    var names = window.CarName ? window.CarName.nameMap(devs, rows) : {};
    var sorted = window.CarName ? window.CarName.sortIds(devs, rows) : devs.slice();

    var html = sorted
      .map(function (d) {
        var cur = byId[d] || {};
        return (
          '<tr><td data-l="今の呼び方">' +
          esc(names[d] || '車') +
          '</td>' +
          '<td data-l="名前"><input class="txt" data-car="' +
          esc(d) +
          '" data-f="label" placeholder="' +
          esc(names[d] || '') +
          '" value="' +
          esc(cur.label || '') +
          '"></td>' +
          '<td data-l="並び"><input class="hrs" data-car="' +
          esc(d) +
          '" data-f="sort_order" inputmode="numeric" value="' +
          (cur.sort_order === null || cur.sort_order === undefined ? '' : cur.sort_order) +
          '"></td>' +
          // ★1台ずつ 明細に出す/出さない (2026-08-25)★ 決めていなければ出す（今までどおり）
          '<td data-l="明細に出す"><input type="checkbox" style="width:17px;height:17px" data-car="' +
          esc(d) +
          '" data-f="show_in_slip"' +
          // ★出す/出さないの判定は carShowsInSlip 1か所★
          //   ここで もう一度 決めると 設定の画面と 明細が 食い違う。
          (carShowsInSlip(d) ? ' checked' : '') +
          '></td></tr>'
        );
      })
      .join('');
    if (!sorted.length) {
      html = '<tr><td colspan="3" class="empty">まだ車がありません。</td></tr>';
    }
    $('carBody').innerHTML = html;

    Array.prototype.forEach.call(document.querySelectorAll('[data-car]'), function (i) {
      i.onchange = function () {
        var f = i.getAttribute('data-f');
        var v;
        if (i.type === 'checkbox') {
          // ★チェックは value ではなく checked★（value を読むと いつも "on" になる）
          v = i.checked;
        } else if (f === 'sort_order') {
          v = String(i.value).trim() === '' ? null : num(i.value); // ★空欄なら今までどおり★
        } else {
          v = String(i.value).trim();
        }
        saveCar(i.getAttribute('data-car'), f, v);
      };
    });
  }

  function saveCar(deviceId, field, value) {
    if (!COMPANY) return Promise.resolve(false);
    var body = {
      company_id: COMPANY.company_id,
      device_id: deviceId,
      updated_at: new Date().toISOString(),
    };
    body[field] = value;
    // 返り値＝書けたか（true/false）。新しい 車を 足す 時は 書けてから その日の 行を 足す
    return DKSession.rest(SESS, 'dk_device_labels?on_conflict=company_id,device_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(body),
    })
      .then(function (r) {
        if (!r.ok) {
          saveErr('車の名前を保存できませんでした。', r);
          return false;
        }
        showErr('');
        // 手元の控えも合わせる（画面のあちこちで同じ名前になるように）
        var hit = null;
        RAW.labels.forEach(function (l) {
          if (l && l.device_id === deviceId) hit = l;
        });
        if (!hit) {
          hit = { company_id: COMPANY.company_id, device_id: deviceId };
          RAW.labels.push(hit);
        }
        hit[field] = value;
        // 名前は 書けた＝true を 返す。描き直しが 転んだら 黙らず 赤字で 知らせる（対立役：console だけだと
        //   給料の 計算が 古い まま 何も 出なかった）
        try {
          recalc();
          renderCars();
          flash('carSaved', '保存しました');
        } catch (e) {
          // eslint-disable-next-line no-console -- 2026-11-07 html から 出した 前からの 行（中身は 変えない・件2 で 直す）
          if (window.console) console.warn('[saveCar] 描き直し', e);
          showErr(
            '車の名前は保存しましたが、画面の計算で問題が出ました。画面を読み込み直してください。'
          );
        }
        return true;
      })
      .catch(function () {
        showErr('車の名前を保存できませんでした。');
        return false;
      });
  }

