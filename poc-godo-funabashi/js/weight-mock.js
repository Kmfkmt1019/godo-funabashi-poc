/**
 * バケット重量モック（指示書 §2「バケット重量モック」対応・任意機能）
 *
 * 実測パターン 34,900 → 36,900 → 38,500 → 40,100 (kg) を再現し、
 * 各段差(delta)を投入イベントとして共通の送信キュー(events ストア)に積む。
 * 送信の仕組み（4トリガ）は画面A/B/Cと完全に共通（sync.js を共用）。
 */

var WEIGHT_SEQUENCE = [34900, 36900, 38500, 40100]; // kg
var STEP_INTERVAL_MS = 3000; // 段差の間隔（デモ用に3秒）
var selectedMockBucket = '2';

function mockLog(msg) {
  var el = document.getElementById('mockLog');
  var line = '[' + new Date().toLocaleTimeString('ja-JP') + '] ' + msg;
  el.textContent = line + '\n' + el.textContent;
}

function showToast(msg) {
  var el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(function () { el.classList.remove('show'); }, 2000);
}

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

function makeClientUuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0;
    var v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function renderMockPendingCount() {
  Db.getPendingEvents().then(function (pending) {
    var el = document.getElementById('mockPendingCount');
    el.textContent = '未送信 ' + pending.length + ' 件（全体・画面Bと共有）';
    el.className = 'pending-count' + (pending.length === 0 ? ' zero' : '');
  });
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

var mockRunning = false;

function runWeightMockSequence() {
  if (mockRunning) {
    mockLog('既に実行中です');
    return;
  }
  mockRunning = true;
  mockLog('シミュレーション開始 バケット' + selectedMockBucket);

  var chain = Promise.resolve();
  var prev = WEIGHT_SEQUENCE[0];
  mockLog('初期値: ' + prev.toLocaleString() + 'kg（基準値・イベントは発生しない）');

  WEIGHT_SEQUENCE.slice(1).forEach(function (current, i) {
    chain = chain.then(function () { return sleep(STEP_INTERVAL_MS); }).then(function () {
      var delta = current - prev;
      var ev = {
        client_uuid: makeClientUuid(),
        bucket_no: selectedMockBucket,
        material: '', // 重量モックには品種情報はない
        weight: delta,
        occurred_at: new Date().toISOString(),
        operator: '重量計(モック)',
        source: 'weight_mock',
        status: 'pending',
        created_at: new Date().toISOString()
      };
      prev = current;
      return Db.addEvent(ev).then(function () {
        mockLog('計測: ' + current.toLocaleString() + 'kg (前回比 +' + delta.toLocaleString() + 'kg) → キューに追加');
        renderMockPendingCount();
        // オンラインならすぐ送信を試みる（オフラインならキューに残る＝設計通り）
        return syncQueue('weight-mock-step');
      });
    });
  });

  chain.then(function () {
    mockLog('シミュレーション完了。通信が復帰次第、まとめてダミーサーバへ送信されます。');
    mockRunning = false;
    renderMockPendingCount();
  });
}

document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('#mockBucketButtons button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('#mockBucketButtons button').forEach(function (b) { b.classList.remove('selected'); });
      btn.classList.add('selected');
      selectedMockBucket = btn.dataset.bucket;
    });
  });

  document.getElementById('startMockBtn').addEventListener('click', runWeightMockSequence);

  document.getElementById('resetMockBtn').addEventListener('click', function () {
    document.getElementById('mockLog').textContent = '';
    mockLog('ログをリセットしました（キュー自体は消えません。画面Cで確認・送信してください）');
  });

  updateBanner();
  window.addEventListener('online', updateBanner);
  window.addEventListener('offline', updateBanner);
  initSyncTriggers();
  renderMockPendingCount();

  window.addEventListener('poc:sync-complete', function () {
    renderMockPendingCount();
    updateBanner();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(function () {});
  }

  syncQueue('app-launch');
});
