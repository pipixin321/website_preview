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
  fileNames: [],
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
  activeVersions: {},
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
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length) {
      loadFiles(files);
    }
  });

  elements.fileInput.addEventListener("change", (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length) {
      loadFiles(files);
    }
  });

  elements.loadSample.addEventListener("click", async () => {
    try {
      const response = await fetch("./test_csv.csv");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const text = await response.text();
      hydrateFromCsvFiles([{ text, fileName: "test_csv.csv" }]);
    } catch (error) {
      elements.fileStatus.textContent =
        "测试数据加载失败。若是直接打开 HTML 文件，请改用拖拽 CSV 方式。";
      console.error(error);
    }
  });

  elements.clearData.addEventListener("click", () => {
    state.fileNames = [];
    state.rawRows = [];
    state.sources = [];
    state.activeDomains = {};
    state.activeVersions = {};
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

async function loadFiles(files) {
  const payloads = await Promise.all(
    files.map(async (file) => ({
      fileName: file.name,
      text: await file.text(),
    }))
  );
  hydrateFromCsvFiles(payloads);
}

function hydrateFromCsvFiles(filePayloads) {
  const rows = filePayloads
    .flatMap(({ text, fileName }) =>
      parseCsv(text).map((row, index) => normalizeRow(row, index, fileName))
    )
    .filter((row) => row.sourceId);
  resetFilters();
  state.fileNames = filePayloads.map((item) => item.fileName);
  state.rawRows = rows;
  state.sources = groupRowsBySource(rows);
  state.activeDomains = {};
  state.activeVersions = {};
  state.drawer = null;

  state.sources.forEach((source) => {
    const defaultVersion = source.versionOrder[source.versionOrder.length - 1] || "";
    const versionData = findVersionByName(source, defaultVersion);
    state.activeVersions[source.sourceId] = versionData?.versionName || "";
    state.activeDomains[source.sourceId] = versionData?.domainOrder[0] || "story";
  });

  elements.fileStatus.textContent = `已载入 ${filePayloads.length} 个版本文件，共 ${rows.length} 条资产记录，覆盖 ${state.sources.length} 个源视频`;
  render();
  requestAnimationFrame(() => {
    renderSources();
    renderDrawer();
  });
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

function normalizeRow(row, index, versionName) {
  const assetFields = parseAssetContent(row["资产内容"] || "");
  const skillFit = parseListish(row["技能匹配"]);
  const triggerFit = parseListish(row["触发时机"]);
  const riskTags = parseListish(row["字段_risk_tags"]);
  const userQueries = parseListish(
    readAliasedValue(row, ["用户查询", "user_queries", "userQueries", "queries", "query"])
  );
  const videoUrl = (row["视频链接"] || "").trim();

  return {
    id: `${versionName}-${row["来源ID"] || "source"}-${index}`,
    versionName,
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
    userQueries,
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
    return (Array.isArray(parsed) ? parsed : [String(parsed)])
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  } catch (error) {
    return text
      .split(/[;,\n，；]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function readAliasedValue(row, aliases) {
  for (const alias of aliases) {
    const value = row[alias];
    if (value != null && String(value).trim()) {
      return value;
    }
  }
  return "";
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
    const existing = sources.get(row.sourceId) || createEmptySourceGroup(row);
    if (!existing.versionMap[row.versionName]) {
      existing.versionMap[row.versionName] = createEmptyVersionSource(row);
      existing.versionOrder.push(row.versionName);
    }
    const versionSource = existing.versionMap[row.versionName];
    versionSource.videoUrl = versionSource.videoUrl || row.videoUrl;
    versionSource.authorId = versionSource.authorId || row.authorId;
    versionSource.authorProfile = versionSource.authorProfile || row.authorProfile;
    versionSource.sourceType = versionSource.sourceType || row.sourceType;
    versionSource.videoType = versionSource.videoType || row.videoType;
    versionSource.understandingText = pickLongerText(
      versionSource.understandingText,
      row.understandingText
    );
    versionSource.userQueries = mergeUniqueStrings(versionSource.userQueries, row.userQueries);
    versionSource.assets.push(row);
    row.riskTags.forEach((tag) => versionSource.riskTags.add(tag));
    if (row.needsVerification) {
      versionSource.hasVerificationNeed = true;
    }
    sources.set(row.sourceId, existing);
  });

  return Array.from(sources.values())
    .map((source) => finalizeSourceGroup(source))
    .sort((left, right) => {
      const sourceTypePriority = compareSourceTypePriority(
        left.primaryVersion?.sourceType,
        right.primaryVersion?.sourceType
      );
      if (sourceTypePriority !== 0) {
        return sourceTypePriority;
      }
      return right.totalAssets - left.totalAssets;
    });
}

function createEmptySourceGroup(row) {
  return {
    sourceId: row.sourceId,
    versionMap: {},
    versionOrder: [],
  };
}

function createEmptyVersionSource(row) {
  return {
    sourceId: row.sourceId,
    versionName: row.versionName,
    authorId: row.authorId,
    authorProfile: row.authorProfile,
    sourceType: row.sourceType,
    videoUrl: row.videoUrl,
    videoType: row.videoType,
    understandingText: row.understandingText,
    userQueries: row.userQueries.slice(),
    assets: [],
    riskTags: new Set(),
    hasVerificationNeed: false,
  };
}

function finalizeSourceGroup(source) {
  const versionMap = {};
  source.versionOrder.forEach((versionName) => {
    versionMap[versionName] = finalizeVersionSource(source.versionMap[versionName]);
  });

  const primaryVersion = versionMap[source.versionOrder[source.versionOrder.length - 1]] || null;
  const searchableText = source.versionOrder
    .map((versionName) => versionMap[versionName]?.searchableText || "")
    .join(" ")
    .toLowerCase();

  return {
    sourceId: source.sourceId,
    versionMap,
    versionOrder: source.versionOrder,
    primaryVersion,
    totalAssets: source.versionOrder.reduce(
      (sum, versionName) => sum + (versionMap[versionName]?.assets.length || 0),
      0
    ),
    searchableText,
  };
}

function finalizeVersionSource(source) {
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
    source.userQueries.join(" "),
    ...source.assets.flatMap((asset) => [
      asset.title,
      asset.summary,
      asset.assetContentRaw,
      asset.skillFit.join(" "),
      asset.triggerFit.join(" "),
      asset.userQueries.join(" "),
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

function mergeUniqueStrings(current = [], incoming = []) {
  return Array.from(
    new Set(
      [...current, ...incoming]
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  );
}

function findVersionByName(source, versionName) {
  if (!source) {
    return null;
  }

  if (versionName && source.versionMap[versionName]) {
    return source.versionMap[versionName];
  }

  const fallbackVersion = source.versionOrder[source.versionOrder.length - 1] || source.versionOrder[0];
  return fallbackVersion ? source.versionMap[fallbackVersion] || null : null;
}

function versionMatchesFilters(version) {
  if (!version) {
    return false;
  }

  const search = state.filters.search.toLowerCase();
  if (search && !version.searchableText.includes(search)) {
    return false;
  }

  if (state.filters.videoType !== "全部" && version.videoType !== state.filters.videoType) {
    return false;
  }

  if (
    state.filters.domain !== "全部" &&
    !(version.domainMap[state.filters.domain] && version.domainMap[state.filters.domain].length)
  ) {
    return false;
  }

  if (state.filters.risk !== "全部" && !version.riskTagList.includes(state.filters.risk)) {
    return false;
  }

  if (state.filters.verificationOnly && !version.hasVerificationNeed) {
    return false;
  }

  return true;
}

function hasActiveFilters() {
  return Boolean(
    state.filters.search ||
      state.filters.videoType !== "全部" ||
      state.filters.domain !== "全部" ||
      state.filters.risk !== "全部" ||
      state.filters.verificationOnly
  );
}

function resolveVisibleVersion(source) {
  const activeVersion = findVersionByName(source, state.activeVersions[source.sourceId]);
  if (!hasActiveFilters()) {
    return activeVersion;
  }
  if (versionMatchesFilters(activeVersion)) {
    return activeVersion;
  }

  for (let index = source.versionOrder.length - 1; index >= 0; index -= 1) {
    const versionName = source.versionOrder[index];
    const candidate = source.versionMap[versionName];
    if (versionMatchesFilters(candidate)) {
      state.activeVersions[source.sourceId] = versionName;
      return candidate;
    }
  }

  return activeVersion || findVersionByName(source);
}

function syncSourceSelection(source) {
  const activeVersion = resolveVisibleVersion(source);
  if (!activeVersion) {
    return { activeVersion: null, activeDomain: "" };
  }

  state.activeVersions[source.sourceId] = activeVersion.versionName;
  const activeDomain =
    state.activeDomains[source.sourceId] &&
    activeVersion.domainOrder.includes(state.activeDomains[source.sourceId])
      ? state.activeDomains[source.sourceId]
      : activeVersion.domainOrder[0] || "";
  state.activeDomains[source.sourceId] = activeDomain;

  return { activeVersion, activeDomain };
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
  runRenderStep(renderSources, "renderSources");
  runRenderStep(renderSummary, "renderSummary");
  runRenderStep(renderFilters, "renderFilters");
  runRenderStep(renderDrawer, "renderDrawer");
}

function runRenderStep(step, label) {
  try {
    step();
  } catch (error) {
    console.error(`[${label}]`, error);
  }
}

function renderSummary() {
  elements.summaryGrid.innerHTML = "";
  if (!state.sources.length) {
    return;
  }

  const allVersions = state.sources.flatMap((source) =>
    source.versionOrder.map((versionName) => source.versionMap[versionName])
  );
  const missingVideoSources = allVersions.filter((source) => !source.videoUrl).length;
  const sourcesWithUserQueries = allVersions.filter((source) => source.userQueries.length).length;
  const summaryItems = [
    {
      label: "源视频",
      value: state.sources.length,
      meta: `${state.fileNames.length || 0} 个版本文件按 source_id 聚合后的母卡数量`,
    },
    {
      label: "版本文件",
      value: state.fileNames.length,
      meta: state.fileNames.join(" / ") || "当前未载入版本文件",
    },
    {
      label: "资产总数",
      value: state.rawRows.length,
      meta: `平均每个源视频 ${(state.rawRows.length / state.sources.length).toFixed(1)} 张版本化资产卡`,
    },
    {
      label: "待验证版本",
      value: allVersions.filter((source) => source.hasVerificationNeed).length,
      meta: "至少包含一张 needs_verification 为 True 的 knowledge 卡",
    },
    {
      label: "缺视频链接版本",
      value: missingVideoSources,
      meta: "这些版本会回退为抽象视频舞台，不依赖 video_url",
    },
    {
      label: "查询覆盖版本",
      value: sourcesWithUserQueries,
      meta: sourcesWithUserQueries
        ? `平均每个命中版本 ${(allVersions.reduce((sum, source) => sum + source.userQueries.length, 0) / sourcesWithUserQueries).toFixed(1)} 条用户查询`
        : "当前数据中还没有 user_queries / 用户查询 字段内容",
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
  return Array.from(
    new Set(
      state.sources.flatMap((source) =>
        source.versionOrder.map((versionName) => source.versionMap[versionName].videoType)
      )
    )
  ).sort();
}

function uniqueRiskTags() {
  return Array.from(
    new Set(
      state.sources
        .flatMap((source) =>
          source.versionOrder.flatMap((versionName) => source.versionMap[versionName].riskTagList)
        )
        .filter(Boolean)
    )
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
    const { activeVersion, activeDomain } = syncSourceSelection(source);
    if (!activeVersion) {
      return;
    }
    elements.sourceList.appendChild(buildSourceCard(source, activeVersion, activeDomain, index));
  });
}

function matchesFilters(source) {
  if (!hasActiveFilters()) {
    return true;
  }
  return source.versionOrder.some((versionName) =>
    versionMatchesFilters(source.versionMap[versionName])
  );
}

function buildSourceCard(source, activeVersion, activeDomain, index = 0) {
  const card = document.createElement("article");
  card.className = "source-card fade-in";
  card.dataset.sourceId = source.sourceId;
  card.style.setProperty("--stagger-index", String(index));

  const videoPanel = document.createElement("section");
  videoPanel.className = "video-panel";
  videoPanel.appendChild(buildVideoStage(activeVersion));
  videoPanel.appendChild(buildVideoMeta(source, activeVersion));

  const assetStage = document.createElement("section");
  assetStage.className = "asset-stage";
  assetStage.appendChild(buildVersionTabs(source, activeVersion.versionName));
  assetStage.appendChild(buildDomainTabs(source.sourceId, activeVersion, activeDomain));
  assetStage.appendChild(buildAssetStagePanel(activeVersion, activeDomain));

  card.appendChild(videoPanel);
  card.appendChild(assetStage);
  return card;
}

function buildVideoStage(version) {
  const stage = document.createElement(version.videoUrl ? "a" : "div");
  stage.className = `video-stage${version.videoUrl ? " has-link is-clickable" : ""}`;

  if (version.videoUrl) {
    stage.href = version.videoUrl;
    stage.target = "_blank";
    stage.rel = "noreferrer";
    const domain = safeUrlHost(version.videoUrl);
    stage.innerHTML = `
      <div class="video-stage-top">
        <span class="video-tagline">Source Video Spotlight</span>
        <span class="video-url-label">${domain}</span>
      </div>
      <div class="play-orb">▶</div>
      <div class="video-stage-bottom">
        <div>
          <h3>${escapeHtml(version.videoType || "未分类视频")}</h3>
          <p>当前版本聚合 ${version.assets.length} 张资产卡</p>
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

function buildVideoMeta(source, version) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <div class="source-header">
      <div>
        <h3 class="source-title">来源 ${escapeHtml(source.sourceId)}</h3>
        <p class="source-subtitle">${escapeHtml(version.videoType)} · ${escapeHtml(version.sourceType)}</p>
      </div>
      <div class="status-cluster">
        <span class="status-pill">${version.assets.length} 张资产</span>
        <span class="status-pill">${escapeHtml(version.versionName)}</span>
        ${
          version.hasVerificationNeed
            ? '<span class="status-pill">含待验证 knowledge</span>'
            : ""
        }
      </div>
    </div>
    <dl class="source-meta">
      <div>
        <dt>作者 ID</dt>
        <dd>${escapeHtml(version.authorId || "未知")}</dd>
      </div>
      <div>
        <dt>资产域覆盖</dt>
        <dd>${escapeHtml(version.domainOrder.map((domain) => DOMAIN_LABELS[domain]).join(" / "))}</dd>
      </div>
    </dl>
    <div class="meta-cluster">
      ${version.riskTagList.length ? version.riskTagList.map((tag) => `<span class="asset-badge">${escapeHtml(tag)}</span>`).join("") : '<span class="asset-badge">无风险标签</span>'}
    </div>
    ${
      version.userQueries.length
        ? `
          <div class="query-preview-block">
            <div class="query-preview-header">
              <strong>用户查询</strong>
              <span class="query-preview-meta">${version.userQueries.length} 条</span>
            </div>
            <div class="meta-cluster">
              ${version.userQueries
                .slice(0, 6)
                .map((query) => `<span class="asset-badge">${escapeHtml(query)}</span>`)
                .join("")}
              ${
                version.userQueries.length > 6
                  ? `<span class="asset-badge">+${version.userQueries.length - 6}</span>`
                  : ""
              }
            </div>
          </div>
        `
        : ""
    }
    <div class="understanding-preview-block">
      <p class="understanding-snippet">${escapeHtml(version.understandingPreview || "暂无理解文本")}</p>
      <button class="link-chip understanding-trigger" type="button" data-source-id="${escapeAttribute(source.sourceId)}" data-version-name="${escapeAttribute(version.versionName)}">
        查看完整理解内容
      </button>
    </div>
  `;
  wrapper
    .querySelector(".understanding-trigger")
    .addEventListener("click", () => openUnderstandingDrawer(source.sourceId, version.versionName));
  return wrapper;
}

function buildVersionTabs(source, activeVersion) {
  const tabs = document.createElement("div");
  tabs.className = "version-tabs";

  source.versionOrder.forEach((versionName) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `version-tab${versionName === activeVersion ? " active" : ""}`;
    button.dataset.versionName = versionName;
    button.textContent = versionName;
    button.addEventListener("click", () => {
      state.activeVersions[source.sourceId] = versionName;
      const versionData = findVersionByName(source, versionName);
      if (versionData && !versionData.domainOrder.includes(state.activeDomains[source.sourceId])) {
        state.activeDomains[source.sourceId] = versionData.domainOrder[0] || "story";
      }
      if (state.drawer?.type === "understanding" && state.drawer.id === source.sourceId) {
        state.drawer.versionName = versionName;
      }
      renderSources();
      renderDrawer();
    });
    tabs.appendChild(button);
  });

  return tabs;
}

function buildDomainTabs(sourceId, version, activeDomain) {
  const tabs = document.createElement("div");
  tabs.className = "domain-tabs";

  version.domainOrder.forEach((domain) => {
    const count = version.domainMap[domain].length;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `domain-tab${domain === activeDomain ? " active" : ""}`;
    button.dataset.domain = domain;
    button.textContent = `${DOMAIN_LABELS[domain]} ${count}`;
    button.addEventListener("click", () => {
      state.activeDomains[sourceId] = domain;
      switchSourceDomain(sourceId, domain);
    });
    tabs.appendChild(button);
  });

  return tabs;
}

function buildAssetStagePanel(version, activeDomain) {
  const panel = document.createElement("div");
  panel.className = "asset-stage-panel";
  const track = document.createElement("div");
  track.className = "asset-stage-track";
  track.dataset.sourceId = version.sourceId;
  track.dataset.versionName = version.versionName;

  version.domainOrder.forEach((domain) => {
    const page = document.createElement("section");
    page.className = "asset-domain-page";
    page.dataset.domain = domain;
    page.appendChild(buildAssetGrid(version.domainMap[domain], domain, version));
    track.appendChild(page);
  });

  const activeIndex = version.domainOrder.indexOf(activeDomain);
  track.style.transform = `translateX(-${Math.max(activeIndex, 0) * 100}%)`;

  panel.appendChild(track);
  return panel;
}

function switchSourceDomain(sourceId, domain) {
  const source = findSourceById(sourceId);
  const version = resolveVisibleVersion(source);
  const card = elements.sourceList.querySelector(
    `[data-source-id="${escapeAttribute(sourceId)}"]`
  );
  if (!source || !version || !card) {
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

  const activeIndex = version.domainOrder.indexOf(domain);
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
  if (asset.userQueries.length) {
    footerPills.push(`<span class="mini-pill">${asset.userQueries.length} 条 query</span>`);
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

function openUnderstandingDrawer(sourceId, versionName) {
  state.drawer = { type: "understanding", id: sourceId, versionName };
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
  const version =
    payload?.type === "understanding"
      ? findVersionByName(source, payload.versionName)
      : asset
        ? findVersionByName(source, asset.versionName)
        : null;
  const open = Boolean(asset || version);
  elements.detailDrawer.classList.toggle("open", open);
  elements.detailDrawer.setAttribute("aria-hidden", String(!open));
  elements.drawerContent.innerHTML = "";

  if (!open) {
    return;
  }

  if (payload?.type === "understanding" && source && version) {
    renderUnderstandingDrawer(source, version);
    return;
  }

  const sections = buildDetailSections(asset);
  elements.drawerContent.innerHTML = `
    <div class="drawer-topline">
      <span class="status-pill">${DOMAIN_TITLES[asset.assetDomain]}</span>
      <span class="status-pill">${escapeHtml(asset.videoType)}</span>
      <span class="status-pill">${escapeHtml(asset.versionName)}</span>
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
        <dt>用户查询</dt>
        <dd>${escapeHtml(asset.userQueries.join(" / ") || "无")}</dd>
      </dl>
      <dl class="detail-kv">
        <dt>源视频链接</dt>
        <dd>${
          version && version.videoUrl
            ? `<a href="${escapeAttribute(version.videoUrl)}" target="_blank" rel="noreferrer">${escapeHtml(version.videoUrl)}</a>`
            : "无可用 video_url"
        }</dd>
      </dl>
    </div>
    ${buildQuerySection("关联用户查询", asset.userQueries)}
    ${sections}
  `;
}

function renderUnderstandingDrawer(source, version) {
  elements.drawerContent.innerHTML = `
    <div class="drawer-topline">
      <span class="status-pill">完整理解内容</span>
      <span class="status-pill">${escapeHtml(version.videoType)}</span>
      <span class="status-pill">${escapeHtml(version.sourceType)}</span>
      <span class="status-pill">${escapeHtml(version.versionName)}</span>
    </div>
    <h3 class="drawer-title">来源 ${escapeHtml(source.sourceId)}</h3>
    <p class="hero-text">这里展示该源视频聚合卡对应的完整理解文本。内容较长时可在卡片内部滚动查看。</p>
    <section class="detail-section">
      <h4>完整理解文本</h4>
      <div class="understanding-fulltext">${escapeHtml(version.understandingTextFormatted || "暂无理解文本")}</div>
    </section>
    <section class="detail-section">
      <h4>上下文信息</h4>
      <div class="detail-grid">
        <dl class="detail-kv">
          <dt>作者 ID</dt>
          <dd>${escapeHtml(version.authorId || "未知")}</dd>
        </dl>
        <dl class="detail-kv">
          <dt>资产数量</dt>
          <dd>${version.assets.length}</dd>
        </dl>
        <dl class="detail-kv">
          <dt>资产域</dt>
          <dd>${escapeHtml(version.domainOrder.map((domain) => DOMAIN_LABELS[domain]).join(" / "))}</dd>
        </dl>
        <dl class="detail-kv">
          <dt>视频链接</dt>
          <dd>${
            version.videoUrl
              ? `<a href="${escapeAttribute(version.videoUrl)}" target="_blank" rel="noreferrer">${escapeHtml(version.videoUrl)}</a>`
              : "无可用 video_url"
          }</dd>
        </dl>
      </div>
    </section>
    ${buildQuerySection("聚合用户查询", version.userQueries)}
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

function buildQuerySection(title, queries) {
  if (!queries.length) {
    return "";
  }

  return `
    <section class="detail-section">
      <h4>${escapeHtml(title)}</h4>
      <ul>${queries.map((query) => `<li>${escapeHtml(query)}</li>`).join("")}</ul>
    </section>
  `;
}

function findAssetById(assetId) {
  if (!assetId) {
    return null;
  }

  for (const source of state.sources) {
    for (const versionName of source.versionOrder) {
      const asset = source.versionMap[versionName].assets.find((item) => item.id === assetId);
      if (asset) {
        return asset;
      }
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
