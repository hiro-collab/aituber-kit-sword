# AITuberKit セキュリティ運用メモ

AITuberKit のローカル API は loopback 利用を前提に扱います。LAN やインターネットへ公開する場合は、認証、認可、CSRF 対策、レート制限、監査ログを別途用意してください。

## ローカル API

- 既定では `127.0.0.1` / `localhost` からの要求だけを許可します。
- リモート端末から使う必要がある場合のみ、リスクを理解したうえで `ALLOW_REMOTE_LOCAL_APIS=true` を設定します。
- `ALLOW_REMOTE_LOCAL_APIS=true` の場合、remote request には `LOCAL_API_REMOTE_TOKEN` または `AITUBER_LOCAL_API_TOKEN` と一致する `Authorization: Bearer ...` または `X-API-Token` が必要です。
- loopback request にも token を必須化したい場合は `LOCAL_API_REQUIRE_TOKEN=true` を設定します。
- 信頼できるリバースプロキシ配下でのみ `LOCAL_API_TRUST_PROXY_HEADERS=true` を使います。
- ブラウザからの要求では Origin も検証します。

## 外部メッセージ

- `/api/messages` は Client ID で発話指示を受けます。Client ID は必要なツールにだけ共有してください。
- 外部 POST からの `systemPrompt` は既定で無視します。
- 大量メッセージ、過大な本文、未対応の画像 data URI は拒否します。

## Dify

- Dify URL は `DIFY_API_URL` または `DIFY_URL` でサーバー側に固定する運用を推奨します。
- リクエスト本文の `url` を使う場合は、許可リストに明示した URL だけを許可します。
- HTTP URL は loopback ホストだけ許可します。外部 Dify には HTTPS を使ってください。

## API Keys

- サーバー専用の秘密鍵は `NEXT_PUBLIC_` 付きの環境変数に置かないでください。
- ログ、スクリーンショット、AI への質問文に API key を貼らないでください。
