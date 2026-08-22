// サービスマップのクライアントスクリプト。vanilla ES module・外部依存なし。
// TS テンプレートリテラル内に埋めるため、この JS はバッククォートと \${ を使わない。

export const serviceMapScript = `
'use strict';
// モード: public(匿名サニタイズ閲覧) / root(認証フル閲覧) / admin(編集)。経路認証は CF Access。
const MODE = document.documentElement.dataset.mode || 'public';
const IS_ADMIN = MODE === 'admin';
const HAS_MGMT = MODE !== 'public';
const API_BASE = MODE === 'public'
  ? '/service-map/public/api'
  : IS_ADMIN ? '/service-map/admin/api' : '/service-map/api';
const TOKEN_KEY = 'calliope_sm_admin_token';

const el = (id) => document.getElementById(id);
const state = {
  data: null,
  query: '',
  stateFilter: 'all',
  tab: 'domains',
};

function token() { return sessionStorage.getItem(TOKEN_KEY) || ''; }

function toast(message) {
  const node = el('toast');
  node.textContent = message;
  node.classList.add('visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('visible'), 2600);
}

async function api(path, options) {
  options = options || {};
  const headers = Object.assign({}, options.headers);
  if (IS_ADMIN && token()) headers.authorization = 'Bearer ' + token();
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(API_BASE + path, Object.assign({}, options, { headers }));
  const body = await res.json().catch(() => ({ error: 'invalid_json' }));
  if (!res.ok) {
    const error = new Error(body.error || ('HTTP ' + res.status));
    error.status = res.status;
    error.detail = body.hint || body.detail || '';
    throw error;
  }
  return body;
}

function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
function make(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
function emptyNote(parent, message) { parent.append(make('p', 'empty', message)); }

// ---- 絞り込み ----

function matchesQuery(service) {
  if (!state.query) return true;
  const q = state.query.toLowerCase();
  return [service.name, service.code, service.projectCode, service.description, service.tierLabel]
    .some((field) => (field || '').toLowerCase().includes(q));
}

function matchesState(service) {
  if (state.stateFilter === 'all') return true;
  if (state.stateFilter === 'running') return service.running;
  return !service.running;
}

function visibleServices() {
  return (state.data ? state.data.services : []).filter((s) => matchesQuery(s) && matchesState(s));
}

// ---- ヘッダ・統計 ----

function renderSyncStatus() {
  const node = el('syncStatus');
  const sync = state.data && state.data.sync;
  node.className = 'saved';
  if (!sync) { node.textContent = ''; return; }
  if (sync.state === 'unconfigured') {
    node.textContent = 'Excubitor 未設定 — 保存済みの台帳を表示中';
    node.className = 'saved error';
  } else if (sync.state === 'failed') {
    node.textContent = 'Excubitor 同期失敗 (' + (sync.error || '') + ') — 最終同期 ' + (sync.syncedAt ? formatTime(sync.syncedAt) : 'なし');
    node.className = 'saved error';
  } else {
    node.textContent = '同期 ' + (sync.syncedAt ? formatTime(sync.syncedAt) : '-');
  }
}

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderStats() {
  const data = state.data;
  const services = data.services;
  el('statServices').textContent = String(services.length);
  el('statRunning').textContent = String(services.filter((s) => s.running).length);
  el('statDomains').textContent = String(data.domains.length);
  el('statUnassigned').textContent = String(data.groups.filter((g) => !g.domainId).length);
}

// ---- 事業ドメインビュー ----

function serviceCard(service) {
  const card = IS_ADMIN ? make('button', 'service-card') : make('div', 'service-card');
  if (IS_ADMIN) {
    card.type = 'button';
    card.addEventListener('click', () => openServiceDialog(service));
  }
  const title = make('span', 'service-title');
  const dot = make('span', 'state-dot ' + (service.running ? 'running' : (service.runState === 'unknown' ? '' : 'stopped')));
  title.append(dot, document.createTextNode(service.name));
  card.append(title);
  const subParts = ['code: ' + service.code];
  if (HAS_MGMT && service.port) subParts.push('port: ' + service.port);
  card.append(make('span', 'service-sub', subParts.join(' · ')));
  const tags = make('span', 'service-tags');
  tags.append(make('span', 'tag', service.tierLabel));
  tags.append(make('span', 'tag state-' + (service.running ? 'running' : (service.runState === 'unknown' ? 'unknown' : 'stopped')),
    service.running ? '稼働中' : (service.runState === 'unknown' ? '不明' : '停止中')));
  tags.append(make('span', 'tag', service.cadence));
  if (!service.inCatalog) tags.append(make('span', 'tag gone', 'catalog 消滅'));
  card.append(tags);
  return card;
}

function renderDomains() {
  const view = el('view-domains');
  clear(view);
  const data = state.data;
  const grid = make('div', 'domain-grid');
  const services = visibleServices();
  const servicesOfGroup = (groupId) => services.filter((s) => s.groupIds.includes(groupId));

  const renderDomainCard = (domain, groups, extraClass) => {
    const withMembers = groups
      .map((group) => ({ group, members: servicesOfGroup(group.id) }))
      .filter((entry) => entry.members.length > 0 || !state.query);
    const total = withMembers.reduce((sum, entry) => sum + entry.members.length, 0);
    if (state.query && total === 0) return null;
    const card = make('article', 'domain-card' + (extraClass ? ' ' + extraClass : ''));
    const head = make('div', 'domain-head');
    head.append(make('h2', null, domain.name));
    const running = withMembers.reduce((sum, entry) => sum + entry.members.filter((s) => s.running).length, 0);
    head.append(make('span', 'domain-meta', total + ' サービス · 稼働中 ' + running));
    card.append(head);
    if (domain.note) card.append(make('p', 'domain-note', domain.note));
    const groupsWrap = make('div', 'domain-groups');
    withMembers.forEach((entry) => {
      const block = make('div', 'group-block');
      block.append(make('h3', null, entry.group.name));
      const list = make('div', 'service-grid');
      if (!entry.members.length) { emptyNote(block, 'このグループに該当なし'); groupsWrap.append(block); return; }
      entry.members.forEach((service) => list.append(serviceCard(service)));
      block.append(list);
      groupsWrap.append(block);
    });
    if (!withMembers.length) emptyNote(groupsWrap, 'グループ未所属');
    card.append(groupsWrap);
    return card;
  };

  data.domains.forEach((domain) => {
    const groups = data.groups.filter((g) => g.domainId === domain.id);
    const card = renderDomainCard(domain, groups, '');
    if (card) grid.append(card);
  });

  const orphanGroups = data.groups.filter((g) => !g.domainId);
  if (orphanGroups.length) {
    const card = renderDomainCard(
      { name: 'ドメイン未所属', note: IS_ADMIN ? '「PC 配置」タブのグループ編集から事業ドメインへ所属させてください。' : '' },
      orphanGroups,
      'unassigned',
    );
    if (card) grid.append(card);
  }

  if (!grid.childElementCount) emptyNote(grid, state.query ? '検索に一致するサービスがありません' : 'サービスがまだありません。Excubitor 同期を実行してください。');
  view.append(grid);
}

// ---- ロードマップビュー ----

function renderRoadmap() {
  const view = el('view-roadmap');
  clear(view);
  const roadmap = state.data.roadmap;
  const wrap = make('div', 'roadmap-grid');
  if (!roadmap) {
    emptyNote(wrap, IS_ADMIN
      ? 'ロードマップ未生成です。「ロードマップ生成」を押すと、事業ドメイン別に Memoria 路線と優先度を束ねます。'
      : 'ロードマップはまだ生成されていません。');
    view.append(wrap);
    return;
  }
  const payload = roadmap.payload;
  const note = make('div', 'roadmap-note');
  const memoria = payload.sources && payload.sources.memoria;
  note.textContent = '生成 ' + formatTime(payload.generatedAt)
    + ' · Memoria 路線: ' + (memoria === 'ok' ? '取得済み' : (memoria === 'unconfigured' ? '未設定 (ローカル計画のみ)' : '取得失敗 ' + memoria));
  wrap.append(note);

  const maxScore = Math.max(1, ...payload.domains.flatMap((d) => d.priorities.map((p) => p.score)));
  payload.domains.forEach((domain) => {
    const card = make('article', 'roadmap-card');
    const head = make('div', 'domain-head');
    head.append(make('h2', null, domain.name));
    head.append(make('span', 'domain-meta', domain.serviceCount + ' サービス · 稼働中 ' + domain.runningCount));
    card.append(head);
    if (domain.note) card.append(make('p', 'domain-note', domain.note));

    const lines = make('div', 'roadmap-section');
    lines.append(make('h3', null, 'ロードマップ路線 (Memoria)'));
    if (!domain.lines.length) {
      emptyNote(lines, 'このドメインに紐づく路線はありません');
    } else {
      domain.lines.forEach((line) => {
        const row = make('div', 'line-item');
        row.append(make('span', 'line-code', line.code));
        row.append(make('span', null, line.title));
        line.repos.forEach((repo) => {
          const badge = make('span', 'importance', repo.repo + ' ★' + repo.importance);
          row.append(badge);
        });
        lines.append(row);
      });
    }
    card.append(lines);

    if (domain.priorities.length) {
      const prio = make('div', 'roadmap-section');
      prio.append(make('h3', null, '優先度 (Calliope 解決値)'));
      domain.priorities.forEach((row) => {
        const line = make('div', 'priority-bar-row');
        line.append(make('span', null, row.ref));
        const track = make('div', 'priority-track');
        const fill = make('div', 'priority-fill');
        fill.style.width = Math.round((row.score / maxScore) * 100) + '%';
        track.append(fill);
        line.append(track);
        line.append(make('span', 'priority-score', row.score.toFixed(2)));
        prio.append(line);
      });
      card.append(prio);
    }

    if (domain.sprints.length) {
      const sprints = make('div', 'roadmap-section');
      sprints.append(make('h3', null, 'スプリント'));
      domain.sprints.forEach((sprint) => {
        const row = make('div', 'line-item');
        row.append(make('span', 'line-code', sprint.status));
        row.append(make('span', null, sprint.projectRef + ' — ' + sprint.periodEnd + ' まで'));
        sprints.append(row);
      });
      card.append(sprints);
    }
    wrap.append(card);
  });

  if (payload.unassigned && (payload.unassigned.groupNames.length || payload.unassigned.serviceCount)) {
    const card = make('article', 'roadmap-card');
    card.style.borderLeftColor = 'var(--amber)';
    card.append(make('h2', null, 'ドメイン未所属'));
    card.append(make('p', 'domain-note',
      'グループ: ' + (payload.unassigned.groupNames.join(', ') || 'なし')
      + ' · サービス ' + payload.unassigned.serviceCount + ' 件はロードマップに含まれていません。'));
    wrap.append(card);
  }
  view.append(wrap);
}

// ---- admin: PC 配置 / PC 台帳 ----

function pcDetail(pc) {
  return [pc.role, pc.mode, pc.location].filter(Boolean).join(' · ');
}

function renderPlacement() {
  if (!HAS_MGMT) return;
  const data = state.data;
  const mapPcs = el('mapPcs');
  const mapGroups = el('mapGroups');
  clear(mapPcs); clear(mapGroups);

  const pcNodes = new Map();
  const groupNodes = new Map();
  data.pcs.forEach((pc) => {
    const node = make(IS_ADMIN ? 'button' : 'div', 'map-node');
    if (IS_ADMIN) {
      node.type = 'button';
      node.addEventListener('click', () => openPcDialog(pc));
    }
    node.append(make('span', 'node-name', pc.name));
    node.append(make('span', 'node-detail', pcDetail(pc)));
    mapPcs.append(node);
    pcNodes.set(pc.id, node);
  });
  if (!data.pcs.length) emptyNote(mapPcs, 'PC がまだありません');

  const membersOf = (groupId) => data.services.filter((s) => s.groupIds.includes(groupId));
  data.groups.forEach((group) => {
    const members = membersOf(group.id);
    const node = make(IS_ADMIN ? 'button' : 'div', 'map-node');
    if (IS_ADMIN) {
      node.type = 'button';
      node.addEventListener('click', () => openGroupDialog(group));
    }
    node.append(make('span', 'node-name', group.name));
    const domain = data.domains.find((d) => d.id === group.domainId);
    node.append(make('span', 'node-detail', (domain ? domain.name : 'ドメイン未所属') + ' · ' + members.length + ' サービス'));
    mapGroups.append(node);
    groupNodes.set(group.id, node);
  });
  if (!data.groups.length) emptyNote(mapGroups, 'グループがまだありません');

  el('mapHint').textContent = '線は「グループのメンバーが載っている PC」を表します。';
  requestAnimationFrame(() => drawEdges(pcNodes, groupNodes, membersOf));

  const groupList = el('groupList');
  clear(groupList);
  data.groups.forEach((group) => {
    const members = membersOf(group.id);
    const card = make('article', 'group-card' + (group.domainId ? '' : ' no-domain'));
    const head = make('div', 'group-head');
    head.append(make('h3', null, group.name));
    head.append(make('span', 'group-count', members.length + ' サービス'));
    card.append(head);
    const domain = data.domains.find((d) => d.id === group.domainId);
    card.append(make('p', 'group-domain', 'ドメイン: ' + (domain ? domain.name : '未所属')));
    const chips = make('div', 'group-members');
    members.forEach((service) => chips.append(make('span', 'chip' + (service.running ? '' : ' subtle'), service.name)));
    if (!members.length) chips.append(make('span', 'chip subtle', 'メンバーなし'));
    card.append(chips);
    if (IS_ADMIN) {
      const actions = make('div', 'group-actions');
      const edit = make('button', 'button small', '編集 / 割当');
      edit.type = 'button';
      edit.addEventListener('click', () => openGroupDialog(group));
      actions.append(edit);
      card.append(actions);
    }
    groupList.append(card);
  });
}

function drawEdges(pcNodes, groupNodes, membersOf) {
  const svg = el('mapEdges');
  const canvas = el('mapCanvas');
  if (!svg || !canvas) return;
  clear(svg);
  const canvasRect = canvas.getBoundingClientRect();
  const anchor = (node, side) => {
    const rect = node.getBoundingClientRect();
    return {
      x: (side === 'right' ? rect.right : rect.left) - canvasRect.left,
      y: rect.top + rect.height / 2 - canvasRect.top,
    };
  };
  groupNodes.forEach((groupNode, groupId) => {
    const pcIds = new Set(membersOf(groupId).flatMap((s) => s.pcIds || []));
    pcIds.forEach((pcId) => {
      const pcNode = pcNodes.get(pcId);
      if (!pcNode) return;
      const from = anchor(pcNode, 'right');
      const to = anchor(groupNode, 'left');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const dx = Math.max(30, (to.x - from.x) / 2);
      path.setAttribute('d', 'M ' + from.x + ' ' + from.y + ' C ' + (from.x + dx) + ' ' + from.y + ', ' + (to.x - dx) + ' ' + to.y + ', ' + to.x + ' ' + to.y);
      path.setAttribute('class', 'map-edge');
      svg.append(path);
      [from, to].forEach((point) => {
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', point.x); dot.setAttribute('cy', point.y); dot.setAttribute('r', 3);
        dot.setAttribute('class', 'map-endpoint');
        svg.append(dot);
      });
    });
  });
}

function renderPcs() {
  if (!HAS_MGMT) return;
  const list = el('pcList');
  clear(list);
  state.data.pcs.forEach((pc) => {
    const card = make('article', 'pc-card');
    const top = make('div', 'card-top');
    const left = make('div');
    left.append(make('h3', null, pc.name));
    left.append(make('p', 'card-subtitle', pcDetail(pc)));
    top.append(left);
    top.append(make('span', 'priority-badge p-' + pc.priority, pc.priority));
    card.append(top);
    const specs = make('dl', 'specs');
    [['OS', pc.os], ['CPU', pc.cpu], ['メモリ', pc.ram], ['GPU', pc.gpu], ['保存領域', pc.storage]].forEach((pair) => {
      if (!pair[1]) return;
      const cell = make('div');
      cell.append(make('dt', null, pair[0]));
      cell.append(make('dd', null, pair[1]));
      specs.append(cell);
    });
    card.append(specs);
    if (pc.note) card.append(make('p', 'card-subtitle', pc.note));
    if (IS_ADMIN) {
      const actions = make('div', 'card-actions');
      const edit = make('button', 'button small', '編集');
      edit.type = 'button';
      edit.addEventListener('click', () => openPcDialog(pc));
      actions.append(edit);
      card.append(actions);
    }
    list.append(card);
  });
  if (!state.data.pcs.length) emptyNote(list, 'PC がまだありません。「+ PC を追加」から登録してください。');
}

// ---- admin: ダイアログ ----

function fillForm(form, values) {
  Array.from(form.elements).forEach((field) => {
    if (!field.name) return;
    if (Object.prototype.hasOwnProperty.call(values, field.name)) field.value = values[field.name] == null ? '' : values[field.name];
  });
}

function openPcDialog(pc) {
  const dialog = el('pcDialog');
  const form = el('pcForm');
  form.reset();
  el('pcDialogTitle').textContent = pc ? 'PC を編集' : 'PC を追加';
  el('deletePcButton').classList.toggle('hidden', !pc);
  if (pc) fillForm(form, pc);
  dialog.returnValue = '';
  dialog.showModal();
  form.onsubmit = async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    if (!values.id) delete values.id;
    try {
      await api('/pcs', { method: 'POST', body: JSON.stringify(values) });
      dialog.close();
      toast('PC を保存しました');
      await load();
    } catch (error) { toast('保存失敗: ' + error.message); }
  };
  el('deletePcButton').onclick = async () => {
    if (!pc) return;
    try {
      await api('/pcs/' + encodeURIComponent(pc.id), { method: 'DELETE' });
      dialog.close();
      toast('PC を削除しました');
      await load();
    } catch (error) { toast('削除失敗: ' + error.message); }
  };
}

function toggleItem(labelText, inputName, value, checked, indeterminate) {
  const label = make('label', 'toggle');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.name = inputName;
  input.value = value;
  input.checked = checked;
  if (indeterminate) input.indeterminate = true;
  label.append(input, document.createTextNode(labelText));
  return label;
}

function openGroupDialog(group) {
  const data = state.data;
  const dialog = el('groupDialog');
  const form = el('groupForm');
  form.reset();
  el('groupDialogTitle').textContent = group ? 'グループを編集' : 'グループを追加';
  el('deleteGroupButton').classList.toggle('hidden', !group);
  const select = el('groupDomainSelect');
  clear(select);
  const noneOption = document.createElement('option');
  noneOption.value = '';
  noneOption.textContent = '未所属';
  select.append(noneOption);
  data.domains.forEach((domain) => {
    const option = document.createElement('option');
    option.value = domain.id;
    option.textContent = domain.name;
    select.append(option);
  });
  if (group) fillForm(form, { id: group.id, name: group.name, domainId: group.domainId || '' });

  const members = group ? data.services.filter((s) => s.groupIds.includes(group.id)) : [];
  const chips = el('groupMemberChips');
  clear(chips);
  members.forEach((service) => chips.append(make('span', 'chip subtle', service.name)));
  if (!members.length) chips.append(make('span', 'chip subtle', 'メンバーなし'));

  const toggles = el('groupPcToggles');
  clear(toggles);
  const initialCoverage = new Map();
  data.pcs.forEach((pc) => {
    const on = members.filter((s) => (s.pcIds || []).includes(pc.id)).length;
    const coverage = !members.length || on === 0 ? 'none' : (on === members.length ? 'all' : 'some');
    initialCoverage.set(pc.id, coverage);
    toggles.append(toggleItem(pc.name, 'pc', pc.id, coverage === 'all', coverage === 'some'));
  });
  if (!data.pcs.length) toggles.append(make('span', 'chip subtle', 'PC 未登録'));

  dialog.showModal();
  form.onsubmit = async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      const body = { name: values.name, domainId: values.domainId || null };
      if (values.id) body.id = values.id;
      const saved = await api('/groups', { method: 'POST', body: JSON.stringify(body) });
      // PC トグル: indeterminate のまま触っていないものは変更しない。
      const pcIdsByService = new Map(members.map((service) => [
        service.id,
        new Set(service.pcIds || []),
      ]));
      const changedServiceIds = new Set();
      toggles.querySelectorAll('input[name="pc"]').forEach((input) => {
        const before = initialCoverage.get(input.value) || 'none';
        if (input.indeterminate) return;
        const want = input.checked;
        if ((before === 'all') === want && before !== 'some') return;
        members.forEach((service) => {
          const pcIds = pcIdsByService.get(service.id);
          if (want) pcIds.add(input.value);
          else pcIds.delete(input.value);
          changedServiceIds.add(service.id);
        });
      });
      for (const serviceId of changedServiceIds) {
        await api('/services/' + encodeURIComponent(serviceId), {
          method: 'PATCH',
          body: JSON.stringify({ pcIds: Array.from(pcIdsByService.get(serviceId)) }),
        });
      }
      dialog.close();
      toast('グループを保存しました (' + saved.id + ')');
      await load();
    } catch (error) { toast('保存失敗: ' + error.message); }
  };
  el('deleteGroupButton').onclick = async () => {
    if (!group) return;
    try {
      await api('/groups/' + encodeURIComponent(group.id), { method: 'DELETE' });
      dialog.close();
      toast('グループを削除しました');
      await load();
    } catch (error) { toast('削除失敗: ' + error.message); }
  };
}

function openDomainDialog(domain) {
  const dialog = el('domainDialog');
  const form = el('domainForm');
  form.reset();
  el('domainDialogTitle').textContent = domain ? '事業ドメインを編集' : '事業ドメインを追加';
  el('deleteDomainButton').classList.toggle('hidden', !domain);
  if (domain) fillForm(form, domain);
  dialog.showModal();
  form.onsubmit = async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    const body = { name: values.name, note: values.note || '', seq: Number(values.seq || 0) };
    if (values.id) body.id = values.id;
    try {
      await api('/domains', { method: 'POST', body: JSON.stringify(body) });
      dialog.close();
      toast('ドメインを保存しました');
      await load();
    } catch (error) { toast('保存失敗: ' + error.message); }
  };
  el('deleteDomainButton').onclick = async () => {
    if (!domain) return;
    try {
      await api('/domains/' + encodeURIComponent(domain.id), { method: 'DELETE' });
      dialog.close();
      toast('ドメインを削除しました');
      await load();
    } catch (error) { toast('削除失敗: ' + error.message); }
  };
}

function openServiceDialog(service) {
  const data = state.data;
  const dialog = el('serviceDialog');
  const form = el('serviceForm');
  form.reset();
  el('serviceDialogTitle').textContent = service.name;
  el('serviceDialogSub').textContent = 'code: ' + service.code + (service.port ? ' · port: ' + service.port : '') + ' · ' + service.tierLabel;
  fillForm(form, { id: service.id, cadence: service.cadence, load: service.load });

  const groupToggles = el('serviceGroupToggles');
  clear(groupToggles);
  data.groups.forEach((group) => {
    groupToggles.append(toggleItem(group.name, 'group', group.id, service.groupIds.includes(group.id), false));
  });
  const pcToggles = el('servicePcToggles');
  clear(pcToggles);
  data.pcs.forEach((pc) => {
    pcToggles.append(toggleItem(pc.name, 'pc', pc.id, (service.pcIds || []).includes(pc.id), false));
  });
  if (!data.pcs.length) pcToggles.append(make('span', 'chip subtle', 'PC 未登録'));

  dialog.showModal();
  form.onsubmit = async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    const groupIds = Array.from(groupToggles.querySelectorAll('input[name="group"]:checked')).map((input) => input.value);
    const pcIds = Array.from(pcToggles.querySelectorAll('input[name="pc"]:checked')).map((input) => input.value);
    try {
      await api('/services/' + encodeURIComponent(service.id), {
        method: 'PATCH',
        body: JSON.stringify({ groupIds, pcIds, cadence: values.cadence, load: values.load }),
      });
      dialog.close();
      toast('割当を保存しました');
      await load();
    } catch (error) { toast('保存失敗: ' + error.message); }
  };
}

// ---- 取得と全体描画 ----

function renderAll() {
  renderSyncStatus();
  renderStats();
  renderDomains();
  renderRoadmap();
  renderPlacement();
  renderPcs();
}

async function load() {
  const status = el('syncStatus');
  status.textContent = '読み込み中…';
  status.className = 'saved';
  try {
    state.data = await api('/overview');
    renderAll();
  } catch (error) {
    status.textContent = '読み込み失敗: ' + error.message;
    status.className = 'saved error';
  }
}

function setupToolbar() {
  const actions = el('toolbarActions');
  const reloadButton = make('button', 'button', '更新');
  reloadButton.type = 'button';
  reloadButton.addEventListener('click', load);
  actions.append(reloadButton);
  if (!IS_ADMIN) return;

  const syncButton = make('button', 'button', 'Excubitor 同期');
  syncButton.type = 'button';
  syncButton.addEventListener('click', async () => {
    try {
      const outcome = await api('/sync', { method: 'POST', body: '{}' });
      toast('同期完了 (' + (outcome.serviceCount || 0) + ' サービス)');
      await load();
    } catch (error) { toast('同期失敗: ' + error.message + (error.detail ? ' — ' + error.detail : '')); }
  });
  actions.append(syncButton);

  const generateButton = make('button', 'button primary', 'ロードマップ生成');
  generateButton.type = 'button';
  generateButton.addEventListener('click', async () => {
    try {
      await api('/roadmap/generate', { method: 'POST', body: '{}' });
      toast('ロードマップを生成しました');
      await load();
      switchTab('roadmap');
    } catch (error) { toast('生成失敗: ' + error.message); }
  });
  actions.append(generateButton);

  const domainButton = make('button', 'button', '+ ドメイン');
  domainButton.type = 'button';
  domainButton.addEventListener('click', () => openDomainDialog(null));
  actions.append(domainButton);

  const importButton = make('button', 'button', 'Villa 取り込み');
  importButton.type = 'button';
  importButton.addEventListener('click', () => el('importFile').click());
  actions.append(importButton);
  el('importFile').addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const body = JSON.parse(await file.text());
      const result = await api('/import/villa', { method: 'POST', body: JSON.stringify(body) });
      toast('取り込み完了: PC ' + result.pcs + ' / グループ ' + result.groups + ' / サービス ' + result.services);
      await load();
    } catch (error) { toast('取り込み失敗: ' + error.message); }
  });
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach((node) => node.classList.toggle('active', node.dataset.tab === tab));
  document.querySelectorAll('.view').forEach((node) => node.classList.add('hidden'));
  const view = el('view-' + tab);
  if (view) view.classList.remove('hidden');
  if (tab === 'placement') renderPlacement();
}

function setup() {
  el('tabs').addEventListener('click', (event) => {
    const target = event.target.closest('.tab');
    if (target) switchTab(target.dataset.tab);
  });
  el('searchInput').addEventListener('input', (event) => {
    state.query = event.target.value.trim();
    if (state.data) renderDomains();
  });
  el('stateFilters').addEventListener('click', (event) => {
    const target = event.target.closest('.chip-filter');
    if (!target) return;
    state.stateFilter = target.dataset.state;
    document.querySelectorAll('.chip-filter').forEach((node) => node.classList.toggle('active', node === target));
    if (state.data) renderDomains();
  });
  document.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => el(button.dataset.close).close());
  });
  window.addEventListener('resize', () => {
    if (HAS_MGMT && state.tab === 'placement') renderPlacement();
  });
  if (IS_ADMIN) {
    const tokenInput = el('adminToken');
    tokenInput.value = token();
    el('connectButton').addEventListener('click', () => {
      sessionStorage.setItem(TOKEN_KEY, tokenInput.value);
      load();
    });
    ['addGroupButton'].forEach((id) => { const b = el(id); if (b) b.addEventListener('click', () => openGroupDialog(null)); });
    ['addPcButton'].forEach((id) => { const b = el(id); if (b) b.addEventListener('click', () => openPcDialog(null)); });
  }
  setupToolbar();
  load();
}

setup();
`;
