# 情報の追加・修正方法

データは `data/breaches/` 以下に **1インシデント = 1 YAML ファイル** で管理しています。
ファイルが分かれているので、複数の PR が同時に来てもコンフリクトしにくい構成です。

## 追加の手順

1. このリポジトリを Fork する（GitHub の Web 画面上だけでも完結します）
2. [`data/_template.yml`](data/_template.yml) をコピーして `data/breaches/YYYY-MM-slug.yml` を作成
   - `YYYY-MM` は **公表日（`date_announced`）の年月**
   - `slug` は半角英小文字・数字・ハイフン（例: `2025-01-example-corp.yml`）
3. 内容を記入して PR を作成
4. CI（`Validate`）が自動で形式をチェックします。エラーがあれば PR 上に表示されます

## フィールド

| フィールド | 必須 | 説明 |
| --- | --- | --- |
| `organization` | ✔ | 企業・団体の正式名称 |
| `group` | | 企業グループ名。子会社などをランキングでまとめて集計したいときに指定 |
| `services` | | 影響を受けたサービス・サイト名のリスト |
| `industry` | | 業種。[`data/industries.yml`](data/industries.yml) にある名前のみ使用可 |
| `country` | | 国コード（`JP` など） |
| `date_occurred` | | 発生日 `YYYY-MM-DD` |
| `date_announced` | ✔ | 最初の公表日 `YYYY-MM-DD` |
| `affected_count` | | 漏洩（の可能性がある）件数。不明なら `null` |
| `count_note` | | 件数の補足（推計値・最大値など） |
| `cause` | ✔ | 原因（下表から1つ） |
| `vuln_target` | | `cause: vulnerability` のとき、脆弱性を悪用された箇所。[`data/vuln-targets.yml`](data/vuln-targets.yml) の ID（`ec_payment` / `web_app` / `mail_system` / `remote_access` / `business_tool`） |
| `root_cause` | | 原因の詳細。悪用された脆弱性や侵入経路など、公表されている範囲で簡潔に（80文字以内） |
| `vendor` | | 委託先経由の事案のみ。`name`（委託先の正式名称）と `group`（委託先の企業グループ名、任意）。例: 日立ソリューションズと日立ソリューションズ・クリエイトはどちらも `group: 日立グループ` にすると、ランキングでまとめて集計されます |
| `data_types` | | 漏洩した情報の種類。[`data/data-types.yml`](data/data-types.yml) に登録された名前のみ使用可 |
| `summary` | ✔ | 概要（10〜600文字） |
| `sources` | ✔ | 出典（`title` と `url`）。1件以上 |

### `cause` の値

| 値 | 意味 |
| --- | --- |
| `ransomware` | ランサムウェア |
| `unauthorized_access` | 不正アクセス |
| `vulnerability` | 脆弱性の悪用 |
| `misconfiguration` | 設定ミス（公開設定・権限など） |
| `phishing` | フィッシング |
| `malware` | マルウェア感染 |
| `third_party` | 委託先・関連会社経由 |
| `insider` | 内部不正 |
| `human_error` | 誤送信・人的ミス |
| `lost_device` | 紛失・盗難 |
| `unknown` | 不明 |
| `other` | その他 |

### `data_types` と重要度

漏洩した情報の種類は [`data/data-types.yml`](data/data-types.yml) で4段階の重要度に分類しています。
サイトではこの重要度でタグを色分けし、事案ごとに最も高いレベルの色をカードに付けます。

| レベル | 色 | 例 |
| --- | --- | --- |
| 危険 | 赤 | パスポート番号、運転免許情報、本人確認書類画像、マイナンバー、クレジットカード番号、口座番号 |
| 高 | オレンジ | 生年月日、住所、健康・医療情報、保存データ、購入履歴 |
| 中 | 黄 | 氏名、電話番号、メールアドレス、性別 |
| 低 | グレー | 会員ID、アカウント名、画像メタデータ |

対応表にない名前を使うと CI がエラーになります。表記を既存の名前に合わせるか、
新しい種類なら `data/data-types.yml` の適切なレベルに追加してください。

## 掲載ルール

- 掲載対象は**日本国内の企業・団体、または日本の利用者に影響がある事案**です
- **公表された事実のみ**を記載してください。噂・推測・未確認情報は掲載しません
- 出典には可能な限り**当事者の公式発表**を含めてください（なければ信頼できる報道機関の記事）
- 流出データそのものや、その入手先へのリンクは**絶対に掲載しない**でください
- 続報で件数などが更新された場合は、既存ファイルを修正して出典を追記してください
- 掲載内容に誤りがある場合は Issue または PR でご連絡ください

## ローカルでの確認

```sh
npm ci
npm run validate   # データの検証のみ
npm run dev        # ビルドしてローカルサーバーで表示
```
