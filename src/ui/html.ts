export const dashboardHtml = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Calliope Command Deck</title>
  <link rel="stylesheet" href="/assets/calliope.css">
</head>
<body>
  <header>
    <div><p class="eyebrow">MUSA PM ORCHESTRATOR</p><h1>Calliope Command Deck</h1></div>
    <div class="auth"><label>Service token <input id="token" type="password" autocomplete="off"></label><button id="save-token">接続</button></div>
  </header>
  <main>
    <section class="hero panel">
      <div><span class="pulse"></span><span id="status">接続待ち</span></div>
      <button id="refresh">更新</button>
    </section>
    <section id="summary" class="cards" aria-label="summary"></section>
    <section class="grid two">
      <article class="panel"><div class="heading"><h2>Active Plan</h2><button id="calendar-sync">Calendar同期</button></div><div id="plan"></div></article>
      <article class="panel"><h2>Decision Inbox</h2><div id="decisions"></div></article>
    </section>
    <section class="grid two">
      <article class="panel"><h2>Sprints</h2><div id="sprints"></div></article>
      <article class="panel"><h2>Velocity</h2><div id="velocity"></div></article>
    </section>
    <section class="grid two">
      <article class="panel"><h2>What-if / Reschedule</h2><label>Agent lanes <input id="lanes" type="number" min="1" max="64" value="3"></label><div class="actions"><button id="simulate">What-if</button><button id="reschedule" class="danger">Reschedule</button></div><pre id="simulation"></pre></article>
      <article class="panel"><div class="heading"><h2>Weekly Retrospective</h2><button id="send-weekly">Nuntius送信</button></div><div id="retrospective"></div></article>
    </section>
  </main>
  <template id="empty"><p class="muted">データなし</p></template>
  <script type="module" src="/assets/calliope.js"></script>
</body>
</html>`;
