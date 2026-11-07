  // ★紙1枚を組む★（板 1123×794px・戻り値は 画面外に置いた要素）
  // ★★手当・控除の 内わけ（紙の 見出しの 下 1行）★★ 2026-10-06（司さん「ア」）
  //   無い 人は 何も 出さない＝今までの 紙と 1文字も 変わらない
  // migiOk＝手当・控除を 合計の 右の 空きに 出した（見出しの 下には「うち 日給…」だけ）
  function adjGyou(e, migiOk) {
    // ★ほかの 払い方の 内わけ★ 2026-10-06（日給・1回/1km・指定日）＝使った 人だけ 1行
    var hoka = [];
    if (e && e.nikkyuHi) hoka.push('日給 ' + e.nikkyuHi + '日');
    if (e && e.kasan) hoka.push('1回・1km の 分 ¥' + yen(e.kasan));
    if (e && e.wariHi) hoka.push('指定日の 割増 ' + e.wariHi + '日');
    if (e && e.yakanHi) hoka.push('夜の 割増 ' + e.yakanHi + '日');
    var hokaGyou = hoka.length
      ? '<div style="font-size:15px;color:#14243d;margin:-4px 0 6px;">うち ' +
        hoka.join('・') +
        '</div>'
      : '';
    if (!e || !(e.teate || e.koujo) || migiOk) return hokaGyou;
    var uchi = function (kind) {
      return (e.adj || [])
        .filter(function (a) {
          return a.kind === kind;
        })
        .map(function (a) {
          return esc(a.label || (kind === 'koujo' ? '控除' : '手当')) + ' ' + yen(a.yen);
        })
        .join('・');
    };
    return (
      '<div style="font-size:15px;color:#14243d;margin:-4px 0 10px;">' +
      '働いた 分 ¥' +
      yen(e.kasegi) +
      (e.teate ? '　＋ 手当 ¥' + yen(e.teate) + '（' + uchi('teate') + '）' : '') +
      (e.koujo ? '　− 控除 ¥' + yen(e.koujo) + '（' + uchi('koujo') + '）' : '') +
      '　＝ <b>差引 支給 ¥' +
      yen(e.totalPay) +
      '</b></div>' +
      hokaGyou
    );
  }

