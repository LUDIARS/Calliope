// サービスマップの見た目。Villa /map の light/dark 適応スタイルを継承しつつ、
// Calliope の一部としての落ち着いたトーンに寄せる。単一 CSS・外部依存なし。

export const serviceMapCss = `
:root {
  --ink: #19232d;
  --muted: #617181;
  --paper: #f5f8fa;
  --surface: #ffffff;
  --surface-soft: #edf4f6;
  --line: #d9e4e8;
  --accent: #176b87;
  --accent-soft: #d9f0f6;
  --green: #19735d;
  --green-soft: #d8f3e9;
  --amber: #9c6500;
  --amber-soft: #fff0c9;
  --rose: #a23c45;
  --rose-soft: #fce1e3;
  --shadow: 0 12px 34px rgba(31, 56, 72, .08);
  --radius: 18px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ink: #e8f0f4;
    --muted: #a7bbc5;
    --paper: #10191f;
    --surface: #17232b;
    --surface-soft: #1e313b;
    --line: #30454f;
    --accent: #62c6e4;
    --accent-soft: #143e4b;
    --green: #73d5b3;
    --green-soft: #153c35;
    --amber: #f3c968;
    --amber-soft: #4a3914;
    --rose: #f49ca4;
    --rose-soft: #4a2429;
    --shadow: 0 12px 34px rgba(0, 0, 0, .24);
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-width: 320px;
  color: var(--ink);
  background: var(--paper);
  font-family: "Yu Gothic UI", "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
  line-height: 1.55;
}
button, input, select, textarea { font: inherit; }
button { cursor: pointer; }
a { color: inherit; }
button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--accent) 45%, transparent);
  outline-offset: 2px;
}
.hidden { display: none !important; }
.shell { width: min(1380px, calc(100% - 32px)); margin: 0 auto; }

.masthead { padding: 34px 0 26px; border-bottom: 1px solid var(--line); }
.masthead-inner { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
.eyebrow { margin: 0 0 8px; color: var(--accent); font-size: .78rem; font-weight: 800; letter-spacing: .13em; }
h1 { margin: 0; font-size: clamp(1.7rem, 4vw, 2.8rem); line-height: 1.2; letter-spacing: -.045em; }
.lede { max-width: 54rem; margin: 12px 0 0; color: var(--muted); }
.header-tools { display: flex; align-items: end; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
.token-label { display: grid; gap: 4px; color: var(--muted); font-size: .78rem; font-weight: 700; }
.token-label input { min-height: 38px; padding: 7px 9px; border: 1px solid var(--line); border-radius: 9px; color: var(--ink); background: var(--surface); }
.top-link { color: var(--muted); font-size: .84rem; text-decoration: none; align-self: center; }
.top-link:hover { color: var(--accent); text-decoration: underline; }

main { padding: 26px 0 60px; }
.toolbar { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; margin: 0 0 22px; flex-wrap: wrap; }
.search-wrap { flex: 1 1 340px; display: grid; gap: 9px; }
#searchInput {
  width: 100%; min-height: 46px; padding: 10px 15px;
  border: 1px solid var(--line); border-radius: 13px;
  color: var(--ink); background: var(--surface); box-shadow: var(--shadow);
  font-size: .95rem;
}
.filter-row { display: flex; gap: 7px; flex-wrap: wrap; }
.chip-filter {
  min-height: 30px; padding: 3px 12px; border: 1px solid var(--line); border-radius: 999px;
  color: var(--muted); background: var(--surface); font-size: .78rem; font-weight: 750;
}
.chip-filter.active { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
.toolbar-side { display: grid; gap: 8px; justify-items: end; }
.saved { margin: 0; color: var(--muted); font-size: .82rem; }
.saved.error { color: var(--rose); }
.button-row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.button {
  min-height: 38px; padding: 7px 13px;
  border: 1px solid var(--line); border-radius: 10px;
  color: var(--ink); background: var(--surface); font-weight: 700; font-size: .86rem;
}
.button:hover { border-color: var(--accent); color: var(--accent); }
.button.primary { color: #fff; background: var(--accent); border-color: var(--accent); }
.button.primary:hover { filter: brightness(1.08); color: #fff; }
@media (prefers-color-scheme: dark) { .button.primary { color: #0c1519; } .button.primary:hover { color: #0c1519; } }
.button.danger { color: var(--rose); }
.button.small { min-height: 31px; padding: 4px 9px; font-size: .78rem; }

.stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(168px, 1fr)); gap: 12px; margin-bottom: 24px; }
.stat { padding: 16px 18px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow); }
.stat-label { display: block; color: var(--muted); font-size: .76rem; font-weight: 700; }
.stat-value { display: block; margin-top: 4px; color: var(--accent); font-size: 1.6rem; font-weight: 850; letter-spacing: -.04em; }
.stat-value.ok { color: var(--green); }
.stat-value.warn { color: var(--amber); }
.stat-note { display: block; margin-top: 2px; color: var(--muted); font-size: .74rem; }

.tabs { display: flex; gap: 6px; margin: 0 0 20px; border-bottom: 1px solid var(--line); }
.tab {
  padding: 9px 16px 11px; border: 0; border-bottom: 3px solid transparent;
  color: var(--muted); background: none; font-weight: 750; font-size: .92rem;
}
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }

.section-heading { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; margin: 30px 0 13px; }
.section-heading h2 { margin: 0; font-size: 1.18rem; letter-spacing: -.02em; }
.section-heading p { margin: 0; color: var(--muted); font-size: .84rem; }

.domain-grid { display: grid; gap: 16px; }
.domain-card {
  padding: 20px 22px; border: 1px solid var(--line); border-left: 5px solid var(--accent);
  border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow);
}
.domain-card.unassigned { border-left-color: var(--amber); }
.domain-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.domain-head h2 { margin: 0; font-size: 1.15rem; letter-spacing: -.02em; }
.domain-meta { color: var(--muted); font-size: .8rem; font-weight: 700; white-space: nowrap; }
.domain-note { margin: 4px 0 0; color: var(--muted); font-size: .84rem; }
.domain-groups { display: grid; gap: 12px; margin-top: 14px; }
.group-block h3 { margin: 0 0 7px; color: var(--muted); font-size: .78rem; letter-spacing: .08em; font-weight: 800; }
.service-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 9px; }
.service-card {
  display: grid; gap: 3px; padding: 11px 13px; text-align: left;
  border: 1px solid var(--line); border-radius: 12px; color: var(--ink); background: var(--surface-soft);
}
button.service-card:hover { border-color: var(--accent); }
.service-title { display: flex; align-items: center; gap: 7px; font-weight: 800; font-size: .88rem; }
.state-dot { flex: none; width: 9px; height: 9px; border-radius: 50%; background: var(--muted); opacity: .55; }
.state-dot.running { background: var(--green); opacity: 1; box-shadow: 0 0 0 3px color-mix(in srgb, var(--green) 22%, transparent); }
.state-dot.stopped { background: var(--rose); opacity: .8; }
.service-sub { color: var(--muted); font-size: .74rem; overflow-wrap: anywhere; }
.service-tags { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 4px; }
.tag { display: inline-flex; padding: 2px 7px; border-radius: 999px; color: var(--accent); background: var(--accent-soft); font-size: .68rem; font-weight: 800; }
.tag.state-running { color: var(--green); background: var(--green-soft); }
.tag.state-stopped { color: var(--rose); background: var(--rose-soft); }
.tag.state-unknown { color: var(--muted); background: var(--surface-soft); border: 1px solid var(--line); }
.tag.gone { color: var(--amber); background: var(--amber-soft); }
.empty { padding: 20px; border: 1px dashed var(--line); border-radius: 13px; color: var(--muted); font-size: .83rem; text-align: center; }

.roadmap-grid { display: grid; gap: 16px; }
.roadmap-note { padding: 13px 16px; border: 1px solid var(--accent-soft); border-radius: 13px; background: var(--accent-soft); font-size: .86rem; }
.roadmap-card { padding: 20px 22px; border: 1px solid var(--line); border-left: 5px solid var(--green); border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow); }
.roadmap-card h2 { margin: 0; font-size: 1.12rem; }
.roadmap-section { margin-top: 13px; }
.roadmap-section h3 { margin: 0 0 7px; color: var(--muted); font-size: .78rem; letter-spacing: .08em; font-weight: 800; }
.line-item { display: flex; align-items: baseline; gap: 9px; padding: 7px 0; border-bottom: 1px solid var(--line); font-size: .88rem; flex-wrap: wrap; }
.line-item:last-child { border-bottom: 0; }
.line-code { color: var(--accent); font-weight: 800; font-size: .76rem; white-space: nowrap; }
.line-repos { color: var(--muted); font-size: .74rem; }
.importance { display: inline-flex; padding: 1px 6px; border-radius: 999px; background: var(--amber-soft); color: var(--amber); font-size: .68rem; font-weight: 800; }
.priority-bar-row { display: grid; grid-template-columns: minmax(90px, 160px) 1fr auto; gap: 9px; align-items: center; padding: 4px 0; font-size: .82rem; }
.priority-track { height: 8px; border-radius: 999px; background: var(--surface-soft); overflow: hidden; }
.priority-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--accent), var(--green)); }
.priority-score { color: var(--muted); font-size: .74rem; font-variant-numeric: tabular-nums; }

.map-canvas {
  position: relative; display: grid;
  grid-template-columns: minmax(200px, 1fr) minmax(96px, 148px) minmax(200px, 1fr);
  gap: 16px; min-height: 288px; padding: 16px; overflow: hidden;
  border: 1px solid var(--line); border-radius: 22px;
  background: linear-gradient(135deg, var(--surface) 0%, var(--surface-soft) 100%);
  box-shadow: var(--shadow);
}
.map-canvas::before {
  position: absolute; inset: 0; z-index: 0; content: ""; opacity: .5;
  background-image: radial-gradient(var(--line) 1px, transparent 1px);
  background-size: 16px 16px; pointer-events: none;
}
.map-edges { position: absolute; inset: 0; z-index: 1; pointer-events: none; overflow: visible; }
.map-edge { fill: none; stroke: var(--accent); stroke-width: 1.6; opacity: .5; }
.map-endpoint { fill: var(--accent); opacity: .65; }
.map-hint { display: grid; place-content: center; text-align: center; color: var(--muted); font-size: .74rem; line-height: 1.5; }
.map-column { position: relative; z-index: 1; min-width: 0; }
.map-column h3 { margin: 3px 2px 10px; color: var(--muted); font-size: .75rem; letter-spacing: .1em; }
.node-stack { display: grid; gap: 10px; }
.map-node {
  position: relative; display: block; width: 100%; padding: 12px 13px;
  border: 1px solid var(--line); border-radius: 13px; color: var(--ink); text-align: left;
  background: var(--surface); box-shadow: 0 5px 16px rgba(30, 62, 76, .07);
}
.map-node:hover { border-color: var(--accent); transform: translateY(-1px); }
.node-name { display: block; font-weight: 800; font-size: .9rem; }
.node-detail { display: block; margin-top: 3px; color: var(--muted); font-size: .74rem; }

.group-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; }
.group-card {
  display: flex; flex-direction: column; padding: 17px 18px;
  border: 1px solid var(--line); border-left: 4px solid var(--accent);
  border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow);
}
.group-card.no-domain { border-left-color: var(--amber); }
.group-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.group-head h3 { margin: 0; font-size: 1rem; }
.group-count { color: var(--muted); font-size: .74rem; font-weight: 800; white-space: nowrap; }
.group-domain { margin: 3px 0 0; color: var(--muted); font-size: .78rem; }
.group-members { display: flex; gap: 5px; flex-wrap: wrap; margin: 11px 0 12px; max-height: 92px; overflow-y: auto; }
.chip { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; min-height: 23px; padding: 2px 9px; border-radius: 999px; color: var(--green); background: var(--green-soft); font-size: .72rem; font-weight: 750; }
.chip.subtle { color: var(--muted); background: var(--surface-soft); }
.group-actions { display: flex; gap: 7px; flex-wrap: wrap; margin-top: auto; }

.pc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
.pc-card { padding: 18px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow); }
.card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.card-top h3 { margin: 0; font-size: 1.02rem; letter-spacing: -.02em; }
.card-subtitle { margin: 3px 0 0; color: var(--muted); font-size: .8rem; }
.priority-badge { display: inline-flex; align-items: center; height: 25px; padding: 0 8px; border-radius: 999px; font-size: .72rem; font-weight: 800; }
.priority-badge.p-S { color: var(--rose); background: var(--rose-soft); }
.priority-badge.p-A { color: var(--amber); background: var(--amber-soft); }
.priority-badge.p-B { color: var(--green); background: var(--green-soft); }
.priority-badge.p-C { color: var(--muted); background: var(--surface-soft); }
.specs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 13px; margin: 15px 0; }
.specs dt { color: var(--muted); font-size: .68rem; font-weight: 700; }
.specs dd { margin: 2px 0 0; overflow-wrap: anywhere; font-size: .82rem; }
.card-actions { display: flex; justify-content: flex-end; gap: 7px; }

.dialog { width: min(680px, calc(100% - 24px)); max-height: calc(100dvh - 24px); padding: 0; border: 0; border-radius: 18px; color: var(--ink); background: var(--surface); box-shadow: 0 24px 65px rgba(0, 0, 0, .3); }
.dialog::backdrop { background: rgba(8, 18, 24, .58); backdrop-filter: blur(2px); }
.dialog form { padding: 22px; }
.dialog-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; margin-bottom: 16px; }
.dialog h2 { margin: 0; font-size: 1.2rem; }
.dialog p { margin: 5px 0 0; color: var(--muted); font-size: .82rem; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 13px; }
.form-grid .wide { grid-column: 1 / -1; }
.dialog-actions { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 20px; }
.dialog-actions .right { display: flex; gap: 8px; }
.icon-button { display: grid; width: 34px; height: 34px; padding: 0; place-items: center; border: 1px solid var(--line); border-radius: 9px; color: var(--muted); background: var(--surface); font-size: 1.05rem; }
select, input, textarea { width: 100%; border: 1px solid var(--line); border-radius: 9px; color: var(--ink); background: var(--surface); }
select, input { min-height: 38px; padding: 7px 9px; }
textarea { min-height: 78px; padding: 9px; resize: vertical; }
label { display: grid; gap: 5px; color: var(--muted); font-size: .78rem; font-weight: 700; }
.assign-block { margin: 15px 0 0; }
.assign-label { display: block; margin-bottom: 7px; color: var(--muted); font-size: .72rem; font-weight: 800; }
.toggle-list { display: flex; flex-wrap: wrap; gap: 5px; }
.toggle {
  display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px;
  border: 1px solid var(--line); border-radius: 999px;
  font-size: .74rem; font-weight: 700; cursor: pointer; user-select: none;
}
.toggle:has(input:checked) { border-color: var(--green); color: var(--green); }
.toggle input { width: auto; min-height: 0; margin: 0; cursor: pointer; }
.member-chips { display: flex; gap: 5px; flex-wrap: wrap; }

.toast { position: fixed; z-index: 5; right: 20px; bottom: 20px; max-width: min(370px, calc(100% - 40px)); padding: 11px 14px; border-radius: 10px; color: #fff; background: #1d3743; box-shadow: var(--shadow); font-size: .84rem; opacity: 0; transform: translateY(10px); pointer-events: none; transition: .2s ease; }
.toast.visible { opacity: 1; transform: translateY(0); }

@media (max-width: 820px) {
  .masthead-inner, .toolbar { flex-direction: column; align-items: stretch; }
  .header-tools, .button-row { justify-content: flex-start; }
  .toolbar-side { justify-items: start; }
  .stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .map-canvas { grid-template-columns: 1fr; }
}
@media (max-width: 520px) {
  .shell { width: min(100% - 22px, 1380px); }
  .form-grid { grid-template-columns: 1fr; }
  .form-grid .wide { grid-column: auto; }
  .dialog-actions { flex-direction: column-reverse; align-items: stretch; }
  .dialog-actions .right { justify-content: stretch; }
  .dialog-actions .right .button { flex: 1; }
}
`;
