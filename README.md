# Have I Been Morasareta 日本版

日本国内で情報漏洩を公表した企業・サービスを一覧化するサイトです。
データは GitHub のプルリクエストで誰でも追加・修正できます。

🔗 https://morasaretter.suke.dev/

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
public/ranking/       … 企業・業界・原因・委託先別のランキングと、お漏らししなかったランキング（/ranking/）
```

- **PR 時**: `Validate` ワークフローがデータを検証し、問題があれば CI が失敗します
- **main へのマージ時**: `Deploy to GitHub Pages` ワークフローが `public/breaches.json` を生成し、`public/` を GitHub Pages に公開します
- `public/breaches.json` はリポジトリにも含まれ、main へのマージ時に自動で再生成・コミットされます。
  サイト上の https://n0bisuke.github.io/haveibeenmorasareta/breaches.json から API 的に再利用できます
- `News watch` ワークフローが 8〜22時（日本時間）に2時間ごとにニュースの RSS を巡回し、未収録の情報漏洩ニュースの候補を Issue にまとめます（調査ソースと手順は [RESEARCH.md](RESEARCH.md)）。Secrets に `JINA_API_KEY` を登録すると、[Jina](https://jina.ai/reader) の検索で公式発表などの Web ページと X（旧Twitter）の話題の投稿も探します（X の投稿は出典にできないため Issue の別欄に載せるだけ）。本文を直接取得できないページも Jina Reader で読みます。LLM の API キーを設定すると、候補の記事から AI が事案データの下書きを作って PR にします（下記「AI による下書き」）
- デプロイ時に `scripts/pages.mjs` が事案ごとの個別ページ（`/breach/<事案ID>/`）と `sitemap.xml` を生成します（公開物にだけ含め、コミットはしません）。一覧のカードをクリックすると個別ページに移動します
- デプロイ時に `scripts/og-images.mjs` が事案ごとのシェア用画像（OGP、1200×630）を生成します。企業側が調査中の事案は速報風、漏洩した情報の重要度が「危険」「高」はダーク（8ビット風）、それ以外はライトのデザインです
- デプロイ時に `scripts/stamp.mjs` が JS・CSS・JSON の参照に `?v=コミットSHA` を付け、更新直後に古いファイルがキャッシュから読まれないようにします（公開物のみ）
- デプロイ時に `scripts/contributors.mjs` が、各事案ファイルを追加した PR の作成者を GitHub API で調べて `public/contributors.json` を生成します（公開物にだけ含め、コミットはしません）。一覧のカード右下にその人のアイコンが表示されます

## 追加・修正したい場合

[CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。PR が難しい場合は Issue からの情報提供も歓迎です。
Claude Code・Codex などの AI エージェントで調査して PR を作る場合は、[AGENTS.md](AGENTS.md) に手順をまとめています（エージェントは自動で読み込みます）。

## 開発

```sh
npm ci
npm run dev
```

## 初回セットアップ（リポジトリ管理者向け）

1. リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にする
2. **Settings → Branches** で `main` にブランチ保護ルールを追加し、`Validate` を必須チェックにすると、検証を通らない PR はマージできなくなります

## アクセスレポート（任意）

`GA report` ワークフローが毎朝、Google アナリティクス（GA4）の前日のアクセス（訪問者数・PV・よく見られたページ・流入元）を集計し、
月ごとの Issue（ラベル `GAレポート`）にコメントで追記します。リポジトリが公開のため、レポートの数字は誰でも閲覧できます。

1. Google Cloud でプロジェクトを作り、**Google Analytics Data API** を有効にする
2. サービスアカウントを作成し、鍵（JSON）をダウンロードする
3. GA の **管理 → プロパティのアクセス管理** で、サービスアカウントのメールアドレスを「閲覧者」として追加する
4. GitHub の **Settings → Secrets and variables → Actions** で次を登録する

| 種類 | 名前 | 内容 |
|---|---|---|
| Secret | `GA_CREDENTIALS` | 手順 2 の JSON ファイルの中身をそのまま |
| Variable（Secret でも可） | `GA_PROPERTY_ID` | GA4 のプロパティ ID（**管理 → プロパティの詳細** にある数字。測定 ID の `G-` で始まるものとは別） |

### 機能追加の提案（AI）

`Feature ideas` ワークフローが4日ごとに、直近28日間のアクセス傾向（GA）・既存の「機能追加」Issue・この README の「仕組み」を LLM に渡し、
根拠となる数字付きの機能追加の提案3つを Issue（ラベル `機能追加`・`AI提案`）にします。GA の設定に加えて、下の「AI による下書き」と同じ LLM の設定（`GROQ_API_KEY`、または `LLM_API_KEY`・`LLM_MODEL`）が必要です。

## Issue のラベル

| ラベル | 内容 |
|---|---|
| `情報提供` | 利用者からのお漏らし情報（新しい事案・掲載内容の誤り・続報） |
| `企業側が調査中` | 企業が件数・漏えいの有無などを調査中と公表している事案の続報募集 |
| `一次情報募集` | 信頼度「低」（公式発表や信頼できる報道を確認できていない）事案の情報募集 |
| `ニュース候補` | 【自動】毎朝のニュース巡回で見つかった未収録の候補 |
| `ai-draft` | 【自動】AI が作った事案データの下書き PR |
| `GAレポート` | 【自動】Google アナリティクスの毎日のアクセスレポート |
| `機能追加` / `不具合` | サイトの機能追加の要望・不具合 |
| `AI提案` | 【自動】AI が GA のアクセス傾向から作った機能追加の提案（`機能追加` と併用） |

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
| Secret | `GROQ_API_KEY` | Groq の API キー。これだけ登録すれば、ベース URL とモデル（`openai/gpt-oss-120b`）は Groq 用の既定値を使う |
| Secret | `LLM_API_KEY` | ほかの LLM サービス（OpenRouter など）を使う場合の API キー（`GROQ_API_KEY` より優先） |
| Variable | `LLM_MODEL` | ライター役のモデル名（`LLM_API_KEY` を使う場合は必須） |
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
