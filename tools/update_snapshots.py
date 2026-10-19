"""公開 API の一覧を GitHub Pages 用の小さな控えとして保存する。"""

import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
SOURCES = (
    ("apps", "API_URL", "apps", "snapshot.json"),
    ("game", "RECORDS_API_URL", "records", "records-snapshot.json"),
)


def config_url(folder, key):
    config = (ROOT / folder / "config.js").read_text(encoding="utf-8")
    match = re.search(rf"^\s*{key}:\s*'([^']+)'", config, re.MULTILINE)
    if not match or not match.group(1).startswith("https://script.google.com/"):
        raise ValueError(f"{folder}/config.js の {key} が見つかりません")
    return match.group(1)


def fetch_json(url):
    for attempt in range(3):
        try:
            request = Request(url, headers={"User-Agent": "ndzemi-app-snapshot/1.0"})
            with urlopen(request, timeout=30) as response:
                body = response.read(5_000_001)
            if len(body) > 5_000_000:
                raise ValueError("一覧のデータが大きすぎます")
            return json.loads(body)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2)


def main():
    updates = []
    for folder, key, field, filename in SOURCES:
        api_url = config_url(folder, key)
        endpoint = api_url if folder == "apps" else api_url + "?action=records"
        payload = fetch_json(endpoint)
        if not isinstance(payload, dict) or payload.get("ok") is not True or not isinstance(payload.get(field), list):
            raise ValueError(f"{folder} の API が正しい一覧を返しませんでした")
        path = ROOT / folder / filename
        old = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        if old.get("apiUrl") == api_url and old.get(field) == payload[field]:
            print(f"{path.relative_to(ROOT)}: 変更なし")
            continue
        snapshot = {
            "ok": True,
            "apiUrl": api_url,
            "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            field: payload[field],
        }
        updates.append((path, snapshot))

    # 片方の取得が失敗した場合は、どちらの控えも書き換えない
    for path, snapshot in updates:
        path.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        print(f"{path.relative_to(ROOT)}: 更新")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"一覧の更新に失敗しました: {error}", file=sys.stderr)
        sys.exit(1)
