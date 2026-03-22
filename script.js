(() => {
  "use strict";

  const STORAGE_PREFIX = "cia_min_";
  const STORAGE_KEYS = {
    settings: "settings",
    chat: "chat",
    prompts: "prompts",
    tasks: "tasks",
    notes: "notes",
    ui: "ui",
    sales: "sales"
  };
  const APP_CONFIG = (typeof window !== "undefined" && window.CENTRAL_IA_CONFIG) ? window.CENTRAL_IA_CONFIG : {};
  const DEFAULT_MODEL = String(APP_CONFIG.defaultModel || "deepseek-ai/deepseek-v3.2").trim() || "deepseek-ai/deepseek-v3.2";
  const LOCAL_PROXY_STREAM_ENDPOINT = "http://localhost:3000/api/chat-stream";
  const LOCAL_PROXY_ALT_STREAM_ENDPOINT = "http://127.0.0.1:3000/api/chat-stream";
  const DIRECT_API_HOST_HINTS = [
    "integrate.api.nvidia.com",
    "api.openai.com",
    "openrouter.ai",
    "api.anthropic.com",
    "generativelanguage.googleapis.com"
  ];

  const QUICK_AI_ACTIONS = [
    { label: "Gerar código", text: "Gere uma solução de código para: " },
    { label: "Explicar código", text: "Explique este código de forma objetiva: " },
    { label: "Criar copy", text: "Crie uma copy curta e forte para: " },
    { label: "Corrigir erro", text: "Analise este erro e entregue causa raiz + correção: " },
    { label: "Ideias de produto", text: "Liste 10 ideias de produto digital para: " }
  ];

  const CODE_ITEMS = [
    {
      id: "lang_html",
      type: "language",
      name: "HTML",
      preview: "<main><h1>Título</h1></main>",
      description: "Estrutura semântica para páginas web.",
      syntax: "<section>\n  <h2>Título</h2>\n  <p>Conteúdo</p>\n</section>",
      example: "<main class=\"container\">\n  <article>\n    <h1>Landing</h1>\n    <p>Mensagem principal.</p>\n  </article>\n</main>"
    },
    {
      id: "lang_css",
      type: "language",
      name: "CSS",
      preview: ".card { padding: 1rem; border-radius: 12px; }",
      description: "Estilo e layout responsivo.",
      syntax: "selector {\n  propriedade: valor;\n}",
      example: ":root { --accent: #06b87d; }\n.card {\n  border: 1px solid #2c3646;\n  border-radius: 12px;\n  padding: 1rem;\n}"
    },
    {
      id: "lang_js",
      type: "language",
      name: "JavaScript",
      preview: "const total = items.reduce((a, i) => a + i.valor, 0);",
      description: "Lógica de interface e automação.",
      syntax: "function executar(input) {\n  return input;\n}",
      example: "const form = document.querySelector('#form');\nform.addEventListener('submit', (event) => {\n  event.preventDefault();\n  console.log('enviado');\n});"
    },
    {
      id: "lang_python",
      type: "language",
      name: "Python",
      preview: "def run(data):\n    return data",
      description: "Scripts e automações rápidas.",
      syntax: "def nome_funcao(param):\n    return param",
      example: "def gerar_relatorio(vendas):\n    total = sum(vendas)\n    return {'total': total}\n\nprint(gerar_relatorio([10, 30, 50]))"
    },
    {
      id: "lang_node",
      type: "language",
      name: "Node.js",
      preview: "app.get('/health', (_req, res) => res.json({ ok: true }));",
      description: "APIs e backends em JavaScript.",
      syntax: "app.METHOD('/rota', (req, res) => { ... })",
      example: "import express from 'express';\nconst app = express();\napp.use(express.json());\napp.post('/leads', (req, res) => res.status(201).json(req.body));"
    },
    {
      id: "tag_form",
      type: "tag",
      name: "<form>",
      preview: "<form method=\"post\"><input required /></form>",
      description: "Agrupa campos para envio de dados.",
      syntax: "<form action=\"/rota\" method=\"post\">...</form>",
      example: "<form method=\"post\">\n  <label>Email</label>\n  <input type=\"email\" required />\n  <button type=\"submit\">Enviar</button>\n</form>"
    },
    {
      id: "tag_input",
      type: "tag",
      name: "<input>",
      preview: "<input type=\"text\" placeholder=\"Seu nome\" />",
      description: "Campo de entrada para formulários.",
      syntax: "<input type=\"text\" name=\"campo\" />",
      example: "<input type=\"password\" name=\"senha\" autocomplete=\"off\" />"
    },
    {
      id: "tag_section",
      type: "tag",
      name: "<section>",
      preview: "<section aria-label=\"Depoimentos\">...</section>",
      description: "Agrupa conteúdo relacionado por tema.",
      syntax: "<section id=\"bloco\">...</section>",
      example: "<section id=\"faq\">\n  <h2>Perguntas frequentes</h2>\n  <p>...</p>\n</section>"
    }
  ];

  function resolveDefaultEndpoint() {
    const configured = String(APP_CONFIG.apiEndpoint || "").trim();
    if (configured) {
      return configured;
    }

    const protocol = String(window.location?.protocol || "");
    const hostname = String(window.location?.hostname || "");
    const port = String(window.location?.port || "");
    const sameOriginStream = `${window.location.origin}/api/chat-stream`;

    if (protocol === "http:" || protocol === "https:") {
      if (!isLocalHostName(hostname) && hostname.endsWith("github.io")) {
        return "";
      }

      // Em preview local (ex.: Live Server na 5500), o backend real costuma rodar na 3000.
      if (isLocalHostName(hostname) && port && port !== "3000") {
        return LOCAL_PROXY_STREAM_ENDPOINT;
      }

      return sameOriginStream;
    }

    return LOCAL_PROXY_STREAM_ENDPOINT;
  }

  function isLocalHostName(hostname) {
    const value = String(hostname || "").toLowerCase();
    return value === "localhost" || value === "127.0.0.1" || value === "::1";
  }

  function normalizeEndpoint(rawEndpoint) {
    const endpoint = String(rawEndpoint || "").trim();
    if (!endpoint) {
      return "";
    }

    const explicitProtocol = endpoint.match(/^([a-z][a-z0-9+.-]*):\/\//i);
    if (explicitProtocol) {
      const proto = explicitProtocol[1].toLowerCase();
      if (proto !== "http" && proto !== "https") {
        return "";
      }
    }

    const localWithoutScheme = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(\/.*)?$/i.test(endpoint);
    if (localWithoutScheme) {
      return normalizeEndpoint(`http://${endpoint}`);
    }

    const domainWithoutScheme = /^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(\/.*)?$/i.test(endpoint);
    if (!endpoint.includes("://") && domainWithoutScheme) {
      return normalizeEndpoint(`https://${endpoint}`);
    }

    const normalizePath = (pathname) => {
      const clean = String(pathname || "/").replace(/\/+$/, "") || "/";
      if (/\/api\/chat$/i.test(clean)) {
        return clean.replace(/\/api\/chat$/i, "/api/chat");
      }
      if (/\/api\/chat-stream$/i.test(clean)) {
        return clean.replace(/\/api\/chat-stream$/i, "/api/chat-stream");
      }
      return clean;
    };

    if (endpoint.startsWith("/")) {
      const relativePath = normalizePath(endpoint);
      return relativePath === "/" ? "/api/chat-stream" : relativePath;
    }

    try {
      const parsed = new URL(endpoint);
      const host = String(parsed.hostname || "").toLowerCase();
      const likelyDirectByHost = DIRECT_API_HOST_HINTS.some((hint) => host.includes(hint));

      let pathname = normalizePath(parsed.pathname);
      const likelyDirectByPath = /\/chat\/completions|\/responses|\/v[0-9]+\//i.test(pathname);

      if (pathname === "/" && !likelyDirectByHost && !likelyDirectByPath) {
        pathname = "/api/chat-stream";
      }

      parsed.pathname = pathname;
      return parsed.toString();
    } catch (_error) {
      const fallback = normalizePath(endpoint);
      return fallback === "/" ? "/api/chat-stream" : fallback;
    }
  }

  function uniqueStrings(values) {
    const seen = new Set();
    return values.filter((value) => {
      const key = String(value || "").trim();
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  function parseUrlSafe(raw, base) {
    try {
      return new URL(String(raw || "").trim(), base || window.location.origin);
    } catch (_error) {
      return null;
    }
  }

  function detectUnsupportedProtocol(rawEndpoint) {
    const value = String(rawEndpoint || "").trim();
    if (!value) {
      return "";
    }

    const match = value.match(/^([a-z][a-z0-9+.-]*):\/\//i);
    if (!match) {
      return "";
    }

    const proto = String(match[1] || "").toLowerCase();
    if (proto === "http" || proto === "https") {
      return "";
    }

    return proto;
  }

  function portFromUrl(urlObj) {
    if (!urlObj) {
      return "";
    }
    if (urlObj.port) {
      return String(urlObj.port);
    }
    return urlObj.protocol === "https:" ? "443" : "80";
  }

  function isLikelyStaticLocalProxyPath(endpoint) {
    const parsed = parseUrlSafe(endpoint, window.location.origin);
    if (!parsed || !isLocalHostName(parsed.hostname || "")) {
      return false;
    }

    const path = String(parsed.pathname || "").replace(/\/+$/, "");
    if (!/\/api\/chat(?:-stream)?$/i.test(path)) {
      return false;
    }

    const targetPort = portFromUrl(parsed);
    return targetPort !== "3000";
  }

  function localProxyFallbackCandidates(endpoint) {
    const pageHost = String(window.location.hostname || "").toLowerCase();
    if (!isLocalHostName(pageHost)) {
      return [];
    }

    if (!isLikelyStaticLocalProxyPath(endpoint)) {
      return [];
    }

    return uniqueStrings([
      LOCAL_PROXY_STREAM_ENDPOINT,
      LOCAL_PROXY_ALT_STREAM_ENDPOINT
    ].map((value) => normalizeEndpoint(value)));
  }

  function enforceEndpointForRuntime(rawEndpoint) {
    const endpoint = normalizeEndpoint(rawEndpoint || resolveDefaultEndpoint());
    if (!endpoint) {
      return "";
    }

    const pageHost = String(window.location.hostname || "").toLowerCase();
    const isHostedPage = !isLocalHostName(pageHost) && (window.location.protocol === "http:" || window.location.protocol === "https:");

    // Em produção, nunca usar endpoint local salvo de sessões anteriores.
    if (isHostedPage && isLocalEndpoint(endpoint)) {
      return normalizeEndpoint(`${window.location.origin}/api/chat-stream`);
    }

    // Em preview local estático (5500/5173/etc), prioriza backend da porta 3000.
    if (isLikelyStaticLocalProxyPath(endpoint)) {
      return LOCAL_PROXY_STREAM_ENDPOINT;
    }

    return endpoint;
  }

  function autoRepairEndpointIfNeeded() {
    const current = normalizeEndpoint(state.settings.apiEndpoint || "");
    const fallback = resolveDefaultEndpoint();
    const repaired = enforceEndpointForRuntime(current || fallback);

    if (repaired && repaired !== current) {
      state.settings.apiEndpoint = repaired;
      saveSlice("settings", state.settings);
    }
  }

  function sameOriginProxyCandidates() {
    const pageHost = String(window.location.hostname || "").toLowerCase();
    const pagePort = String(window.location.port || "");
    if (isLocalHostName(pageHost) && pagePort && pagePort !== "3000") {
      return [];
    }

    const candidates = [];

    try {
      candidates.push(new URL("/api/chat-stream", window.location.origin).toString());
    } catch (_error) {
      // ignore
    }

    try {
      candidates.push(new URL("./api/chat-stream", window.location.href).toString());
    } catch (_error) {
      // ignore
    }

    try {
      candidates.push(new URL("api/chat-stream", window.location.href).toString());
    } catch (_error) {
      // ignore
    }

    return uniqueStrings(candidates.map((value) => normalizeEndpoint(value)));
  }

  function buildProxyAttemptPlan(rawEndpoint) {
    const endpoint = normalizeEndpoint(rawEndpoint);
    const baseCandidates = uniqueStrings([
      endpoint,
      ...sameOriginProxyCandidates(),
      ...localProxyFallbackCandidates(endpoint)
    ]);
    const attempts = [];
    const seen = new Set();

    const pushAttempt = (mode, target) => {
      const normalizedTarget = normalizeEndpoint(target);
      if (!normalizedTarget) {
        return;
      }

      const id = `${mode}::${normalizedTarget}`;
      if (seen.has(id)) {
        return;
      }

      seen.add(id);
      attempts.push({ mode, endpoint: normalizedTarget });
    };

    baseCandidates.forEach((candidate) => {
      if (candidate.includes("/api/chat-stream")) {
        pushAttempt("stream", candidate);
        pushAttempt("json", candidate.replace("/api/chat-stream", "/api/chat"));
        return;
      }

      if (candidate.includes("/api/chat")) {
        pushAttempt("json", candidate);
        pushAttempt("stream", candidate.replace("/api/chat", "/api/chat-stream"));
        return;
      }

      pushAttempt("stream", `${candidate.replace(/\/+$/, "")}/api/chat-stream`);
      pushAttempt("json", `${candidate.replace(/\/+$/, "")}/api/chat`);
    });

    return attempts;
  }

  function defaultSettings() {
    return {
      theme: "dark",
      userName: "Profissional",
      apiKey: "",
      apiModel: DEFAULT_MODEL,
      apiEndpoint: resolveDefaultEndpoint()
    };
  }

  function defaultPrompts() {
    return [
      {
        id: uid("prompt"),
        title: "Debug rápido",
        content: "Analise este erro e devolva causa raiz + correção + validação.",
        updatedAt: nowISO()
      }
    ];
  }

  function defaultTasks() {
    return [
      {
        id: uid("task"),
        title: "Finalizar entrega principal",
        date: todayISO(),
        done: false,
        updatedAt: nowISO()
      }
    ];
  }

  function defaultNotes() {
    return [
      {
        id: uid("note"),
        title: "Prioridade da semana",
        content: "Aumentar saída de conteúdo e manter rotina de vendas diária.",
        updatedAt: nowISO()
      }
    ];
  }

  function defaultUI() {
    return {
      section: "dashboard",
      sidebarCollapsed: false,
      taskFilter: "all",
      codeFilter: "all"
    };
  }

  function defaultState() {
    return {
      settings: defaultSettings(),
      chat: [],
      prompts: defaultPrompts(),
      tasks: defaultTasks(),
      notes: defaultNotes(),
      ui: defaultUI(),
      salesOutput: "Preencha os campos e clique em um gerador."
    };
  }

  let state = loadState();
  let chatLoading = false;
  let chatAbortController = null;

  const dom = {
    body: q("body"),
    mobileMenuBtn: q("#mobileMenuBtn"),
    sidebarCollapseBtn: q("#sidebarCollapseBtn"),
    sidebarNav: q("#sidebarNav"),
    navItems: qa("#sidebarNav .nav-item"),
    views: qa(".view"),
    quickActionBtn: q("#quickActionBtn"),
    welcomeLine: q("#welcomeLine"),

    globalSearchInput: q("#globalSearchInput"),
    globalSearchResults: q("#globalSearchResults"),

    dashTodayTasks: q("#dashTodayTasks"),
    dashLatestPrompts: q("#dashLatestPrompts"),
    dashLatestNotes: q("#dashLatestNotes"),

    aiStatus: q("#aiStatus"),
    aiQuickActions: q("#aiQuickActions"),
    chatMessages: q("#chatMessages"),
    chatForm: q("#chatForm"),
    chatInput: q("#chatInput"),
    sendChatBtn: q("#sendChatBtn"),
    clearChatBtn: q("#clearChatBtn"),

    codeSearchInput: q("#codeSearchInput"),
    codeFilterBar: q("#codeFilterBar"),
    codeCards: q("#codeCards"),
    codeModal: q("#codeModal"),
    closeCodeModal: q("#closeCodeModal"),
    codeModalTitle: q("#codeModalTitle"),
    codeModalDescription: q("#codeModalDescription"),
    codeModalSyntax: q("#codeModalSyntax"),
    codeModalExample: q("#codeModalExample"),

    salesForm: q("#salesForm"),
    salesProductInput: q("#salesProductInput"),
    salesAudienceInput: q("#salesAudienceInput"),
    salesProblemInput: q("#salesProblemInput"),
    salesOutput: q("#salesOutput"),
    copySalesBtn: q("#copySalesBtn"),

    promptForm: q("#promptForm"),
    promptId: q("#promptId"),
    promptTitle: q("#promptTitle"),
    promptContent: q("#promptContent"),
    promptSearchInput: q("#promptSearchInput"),
    promptsList: q("#promptsList"),

    taskForm: q("#taskForm"),
    taskId: q("#taskId"),
    taskTitle: q("#taskTitle"),
    taskDate: q("#taskDate"),
    taskFilterBar: q("#taskFilterBar"),
    tasksList: q("#tasksList"),

    noteForm: q("#noteForm"),
    noteId: q("#noteId"),
    noteTitle: q("#noteTitle"),
    noteContent: q("#noteContent"),
    noteSearchInput: q("#noteSearchInput"),
    notesList: q("#notesList"),

    settingsForm: q("#settingsForm"),
    settingsUserName: q("#settingsUserName"),
    settingsTheme: q("#settingsTheme"),
    settingsApiModel: q("#settingsApiModel"),
    settingsApiEndpoint: q("#settingsApiEndpoint"),
    exportBtn: q("#exportBtn"),
    importBtn: q("#importBtn"),
    clearDataBtn: q("#clearDataBtn"),
    importFileInput: q("#importFileInput"),
    storageMetaText: q("#storageMetaText"),

    toastContainer: q("#toastContainer")
  };

  init();

  function init() {
    applyTheme(state.settings.theme);
    applySidebarState();
    setWelcomeLine();
    bindEvents();
    renderAiQuickActions();
    autoRepairEndpointIfNeeded();
    hydrateSettings();
    renderAll();
    setSection(state.ui.section || "dashboard", false);
  }

  function bindEvents() {
    dom.sidebarNav.addEventListener("click", onSidebarClick);

    dom.mobileMenuBtn.addEventListener("click", () => {
      dom.body.classList.toggle("sidebar-open");
    });

    dom.sidebarCollapseBtn.addEventListener("click", () => {
      state.ui.sidebarCollapsed = !state.ui.sidebarCollapsed;
      saveSlice("ui", state.ui);
      applySidebarState();
    });

    dom.quickActionBtn.addEventListener("click", () => {
      setSection("assistant", true);
      dom.chatInput.focus();
    });

    document.addEventListener("click", (event) => {
      const openButton = event.target.closest("[data-open]");
      if (openButton) {
        setSection(openButton.dataset.open, true);
      }

      if (!event.target.closest(".search-wrap")) {
        hideGlobalSearch();
      }

      if (window.innerWidth <= 960) {
        if (!event.target.closest("#sidebar") && !event.target.closest("#mobileMenuBtn")) {
          dom.body.classList.remove("sidebar-open");
        }
      }
    });

    dom.globalSearchInput.addEventListener("input", onGlobalSearchInput);
    dom.globalSearchResults.addEventListener("click", onGlobalSearchSelect);

    dom.aiQuickActions.addEventListener("click", onAiQuickActionClick);
    dom.chatForm.addEventListener("submit", onChatSubmit);
    dom.clearChatBtn.addEventListener("click", onClearChat);

    dom.codeSearchInput.addEventListener("input", renderCodeCards);
    dom.codeFilterBar.addEventListener("click", onCodeFilterClick);
    dom.codeCards.addEventListener("click", onCodeCardAction);

    dom.closeCodeModal.addEventListener("click", closeCodeModal);
    dom.codeModal.addEventListener("click", (event) => {
      if (event.target === dom.codeModal) {
        closeCodeModal();
      }
    });

    dom.salesForm.addEventListener("click", onSalesActionClick);
    dom.copySalesBtn.addEventListener("click", () => copyText(state.salesOutput, "Texto copiado."));

    dom.promptForm.addEventListener("submit", onPromptSubmit);
    dom.promptSearchInput.addEventListener("input", renderPrompts);
    dom.promptsList.addEventListener("click", onPromptActionClick);

    dom.taskForm.addEventListener("submit", onTaskSubmit);
    dom.taskFilterBar.addEventListener("click", onTaskFilterClick);
    dom.tasksList.addEventListener("click", onTaskActionClick);
    dom.tasksList.addEventListener("change", onTaskToggle);

    dom.noteForm.addEventListener("submit", onNoteSubmit);
    dom.noteSearchInput.addEventListener("input", renderNotes);
    dom.notesList.addEventListener("click", onNoteActionClick);

    dom.settingsForm.addEventListener("submit", onSettingsSubmit);
    dom.exportBtn.addEventListener("click", exportData);
    dom.importBtn.addEventListener("click", () => dom.importFileInput.click());
    dom.importFileInput.addEventListener("change", importData);
    dom.clearDataBtn.addEventListener("click", clearAllData);

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        hideGlobalSearch();
        closeCodeModal();
        dom.body.classList.remove("sidebar-open");
      }
    });
  }

  function renderAll() {
    renderDashboard();
    renderChat();
    renderCodeCards();
    renderSales();
    renderPrompts();
    renderTasks();
    renderNotes();
    renderApiStatus();
    updateStorageMeta();
  }

  function onSidebarClick(event) {
    const button = event.target.closest("button[data-section]");
    if (!button) {
      return;
    }
    setSection(button.dataset.section, true);
  }

  function setSection(sectionId, track = true) {
    const exists = dom.views.some((view) => view.id === sectionId);
    if (!exists) {
      return;
    }

    dom.views.forEach((view) => view.classList.toggle("active", view.id === sectionId));
    dom.navItems.forEach((item) => item.classList.toggle("active", item.dataset.section === sectionId));

    if (track) {
      state.ui.section = sectionId;
      saveSlice("ui", state.ui);
    }

    dom.body.classList.remove("sidebar-open");
  }

  function applySidebarState() {
    dom.body.classList.toggle("sidebar-collapsed", Boolean(state.ui.sidebarCollapsed));
  }

  function applyTheme(theme) {
    const finalTheme = theme === "light" ? "light" : "dark";
    dom.body.dataset.theme = finalTheme;
  }

  function setWelcomeLine() {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
    dom.welcomeLine.textContent = `${greeting}, ${state.settings.userName || "Profissional"}. Foque no essencial.`;
  }

  function onGlobalSearchInput() {
    const query = dom.globalSearchInput.value.trim().toLowerCase();
    if (query.length < 2) {
      hideGlobalSearch();
      return;
    }

    const index = buildGlobalSearchIndex();
    const results = index.filter((item) => `${item.title} ${item.meta}`.toLowerCase().includes(query)).slice(0, 12);

    if (!results.length) {
      dom.globalSearchResults.innerHTML = `<button class="search-item" type="button"><strong>Sem resultados</strong><span>Tente outro termo</span></button>`;
      dom.globalSearchResults.classList.remove("hidden");
      return;
    }

    dom.globalSearchResults.innerHTML = results
      .map(
        (item) => `<button class="search-item" type="button" data-section="${item.section}" data-query="${escapeAttr(query)}"><strong>${escapeHTML(item.title)}</strong><span>${escapeHTML(item.meta)}</span></button>`
      )
      .join("");

    dom.globalSearchResults.classList.remove("hidden");
  }

  function onGlobalSearchSelect(event) {
    const button = event.target.closest("button[data-section]");
    if (!button) {
      return;
    }

    setSection(button.dataset.section, true);
    applySearchToSection(button.dataset.section, button.dataset.query || "");
    hideGlobalSearch();
  }

  function hideGlobalSearch() {
    dom.globalSearchResults.classList.add("hidden");
  }

  function buildGlobalSearchIndex() {
    return [
      ...dom.navItems.map((item) => ({ title: item.dataset.label || item.textContent || "Seção", meta: "Menu", section: item.dataset.section })),
      ...state.tasks.map((task) => ({ title: task.title, meta: "Tarefa", section: "tasks" })),
      ...state.prompts.map((prompt) => ({ title: prompt.title, meta: "Prompt", section: "prompts" })),
      ...state.notes.map((note) => ({ title: note.title, meta: "Nota", section: "notes" })),
      ...CODE_ITEMS.map((item) => ({ title: item.name, meta: item.type === "language" ? "Linguagem" : "Tag HTML", section: "code" }))
    ];
  }

  function applySearchToSection(section, query) {
    if (!query) {
      return;
    }

    if (section === "code") {
      dom.codeSearchInput.value = query;
      renderCodeCards();
    }

    if (section === "prompts") {
      dom.promptSearchInput.value = query;
      renderPrompts();
    }

    if (section === "notes") {
      dom.noteSearchInput.value = query;
      renderNotes();
    }
  }

  function renderDashboard() {
    const today = todayISO();
    const todayTasks = state.tasks.filter((task) => !task.done && (task.date === today || !task.date)).slice(0, 5);
    const latestPrompts = [...state.prompts].sort((a, b) => sortDateDesc(a.updatedAt, b.updatedAt)).slice(0, 5);
    const latestNotes = [...state.notes].sort((a, b) => sortDateDesc(a.updatedAt, b.updatedAt)).slice(0, 5);

    renderSimpleList(dom.dashTodayTasks, todayTasks.map((task) => ({ title: task.title, subtitle: task.date ? fmtDate(task.date) : "Sem data" })), "Sem tarefas para hoje.");
    renderSimpleList(dom.dashLatestPrompts, latestPrompts.map((prompt) => ({ title: prompt.title, subtitle: trimText(prompt.content, 64) })), "Sem prompts salvos.");
    renderSimpleList(dom.dashLatestNotes, latestNotes.map((note) => ({ title: note.title, subtitle: trimText(note.content, 64) })), "Sem notas recentes.");
  }

  function renderSimpleList(container, items, emptyText) {
    if (!items.length) {
      container.innerHTML = `<li>${escapeHTML(emptyText)}</li>`;
      return;
    }

    container.innerHTML = items
      .map((item) => `<li><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.subtitle || "")}</small></li>`)
      .join("");
  }

  function renderAiQuickActions() {
    dom.aiQuickActions.innerHTML = QUICK_AI_ACTIONS.map(
      (action) => `<button type="button" class="chip" data-ai-quick="${escapeAttr(action.text)}">${escapeHTML(action.label)}</button>`
    ).join("");
  }

  function onAiQuickActionClick(event) {
    const button = event.target.closest("button[data-ai-quick]");
    if (!button) {
      return;
    }

    dom.chatInput.value = button.dataset.aiQuick || "";
    dom.chatInput.focus();
  }

  function renderApiStatus() {
    const rawCandidate = state.settings.apiEndpoint || resolveDefaultEndpoint();
    const unsupportedProtocol = detectUnsupportedProtocol(rawCandidate);
    const endpoint = enforceEndpointForRuntime(rawCandidate);
    const pageHost = String(window.location.hostname || "").toLowerCase();
    const hostedPage = (window.location.protocol === "https:" || window.location.protocol === "http:") && !isLocalHostName(pageHost);
    const endpointIsLocal = isLocalEndpoint(endpoint);

    dom.aiStatus.className = "status";

    if (unsupportedProtocol) {
      dom.aiStatus.classList.add("warn");
      dom.aiStatus.textContent = `Endpoint inválido: ${unsupportedProtocol}:// não é API HTTP.`;
      return;
    }

    if (!endpoint) {
      dom.aiStatus.classList.add("warn");
      dom.aiStatus.textContent = "Conexão IA indisponível no momento.";
      return;
    }

    if (isLikelyStaticLocalProxyPath(endpoint)) {
      dom.aiStatus.classList.add("warn");
      dom.aiStatus.textContent = "Preview local detectado. Rode o backend em http://localhost:3000.";
      return;
    }

    if (hostedPage && endpointIsLocal) {
      dom.aiStatus.classList.add("warn");
      dom.aiStatus.textContent = "Endpoint local detectado. Em site publicado, use backend público.";
      return;
    }

    if (pageHost.endsWith("github.io") && endpoint.startsWith("/")) {
      dom.aiStatus.classList.add("warn");
      dom.aiStatus.textContent = "Backend público não configurado para GitHub Pages.";
      return;
    }

    if (endpoint.includes("/api/chat-stream")) {
      dom.aiStatus.classList.add("ok");
      dom.aiStatus.textContent = `Proxy streaming ativo (chave no servidor) • ${state.settings.apiModel || DEFAULT_MODEL}`;
      return;
    }

    if (endpoint.includes("/api/chat")) {
      dom.aiStatus.classList.add("ok");
      dom.aiStatus.textContent = `Proxy ativo (chave no servidor) • ${state.settings.apiModel || DEFAULT_MODEL}`;
      return;
    }

    dom.aiStatus.classList.add("warn");
    dom.aiStatus.textContent = "Conexão IA indisponível. Verifique o backend/proxy.";
  }

  function onChatSubmit(event) {
    event.preventDefault();
    if (chatLoading) {
      return;
    }

    const text = dom.chatInput.value.trim();
    if (!text) {
      return;
    }

    appendChat("user", text);
    dom.chatInput.value = "";
    askAssistant(text);
  }

  async function askAssistant(text) {
    setChatLoading(true);
    const assistantId = createAssistantDraft();

    try {
      const response = await getAssistantResponse(text, {
        onChunk: (fullText) => updateAssistantDraft(assistantId, fullText)
      });
      finalizeAssistantDraft(assistantId, response);
    } catch (error) {
      if (String(error.message || "").includes("Resposta interrompida")) {
        const currentDraft = state.chat.find((entry) => entry.id === assistantId);
        const partial = String(currentDraft?.content || "").trim();
        finalizeAssistantDraft(assistantId, partial || "Resposta interrompida.");
        return;
      }
      finalizeAssistantDraft(assistantId, `Falha ao gerar resposta.\n\n${error.message}`);
    } finally {
      chatAbortController = null;
      setChatLoading(false);
    }
  }

  function setChatLoading(loading) {
    chatLoading = loading;
    dom.sendChatBtn.disabled = loading;
    dom.sendChatBtn.textContent = loading ? "Gerando..." : "Enviar";
    dom.clearChatBtn.textContent = loading ? "Parar" : "Limpar";
    dom.chatInput.disabled = loading;
    renderChat();
  }

  function appendChat(role, content, options = {}) {
    state.chat.push({ id: uid("chat"), role, content, createdAt: nowISO(), streaming: Boolean(options.streaming) });
    state.chat = state.chat.slice(-120);
    if (!options.skipSave) {
      saveSlice("chat", state.chat);
    }
    renderChat();
  }

  function createAssistantDraft() {
    const draft = { id: uid("chat"), role: "assistant", content: "", createdAt: nowISO(), streaming: true };
    state.chat.push(draft);
    state.chat = state.chat.slice(-120);
    renderChat();
    return draft.id;
  }

  function updateAssistantDraft(messageId, content) {
    const target = state.chat.find((item) => item.id === messageId);
    if (!target) {
      return;
    }

    target.content = content;
    renderChat();
  }

  function finalizeAssistantDraft(messageId, content) {
    const target = state.chat.find((item) => item.id === messageId);
    if (!target) {
      appendChat("assistant", content || "Sem resposta.");
      return;
    }

    target.content = String(content || "").trim() || "Sem resposta.";
    target.streaming = false;
    saveSlice("chat", state.chat);
    renderChat();
  }

  function renderChat() {
    if (!state.chat.length && !chatLoading) {
      dom.chatMessages.innerHTML = `<div class="chat-empty">Comece uma conversa com a IA para organizar seu trabalho.</div>`;
      return;
    }

    const historyHtml = state.chat
      .map((message) => {
        const who = message.role === "assistant" ? "IA" : "Você";
        const copyButton = message.role === "assistant" && !message.streaming
          ? `<button class="mini-btn" type="button" data-copy-chat="${message.id}">Copiar</button>`
          : "";
        const bubbleText = message.content || (message.streaming ? "Gerando resposta..." : "");
        const streamClass = message.streaming ? " streaming" : "";

        return `<article class="msg ${message.role}${streamClass}">
          <div class="msg-bubble">${escapeHTML(bubbleText)}</div>
          <div class="msg-meta">${who} • ${message.streaming ? "digitando..." : fmtDateTime(message.createdAt)} ${copyButton}</div>
        </article>`;
      })
      .join("");

    dom.chatMessages.innerHTML = historyHtml;
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;

    dom.chatMessages.querySelectorAll("[data-copy-chat]").forEach((button) => {
      button.addEventListener("click", () => {
        const item = state.chat.find((entry) => entry.id === button.dataset.copyChat);
        if (item) {
          copyText(item.content, "Resposta copiada.");
        }
      });
    });
  }

  function onClearChat() {
    if (chatLoading && chatAbortController) {
      chatAbortController.abort();
      toast("Geração interrompida.", "success");
      return;
    }

    if (!state.chat.length) {
      return;
    }

    if (!window.confirm("Limpar todo o histórico do chat?")) {
      return;
    }

    state.chat = [];
    saveSlice("chat", state.chat);
    renderChat();
    toast("Chat limpo.", "success");
  }

  async function getAssistantResponse(userText, handlers = {}) {
    const endpoint = enforceEndpointForRuntime(state.settings.apiEndpoint || resolveDefaultEndpoint());
    const recentMessages = state.chat
      .filter((entry) => !entry.streaming)
      .slice(-8)
      .map((entry) => ({ role: entry.role, content: entry.content }));
    const useProxy = endpoint.includes("/api/chat");

    if (!endpoint) {
      throw new Error("Conexão IA indisponível no momento.");
    }

    if (window.location.hostname.endsWith("github.io") && endpoint.startsWith("/")) {
      throw new Error("Backend público ainda não configurado para este site.");
    }

    chatAbortController = new AbortController();
    const timeout = setTimeout(() => chatAbortController.abort(), 140000);

    try {
      const proxyApiKey = "";
      const payload = {
        message: userText,
        history: recentMessages,
        model: state.settings.apiModel || DEFAULT_MODEL,
        apiKey: useProxy ? proxyApiKey : "",
        temperature: 0.7,
        top_p: 0.95,
        max_tokens: 2048,
        seed: 42,
        thinking: false
      };

      if (useProxy) {
        const attempts = buildProxyAttemptPlan(endpoint);
        const errors = [];

        for (const attempt of attempts) {
          try {
            if (attempt.mode === "stream") {
              return await requestViaProxyStream(attempt.endpoint, payload, handlers.onChunk, chatAbortController.signal);
            }

            return await requestViaProxyJson(attempt.endpoint, payload, chatAbortController.signal);
          } catch (attemptError) {
            if (attemptError.name === "AbortError") {
              throw attemptError;
            }
            errors.push(`${attempt.mode.toUpperCase()} ${attempt.endpoint} -> ${attemptError.message}`);
          }
        }

        const finalSummary = trimText(errors.join(" | "), 420);
        if (finalSummary) {
          console.warn("[Central IA] Falha nas tentativas de proxy:", finalSummary);
        }
        throw new Error(finalSummary || "Sem resposta válida do proxy.");
      }

      throw new Error("Endpoint inválido para este app. Use backend com /api/chat-stream.");
    } catch (error) {
      const rawMessage = String(error?.message || "");

      if (error.name === "AbortError") {
        throw new Error("Resposta interrompida.");
      }

      throw new Error(toFriendlyAiError(rawMessage, endpoint));
    } finally {
      clearTimeout(timeout);
    }
  }

  function toFriendlyAiError(rawMessage, endpoint) {
    const message = String(rawMessage || "").trim();
    const localEndpoint = isLocalEndpoint(endpoint) || isLikelyStaticLocalProxyPath(endpoint);

    if (/API key não configurada|NVIDIA_API_KEY/i.test(message)) {
      return "Servidor IA sem chave configurada. Ajuste a variável NVIDIA_API_KEY no backend.";
    }

    if (/Unauthorized|Authentication failed|HTTP 401/i.test(message)) {
      return "Servidor IA sem autorização no provedor. Verifique a chave configurada no backend.";
    }

    if (/HTTP 404/i.test(message)) {
      return "Endpoint da IA não encontrado no servidor.";
    }

    if (/HTTP 405/i.test(message)) {
      return "Endpoint da IA inválido. O backend precisa aceitar POST em /api/chat-stream.";
    }

    if (/HTTP 5\d\d/i.test(message)) {
      return "Servidor IA indisponível no momento. Tente novamente em instantes.";
    }

    if (/Failed to fetch|NetworkError|ECONNREFUSED|ENOTFOUND|ERR_CONNECTION_REFUSED|Load failed/i.test(message)) {
      if (localEndpoint) {
        return "Backend local offline. Rode \"node server.js\" e tente novamente.";
      }
      return "Não foi possível conectar ao servidor de IA agora.";
    }

    if (/tempo limite|timeout|timed out/i.test(message)) {
      return "A IA demorou para responder. Tente novamente em alguns segundos.";
    }

    if (/Resposta vazia/i.test(message)) {
      return "A IA retornou resposta vazia. Tente novamente.";
    }

    return "Não foi possível gerar resposta agora. Tente novamente.";
  }

  async function requestViaProxyJson(endpoint, payload, signal) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload),
      signal
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${trimText(text, 220)}`);
    }

    const data = await response.json();
    const answer = String(data.answer || "").trim();
    if (!answer) {
      throw new Error("Resposta vazia do proxy.");
    }

    return answer;
  }

  async function requestViaDirectApi(endpoint, userText, history, apiKey, signal) {
    if (!apiKey) {
      throw new Error("Informe uma API key ou use um endpoint de proxy.");
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: state.settings.apiModel || DEFAULT_MODEL,
        messages: [
          { role: "system", content: "Você é um assistente prático e objetivo para produtividade profissional." },
          ...history,
          { role: "user", content: userText }
        ],
        temperature: 0.7,
        top_p: 0.95,
        max_tokens: 2048,
        seed: 42,
        stream: false,
        chat_template_kwargs: { thinking: false }
      }),
      signal
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${trimText(text, 220)}`);
    }

    const data = await response.json();
    const message = data?.choices?.[0]?.message || {};
    const content = pickTextCandidate([message.content, message.reasoning_content, message.thinking]).trim();
    if (!content) {
      throw new Error("Resposta vazia da API.");
    }

    return content;
  }

  async function requestViaProxyStream(endpoint, payload, onChunk, signal) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream"
      },
      body: JSON.stringify(payload),
      signal
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${trimText(text, 220)}`);
    }

    if (!response.body) {
      throw new Error("Stream indisponível neste navegador.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullAnswer = "";
    let streamError = "";
    let streamDone = false;

    const emitChunk = (delta) => {
      if (!delta) {
        return;
      }
      fullAnswer += delta;
      if (typeof onChunk === "function") {
        onChunk(fullAnswer, delta);
      }
    };

    const processEventBlock = (block) => {
      const parsedBlock = parseSseBlock(block);
      if (!parsedBlock || !parsedBlock.data) {
        return;
      }

      if (parsedBlock.data === "[DONE]") {
        streamDone = true;
        return;
      }

      const payloadData = parseJsonSafe(parsedBlock.data);
      if (!payloadData) {
        return;
      }

      if (parsedBlock.event === "error") {
        streamError = String(payloadData.error || "Falha no stream.");
        streamDone = true;
        return;
      }

      if (parsedBlock.event === "done") {
        const doneText = String(payloadData.answer || "").trim();
        if (doneText && doneText !== fullAnswer) {
          fullAnswer = doneText;
          if (typeof onChunk === "function") {
            onChunk(fullAnswer, "");
          }
        }
        streamDone = true;
        return;
      }

      const delta = extractStreamDelta(payloadData);
      emitChunk(delta);
    };

    while (!streamDone) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");

      while (true) {
        const marker = buffer.indexOf("\n\n");
        if (marker === -1) {
          break;
        }

        const block = buffer.slice(0, marker);
        buffer = buffer.slice(marker + 2);
        processEventBlock(block);
        if (streamDone) {
          break;
        }
      }
    }

    if (!streamDone && buffer.trim()) {
      processEventBlock(buffer);
    }

    if (streamError) {
      throw new Error(streamError);
    }

    const finalText = String(fullAnswer || "").trim();
    if (!finalText) {
      throw new Error("Resposta vazia do stream.");
    }

    return finalText;
  }

  function isLocalEndpoint(endpoint) {
    const value = String(endpoint || "").toLowerCase();
    return value.includes("localhost") || value.includes("127.0.0.1") || value.includes("://[::1]");
  }

  function parseSseBlock(block) {
    const lines = String(block || "").split("\n");
    let eventName = "message";
    const dataLines = [];

    lines.forEach((rawLine) => {
      const line = rawLine.trimEnd();
      if (!line) {
        return;
      }

      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim() || "message";
        return;
      }

      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    });

    return {
      event: eventName,
      data: dataLines.join("\n").trim()
    };
  }

  function parseJsonSafe(raw) {
    try {
      return JSON.parse(raw);
    } catch (_error) {
      return null;
    }
  }

  function extractStreamDelta(payload) {
    if (typeof payload?.delta === "string") {
      return payload.delta;
    }

    const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
    const delta = choice?.delta || choice?.message || {};
    return pickTextCandidate([delta.content, delta.reasoning_content, delta.thinking, choice?.text, payload?.content]);
  }

  function pickTextCandidate(candidates) {
    for (const item of candidates) {
      const value = normalizeTextContent(item);
      if (value) {
        return value;
      }
    }
    return "";
  }

  function normalizeTextContent(value) {
    if (typeof value === "string") {
      return value;
    }

    if (Array.isArray(value)) {
      return value
        .map((part) => {
          if (typeof part === "string") {
            return part;
          }
          if (part && typeof part.text === "string") {
            return part.text;
          }
          if (part && typeof part.content === "string") {
            return part.content;
          }
          return "";
        })
        .join("");
    }

    return "";
  }
  function onCodeFilterClick(event) {
    const button = event.target.closest("button[data-code-filter]");
    if (!button) {
      return;
    }

    state.ui.codeFilter = button.dataset.codeFilter;
    saveSlice("ui", state.ui);

    dom.codeFilterBar.querySelectorAll("button[data-code-filter]").forEach((item) => {
      item.classList.toggle("active", item.dataset.codeFilter === state.ui.codeFilter);
    });

    renderCodeCards();
  }

  function renderCodeCards() {
    const query = dom.codeSearchInput.value.trim().toLowerCase();
    const filter = state.ui.codeFilter || "all";

    dom.codeFilterBar.querySelectorAll("button[data-code-filter]").forEach((item) => {
      item.classList.toggle("active", item.dataset.codeFilter === filter);
    });

    const filtered = CODE_ITEMS.filter((item) => {
      const byType = filter === "all" || (filter === "language" && item.type === "language") || (filter === "tag" && item.type === "tag");
      if (!byType) {
        return false;
      }

      if (!query) {
        return true;
      }

      const text = `${item.name} ${item.preview} ${item.description}`.toLowerCase();
      return text.includes(query);
    });

    if (!filtered.length) {
      dom.codeCards.innerHTML = `<article class="card"><p>Nenhum item encontrado.</p></article>`;
      return;
    }

    dom.codeCards.innerHTML = filtered
      .map(
        (item) => `<article class="card item">
          <div class="item-head">
            <strong>${escapeHTML(item.name)}</strong>
            <small>${item.type === "language" ? "Linguagem" : "Tag"}</small>
          </div>
          <pre class="output">${escapeHTML(item.preview)}</pre>
          <div class="item-actions">
            <button class="mini-btn" type="button" data-copy-code="${item.id}">Copiar</button>
            <button class="mini-btn" type="button" data-open-code="${item.id}">Ver mais</button>
          </div>
        </article>`
      )
      .join("");
  }

  function onCodeCardAction(event) {
    const copyButton = event.target.closest("button[data-copy-code]");
    if (copyButton) {
      const item = CODE_ITEMS.find((entry) => entry.id === copyButton.dataset.copyCode);
      if (item) {
        copyText(item.preview, "Código copiado.");
      }
      return;
    }

    const openButton = event.target.closest("button[data-open-code]");
    if (openButton) {
      const item = CODE_ITEMS.find((entry) => entry.id === openButton.dataset.openCode);
      if (item) {
        openCodeModal(item);
      }
    }
  }

  function openCodeModal(item) {
    dom.codeModalTitle.textContent = item.name;
    dom.codeModalDescription.textContent = item.description;
    dom.codeModalSyntax.textContent = item.syntax;
    dom.codeModalExample.textContent = item.example;
    dom.codeModal.classList.remove("hidden");
  }

  function closeCodeModal() {
    dom.codeModal.classList.add("hidden");
  }

  function onSalesActionClick(event) {
    const button = event.target.closest("button[data-sales-type]");
    if (!button) {
      return;
    }

    const product = dom.salesProductInput.value.trim();
    const audience = dom.salesAudienceInput.value.trim();
    const problem = dom.salesProblemInput.value.trim();

    if (!product || !audience || !problem) {
      toast("Preencha produto, público e problema.", "error");
      return;
    }

    const type = button.dataset.salesType;
    state.salesOutput = generateSalesText(type, { product, audience, problem });
    saveSlice("sales", state.salesOutput);
    renderSales();
  }

  function renderSales() {
    dom.salesOutput.textContent = state.salesOutput || "Preencha os campos e clique em um gerador.";
  }

  function generateSalesText(type, input) {
    const base = `Produto: ${input.product}\nPúblico: ${input.audience}\nProblema: ${input.problem}`;

    if (type === "headline") {
      return `${input.product}: solução direta para ${input.audience} que querem vencer ${input.problem}.`;
    }

    if (type === "offer") {
      return `Oferta\n${base}\n\nCondição especial de lançamento com bônus de implementação e suporte inicial.`;
    }

    return `Copy\n${base}\n\n${input.product} foi criado para ${input.audience} que enfrentam ${input.problem}. Com aplicação prática, você reduz tempo de tentativa e acelera resultado.`;
  }

  function onPromptSubmit(event) {
    event.preventDefault();

    const editingId = dom.promptId.value;
    const title = dom.promptTitle.value.trim();
    const content = dom.promptContent.value.trim();

    if (!title || !content) {
      toast("Título e prompt são obrigatórios.", "error");
      return;
    }

    if (editingId) {
      const prompt = state.prompts.find((item) => item.id === editingId);
      if (prompt) {
        prompt.title = title;
        prompt.content = content;
        prompt.updatedAt = nowISO();
      }
      toast("Prompt atualizado.", "success");
    } else {
      state.prompts.unshift({ id: uid("prompt"), title, content, updatedAt: nowISO() });
      toast("Prompt salvo.", "success");
    }

    saveSlice("prompts", state.prompts);
    dom.promptForm.reset();
    dom.promptId.value = "";
    renderPrompts();
    renderDashboard();
    updateStorageMeta();
  }

  function onPromptActionClick(event) {
    const actionButton = event.target.closest("button[data-prompt-action]");
    if (!actionButton) {
      return;
    }

    const prompt = state.prompts.find((item) => item.id === actionButton.dataset.promptId);
    if (!prompt) {
      return;
    }

    const action = actionButton.dataset.promptAction;

    if (action === "edit") {
      dom.promptId.value = prompt.id;
      dom.promptTitle.value = prompt.title;
      dom.promptContent.value = prompt.content;
      dom.promptTitle.focus();
      return;
    }

    if (action === "copy") {
      copyText(prompt.content, "Prompt copiado.");
      return;
    }

    if (action === "use") {
      setSection("assistant", true);
      dom.chatInput.value = prompt.content;
      dom.chatInput.focus();
      return;
    }

    if (action === "delete") {
      if (!window.confirm(`Excluir prompt \"${prompt.title}\"?`)) {
        return;
      }
      state.prompts = state.prompts.filter((item) => item.id !== prompt.id);
      saveSlice("prompts", state.prompts);
      renderPrompts();
      renderDashboard();
      updateStorageMeta();
      toast("Prompt removido.", "success");
    }
  }

  function renderPrompts() {
    const query = dom.promptSearchInput.value.trim().toLowerCase();
    const filtered = state.prompts.filter((item) => {
      if (!query) {
        return true;
      }
      return `${item.title} ${item.content}`.toLowerCase().includes(query);
    });

    if (!filtered.length) {
      dom.promptsList.innerHTML = `<article class="card"><p>Nenhum prompt encontrado.</p></article>`;
      return;
    }

    dom.promptsList.innerHTML = filtered
      .sort((a, b) => sortDateDesc(a.updatedAt, b.updatedAt))
      .map(
        (item) => `<article class="card item">
          <div class="item-head"><strong>${escapeHTML(item.title)}</strong><small>${fmtDate(item.updatedAt)}</small></div>
          <p>${escapeHTML(trimText(item.content, 180))}</p>
          <div class="item-actions">
            <button class="mini-btn" type="button" data-prompt-action="copy" data-prompt-id="${item.id}">Copiar</button>
            <button class="mini-btn" type="button" data-prompt-action="use" data-prompt-id="${item.id}">Usar</button>
            <button class="mini-btn" type="button" data-prompt-action="edit" data-prompt-id="${item.id}">Editar</button>
            <button class="mini-btn" type="button" data-prompt-action="delete" data-prompt-id="${item.id}">Excluir</button>
          </div>
        </article>`
      )
      .join("");
  }

  function onTaskSubmit(event) {
    event.preventDefault();

    const editingId = dom.taskId.value;
    const title = dom.taskTitle.value.trim();
    const date = dom.taskDate.value || "";

    if (!title) {
      toast("Informe o título da tarefa.", "error");
      return;
    }

    if (editingId) {
      const task = state.tasks.find((item) => item.id === editingId);
      if (task) {
        task.title = title;
        task.date = date;
        task.updatedAt = nowISO();
      }
      toast("Tarefa atualizada.", "success");
    } else {
      state.tasks.unshift({ id: uid("task"), title, date, done: false, updatedAt: nowISO() });
      toast("Tarefa criada.", "success");
    }

    saveSlice("tasks", state.tasks);
    dom.taskForm.reset();
    dom.taskId.value = "";
    renderTasks();
    renderDashboard();
    updateStorageMeta();
  }

  function onTaskFilterClick(event) {
    const button = event.target.closest("button[data-task-filter]");
    if (!button) {
      return;
    }

    state.ui.taskFilter = button.dataset.taskFilter;
    saveSlice("ui", state.ui);
    renderTasks();
  }

  function onTaskToggle(event) {
    const checkbox = event.target.closest("input[data-task-toggle]");
    if (!checkbox) {
      return;
    }

    const task = state.tasks.find((item) => item.id === checkbox.dataset.taskToggle);
    if (!task) {
      return;
    }

    task.done = checkbox.checked;
    task.updatedAt = nowISO();
    saveSlice("tasks", state.tasks);
    renderTasks();
    renderDashboard();
  }

  function onTaskActionClick(event) {
    const button = event.target.closest("button[data-task-action]");
    if (!button) {
      return;
    }

    const task = state.tasks.find((item) => item.id === button.dataset.taskId);
    if (!task) {
      return;
    }

    const action = button.dataset.taskAction;

    if (action === "edit") {
      dom.taskId.value = task.id;
      dom.taskTitle.value = task.title;
      dom.taskDate.value = task.date || "";
      dom.taskTitle.focus();
      return;
    }

    if (action === "delete") {
      if (!window.confirm(`Excluir tarefa \"${task.title}\"?`)) {
        return;
      }

      state.tasks = state.tasks.filter((item) => item.id !== task.id);
      saveSlice("tasks", state.tasks);
      renderTasks();
      renderDashboard();
      updateStorageMeta();
      toast("Tarefa removida.", "success");
    }
  }

  function renderTasks() {
    const filter = state.ui.taskFilter || "all";
    const today = todayISO();

    dom.taskFilterBar.querySelectorAll("button[data-task-filter]").forEach((item) => {
      item.classList.toggle("active", item.dataset.taskFilter === filter);
    });

    let filtered = [...state.tasks];
    if (filter === "today") {
      filtered = filtered.filter((task) => task.date === today);
    } else if (filter === "open") {
      filtered = filtered.filter((task) => !task.done);
    } else if (filter === "done") {
      filtered = filtered.filter((task) => task.done);
    }

    filtered.sort((a, b) => sortDateDesc(a.updatedAt, b.updatedAt));

    if (!filtered.length) {
      dom.tasksList.innerHTML = `<article class="item">Nenhuma tarefa para este filtro.</article>`;
      return;
    }

    dom.tasksList.innerHTML = filtered
      .map(
        (task) => `<article class="item">
          <div class="item-head">
            <strong>${escapeHTML(task.title)}</strong>
            <small>${task.date ? fmtDate(task.date) : "Sem data"}</small>
          </div>
          <div class="item-actions">
            <label><input type="checkbox" data-task-toggle="${task.id}" ${task.done ? "checked" : ""} /> Concluída</label>
            <button class="mini-btn" type="button" data-task-action="edit" data-task-id="${task.id}">Editar</button>
            <button class="mini-btn" type="button" data-task-action="delete" data-task-id="${task.id}">Excluir</button>
          </div>
        </article>`
      )
      .join("");
  }

  function onNoteSubmit(event) {
    event.preventDefault();

    const editingId = dom.noteId.value;
    const title = dom.noteTitle.value.trim();
    const content = dom.noteContent.value.trim();

    if (!title || !content) {
      toast("Título e conteúdo são obrigatórios.", "error");
      return;
    }

    if (editingId) {
      const note = state.notes.find((item) => item.id === editingId);
      if (note) {
        note.title = title;
        note.content = content;
        note.updatedAt = nowISO();
      }
      toast("Nota atualizada.", "success");
    } else {
      state.notes.unshift({ id: uid("note"), title, content, updatedAt: nowISO() });
      toast("Nota salva.", "success");
    }

    saveSlice("notes", state.notes);
    dom.noteForm.reset();
    dom.noteId.value = "";
    renderNotes();
    renderDashboard();
    updateStorageMeta();
  }

  function onNoteActionClick(event) {
    const button = event.target.closest("button[data-note-action]");
    if (!button) {
      return;
    }

    const note = state.notes.find((item) => item.id === button.dataset.noteId);
    if (!note) {
      return;
    }

    const action = button.dataset.noteAction;

    if (action === "edit") {
      dom.noteId.value = note.id;
      dom.noteTitle.value = note.title;
      dom.noteContent.value = note.content;
      dom.noteTitle.focus();
      return;
    }

    if (action === "copy") {
      copyText(note.content, "Nota copiada.");
      return;
    }

    if (action === "delete") {
      if (!window.confirm(`Excluir nota \"${note.title}\"?`)) {
        return;
      }

      state.notes = state.notes.filter((item) => item.id !== note.id);
      saveSlice("notes", state.notes);
      renderNotes();
      renderDashboard();
      updateStorageMeta();
      toast("Nota removida.", "success");
    }
  }

  function renderNotes() {
    const query = dom.noteSearchInput.value.trim().toLowerCase();
    const filtered = state.notes.filter((note) => {
      if (!query) {
        return true;
      }
      return `${note.title} ${note.content}`.toLowerCase().includes(query);
    });

    if (!filtered.length) {
      dom.notesList.innerHTML = `<article class="card"><p>Nenhuma nota encontrada.</p></article>`;
      return;
    }

    dom.notesList.innerHTML = filtered
      .sort((a, b) => sortDateDesc(a.updatedAt, b.updatedAt))
      .map(
        (note) => `<article class="card item">
          <div class="item-head"><strong>${escapeHTML(note.title)}</strong><small>${fmtDate(note.updatedAt)}</small></div>
          <p>${escapeHTML(trimText(note.content, 200))}</p>
          <div class="item-actions">
            <button class="mini-btn" type="button" data-note-action="copy" data-note-id="${note.id}">Copiar</button>
            <button class="mini-btn" type="button" data-note-action="edit" data-note-id="${note.id}">Editar</button>
            <button class="mini-btn" type="button" data-note-action="delete" data-note-id="${note.id}">Excluir</button>
          </div>
        </article>`
      )
      .join("");
  }

  function onSettingsSubmit(event) {
    event.preventDefault();

    const rawEndpointInput = dom.settingsApiEndpoint
      ? (dom.settingsApiEndpoint.value.trim() || resolveDefaultEndpoint())
      : (state.settings.apiEndpoint || resolveDefaultEndpoint());
    const unsupportedProtocol = detectUnsupportedProtocol(rawEndpointInput);
    if (unsupportedProtocol) {
      toast(`Endpoint inválido: ${unsupportedProtocol}:// não é URL HTTP de API.`, "error");
      return;
    }

    state.settings.userName = dom.settingsUserName.value.trim() || "Profissional";
    state.settings.theme = dom.settingsTheme.value === "light" ? "light" : "dark";
    state.settings.apiKey = "";
    state.settings.apiModel = dom.settingsApiModel
      ? (dom.settingsApiModel.value.trim() || DEFAULT_MODEL)
      : (state.settings.apiModel || DEFAULT_MODEL);
    state.settings.apiEndpoint = enforceEndpointForRuntime(rawEndpointInput);

    saveSlice("settings", state.settings);
    applyTheme(state.settings.theme);
    setWelcomeLine();
    renderApiStatus();
    updateStorageMeta();
    toast("Configurações salvas.", "success");
  }

  function hydrateSettings() {
    dom.settingsUserName.value = state.settings.userName || "";
    dom.settingsTheme.value = state.settings.theme || "dark";
    if (dom.settingsApiModel) {
      dom.settingsApiModel.value = state.settings.apiModel || DEFAULT_MODEL;
    }
    if (dom.settingsApiEndpoint) {
      dom.settingsApiEndpoint.value = enforceEndpointForRuntime(state.settings.apiEndpoint || resolveDefaultEndpoint());
    }
  }

  function exportData() {
    const payload = {
      exportedAt: nowISO(),
      data: {
        settings: state.settings,
        chat: state.chat,
        prompts: state.prompts,
        tasks: state.tasks,
        notes: state.notes,
        ui: state.ui,
        salesOutput: state.salesOutput
      }
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `central-ia-backup-${todayISO()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    toast("Backup exportado.", "success");
  }

  function importData(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || "{}"));
        const incoming = parsed.data || parsed;

        const next = {
          ...defaultState(),
          ...state,
          settings: { ...defaultSettings(), ...(incoming.settings || {}) },
          chat: Array.isArray(incoming.chat) ? incoming.chat : state.chat,
          prompts: Array.isArray(incoming.prompts) ? incoming.prompts : state.prompts,
          tasks: Array.isArray(incoming.tasks) ? incoming.tasks : state.tasks,
          notes: Array.isArray(incoming.notes) ? incoming.notes : state.notes,
          ui: { ...defaultUI(), ...(incoming.ui || {}) },
          salesOutput: typeof incoming.salesOutput === "string" ? incoming.salesOutput : state.salesOutput
        };

        state = normalizeState(next);
        persistAll();
        applyTheme(state.settings.theme);
        applySidebarState();
        hydrateSettings();
        setWelcomeLine();
        renderAll();
        setSection(state.ui.section || "dashboard", false);
        toast("Dados importados.", "success");
      } catch (_error) {
        toast("Arquivo inválido.", "error");
      }

      dom.importFileInput.value = "";
    };

    reader.readAsText(file);
  }

  function clearAllData() {
    if (!window.confirm("Limpar todos os dados locais?")) {
      return;
    }

    Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(storageKey(key)));
    state = defaultState();
    persistAll();
    applyTheme(state.settings.theme);
    applySidebarState();
    hydrateSettings();
    setWelcomeLine();
    renderAll();
    setSection("dashboard", false);
    toast("Dados removidos.", "success");
  }

  function updateStorageMeta() {
    const count = state.prompts.length + state.tasks.length + state.notes.length + state.chat.length;
    dom.storageMetaText.textContent = `Itens salvos: ${count} • Atualizado em ${fmtDateTime(nowISO())}`;
  }

  function loadState() {
    const loaded = {
      settings: readSlice("settings", defaultSettings()),
      chat: readSlice("chat", []),
      prompts: readSlice("prompts", defaultPrompts()),
      tasks: readSlice("tasks", defaultTasks()),
      notes: readSlice("notes", defaultNotes()),
      ui: readSlice("ui", defaultUI()),
      salesOutput: readSlice("sales", "Preencha os campos e clique em um gerador.")
    };

    return normalizeState(loaded);
  }

  function normalizeState(input) {
    const fallback = defaultState();
    const rawEndpoint = String(input.settings?.apiEndpoint || fallback.settings.apiEndpoint || "").trim();
    const migratedEndpoint = rawEndpoint.includes("integrate.api.nvidia.com")
      ? LOCAL_PROXY_STREAM_ENDPOINT
      : normalizeEndpoint(rawEndpoint || resolveDefaultEndpoint());
    const repairedEndpoint = enforceEndpointForRuntime(migratedEndpoint || resolveDefaultEndpoint());

    return {
      settings: {
        ...fallback.settings,
        ...(input.settings || {}),
        apiKey: "",
        apiEndpoint: repairedEndpoint,
        apiModel: String(input.settings?.apiModel || fallback.settings.apiModel || DEFAULT_MODEL).trim() || DEFAULT_MODEL,
        theme: input.settings?.theme === "light" ? "light" : "dark"
      },
      chat: Array.isArray(input.chat) ? sanitizeLegacyChat(input.chat) : fallback.chat,
      prompts: Array.isArray(input.prompts) ? input.prompts : fallback.prompts,
      tasks: Array.isArray(input.tasks) ? input.tasks : fallback.tasks,
      notes: Array.isArray(input.notes) ? input.notes : fallback.notes,
      ui: { ...fallback.ui, ...(input.ui || {}) },
      salesOutput: typeof input.salesOutput === "string" ? input.salesOutput : fallback.salesOutput
    };
  }

  function sanitizeLegacyChat(chatItems) {
    return chatItems.map((item) => {
      if (!item || typeof item !== "object") {
        return item;
      }

      const role = String(item.role || "");
      const content = String(item.content || "");
      const isLegacyProxyError = role === "assistant" && (
        /Falha ao conectar no backend público/i.test(content) ||
        /Failed to fetch/i.test(content) ||
        /HTTP 405/i.test(content) ||
        /Unexpected token 'e',\s*"event:\s*err/i.test(content)
      );

      if (!isLegacyProxyError) {
        return item;
      }

      return {
        ...item,
        content: "Falha ao gerar resposta.\n\nNão foi possível conectar ao servidor de IA nessa tentativa."
      };
    });
  }

  function persistAll() {
    saveSlice("settings", state.settings);
    saveSlice("chat", state.chat);
    saveSlice("prompts", state.prompts);
    saveSlice("tasks", state.tasks);
    saveSlice("notes", state.notes);
    saveSlice("ui", state.ui);
    saveSlice("sales", state.salesOutput);
  }

  function readSlice(key, fallback) {
    try {
      const raw = localStorage.getItem(storageKey(STORAGE_KEYS[key]));
      if (!raw) {
        return clone(fallback);
      }
      return JSON.parse(raw);
    } catch (_error) {
      return clone(fallback);
    }
  }

  function saveSlice(key, value) {
    try {
      localStorage.setItem(storageKey(STORAGE_KEYS[key]), JSON.stringify(value));
    } catch (_error) {
      toast("Falha ao salvar localmente.", "error");
    }
  }

  function storageKey(slice) {
    return `${STORAGE_PREFIX}${slice}`;
  }

  function cleanApiKey(raw) {
    const value = (raw || "").trim();
    if (!value) {
      return "";
    }
    return value.replace(/^Authorization\s*:\s*/i, "").replace(/^Bearer\s+/i, "").trim();
  }

  function q(selector, root = document) {
    return root.querySelector(selector);
  }

  function qa(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function uid(prefix) {
    return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function fmtDate(value) {
    if (!value) {
      return "-";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  }

  function fmtDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function sortDateDesc(a, b) {
    return new Date(b || 0).getTime() - new Date(a || 0).getTime();
  }

  function trimText(value, max) {
    const text = String(value || "");
    return text.length > max ? `${text.slice(0, max)}...` : text;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function escapeHTML(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function escapeAttr(value) {
    return escapeHTML(value).replaceAll("`", "&#96;");
  }

  async function copyText(value, successMessage = "Copiado") {
    try {
      await navigator.clipboard.writeText(value);
      toast(successMessage, "success");
    } catch (_error) {
      const temp = document.createElement("textarea");
      temp.value = value;
      document.body.appendChild(temp);
      temp.select();
      document.execCommand("copy");
      temp.remove();
      toast(successMessage, "success");
    }
  }

  function toast(message, type = "success") {
    const item = document.createElement("div");
    item.className = `toast ${type}`;
    item.textContent = message;
    dom.toastContainer.appendChild(item);
    window.setTimeout(() => item.remove(), 3200);
  }
})();
