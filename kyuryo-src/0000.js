(function () {
  'use strict';

  // ★管理画面の中に入っている時は、上のリンク列を出さない（1つのアプリに見せる）★
  //   単体URLで開いた時は今まで通り出る。
  try {
    if (window.self !== window.top) document.body.classList.add('embedded');
  } catch (_) {
    document.body.classList.add('embedded'); // 読めない = 中に入っている
  }

