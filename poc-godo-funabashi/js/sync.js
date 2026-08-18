/**
 * 送信の仕組み（指示書 §3 の核心部分）
 *
 * 実装するトリガはこの4つだけ:
 *   1. アプリ起動時
 *   2. オンライン復帰時 (online イベント)
 *   3. アプリに戻ってきた時 (visibilitychange → visible)
 *   4. 手動（画面Cの「いま送る」ボタン）
 *
 * Background Sync (registration.sync) はあえて実装しない。
 * → iPad(Safari)では動作せず、「閉じていても送れる」という誤解を生むため。
 */

var syncInProgress = false;

function syncQueue(triggerName) {
  if (syncInProgress) {
    debugLog('sync: 既に実行中のためスキップ (trigger=' + triggerName + ')');
    return Promise.resolve();
  }
  syncInProgress = true;
  debugLog('sync: 開始 (trigger=' + triggerName + ')');

  return Db.getPendingEvents()
    .then(function (pending) {
      if (pending.length === 0) {
        debugLog('sync: 未送信データなし');
        return null;
      }
      // 1リクエストで配列にまとめて送る（1件ずつ送らない）
      var payload = pending.map(function (ev) {
        return {
          client_uuid: ev.client_uuid,
          bucket_no: ev.bucket_no,
          material: ev.material || '',
          weight: ev.weight,
          occurred_at: ev.occurred_at,
          operator: ev.operator || '',
          source: ev.source || 'input'
        };
      });

      return apiPostEvents(payload).then(function (results) {
        // accepted / skipped どちらもサーバには届いている＝キューから消してよい
        var confirmedUuids = results
          .filter(function (r) { return r.status === 'accepted' || r.status === 'skipped'; })
          .map(function (r) { return r.client_uuid; });

        var sentAt = new Date().toISOString();
        return Db.markEventsSent(confirmedUuids, sentAt).then(function () {
          debugLog('sync: ' + confirmedUuids.length + '/' + pending.length + ' 件送信成功');
          return Db.setMeta('lastSyncAt', sentAt);
        });
      });
    })
    .catch(function (err) {
      // 失敗したら何もしない＝ローカルのキューはそのまま残る（消さない）
      debugLog('sync: 失敗（オフライン中の可能性）: ' + err);
    })
    .then(function () {
      syncInProgress = false;
      window.dispatchEvent(new CustomEvent('poc:sync-complete'));
    });
}

function initSyncTriggers() {
  // トリガ2: オンライン復帰
  window.addEventListener('online', function () {
    debugLog('イベント検知: online');
    syncQueue('online-event');
  });

  // トリガ3: アプリに戻ってきた（前面に来た）
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      debugLog('イベント検知: visibilitychange(visible)');
      syncQueue('visibilitychange');
    }
  });
}
