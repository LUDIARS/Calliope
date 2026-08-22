# サービスマップ (Villa /map からの移設)

## 位置づけ

<!-- SPEC-SERVICE-MAP-BOUNDARY -->

Villa の「家PC リソースマップ」(/map) は表示ハブである Villa の性格から外れた
計画アプリだったため、計画統括である Calliope へ移設した。移設にあたり主軸を
「PC 割当」から「**事業ドメイン別にサービスを束ね、ロードマップを生成する**」へ
転換し、PC 割当は副ビュー (admin) として維持する。

MUSA 原則の適用:

<!-- SPEC-SERVICE-MAP-PERSISTENCE -->

| データ | 正本 | Calliope |
|---|---|---|
| サービス一覧・ポート・稼働状態 | Excubitor catalog | 同期スナップショット (`service_map_service`) |
| ロードマップ路線 (repo × importance) | Memoria | read して束ねるだけ |
| 優先度解決値 / スプリント | Calliope 自DB (既存) | ドメイン軸で束ねるだけ |
| 事業ドメイン・グループ・PC 台帳・割当 | **Calliope (本機能)** | 自DB (計画成果物) |

## 仕組み (neco 指示 4 点)

<!-- SPEC-SERVICE-MAP-UI -->

1. **サービスを検索する仕組み** — 公開ビューに検索ボックス (名前 / code /
   プロジェクト / 説明) + 稼働状態フィルタ。データは全量を返してクライアントで絞る
   (対象は 100 行程度)。
2. **サービスの自動同期** — 閲覧時の遅延同期。`connector_state.excubitor` の
   last_sync が `CALLIOPE_SERVICEMAP_SYNC_MINUTES` (既定 10 分) より古ければ
   Excubitor `/api/v1/services` から取り直す。失敗は隠さず overview の
   `sync.state='failed'` として画面に出す。admin には強制同期ボタン。
   同期は割当 (groupIds / pcIds) と手直しした cadence / load を保持し、
   catalog から消えたサービスは削除せず `inCatalog=false` で残す。
   遅延同期は匿名 read からも走るため、進行中の取得は同時アクセス間で共有し、
   失敗直後の 60 秒は結果を再利用する (落ちている上流を閲覧のたびに叩かない)。
   Excubitor 応答の `services` 欠落は既定値で補わず失敗にする — 形の変化を
   「catalog 0 件」として飲み込むと全行が `inCatalog=false` へ倒れるため。
3. **稼働中かどうか** — Excubitor の観測 state を同期時に取り込み、
   稼働ドット / タグ / 稼働中カウントとして表示する。
4. **認可の三層 (認証はいったん Cloudflare Access)** — neco 裁定。
   - `/service-map/public` 以下: 匿名可。サニタイズ済み read (ポート・PC 情報なし) と
     共有アセット。構造化フィールドを落とすだけでなく、description に紛れ込んだ
     ポート表記 (`port: 3000` / `//host:3000`) も伏せる (Villa 由来の説明文が持つ)。
   - `/service-map` ルート以下: CF 認証ユーザー。フル閲覧 (ポート・PC 台帳・配置の read)。
   - `/service-map/admin` 以下: CF 管理者ポリシー。編集・同期・生成・移行。
     `CALLIOPE_SERVICEMAP_ADMIN_TOKEN` を設定した場合のみアプリ層でも Bearer を要求
     (defense in depth)。未設定は CF に委ねて素通し。

## 事業ドメインとロードマップ生成

- 階層: **事業ドメイン → サービスグループ → サービス**。グループが割当の単位
  (Villa 継承)。ドメイン所属はグループ単位で人が決める (推測しない)。
- `POST /service-map/admin/api/roadmap/generate` がドメインごとに
  Memoria roadmap 路線 (repo 一致) + Calliope priority (scope=project) +
  スプリントを束ね、`service_map_roadmap` に supersede 版管理で保存する。
- Memoria 未設定 / 失敗は成果物の `sources.memoria` に明示して残す
  (ローカル計画成果物だけでも束ねる)。
- ドメイン未所属のグループ / サービス数も成果物に含め、割り漏れを隠さない。

## API

| Method | Path | 認可 | 概要 |
|---|---|---|---|
| GET | /service-map/public | CF: 匿名可 | 公開ビュー (サニタイズ) |
| GET | /service-map/public/api/overview | CF: 匿名可 | ドメイン・グループ・サービス (+稼働状態) + active roadmap。遅延同期込み。ポート・PC なし |
| GET | /service-map/public/assets/* | CF: 匿名可 | 全モード共有のアセット |
| GET | /service-map | CF: 認証 | フル閲覧ビュー |
| GET | /service-map/api/overview | CF: 認証 | publicOverview + PC 台帳 + port + pcIds |
| GET | /service-map/admin | CF: 管理者 | 管理ビュー |
| GET | /service-map/admin/api/overview | CF: 管理者 (+任意 Bearer) | 管理ビュー用 full overview |
| POST | /service-map/admin/api/sync | CF: 管理者 (+任意 Bearer) | Excubitor 強制同期 (失敗 502 / 未設定 503) |
| POST | /service-map/admin/api/roadmap/generate | CF: 管理者 (+任意 Bearer) | ロードマップ生成 + 保存 |
| POST/DELETE | /service-map/admin/api/{pcs,domains,groups}[/:id] | CF: 管理者 (+任意 Bearer) | 台帳 CRUD |
| PATCH | /service-map/admin/api/services/:id | CF: 管理者 (+任意 Bearer) | 割当 (groupIds/pcIds/cadence/load) |
| POST | /service-map/admin/api/import/villa | CF: 管理者 (+任意 Bearer) | villa-state.json の一回きり移行 (完了後の再実行は 409) |

`/api/*` (CALLIOPE_SERVICE_TOKEN) とは独立の認可系。経路認証の正本は Cloudflare Access で、
path prefix (public / ルート / admin) ごとにポリシーを分ける。アプリ層の admin Bearer は
CALLIOPE_SERVICEMAP_ADMIN_TOKEN 設定時のみの追加ゲート。
Calliope の origin はローカルまたは private network に閉じ、外部から CF Access を迂回して
直接到達できないことをデプロイ前提とする。origin を公開するとルート/admin の CF 認可を迂回できる。
`/service-map` 以下はアプリ全体のワイルドカード CORS から除外する (同一オリジンの画面専用)。
admin Bearer 未設定時は素通しになるため、CORS を許すと利用者のブラウザで開いた任意のサイトから
origin の台帳を read / mutate できてしまう。

## 移行手順 (Villa → Calliope)

1. 本 PR マージ + Calliope 再起動 (dist 運用ではないが env 追加が要る)。
2. `/service-map/admin` から Villa の `villa-state.json` を「Villa 取り込み」で投入
   (PC 4 台・グループ・割当が引き継がれる)。現行の管理編集を
   旧 Villa データで上書きしないため、成功後の再取り込みは拒否する。
   管理画面を開いた時点で遅延同期が先に走るため、catalog 行 (`svc-<code>`) が
   既にある状態で取り込むことになる。Villa の legacy ID は prefix なしのことがあるので、
   取り込みは id ではなく unique な code で既存行へ重ねる (code 衝突で移行全体を落とさない)。
3. 「Excubitor 同期」で catalog の今を重ね、事業ドメインを作ってグループを所属させる。
4. Villa 側から /map・/api/services・/api/state を撤去 (別 PR)。
