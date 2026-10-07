# Have I Been Morasareta 日本版

日本国内で情報漏洩を公表した企業・サービスを一覧化するサイトです。
データは GitHub のプルリクエストで誰でも追加・修正できます。

🔗 https://n0bisuke.github.io/haveibeenmorasareta/

## 仕組み

```
data/breaches/*.yml   … 1インシデント = 1ファイルのデータ
schema/               … データの JSON Schema
scripts/validate.mjs  … データ検証（スキーマ・ファイル名・日付・出典の重複）
data/data-types.yml   … 漏洩した情報の種類と重要度の対応表
data/industries.yml   … 業種の一覧
data/vuln-targets.yml … 脆弱性を悪用された箇所（vuln_target）の分類
scripts/build.mjs     … データから public/breaches.json を生成（リポジトリにもコミット）
public/               … 公開ディレクトリ（依存なしの静的 HTML/CSS/JS）
public/visualization/ … グラフなどの可視化ページ（/visualization/）
public/ranking/       … 企業・業界・原因・委託先別のランキング（/ranking/）
```

- **PR 時**: `Validate` ワークフローがデータを検証し、問題があれば CI が失敗します
- **main へのマージ時**: `Deploy to GitHub Pages` ワークフローが `public/breaches.json` を生成し、`public/` を GitHub Pages に公開します
- `public/breaches.json` はリポジトリにも含まれ、main へのマージ時に自動で再生成・コミットされます。
  サイト上の https://n0bisuke.github.io/haveibeenmorasareta/breaches.json から API 的に再利用できます
- 毎日 `News watch` ワークフローがニュースの RSS を巡回し、未収録の情報漏洩ニュースの候補を Issue にまとめます（調査ソースと手順は [RESEARCH.md](RESEARCH.md)）
- デプロイ時に `scripts/stamp.mjs` が JS・CSS・JSON の参照に `?v=コミットSHA` を付け、更新直後に古いファイルがキャッシュから読まれないようにします（公開物のみ）
- デプロイ時に `scripts/contributors.mjs` が、各事案ファイルを追加した PR の作成者を GitHub API で調べて `public/contributors.json` を生成します（公開物にだけ含め、コミットはしません）。一覧のカード右下にその人のアイコンが表示されます

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

## ライセンス

- プログラム（`scripts/`・`public/` の HTML・CSS・JavaScript など）: [MIT License](LICENSE)
- 事案データ（`data/` と、そこから生成される `public/breaches.json`）: [CC BY 4.0](data/LICENSE)
  - 出典として「Have I Been Morasareta 日本版」を表示すれば、商用・非商用を問わず再利用・改変できます
  - 各事案の出典リンク先の記事・公式発表の著作権は、それぞれの著作権者に帰属します
- PR で追加・修正されたデータやコードも、上記のライセンスで提供されるものとします

## 免責

掲載内容は各社の公式発表および報道に基づきますが、正確性を保証するものではありません。
最新・正確な情報は各出典をご確認ください。
