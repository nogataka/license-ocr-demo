# 運転免許証リーダー

![スクリーンショット](resource/screenshot.png)

ブラウザ完結型の日本の運転免許証 OCR アプリケーションです。画像をサーバーに送信せず、すべての処理をクライアントサイドで実行します。

**[デモページ](https://nogataka.github.io/license-ocr-demo/)**

## 特徴

- **完全クライアントサイド処理** — 画像データは外部サーバーに一切送信されません
- **高精度な日本語認識** — 国立国会図書館（NDL）が学習した DEIM + PARSeq モデルを使用
- **透視変換補正** — 4点ホモグラフィーで免許証の傾きや歪みを自動補正
- **テンプレートゾーン抽出** — 免許証の標準レイアウトに基づき、氏名・住所・番号等を構造化データとして抽出
- **IndexedDB キャッシュ** — モデル（約77MB）は初回ダウンロード後にブラウザにキャッシュされ、2回目以降は即座に利用可能

## 抽出フィールド

| フィールド | 説明 |
|---|---|
| 氏名 | 氏名 |
| 生年月日 | 和暦・西暦に対応 |
| 住所 | 住所 |
| 免許証番号 | 12桁の免許証番号 |
| 有効期限 | 有効期限の日付 |
| 交付日 | 免許証の交付日 |
| 免許の条件等 | 眼鏡等の条件 |

## 使い方

### 1. 画像の読み込み

免許証の画像をドラッグ＆ドロップするか、クリックしてファイルを選択します。

### 2. 透視変換補正

画像を読み込むと編集モードに入ります。4つのハンドルを免許証の四隅に合わせ、「読み取り開始」ボタンを押してください。

### 3. 結果の確認

読み取り完了後、右エリアに検出結果（バウンディングボックス付き画像）と抽出されたフィールドがカード形式で表示されます。

## 技術スタック

| カテゴリ | 技術 |
|---|---|
| フレームワーク | [Astro](https://astro.build/) (Static) |
| 言語 | TypeScript |
| 推論ランタイム | [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (WebAssembly) |
| 検出モデル | DEIM (Document Element Inspection Model) — NDL 学習済み |
| 認識モデル | PARSeq (Permuted Autoregressive Sequence) — NDL 学習済み |
| キャッシュ | IndexedDB ([idb-keyval](https://github.com/jakearchibald/idb-keyval)) |

## OCR パイプライン

```
画像入力
  ↓
透視変換補正 (4点ホモグラフィー)
  ↓
DEIM 検出 (文書レイアウト解析)
  ↓
レイアウト解析 (検出結果→要素ツリー構築)
  ↓
読み順決定 (XY-Cut アルゴリズム)
  ↓
PARSeq 認識 (行画像→テキスト)
  ↓
テンプレートゾーン分類 (座標ベースでフィールド割当)
  ↓
構造化データ出力
```

### 検出モデル (DEIM)

- **入力**: `[1, 3, 800, 800]` (ImageNet 正規化)
- **出力**: バウンディングボックス + クラスラベル (17クラス: LINE, BODY, CAPTION 等)
- **閾値**: 信頼度 0.25 / スコア 0.2
- **ファイル**: `public/models/deim-s-1024x1024.onnx` (38MB)

### 認識モデル (PARSeq)

- **入力**: `[1, 3, 16, 768]` (BGR, [-1, 1] 正規化)
- **デコード**: 自己回帰、ストップトークン (index 0) で終了
- **文字セット**: NDL 7,141 文字 (日本語・漢字・記号)
- **ファイル**: `public/models/parseq_rec.onnx` (39MB)

### テンプレートゾーン

免許証の標準レイアウト（国家公安委員会規則準拠）に基づく正規化座標 (0-1) のゾーン定義で、OCR 結果の各テキストボックスを中心座標によりフィールドに分類します。

## プロジェクト構成

```
src/
├── pages/
│   └── index.astro          # メインページ (HTML + CSS)
├── app.ts                    # UIロジック・イベント処理
├── settings/
│   ├── presets.ts            # モデルURL・入力サイズ定義
│   ├── vocab.ts              # 7,141文字の文字セット
│   └── categories.ts         # 17クラス定義
├── inference/
│   ├── detector.ts           # DEIM 検出エンジン
│   ├── recognizer.ts         # PARSeq 認識エンジン
│   ├── image-ops.ts          # 画像デコード・リサイズ・切り出し
│   ├── tensor-ops.ts         # テンソル変換・正規化
│   └── homography.ts         # 透視変換 (ホモグラフィー)
├── layout/
│   ├── detection-builder.ts  # 検出結果→要素ツリー変換
│   ├── zone-defs.ts          # 免許証テンプレートゾーン定義
│   └── field-extractor.ts    # ゾーンベースのフィールド抽出
├── sequencer/
│   ├── evaluate.ts           # 読み順評価
│   ├── bisect.ts             # XY-Cut アルゴリズム
│   ├── arrange.ts            # 要素並び替え
│   ├── smooth.ts             # 読み順平滑化
│   └── inline-note.ts        # 割注処理
├── cache/
│   └── model-store.ts        # IndexedDB モデルキャッシュ
└── pipeline/
    └── ocr.worker.ts         # Web Worker (OCR パイプライン実行)

public/models/
├── deim-s-1024x1024.onnx     # DEIM 検出モデル (38MB)
└── parseq_rec.onnx           # PARSeq 認識モデル (39MB)
```

## セットアップ

```bash
npm install
npm run dev      # 開発サーバー起動 (http://localhost:7575)
npm run build    # 本番ビルド
npm run preview  # ビルド結果プレビュー
```

### 必要な HTTP ヘッダー

ONNX Runtime Web が `SharedArrayBuffer` を使用するため、以下の HTTP ヘッダーが必要です。開発サーバーでは `astro.config.mjs` で自動設定されます。本番環境では Web サーバー側で設定してください。

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## ライセンス

### 学習済みモデル

DEIM・PARSeq の学習済みモデルは国立国会図書館（NDL）が公開しており、**CC BY 4.0** ライセンスの下で利用しています。

> Copyright (c) National Diet Library, Japan
> Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

- ソース: [ndl-lab/ndlocr-lite](https://github.com/ndl-lab/ndlocr-lite)

### モデルアーキテクチャ

| アーキテクチャ | ソース | ライセンス |
|---|---|---|
| DEIM | [Intellindust-AI-Lab/DEIM](https://github.com/Intellindust-AI-Lab/DEIM) | Apache License 2.0 |
| PARSeq | [baudm/parseq](https://github.com/baudm/parseq) | Apache License 2.0 |

### ランタイム・ライブラリ

| ライブラリ | ライセンス |
|---|---|
| ONNX Runtime Web | MIT (Microsoft Corporation) |
| Astro | MIT |
| idb-keyval | MIT |
