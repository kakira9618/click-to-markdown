# Click to Markdown

ページの本文を抽出して Markdown ライクなテキストに変換し、クリップボードへコピーする Chrome 拡張です。`<img>` タグは Markdown 記法に変換せず、HTML のまま残します。

## 特徴

- ツールバーアイコンをクリックするだけで、現在のタブの本文をコピー
- 本文抽出は [Mozilla Readability](https://github.com/mozilla/readability) を使用し、失敗時は `<article>` / `<main>` / `[role="main"]` などにフォールバック
- 見出し (`#`, `##`)、段落、リスト、テーブル、`pre` コードブロック、`blockquote`、リンク、インラインコードに対応
- 画像は `<img src="..." alt="..." title="...">` のまま保持
- コピー結果の先頭にタイトルと URL を付与

  ```
  ----
  <title>
  <url>

  <本文>
  ```

- 結果はツールバーバッジで通知（`OK` / `ERR` / `NO`）

## インストール

1. このリポジトリをクローン or ダウンロード
2. Chrome で `chrome://extensions` を開く
3. 右上の「デベロッパーモード」を ON
4. 「パッケージ化されていない拡張機能を読み込む」から本ディレクトリを選択

## 使い方

1. コピーしたいページを開く
2. ツールバーの拡張アイコンをクリック
3. バッジに `OK` が出ればクリップボードにコピー完了

`chrome://` などの内部ページでは動作せず、バッジに `NO` が表示されます。

## ファイル構成

- `manifest.json` — 拡張のマニフェスト (Manifest V3)
- `sw.js` — service worker。クリック時に本文抽出・変換・コピーを実行
- `readability.js` — Mozilla Readability（同梱）

## 権限

- `activeTab` — クリックしたタブの情報にアクセス
- `scripting` — 対象タブにスクリプトを注入

## ライセンス

LICENSE を参照してください。
