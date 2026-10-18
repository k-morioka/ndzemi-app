// ブロックスの設定
//
// RECORDS_API_URL: 対局記録を保存する Google Apps Script の URL(…/exec で終わる)。
//   apps/apps-script.gs をデプロイした URL と同じものを使います(アプリ一覧と共用)。
//   空('')にすると、server.py(python server.py で起動)の /api/records に保存します。
window.GAME_CONFIG = {
  RECORDS_API_URL: 'https://script.google.com/macros/s/AKfycbw1r6tvo3rWV6GDmZEmdOb1qWbdTqoYUDOxjHFoRoOaTVD4MNPg0slUYWxKievD0i7C/exec',
};
