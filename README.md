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
- 毎日 `News watch` ワークフローがニュースの RSS を巡回し、未収録の情報漏洩ニュースの候補を Issue にまとめます（調査ソースと手順は [RESEARCH.md](RESEARCH.md)）。LLM の API キーを設定すると、候補の記事から AI が事案データの下書きを作って PR にします（下記「AI による下書き」）
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

## AI による下書き（任意）

`News watch` ワークフローは、LLM の API キーが設定されていれば、ニュース候補の記事から事案データの下書きを作り、1件ずつ PR（ラベル `ai-draft`）にします。
OpenAI 互換の API（[OpenRouter](https://openrouter.ai/)・[Groq](https://groq.com/) など）に対応しています。

```
watch   … RSS から候補を集める（scripts/news-watch.mjs）
draft   … 記事本文を取得し、ライター役の LLM が下書き、編集者役の LLM が記事と照合して校正（scripts/ai-draft.mjs）
           ※ API キーを持つのはこのジョブだけ。リポジトリへの書き込み権限は持たない
publish … 下書きをプログラムで再検証し、PR を作成（scripts/ai-publish.mjs）。LLM は使わない
```

LLM の出力はそのまま信用せず、プログラムで次の検査をします。

- 件数・日付・原因・攻撃手法などは、根拠として引用させた文が記事本文に実在しなければ削除する
- 業種・攻撃手法・漏洩した情報の種類などは一覧にある値だけを残す。`status`・`issue`・出典 URL は AI に書かせない（出典は取得した記事の URL をプログラムが設定）
- 概要文に改行・URL・HTML が含まれていたら不採用にする
- 記事本文に AI への指示らしき文があれば PR に警告を出し、自動マージの対象外にする

### 設定方法

**Settings → Secrets and variables → Actions** で次を登録します。

| 種類 | 名前 | 内容 |
|---|---|---|
| Secret | `LLM_API_KEY` | LLM サービスの API キー |
| Variable | `LLM_MODEL` | ライター役のモデル名 |
| Variable | `LLM_BASE_URL` | API のベース URL（省略時は OpenRouter の `https://openrouter.ai/api/v1`。Groq は `https://api.groq.com/openai/v1`） |
| Variable | `LLM_EDITOR_MODEL` | 編集者役のモデル名（省略時は `LLM_MODEL` と同じ） |
| Variable | `AI_MAX_ITEMS` | 1日に処理する候補の数（省略時は 5） |
| Variable | `AI_AUTO_MERGE` | `true` にすると、条件を満たす PR を検証の成功後に自動でマージする（省略時は無効） |

あわせて **Settings → Actions → General → Workflow permissions** の「Allow GitHub Actions to create and approve pull requests」を有効にしてください。
モデル名や無料枠の条件は各サービスでよく変わるため、各サービスの最新の一覧を確認して設定してください。

自動マージの対象は、編集者の指摘・修正がなく、プログラムの検査で削除した項目もなく、出典が公的機関（`.go.jp`・`.lg.jp`）や主要な報道機関・セキュリティ専門メディアのもの（`scripts/ai/guard.mjs` の一覧）だけです。

## ライセンス

- プログラム（`scripts/`・`public/` の HTML・CSS・JavaScript など）: [MIT License](LICENSE)
- 事案データ（`data/` と、そこから生成される `public/breaches.json`）: [CC BY 4.0](data/LICENSE)
  - 出典として「Have I Been Morasareta 日本版」を表示すれば、商用・非商用を問わず再利用・改変できます
  - 各事案の出典リンク先の記事・公式発表の著作権は、それぞれの著作権者に帰属します
- PR で追加・修正されたデータやコードも、上記のライセンスで提供されるものとします

## 免責

掲載内容は各社の公式発表および報道に基づきますが、正確性を保証するものではありません。
最新・正確な情報は各出典をご確認ください。
