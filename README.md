# MINNA.exe Sites

ChatGPT Sites版の3分間参加型デモです。観客は公開URLから参加し、ホストはChatGPTサインイン後に進行します。

## Routes

| Route | Purpose |
|---|---|
| `/join` | 観客の参加、2問回答、3秒長押し |
| `/host` | QR表示、集合人格、Next / Fire / Reset |
| `/api/session` | D1-backed shared session API |

## Commands

```bash
npm run dev
npm run lint
npm run build
npm test
```

`MINNA.exe`の状態はSitesのD1へ保存します。観客画面は公開、ホスト操作APIはローカル開発時を除いてChatGPTサインインとSites runtimeの`HOST_EMAIL`一致が必須です。`HOST_EMAIL`はサイト所有者のメールアドレスに設定します。
