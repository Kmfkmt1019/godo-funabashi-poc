/**
 * 画面A/B/C の画面制御（指示書 §2 対応）
 */

var FIXED_OPERATOR = '現場担当(PoC)';
var STALE_MINUTES = 30;

// ---- UUID生成（iPadOS Safariの新しめのバージョンならcrypto.randomUUIDが使える）----
function makeClientUuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  // フォールバック
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0;
    var v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ---- タブ切り替え ----
function initTabs() {
  var buttons = document.querySelectorAll('nav.tabs button');
  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      buttons.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
      document.getElementById(btn.dataset.screen).classList.add('active');
      if (btn.dataset.screen === 'screenB' || btn.dataset.screen === 'screenC') {
        renderQueueScreens();
      }
    });
  });
}

// ---- オンライン／オフラインバナー ----
function updateBanner() {
  var el = document.getElementById('banner');
  if (navigator.onLine) {
    el.textContent = 'オンライン';
    el.className = 'banner online';
  } else {
    el.textContent = 'オフライン';
    el.className = 'banner offline';
  }
}

// ---- トースト通知 ----
function showToast(msg) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(function () { el.classList.remove('show'); }, 2000);
}

function formatDateTime(iso) {
  if (!iso) return '-';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  var pad = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// ---- 画面A: 配合予定 ----
function renderMasterList(items) {
  var container = document.getElementById('masterList');
  if (!items || items.length === 0) {
    container.innerHTML = '<div class="card">配合予定データがまだありません（初回はオンラインで開いてください）</div>';
    return;
  }
  container.innerHTML = items.map(function (it) {
    return '<div class="card">' +
      '<div class="lot">ロット ' + it.lot_id + ' / バケット' + toCircled(it.bucket_no) + '</div>' +
      '<div class="sub">品種: ' + it.material + ' ／ 予定: ' + Number(it.planned_weight).toLocaleString() + 'kg</div>' +
      '</div>';
  }).join('');
}

function toCircled(n) {
  var map = { '1': '①', '2': '②', '3': '③' };
  return map[String(n)] || n;
}

function loadMasterScreen() {
  var isOnline = navigator.onLine;
  var fetchPromise = isOnline
    ? apiFetchMaster().then(function (items) {
        debugLog('画面A: サーバから配合予定を取得 (' + items.length + '件)');
        return Db.saveMasterItems(items).then(function () {
          return Db.setMeta('lastFetchedAt', new Date().toISOString());
        }).then(function () { return items; });
      }).catch(function (err) {
        debugLog('画面A: 取得失敗、キャッシュを使用します: ' + err);
        return null;
      })
    : Promise.resolve(null);

  fetchPromise.then(function (freshItems) {
    if (freshItems) {
      renderMasterList(freshItems);
      renderLastFetched();
      return;
    }
    // オフライン、または取得失敗 → IndexedDBのキャッシュを表示（画面を真っ白にしない）
    Db.getMasterItems().then(function (cached) {
      renderMasterList(cached);
      renderLastFetched();
    });
  });
}

function renderLastFetched() {
  Db.getMeta('lastFetchedAt').then(function (val) {
    document.getElementById('lastFetched').textContent = '最終取得: ' + formatDateTime(val);
  });
}

// ---- 画面B: 投入入力 ----
var selectedBucket = null;

function initInputScreen() {
  document.querySelectorAll('#bucketButtons button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('#bucketButtons button').forEach(function (b) { b.classList.remove('selected'); });
      btn.classList.add('selected');
      selectedBucket = btn.dataset.bucket;
    });
  });

  document.getElementById('submitBtn').addEventListener('click', function () {
    var weightVal = document.getElementById('weightInput').value;
    var material = document.getElementById('materialSelect').value;
    var msgEl = document.getElementById('submitMsg');

    if (!selectedBucket) {
      msgEl.style.color = '#a11c1c';
      msgEl.textContent = 'バケット番号を選択してください';
      return;
    }
    if (!weightVal || Number(weightVal) <= 0) {
      msgEl.style.color = '#a11c1c';
      msgEl.textContent = '重量を入力してください';
      return;
    }

    var ev = {
      client_uuid: makeClientUuid(),
      bucket_no: selectedBucket,
      material: material,
      weight: Number(weightVal),
      occurred_at: new Date().toISOString(),
      operator: FIXED_OPERATOR,
      source: 'input',
      status: 'pending',
      created_at: new Date().toISOString()
    };

    // オフラインでも必ず登録できる。エラーにしない。
    Db.addEvent(ev).then(function () {
      msgEl.style.color = '#1a6b2c';
      msgEl.textContent = '登録しました（バケット' + toCircled(selectedBucket) + ' / ' + ev.weight + 'kg）';
      showToast('登録しました');
      document.getElementById('weightInput').value = '';
      renderQueueScreens();
      // 前面にいるならそのまま送信を試みる（オンラインなら即送信される想定）
      syncQueue('after-register');
    });
  });
}

// ---- 画面C: 同期状況 + 画面Bの未送信件数 ----
function renderQueueScreens() {
  Db.getAllEvents().then(function (all) {
    var pending = all.filter(function (e) { return e.status === 'pending'; });
    var sent = all.filter(function (e) { return e.status === 'sent'; });

    // 画面B
    var countB = document.getElementById('pendingCountB');
    countB.textContent = '未送信 ' + pending.length + ' 件';
    countB.className = 'pending-count' + (pending.length === 0 ? ' zero' : '');

    // 画面C
    var countC = document.getElementById('pendingCountC');
    countC.textContent = '未送信 ' + pending.length + ' 件';
    countC.className = 'pending-count' + (pending.length === 0 ? ' zero' : '');

    var listEl = document.getElementById('pendingList');
    if (pending.length === 0) {
      listEl.innerHTML = '<div class="queue-item">なし</div>';
    } else {
      listEl.innerHTML = pending.map(function (e) {
        return '<div class="queue-item"><span>' + String(e.client_uuid).slice(-4) +
          ' / バケット' + toCircled(e.bucket_no) + ' ' + e.material + ' ' + e.weight + 'kg</span>' +
          '<span>' + formatDateTime(e.occurred_at) + '</span></div>';
      }).join('');
    }

    document.getElementById('sentCount').textContent = sent.length;

    // 30分以上滞留していたら赤字警告
    var staleEl = document.getElementById('staleWarning');
    if (pending.length > 0) {
      var oldest = pending.reduce(function (a, b) {
        return new Date(a.created_at) < new Date(b.created_at) ? a : b;
      });
      var ageMin = (Date.now() - new Date(oldest.created_at).getTime()) / 60000;
      staleEl.style.display = ageMin >= STALE_MINUTES ? 'block' : 'none';
    } else {
      staleEl.style.display = 'none';
    }
  });

  Db.getMeta('lastSyncAt').then(function (val) {
    document.getElementById('lastSynced').textContent = '最後に送信できた時刻: ' + formatDateTime(val);
  });
}

function initSyncScreen() {
  document.getElementById('syncNowBtn').addEventListener('click', function () {
    debugLog('手動: 「いま送る」ボタン押下');
    syncQueue('manual-button');
  });

  document.getElementById('csvExportBtn').addEventListener('click', function () {
    Db.getPendingEvents().then(function (pending) {
      var header = ['client_uuid', 'bucket_no', 'material', 'weight', 'occurred_at', 'operator'];
      var rows = [header.join(',')].concat(pending.map(function (e) {
        return [e.client_uuid, e.bucket_no, e.material, e.weight, e.occurred_at, e.operator].join(',');
      }));
      var csv = rows.join('\n');
      var blob = new Blob([csv], { type: 'text/csv' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'mitousin_' + Date.now() + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  });

  window.addEventListener('poc:sync-complete', function () {
    renderQueueScreens();
    updateBanner();
  });
}

// ---- 初期化 ----
document.addEventListener('DOMContentLoaded', function () {
  initTabs();
  initInputScreen();
  initSyncScreen();
  initSyncTriggers();
  updateBanner();
  renderQueueScreens();

  window.addEventListener('online', updateBanner);
  window.addEventListener('offline', updateBanner);

  // Service Worker 登録
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then(function () {
      debugLog('Service Worker 登録完了');
    }).catch(function (err) {
      debugLog('Service Worker 登録失敗: ' + err);
    });
  }

  // ストレージ永続化のリクエスト（指示書 §3）
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then(function (granted) {
      debugLog('navigator.storage.persist() => ' + granted);
    });
  } else {
    debugLog('navigator.storage.persist() はこの環境では使用できません');
  }

  loadMasterScreen();

  // トリガ1: アプリ起動時にキューをflush
  syncQueue('app-launch');
});
