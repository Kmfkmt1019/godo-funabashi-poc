/**
 * GAS(ダミーサーバ)とのAPI通信 + 簡易デバッグログ
 *
 * ★★★ ここを、デプロイしたGASウェブアプリのURLに書き換えてください ★★★
 * (Apps Script側の「デプロイ」→「新しいデプロイ」で表示されるURL)
 */
var GAS_URL = 'https://script.google.com/macros/s/AKfycbw2QmRvqLn1B_W4LEZqpLU5wsGE0x5HHnenHCrQP3ZmWZltGkXazz3wiLnoPunTlLOMpA/exec';

// ---- 簡易デバッグログ（画面Cの「デバッグログ」欄 + コンソール両方に出す）----
function debugLog(msg) {
  var line = '[' + new Date().toLocaleTimeString('ja-JP') + '] ' + msg;
  console.log(line);
  var el = document.getElementById('debugLog');
  if (el) {
    el.textContent = line + '\n' + el.textContent;
    // 長くなりすぎないように行数を制限
    var lines = el.textContent.split('\n');
    if (lines.length > 100) {
      el.textContent = lines.slice(0, 100).join('\n');
    }
  }
}

// ---- API呼び出し ----

function apiFetchMaster() {
  return fetch(GAS_URL + '?action=master', { method: 'GET' })
    .then(function (res) {
      if (!res.ok) throw new Error('master取得失敗: HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) { return data.items || []; });
}

// events: [{client_uuid, bucket_no, material, weight, occurred_at, operator, source}, ...]
// Content-Type を text/plain にすることで、ブラウザのCORSプリフライト(OPTIONS)を回避する。
// (GAS のウェブアプリは OPTIONS に応答しないため、これをしないとPOSTが失敗する)
function apiPostEvents(events) {
  return fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ events: events })
  })
    .then(function (res) {
      if (!res.ok) throw new Error('送信失敗: HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) { return data.results || []; });
}
