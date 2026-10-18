/**
 * みんなのWebアプリ一覧 — 登録受付用 Google Apps Script
 * (作例ブロックス(game/)の対局記録の保存・読み込みも、このスクリプトで受け付けます)
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
 * ブロックスの対局記録は「game_records」シートに1局1行で保存されます(最初の保存時に自動で作られます)。
 * このスクリプトを書き換えたときは「デプロイ」→「デプロイを管理」→ 編集(鉛筆)→ バージョン「新バージョン」で更新します。
 */

const SHEET_NAME = 'apps';
const HEADERS = ['登録日時', '作成者', 'アプリ名', 'URL', '画像'];
const MAX_TEXT = 60;           // 作成者・アプリ名の最大文字数
const MAX_IMAGE_CHARS = 48000; // スプレッドシートの1セルは最大 50,000 文字

const RECORD_SHEET_NAME = 'game_records';
const RECORD_HEADERS = ['ID', '保存日時', 'あなたの色', '手数', '結果', '記録'];
const MAX_RECORD_CHARS = 48000; // 1局分の記録(JSON)の最大文字数
const MAX_RECORDS_LISTED = 200; // 一覧に返す対局記録の最大数(新しい順)

function getSheet_(name, headers) {
  name = name || SHEET_NAME;
  headers = headers || HEADERS;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

const isInt_ = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// 先頭が = + - @ の文字列は数式として解釈されないよう ' を付ける
function plain_(s) {
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// 一覧の取得(GET)。?action=records / ?action=record&id=… のときはブロックスの対局記録を返す
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'records') return json_({ ok: true, records: listRecords_() });
  if (p.action === 'record') return getRecord_(String(p.id || ''));

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
  if (data.action === 'saveRecord') return saveRecord_(data.record);

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

// ---- ブロックス(game/)の対局記録 ----

// 送られてきた記録を確かめ、必要な項目だけを取り出した新しい記録を作る(不正なら null)
function cleanRecord_(rec) {
  if (!rec || typeof rec !== 'object' || !isInt_(rec.human, 0, 3) || !Array.isArray(rec.moves) || rec.moves.length > 400) return null;
  const moves = [];
  for (const m of rec.moves) {
    if (!m || !isInt_(m.p, 0, 3)) return null;
    if (m.cells) {
      if (!isInt_(m.piece, 0, 20) || !Array.isArray(m.cells) || m.cells.length < 1 || m.cells.length > 5) return null;
      if (!m.cells.every(c => Array.isArray(c) && isInt_(c[0], 0, 19) && isInt_(c[1], 0, 19))) return null;
      moves.push({ p: m.p, piece: m.piece, cells: m.cells.map(c => [c[0], c[1]]) });
    } else if (m.resign) {
      moves.push({ p: m.p, resign: true });
    } else {
      moves.push({ p: m.p, skip: true });
    }
  }
  let result = null;
  const r = rec.result;
  if (r && Array.isArray(r.scores) && r.scores.length === 4 && r.scores.every(s => isInt_(s, -89, 20)) &&
      Array.isArray(r.winners) && r.winners.every(w => isInt_(w, 0, 3))) {
    result = { scores: r.scores, winners: r.winners };
  }
  return { version: 1, date: String(rec.date || '').slice(0, 40), human: rec.human, moves, result };
}

function saveRecord_(rec) {
  const clean = cleanRecord_(rec);
  if (!clean) return json_({ ok: false, error: '対局記録の形式が正しくありません' });
  const text = JSON.stringify(clean);
  if (text.length > MAX_RECORD_CHARS) return json_({ ok: false, error: '対局記録が大きすぎます' });

  const now = new Date();
  const tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
  const id = Utilities.formatDate(now, tz, 'yyyyMMdd-HHmmss') + '-' + Utilities.getUuid().slice(0, 6);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    getSheet_(RECORD_SHEET_NAME, RECORD_HEADERS)
      .appendRow([id, now, clean.human, clean.moves.length, clean.result ? JSON.stringify(clean.result) : '', text]);
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true, id });
}

// 一覧用の概要(記録の中身は含めない)を新しい順に返す
function listRecords_() {
  const sheet = getSheet_(RECORD_SHEET_NAME, RECORD_HEADERS);
  const n = sheet.getLastRow() - 1;
  if (n < 1) return [];
  return sheet.getRange(2, 1, n, 5).getValues()
    .filter(r => r[0])
    .reverse()
    .slice(0, MAX_RECORDS_LISTED)
    .map(r => {
      let result = null;
      try { result = r[4] ? JSON.parse(r[4]) : null; } catch (err) { result = null; }
      return {
        id: String(r[0]),
        date: r[1] && typeof r[1].getTime === 'function' ? r[1].toISOString() : String(r[1]),
        human: Number(r[2]),
        moves: Number(r[3]),
        result,
      };
    });
}

function getRecord_(id) {
  const sheet = getSheet_(RECORD_SHEET_NAME, RECORD_HEADERS);
  const n = sheet.getLastRow() - 1;
  if (!id || n < 1) return json_({ ok: false, error: 'not found' });
  const ids = sheet.getRange(2, 1, n, 1).getValues().map(r => String(r[0]));
  const i = ids.indexOf(id);
  if (i < 0) return json_({ ok: false, error: 'not found' });
  try {
    return json_({ ok: true, record: JSON.parse(sheet.getRange(i + 2, 6).getValue()) });
  } catch (err) {
    return json_({ ok: false, error: 'broken record' });
  }
}
