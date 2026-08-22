# MINNA.exe Mobile

Expo Goで動作する参加者向けReact Nativeアプリです。既存のMINNA公開APIへ接続します。

## Run

```bash
npm install
npm run start:tunnel
```

ターミナルに表示されたQRをExpo Goで読み取ります。アプリ起動後、司会画面の参加URLまたは64桁の会場コードを入力します。

API URLを切り替える場合は`EXPO_PUBLIC_MINNA_API_URL`を指定します。未指定時は公開中のMINNA APIへ接続します。
