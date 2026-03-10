const DOMAIN_ORDER = ["story", "show", "topic", "persona", "knowledge"];

const DOMAIN_LABELS = {
  story: "Story",
  show: "Show",
  topic: "Topic",
  persona: "Persona",
  knowledge: "Knowledge",
};

const DOMAIN_TITLES = {
  story: "叙事表达卡",
  show: "播放承接卡",
  topic: "主动话题卡",
  persona: "人设风格卡",
  knowledge: "知识沉淀卡",
};

const state = {
  fileName: "",
  rawRows: [],
  sources: [],
  filters: {
    search: "",
    videoType: "全部",
    domain: "全部",
    risk: "全部",
    verificationOnly: false,
  },
  activeDomains: {},
  drawer: null,
};

const elements = {
  dropzone: document.querySelector("#dropzone"),
  fileInput: document.querySelector("#file-input"),
  fileStatus: document.querySelector("#file-status"),
  loadSample: document.querySelector("#load-sample"),
  clearData: document.querySelector("#clear-data"),
  dashboard: document.querySelector("#dashboard"),
  emptyState: document.querySelector("#empty-state"),
  sourceList: document.querySelector("#source-list"),
  summaryGrid: document.querySelector("#summary-grid"),
  searchInput: document.querySelector("#search-input"),
  videoTypeFilters: document.querySelector("#video-type-filters"),
  domainFilters: document.querySelector("#domain-filters"),
  riskFilters: document.querySelector("#risk-filters"),
  verificationOnly: document.querySelector("#verification-only"),
  detailDrawer: document.querySelector("#detail-drawer"),
  drawerBackdrop: document.querySelector("#drawer-backdrop"),
  drawerClose: document.querySelector("#drawer-close"),
  drawerContent: document.querySelector("#drawer-content"),
  summaryTemplate: document.querySelector("#summary-card-template"),
};

function init() {
  bindUpload();
  bindControls();
  render();
}

function resetFilters() {
  state.filters = {
    search: "",
    videoType: "全部",
    domain: "全部",
    risk: "全部",
    verificationOnly: false,
  };
  elements.searchInput.value = "";
  elements.verificationOnly.checked = false;
}

function bindUpload() {
  elements.dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.dropzone.classList.add("is-dragging");
  });

  ["dragleave", "dragend"].forEach((eventName) => {
    elements.dropzone.addEventListener(eventName, () => {
      elements.dropzone.classList.remove("is-dragging");
    });
  });

  elements.dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.dropzone.classList.remove("is-dragging");
    const [file] = event.dataTransfer.files;
    if (file) {
      loadFile(file);
    }
  });

  elements.fileInput.addEventListener("change", (event) => {
    const [file] = event.target.files;
    if (file) {
      loadFile(file);
    }
  });

  elements.loadSample.addEventListener("click", async () => {
    try {
      const response = await fetch("./test_csv.csv");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const text = await response.text();
      hydrateFromCsv(text, "test_csv.csv");
    } catch (error) {
      elements.fileStatus.textContent =
        "测试数据加载失败。若是直接打开 HTML 文件，请改用拖拽 CSV 方式。";
      console.error(error);
    }
  });

  elements.clearData.addEventListener("click", () => {
    state.fileName = "";
    state.rawRows = [];
    state.sources = [];
    state.activeDomains = {};
    state.drawer = null;
    resetFilters();
    elements.fileInput.value = "";
    render();
  });
}

function bindControls() {
  elements.searchInput.addEventListener("input", (event) => {
    state.filters.search = event.target.value.trim();
    renderSources();
  });

  elements.verificationOnly.addEventListener("change", (event) => {
    state.filters.verificationOnly = event.target.checked;
    renderSources();
  });

  elements.drawerBackdrop.addEventListener("click", closeDrawer);
  elements.drawerClose.addEventListener("click", closeDrawer);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDrawer();
    }
  });
}

async function loadFile(file) {
  const text = await file.text();
  hydrateFromCsv(text, file.name);
}

function hydrateFromCsv(text, fileName) {
  const rows = parseCsv(text).map(normalizeRow).filter((row) => row.sourceId);
  resetFilters();
  state.fileName = fileName;
  state.rawRows = rows;
  state.sources = groupRowsBySource(rows);
  state.activeDomains = {};
  state.drawer = null;

  state.sources.forEach((source) => {
    state.activeDomains[source.sourceId] = source.domainOrder[0] || "story";
  });

  elements.fileStatus.textContent = `${fileName} 已载入，共 ${rows.length} 条资产记录`;
  render();
}

function parseCsv(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(current);
      current = "";
      if (row.some((cell) => cell.length > 0)) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    current += char;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  const [headerRow, ...bodyRows] = rows;
  const headers = headerRow.map((header) => header.replace(/^\uFEFF/, "").trim());

  return bodyRows.map((cells) => {
    const record = {};
    headers.forEach((header, columnIndex) => {
      record[header] = cells[columnIndex] ?? "";
    });
    return record;
  });
}

function normalizeRow(row, index) {
  const assetFields = parseAssetContent(row["资产内容"] || "");
  const skillFit = parseListish(row["技能匹配"]);
  const triggerFit = parseListish(row["触发时机"]);
  const riskTags = parseListish(row["字段_risk_tags"]);
  const videoUrl = (row["视频链接"] || "").trim();

  return {
    id: `${row["来源ID"] || "source"}-${index}`,
    authorId: (row["作者ID"] || "").trim(),
    authorProfile: (row["作者人设"] || "").trim(),
    sourceType: (row["来源类型"] || "").trim() || "unknown",
    sourceId: (row["来源ID"] || "").trim(),
    videoUrl,
    understandingText: (row["理解文本"] || "").trim(),
    videoType: (row["视频分类"] || "").trim() || "未分类",
    assetDomain: (row["资产域"] || "").trim() || "unknown",
    skillFit,
    triggerFit,
    riskTags,
    assetContentRaw: (row["资产内容"] || "").trim(),
    assetFields,
    title: deriveAssetTitle((row["资产域"] || "").trim(), assetFields),
    summary: deriveAssetSummary((row["资产域"] || "").trim(), assetFields),
    needsVerification: normalizeBoolean(assetFields.needs_verification),
  };
}

function parseAssetContent(text) {
  const result = {};
  let currentKey = "";

  text.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      return;
    }

    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      currentKey = match[1].trim();
      result[currentKey] = coerceStructuredValue(match[2].trim());
      return;
    }

    if (currentKey) {
      const previous = result[currentKey];
      result[currentKey] =
        typeof previous === "string" ? `${previous}\n${line.trim()}` : line.trim();
    }
  });

  return result;
}

function coerceStructuredValue(value) {
  if (!value) {
    return "";
  }

  const normalized = value.trim();
  if (
    (normalized.startsWith("[") && normalized.endsWith("]")) ||
    (normalized.startsWith("{") && normalized.endsWith("}"))
  ) {
    try {
      return JSON.parse(normalized);
    } catch (error) {
      return normalized;
    }
  }

  if (normalized === "True" || normalized === "False") {
    return normalized === "True";
  }

  return normalized;
}

function parseListish(value) {
  const text = (value || "").trim();
  if (!text) {
    return [];
  }

  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [String(parsed)];
  } catch (error) {
    return text
      .split(/[;,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function deriveAssetTitle(domain, fields) {
  if (domain === "story") {
    return fields.title || fields.core_point || "未命名 Story 资产";
  }
  if (domain === "show") {
    return fields.highlight_summary || fields.pre_play_script || "未命名 Show 资产";
  }
  if (domain === "topic") {
    return fields.topic_title || fields.opening_script || "未命名 Topic 资产";
  }
  if (domain === "persona") {
    return fields.pattern_text || fields.pattern_type || "未命名 Persona 资产";
  }
  if (domain === "knowledge") {
    return fields.summary || fields.video_type || "未命名 Knowledge 资产";
  }
  return "未命名资产";
}

function deriveAssetSummary(domain, fields) {
  if (domain === "story") {
    return fields.opening_script || fields.body_script || fields.core_point || "";
  }
  if (domain === "show") {
    return fields.post_play_script || fields.talk_points || "";
  }
  if (domain === "topic") {
    return fields.core_points || fields.followup_examples || "";
  }
  if (domain === "persona") {
    return fields.usage_context || fields.example_usage || "";
  }
  if (domain === "knowledge") {
    return fields.extraction_notes || fields.excluded_points || "";
  }
  return "";
}

function groupRowsBySource(rows) {
  const sources = new Map();

  rows.forEach((row) => {
    const existing = sources.get(row.sourceId) || createEmptySource(row);
    existing.videoUrl = existing.videoUrl || row.videoUrl;
    existing.authorId = existing.authorId || row.authorId;
    existing.authorProfile = existing.authorProfile || row.authorProfile;
    existing.sourceType = existing.sourceType || row.sourceType;
    existing.videoType = existing.videoType || row.videoType;
    existing.understandingText = pickLongerText(existing.understandingText, row.understandingText);
    existing.assets.push(row);
    row.riskTags.forEach((tag) => existing.riskTags.add(tag));
    if (row.needsVerification) {
      existing.hasVerificationNeed = true;
    }
    sources.set(row.sourceId, existing);
  });

  return Array.from(sources.values())
    .map((source) => finalizeSource(source))
    .sort((left, right) => {
      const sourceTypePriority = compareSourceTypePriority(left.sourceType, right.sourceType);
      if (sourceTypePriority !== 0) {
        return sourceTypePriority;
      }
      return right.assets.length - left.assets.length;
    });
}

function createEmptySource(row) {
  return {
    sourceId: row.sourceId,
    authorId: row.authorId,
    authorProfile: row.authorProfile,
    sourceType: row.sourceType,
    videoUrl: row.videoUrl,
    videoType: row.videoType,
    understandingText: row.understandingText,
    assets: [],
    riskTags: new Set(),
    hasVerificationNeed: false,
  };
}

function finalizeSource(source) {
  const domainMap = {};
  DOMAIN_ORDER.forEach((domain) => {
    domainMap[domain] = [];
  });

  source.assets.forEach((asset) => {
    if (!domainMap[asset.assetDomain]) {
      domainMap[asset.assetDomain] = [];
    }
    domainMap[asset.assetDomain].push(asset);
  });

  const domainOrder = DOMAIN_ORDER.filter((domain) => (domainMap[domain] || []).length > 0);
  const searchableText = [
    source.sourceId,
    source.sourceType,
    source.videoType,
    source.authorId,
    source.understandingText,
    ...source.assets.flatMap((asset) => [
      asset.title,
      asset.summary,
      asset.assetContentRaw,
      asset.skillFit.join(" "),
      asset.triggerFit.join(" "),
    ]),
  ]
    .join(" ")
    .toLowerCase();

  return {
    ...source,
    domainMap,
    domainOrder,
    riskTagList: Array.from(source.riskTags),
    searchableText,
    understandingTextFormatted: formatUnderstandingText(source.understandingText),
    understandingPreview: summarizeText(formatUnderstandingText(source.understandingText), 220),
  };
}

function compareSourceTypePriority(left, right) {
  const priorities = {
    short_video: 0,
    live_clip: 1,
  };
  return (priorities[left] ?? 99) - (priorities[right] ?? 99);
}

function pickLongerText(current, incoming) {
  return (incoming || "").length > (current || "").length ? incoming : current;
}

function summarizeText(text, maxLength) {
  const compact = (text || "")
    .replace(/^#+\s*/gm, "")
    .replace(/\|(\d{2}:\d{2}~\d{2}:\d{2})\|/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();

  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength).trim()}...`;
}

function formatUnderstandingText(text) {
  return (text || "")
    .replace(/\r\n/g, "\n")
    .replace(/^#\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  return String(value).toLowerCase() === "true";
}

function render() {
  const hasData = state.sources.length > 0;
  elements.dashboard.classList.toggle("hidden", !hasData);
  elements.emptyState.classList.toggle("hidden", hasData);
  renderSummary();
  renderFilters();
  renderSources();
  renderDrawer();
}

function renderSummary() {
  elements.summaryGrid.innerHTML = "";
  if (!state.sources.length) {
    return;
  }

  const missingVideoSources = state.sources.filter((source) => !source.videoUrl).length;
  const summaryItems = [
    {
      label: "源视频",
      value: state.sources.length,
      meta: `${state.fileName || "当前数据"} 中按 source_id 聚合后的母卡数量`,
    },
    {
      label: "资产总数",
      value: state.rawRows.length,
      meta: `平均每个源视频 ${(state.rawRows.length / state.sources.length).toFixed(1)} 张资产卡`,
    },
    {
      label: "待验证源视频",
      value: state.sources.filter((source) => source.hasVerificationNeed).length,
      meta: "至少包含一张 needs_verification 为 True 的 knowledge 卡",
    },
    {
      label: "缺视频链接",
      value: missingVideoSources,
      meta: "这些源视频会回退为抽象视频舞台，不依赖 video_url",
    },
  ];

  summaryItems.forEach((item) => {
    const node = elements.summaryTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".summary-label").textContent = item.label;
    node.querySelector(".summary-value").textContent = String(item.value);
    node.querySelector(".summary-meta").textContent = item.meta;
    elements.summaryGrid.appendChild(node);
  });
}

function renderFilters() {
  if (!state.sources.length) {
    return;
  }

  renderChipGroup(elements.videoTypeFilters, ["全部", ...uniqueVideoTypes()], state.filters.videoType, (value) => {
    state.filters.videoType = value;
    renderFilters();
    renderSources();
  });

  renderChipGroup(elements.domainFilters, ["全部", ...DOMAIN_ORDER], state.filters.domain, (value) => {
    state.filters.domain = value;
    renderFilters();
    renderSources();
  });

  renderChipGroup(elements.riskFilters, ["全部", ...uniqueRiskTags()], state.filters.risk, (value) => {
    state.filters.risk = value;
    renderFilters();
    renderSources();
  });
}

function renderChipGroup(container, values, activeValue, onSelect) {
  container.innerHTML = "";

  values.forEach((value) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `filter-chip${value === activeValue ? " active" : ""}`;
    button.textContent = value;
    button.addEventListener("click", () => onSelect(value));
    container.appendChild(button);
  });
}

function uniqueVideoTypes() {
  return Array.from(new Set(state.sources.map((source) => source.videoType))).sort();
}

function uniqueRiskTags() {
  return Array.from(
    new Set(state.sources.flatMap((source) => source.riskTagList).filter(Boolean))
  ).sort();
}

function renderSources() {
  elements.sourceList.innerHTML = "";
  if (!state.sources.length) {
    return;
  }

  const filteredSources = state.sources.filter(matchesFilters);

  if (!filteredSources.length) {
    const empty = document.createElement("article");
    empty.className = "empty-panel fade-in";
    empty.innerHTML = "<h2>当前筛选下没有命中结果</h2><p>可以尝试清空关键词或放宽资产域 / 风险标签过滤。</p>";
    elements.sourceList.appendChild(empty);
    return;
  }

  filteredSources.forEach((source, index) => {
    const activeDomain =
      state.activeDomains[source.sourceId] && source.domainOrder.includes(state.activeDomains[source.sourceId])
        ? state.activeDomains[source.sourceId]
        : source.domainOrder[0];
    state.activeDomains[source.sourceId] = activeDomain;
    elements.sourceList.appendChild(buildSourceCard(source, activeDomain, index));
  });
}

function matchesFilters(source) {
  const search = state.filters.search.toLowerCase();
  if (search && !source.searchableText.includes(search)) {
    return false;
  }

  if (state.filters.videoType !== "全部" && source.videoType !== state.filters.videoType) {
    return false;
  }

  if (
    state.filters.domain !== "全部" &&
    !(source.domainMap[state.filters.domain] && source.domainMap[state.filters.domain].length)
  ) {
    return false;
  }

  if (state.filters.risk !== "全部" && !source.riskTagList.includes(state.filters.risk)) {
    return false;
  }

  if (state.filters.verificationOnly && !source.hasVerificationNeed) {
    return false;
  }

  return true;
}

function buildSourceCard(source, activeDomain, index = 0) {
  const card = document.createElement("article");
  card.className = "source-card fade-in";
  card.dataset.sourceId = source.sourceId;
  card.style.setProperty("--stagger-index", String(index));

  const videoPanel = document.createElement("section");
  videoPanel.className = "video-panel";
  videoPanel.appendChild(buildVideoStage(source));
  videoPanel.appendChild(buildVideoMeta(source));

  const assetStage = document.createElement("section");
  assetStage.className = "asset-stage";
  assetStage.appendChild(buildDomainTabs(source, activeDomain));
  assetStage.appendChild(buildAssetStagePanel(source, activeDomain));

  card.appendChild(videoPanel);
  card.appendChild(assetStage);
  return card;
}

function buildVideoStage(source) {
  const stage = document.createElement(source.videoUrl ? "a" : "div");
  stage.className = `video-stage${source.videoUrl ? " has-link is-clickable" : ""}`;

  if (source.videoUrl) {
    stage.href = source.videoUrl;
    stage.target = "_blank";
    stage.rel = "noreferrer";
    const domain = safeUrlHost(source.videoUrl);
    stage.innerHTML = `
      <div class="video-stage-top">
        <span class="video-tagline">Source Video Spotlight</span>
        <span class="video-url-label">${domain}</span>
      </div>
      <div class="play-orb">▶</div>
      <div class="video-stage-bottom">
        <div>
          <h3>${escapeHtml(source.videoType || "未分类视频")}</h3>
          <p>以源视频为中心聚合 ${source.assets.length} 张资产卡</p>
        </div>
        <span class="link-chip">
          打开 video_url
        </span>
      </div>
    `;
    return stage;
  }

  stage.innerHTML = `
    <div class="video-fallback">
      <span class="video-tagline">Video URL Missing</span>
      <h3>当前源视频没有可用的 video_url</h3>
      <p>界面仍会保留完整的源视频母卡，并根据理解文本、视频分类和资产结构完成可视化展示。</p>
    </div>
  `;
  return stage;
}

function buildVideoMeta(source) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <div class="source-header">
      <div>
        <h3 class="source-title">来源 ${escapeHtml(source.sourceId)}</h3>
        <p class="source-subtitle">${escapeHtml(source.videoType)} · ${escapeHtml(source.sourceType)}</p>
      </div>
      <div class="status-cluster">
        <span class="status-pill">${source.assets.length} 张资产</span>
        ${
          source.hasVerificationNeed
            ? '<span class="status-pill">含待验证 knowledge</span>'
            : ""
        }
      </div>
    </div>
    <dl class="source-meta">
      <div>
        <dt>作者 ID</dt>
        <dd>${escapeHtml(source.authorId || "未知")}</dd>
      </div>
      <div>
        <dt>资产域覆盖</dt>
        <dd>${escapeHtml(source.domainOrder.map((domain) => DOMAIN_LABELS[domain]).join(" / "))}</dd>
      </div>
    </dl>
    <div class="meta-cluster">
      ${source.riskTagList.length ? source.riskTagList.map((tag) => `<span class="asset-badge">${escapeHtml(tag)}</span>`).join("") : '<span class="asset-badge">无风险标签</span>'}
    </div>
    <div class="understanding-preview-block">
      <p class="understanding-snippet">${escapeHtml(source.understandingPreview || "暂无理解文本")}</p>
      <button class="link-chip understanding-trigger" type="button" data-source-id="${escapeAttribute(source.sourceId)}">
        查看完整理解内容
      </button>
    </div>
  `;
  wrapper
    .querySelector(".understanding-trigger")
    .addEventListener("click", () => openUnderstandingDrawer(source.sourceId));
  return wrapper;
}

function buildDomainTabs(source, activeDomain) {
  const tabs = document.createElement("div");
  tabs.className = "domain-tabs";

  source.domainOrder.forEach((domain) => {
    const count = source.domainMap[domain].length;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `domain-tab${domain === activeDomain ? " active" : ""}`;
    button.dataset.domain = domain;
    button.textContent = `${DOMAIN_LABELS[domain]} ${count}`;
    button.addEventListener("click", () => {
      state.activeDomains[source.sourceId] = domain;
      switchSourceDomain(source.sourceId, domain);
    });
    tabs.appendChild(button);
  });

  return tabs;
}

function buildAssetStagePanel(source, activeDomain) {
  const panel = document.createElement("div");
  panel.className = "asset-stage-panel";
  const track = document.createElement("div");
  track.className = "asset-stage-track";
  track.dataset.sourceId = source.sourceId;

  source.domainOrder.forEach((domain) => {
    const page = document.createElement("section");
    page.className = "asset-domain-page";
    page.dataset.domain = domain;
    page.appendChild(buildAssetGrid(source.domainMap[domain], domain, source));
    track.appendChild(page);
  });

  const activeIndex = source.domainOrder.indexOf(activeDomain);
  track.style.transform = `translateX(-${Math.max(activeIndex, 0) * 100}%)`;

  panel.appendChild(track);
  return panel;
}

function switchSourceDomain(sourceId, domain) {
  const source = findSourceById(sourceId);
  const card = elements.sourceList.querySelector(
    `[data-source-id="${escapeAttribute(sourceId)}"]`
  );
  if (!source || !card) {
    renderSources();
    return;
  }

  const tabs = card.querySelectorAll(".domain-tab");
  tabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.domain === domain);
  });

  const track = card.querySelector(".asset-stage-track");
  if (!track) {
    renderSources();
    return;
  }

  const activeIndex = source.domainOrder.indexOf(domain);
  track.style.transform = `translateX(-${Math.max(activeIndex, 0) * 100}%)`;
}

function buildAssetGrid(assets, domain, source) {
  if (!assets.length) {
    const empty = document.createElement("div");
    empty.className = "empty-domain";
    empty.textContent = "当前资产域暂无内容";
    return empty;
  }

  const grid = document.createElement("div");
  grid.className = "asset-grid";

  assets.forEach((asset) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "asset-card";
    card.dataset.domain = domain;
    card.innerHTML = buildAssetCardMarkup(asset, source);
    card.addEventListener("click", () => openAssetDrawer(asset.id));
    grid.appendChild(card);
  });

  return grid;
}

function buildAssetCardMarkup(asset, source) {
  const footerPills = [];
  if (asset.skillFit.length) {
    footerPills.push(`<span class="mini-pill">${escapeHtml(asset.skillFit[0])}</span>`);
  }
  if (asset.triggerFit.length) {
    footerPills.push(`<span class="mini-pill">${escapeHtml(asset.triggerFit[0])}</span>`);
  }
  if (asset.assetDomain === "knowledge" && asset.needsVerification) {
    footerPills.push('<span class="mini-pill">needs verification</span>');
  }

  return `
    <div class="asset-card-header">
      <span class="asset-domain-label">${DOMAIN_TITLES[asset.assetDomain]}</span>
      <span class="mini-pill">${escapeHtml(source.videoType)}</span>
    </div>
    <h4>${escapeHtml(summarizeText(asset.title, 48))}</h4>
    <p>${escapeHtml(summarizeText(asset.summary, asset.assetDomain === "persona" ? 88 : 116) || "点击查看完整资产内容")}</p>
    <div class="asset-card-footer">${footerPills.join("")}</div>
  `;
}

function openAssetDrawer(assetId) {
  state.drawer = { type: "asset", id: assetId };
  renderDrawer();
}

function openUnderstandingDrawer(sourceId) {
  state.drawer = { type: "understanding", id: sourceId };
  renderDrawer();
}

function closeDrawer() {
  state.drawer = null;
  renderDrawer();
}

function renderDrawer() {
  const payload = state.drawer;
  const asset = payload?.type === "asset" ? findAssetById(payload.id) : null;
  const source = payload?.type === "understanding" ? findSourceById(payload.id) : asset ? findSourceById(asset.sourceId) : null;
  const open = Boolean(asset || source);
  elements.detailDrawer.classList.toggle("open", open);
  elements.detailDrawer.setAttribute("aria-hidden", String(!open));
  elements.drawerContent.innerHTML = "";

  if (!open) {
    return;
  }

  if (payload?.type === "understanding" && source) {
    renderUnderstandingDrawer(source);
    return;
  }

  const sections = buildDetailSections(asset);
  elements.drawerContent.innerHTML = `
    <div class="drawer-topline">
      <span class="status-pill">${DOMAIN_TITLES[asset.assetDomain]}</span>
      <span class="status-pill">${escapeHtml(asset.videoType)}</span>
      <span class="status-pill">来源 ${escapeHtml(asset.sourceId)}</span>
    </div>
    <h3 class="drawer-title">${escapeHtml(asset.title)}</h3>
    <p class="hero-text">${escapeHtml(asset.summary || "该资产没有可提炼摘要，请查看结构化字段。")}</p>
    <div class="detail-grid">
      <dl class="detail-kv">
        <dt>技能匹配</dt>
        <dd>${escapeHtml(asset.skillFit.join(" / ") || "无")}</dd>
      </dl>
      <dl class="detail-kv">
        <dt>触发时机</dt>
        <dd>${escapeHtml(asset.triggerFit.join(" / ") || "无")}</dd>
      </dl>
      <dl class="detail-kv">
        <dt>风险标签</dt>
        <dd>${escapeHtml(asset.riskTags.join(" / ") || "无")}</dd>
      </dl>
      <dl class="detail-kv">
        <dt>源视频链接</dt>
        <dd>${
          source && source.videoUrl
            ? `<a href="${escapeAttribute(source.videoUrl)}" target="_blank" rel="noreferrer">${escapeHtml(source.videoUrl)}</a>`
            : "无可用 video_url"
        }</dd>
      </dl>
    </div>
    ${sections}
  `;
}

function renderUnderstandingDrawer(source) {
  elements.drawerContent.innerHTML = `
    <div class="drawer-topline">
      <span class="status-pill">完整理解内容</span>
      <span class="status-pill">${escapeHtml(source.videoType)}</span>
      <span class="status-pill">${escapeHtml(source.sourceType)}</span>
    </div>
    <h3 class="drawer-title">来源 ${escapeHtml(source.sourceId)}</h3>
    <p class="hero-text">这里展示该源视频聚合卡对应的完整理解文本。内容较长时可在卡片内部滚动查看。</p>
    <section class="detail-section">
      <h4>完整理解文本</h4>
      <div class="understanding-fulltext">${escapeHtml(source.understandingTextFormatted || "暂无理解文本")}</div>
    </section>
    <section class="detail-section">
      <h4>上下文信息</h4>
      <div class="detail-grid">
        <dl class="detail-kv">
          <dt>作者 ID</dt>
          <dd>${escapeHtml(source.authorId || "未知")}</dd>
        </dl>
        <dl class="detail-kv">
          <dt>资产数量</dt>
          <dd>${source.assets.length}</dd>
        </dl>
        <dl class="detail-kv">
          <dt>资产域</dt>
          <dd>${escapeHtml(source.domainOrder.map((domain) => DOMAIN_LABELS[domain]).join(" / "))}</dd>
        </dl>
        <dl class="detail-kv">
          <dt>视频链接</dt>
          <dd>${
            source.videoUrl
              ? `<a href="${escapeAttribute(source.videoUrl)}" target="_blank" rel="noreferrer">${escapeHtml(source.videoUrl)}</a>`
              : "无可用 video_url"
          }</dd>
        </dl>
      </div>
    </section>
  `;
}

function buildDetailSections(asset) {
  const fields = asset.assetFields;
  const sections = [];

  Object.entries(fields).forEach(([key, value]) => {
    if (value === "" || value == null) {
      return;
    }
    if (Array.isArray(value)) {
      sections.push(`
        <section class="detail-section">
          <h4>${escapeHtml(key)}</h4>
          <ul>${value.map((item) => `<li>${escapeHtml(stringifyValue(item))}</li>`).join("")}</ul>
        </section>
      `);
      return;
    }

    sections.push(`
      <section class="detail-section">
        <h4>${escapeHtml(key)}</h4>
        <p>${escapeHtml(stringifyValue(value))}</p>
      </section>
    `);
  });

  if (!sections.length) {
    return `
      <section class="detail-section">
        <h4>原始资产内容</h4>
        <p>${escapeHtml(asset.assetContentRaw || "无")}</p>
      </section>
    `;
  }

  return sections.join("");
}

function stringifyValue(value) {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

function findAssetById(assetId) {
  if (!assetId) {
    return null;
  }

  for (const source of state.sources) {
    const asset = source.assets.find((item) => item.id === assetId);
    if (asset) {
      return asset;
    }
  }

  return null;
}

function findSourceById(sourceId) {
  return state.sources.find((source) => source.sourceId === sourceId) || null;
}

function safeUrlHost(url) {
  try {
    return new URL(url).hostname;
  } catch (error) {
    return url;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

init();
