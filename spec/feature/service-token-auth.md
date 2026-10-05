# Cernere service token による service 間認証 (認証集約 P4)

認証集約 (Corpus `spec/plan/auth-plane-consolidation.md`、Memoria #769) の P4 の Calliope 側。
Cernere 側の発行と scope 宣言は Cernere `spec/feature/service-token.md` / migration 058。

## 受け側: `/api/*`

- `Authorization: Bearer` の値が `v4.public.` で始まり、`CERNERE_BASE_URL` と `CALLIOPE_STORAGE_SLUG` が
  設定されていれば、Cernere service token として検証する。
  - 署名: `/.well-known/cernere-public-key` の Ed25519 鍵 (10 分キャッシュ、署名不一致時に 1 回取り直す)
  - claims: `kind === "service"`、`exp` 未到来、`aud === CALLIOPE_STORAGE_SLUG`、scope に `calliope-api:access`
  - 不正は 401、scope 不足は 403。呼出元名 (`sub`) では分岐しない。
- それ以外の値は従来の固定トークン `CALLIOPE_SERVICE_TOKEN` と照合する (移行期間の経路)。
- service token 検証も固定トークンも未構成なら、従来どおり無認証で通し起動時に警告する。

## 送り側: PROJECTHUB (GLAB `/api/x/projects/external`)

- `CERNERE_PROJECT_CLIENT_ID` / `_SECRET` (Excubitor `cernere_launch_credentials`) で
  `POST {CERNERE_BASE_URL}/api/auth/service-token` (`target_project_key = PROJECTHUB_PROJECT_KEY`、既定 `EducationLab`)
  を呼び、得た token を従来と同じ `X-ProjectHub-Service-Token` ヘッダで送る。
- token は process memory にだけ置き、期限の 60 秒前まで使い回す。
- 発行に失敗したとき (credentials 未設定 / 401 / 403 / 404 / 不通) に限り、`PROJECTHUB_PROJECTS_SERVICE_TOKEN` が
  あれば固定トークンで送る。理由コードを 1 行ログに出す (秘密値は出さない)。

## P5 で撤去する箇所

| 箇所 | 内容 |
|---|---|
| `src/routes/auth.ts` `apiAuth` | 固定トークン照合の分岐と `serviceToken` 引数、未構成時の無認証通過 |
| `src/clients/service-auth-header.ts` | `fixedToken` フォールバック |
| `src/clients/projecthub.ts` / `src/clients/index.ts` | `serviceToken` (固定) の受け渡し |
| `src/config.ts` | `CALLIOPE_SERVICE_TOKEN` / `PROJECTHUB_PROJECTS_SERVICE_TOKEN` |
| `src/index.ts` | 固定トークン未設定時の警告文 |
| `.env.example` | 上記 2 変数 |
