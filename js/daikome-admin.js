/* ============================================================
 * js/daikome-admin.js
 * ★ダイコメ 管理画面（運営＝司さん専用）★ 2026-08-07
 *
 *   司さん「ダイコメの管理アプリを（Exally系の）ように作って
 *           そこでおれが権限持つようしろ」
 *
 *   ★他のアプリ（Kyually admin.html / Castally castally-admin.html）と同じ形★
 *     ログイン → 管理者か判定 → 一覧 → 押して切り替え。それだけ。
 *
 *   ★ダイコメで押す物★
 *     プランではなく ★使う / 止める★ と ★席数★。
 *     dk_companies.status / seat_limit は元からある。新しい仕組みは足していない。
 *
 *   ▼守ること
 *     ・鍵の本体は倉庫側(RLS)。この画面は見せ方だけ＝サービス鍵は絶対に置かない
 *     ・押した瞬間に画面を先に変え、失敗したら戻す（待たせない）
 *     ・数字を勝手に丸めない・件数は必ず出す
 * ============================================================ */
(function () {
  'use strict';

  const $ = function (id) {
    return document.getElementById(id);
  };

  // ★部品が読めなかった時に、黙って止まらないこと★ 2026-08-07
  //   ログインの部品は外(CDN)から読んでいる。電波が悪い/塞がれていると読めず、
  //   ★ログインを押しても何も起きない★（司さんが「押しても反応しない」と言う形）。
  //   何が足りないかを画面に出して、押せば読み直せるようにする。
  const cfg = window.DKConfig;
  if (!cfg || !window.supabase || !window.supabase.createClient) {
    const m = $('msg');
    if (m) {
      m.textContent = !window.supabase
        ? 'ログインの部品が読めませんでした。電波の良い所で画面を読み直してください。'
        : '設定が読めませんでした。画面を読み直してください。';
    }
    const b = $('signin');
    if (b) {
      b.textContent = '読み直す';
      b.onclick = function () {
        location.reload();
      };
    }
    return; // ここで止める（この先は動かせない）
  }
  const sb = window.supabase.createClient(cfg.SB_URL, cfg.ANON_KEY);

  let rows = []; // 会社ぜんぶ
  let curEmail = '';

  function show(id) {
    ['login', 'denied', 'panel'].forEach(function (x) {
      $(x).classList.toggle('hide', x !== id);
    });
    $('topbar').classList.toggle('hide', id === 'login');
  }

  // ★ログイン画面の中で出し分ける (2026-08-07・司さん「新規ではいるボタン作れ」)★
  //   事務所のログイン(login.html)と同じ形。
  //   ★パスワードは本人が決める★（こちらで決めない）。
  function card(which) {
    ['loginCard', 'sendCard', 'sentCard', 'setPwCard'].forEach(function (id) {
      const el = $(id);
      if (el) el.classList.toggle('hide', id !== which);
    });
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  let toastT = null;
  function toast(m) {
    const t = $('toast');
    t.textContent = m;
    t.classList.add('show');
    if (toastT) clearTimeout(toastT);
    toastT = setTimeout(function () {
      t.classList.remove('show');
    }, 1800);
  }
  function ymd(s) {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d)) return '—';
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  }

  // ── ログイン ──
  $('signin').onclick = function () {
    const e = $('email').value.trim();
    const p = $('pw').value;
    if (!e || !p) {
      $('msg').textContent = 'メールとパスワードを入れてください';
      return;
    }
    $('msg').textContent = 'ログイン中…';
    sb.auth.signInWithPassword({ email: e, password: p }).then(function (r) {
      if (r.error) {
        $('msg').textContent = /Invalid/.test(r.error.message)
          ? 'メールかパスワードが違います'
          : r.error.message;
      } else {
        $('msg').textContent = '';
        boot();
      }
    });
  };
  $('pw').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') $('signin').click();
  });

  // ── ★新規登録★ 2026-08-07 ──
  //   司さん「他のアプリでユーザーがやるように、なんで同じ構造にせんのど」
  //
  //   ★他のアプリ(js/exally-login.js)と一字一句 同じ流れ★
  //     メールとパスワードを自分で打つ → 新規登録 → メール確認が要らない設定なので
  //     そのまま入る。要る設定でも、すぐ後ろでログインし直して入る。
  //   ★メールのリンクは使わない★ = 届くのを待たない／localhost に飛ぶ事故も起きない。
  //
  //   ★誰でも運営になれる訳ではない★
  //     ここで作られるのは「ただの利用者」。運営かどうかは dk_admins で判定するので、
  //     入っていない人は「権限がありません」で止まる（他のアプリの管理画面と同じ）。
  $('signup').onclick = function () {
    const e = $('email').value.trim();
    const p = $('pw').value;
    if (!e || p.length < 6) {
      $('msg').textContent = 'メールと、6文字以上のパスワードを入れてください';
      return;
    }
    $('msg').textContent = '登録中…';
    const b = $('signup');
    b.disabled = true;
    sb.auth.signUp({ email: e, password: p }).then(function (r) {
      if (r.error) {
        b.disabled = false;
        const m = String(r.error.message || '');
        // ★既に登録済みの時に「エラー」で終わらせない★
        //   このアドレスは他のアプリでも使っている＝既に有る事の方が多い。
        //   何をすればいいかを書く。
        $('msg').textContent = /already registered|already been registered|User already/i.test(m)
          ? 'このアドレスは登録済みです。パスワードを入れて「ログイン」を押してください。分からない時は下の「パスワードを忘れた」から。'
          : /weak|at least/i.test(m)
            ? 'パスワードは6文字以上にしてください'
            : m;
        return;
      }
      // メール確認オフのときは、登録の直後にそのまま入れる
      if (r.data && r.data.session) {
        b.disabled = false;
        $('msg').textContent = '';
        boot();
        return;
      }
      sb.auth.signInWithPassword({ email: e, password: p }).then(function (li) {
        b.disabled = false;
        if (li.error) {
          $('msg').textContent = '登録できました。そのままログインしてください';
          return;
        }
        $('msg').textContent = '';
        boot();
      });
    });
  };
  $('logout').onclick = function () {
    sb.auth.signOut().then(function () {
      location.reload();
    });
  };

  // ── ★はじめて入る／パスワードを忘れた★ 2026-08-07 ──
  //   司さん「新規ではいるボタン作れ」
  //   事務所のログイン(login.html)と同じ流れ。★決めるのは本人★。
  $('toSetPw').onclick = function (e) {
    e.preventDefault();
    $('email2').value = $('email').value.trim();
    $('msg2').textContent = '';
    card('sendCard');
  };
  $('toLogin').onclick = function (e) {
    e.preventDefault();
    card('loginCard');
  };

  $('sendBtn').onclick = function () {
    const mail = String($('email2').value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(mail)) {
      $('msg2').textContent = 'メールアドレスを確かめてください';
      return;
    }
    $('msg2').textContent = '';
    const b = $('sendBtn');
    b.disabled = true;
    b.textContent = '送信中…';
    // ★戻り先はこの画面★（ここでそのままパスワードを決めてもらう）
    //
    //   ★2026-08-07 ここで事故った★ 司さん「メール開いたらこれ（localhost）」
    //     Supabase は★許可リストに載っていない戻り先を黙って捨てて★、
    //     既定の戻り先(SITE_URL)へ流す。テスト側の倉庫は SITE_URL が
    //     http://localhost:3000 だったので、メールのリンクが localhost に飛んだ。
    //   ⇒ scripts/auth-redirect-allow.mjs で★本番とテストの両方★に
    //     ダイコメの4ホストを足した（SITE_URL は触っていない）。
    //     道具が本番しか見ていなかったのが元の穴。
    // ★「パスワードを決める」ための正しい道 (2026-08-07)★
    //   はじめは signInWithOtp を使ったが、この倉庫は★OTPでの新規作成を止めてある★ため
    //   422(otp_disabled) で送れなかった。
    //   ここでやりたいのは「登録済みの運営が★パスワードを決め直す★」ことなので、
    //   ★パスワード再設定(recover)★ が正しい。新しいアカウントは作らない
    //   ＝運営の画面に誰でも入れる形にしない。
    sb.auth
      .resetPasswordForEmail(mail, {
        redirectTo: location.origin + '/daikome-admin.html',
      })
      .then(function (r) {
        b.disabled = false;
        b.textContent = 'メールを送る';
        if (r.error) {
          // ★何が起きたかを分けて出す★（「送れません」だけだと原因が分からない）
          const m = String(r.error.message || '');
          // ★何が起きたかを分けて出す★（「送れません」だけだと何をすればいいか分からない）
          $('msg2').textContent = /rate limit|after \d+ ?s|429/i.test(m)
            ? '続けて送れません。1分ほど待ってから、もう一度押してください。'
            : /not allowed|otp_disabled|Signups|not found|invalid/i.test(m)
              ? 'このアドレスは登録されていません。運営に使うアドレスを確かめてください。'
              : '送れませんでした。時間をおいてお試しください。';
          return;
        }
        $('sentTo').textContent = mail;
        card('sentCard');
      });
  };

  $('savePwBtn').onclick = function () {
    const p1 = $('pw1').value;
    const p2 = $('pw2').value;
    if (!p1 || p1.length < 6) {
      $('msg3').textContent = 'パスワードは6文字以上にしてください';
      return;
    }
    if (p1 !== p2) {
      $('msg3').textContent = '2つのパスワードが違います';
      return;
    }
    $('msg3').textContent = '';
    const b = $('savePwBtn');
    b.disabled = true;
    b.textContent = '保存中…';
    sb.auth.updateUser({ password: p1 }).then(function (r) {
      b.disabled = false;
      b.textContent = '決めて、はじめる';
      if (r.error) {
        $('msg3').textContent = '時間が経ちすぎました。もう一度メールを送ってください。';
        return;
      }
      toast('パスワードを決めました');
      boot();
    });
  };
  $('refresh').onclick = function () {
    loadList();
  };
  $('q').addEventListener('input', render);

  // ── 起動: ログインを見る → ★ダイコメの運営か判定★ ──
  function boot() {
    // ★メールのリンクから戻ってきた時は、そのままパスワードを決めてもらう★ 2026-08-07
    //   （司さん「新規ではいるボタン作れ」。決めるのは本人）
    if (/access_token=/.test(location.hash || '')) {
      show('login');
      card('setPwCard');
      return;
    }
    sb.auth.getUser().then(function (r) {
      const u = r.data && r.data.user;
      if (!u) {
        show('login');
        card('loginCard');
        return;
      }
      curEmail = u.email || '';
      $('who').textContent = curEmail;
      // ★ダイコメ自身の dk_admins を見る（Exally の表には寄りかからない）★
      sb.from('dk_admins')
        .select('account_id')
        .eq('account_id', u.id)
        .maybeSingle()
        .then(function (a) {
          if (a.data) {
            show('panel');
            loadList();
          } else {
            show('denied');
          }
        });
    });
  }

  // ── 一覧を取る ──
  function loadList() {
    $('stat').textContent = '読み込み中…';
    Promise.all([
      sb
        .from('dk_companies')
        .select('company_id,name,status,seat_limit,plan,contact,owner_id,created_at'),
      sb.from('dk_company_devices').select('company_id,device_id'),
      sb.from('dk_shifts').select('company_id,started_at'),
    ]).then(function (res) {
      const cos = (res[0] && res[0].data) || [];
      const devs = (res[1] && res[1].data) || [];
      const shifts = (res[2] && res[2].data) || [];

      const devN = {};
      devs.forEach(function (d) {
        if (!d) return;
        devN[d.company_id] = (devN[d.company_id] || 0) + 1;
      });
      const last = {};
      shifts.forEach(function (s) {
        if (!s || !s.started_at) return;
        if (!last[s.company_id] || s.started_at > last[s.company_id])
          last[s.company_id] = s.started_at;
      });

      rows = cos.map(function (c) {
        return {
          id: c.company_id,
          name: c.name || '(名前なし)',
          status: c.status === 'off' ? 'off' : 'on',
          seat: Number(c.seat_limit) || 0,
          contact: c.contact || '',
          created: c.created_at,
          devices: devN[c.company_id] || 0,
          last: last[c.company_id] || null,
        };
      });
      rows.sort(function (a, b) {
        return String(a.name).localeCompare(String(b.name), 'ja');
      });
      render();
    });
  }

  // ── 出す ──
  function render() {
    const q = String($('q').value || '')
      .trim()
      .toLowerCase();
    const list = rows.filter(function (r) {
      if (!q) return true;
      return (r.name + ' ' + r.contact).toLowerCase().indexOf(q) >= 0;
    });

    const off = rows.filter(function (r) {
      return r.status === 'off';
    }).length;
    $('stat').textContent =
      '全部で ' +
      rows.length +
      ' 社（止めている会社 ' +
      off +
      '）' +
      (q ? ' … しぼり込み ' + list.length + ' 社' : '');

    if (!list.length) {
      $('list').innerHTML = '<div class="card empty">ありません</div>';
      return;
    }

    $('list').innerHTML = list
      .map(function (r) {
        return (
          '<div class="co" data-id="' +
          esc(r.id) +
          '">' +
          '<div class="co-name">' +
          esc(r.name) +
          '</div>' +
          '<div class="co-sub">' +
          esc(r.contact || '(連絡先なし)') +
          '</div>' +
          '<div class="co-sub">はじめ ' +
          ymd(r.created) +
          '　最後に走った日 ' +
          ymd(r.last) +
          '　使っている車 ' +
          r.devices +
          '台</div>' +
          '<div class="co-row">' +
          '<div class="seg">' +
          '<button class="pill' +
          (r.status === 'on' ? ' on' : '') +
          '" data-act="on">使う</button>' +
          '<button class="pill off' +
          (r.status === 'off' ? ' on' : '') +
          '" data-act="off">止める</button>' +
          '</div>' +
          '<div class="seat">席数 <input type="number" inputmode="numeric" min="0" value="' +
          r.seat +
          '" data-act="seat"> 台</div>' +
          '</div></div>'
        );
      })
      .join('');

    Array.prototype.forEach.call($('list').querySelectorAll('[data-act]'), function (el) {
      const box = el.closest('.co');
      const id = box.getAttribute('data-id');
      const act = el.getAttribute('data-act');
      if (act === 'seat') {
        el.onchange = function () {
          setSeat(id, Math.max(0, parseInt(el.value, 10) || 0), el);
        };
      } else {
        el.onclick = function () {
          setStatus(id, act);
        };
      }
    });
  }

  // ── ★新しいお客さん（会社）を登録する★ 2026-08-07 ──
  //   司さん「おれが新規で登録してやるんやろが」
  //   今まではお客さん自身が事務所から登録する形しか無かった。
  //   ここで登録して、★その会社に渡す会社URL★を出す。
  //   ・url_token は毎回ちがう物を作る（人が推せない長さ）
  //   ・持ち主(owner_id)は空のまま。お客さんが自分で事務所に登録した時に埋まる。
  //     ★運転手はQRで有効化するだけなので、持ち主が空でもメーターは今日から使える。★
  function newToken() {
    const b = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(b);
    let s = '';
    for (let i = 0; i < b.length; i++) s += ('0' + b[i].toString(16)).slice(-2);
    return s;
  }

  $('newAdd').onclick = function () {
    const name = String($('newName').value || '').trim();
    const contact = String($('newContact').value || '').trim();
    const seat = Math.max(1, parseInt($('newSeat').value, 10) || 1);
    if (!name) {
      $('newMsg').textContent = '会社名を入れてください';
      return;
    }
    // ★打ち間違いをその場で止める★（空は許す＝あとで入れられる）
    if (contact && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(contact)) {
      $('newMsg').textContent = 'メールアドレスを確かめてください';
      return;
    }
    $('newMsg').textContent = '';
    $('newAdd').disabled = true;
    const token = newToken();
    sb.from('dk_companies')
      .insert({
        name: name,
        url_token: token,
        status: 'on',
        seat_limit: seat,
        contact: contact,
      })
      .select('company_id,url_token')
      .then(function (res) {
        $('newAdd').disabled = false;
        if (res.error || !res.data || !res.data.length) {
          $('newMsg').textContent = '登録できませんでした';
          return;
        }
        const url = (cfg.APP_BASE || location.origin) + '/?c=' + res.data[0].url_token;
        $('newUrl').textContent = url;
        $('newDone').classList.remove('hide');
        $('newName').value = '';
        $('newContact').value = '';
        toast('✅ ' + name + ' を登録しました');
        loadList();
      });
  };

  $('newCopy').onclick = function () {
    const txt = $('newUrl').textContent || '';
    if (!txt) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(
        function () {
          toast('コピーしました');
        },
        function () {
          toast('長押しでコピーしてください');
        }
      );
    } else {
      toast('長押しでコピーしてください');
    }
  };

  // ── 使う / 止める ──
  //   ★押した瞬間に画面を変え、失敗したら戻す★（待たせない）
  function setStatus(id, next) {
    const r = rows.filter(function (x) {
      return x.id === id;
    })[0];
    if (!r || r.status === next) return;
    const before = r.status;
    r.status = next;
    render();
    sb.from('dk_companies')
      .update({ status: next })
      .eq('company_id', id)
      .then(function (res) {
        if (res.error) {
          r.status = before;
          render();
          toast('変えられませんでした');
          return;
        }
        toast(
          next === 'off'
            ? '⛔ ' + r.name + ' を止めました'
            : '✅ ' + r.name + ' を使えるようにしました'
        );
      });
  }

  // ── 席数 ──
  function setSeat(id, n, el) {
    const r = rows.filter(function (x) {
      return x.id === id;
    })[0];
    if (!r || r.seat === n) return;
    const before = r.seat;
    r.seat = n;
    sb.from('dk_companies')
      .update({ seat_limit: n })
      .eq('company_id', id)
      .then(function (res) {
        if (res.error) {
          r.seat = before;
          if (el) el.value = before;
          toast('変えられませんでした');
          return;
        }
        toast(r.name + ' の席数を ' + n + ' 台にしました');
      });
  }

  boot();
})();
