  // ★★ほかの 払い方の 欄を 描く／読む★★ 2026-10-06
  //   読む 形＝js/daiko-payroll.js normExtra の 形（倉庫の pay_extra）。空の 欄は 使わない
  function hokaKaku(st) {
    var ex = st.extra || {};
    var re = ex.roles || {};
    var h = '';
    Object.keys(st.roles).forEach(function (r) {
      var x = re[r] || {};
      var dk = x.dankai || [];
      var a = function (k, v, w) {
        return (
          '<input class="yen" data-hr="' +
          esc(r) +
          '" data-hk="' +
          k +
          '" value="' +
          (v ? v : '') +
          '" style="width:' +
          (w || 90) +
          'px" inputmode="decimal">'
        );
      };
      var dan = '';
      for (var i = 0; i < 3; i++) {
        var t = dk[i] || {};
        dan +=
          '<div class="hoka-gyou">売上 ' +
          a('d' + i + 'i', t.ijou) +
          ' 円 以上で 歩合 ' +
          a('d' + i + 'r', t.rate ? Math.round(t.rate * 1000) / 10 : '', 60) +
          ' ％</div>';
      }
      var mode = ['kawari:歩合の 代わり', 'tasu:歩合に 足す', 'takai:歩合と 高い方']
        .map(function (o) {
          var p = o.split(':');
          return (
            '<option value="' +
            p[0] +
            '"' +
            (x.nikkyuMode === p[0] ? ' selected' : '') +
            '>' +
            p[1] +
            '</option>'
          );
        })
        .join('');
      h +=
        '<div class="hoka-yaku"><div class="hoka-na">' +
        esc(r) +
        '</div>' +
        '<div class="hoka-gyou">日給 ' +
        a('nikkyu', x.nikkyu) +
        ' 円 <select data-hr="' +
        esc(r) +
        '" data-hk="nikkyuMode">' +
        mode +
        '</select> <label><input type="checkbox" data-hr="' +
        esc(r) +
        '" data-hk="nikkyuHoshou"' +
        (x.nikkyuHoshou === false ? '' : ' checked') +
        '> 最低保証も 効かせる</label></div>' +
        dan +
        '</div>';
    });
    var wh = ex.wariHi || {};
    var hi = Object.keys(wh).sort();
    var wr = '';
    for (var j = 0; j < Math.max(3, hi.length + 1); j++) {
      var d = hi[j] || '';
      var o = wh[d] || {};
      wr +=
        '<div class="hoka-gyou"><input type="date" data-hw="' +
        j +
        '" data-hk="hi" value="' +
        d +
        '"> × <input class="yen" data-hw="' +
        j +
        '" data-hk="mult" value="' +
        (o.mult || '') +
        '" style="width:60px" inputmode="decimal"> <input class="txt" data-hw="' +
        j +
        '" data-hk="label" value="' +
        esc(o.label || '') +
        '" placeholder="名前（大晦日 など）" style="width:150px"></div>';
    }
    h +=
      '<div class="hoka-yaku"><div class="hoka-na">会社 全体</div>' +
      // ★回数・距離は 1台 として★（司さん 10-06「回数距離は1台としてやろが」）
      '<div class="hoka-gyou">1回 いくら（1台 あたり） <input class="yen" data-hk="kaisu" value="' +
      (ex.kaisu || '') +
      '" style="width:90px" inputmode="decimal"> 円</div>' +
      '<div class="hoka-gyou">1km いくら（1台 あたり） <input class="yen" data-hk="kyori" value="' +
      (ex.kyori || '') +
      '" style="width:70px" inputmode="decimal"> 円</div>' +
      '<div class="hoka-gyou">1台の 額の 分け方 <select data-hk="bunpai"><option value="ritsu"' +
      (ex.bunpai === 'touwari' ? '' : ' selected') +
      '>役の 歩合の 比で 分ける</option><option value="touwari"' +
      (ex.bunpai === 'touwari' ? ' selected' : '') +
      '>乗った 人数で 等分</option></select></div>' +
      '<div class="hoka-gyou">1km の 距離は <select data-hk="kyoriShu"><option value="jissha"' +
      (ex.kyoriShu === 'sou' ? '' : ' selected') +
      '>客を 乗せた 距離</option><option value="sou"' +
      (ex.kyoriShu === 'sou' ? ' selected' : '') +
      '>全部の 距離</option></select></div>' +
      '<div class="hoka-gyou"><label><input type="checkbox" data-hk="kasanAto"' +
      (ex.kasanAto ? ' checked' : '') +
      '> 1回・1km の 分は 最低保証と 比べた 後で 足す</label></div>' +
      '<div class="hoka-na2">指定日の 割増（倍率）</div>' +
      wr +
      '<div class="hoka-gyou">掛け方 <select data-hk="wariMode"><option value="buai"' +
      (ex.wariMode === 'zentai' ? '' : ' selected') +
      '>歩合だけに 掛ける</option><option value="zentai"' +
      (ex.wariMode === 'zentai' ? ' selected' : '') +
      '>その日の 給料 全体に 掛ける</option></select></div>' +
      // ★★夜の 割増★★ 2026-10-06（車の 打刻から 夜の 時間の 割合を 出して 掛ける・手で 入れた 日は 付かない）
      '<div class="hoka-na2">夜の 割増</div>' +
      '<div class="hoka-gyou">時間帯 <input type="time" data-hk="yKara" value="' +
      hmOf(ex.yakan && ex.yakan.kara, '22:00') +
      '"> 〜 <input type="time" data-hk="yMade" value="' +
      hmOf(ex.yakan && ex.yakan.made, '05:00') +
      '"> × <input class="yen" data-hk="yMult" value="' +
      ((ex.yakan && ex.yakan.mult) || '') +
      // 空の 時は 割増 無し（計算は 1 より 大きい 時だけ）＝例と 分かる 字に する 2026-10-19（自動の 数を 濃く した 時の 対立役 指摘）
      '" style="width:72px" inputmode="decimal" placeholder="例 1.25"></div>' +
      '<div class="hoka-gyou">掛け方 <select data-hk="yMode"><option value="buai"' +
      (ex.yakan && ex.yakan.mode === 'zentai' ? '' : ' selected') +
      '>歩合だけに 掛ける</option><option value="zentai"' +
      (ex.yakan && ex.yakan.mode === 'zentai' ? ' selected' : '') +
      '>その日の 給料 全体に 掛ける</option></select></div>' +
      '<div class="hoka-gyou">指定日と 重なる 日は <select data-hk="kasane"><option value="kakeru"' +
      (ex.kasane === 'tasu' ? '' : ' selected') +
      '>掛け合わせる</option><option value="tasu"' +
      (ex.kasane === 'tasu' ? ' selected' : '') +
      '>足す</option></select></div>' +
      '<div class="hoka-chui">車の 打刻（始まり〜終わり）の うち 時間帯に 入る 割合で 掛けます。手で 入れた 日は 時刻が 無いので 付きません。</div>' +
      '</div>' +
      '<div class="hoka-chui">空の 所は 使いません（今の 給料の まま）。決めたら 下の「保存する」。</div>';
    $('hokaBody').innerHTML = h;
    Array.prototype.forEach.call(
      document.querySelectorAll('#hokaBody input, #hokaBody select'),
      function (el) {
        el.onchange = function () {
          SET = SET || {};
          SET.pay_extra = hokaYomu();
          RAW.payrollSettings = SET;
          recalc();
        };
      }
    );
  }
  // ★分の 数（0時から）→「HH:MM」★（夜の 時間帯の 欄に 戻す 為）
  function hmOf(v, dflt) {
    if (typeof v !== 'number' || !(v >= 0)) return dflt;
    var h = Math.floor(v / 60) % 24;
    var m = v % 60;
    return ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2);
  }
  function hokaYomu() {
    var body = document.getElementById('hokaBody');
    if (!body || !body.querySelector('[data-hk]')) return (SET && SET.pay_extra) || null;
    var out = { roles: {}, wariHi: {} };
    var v = function (el) {
      return el ? num(el.value) : 0;
    };
    var hr = {};
    Array.prototype.forEach.call(body.querySelectorAll('[data-hr]'), function (el) {
      var r = el.getAttribute('data-hr');
      if (!hr[r]) hr[r] = {};
      hr[r][el.getAttribute('data-hk')] = el;
    });
    Object.keys(hr).forEach(function (r) {
      var b = hr[r];
      var dk = [];
      for (var i = 0; i < 3; i++) {
        var ij = v(b['d' + i + 'i']);
        var rt = v(b['d' + i + 'r']) / 100;
        if (ij > 0 && rt > 0) dk.push({ ijou: ij, rate: rt });
      }
      var x = {
        nikkyu: v(b.nikkyu),
        nikkyuMode: (b.nikkyuMode || {}).value || 'kawari',
        nikkyuHoshou: !!(b.nikkyuHoshou || {}).checked,
        dankai: dk,
      };
      if (x.nikkyu || dk.length) out.roles[r] = x;
    });
    var hw = {};
    Array.prototype.forEach.call(body.querySelectorAll('[data-hw]'), function (el) {
      var j = el.getAttribute('data-hw');
      if (!hw[j]) hw[j] = {};
      hw[j][el.getAttribute('data-hk')] = el;
    });
    Object.keys(hw).forEach(function (j) {
      var w = hw[j];
      var m = v(w.mult);
      if (w.hi && w.hi.value && m > 0) {
        out.wariHi[w.hi.value] = { mult: m, label: (w.label || {}).value || '' };
      }
    });
    var g = function (k) {
      return body.querySelector('[data-hk="' + k + '"]:not([data-hr]):not([data-hw])');
    };
    out.kaisu = v(g('kaisu'));
    out.kyori = v(g('kyori'));
    out.bunpai = (g('bunpai') || {}).value || 'ritsu';
    out.kyoriShu = (g('kyoriShu') || {}).value || 'jissha';
    out.kasanAto = !!(g('kasanAto') || {}).checked;
    out.wariMode = (g('wariMode') || {}).value || 'buai';
    out.kasane = (g('kasane') || {}).value || 'kakeru';
    var ym = v(g('yMult'));
    out.yakan =
      ym > 1
        ? {
            kara: (g('yKara') || {}).value || '22:00',
            made: (g('yMade') || {}).value || '05:00',
            mult: ym,
            mode: (g('yMode') || {}).value || 'buai',
          }
        : null;
    return out;
  }

