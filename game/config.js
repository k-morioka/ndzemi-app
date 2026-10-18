// ブロックスの設定
//
// RECORDS_API_URL: 対局記録を保存する Google Apps Script の URL(…/exec で終わる)。
//   game/records-script.gs をデプロイした URL を書きます(手順はそのファイルの先頭のコメント)。
//   空('')にすると、server.py(python server.py で起動)の /api/records に保存します。
window.GAME_CONFIG = {
  RECORDS_API_URL: 'https://script.google.com/macros/s/AKfycbwbQ1txuzJkoqg8s7RX4Jb6QjlXUUNQIXDXpwq6WeVV9mebYZ8i2HMoePJb55Yspg6Q/exec',
};
