---
title: "PostgreSQL の COPY FROM PROGRAM による RCE とその条件"
categories: [security]
tags: ["tag"]
date: 2026-10-31 22:30:05 +0900
toc: true
---

# PostgreSQL の COPY FROM PROGRAM による RCE とその条件

PostgreSQL には、テーブルとファイルの間でデータをやり取りする `COPY` コマンドがあります。
このうち `PROGRAM` 句を使うと、指定した **OS コマンドをサーバープロセスの権限で実行** できます。
これは **正規の機能** ですが、条件次第では任意コード実行 (RCE) に直結します。本記事ではその仕組みと、成立に必要なロール/権限を整理します。

> 本記事は自身が管理する環境、または許可された検証環境での理解・防御を目的とした内容です。
{: .prompt-warning }

## COPY FROM PROGRAM とは

`COPY` は本来、テーブルとファイル間のインポート/エクスポートを行うコマンドです。

```sql
-- ファイルからテーブルへ
COPY mytable FROM '/path/to/data.csv' WITH (FORMAT csv);
-- テーブルからファイルへ
COPY mytable TO '/path/to/out.csv' WITH (FORMAT csv);
```

`FROM`/`TO` の対象をファイルパスではなく `PROGRAM` にすると、PostgreSQL はシェル経由でコマンドを起動し、
その標準出力 (FROM) または標準入力 (TO) をテーブルとやり取りします。

```sql
COPY mytable FROM PROGRAM 'ls -la /';
```

公式ドキュメントにも「`PROGRAM` で指定したコマンドは **サーバーを実行している OS ユーザーの権限で実行される**」と明記されています。
つまり Linux 上の典型的な構成なら `postgres` ユーザーとしてコマンドが走ります。

https://www.postgresql.org/docs/current/sql-copy.html

## 実際に RCE を行う

出力列を受けるための一時テーブルを用意し、そこへコマンドの出力を流し込むのが定番の形です。

```sql
CREATE TEMP TABLE ref(line text);
COPY ref FROM PROGRAM 'bash -c "id; uname -a"';
SELECT * FROM ref;
```

`ref` には `id` や `uname -a` の出力が 1 行ずつ格納されます。
`bash -c "..."` の中身を差し替えれば、リバースシェルの取得やファイル書き込みなど任意のコマンドが実行できてしまいます。

出力を回収する必要すらなく、副作用だけを狙う（ファイル作成・外部通信など）ことも可能です。

## 成立に必要なロール/権限

ここが本記事の主題です。`COPY ... PROGRAM` は誰でも使えるわけではありません。
実行者は、次のいずれかを満たす必要があります。

### 1. スーパーユーザー (`rolsuper`)

スーパーユーザーは無条件で `COPY ... PROGRAM` を実行できます。
アプリケーションの接続ユーザーがスーパーユーザーのまま運用されていると、SQL インジェクション等でこの経路に到達した時点で RCE が成立します。

```sql
SELECT rolname, rolsuper FROM pg_roles WHERE rolname = current_user;
```

### 2. `pg_execute_server_program` ロール

PostgreSQL 11 以降では、スーパーユーザーでなくても `pg_execute_server_program`
という定義済みロールを付与されていれば `PROGRAM` 句を使えます。

```sql
GRANT pg_execute_server_program TO app_user;
```

同様に、サーバー上のファイルを直接読み書きする
`pg_read_server_files` / `pg_write_server_files` もファイル経由の攻撃に悪用され得るロールです。
これらは「サーバー OS に手が届く」強い権限であることを意識しておく必要があります。

自分が属しているロールは次で確認できます。

```sql
SELECT r.rolname
FROM pg_auth_members m
JOIN pg_roles r ON r.oid = m.roleid
WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user);
```

### どちらでもない場合

上記のいずれも持たない一般ユーザーが `COPY ... PROGRAM` を実行すると、次のように拒否されます。

```
ERROR:  permission denied to COPY to or from an external program
HINT:  Anyone can COPY to stdout or from stdin. psql's \copy command also works for anyone.
```

ヒントにある通り、`COPY ... TO STDOUT` / `FROM STDIN`（クライアント側とのやり取り）は
権限なしでも使えますが、こちらは OS コマンド実行とは無関係です。混同しないように注意してください。

## なぜ危険になりやすいか

- **接続ユーザーの過剰権限**: アプリ用ユーザーがスーパーユーザー、あるいは不要に `pg_execute_server_program` を持っている構成は珍しくありません。
- **SQL インジェクションとの合わせ技**: 文字列連結でクエリを組み立てている箇所があれば、`; COPY ...` を差し込める可能性があります。
- **権限昇格の足がかり**: `postgres` ユーザーとしてコマンドが動くため、DB サーバー OS 上での横展開の起点になります。

## 防御

- 接続ユーザーをスーパーユーザーにしない。アプリは最小権限のロールで接続する。
- `pg_execute_server_program` / `pg_read_server_files` / `pg_write_server_files` を安易に付与しない。付与済みなら棚卸しする。
- プレースホルダ（プリペアドステートメント）を徹底し、SQL インジェクションを塞ぐ。
- 付与状況は定期的に確認する。

```sql
-- PROGRAM 句を使えるロールの洗い出し
SELECT r.rolname
FROM pg_auth_members m
JOIN pg_roles r ON r.oid = m.member
JOIN pg_roles g ON g.oid = m.roleid
WHERE g.rolname = 'pg_execute_server_program';

-- スーパーユーザー一覧
SELECT rolname FROM pg_roles WHERE rolsuper;
```

- 監査ログ（`pgaudit` など）で `COPY` 実行を記録し、`PROGRAM` を伴う実行を検知対象にする。
