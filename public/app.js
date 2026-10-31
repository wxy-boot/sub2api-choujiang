const state = {
  config: null,
  token: null,
  today: "",
  drawn: false,
  drawnToday: null,
  quota: null,
  eligibility: null,
  prizes: [],
  rotation: 0,
  spinning: false,
  currentMonth: "",
  embed: readEmbedOptions()
};

const FONT_STACK = '"Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif';
const WHEEL_SIZE = 720;

const elements = {
  summary: document.querySelector("#summary"),
  userChip: document.querySelector("#userChip"),
  userName: document.querySelector("#userName"),
  refreshButton: document.querySelector("#refreshButton"),
  quotaPill: document.querySelector("#quotaPill"),
  wheelStage: document.querySelector("#wheelStage"),
  wheelRotor: document.querySelector("#wheelRotor"),
  wheelCanvas: document.querySelector("#wheelCanvas"),
  spinButton: document.querySelector("#spinButton"),
  spinButtonLabel: document.querySelector("#spinButtonLabel"),
  spinButtonSub: document.querySelector("#spinButtonSub"),
  message: document.querySelector("#message"),
  hint: document.querySelector("#hint"),
  gateBadge: document.querySelector("#gateBadge"),
  gateProgress: document.querySelector("#gateProgress"),
  gateProgressBar: document.querySelector("#gateProgressBar"),
  gateText: document.querySelector("#gateText"),
  spentText: document.querySelector("#spentText"),
  remainingText: document.querySelector("#remainingText"),
  quotaText: document.querySelector("#quotaText"),
  todayPanel: document.querySelector("#todayPanel"),
  todayBadge: document.querySelector("#todayBadge"),
  todayPrize: document.querySelector("#todayPrize"),
  todayMeta: document.querySelector("#todayMeta"),
  prizeCountPill: document.querySelector("#prizeCountPill"),
  prizeList: document.querySelector("#prizeList"),
  prizeHint: document.querySelector("#prizeHint"),
  historyTitle: document.querySelector("#historyTitle"),
  prevMonthButton: document.querySelector("#prevMonthButton"),
  currentMonthButton: document.querySelector("#currentMonthButton"),
  nextMonthButton: document.querySelector("#nextMonthButton"),
  historySummary: document.querySelector("#historySummary"),
  historyList: document.querySelector("#historyList"),
  resultModal: document.querySelector("#resultModal"),
  resultKicker: document.querySelector("#resultKicker"),
  resultTitle: document.querySelector("#resultTitle"),
  resultLabel: document.querySelector("#resultLabel"),
  resultNote: document.querySelector("#resultNote"),
  resultCloseButton: document.querySelector("#resultCloseButton"),
  confettiLayer: document.querySelector("#confettiLayer")
};

applyEmbedOptions(state.embed);
void boot();

async function boot() {
  bindEvents();
  setMessage("正在读取抽奖资格...", "neutral");

  try {
    await loadConfig();
    await refreshMe();
    state.currentMonth = (state.today || "").slice(0, 7) || toMonthKey(new Date());
    await refreshHistory();
  } catch (error) {
    showError(error);
  }

  window.setInterval(() => {
    if (!document.hidden && !state.spinning) {
      void refreshMe({ quiet: true });
    }
  }, 60000);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !state.spinning) {
      void refreshMe({ quiet: true });
    }
  });
}

function bindEvents() {
  elements.spinButton.addEventListener("click", () => {
    void spin();
  });
  elements.refreshButton.addEventListener("click", () => {
    void refreshAll();
  });
  elements.prevMonthButton.addEventListener("click", () => {
    state.currentMonth = shiftMonth(state.currentMonth, -1);
    void refreshHistory();
  });
  elements.currentMonthButton.addEventListener("click", () => {
    state.currentMonth = (state.today || "").slice(0, 7) || toMonthKey(new Date());
    void refreshHistory();
  });
  elements.nextMonthButton.addEventListener("click", () => {
    state.currentMonth = shiftMonth(state.currentMonth, 1);
    void refreshHistory();
  });
  elements.resultCloseButton.addEventListener("click", closeResult);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeResult();
    }
  });
}

async function loadConfig() {
  state.config = await apiFetch("/api/config", { skipAuth: true });
  state.token = findUserToken(state.config.tokenStorageKeys || []);
  state.prizes = Array.isArray(state.config.prizes) ? state.config.prizes : [];

  renderPrizeList();
  renderWheel();
}

async function refreshAll() {
  elements.refreshButton.disabled = true;

  try {
    if (!state.config) {
      await loadConfig();
    }

    await refreshMe();
    await refreshHistory();
  } catch (error) {
    showError(error);
  } finally {
    elements.refreshButton.disabled = false;
  }
}

async function refreshMe(options = {}) {
  const data = await apiFetch("/api/me");
  const previousMonth = (state.today || "").slice(0, 7);

  state.drawn = Boolean(data.drawn);
  state.drawnToday = data.draw || null;
  state.today = data.date;
  state.quota = data.quota || null;
  state.eligibility = data.eligibility || state.config?.spendRequirement || null;

  renderUser(data.user);
  renderToday(data.draw);
  renderGate();
  syncSpinState();
  updateStatusMessage();

  if (!options.quiet) {
    elements.hint.textContent = buildHint(data.date);
  }

  const currentMonth = data.date.slice(0, 7);

  if (state.currentMonth === previousMonth && previousMonth && previousMonth !== currentMonth) {
    state.currentMonth = currentMonth;
    void refreshHistoryQuiet().catch(() => {});
  }

  return data;
}

function renderUser(user) {
  if (!user) {
    return;
  }

  elements.userName.textContent = user.name || user.email || `用户 ${user.id}`;
  elements.userChip.hidden = false;
}

function renderGate() {
  const eligibility = state.eligibility;
  const unit = eligibility?.unit || state.config?.unit || "";
  const quota = state.quota;

  if (!eligibility) {
    elements.gateBadge.textContent = "读取中";
    elements.gateBadge.dataset.tone = "neutral";
    return;
  }

  if (!eligibility.enabled) {
    elements.gateBadge.textContent = "未启用";
    elements.gateBadge.dataset.tone = "neutral";
    setProgress(100);
    elements.gateText.textContent = "消费门槛未启用，登录后每天都可以抽奖 1 次。";
    elements.spentText.textContent = "不限";
    elements.remainingText.textContent = "-";
    elements.quotaText.textContent = state.drawn ? "已用完" : `${quota?.remaining ?? 1} 次`;
    return;
  }

  const required = Number(eligibility.requiredAmount || 0);
  const current =
    eligibility.currentAmount === null || eligibility.currentAmount === undefined
      ? null
      : Number(eligibility.currentAmount);
  const ratio = required > 0 && current !== null ? Math.min(1, Math.max(0, current / required)) : 0;

  setProgress(Math.round(ratio * 100));

  if (eligibility.error) {
    elements.gateBadge.textContent = "查询失败";
    elements.gateBadge.dataset.tone = "error";
    elements.gateText.textContent =
      eligibility.message || `暂时无法查询今日消费，需要达到 ${formatAmount(required)} ${unit}。`;
    elements.spentText.textContent = "-";
    elements.remainingText.textContent = `${formatAmount(required)} ${unit}`;
    elements.quotaText.textContent = state.drawn ? "已用完" : "待解锁";
    return;
  }

  if (current === null) {
    elements.gateBadge.textContent = "读取中";
    elements.gateBadge.dataset.tone = "neutral";
    elements.gateText.textContent = `需要今日消费达到 ${formatAmount(required)} ${unit} 才能抽奖。`;
    elements.spentText.textContent = "-";
    elements.remainingText.textContent = `${formatAmount(required)} ${unit}`;
    elements.quotaText.textContent = state.drawn ? "已用完" : "待解锁";
    return;
  }

  elements.spentText.textContent = `${formatAmount(current)} ${unit}`;
  elements.quotaText.textContent = state.drawn ? "已用完" : `${quota?.remaining ?? 1} 次`;

  if (eligibility.eligible) {
    elements.gateBadge.textContent = "已达标";
    elements.gateBadge.dataset.tone = "success";
    elements.gateText.textContent = `今日已消费 ${formatAmount(current)} / ${formatAmount(required)} ${unit}，已解锁抽奖。`;
    elements.remainingText.textContent = `0 ${unit}`;
  } else {
    elements.gateBadge.textContent = `还差 ${formatAmount(eligibility.remainingAmount)}`;
    elements.gateBadge.dataset.tone = "warning";
    elements.gateText.textContent = `今日已消费 ${formatAmount(current)} / ${formatAmount(required)} ${unit}，再消费 ${formatAmount(eligibility.remainingAmount)} ${unit} 即可抽奖。`;
    elements.remainingText.textContent = `${formatAmount(eligibility.remainingAmount)} ${unit}`;
  }
}

function setProgress(percent) {
  const value = Math.max(0, Math.min(100, percent));
  elements.gateProgressBar.style.width = `${value}%`;
  elements.gateProgress.setAttribute("aria-valuenow", String(value));
}

function renderToday(draw) {
  if (!draw) {
    elements.todayPanel.hidden = true;
    return;
  }

  const amount = Number(draw.amount || 0);
  const unit = draw.unit || state.config?.unit || "";

  elements.todayPanel.hidden = false;
  elements.todayBadge.textContent = amount > 0 ? "已中奖" : "已抽奖";
  elements.todayBadge.dataset.tone = amount > 0 ? "win" : "neutral";
  elements.todayPrize.textContent =
    amount > 0 ? `${formatAmount(amount)} ${unit}` : draw.prizeLabel || "谢谢参与";
  elements.todayMeta.textContent = [
    draw.prizeLabel && amount > 0 ? draw.prizeLabel : "",
    draw.createdAt ? `${formatTime(draw.createdAt)} 发放` : ""
  ]
    .filter(Boolean)
    .join(" · ");
}

function syncSpinState() {
  const eligibility = state.eligibility;
  const gateEnabled = Boolean(eligibility?.enabled);
  const eligible = eligibility ? !gateEnabled || Boolean(eligibility.eligible) : false;
  const spinDisabled = state.spinning || state.drawn || !eligible;

  elements.spinButton.disabled = spinDisabled;
  elements.wheelStage.classList.toggle("is-spinning", state.spinning);
  elements.refreshButton.disabled = state.spinning;

  if (state.spinning) {
    elements.spinButtonLabel.textContent = "抽奖中";
    elements.spinButtonSub.textContent = "请稍候";
  } else if (state.drawn) {
    elements.spinButtonLabel.textContent = "已抽奖";
    elements.spinButtonSub.textContent = "明天再来";
  } else if (!eligible) {
    elements.spinButtonLabel.textContent = eligibility?.error ? "暂不可抽" : "未达标";
    elements.spinButtonSub.textContent = eligibility?.error ? "联系管理员" : "继续加油";
  } else {
    elements.spinButtonLabel.textContent = "抽奖";
    elements.spinButtonSub.textContent = "点击开启";
  }

  if (state.drawn) {
    elements.quotaPill.textContent = "今日已抽奖";
    elements.quotaPill.dataset.tone = "neutral";
  } else if (!gateEnabled) {
    elements.quotaPill.textContent = "今日 1 次机会";
    elements.quotaPill.dataset.tone = "success";
  } else if (eligible) {
    elements.quotaPill.textContent = "今日 1 次机会";
    elements.quotaPill.dataset.tone = "success";
  } else {
    elements.quotaPill.textContent = eligibility?.error ? "资格异常" : "消费未达标";
    elements.quotaPill.dataset.tone = eligibility?.error ? "error" : "warning";
  }

  updateSummary();
}

function updateSummary() {
  const eligibility = state.eligibility;
  const unit = eligibility?.unit || state.config?.unit || "";

  if (state.spinning) {
    elements.summary.textContent = "正在转动转盘，马上揭晓今天的运气...";
    return;
  }

  if (state.drawn) {
    elements.summary.textContent = "今天的抽奖已经完成，奖励已自动发放；明天 0 点重置 1 次机会。";
    return;
  }

  if (!eligibility) {
    elements.summary.textContent = "正在读取当前登录用户...";
    return;
  }

  if (eligibility.error) {
    elements.summary.textContent = "抽奖资格暂时无法确认，请刷新页面或联系管理员。";
    return;
  }

  if (!eligibility.enabled) {
    elements.summary.textContent = "消费门槛未启用，今天可以直接抽奖 1 次。";
    return;
  }

  if (eligibility.eligible) {
    elements.summary.textContent = "今日消费已达标，转盘已解锁，来试试手气。";
    return;
  }

  if (eligibility.currentAmount === null || eligibility.currentAmount === undefined) {
    elements.summary.textContent = `今日消费满 ${formatAmount(eligibility.requiredAmount)} ${unit} 即可抽奖。`;
    return;
  }

  elements.summary.textContent = `今日已消费 ${formatAmount(eligibility.currentAmount)} ${unit}，还差 ${formatAmount(
    eligibility.remainingAmount
  )} ${unit} 解锁转盘。`;
}

function updateStatusMessage() {
  const eligibility = state.eligibility;
  const unit = eligibility?.unit || state.config?.unit || "";

  if (state.spinning) {
    return;
  }

  if (state.drawn) {
    const amount = Number(state.drawnToday?.amount || 0);
    const prizeText =
      amount > 0
        ? `${formatAmount(amount)} ${unit}`
        : state.drawnToday?.prizeLabel || "谢谢参与";
    setMessage(`今天已经抽过奖：${prizeText}。明天 0 点后恢复 1 次机会。`, "success");
    return;
  }

  if (!eligibility) {
    setMessage("正在读取抽奖资格...", "neutral");
    return;
  }

  if (eligibility.error) {
    setMessage(eligibility.message || "暂时无法确认今天的消费金额。", "error");
    return;
  }

  if (!eligibility.enabled) {
    setMessage("消费门槛未启用，今天可以直接抽奖。", "neutral");
    return;
  }

  if (eligibility.eligible) {
    setMessage("今日消费已达标，转盘已解锁，来试试手气！", "success");
    return;
  }

  if (eligibility.currentAmount === null || eligibility.currentAmount === undefined) {
    setMessage(`需要今日消费达到 ${formatAmount(eligibility.requiredAmount)} ${unit} 才能抽奖。`, "warning");
    return;
  }

  setMessage(
    `今日已消费 ${formatAmount(eligibility.currentAmount)} ${unit}，还差 ${formatAmount(
      eligibility.remainingAmount
    )} ${unit} 就能抽奖。`,
    "warning"
  );
}

async function spin() {
  if (state.spinning) {
    return;
  }

  if (state.drawn) {
    setMessage("今天已经抽过奖了，明天 0 点后再来吧。", "neutral");
    return;
  }

  if (state.eligibility?.enabled && !state.eligibility?.eligible) {
    updateStatusMessage();
    return;
  }

  state.spinning = true;
  syncSpinState();
  setMessage("正在发放奖励并转动转盘...", "neutral");

  let drawResult = null;

  try {
    const data = await apiFetch("/api/draw", { method: "POST" });
    drawResult = data;
    state.drawn = Boolean(data.draw) || !data.alreadyDrawn;
    state.drawnToday = data.draw || null;
    state.quota = data.quota || state.quota;
    state.eligibility = data.eligibility || state.eligibility;

    if (data.alreadyDrawn) {
      renderToday(data.draw);
      await refreshHistoryQuiet();
      return;
    }

    const index = resolvePrizeIndex(data);
    await animateWheelTo(index);

    renderToday(data.draw);
    await refreshHistoryQuiet().catch(() => {});
    revealResult(data);
  } catch (error) {
    showError(error);
  } finally {
    state.spinning = false;
    syncSpinState();
    renderGate();

    if (drawResult && !drawResult.alreadyDrawn) {
      setMessage(
        `抽中 ${describePrize(drawResult.prize, drawResult.unit)}，奖励已发放到 Sub2API 余额。`,
        "success"
      );
    } else if (drawResult?.alreadyDrawn) {
      updateStatusMessage();
    }
  }
}

function resolvePrizeIndex(data) {
  const prize = data?.prize || {};
  const directIndex = Number(data?.prizeIndex);

  if (Number.isInteger(directIndex) && directIndex >= 0 && directIndex < state.prizes.length) {
    const byIdIndex = state.prizes.findIndex((item) => item.id === prize.id);

    if (byIdIndex >= 0) {
      return byIdIndex;
    }

    return directIndex;
  }

  const fallbackIndex = state.prizes.findIndex(
    (item) => item.id === prize.id || (item.label === prize.label && Number(item.amount) === Number(prize.amount))
  );

  return fallbackIndex >= 0 ? fallbackIndex : 0;
}

function animateWheelTo(index) {
  const prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const count = state.prizes.length || 1;
  const sector = 360 / count;
  const targetCenter = index * sector + sector / 2;
  const jitter = (Math.random() - 0.5) * sector * 0.6;
  const targetMod = (360 - targetCenter - jitter + 720000) % 360;
  const currentMod = ((state.rotation % 360) + 360) % 360;
  const spins = prefersReducedMotion ? 0 : 5 + Math.floor(Math.random() * 3);
  const delta = spins * 360 + ((targetMod - currentMod + 360) % 360);

  state.rotation += delta;
  elements.wheelRotor.style.transitionDuration = prefersReducedMotion ? "0.8s" : "5.2s";
  elements.wheelRotor.style.transform = `rotate(${state.rotation}deg)`;

  return new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      elements.wheelRotor.removeEventListener("transitionend", onTransitionEnd);
      resolve();
    };

    const onTransitionEnd = (event) => {
      if (event.target === elements.wheelRotor) {
        finish();
      }
    };

    elements.wheelRotor.addEventListener("transitionend", onTransitionEnd);
    window.setTimeout(finish, prefersReducedMotion ? 1100 : 5600);
  });
}

function revealResult(data) {
  const prize = data.prize || data.draw || {};
  const amount = Number(prize.amount ?? 0);
  const unit = data.unit || state.config?.unit || "";
  const label = prize.prizeLabel || prize.label || "幸运奖品";

  if (amount > 0) {
    elements.resultKicker.textContent = "恭喜中奖";
    elements.resultTitle.textContent = `${formatAmount(amount)} ${unit}`;
    elements.resultLabel.textContent = label;
    elements.resultNote.textContent = "奖励已自动发放到你的 Sub2API 余额。";
    launchConfetti();
  } else {
    elements.resultKicker.textContent = "谢谢参与";
    elements.resultTitle.textContent = label || "谢谢参与";
    elements.resultLabel.textContent = "本次没有余额奖励";
    elements.resultNote.textContent = "抽奖机会已使用，明天 0 点重置后再来试试手气。";
  }

  elements.resultModal.hidden = false;
  document.body.classList.add("modal-open");
  window.setTimeout(() => elements.resultCloseButton.focus(), 50);
}

function closeResult() {
  if (elements.resultModal.hidden) {
    return;
  }

  elements.resultModal.hidden = true;
  document.body.classList.remove("modal-open");
}

function launchConfetti() {
  const layer = elements.confettiLayer;
  const prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  layer.textContent = "";

  if (prefersReducedMotion) {
    return;
  }

  const colors = ["#18c2b0", "#2dd4bf", "#f5b544", "#2b72c4", "#b03d54", "#2b8f5f", "#ffe08a"];

  for (let index = 0; index < 56; index += 1) {
    const piece = document.createElement("i");

    piece.style.left = `${Math.random() * 100}%`;
    piece.style.width = `${6 + Math.random() * 7}px`;
    piece.style.height = `${9 + Math.random() * 9}px`;
    piece.style.background = colors[index % colors.length];
    piece.style.animationDelay = `${Math.random() * 0.4}s`;
    piece.style.animationDuration = `${2.1 + Math.random() * 1.5}s`;
    piece.style.setProperty("--drift", `${(Math.random() - 0.5) * 320}px`);
    layer.append(piece);
  }

  window.setTimeout(() => {
    layer.textContent = "";
  }, 4400);
}

async function refreshHistory() {
  try {
    await refreshHistoryQuiet();
  } catch (error) {
    showError(error);
  }
}

async function refreshHistoryQuiet() {
  if (!state.currentMonth) {
    state.currentMonth = (state.today || "").slice(0, 7) || toMonthKey(new Date());
  }

  const data = await apiFetch(`/api/history?month=${encodeURIComponent(state.currentMonth)}`);
  renderHistory(data);
}

function renderHistory(data) {
  const month = data.month || state.currentMonth;
  const unit = data.unit || state.config?.unit || "";
  const [year, monthNumber] = month.split("-").map(Number);

  state.currentMonth = month;
  elements.historyTitle.textContent = `${year} 年 ${String(monthNumber).padStart(2, "0")} 月抽奖记录`;
  elements.historySummary.textContent = `本月抽奖 ${data.drawCount || 0} 次 · 累计获得 ${formatAmount(
    data.totalAmount || 0
  )} ${unit}`;
  elements.historyList.textContent = "";

  if (!Array.isArray(data.entries) || data.entries.length === 0) {
    elements.historyList.innerHTML = '<p class="empty">本月还没有抽奖记录。</p>';
    return;
  }

  for (const entry of [...data.entries].reverse()) {
    const amount = Number(entry.amount || 0);
    const item = document.createElement("article");

    item.className = "history-item";
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(entry.date)}</strong>
        <span>${escapeHtml(entry.prizeLabel || "奖品")} · ${escapeHtml(formatTime(entry.createdAt))}</span>
      </div>
      <b>${amount > 0 ? `${formatAmount(amount)} ${escapeHtml(entry.unit || unit)}` : "谢谢参与"}</b>
    `;
    elements.historyList.append(item);
  }
}

function renderPrizeList() {
  const unit = state.config?.unit || "";
  const showProbability = Boolean(state.config?.showProbability);

  elements.prizeList.textContent = "";
  elements.prizeCountPill.textContent = `${state.prizes.length} 个奖项`;

  if (state.prizes.length === 0) {
    elements.prizeList.innerHTML = '<p class="empty">管理员还没有配置奖品。</p>';
    elements.prizeHint.textContent = "";
    return;
  }

  for (const prize of state.prizes) {
    const amount = Number(prize.amount || 0);
    const item = document.createElement("article");

    item.className = "prize-item";
    item.innerHTML = `
      <i class="prize-swatch" style="background: ${safeColor(prize.color)}"></i>
      <span class="prize-name">${escapeHtml(prize.label || "幸运奖品")}</span>
      <b class="prize-amount">${amount > 0 ? `${formatAmount(amount)} ${escapeHtml(unit)}` : "不发放"}</b>
      ${
        showProbability && Number.isFinite(Number(prize.probability))
          ? `<span class="prize-probability">${(Number(prize.probability) * 100).toFixed(1)}%</span>`
          : ""
      }
    `;
    elements.prizeList.append(item);
  }

  elements.prizeHint.textContent = showProbability
    ? "概率按各奖项权重计算，供参考。"
    : "奖项与金额由管理员配置，抽中后自动发放到余额。";
}

function renderWheel() {
  const canvas = elements.wheelCanvas;
  const context = canvas.getContext("2d");

  canvas.width = WHEEL_SIZE;
  canvas.height = WHEEL_SIZE;
  context.clearRect(0, 0, WHEEL_SIZE, WHEEL_SIZE);

  const center = WHEEL_SIZE / 2;
  const radius = center - 10;

  drawWheelBase(context, center, radius);

  if (state.prizes.length === 0) {
    drawPlaceholder(context, center);
    return;
  }

  const count = state.prizes.length;
  const sector = (Math.PI * 2) / count;
  const primaryFontSize = count >= 12 ? 38 : count >= 9 ? 43 : 48;
  const secondaryFontSize = count >= 12 ? 17 : count >= 9 ? 19 : 21;

  for (let index = 0; index < count; index += 1) {
    const prize = state.prizes[index];
    const start = -Math.PI / 2 + index * sector;
    const end = start + sector;
    const color = safeColor(prize.color);
    const textColor = readableTextColor(color);

    context.beginPath();
    context.moveTo(center, center);
    context.arc(center, center, radius, start, end);
    context.closePath();
    context.fillStyle = color;
    context.fill();

    const gradient = context.createRadialGradient(
      center,
      center,
      radius * 0.16,
      center,
      center,
      radius
    );

    gradient.addColorStop(0, "rgba(255,255,255,0.2)");
    gradient.addColorStop(0.55, "rgba(255,255,255,0.04)");
    gradient.addColorStop(1, "rgba(0,0,0,0.24)");
    context.fillStyle = gradient;
    context.fill();

    context.beginPath();
    context.moveTo(center, center);
    context.lineTo(
      center + Math.cos(start) * radius,
      center + Math.sin(start) * radius
    );
    context.strokeStyle = "rgba(255,255,255,0.24)";
    context.lineWidth = 3;
    context.stroke();

    const angle = start + sector / 2;
    const amount = Number(prize.amount || 0);

    if (amount > 0) {
      drawRadialText(context, center, radius * 0.52, angle, formatAmount(amount), {
        font: `800 ${primaryFontSize}px ${FONT_STACK}`,
        color: textColor
      });
      drawRadialText(context, center, radius * 0.73, angle, truncateLabel(prize.label), {
        font: `700 ${secondaryFontSize}px ${FONT_STACK}`,
        color: withAlpha(textColor, 0.82)
      });
    } else {
      drawRadialText(context, center, radius * 0.62, angle, truncateLabel(prize.label || "谢谢参与"), {
        font: `800 ${secondaryFontSize + 5}px ${FONT_STACK}`,
        color: textColor
      });
    }
  }

  drawRim(context, center, radius, count, sector);
}

function drawWheelBase(context, center, radius) {
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.fillStyle = "#0b1320";
  context.fill();
}

function drawPlaceholder(context, center) {
  context.beginPath();
  context.arc(center, center, 210, 0, Math.PI * 2);
  context.fillStyle = "rgba(148, 163, 184, 0.12)";
  context.fill();
  context.fillStyle = "rgba(229, 237, 247, 0.72)";
  context.font = `800 34px ${FONT_STACK}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("暂无奖品", center, center - 18);
  context.fillStyle = "rgba(148, 163, 184, 0.9)";
  context.font = `600 20px ${FONT_STACK}`;
  context.fillText("请联系管理员配置", center, center + 30);
}

function drawRim(context, center, radius, count, sector) {
  context.beginPath();
  context.arc(center, center, radius - 3, 0, Math.PI * 2);
  context.strokeStyle = "rgba(255,255,255,0.18)";
  context.lineWidth = 6;
  context.stroke();

  for (let index = 0; index < count; index += 1) {
    const angle = -Math.PI / 2 + index * sector;
    const x = center + Math.cos(angle) * (radius - 16);
    const y = center + Math.sin(angle) * (radius - 16);

    context.beginPath();
    context.arc(x, y, 4, 0, Math.PI * 2);
    context.fillStyle = "rgba(255,255,255,0.72)";
    context.fill();
  }
}

function drawRadialText(context, center, distance, angle, text, options) {
  if (!text) {
    return;
  }

  context.save();
  context.translate(center, center);
  context.rotate(angle);

  if (Math.cos(angle) < 0) {
    context.rotate(-Math.PI);
    context.translate(-distance, 0);
  } else {
    context.translate(distance, 0);
  }

  context.font = options.font;
  context.fillStyle = options.color;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.shadowColor = "rgba(0,0,0,0.32)";
  context.shadowBlur = 8;
  context.shadowOffsetY = 1;
  context.fillText(text, 0, 0);
  context.restore();
}

function setMessage(text, tone) {
  elements.message.textContent = text;
  elements.message.dataset.tone = tone;
}

function showError(error) {
  if (error.eligibility) {
    state.eligibility = error.eligibility;
    renderGate();
    syncSpinState();
    updateStatusMessage();
    return;
  }

  setMessage(error.message || "请求失败，请稍后再试。", "error");

  if (error.status === 401 || error.code === "missing_user_token") {
    elements.hint.textContent =
      "建议把抽奖服务反代到 Sub2API 同源路径（例如 /choujiang/），这样页面可以读取当前登录态。";
  } else if (state.config && !state.eligibility) {
    elements.hint.textContent = "请检查服务端环境变量、Sub2API 地址和管理员 API Key。";
  }

  syncSpinState();
}

function buildHint(date) {
  const timezone = state.config?.timezone || state.eligibility?.timezone || "-";
  const resetDate = state.quota?.resetDate ? `，下次重置 ${state.quota.resetDate}` : "";

  return `结算日期 ${date || "-"} · 时区 ${timezone} · 每人每天 1 次${resetDate}，未使用不累积。`;
}

async function apiFetch(path, options = {}) {
  const basePath = window.__LOTTERY_BASE_PATH__ === "/" ? "" : window.__LOTTERY_BASE_PATH__;
  const headers = {
    Accept: "application/json",
    ...(options.headers || {})
  };

  if (options.method && options.method !== "GET") {
    headers["Content-Type"] = "application/json";
  }

  if (!options.skipAuth && state.token) {
    headers.Authorization = asBearerToken(state.token);
  }

  const response = await fetch(`${basePath}${path}`, {
    method: options.method || "GET",
    credentials: "include",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.message || "请求失败");
    error.code = payload.error || "request_failed";
    error.status = response.status;
    error.eligibility = payload.eligibility || null;
    throw error;
  }

  return payload;
}

function asBearerToken(value) {
  return String(value).toLowerCase().startsWith("bearer ") ? String(value) : `Bearer ${value}`;
}

function findUserToken(extraKeys) {
  const urlToken = new URLSearchParams(window.location.search).get("token");

  if (urlToken) {
    return urlToken;
  }

  const keys = [
    ...extraKeys,
    "token",
    "access_token",
    "auth_token",
    "sub2api_token",
    "jwt",
    "auth",
    "user"
  ];

  for (const key of new Set(keys)) {
    const token = extractToken(safeLocalStorageGet(key));

    if (token) {
      return token;
    }
  }

  for (let index = 0; index < localStorage.length; index += 1) {
    const token = extractToken(safeLocalStorageGet(localStorage.key(index)));

    if (token) {
      return token;
    }
  }

  return null;
}

function extractToken(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const direct = value.trim();
  const directJwt = direct.match(
    /(?:Bearer\s+)?(eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)/
  );

  if (directJwt) {
    return directJwt[1];
  }

  try {
    return extractTokenFromObject(JSON.parse(value));
  } catch {
    return null;
  }
}

function extractTokenFromObject(value, depth = 0) {
  if (!value || depth > 5) {
    return null;
  }

  if (typeof value === "string") {
    return extractToken(value);
  }

  if (typeof value !== "object") {
    return null;
  }

  const preferredKeys = [
    "token",
    "accessToken",
    "access_token",
    "authToken",
    "jwt",
    "idToken",
    "value"
  ];

  for (const key of preferredKeys) {
    const token = extractTokenFromObject(value[key], depth + 1);

    if (token) {
      return token;
    }
  }

  for (const item of Object.values(value)) {
    const token = extractTokenFromObject(item, depth + 1);

    if (token) {
      return token;
    }
  }

  return null;
}

function safeLocalStorageGet(key) {
  try {
    return key ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function readEmbedOptions() {
  const params = new URLSearchParams(window.location.search);

  return {
    theme: normalizeTheme(params.get("theme")),
    uiMode: normalizeUiMode(params.get("ui_mode")),
    lang: normalizeLang(params.get("lang"))
  };
}

function applyEmbedOptions(options) {
  document.documentElement.dataset.theme = options.theme;
  document.documentElement.dataset.uiMode = options.uiMode;
  document.documentElement.lang = options.lang;
}

function normalizeTheme(value) {
  const theme = String(value || "").toLowerCase();

  if (theme === "light" || theme === "dark") {
    return theme;
  }

  return window.matchMedia?.("(prefers-color-scheme: light)")?.matches ? "light" : "dark";
}

function normalizeUiMode(value) {
  return String(value || "").toLowerCase().startsWith("embed") ? "embedded" : "standalone";
}

function normalizeLang(value) {
  return String(value || "").toLowerCase().startsWith("en") ? "en" : "zh-CN";
}

function describePrize(prize, unit) {
  const amount = Number(prize?.amount || 0);
  const label = prize?.label || "幸运奖品";

  return amount > 0 ? `${formatAmount(amount)} ${unit || ""}（${label}）` : label;
}

function formatAmount(value) {
  const number = Number(value);
  const safeNumber = Number.isFinite(number) ? number : 0;

  return safeNumber.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  });
}

function formatTime(value) {
  if (!value) {
    return "-";
  }

  try {
    return new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function toMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month, delta) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 1 + delta, 1);
  return toMonthKey(date);
}

function truncateLabel(value) {
  const text = String(value || "").trim();

  if (!text) {
    return "";
  }

  return text.length > 8 ? `${text.slice(0, 8)}…` : text;
}

function safeColor(value) {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(value || ""))
    ? String(value)
    : "#0f8f83";
}

function readableTextColor(color) {
  const hex = color.replace("#", "");
  const expanded =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => char + char)
          .join("")
      : hex;

  if (expanded.length !== 6) {
    return "#ffffff";
  }

  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

  return luminance > 0.64 ? "#0b1320" : "#ffffff";
}

function withAlpha(color, alpha) {
  if (!color.startsWith("#")) {
    return color;
  }

  const hex = color.slice(1);
  const expanded =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => char + char)
          .join("")
      : hex;
  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
