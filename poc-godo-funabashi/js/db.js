/**
 * IndexedDB ラッパー（指示書 §3「ストレージ」対応）
 * ライブラリを使わず素のIndexedDB APIだけで実装（依存ゼロ・ビルド不要にするため）。
 *
 * ストア構成:
 *  - master: 配合予定のキャッシュ（キー: lot_id）
 *  - events: 投入イベント / 重量モックイベントの送信キュー兼履歴（キー: client_uuid）
 *  - meta:   最終取得時刻などの雑多な設定値（キー: key）
 */

var DB_NAME = 'godo-poc-db';
var DB_VERSION = 1;

function openDb() {
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function (e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains('master')) {
        db.createObjectStore('master', { keyPath: 'lot_id' });
      }
      if (!db.objectStoreNames.contains('events')) {
        db.createObjectStore('events', { keyPath: 'client_uuid' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = function (e) { resolve(e.target.result); };
    req.onerror = function (e) { reject(e.target.error); };
  });
}

function withStore(storeName, mode, callback) {
  return openDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(storeName, mode);
      var store = tx.objectStore(storeName);
      var result = callback(store);
      tx.oncomplete = function () { resolve(result); };
      tx.onerror = function (e) { reject(e.target.error); };
    });
  });
}

function idbRequestToPromise(request) {
  return new Promise(function (resolve, reject) {
    request.onsuccess = function (e) { resolve(e.target.result); };
    request.onerror = function (e) { reject(e.target.error); };
  });
}

var Db = {
  // ---- master ----
  saveMasterItems: function (items) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('master', 'readwrite');
        var store = tx.objectStore('master');
        store.clear();
        items.forEach(function (item) { store.put(item); });
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function (e) { reject(e.target.error); };
      });
    });
  },
  getMasterItems: function () {
    return withStore('master', 'readonly', function (store) {
      return idbRequestToPromise(store.getAll());
    }).then(function (p) { return p; });
  },

  // ---- meta ----
  setMeta: function (key, value) {
    return withStore('meta', 'readwrite', function (store) {
      store.put({ key: key, value: value });
    });
  },
  getMeta: function (key) {
    return withStore('meta', 'readonly', function (store) {
      return idbRequestToPromise(store.get(key));
    }).then(function (row) { return row ? row.value : null; });
  },

  // ---- events (送信キュー兼履歴) ----
  addEvent: function (ev) {
    return withStore('events', 'readwrite', function (store) {
      store.put(ev);
    });
  },
  getAllEvents: function () {
    return withStore('events', 'readonly', function (store) {
      return idbRequestToPromise(store.getAll());
    }).then(function (p) { return p; });
  },
  getPendingEvents: function () {
    return Db.getAllEvents().then(function (all) {
      return all.filter(function (e) { return e.status === 'pending'; });
    });
  },
  markEventsSent: function (uuids, sentAt) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('events', 'readwrite');
        var store = tx.objectStore('events');
        uuids.forEach(function (uuid) {
          var getReq = store.get(uuid);
          getReq.onsuccess = function (e) {
            var row = e.target.result;
            if (row) {
              row.status = 'sent';
              row.sent_at = sentAt;
              store.put(row);
            }
          };
        });
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function (e) { reject(e.target.error); };
      });
    });
  }
};
