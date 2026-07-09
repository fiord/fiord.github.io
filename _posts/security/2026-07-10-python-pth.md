---
title: "Python による .pth ファイルの悪用"
categories: [security]
tags: ["tag"]
date: 2026-07-10 00:46:57 +0900
toc: true
---

# Python による .pth ファイルの悪用

## .pth ファイルとは

`import` 実行時に、対象ファイルパスを追加するためのものです。

通常、`import` 実行時には `sys.path` に格納されているパスを順番に参照し、合致する名前のモジュールがあればそれを読みます。
デフォルトで対象になるファイルパスの一覧は下記のコマンドで確認が可能です。

```bash
$ python -m site
# 下記、私の環境での実行例

sys.path = [
    '<current directory>',
    '/home/fiord/.pyenv/versions/3.12.11/lib/python312.zip',
    '/home/fiord/.pyenv/versions/3.12.11/lib/python3.12',
    '/home/fiord/.pyenv/versions/3.12.11/lib/python3.12/lib-dynload',
    '/home/fiord/.pyenv/versions/3.12.11/lib/python3.12/site-packages',
]
USER_BASE: '/home/fiord/.local' (exists)
USER_SITE: '/home/fiord/.local/lib/python3.12/site-packages' (doesn't exist)
ENABLE_USER_SITE: True
```

上記ディレクトリの中に `.pth` ファイルを配置することで、`import` 実行時に対象のパスを追加することが可能です。

## .pth ファイルの活用例

current directory も対象となるため、例えば複数プロジェクトで共通して使いたいライブラリがある際、下記の手順で容易に利用することが出来ます。

1. `<path to project_dir>/lib.pth` のように `.pth` ファイルを作成する。
```
<path to library_dir>
../packages/core などもモノレポの場合は便利そうです
```
2. `import` 実行時に上記で指定したパスが追加されます。そのため、`import <library>` のように別ディレクトリに存在するライブラリを利用することが可能です。

## .pth ファイルの悪用

`.pth` ファイルでは、`import` から始まる任意の Python コードを実行することが可能です。

```python:evil.pth
import os
os.system("rm -rf /")  # 危険な .pth ファイルの例
```

また、`sys.path.insert(0, <path>)` のように、任意のファイルパスを先頭に追加することで、モジュールの読み込み順序を変更し、`requests` などの標準モジュールに紛れ込むことが可能です。

## 検知
Elastic Security では `.pth` ファイルの作成を検知するルールが存在しています。

https://www.elastic.co/guide/en/security/8.19/prebuilt-rule-8-19-12-python-path-file-pth-creation.html
