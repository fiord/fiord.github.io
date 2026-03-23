---
title: "Elastic Agent を用いた EDR 環境をローカルに作ってみた"
categories: [security]
tags: ["security", "EDR", "Elastic Agent"]
date: 2026-03-20 01:25:12 +0900
toc: true
---

# Elastic Agent を用いた EDR 環境をローカルに作ってみた

ElasticSearch と Kibana を用いて SIEM 環境を構築し、そこに Elastic Agent からのログを送信することで、EDR 環境をローカルに構築してみました。
試行錯誤しながらだったのもあり、構築手順は記憶に残っている範囲のベストエフォートのものです。

## ElasticSearch と Kibana、管理用の Fleet Server の構築
色々設定が必要なのですが、docker compose を用いて構築されるようにしています。
```yaml
services:
  setup:
    image: docker.elastic.co/elasticsearch/elasticsearch:${STACK_VERSION}
    restart: always
    volumes:
      - certs:/usr/share/elasticsearch/config/certs
    user: "0"
    command: >
      bash -c '
        if [ x${ELASTIC_PASSWORD} == x ]; then
          echo "Set the ELASTIC_PASSWORD environment variable in the .env file";
          exit 1;
        elif [ x${KIBANA_PASSWORD} == x ]; then
          echo "Set the KIBANA_PASSWORD environment variable in the .env file";
          exit 1;
        fi;
        if [ ! -f config/certs/ca.zip ]; then
          echo "Creating CA";
          bin/elasticsearch-certutil ca --silent --pem -out config/certs/ca.zip;
          unzip config/certs/ca.zip -d config/certs;
        fi;
        if [ ! -f config/certs/certs.zip ]; then
          echo "Creating certs";
          echo -ne \
          "instances:\n"\
          "  - name: es01\n"\
          "    dns:\n"\
          "      - es01\n"\
          "      - localhost\n"\
          "    ip:\n"\
          "      - 127.0.0.1\n"\
          "      - ${HOST_IP}\n"\
          "  - name: es02\n"\
          "    dns:\n"\
          "      - es02\n"\
          "      - localhost\n"\
          "    ip:\n"\
          "      - 127.0.0.1\n"\
          "      - ${HOST_IP}\n"\
          "  - name: es03\n"\
          "    dns:\n"\
          "      - es03\n"\
          "      - localhost\n"\
          "    ip:\n"\
          "      - 127.0.0.1\n"\
          "      - ${HOST_IP}\n"\
          "  - name: fleet\n"\
          "    dns:\n"\
          "      - fleet\n"\
          "      - localhost\n"\
          "    ip:\n"\
          "      - 127.0.0.1\n"\
          "      - ${HOST_IP}\n"\
          > config/certs/instances.yml;
          bin/elasticsearch-certutil cert --silent --pem -out config/certs/certs.zip --in config/certs/instances.yml --ca-cert config/certs/ca/ca.crt --ca-key config/certs/ca/ca.key;
          unzip config/certs/certs.zip -d config/certs;
        fi;
        echo "Setting file permissions"
        chown -R root:root config/certs;
        find . -type d -exec chmod 750 \{\} \;;
        find . -type f -exec chmod 640 \{\} \;;
        echo "Waiting for Elasticsearch availability";
        until curl -s --cacert config/certs/ca/ca.crt https://es01:9200 | grep -q "missing authentication credentials"; do sleep 30; done;
        echo "Setting kibana_system password";
        until curl -s -X POST --cacert config/certs/ca/ca.crt -u "elastic:${ELASTIC_PASSWORD}" -H "Content-Type: application/json" https://es01:9200/_security/user/kibana_system/_password -d "{\"password\":\"${KIBANA_PASSWORD}\"}" | grep -q "^{}"; do sleep 10; done;
        echo "All done!";
      '
    healthcheck:
      test: ["CMD-SHELL", "[ -f config/certs/es01/es01.crt ]"]
      interval: 1s
      timeout: 5s
      retries: 120

  es01:
    depends_on:
      setup:
        condition: service_healthy
    image: docker.elastic.co/elasticsearch/elasticsearch:${STACK_VERSION}
    restart: always
    volumes:
      - certs:/usr/share/elasticsearch/config/certs
      - esdata01:/usr/share/elasticsearch/data
    ports:
      - 0.0.0.0:${ES_PORT}:9200
    environment:
      - node.name=es01
      - http.host=0.0.0.0
      - transport.host=0.0.0.0
      - network.host=0.0.0.0
      - cluster.name=${CLUSTER_NAME}
      - cluster.initial_master_nodes=es01,es02,es03
      - discovery.seed_hosts=es02,es03
      - ELASTIC_PASSWORD=${ELASTIC_PASSWORD}
      - bootstrap.memory_lock=true
      - xpack.security.enabled=true
      - xpack.security.http.ssl.enabled=true
      - xpack.security.http.ssl.key=certs/es01/es01.key
      - xpack.security.http.ssl.certificate=certs/es01/es01.crt
      - xpack.security.http.ssl.certificate_authorities=certs/ca/ca.crt
      - xpack.security.transport.ssl.enabled=true
      - xpack.security.transport.ssl.key=certs/es01/es01.key
      - xpack.security.transport.ssl.certificate=certs/es01/es01.crt
      - xpack.security.transport.ssl.certificate_authorities=certs/ca/ca.crt
      - xpack.security.transport.ssl.verification_mode=certificate
      - xpack.license.self_generated.type=${LICENSE}
      - xpack.ml.use_auto_machine_memory_percent=true
    mem_limit: ${MEM_LIMIT}
    ulimits:
      memlock:
        soft: -1
        hard: -1
    healthcheck:
      test:
        [
          "CMD-SHELL",
          "curl -s --cacert config/certs/ca/ca.crt https://localhost:9200 | grep -q 'missing authentication credentials'",
        ]
      interval: 10s
      timeout: 10s
      retries: 120

  es02:
    depends_on:
      - es01
    image: docker.elastic.co/elasticsearch/elasticsearch:${STACK_VERSION}
    restart: always
    volumes:
      - certs:/usr/share/elasticsearch/config/certs
      - esdata02:/usr/share/elasticsearch/data
    environment:
      - node.name=es02
      - cluster.name=${CLUSTER_NAME}
      - cluster.initial_master_nodes=es01,es02,es03
      - discovery.seed_hosts=es01,es03
      - ELASTIC_PASSWORD=${ELASTIC_PASSWORD}
      - bootstrap.memory_lock=true
      - xpack.security.enabled=true
      - xpack.security.http.ssl.enabled=true
      - xpack.security.http.ssl.key=certs/es02/es02.key
      - xpack.security.http.ssl.certificate=certs/es02/es02.crt
      - xpack.security.http.ssl.certificate_authorities=certs/ca/ca.crt
      - xpack.security.transport.ssl.enabled=true
      - xpack.security.transport.ssl.key=certs/es02/es02.key
      - xpack.security.transport.ssl.certificate=certs/es02/es02.crt
      - xpack.security.transport.ssl.certificate_authorities=certs/ca/ca.crt
      - xpack.security.transport.ssl.verification_mode=certificate
      - xpack.license.self_generated.type=${LICENSE}
      - xpack.ml.use_auto_machine_memory_percent=true
    mem_limit: ${MEM_LIMIT}
    ulimits:
      memlock:
        soft: -1
        hard: -1
    healthcheck:
      test:
        [
          "CMD-SHELL",
          "curl -s --cacert config/certs/ca/ca.crt https://localhost:9200 | grep -q 'missing authentication credentials'",
        ]
      interval: 10s
      timeout: 10s
      retries: 120

  es03:
    depends_on:
      - es02
    image: docker.elastic.co/elasticsearch/elasticsearch:${STACK_VERSION}
    restart: always
    volumes:
      - certs:/usr/share/elasticsearch/config/certs
      - esdata03:/usr/share/elasticsearch/data
    environment:
      - node.name=es03
      - cluster.name=${CLUSTER_NAME}
      - cluster.initial_master_nodes=es01,es02,es03
      - discovery.seed_hosts=es01,es02
      - ELASTIC_PASSWORD=${ELASTIC_PASSWORD}
      - bootstrap.memory_lock=true
      - xpack.security.enabled=true
      - xpack.security.http.ssl.enabled=true
      - xpack.security.http.ssl.key=certs/es03/es03.key
      - xpack.security.http.ssl.certificate=certs/es03/es03.crt
      - xpack.security.http.ssl.certificate_authorities=certs/ca/ca.crt
      - xpack.security.transport.ssl.enabled=true
      - xpack.security.transport.ssl.key=certs/es03/es03.key
      - xpack.security.transport.ssl.certificate=certs/es03/es03.crt
      - xpack.security.transport.ssl.certificate_authorities=certs/ca/ca.crt
      - xpack.security.transport.ssl.verification_mode=certificate
      - xpack.license.self_generated.type=${LICENSE}
      - xpack.ml.use_auto_machine_memory_percent=true
    mem_limit: ${MEM_LIMIT}
    ulimits:
      memlock:
        soft: -1
        hard: -1
    healthcheck:
      test:
        [
          "CMD-SHELL",
          "curl -s --cacert config/certs/ca/ca.crt https://localhost:9200 | grep -q 'missing authentication credentials'",
        ]
      interval: 10s
      timeout: 10s
      retries: 120

  kibana:
    depends_on:
      es01:
        condition: service_healthy
      es02:
        condition: service_healthy
      es03:
        condition: service_healthy
    image: docker.elastic.co/kibana/kibana:${STACK_VERSION}
    volumes:
      - certs:/usr/share/kibana/config/certs
      - kibanadata:/usr/share/kibana/data
    ports:
      - ${KIBANA_PORT}:5601
    environment:
      - SERVERNAME=kibana
      - ELASTICSEARCH_HOSTS=https://es01:9200
      - ELASTICSEARCH_USERNAME=kibana_system
      - ELASTICSEARCH_PASSWORD=${KIBANA_PASSWORD}
      - ELASTICSEARCH_SSL_CERTIFICATEAUTHORITIES=config/certs/ca/ca.crt
      - XPACK_ENCRYPTEDSAVEDOBJECTS_ENCRYPTIONKEY=${ENCRYPTIONKEY}
      - XPACK_SECURITY_ENCRYPTIONKEY=${SECURITY_KEY}
      - XPACK_REPORTING_ENCRYPTIONKEY=${REPORTING_KEY}
      - NODE_EXTRA_CA_CERTS=/usr/share/kibana/config/certs/ca/ca.crt
    mem_limit: ${MEM_LIMIT}
    healthcheck:
      test:
        [
          "CMD-SHELL",
          'curl -s http://localhost:5601/api/status | grep -q ''"level":"available"''',
        ]
      interval: 10s
      timeout: 10s
      retries: 120

  fleet:
    depends_on:
      es01:
        condition: service_healthy
      es02:
        condition: service_healthy
      es03:
        condition: service_healthy
      kibana:
        condition: service_healthy
    image: docker.elastic.co/elastic-agent/elastic-agent:${STACK_VERSION}
    privileged: true
    volumes:
      - certs:/usr/share/elastic-agent/config/certs
      - agentstate:/usr/share/elastic-agent/state
    ports:
      - 0.0.0.0:${FLEET_PORT}:8220
    environment:
      # Fleet Server
      - FLEET_SERVER_ENABLE=1
      - FLEET_SERVER_ELASTICSEARCH_HOST=https://es01:9200
      - FLEET_SERVER_ELASTICSEARCH_CA=/usr/share/elastic-agent/config/certs/ca/ca.crt
      - FLEET_SERVER_SERVICE_TOKEN=${FLEET_SERVER_SERVICE_TOKEN}
      - FLEET_SERVER_POLICY_ID=fleet-server-policy
      - FLEET_SERVER_HOST=0.0.0.0
      - FLEET_SERVER_PORT=${FLEET_PORT}
      - FLEET_SERVER_CERT=/usr/share/elastic-agent/config/certs/fleet/fleet.crt
      - FLEET_SERVER_CERT_KEY=/usr/share/elastic-agent/config/certs/fleet/fleet.key
      # Self-enrollment (agent -> fleet-server TLS verification)
      - FLEET_URL=https://fleet:${FLEET_PORT}
      - FLEET_CA=/usr/share/elastic-agent/config/certs/ca/ca.crt
      # Kibana Fleet setup: updates fleet-server-policy ES output to https://es01:9200
      - KIBANA_FLEET_SETUP=1
      - KIBANA_FLEET_HOST=http://kibana:5601
      - KIBANA_FLEET_USERNAME=elastic
      - KIBANA_FLEET_PASSWORD=${ELASTIC_PASSWORD}

volumes:
  certs:
    driver: local
  esdata01:
    driver: local
  esdata02:
    driver: local
  esdata03:
    driver: local
  agentstate:
    driver: local
  kibanadata:
    driver: local
```

.env はこんな感じになるかと。
```
# Password for the 'elastic' user (at least 6 characters)
ELASTIC_PASSWORD=<elastic's password>

# Password for the 'kibana_system' user (at least 6 characters)
KIBANA_PASSWORD=<kibana system's password>

# Version of Elastic products
STACK_VERSION=9.3.1

# Set the cluster name
CLUSTER_NAME=docker-cluster

# Set to 'basic' or 'trial' to automatically start the 30-day trial
LICENSE=trial
#LICENSE=trial

# Port to expose Elasticsearch HTTP API to the host
ES_PORT=9200
#ES_PORT=127.0.0.1:9200

# Port to expose Kibana to the host
KIBANA_PORT=5601
#KIBANA_PORT=80

# Increase or decrease based on the available host memory (in bytes)
MEM_LIMIT=1073741824

# Project namespace (defaults to the current folder name if not set)
#COMPOSE_PROJECT_NAME=myproject

ENCRYPTIONKEY=<32 character random string>
SECURITY_KEY=<32 character random string>
REPORTING_KEY=<32 character random string>

HOST_IP=<host's IP address, need access to ES from Elastic Agents>
FLEET_PORT=8220
# 起動後、https://localhost:9200/_security/service/elastic/fleet-server/credential/token/fleet-server-token から取得
FLEET_SERVER_SERVICE_TOKEN=<fleet server service token>
```

## Winlogbeat でのログの送信

最初は Fleet 無しで、Elastic Agent も利用せずに Winlogbeat を用いてログを送っていました（現在も、メイン PC では Winlogbeat を用いてログを送っています）。

es01 に直接 winlogbeat がアクセスできるようにしてあげれば、問題無く動作すると思います。

## Fleet Server の設定

上の状態で fleet サービスが止まらずに動いている、かつ http://localhost:5601/app/fleet での Agent に Healthy な Fleet Server が表示されていれば OK です。

引っかかった際には http://localhost:5601/app/fleet/settings でアクセスできる Outputs に https://es01:9200 が設定されているか、これが Fleet Server の設定に紐づいているか。また、TLS なら Server SSL certificate authorities に証明書が設定されているかを見ると良いです。

なお、Outputs はデフォルトの値として設定しない方が良いと思っています。今後インストールする Agents は `https://<host_ip>:9200` と `es01` は使わないはずです。

## Elastic Defender Integration の導入、Elastic Agent のインストール

Fleet Server が動けば、Elastic Agent のインストール時にこのサーバーを指すことで設定を全部ここから取ってくれます。

基本的には http://localhost:5601/app/fleet/agents から Add Agent を選択、表示されたコマンドでインストールすればOKです。
ただし、自己証明書を用いているため、`elastic-agent install` コマンドの引数に `--insecure` もしくは `--fleet-server-es-ca=/path/to/ca.crt` を追加してあげる必要があります。

インストール後、Fleet の Agents 一覧にこの Agent が表示され、Healthy になっていれば成功です。

## 検知について
Elastic Defender に関連する検知ルールとして、`Endpoint Security (Elastic Defend)` を有効にしています。
Elastic Defender 側で検知・ブロックが発生した際にはこのルールから Kibana にてアラートとして表示されます。

しかし、Kibana における検知ルールには「ルール毎に事前に ATT&CK のテクニックを紐づける」という仕様があり、上記の `Endpoint Security (Elastic Defend)` ルールは ATT&CK のテクニックと紐づけが出来ません（検知が起きてからそれを判別すべき）。
そのため、`threat` フィールドに関連情報はある一方で、Kibana 側に UI として表示することが難しいです。

Kibana側に UI として表示される例
![](/assets/img/posts/elastic-environment/generic-alert-in-kibana.png)

Kibana側に UI として表示されない例
![](/assets/img/posts/elastic-environment/alert-by-elastic-defend.png)

この場合、実際の検知詳細画面で Highlighted fields という個所があります。ここに `threat.tactic.name` や `threat.technique.name` といったフィールドを表示することで、疑似的に UI 上に表示することが可能です。

他の環境に検知詳細の JSON を持ち込む際は面倒になると思うので、注意が必要です。