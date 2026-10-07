# Have I Been Morasareta

情報漏洩を公表した企業・サービスを一覧化するサイトです。
データは GitHub のプルリクエストで誰でも追加・修正できます。

## 仕組み

```
data/breaches/*.yml   … 1インシデント = 1ファイルのデータ
schema/               … データの JSON Schema
scripts/validate.mjs  … データ検証（スキーマ・ファイル名・日付・出典の重複）
scripts/build.mjs     … データから public/breaches.json を生成
public/               … 公開ディレクトリ（依存なしの静的 HTML/CSS/JS）
```

- **PR 時**: `Validate` ワークフローがデータを検証し、問題があれば CI が失敗します
- **main へのマージ時**: `Deploy to GitHub Pages` ワークフローが `public/breaches.json` を生成し、`public/` を GitHub Pages に公開します
- 生成される `breaches.json` は API 的に再利用することもできます

## 追加・修正したい場合

[CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。PR が難しい場合は Issue からの情報提供も歓迎です。

## 開発

```sh
npm ci
npm run dev
```

## 初回セットアップ（リポジトリ管理者向け）

1. リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にする
2. **Settings → Branches** で `main` にブランチ保護ルールを追加し、`Validate` を必須チェックにすると、検証を通らない PR はマージできなくなります

## 免責

掲載内容は各社の公式発表および報道に基づきますが、正確性を保証するものではありません。
最新・正確な情報は各出典をご確認ください。
