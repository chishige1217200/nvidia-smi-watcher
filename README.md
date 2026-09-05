# nvidia-smi watcher

`nvidia-smi` の GPU 状況を Web ブラウザでリアルタイムに確認できるダッシュボードです。
外部依存ライブラリなし（Node.js >= 18）で動作します。

## 起動方法

```bash
node server.js
# または
npm start
```

起動後、ブラウザで <http://localhost:8787> を開いてください。

### オプション（環境変数）

| 変数 | デフォルト | 説明 |
| --- | --- | --- |
| `PORT` | `8787` | リスニングポート |
| `HOST` | `0.0.0.0` | バインドアドレス（ローカルのみなら `127.0.0.1`） |

## 機能

- GPU ごとにカード表示: 使用率 / メモリ使用率 / 温度 / 消費電力 / ファン回転数 / クロック
- VRAM 使用量・総容量の表示
- GPU プロセス一覧（PID、GPU 番号、プロセス名、VRAM 使用量）
- 2 秒間隔で自動更新（`nvidia-smi` は 2 秒キャッシュ）
- `nvidia-smi` の取得失敗時はエラーバナーを表示し、直前のデータを保持

## API

- `GET /api/status` — GPU・プロセス情報の JSON

```json
{
  "timestamp": "2026-09-05T12:02:33.028Z",
  "gpus": [
    {
      "index": 0,
      "name": "NVIDIA TITAN RTX",
      "memTotalMiB": 24576,
      "memUsedMiB": 6,
      "utilGpuPct": 0,
      "tempC": 36,
      "powerW": 19.22,
      "fanPct": 41
    }
  ],
  "processes": []
}
```

## ファイル構成

```
server.js          HTTP サーバー（nvidia-smi を実行して JSON を公開）
public/index.html  ダッシュボードページ（2 秒間隔でポーリング）
package.json       npm start スクリプト定義
```
