/**
 * ブロックス(作例ゲーム)— 対局記録の保存・読み込み用 Google Apps Script
 *
 * 【先生向け: 設定手順】(アプリ一覧用とは別のスプレッドシートで行います)
 *  1. Google スプレッドシートを新しく作る(名前は自由。例: 「ブロックス対局記録」)
 *  2. メニューの「拡張機能」→「Apps Script」を開く
 *  3. 最初からある コード.gs の中身を全部消して、このファイルの中身を貼り付けて保存
 *  4. 右上の「デプロイ」→「新しいデプロイ」→ 種類の選択(歯車)で「ウェブアプリ」を選ぶ
 *       - 次のユーザーとして実行: 自分
 *       - アクセスできるユーザー: 全員
 *     →「デプロイ」。初回はアクセスの承認を求められるので、自分のアカウントで許可する
 *  5. 表示された「ウェブアプリの URL」(…/exec で終わる)をコピーし、game/config.js の RECORDS_API_URL に書く
 *
 * 対局記録はスプレッドシートの「game_records」シートに1局1行で保存されます(最初の保存時に自動で作られます)。
 * 記録を消したいときは、その行を削除します。
 * 一覧は最大30秒キャッシュします。シートを手で直した内容は、最大30秒後に反映されます。
 * このスクリプトを書き換えたときは「デプロイ」→「デプロイを管理」→ 編集(鉛筆)→ バージョン「新バージョン」で更新します。
 *
 * API(game/index.html から呼び出す):
 *   GET  ?action=records          対局記録の概要の一覧(新しい順)
 *   GET  ?action=record&id=…      対局記録1件
 *   POST {action:'saveRecord', record:{…}}   対局記録を保存し {ok, id} を返す
 */

const RECORD_SHEET_NAME = 'game_records';
const RECORD_HEADERS = ['ID', '保存日時', 'あなたの色', '手数', '結果', '記録'];
const MAX_RECORD_CHARS = 48000; // 1局分の記録(JSON)の最大文字数(スプレッドシートの1セルは最大 50,000 文字)
const MAX_RECORDS_LISTED = 200; // 一覧に返す対局記録の最大数(新しい順)
const RECORDS_CACHE_KEY = 'records-list-v1';

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(RECORD_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(RECORD_SHEET_NAME);
    sheet.appendRow(RECORD_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

const isInt_ = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'records') return json_({ ok: true, records: listRecords_() });
  if (p.action === 'record') return getRecord_(String(p.id || ''));
  return json_({ ok: false, error: 'unknown action' });
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: '送信内容を読み取れませんでした' });
  }
  if (data.action === 'saveRecord') return saveRecord_(data.record);
  return json_({ ok: false, error: 'unknown action' });
}

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
  lock.waitLock(10000); // 同時に保存されても行が壊れないようにする
  try {
    getSheet_().appendRow([id, now, clean.human, clean.moves.length, clean.result ? JSON.stringify(clean.result) : '', text]);
    CacheService.getScriptCache().remove(RECORDS_CACHE_KEY);
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true, id });
}

// 一覧用の概要(記録の中身は含めない)を新しい順に返す
function listRecords_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(RECORDS_CACHE_KEY);
  if (cached !== null) return JSON.parse(cached);
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  const n = Math.min(lastRow - 1, MAX_RECORDS_LISTED);
  if (n < 1) return [];
  const records = sheet.getRange(lastRow - n + 1, 1, n, 5).getValues()
    .filter(r => r[0])
    .reverse()
    .map(r => {
      let result = null;
      try { result = r[4] ? JSON.parse(r[4]) : null; } catch (err) { result = null; }
      return {
        id: String(r[0]),
        // Apps Script では instanceof Date が効かないことがあるので、getTime の有無で日付か判定する
        date: r[1] && typeof r[1].getTime === 'function' ? r[1].toISOString() : String(r[1]),
        human: Number(r[2]),
        moves: Number(r[3]),
        result,
      };
    });
  const text = JSON.stringify(records);
  // キャッシュは1件100KBまで。大きい場合は次回もシートから読む
  if (Utilities.newBlob(text).getBytes().length < 100000) cache.put(RECORDS_CACHE_KEY, text, 30);
  return records;
}

function getRecord_(id) {
  const sheet = getSheet_();
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
