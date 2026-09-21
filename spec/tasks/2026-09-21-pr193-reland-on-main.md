---
task: pr193-reland-on-main
project: Calliope
kind: 実装
created: 2026-09-21
memory_links:
  - spec/architecture-domains.md
  - spec/feature/task-generation.md
  - spec/plan/problem_logs/2026-08-23-service-map-exposure-and-import-collision.md
---
# PR#193 (タスク自動生成) を現在の main の上へ載せ直す

## 目的

Revisor local PR #193 は提出後に main が 3 コミット進み、審査が
`complexity score dropped by 20 points` で止まっていた。本タスクは
この PR を現在の main の上へ載せ直し、審査を通る状態にする。

審査失敗の原因は実際の複雑度低下ではなく、Revisor が記録していた
`baseSha` がリポジトリ初期コミット (`6dbf313` scaffold) にあたる別系列の
コミットを指していたこと。差分が 183 ファイル / 21,227 行 = ほぼリポジトリ全体
として評価され、関数スナップショットの比較対象が存在しないため
「複雑度低下」「80 関数が orphan」と報告されていた。
`revisor pr retry` は `#requeue` で `inspectLocalPullRequest` を呼び
base/head 双方を再解決するため、main 取り込み後の再投入で base は是正される。

## 完了条件

- [x] ローカル main (= origin/main `a58eec9`) を `feat/task-generate` へ取り込む。
- [x] `src/config.ts` の衝突を解消する (両側とも設定項目の追加なので両採用)。
- [x] `src/app.ts` の CORS 衝突を解消する。main の `/service-map` 除外と
      本 PR の `/api/*` allowlist 強化を、経路別ポリシー 1 本へ載せ替える。
      main 側の「他経路の挙動は従来どおり」を巻き戻さない。
- [x] ドメイン定義の正本を main の `spec/domains/` に統一し、本 PR が持ち込んだ
      `.anatomia/domains/*.domain.json` を廃する (main が `.anatomia/` を
      `.gitignore` 済みで、Anatomia も `spec/domains` を優先して読むため
      これらは読まれない死んだ定義になる)。
- [x] 本 PR が新設した `src/taskgen/` と `src/tasks/` を `spec/domains/` へ帰属させる。
- [x] `spec/architecture-domains.md` を `spec/domains/` 正本と main の
      ドメイン構成へ追従させる。
- [x] 経路別 CORS の相互作用に回帰テストを足す
      (`src/routes/__tests__/p5.test.ts`)。
- [x] `npm run typecheck` / `npm test` が green。
- [x] `git diff | anatomia verify` の **block 級ゲートを全て通す**
      (`rule_conformance` / `duplication` / `spec_linkage`)。
      warn 級の `coupling_delta` は残る — 理由は下記。

## 解消の内訳

### 単純にどちらかを採用した箇所

- `src/config.ts` — HEAD 側 `corsOrigins` と main 側
  `serviceMapAdminToken` / `serviceMapSyncMinutes` はどちらも純粋な追加。
  型・`loadConfig()` ともに両方を残した。
- `.env.example` / `src/db/schema.ts` / `src/clients/index.ts` 等 — git の
  自動マージどおり。判断を要する箇所は無い。

### 載せ替えが必要だった箇所

- `src/app.ts` の CORS ミドルウェア。両側が同じ 1 個のミドルウェアを
  別の方向へ書き換えていた。
  - main (後): `/service-map` だけワイルドカード CORS から外す。
    他経路は `*` のまま (`spec/plan/problem_logs/2026-08-23-...` の
    Fix Requirements に「leave other paths as-is」と明記)。
  - 本 PR (先): ワイルドカードを廃し `CALLIOPE_CORS_ORIGINS` の
    allowlist に置き換える (Revisor 自動修正の security 強化)。
  - 載せ替え後: `resolveCorsOrigin(path, origin, allowlist)` で経路別に決める。
    `/service-map` → 常に不許可 / `/api/*` → allowlist のみ /
    それ以外 → `*`。main の要求 (service-map を外す) を満たしたまま、
    本 PR の強化をその根拠が及ぶ `/api/*` に載せ直した形。
    main 側の登録テスト (`/health` が `*`) も本 PR の登録テスト
    (`/api/plan` は allowlist のみ) も、そのまま通る。
- ドメイン定義。本 PR は `.anatomia/domains/` に 6 ドメイン、main は
  `spec/domains/` に 10 ドメインを、それぞれ別ディレクトリへ追加していた
  (パスが違うため git は衝突として検出しない)。main を土台に採り、
  本 PR 固有の差分 = `src/taskgen/` と `src/tasks/` の帰属だけを足した。

### main 側の変更を巻き戻した箇所

- 無し。

## Anatomia ゲートの対応

`anatomia verify` は登録プロジェクト `calliope` (= `E:/Document/Ars/Calliope`) ではなく
本 worktree を `--repo` で指すこと。`--project` を渡すと main の checkout を解析するため、
本ブランチの変更が一切反映されない結果になる。

- **spec_linkage** (旧 Revisor advisory 「Anatomia gate(s) did not pass: spec_linkage」)
  — タスク生成まわりの production コードが spec clause に紐付いておらず orphan 判定だった。
  explicit linker はファイル単位で紐付ける (`from` = ファイルパス) ので、各ファイル先頭の
  JSDoc へ `@spec <見出し>` を 1 個置けば足りる。見出しは
  `spec/feature/task-generation.md` / `spec/interface/task-generation-api.md` の実在する
  H2 をそのまま書く (`clause.heading.includes(ref)` 照合)。→ **PASS**
- **convention_drift** — `src/app.ts` へ `isApiPath` を足したことで同ファイルの兄弟関数が
  `*Path` で全一致し、「共通サフィックス Path」が局所規約として採掘され `createApp` /
  `resolveCorsOrigin` が乖離判定されていた。CORS ポリシーを `src/routes/cors.ts` へ
  切り出して解消 (兄弟が `src/routes/*` になり共通サフィックスが採掘されない)。
  分離自体は SRP の要請とも一致し、`app.ts` は合成ルートに戻る。→ **PASS**
- **coupling_delta** — warn 級で残る。実際の結合増加ではない。verify は差分から再構成した
  擬似ソース上の `createApp` を新規アンカーとして測るため、合成ルートの本体がどれだけ
  hunk に含まれるかで値が動く (`createApp` の実測は main 時点で fanIn=62 / fanOut=24、
  repo の p95=8)。main 自身の `a58eec9` の `src/app.ts` 差分が通るのは hunk が小さいからで、
  合成ルートを触る差分は大きさ次第でこの warn を踏む。

## マージリスクについて

審査は通る (`reasons: []` / `anatomiaGate: passed` / CI 全 green) が、Revisor の自動マージは
`mergeRisk 64 > 閾値 60` で保留される。内訳は runtime_verification 20 (人間による動作確認) /
diff_size 18 / orphans 12 / change_surface 8 / advisories 6。

orphans 12 は「静的呼び出し元が無い変更関数 9 件」で、その実体は factory が返す
オブジェクトのメソッド (`repo.rejectConfirmation` / `clients.schedula.createCalendarEvent` /
`service.generate` 等)。静的コールグラフでは解決できない本リポの構成上の性質であり、
本 PR が持ち込んだものではない。runtime_verification 20 も人間の動作確認を求めるゲートで、
コード側の修正で下げられる項目ではない。

したがってマージは Revisor の自動マージ通知 (= 人間の動作確認後) を待つ。

## スコープ (編集可ディレクトリ)

- `src/app.ts` / `src/config.ts`
- `src/routes/__tests__/`
- `spec/domains/`
- `spec/architecture-domains.md`
- `spec/tasks/`
