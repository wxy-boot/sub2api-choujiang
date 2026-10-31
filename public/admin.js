const state = {
  password: sessionStorage.getItem("lotteryAdminPassword") || "",
  config: null,
  activeTab: sessionStorage.getItem("lotteryAdminTab") || "overview",
  recentDraws: []
};

const PALETTE = [
  "#0f8f83",
  "#2b72c4",
  "#6350c2",
  "#a83fa8",
  "#b45f26",
  "#94750f",
  "#2b8f5f",
  "#b03d54"
];

const elements = {
  loginPanel: document.querySelector("#loginPanel"),
  passwordInput: document.querySelector("#passwordInput"),
  loginButton: document.querySelector("#loginButton"),
  message: document.querySelector("#message"),
  adminTabs: document.querySelector("#adminTabs"),
  tabButtons: [...document.querySelectorAll(".tab-button")],
  tabPanels: [...document.querySelectorAll(".tab-page")],
  statsDateText: document.querySelector("#statsDateText"),
  todayCountText: document.querySelector("#todayCountText"),
  todayAmountText: document.querySelector("#todayAmountText"),
  monthUsersText: document.querySelector("#monthUsersText"),
  monthAmountText: document.querySelector("#monthAmountText"),
  allTimeCountText: document.querySelector("#allTimeCountText"),
  allTimeUsersText: document.querySelector("#allTimeUsersText"),
  allTimeAmountText: document.querySelector("#allTimeAmountText"),
  averagePrizeText: document.querySelector("#averagePrizeText"),
  expectedValueText: document.querySelector("#expectedValueText"),
  topPrizeText: document.querySelector("#topPrizeText"),
  topPrizeMeta: document.querySelector("#topPrizeMeta"),
  trendList: document.querySelector("#trendList"),
  prizeBreakdownList: document.querySelector("#prizeBreakdownList"),
  breakdownTotal: document.querySelector("#breakdownTotal"),
  winnerList: document.querySelector("#winnerList"),
  prizeCountText: document.querySelector("#prizeCountText"),
  prizeWeightText: document.querySelector("#prizeWeightText"),
  prizeEvText: document.querySelector("#prizeEvText"),
  prizeRows: document.querySelector("#prizeRows"),
  addPrizeButton: document.querySelector("#addPrizeButton"),
  reloadPrizesButton: document.querySelector("#reloadPrizesButton"),
  reloadButton: document.querySelector("#reloadButton"),
  saveButton: document.querySelector("#saveButton"),
  showProbabilityInput: document.querySelector("#showProbabilityInput"),
  notePrefixInput: document.querySelector("#notePrefixInput"),
  spendEnabledInput: document.querySelector("#spendEnabledInput"),
  spendRequiredInput: document.querySelector("#spendRequiredInput"),
  gatePreview: document.querySelector("#gatePreview"),
  saveGateButton: document.querySelector("#saveGateButton"),
  recordSearchInput: document.querySelector("#recordSearchInput"),
  clearSearchButton: document.querySelector("#clearSearchButton"),
  exportCsvButton: document.querySelector("#exportCsvButton"),
  historyMetaText: document.querySelector("#historyMetaText"),
  history: document.querySelector("#history"),
  systemGrid: document.querySelector("#systemGrid"),
  checklist: document.querySelector("#checklist")
};

boot();

function boot() {
  elements.passwordInput.value = state.password;
  elements.loginButton.addEventListener("click", () => void login());
  elements.passwordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      void login();
    }
  });

  for (const button of elements.tabButtons) {
    button.addEventListener("click", () => activateTab(button.dataset.tab));
  }

  elements.addPrizeButton.addEventListener("click", () => {
    addPrizeRow({
      id: `prize-${Date.now()}`,
      label: "新奖品",
      amount: 0.1,
      weight: 10,
      color: PALETTE[elements.prizeRows.children.length % PALETTE.length],
      enabled: true
    });
    updatePrizePreview();
  });
  elements.reloadPrizesButton.addEventListener("click", () => void loadConfig());
  elements.reloadButton.addEventListener("click", () => void loadConfig());
  elements.saveButton.addEventListener("click", () => void saveConfig());
  elements.saveGateButton.addEventListener("click", () => void saveConfig());
  elements.spendEnabledInput.addEventListener("change", renderGatePreview);
  elements.spendRequiredInput.addEventListener("input", renderGatePreview);
  elements.recordSearchInput.addEventListener("input", () => renderHistory());
  elements.clearSearchButton.addEventListener("click", () => {
    elements.recordSearchInput.value = "";
    renderHistory();
  });
  elements.exportCsvButton.addEventListener("click", exportHistoryCsv);

  if (state.password) {
    void loadConfig();
  }
}

async function login() {
  state.password = elements.passwordInput.value.trim();
  sessionStorage.setItem("lotteryAdminPassword", state.password);
  await loadConfig();
}

async function loadConfig() {
  try {
    const data = await adminFetch("/api/admin/config");
    state.config = data;
    state.recentDraws = Array.isArray(data.recentDraws) ? data.recentDraws : [];
    renderConfig();
    showMessage("配置已加载。", "success");
  } catch (error) {
    showMessage(error.message, "error");
  }
}

async function saveConfig() {
  elements.saveButton.disabled = true;
  elements.saveGateButton.disabled = true;

  try {
    const data = await adminFetch("/api/admin/config", {
      method: "PUT",
      body: {
        prizes: readPrizes(),
        notePrefix: elements.notePrefixInput.value.trim(),
        showProbability: elements.showProbabilityInput.checked,
        spendRequirement: {
          enabled: elements.spendEnabledInput.checked,
          requiredAmount: Number(elements.spendRequiredInput.value)
        }
      }
    });

    state.config = data;
    state.recentDraws = Array.isArray(data.recentDraws) ? data.recentDraws : [];
    renderStats(data.stats);
    renderPrizes(data.prizes);
    renderSettings(data);
    renderHistory();
    renderSystem(data.system);
    showMessage("配置已保存，新的抽奖会立即使用。", "success");
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    elements.saveButton.disabled = false;
    elements.saveGateButton.disabled = false;
  }
}

async function adminFetch(path, options = {}) {
  const basePath = window.__LOTTERY_BASE_PATH__ === "/" ? "" : window.__LOTTERY_BASE_PATH__;
  const response = await fetch(`${basePath}${path}`, {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Lottery-Admin-Password": state.password
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || "请求失败");
  }

  return payload;
}

function renderConfig() {
  const data = state.config;

  elements.loginPanel.hidden = true;
  elements.adminTabs.hidden = false;
  renderStats(data.stats);
  renderPrizes(data.prizes);
  renderSettings(data);
  renderHistory();
  renderSystem(data.system);
  activateTab(state.activeTab);
}

function renderStats(stats) {
  if (!stats) {
    return;
  }

  const unit = stats.unit || state.config?.unit || "";

  elements.statsDateText.textContent = `${stats.today} · 本月 ${stats.month}`;
  elements.todayCountText.textContent = `${stats.todayCount || 0} 次`;
  elements.todayAmountText.textContent = `${formatAmount(stats.todayAmount || 0)} ${unit}`;
  elements.monthUsersText.textContent = `${stats.monthUsers || 0} 人`;
  elements.monthAmountText.textContent = `${formatAmount(stats.monthAmount || 0)} ${unit}`;
  elements.allTimeCountText.textContent = `${stats.allTimeCount || 0} 次`;
  elements.allTimeUsersText.textContent = `${stats.allTimeUsers || 0} 人`;
  elements.allTimeAmountText.textContent = `${formatAmount(stats.allTimeAmount || 0)} ${unit}`;
  elements.averagePrizeText.textContent = `${formatAmount(stats.averagePrize || 0)} ${unit}`;
  elements.expectedValueText.textContent = `${formatAmount(stats.expectedValue || 0)} ${unit}`;

  if (stats.topPrize) {
    elements.topPrizeText.textContent = `${formatAmount(stats.topPrize.amount)} ${stats.topPrize.unit || unit}`;
    elements.topPrizeMeta.textContent = `${stats.topPrize.userDisplayName} · ${stats.topPrize.date} · ${stats.topPrize.prizeLabel || "奖品"}`;
  } else {
    elements.topPrizeText.textContent = "-";
    elements.topPrizeMeta.textContent = "还没有抽奖记录";
  }

  renderTrend(stats.dailyTrend || [], unit);
  renderBreakdown(stats.prizeBreakdown || [], unit);
  renderWinners(stats.topWinners || [], unit);

  elements.breakdownTotal.textContent =
    stats.monthCount > 0
      ? `本月共 ${stats.monthCount} 次抽奖 · 发放 ${formatAmount(stats.monthAmount || 0)} ${unit}`
      : "本月还没有产生抽奖数据。";
}

function renderTrend(trend, unit) {
  elements.trendList.textContent = "";

  if (trend.length === 0) {
    elements.trendList.innerHTML = '<p class="empty">还没有趋势数据。</p>';
    return;
  }

  const maxAmount = Math.max(...trend.map((entry) => Number(entry.amount || 0)), 0);

  for (const entry of trend) {
    const amount = Number(entry.amount || 0);
    const count = Number(entry.count || 0);
    const height = maxAmount > 0 && amount > 0 ? Math.max(6, Math.round((amount / maxAmount) * 100)) : 0;
    const column = document.createElement("article");

    column.className = `trend-column${count > 0 ? " has-data" : ""}`;
    column.title = `${entry.date} · ${count} 次 · ${formatAmount(amount)} ${unit}`;
    column.innerHTML = `
      <span class="trend-value">${amount > 0 ? formatAmount(amount) : ""}</span>
      <div class="trend-track"><i style="height: ${height}%"></i></div>
      <small>${escapeHtml(String(entry.date).slice(5))}</small>
    `;
    elements.trendList.append(column);
  }
}

function renderBreakdown(items, unit) {
  elements.prizeBreakdownList.textContent = "";

  if (items.length === 0) {
    elements.prizeBreakdownList.innerHTML = '<p class="empty">本月还没有抽奖记录。</p>';
    return;
  }

  const maxCount = Math.max(...items.map((entry) => Number(entry.count || 0)), 0);

  for (const entry of items) {
    const count = Number(entry.count || 0);
    const width = maxCount > 0 ? Math.max(8, Math.round((count / maxCount) * 100)) : 0;
    const item = document.createElement("article");

    item.className = "breakdown-item";
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(entry.label || "奖品")}</strong>
        <span>${count} 次 · ${formatAmount(entry.totalAmount || 0)} ${escapeHtml(entry.unit || unit)}</span>
      </div>
      <div class="breakdown-track"><i style="width: ${width}%"></i></div>
    `;
    elements.prizeBreakdownList.append(item);
  }
}

function renderWinners(winners, unit) {
  elements.winnerList.textContent = "";

  if (winners.length === 0) {
    elements.winnerList.innerHTML = '<p class="empty">还没有中奖用户。</p>';
    return;
  }

  for (const [index, entry] of winners.entries()) {
    const item = document.createElement("article");

    item.className = "winner-item";
    item.innerHTML = `
      <span>${index + 1}</span>
      <strong>${escapeHtml(entry.userDisplayName || entry.userName || entry.userEmail || `用户 ${entry.userId}`)}</strong>
      <small>${entry.drawCount || 0} 次抽奖</small>
      <b>${formatAmount(entry.totalAmount || 0)} ${escapeHtml(unit)}</b>
    `;
    elements.winnerList.append(item);
  }
}

function renderPrizes(prizes) {
  elements.prizeRows.textContent = "";

  for (const prize of prizes) {
    addPrizeRow(prize);
  }

  updatePrizePreview();
}

function addPrizeRow(prize) {
  const index = elements.prizeRows.children.length;
  const row = document.createElement("article");

  row.className = "prize-row";
  row.dataset.prizeId = prize.id;
  row.innerHTML = `
    <label class="cell cell-check">
      <span>启用</span>
      <input class="prize-enabled" type="checkbox" ${prize.enabled ? "checked" : ""} />
    </label>
    <label class="cell cell-label">
      <span>奖品名称</span>
      <input class="prize-label" type="text" maxlength="40" value="${escapeAttr(prize.label)}" placeholder="奖品名称" />
    </label>
    <label class="cell cell-amount">
      <span>金额</span>
      <input class="prize-amount" type="number" min="0" step="0.000001" value="${prize.amount}" />
    </label>
    <label class="cell cell-weight">
      <span>权重</span>
      <input class="prize-weight" type="number" min="0" step="0.000001" value="${prize.weight}" />
    </label>
    <label class="cell cell-color">
      <span>扇区颜色</span>
      <input class="prize-color" type="color" value="${safeColor(prize.color, index)}" />
    </label>
    <div class="cell cell-prob">
      <span>概率</span>
      <strong class="prize-probability">-</strong>
    </div>
    <button class="remove-prize" type="button" aria-label="删除奖品">×</button>
  `;

  row.querySelector(".remove-prize").addEventListener("click", () => {
    row.remove();
    updatePrizePreview();
  });

  for (const input of row.querySelectorAll("input")) {
    input.addEventListener("input", updatePrizePreview);
    input.addEventListener("change", updatePrizePreview);
  }

  elements.prizeRows.append(row);
}

function readPrizes() {
  return [...elements.prizeRows.querySelectorAll(".prize-row")].map((row, index) => ({
    id: row.dataset.prizeId || `prize-${index + 1}`,
    label: row.querySelector(".prize-label").value.trim(),
    amount: Number(row.querySelector(".prize-amount").value || 0),
    weight: Number(row.querySelector(".prize-weight").value || 0),
    color: row.querySelector(".prize-color").value,
    enabled: row.querySelector(".prize-enabled").checked
  }));
}

function updatePrizePreview() {
  const rows = [...elements.prizeRows.querySelectorAll(".prize-row")];
  const entries = rows.map((row) => ({
    enabled: row.querySelector(".prize-enabled").checked,
    weight: Number(row.querySelector(".prize-weight").value) || 0,
    amount: Number(row.querySelector(".prize-amount").value) || 0
  }));
  const totalWeight = entries
    .filter((entry) => entry.enabled && entry.weight > 0)
    .reduce((sum, entry) => sum + entry.weight, 0);
  const active = entries.filter((entry) => entry.enabled && entry.weight > 0);
  const expectedValue =
    totalWeight > 0
      ? active.reduce((sum, entry) => sum + (entry.amount * entry.weight) / totalWeight, 0)
      : 0;
  const unit = state.config?.unit || "";

  rows.forEach((row, index) => {
    const entry = entries[index];
    const probability =
      entry.enabled && entry.weight > 0 && totalWeight > 0 ? entry.weight / totalWeight : 0;

    row.querySelector(".prize-probability").textContent = `${(probability * 100).toFixed(1)}%`;
  });

  elements.prizeCountText.textContent = `${active.length} 个`;
  elements.prizeWeightText.textContent = formatAmount(totalWeight);
  elements.prizeEvText.textContent = `${formatAmount(expectedValue)} ${unit}`;
}

function renderSettings(data) {
  const spendRequirement = data.spendRequirement || {
    enabled: false,
    requiredAmount: 0
  };

  elements.notePrefixInput.value = data.notePrefix || "";
  elements.showProbabilityInput.checked = Boolean(data.showProbability);
  elements.spendEnabledInput.checked = Boolean(spendRequirement.enabled);
  elements.spendRequiredInput.value = spendRequirement.requiredAmount ?? 0;
  renderGatePreview();
}

function renderGatePreview() {
  const enabled = elements.spendEnabledInput.checked;
  const amount = Number(elements.spendRequiredInput.value);
  const unit = state.config?.unit || "";

  if (!enabled) {
    elements.gatePreview.textContent = "未启用：用户登录后每天都可以直接抽奖 1 次。";
    return;
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    elements.gatePreview.textContent = "启用门槛时，消费金额必须大于 0。";
    return;
  }

  elements.gatePreview.textContent = `用户当天消费达到 ${formatAmount(amount)} ${unit} 后，才能抽奖 1 次；每天 0 点重置，当天未用不累积。`;
}

function renderHistory() {
  const query = getRecordSearchQuery();
  const entries = getFilteredEntries();

  elements.history.textContent = "";
  elements.historyMetaText.textContent = query
    ? `筛选 ${entries.length} / ${state.recentDraws.length} 条`
    : `最近 ${state.recentDraws.length} 条`;

  if (entries.length === 0) {
    elements.history.innerHTML = `<p class="empty">${query ? "没有匹配的抽奖记录。" : "还没有抽奖记录。"}</p>`;
    return;
  }

  for (const entry of entries) {
    const amount = Number(entry.amount || 0);
    const userName =
      entry.userDisplayName || entry.userName || entry.userEmail || `用户 ${entry.userId}`;
    const spendText =
      entry.spendAmount === null || entry.spendAmount === undefined
        ? ""
        : ` · 消费 ${formatAmount(entry.spendAmount)} ${entry.unit}`;
    const item = document.createElement("article");

    item.className = "history-item";
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(userName)}</strong>
        <span>${escapeHtml(entry.date)} · ${escapeHtml(entry.prizeLabel || "奖品")} · 权重 ${formatAmount(entry.weight || 0)}${spendText}</span>
      </div>
      <b>${amount > 0 ? `${formatAmount(amount)} ${escapeHtml(entry.unit)}` : "谢谢参与"}</b>
    `;
    elements.history.append(item);
  }
}

function renderSystem(system) {
  if (!system) {
    return;
  }

  const spendRequirement = system.spendRequirement || { enabled: false };
  const spendText = spendRequirement.enabled
    ? `${formatAmount(spendRequirement.requiredAmount)} ${spendRequirement.unit}`
    : "未启用";

  const items = [
    ["存储", system.storage],
    ["SQLite 文件", system.dbFile],
    ["公开路径", system.publicBasePath],
    ["Sub2API 地址", system.sub2apiBaseUrl],
    ["用户认证接口", system.authMePath],
    ["余额接口模板", system.balancePathTemplate],
    ["余额操作 / 金额字段", `${system.balanceOperation} / ${system.balanceAmountField}`],
    ["Admin 鉴权头", system.adminAuthHeader],
    ["每日抽奖次数", `${system.drawsPerDay} 次`],
    ["消费门槛", spendText],
    ["消费查询方法", spendRequirement.enabled ? system.dailySpendMethod : "-"],
    ["消费鉴权头", spendRequirement.enabled ? system.dailySpendAuthHeader : "-"],
    ["消费接口模板", spendRequirement.enabled ? system.dailySpendPathTemplate : "-"],
    ["消费请求体模板", spendRequirement.enabled ? system.dailySpendBodyTemplate || "-" : "-"],
    ["消费金额字段", spendRequirement.enabled ? system.dailySpendAmountField || "自动识别" : "-"],
    ["时区", system.timezone],
    ["奖励单位", system.unit]
  ];

  elements.systemGrid.textContent = "";
  for (const [label, value] of items) {
    const item = document.createElement("article");

    item.className = "system-item";
    item.innerHTML = `
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || "-")}</strong>
    `;
    elements.systemGrid.append(item);
  }

  const checks = [
    {
      ok: Boolean(system.adminAuthConfigured),
      title: "Sub2API 管理员 API Key",
      text: system.adminAuthConfigured
        ? "已配置，抽中奖品后可以自动发放余额。"
        : "未配置，用户抽中奖品后会发放失败。"
    },
    {
      ok: Boolean(system.sub2apiBaseUrl),
      title: "Sub2API 地址",
      text: system.sub2apiBaseUrl || "未配置"
    },
    {
      ok: Boolean(system.publicBasePath),
      title: "公开路径",
      text: `当前服务路径为 ${system.publicBasePath || "/"}`
    },
    {
      ok:
        !spendRequirement.enabled ||
        Boolean(system.dailySpendConfigured && system.dailySpendAuthConfigured),
      title: "每日消费门槛",
      text: spendRequirement.enabled
        ? system.dailySpendConfigured && system.dailySpendAuthConfigured
          ? `已启用，达到 ${spendText} 后可抽奖。`
          : "已启用，但消费统计接口或鉴权未配置完整。"
        : "未启用，用户无需消费即可抽奖。"
    }
  ];

  elements.checklist.textContent = "";
  for (const check of checks) {
    const item = document.createElement("article");

    item.className = `check-item ${check.ok ? "is-ok" : "is-warn"}`;
    item.innerHTML = `
      <span>${check.ok ? "OK" : "!"}</span>
      <div>
        <strong>${escapeHtml(check.title)}</strong>
        <small>${escapeHtml(check.text)}</small>
      </div>
    `;
    elements.checklist.append(item);
  }
}

function activateTab(tabName = "overview") {
  const available = new Set(elements.tabButtons.map((button) => button.dataset.tab));
  const nextTab = available.has(tabName) ? tabName : "overview";

  state.activeTab = nextTab;
  sessionStorage.setItem("lotteryAdminTab", nextTab);

  for (const button of elements.tabButtons) {
    const active = button.dataset.tab === nextTab;

    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  }

  for (const panel of elements.tabPanels) {
    panel.hidden = panel.dataset.panel !== nextTab;
  }
}

function exportHistoryCsv() {
  const entries = getFilteredEntries();
  const rows = [
    ["用户ID", "用户", "日期", "奖品", "金额", "单位", "权重", "当日消费", "备注", "创建时间"],
    ...entries.map((entry) => [
      entry.userId,
      entry.userDisplayName || entry.userName || entry.userEmail || `用户 ${entry.userId}`,
      entry.date,
      entry.prizeLabel || "",
      entry.amount,
      entry.unit,
      entry.weight,
      entry.spendAmount ?? "",
      entry.note || "",
      entry.createdAt || ""
    ])
  ];
  const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `lottery-draws-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function getFilteredEntries() {
  const query = getRecordSearchQuery();

  return state.recentDraws.filter((entry) => {
    if (!query) {
      return true;
    }

    return [
      entry.userDisplayName,
      entry.userName,
      entry.userEmail,
      entry.userId,
      entry.date,
      entry.prizeLabel,
      entry.amount,
      entry.unit
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

function getRecordSearchQuery() {
  return elements.recordSearchInput.value.trim().toLowerCase();
}

function showMessage(text, tone) {
  elements.message.textContent = text;
  elements.message.dataset.tone = tone;
}

function formatAmount(value) {
  const number = Number(value);
  const safeNumber = Number.isFinite(number) ? number : 0;

  return safeNumber.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  });
}

function safeColor(value, index = 0) {
  const color = String(value || "");

  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) {
    return color;
  }

  return PALETTE[index % PALETTE.length];
}

function escapeCsv(value) {
  const text = String(value ?? "");

  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
