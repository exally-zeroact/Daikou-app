  // ★★従業員／退職者★★ 2026-10-16（司さん）＝退職は active=false ＋ 辞めた日（retired_on）
  var EMP_MIRU = 'ima';
  function empKiriWoMidashiE() {
    // 会社設定から 来た 時は 見出しの 横（赤丸）に 切り替えを 置き、見出しの 字は 消す（ボタンが 同じ 字）
    var k = document.getElementById('empKiri');
    var bar = document.getElementById('modoruSet');
    var mi = document.getElementById('modoruMidashi');
    if (k && bar && k.parentNode !== bar) bar.appendChild(k);
    if (mi) mi.textContent = '';
  }
  (function empKiriWoTsunagu() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-kiri]'), function (b) {
      b.onclick = function () {
        EMP_MIRU = b.getAttribute('data-kiri');
        Array.prototype.forEach.call(document.querySelectorAll('[data-kiri]'), function (x) {
          x.className = 'kiri' + (x === b ? ' on' : '');
        });
        renderEmp();
      };
    });
  })();
  function kyouJst() {
    return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }
