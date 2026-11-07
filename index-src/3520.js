      function addExtra(i) {
        const items = JSON.parse(localStorage.getItem('daikou_extras') || '[]');
        // ★マイナスの 追加料金は 足さずに 知らせる★（黙って 0 に しない＝お金は 止めて 警告・10-11）
        if (!items[i]) return;
        const v = Number(items[i].amount) || 0;
        if (v < 0) {
          showToast('マイナスの 追加料金は 使えません（値引きで 登録してください）');
          return;
        }
        extras.push({ name: items[i].name, amount: v });
        closeExtraModal();
      }

      function addCustomExtra() {
        const v = parseInt(document.getElementById('customAmount').value);
        if (!v || v <= 0) return;
        extras.push({ name: '任意追加', amount: v });
        closeExtraModal();
      }

      // ─── 値引き (追加料金と同型・合計から減算・2026-07-25 司さん要望) ───
      function _discountTotal() {
        // ★値引きは 必ず 下げる★（-500 と 打っても 500円 下げる・10-11 司さん「値引きで なんで 上がるんど」）
        return Array.isArray(discounts)
          ? discounts.reduce((a, b) => a + Math.abs(Number(b.amount) || 0), 0)
          : 0;
      }
      function openDiscountModal() {
        if (blockIfSensorNotGranted()) return;
        const items = JSON.parse(localStorage.getItem('daikou_discounts') || '[]');
        const el = document.getElementById('discountModalItems');
        el.innerHTML = items
          .map(
            (item, i) =>
              `<div class="modal-item" onclick="addDiscount(${i})">
      <span class="modal-item-name">${item.name}</span>
      <span class="modal-item-price">-¥${Math.abs(Number(item.amount) || 0).toLocaleString()}</span>
    </div>`
          )
          .join('');
        document.getElementById('customDiscountAmount').value = '';
        document.getElementById('discountModalOverlay').classList.add('show');
      }
      function closeDiscountModal() {
        document.getElementById('discountModalOverlay').classList.remove('show');
      }
      function addDiscount(i) {
        const items = JSON.parse(localStorage.getItem('daikou_discounts') || '[]');
        if (items[i])
          discounts.push({ name: items[i].name, amount: Math.abs(Number(items[i].amount) || 0) });
        closeDiscountModal();
      }
      function addCustomDiscount() {
        const v = parseInt(document.getElementById('customDiscountAmount').value);
        if (!v || v <= 0) return;
        discounts.push({ name: '任意値引き', amount: v });
        closeDiscountModal();
      }

      // ─── 請求書 (2026-07-31・司さん要件) ───────────────────
      //   実車中に「請求書」ボタン→会社を選ぶ→その代行が請求書払いとして残る。
      //   ★オフラインで動く★(会社一覧は端末に持っている) ・料金/距離には一切触らない。
      //   ★何があっても業務を止めない★(一覧が空でも、失敗しても、代行はそのまま続く)。
      function _invoiceCustomers() {
        try {
          const raw = localStorage.getItem('dk_customers_cache');
          const list = raw ? JSON.parse(raw) : [];
          return Array.isArray(list) ? list.filter((c) => c && c.name && c.active !== false) : [];
        } catch (_) {
          return [];
        }
      }
      function openInvoiceModal() {
        if (blockIfSensorNotGranted()) return;
        const list = _invoiceCustomers();
        const cur =
          (window.Business && Business.getTripCustomer && Business.getTripCustomer()) || null;
        const el = document.getElementById('invoiceModalItems');
        let html = '';
        if (!list.length) {
          html =
            '<div class="modal-item" style="justify-content:center;color:#8e8e93">' +
            '請求書の会社が登録されていません<br>（会社の管理画面から登録してください）' +
            '</div>';
        } else {
          html = list
            .map(
              (c, i) =>
                `<div class="modal-item" onclick="pickInvoiceCustomer(${i})">
      <span class="modal-item-name">${c.name}</span>
      <span class="modal-item-price">${cur && cur.customer_id === c.customer_id ? '選択中' : ''}</span>
    </div>`
            )
            .join('');
        }
        // 現金に戻す(選び間違えたとき)
        if (cur) {
          html +=
            '<div class="modal-item" onclick="clearInvoiceCustomer()">' +
            '<span class="modal-item-name">現金にもどす</span>' +
            '<span class="modal-item-price"></span></div>';
        }
        el.innerHTML = html;
        document.getElementById('invoiceModalOverlay').classList.add('show');
      }
      function closeInvoiceModal() {
        document.getElementById('invoiceModalOverlay').classList.remove('show');
      }
      function pickInvoiceCustomer(i) {
        let picked = null;
        try {
          const c = _invoiceCustomers()[i];
          if (c && window.Business && Business.setTripCustomer) {
            Business.setTripCustomer(c.customer_id, c.name);
            if (typeof showToast === 'function') showToast('請求書: ' + c.name);
            picked = c;
          }
        } catch (_) {
          /* 業務は止めない */
        }
        _updateInvoiceBtn();
        closeInvoiceModal();
        // ★誰が乗ったかを聞く会社なら、続けて名前を選ばせる (2026-08-05・司さん指摘)★
        //   標様建設は請求書を「会長／社長／専務」で分けて小計を出す。
        //   ここで聞かないと★その会社の行だけ備考が空で上がり、仕分けから外れる★。
        try {
          if (picked && Array.isArray(picked.note_groups) && picked.note_groups.length) {
            _openNoteGroupModal(picked.note_groups);
          }
        } catch (_) {
          /* 聞けなくても代行は続く */
        }
      }

      // ─── 誰が乗ったか (会長/社長/専務 …) ───────────────────
      //   出す中身は事務所の会社設定から来る＝会社が増えても分け方が変わってもここは直さない。
      //   ★選ばなくても代行は続く★(あとから履歴で直せる)。
      let _noteGroups = [];
      function _openNoteGroupModal(groups) {
        _noteGroups = Array.isArray(groups) ? groups : [];
        const el = document.getElementById('noteGroupModalItems');
        if (!el) return;
        const cur =
          (window.Business && Business.getTripCustomer && Business.getTripCustomer()) || null;
        const now = cur ? cur.customer_note : null;
        el.innerHTML = _noteGroups
          .map(
            (g, i) =>
              '<div class="modal-item" onclick="pickNoteGroup(' +
              i +
              ')"><span class="modal-item-name">' +
              String(g).replace(/[<>&]/g, '') +
              '</span><span class="modal-item-price">' +
              (now === g ? '選択中' : '') +
              '</span></div>'
          )
          .join('');
        document.getElementById('noteGroupModalOverlay').classList.add('show');
      }
      function closeNoteGroupModal() {
        document.getElementById('noteGroupModalOverlay').classList.remove('show');
      }
      function pickNoteGroup(i) {
        try {
          const g = _noteGroups[i];
          if (g && window.Business && Business.setTripCustomerNote) {
            Business.setTripCustomerNote(g);
            if (typeof showToast === 'function') showToast('請求書: ' + g);
          }
        } catch (_) {
          /* 業務は止めない */
        }
        _updateInvoiceBtn();
        closeNoteGroupModal();
      }
      // 会社を選んだあとに「誰が乗ったか」を選び直す（一覧の行から呼ぶ）
      function reopenNoteGroup() {
        try {
          const cur =
            (window.Business && Business.getTripCustomer && Business.getTripCustomer()) || null;
          if (!cur) return;
          const c = _invoiceCustomers().filter(function (x) {
            return x.customer_id === cur.customer_id;
          })[0];
          if (c && Array.isArray(c.note_groups) && c.note_groups.length)
            _openNoteGroupModal(c.note_groups);
        } catch (_) {
          /* ignore */
        }
      }
      function clearInvoiceCustomer() {
        try {
          if (window.Business && Business.setTripCustomer) Business.setTripCustomer(null);
          if (typeof showToast === 'function') showToast('現金にもどしました');
        } catch (_) {
          /* 業務は止めない */
        }
        _updateInvoiceBtn();
        closeInvoiceModal();
      }
      // 選ばれている会社を画面に出す。
      //   ★ボタンの文字は「請求書」固定★(会社名を入れるとボタンからはみ出して読めない)。
      //   会社名は 追加料金/値引き と同じ一覧セクションに出す = 見せ方を全部そろえる。
      function _updateInvoiceBtn() {
        try {
          const cur =
            (window.Business && Business.getTripCustomer && Business.getTripCustomer()) || null;
          const btn = document.getElementById('btnInvoice');
          if (btn) btn.classList.toggle('is-selected', !!cur);

          const el = document.getElementById('invoiceList');
          const lbl = document.getElementById('invoiceSectionLabel');
          if (!el) return;
          if (!cur) {
            el.innerHTML = '';
            if (lbl) lbl.style.display = 'none';
            return;
          }
          if (lbl) lbl.style.display = 'block';
          const name = String(cur.customer_name || '').replace(/[<>&]/g, '');
          // ★誰が乗ったかも一緒に出す (2026-08-05)★
          //   出ていないと、選び忘れたことに気づけない（＝請求書で仕分けから外れる）。
          //   聞く会社なのに未選択なら「誰？」と赤く出して、押せば選び直せる。
          let noteHtml = '';
          try {
            const c = _invoiceCustomers().filter(function (x) {
              return x.customer_id === cur.customer_id;
            })[0];
            if (c && Array.isArray(c.note_groups) && c.note_groups.length) {
              const n = String(cur.customer_note || '').replace(/[<>&]/g, '');
              noteHtml = n
                ? '<span onclick="reopenNoteGroup()" style="margin-left:8px;color:#007aff;font-weight:700;">' +
                  n +
                  '</span>'
                : '<span onclick="reopenNoteGroup()" style="margin-left:8px;color:#ff3b30;font-weight:700;">誰？</span>';
            }
          } catch (_) {
            /* ignore */
          }
          el.innerHTML = `<div class="extra-item" style="display:flex;justify-content:space-between;align-items:center;">
      <span>${name}${noteHtml}</span>
      <div style="display:flex;align-items:center;gap:6px;">
        <button class="extra-del-btn" onclick="clearInvoiceCustomer()">✕</button>
      </div>
    </div>`;
        } catch (_) {
          /* ignore */
        }
      }
      window._updateInvoiceBtn = _updateInvoiceBtn;

