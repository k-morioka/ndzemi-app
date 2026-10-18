/**
 * みんなのWebアプリ一覧 — 登録受付用 Google Apps Script
 *
 * 【先生向け: 設定手順】
 *  1. Google スプレッドシートを新しく作る(名前は自由。例: 「Webアプリ一覧」)
 *  2. メニューの「拡張機能」→「Apps Script」を開く
 *  3. 最初からある コード.gs の中身を全部消して、このファイルの中身を貼り付けて保存
 *  4. 右上の「デプロイ」→「新しいデプロイ」→ 種類の選択(歯車)で「ウェブアプリ」を選ぶ
 *       - 次のユーザーとして実行: 自分
 *       - アクセスできるユーザー: 全員
 *     →「デプロイ」。初回はアクセスの承認を求められるので、自分のアカウントで許可する
 *     (「このアプリは Google で確認されていません」と出たら「詳細」→「(安全ではないページ)に移動」)
 *  5. 表示された「ウェブアプリの URL」(…/exec で終わる)をコピーし、apps/config.js の API_URL に書く
 *
 * 登録データはスプレッドシートの「apps」シートに1行ずつ保存されます。
 * 不適切な登録は、その行を削除すれば一覧から消えます。
 * このスクリプトを書き換えたときは「デプロイ」→「デプロイを管理」→ 編集(鉛筆)→ バージョン「新バージョン」で更新します。
 */

const SHEET_NAME = 'apps';
const HEADERS = ['登録日時', '作成者', 'アプリ名', 'URL', '画像'];
const MAX_TEXT = 60;           // 作成者・アプリ名の最大文字数
const MAX_IMAGE_CHARS = 48000; // スプレッドシートの1セルは最大 50,000 文字

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// 先頭が = + - @ の文字列は数式として解釈されないよう ' を付ける
function plain_(s) {
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// 一覧の取得(GET)
function doGet() {
  const values = getSheet_().getDataRange().getValues().slice(1);
  const tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  const apps = values
    .filter(r => r[3])
    .map(r => ({
      // Apps Script では instanceof Date が効かないことがあるので、getTime の有無で日付か判定する
      time: r[0] && typeof r[0].getTime === 'function' ? Utilities.formatDate(r[0], tz, 'yyyy/MM/dd HH:mm') : String(r[0]),
      author: String(r[1]),
      name: String(r[2]),
      url: String(r[3]),
      image: String(r[4] || ''),
    }));
  return json_({ ok: true, apps });
}

// 登録(POST)。同じ URL がすでにあれば、その行を新しい内容で置き換える
function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: '送信内容を読み取れませんでした' });
  }

  const author = String(data.author || '').trim().slice(0, MAX_TEXT);
  const name = String(data.name || '').trim().slice(0, MAX_TEXT);
  const url = String(data.url || '').trim();
  const image = String(data.image || '');

  if (!author || !name) return json_({ ok: false, error: '作成者とアプリ名を入力してください' });
  if (!/^https?:\/\/[^\s]+$/.test(url) || url.length > 500) return json_({ ok: false, error: 'URL が正しくありません' });
  if (image && (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > MAX_IMAGE_CHARS)) {
    return json_({ ok: false, error: '画像が大きすぎるか、形式が正しくありません' });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000); // 同時に登録されても行が壊れないようにする
  try {
    const sheet = getSheet_();
    const row = [new Date(), plain_(author), plain_(name), url, image];
    const urls = sheet.getRange(1, 4, sheet.getLastRow(), 1).getValues().map(r => String(r[0]));
    const found = urls.indexOf(url);
    if (found > 0) {
      sheet.deleteRow(found + 1);  // 古い登録を消して、新しい登録として末尾に追加する
    }
    sheet.appendRow(row);
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true });
}
