// サービスマップのページ骨格。3 モード共通の骨格で、経路認証は Cloudflare Access が担う:
//   public … 匿名向けサニタイズ閲覧 (検索 / ドメイン / 稼働 / ロードマップ)
//   root   … CF 認証ユーザー向けフル閲覧 (+ポート・PC 配置・PC 台帳の読み取り)
//   admin  … CF 管理者向け (+編集・同期・生成・移行)
// 中身の描画は script.ts (vanilla ES module) が行う。

export type ServiceMapUiMode = 'public' | 'root' | 'admin';

/** @implements SPEC-SERVICE-MAP-UI */
export function serviceMapHtml({ mode }: { mode: ServiceMapUiMode }): string {
  const isAdmin = mode === 'admin';
  const hasManagement = mode !== 'public';
  const title = isAdmin ? 'サービスマップ 管理 — Calliope'
    : mode === 'root' ? 'LUDIARS サービスマップ — Calliope'
      : 'LUDIARS サービスマップ (公開) — Calliope';
  const lede = isAdmin
    ? '事業ドメイン・グループ・PC 割当・取り込みを整える管理画面です。正本は Excubitor catalog、ここは束ね方の台帳です。'
    : mode === 'root'
      ? '事業ドメインごとにサービスを束ね、稼働状態・配置・ロードマップをひと目で追うための地図です。'
      : '事業ドメインごとにサービスを束ね、稼働状態とロードマップをひと目で追うための地図です。';
  const headerTools = isAdmin
    ? '<label class="token-label">Admin token (任意) <input id="adminToken" type="password" autocomplete="off"></label><button class="button primary" type="button" id="connectButton">接続</button><a class="top-link" href="/service-map">閲覧ビューへ</a>'
    : mode === 'root'
      ? '<a class="top-link" href="/service-map/admin">管理ビューへ</a>'
      : '';

  return `<!doctype html>
<html lang="ja" data-mode="${mode}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${title}</title>
  <link rel="stylesheet" href="/service-map/public/assets/servicemap.css">
</head>
<body>
  <header class="masthead">
    <div class="shell masthead-inner">
      <div>
        <p class="eyebrow">CALLIOPE · SERVICE MAP${isAdmin ? ' · ADMIN' : mode === 'public' ? ' · PUBLIC' : ''}</p>
        <h1>${isAdmin ? 'サービスマップ 管理' : 'LUDIARS サービスマップ'}</h1>
        <p class="lede">${lede}</p>
      </div>
      <div class="header-tools">${headerTools}</div>
    </div>
  </header>

  <main class="shell">
    <div class="toolbar">
      <div class="search-wrap">
        <input id="searchInput" type="search" placeholder="サービスを検索 — 名前 / code / プロジェクト / 説明" aria-label="サービスを検索">
        <div class="filter-row" id="stateFilters" role="group" aria-label="稼働状態で絞り込み">
          <button class="chip-filter active" data-state="all" type="button">すべて</button>
          <button class="chip-filter" data-state="running" type="button">稼働中</button>
          <button class="chip-filter" data-state="stopped" type="button">停止中</button>
        </div>
      </div>
      <div class="toolbar-side">
        <p class="saved" id="syncStatus" aria-live="polite">読み込み中…</p>
        <div class="button-row" id="toolbarActions"></div>
      </div>
    </div>

    <section class="stat-grid" aria-label="概要">
      <div class="stat"><span class="stat-label">サービス</span><strong class="stat-value" id="statServices">–</strong><span class="stat-note">Excubitor catalog 由来</span></div>
      <div class="stat"><span class="stat-label">稼働中</span><strong class="stat-value ok" id="statRunning">–</strong><span class="stat-note">Excubitor の観測状態</span></div>
      <div class="stat"><span class="stat-label">事業ドメイン</span><strong class="stat-value" id="statDomains">–</strong><span class="stat-note">ロードマップ生成の単位</span></div>
      <div class="stat"><span class="stat-label">ドメイン未所属</span><strong class="stat-value warn" id="statUnassigned">–</strong><span class="stat-note">所属待ちのグループ</span></div>
    </section>

    <nav class="tabs" id="tabs" role="tablist">
      <button class="tab active" data-tab="domains" type="button" role="tab">事業ドメイン</button>
      <button class="tab" data-tab="roadmap" type="button" role="tab">ロードマップ</button>
      ${hasManagement ? '<button class="tab" data-tab="placement" type="button" role="tab">PC 配置</button><button class="tab" data-tab="pcs" type="button" role="tab">PC 台帳</button>' : ''}
    </nav>

    <section id="view-domains" class="view" aria-label="事業ドメイン別サービス"></section>
    <section id="view-roadmap" class="view hidden" aria-label="事業ドメイン別ロードマップ"></section>
    ${hasManagement ? `
    <section id="view-placement" class="view hidden" aria-label="PC × グループの配置">
      <div class="section-heading"><div><h2>PC × グループの見取り図</h2><p>${isAdmin ? 'グループ単位で PC へ割り当てます。ノードをクリックすると割当を編集できます。' : 'グループのメンバーが載っている PC を線で示します。'}</p></div></div>
      <div class="map-canvas" id="mapCanvas">
        <svg class="map-edges" id="mapEdges" aria-hidden="true"></svg>
        <div class="map-column"><h3>PC ノード</h3><div class="node-stack" id="mapPcs"></div></div>
        <div class="map-column map-hint" id="mapHint"></div>
        <div class="map-column"><h3>サービスグループ</h3><div class="node-stack" id="mapGroups"></div></div>
      </div>
      <div class="section-heading"><div><h2>グループと割当</h2><p>${isAdmin ? 'ドメイン所属と主担当 PC はここで変えられます。' : 'グループのドメイン所属とメンバー。'}</p></div>${isAdmin ? '<button class="button small" type="button" id="addGroupButton">+ グループを追加</button>' : ''}</div>
      <div class="group-grid" id="groupList"></div>
    </section>
    <section id="view-pcs" class="view hidden" aria-label="PC 台帳">
      <div class="section-heading"><div><h2>PC 台帳</h2><p>スペックと稼働方針。${isAdmin ? '割当は「PC 配置」タブで。' : ''}</p></div>${isAdmin ? '<button class="button small" type="button" id="addPcButton">+ PC を追加</button>' : ''}</div>
      <div class="pc-grid" id="pcList"></div>
    </section>` : ''}
    ${isAdmin ? `
    <dialog class="dialog" id="pcDialog">
      <form id="pcForm" method="dialog">
        <div class="dialog-head"><div><h2 id="pcDialogTitle">PC を追加</h2><p>不明なスペックは空欄で構いません。</p></div><button class="icon-button" type="button" data-close="pcDialog" aria-label="閉じる">×</button></div>
        <input type="hidden" name="id">
        <div class="form-grid">
          <label>名前<input name="name" required maxlength="60"></label>
          <label>置き場所<input name="location" maxlength="60"></label>
          <label>主な役割<input name="role" maxlength="80"></label>
          <label>稼働方針<select name="mode"><option>常時稼働</option><option>定期稼働</option><option>手動稼働</option><option>予備</option></select></label>
          <label>優先度<select name="priority"><option value="S">S · 止めにくい</option><option value="A" selected>A · 主力</option><option value="B">B · 補助</option><option value="C">C · 実験・予備</option></select></label>
          <label>OS<input name="os" maxlength="60"></label>
          <label>CPU<input name="cpu" maxlength="90"></label>
          <label>メモリ<input name="ram" maxlength="40"></label>
          <label>GPU<input name="gpu" maxlength="90"></label>
          <label>保存領域<input name="storage" maxlength="60"></label>
          <label class="wide">メモ<textarea name="note" maxlength="300"></textarea></label>
        </div>
        <div class="dialog-actions"><button class="button danger hidden" type="button" id="deletePcButton">この PC を削除</button><div class="right"><button class="button" type="button" data-close="pcDialog">キャンセル</button><button class="button primary" type="submit">保存する</button></div></div>
      </form>
    </dialog>

    <dialog class="dialog" id="groupDialog">
      <form id="groupForm" method="dialog">
        <div class="dialog-head"><div><h2 id="groupDialogTitle">グループを編集</h2><p>ドメイン所属と主担当 PC をここで決めます。</p></div><button class="icon-button" type="button" data-close="groupDialog" aria-label="閉じる">×</button></div>
        <input type="hidden" name="id">
        <div class="form-grid">
          <label>グループ名<input name="name" required maxlength="60"></label>
          <label>事業ドメイン<select name="domainId" id="groupDomainSelect"></select></label>
        </div>
        <div class="assign-block"><span class="assign-label">主担当 PC (メンバー全員に適用)</span><div class="toggle-list" id="groupPcToggles"></div></div>
        <div class="assign-block"><span class="assign-label">メンバー</span><div class="member-chips" id="groupMemberChips"></div></div>
        <div class="dialog-actions"><button class="button danger hidden" type="button" id="deleteGroupButton">このグループを削除</button><div class="right"><button class="button" type="button" data-close="groupDialog">キャンセル</button><button class="button primary" type="submit">保存する</button></div></div>
      </form>
    </dialog>

    <dialog class="dialog" id="domainDialog">
      <form id="domainForm" method="dialog">
        <div class="dialog-head"><div><h2 id="domainDialogTitle">事業ドメインを追加</h2><p>ロードマップを生成する単位です。</p></div><button class="icon-button" type="button" data-close="domainDialog" aria-label="閉じる">×</button></div>
        <input type="hidden" name="id">
        <div class="form-grid">
          <label>ドメイン名<input name="name" required maxlength="60" placeholder="例: 教育 / 学校運営"></label>
          <label>表示順<input name="seq" type="number" min="0" value="0"></label>
          <label class="wide">メモ<textarea name="note" maxlength="300" placeholder="このドメインの狙い・境界など"></textarea></label>
        </div>
        <div class="dialog-actions"><button class="button danger hidden" type="button" id="deleteDomainButton">このドメインを削除</button><div class="right"><button class="button" type="button" data-close="domainDialog">キャンセル</button><button class="button primary" type="submit">保存する</button></div></div>
      </form>
    </dialog>

    <dialog class="dialog" id="serviceDialog">
      <form id="serviceForm" method="dialog">
        <div class="dialog-head"><div><h2 id="serviceDialogTitle">サービスの割当</h2><p id="serviceDialogSub"></p></div><button class="icon-button" type="button" data-close="serviceDialog" aria-label="閉じる">×</button></div>
        <input type="hidden" name="id">
        <div class="assign-block"><span class="assign-label">所属グループ</span><div class="toggle-list" id="serviceGroupToggles"></div></div>
        <div class="assign-block"><span class="assign-label">主担当 PC (グループの既定から個別に外す時だけ)</span><div class="toggle-list" id="servicePcToggles"></div></div>
        <div class="form-grid">
          <label>稼働タイミング<select name="cadence"><option>常時</option><option>定期</option><option>必要時</option></select></label>
          <label>負荷<select name="load"><option value="heavy">重い</option><option value="medium">中くらい</option><option value="light">軽い</option></select></label>
        </div>
        <div class="dialog-actions"><span></span><div class="right"><button class="button" type="button" data-close="serviceDialog">キャンセル</button><button class="button primary" type="submit">保存する</button></div></div>
      </form>
    </dialog>
    <input class="hidden" type="file" id="importFile" accept="application/json">
    ` : ''}
  </main>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <script type="module" src="/service-map/public/assets/servicemap.js"></script>
</body>
</html>`;
}
