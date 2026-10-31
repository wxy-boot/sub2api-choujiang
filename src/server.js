import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { config, rootDir } from "./config.js";
import {
  httpError,
  readJsonBody,
  safeEqual,
  sendHtml,
  sendJson,
  serveStatic
} from "./http.js";
import { logError, logInfo, logWarn } from "./log.js";
import { renderAdmin, renderIndex } from "./pages.js";
import {
  activePrizes,
  pickWeightedPrize,
  resolvePrizeColor,
  roundAmount,
  summarizePrizes,
  toPublicPrizes,
  validatePrizeRules
} from "./prizes.js";
import { Store } from "./store.js";
import { createSub2api } from "./sub2api.js";
import {
  dateKey,
  monthKey,
  nextDateKey,
  nextMonthKey,
  shiftDateKey,
  zonedDateStartIso
} from "./time.js";

const DRAWS_PER_DAY = 1;

const staticFiles = new Map([
  ["/app.js", { file: path.join(rootDir, "public", "app.js"), type: "text/javascript; charset=utf-8" }],
  ["/admin.js", { file: path.join(rootDir, "public", "admin.js"), type: "text/javascript; charset=utf-8" }],
  ["/admin.css", { file: path.join(rootDir, "public", "admin.css"), type: "text/css; charset=utf-8" }],
  ["/styles.css", { file: path.join(rootDir, "public", "styles.css"), type: "text/css; charset=utf-8" }]
]);

const store = await Store.open(config.dbFile);
const sub2api = createSub2api(config);

seedStorage();

const server = createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    if (error.status && error.code) {
      sendJson(res, error.status, {
        ok: false,
        error: error.code,
        message: error.message,
        ...(error.details || {})
      });
      return;
    }

    logError("request.error", {
      method: req.method,
      url: req.url,
      message: error.message,
      stack: error.stack
    });
    sendJson(res, 500, { ok: false, error: "internal_error", message: "服务内部错误" });
  }
});

server.listen(config.port, () => {
  logInfo("service.started", {
    port: config.port,
    publicBasePath: config.publicBasePath,
    sub2apiBaseUrl: config.sub2apiBaseUrl,
    dbFile: config.dbFile,
    unit: config.unit,
    timezone: config.timezone,
    spendRequirement: getSpendRequirement(),
    prizeCount: activePrizes(store.getPrizes()).length
  });

  if (!config.adminPassword) {
    logWarn("config.missing_admin_password", {
      message: "LOTTERY_ADMIN_PASSWORD is empty; admin APIs are disabled."
    });
  }

  if (!config.adminAuthValue) {
    logWarn("config.missing_admin_api_key", {
      message: "SUB2API_ADMIN_API_KEY is empty; prize payouts will fail."
    });
  }

  if (!config.dailySpendPathTemplate) {
    logWarn("config.missing_daily_spend_endpoint", {
      message: "SUB2API_DAILY_SPEND_PATH_TEMPLATE is empty; spend gating cannot query upstream."
    });
  }

  void sub2api.probe();
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    logInfo("service.stopping", { signal });
    server.close(() => {
      store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

function seedStorage() {
  store.seedSettings({
    spend_enabled: config.requireDailySpend ? "1" : "0",
    spend_required_amount: config.requiredDailySpend,
    note_prefix: config.notePrefix,
    show_probability: config.showProbability ? "1" : "0"
  });

  if (store.countPrizes() === 0) {
    store.replacePrizes(validatePrizeRules(config.defaultPrizes, { allowEmpty: true }));
  }
}

async function route(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);
  const routePath = stripPublicBasePath(pathname);
  const method = req.method === "HEAD" ? "GET" : req.method;

  if (routePath === null) {
    sendJson(res, 404, { ok: false, error: "not_found" });
    return;
  }

  if (method === "GET" && routePath === "/healthz") {
    sendJson(res, 200, {
      ok: true,
      service: config.serviceName,
      time: new Date().toISOString()
    });
    return;
  }

  if (method === "GET" && routePath === "/api/config") {
    const prizes = getPrizes();
    const spendRequirement = getSpendRequirement();
    const showProbability = getShowProbability();
    const publicPrizes = toPublicPrizes(prizes, { showProbability });

    sendJson(res, 200, {
      ok: true,
      basePath: config.publicBasePath,
      unit: config.unit,
      timezone: config.timezone,
      drawsPerDay: DRAWS_PER_DAY,
      spendRequirement,
      prizes: publicPrizes,
      prizeCount: publicPrizes.length,
      showProbability,
      tokenStorageKeys: config.publicTokenStorageKeys
    });
    return;
  }

  if (method === "GET" && routePath === "/api/me") {
    const user = await sub2api.resolveCurrentUser(req);
    const date = dateKey(new Date(), config.timezone);
    const draw = store.findDraw(user.id, date);
    const eligibility = await resolveEligibility(user, date, { strict: false });

    if (draw) {
      refreshDrawIdentity(draw, user);
    }

    sendJson(res, 200, {
      ok: true,
      user: publicUser(user),
      date,
      unit: config.unit,
      drawn: Boolean(draw),
      draw: draw ? publicDraw(draw) : null,
      quota: quotaPayload(date, Boolean(draw)),
      eligibility
    });
    return;
  }

  if (method === "GET" && routePath === "/api/history") {
    const user = await sub2api.resolveCurrentUser(req);
    const month = validateMonth(
      url.searchParams.get("month") || monthKey(new Date(), config.timezone)
    );
    const entries = store.getMonthDraws(user.id, month, nextMonthKey(month));

    sendJson(res, 200, {
      ok: true,
      user: publicUser(user),
      month,
      unit: config.unit,
      entries: entries.map(publicDraw),
      drawCount: entries.length,
      totalAmount: roundAmount(entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0))
    });
    return;
  }

  if (method === "POST" && routePath === "/api/draw") {
    const user = await sub2api.resolveCurrentUser(req);
    const result = await performDraw(user);
    sendJson(res, 200, result);
    return;
  }

  if (method === "GET" && routePath === "/api/admin/config") {
    requireAdmin(req);
    sendJson(res, 200, buildAdminPayload());
    return;
  }

  if (method === "PUT" && routePath === "/api/admin/config") {
    requireAdmin(req);
    const body = await readJsonBody(req);
    const prizes = validatePrizeRules(body?.prizes ?? store.getPrizes());
    const spendRequirement = validateSpendRequirement(
      body?.spendRequirement ?? getSpendRequirement()
    );
    const notePrefix = validateNotePrefix(body?.notePrefix ?? getNotePrefix());
    const showProbability =
      typeof body?.showProbability === "boolean" ? body.showProbability : getShowProbability();

    store.transaction(() => {
      store.replacePrizes(prizes);
      store.setSetting("note_prefix", notePrefix);
      store.setSetting("show_probability", showProbability ? "1" : "0");
      store.setSetting("spend_enabled", spendRequirement.enabled ? "1" : "0");
      store.setSetting("spend_required_amount", spendRequirement.requiredAmount);
      store.setSetting("prize_rules_updated_at", new Date().toISOString());
    });

    logInfo("admin.config.updated", {
      prizeCount: prizes.filter((prize) => prize.enabled).length,
      totalWeight: summarizePrizes(prizes).totalWeight,
      expectedValue: summarizePrizes(prizes).expectedValue,
      spendRequirement,
      showProbability,
      notePrefix
    });

    sendJson(res, 200, buildAdminPayload());
    return;
  }

  if (method === "GET" && staticFiles.has(routePath)) {
    serveStatic(res, staticFiles.get(routePath));
    return;
  }

  if (method === "GET" && (routePath === "/" || routePath === "/index.html")) {
    sendHtml(res, renderIndex(config));
    return;
  }

  if (method === "GET" && (routePath === "/admin" || routePath === "/admin/")) {
    sendHtml(res, renderAdmin(config));
    return;
  }

  sendJson(res, 404, { ok: false, error: "not_found" });
}

async function performDraw(user) {
  return store.withLock(async () => {
    const date = dateKey(new Date(), config.timezone);
    const existing = store.findDraw(user.id, date);

    if (existing) {
      refreshDrawIdentity(existing, user);

      logInfo("draw.duplicate", {
        user: logUser(user),
        date,
        amount: existing.amount,
        unit: existing.unit,
        originalCreatedAt: existing.createdAt
      });

      return {
        ok: true,
        alreadyDrawn: true,
        date,
        unit: config.unit,
        prize: publicPrizeFromDraw(existing),
        prizeIndex: activePrizeIndex(existing.prizeId),
        draw: publicDraw(existing),
        quota: quotaPayload(date, true),
        eligibility: await resolveEligibility(user, date, { strict: false })
      };
    }

    const eligibility = await resolveEligibility(user, date, { strict: true });

    if (!eligibility.eligible) {
      logInfo("draw.spend_not_enough", {
        user: logUser(user),
        date,
        currentAmount: eligibility.currentAmount,
        requiredAmount: eligibility.requiredAmount,
        remainingAmount: eligibility.remainingAmount,
        unit: eligibility.unit
      });

      throw httpError(
        403,
        "daily_spend_not_enough",
        `今日消费未达到 ${eligibility.requiredAmount} ${eligibility.unit}，暂时不能抽奖。`,
        { eligibility }
      );
    }

    const prizes = getPrizes();
    const enabled = activePrizes(prizes);

    if (enabled.length === 0) {
      throw httpError(500, "no_active_prizes", "管理员还没有配置可用的奖品，请稍后再试。");
    }

    const prize = pickWeightedPrize(enabled);
    const prizeIndex = enabled.findIndex((item) => item.id === prize.id);
    const note = `${getNotePrefix()} ${date} ${prize.label} ${formatAmountText(prize.amount)} ${config.unit}`;
    const award = roundAmount(prize.amount);
    let upstreamStatus = null;

    if (award > 0) {
      const upstream = await sub2api.addUserBalance(user.id, award, note);
      upstreamStatus = upstream.status;
    }

    const identity = userIdentityForStorage(user);
    const draw = {
      id: `${date}:${user.id}:${randomUUID().slice(0, 8)}`,
      userId: String(user.id),
      userName: identity.userName,
      userEmail: identity.userEmail,
      date,
      prizeId: prize.id,
      prizeLabel: prize.label,
      amount: award,
      unit: config.unit,
      weight: prize.weight,
      spendAmount: eligibility.currentAmount ?? null,
      note,
      createdAt: new Date().toISOString(),
      upstreamStatus
    };

    store.insertDraw(draw);

    logInfo("draw.success", {
      user: logUser(user),
      date,
      prizeId: prize.id,
      prizeLabel: prize.label,
      amount: award,
      unit: config.unit,
      weight: prize.weight,
      spendAmount: draw.spendAmount,
      upstreamStatus: draw.upstreamStatus,
      createdAt: draw.createdAt
    });

    return {
      ok: true,
      alreadyDrawn: false,
      date,
      unit: config.unit,
      prize: {
        id: prize.id,
        label: prize.label,
        amount: award,
        color: resolvePrizeColor(prize, Math.max(0, prizeIndex))
      },
      prizeIndex: Math.max(0, prizeIndex),
      draw: publicDraw(draw),
      quota: quotaPayload(date, true),
      eligibility
    };
  });
}

async function resolveEligibility(user, date, options = {}) {
  const requirement = getSpendRequirement();

  if (!requirement.enabled) {
    return {
      ...requirement,
      eligible: true,
      currentAmount: null,
      remainingAmount: 0
    };
  }

  if (!config.dailySpendPathTemplate) {
    const eligibility = {
      ...requirement,
      eligible: false,
      currentAmount: null,
      remainingAmount: requirement.requiredAmount,
      error: "missing_daily_spend_endpoint",
      message: "服务端未配置 Sub2API 每日消费查询接口。"
    };

    if (options.strict) {
      throw httpError(500, eligibility.error, eligibility.message, { eligibility });
    }

    return eligibility;
  }

  try {
    const currentAmount = await sub2api.fetchDailySpendAmount(user.id, date);
    const remainingAmount = roundAmount(Math.max(0, requirement.requiredAmount - currentAmount));

    return {
      ...requirement,
      eligible: remainingAmount <= 0,
      currentAmount,
      remainingAmount
    };
  } catch (error) {
    const eligibility = {
      ...requirement,
      eligible: false,
      currentAmount: null,
      remainingAmount: requirement.requiredAmount,
      error: error.code || "daily_spend_check_failed",
      message: error.message || "无法查询今日消费金额。"
    };

    if (options.strict) {
      if (error.status && error.code) {
        error.details = { ...(error.details || {}), eligibility };
        throw error;
      }

      throw httpError(502, eligibility.error, eligibility.message, { eligibility });
    }

    return eligibility;
  }
}

function getPrizes() {
  return store.getPrizes();
}

function getSpendRequirement() {
  const requiredAmount = roundAmount(
    Math.max(0, store.readNumberSetting("spend_required_amount", config.requiredDailySpend || 0))
  );
  const enabled = store.readBoolSetting("spend_enabled", config.requireDailySpend);

  return {
    enabled: Boolean(enabled && requiredAmount > 0),
    requiredAmount,
    unit: config.unit,
    timezone: config.timezone
  };
}

function getNotePrefix() {
  return store.getSetting("note_prefix") || config.notePrefix;
}

function getShowProbability() {
  return store.readBoolSetting("show_probability", config.showProbability);
}

function validateSpendRequirement(value) {
  const current = getSpendRequirement();
  const enabled = typeof value?.enabled === "boolean" ? value.enabled : current.enabled;
  const requiredAmount = roundAmount(Number(value?.requiredAmount ?? current.requiredAmount));

  if (!Number.isFinite(requiredAmount) || requiredAmount < 0) {
    throw httpError(400, "invalid_spend_requirement", "每日消费门槛金额不能小于 0。");
  }

  if (requiredAmount > 1_000_000_000) {
    throw httpError(400, "invalid_spend_requirement", "每日消费门槛金额过大。");
  }

  if (enabled && requiredAmount <= 0) {
    throw httpError(400, "invalid_spend_requirement", "启用消费门槛时，金额必须大于 0。");
  }

  return {
    enabled,
    requiredAmount,
    unit: config.unit,
    timezone: config.timezone
  };
}

function validateNotePrefix(value) {
  const notePrefix = String(value ?? "").trim();

  if (!notePrefix) {
    throw httpError(400, "invalid_note_prefix", "备注前缀不能为空。");
  }

  if (notePrefix.length > 120) {
    throw httpError(400, "invalid_note_prefix", "备注前缀最多 120 个字符。");
  }

  return notePrefix;
}

function validateMonth(value) {
  const month = String(value || "").trim();

  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw httpError(400, "invalid_month", "月份格式必须是 YYYY-MM。");
  }

  const monthNumber = Number(month.slice(5, 7));

  if (monthNumber < 1 || monthNumber > 12) {
    throw httpError(400, "invalid_month", "月份必须在 01 到 12 之间。");
  }

  return month;
}

function quotaPayload(date, drawn) {
  const resetDate = nextDateKey(date);

  return {
    limit: DRAWS_PER_DAY,
    used: drawn ? 1 : 0,
    remaining: drawn ? 0 : DRAWS_PER_DAY,
    resetDate,
    resetAt: zonedDateStartIso(resetDate, config.timezone)
  };
}

function publicUser(user) {
  return {
    id: String(user.id),
    name: displayUserName(user),
    email: user.email || "",
    balance: user.balance ?? null
  };
}

function publicDraw(draw) {
  return {
    date: draw.date,
    prizeId: draw.prizeId || "",
    prizeLabel: draw.prizeLabel || "",
    amount: Number(draw.amount || 0),
    unit: draw.unit,
    spendAmount: draw.spendAmount ?? null,
    note: draw.note || "",
    createdAt: draw.createdAt
  };
}

function publicPrizeFromDraw(draw) {
  const prizes = getPrizes();
  const enabled = activePrizes(prizes);
  const index = enabled.findIndex((prize) => prize.id === draw.prizeId);

  return {
    id: draw.prizeId || "",
    label: draw.prizeLabel || "",
    amount: Number(draw.amount || 0),
    color:
      index >= 0
        ? resolvePrizeColor(enabled[index], index)
        : resolvePrizeColor({ color: "" }, Math.max(0, activePrizeIndex(draw.prizeId)))
  };
}

function activePrizeIndex(prizeId) {
  const index = activePrizes(getPrizes()).findIndex((prize) => prize.id === prizeId);
  return index >= 0 ? index : 0;
}

function publicAdminDraw(draw) {
  return {
    userId: draw.userId,
    userName: draw.userName || "",
    userEmail: draw.userEmail || "",
    userDisplayName: displayUserName(draw) || `用户 ${draw.userId}`,
    date: draw.date,
    prizeId: draw.prizeId || "",
    prizeLabel: draw.prizeLabel || "",
    amount: Number(draw.amount || 0),
    unit: draw.unit,
    weight: Number(draw.weight || 0),
    spendAmount: draw.spendAmount ?? null,
    note: draw.note || "",
    createdAt: draw.createdAt,
    upstreamStatus: draw.upstreamStatus ?? null
  };
}

function refreshDrawIdentity(draw, user) {
  const identity = userIdentityForStorage(user);

  if (!identity.userName && !identity.userEmail) {
    return;
  }

  store.updateDrawIdentity(draw.id, identity);
  draw.userName = draw.userName || identity.userName;
  draw.userEmail = draw.userEmail || identity.userEmail;
}

function userIdentityForStorage(user) {
  return {
    userName: displayUserName(user),
    userEmail: firstNonEmpty(user.email, user.userEmail)
  };
}

function displayUserName(value) {
  return firstNonEmpty(
    value?.userDisplayName,
    value?.userName,
    value?.name,
    value?.username,
    value?.displayName,
    value?.email,
    value?.userEmail
  );
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();

    if (text) {
      return text;
    }
  }

  return "";
}

function logUser(user) {
  return {
    id: String(user.id),
    name: user.name || "",
    email: user.email || ""
  };
}

function buildAdminPayload() {
  const prizes = getPrizes();

  return {
    ok: true,
    unit: config.unit,
    timezone: config.timezone,
    notePrefix: getNotePrefix(),
    showProbability: getShowProbability(),
    spendRequirement: getSpendRequirement(),
    prizes,
    prizeSummary: summarizePrizes(prizes),
    stats: buildStats(prizes),
    system: buildSystemInfo(),
    recentDraws: store.getRecentDraws(100).map(publicAdminDraw)
  };
}

function buildStats(prizes = getPrizes()) {
  const today = dateKey(new Date(), config.timezone);
  const month = today.slice(0, 7);
  const todayStats = store.aggregate(today, nextDateKey(today));
  const monthStats = store.aggregate(`${month}-01`, nextMonthKey(month));
  const allTimeStats = store.aggregate("0000-00-00", "9999-99-99");
  const summary = summarizePrizes(prizes);
  const topPrize = store.getTopPrize();

  return {
    today,
    month,
    unit: config.unit,
    todayCount: todayStats.count,
    todayUsers: todayStats.users,
    todayAmount: roundAmount(todayStats.amount),
    monthCount: monthStats.count,
    monthUsers: monthStats.users,
    monthAmount: roundAmount(monthStats.amount),
    allTimeCount: allTimeStats.count,
    allTimeUsers: allTimeStats.users,
    allTimeAmount: roundAmount(allTimeStats.amount),
    averagePrize:
      allTimeStats.count > 0 ? roundAmount(allTimeStats.amount / allTimeStats.count) : 0,
    expectedValue: summary.expectedValue,
    topPrize: topPrize
      ? {
          prizeLabel: topPrize.prizeLabel || "",
          amount: Number(topPrize.amount || 0),
          unit: topPrize.unit,
          date: topPrize.date,
          userDisplayName: displayUserName(topPrize) || `用户 ${topPrize.userId}`
        }
      : null,
    dailyTrend: buildDailyTrend(14, today),
    prizeBreakdown: store.getPrizeBreakdown(`${month}-01`, nextMonthKey(month)),
    topWinners: store.getTopWinners(5).map((row) => ({
      ...row,
      userDisplayName: displayUserName(row) || `用户 ${row.userId}`,
      totalAmount: roundAmount(row.totalAmount)
    }))
  };
}

function buildDailyTrend(days, today) {
  const startDate = shiftDateKey(today, -(days - 1));
  const rows = store.getDailyTrendRows(startDate, today);
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const trend = [];

  for (let index = 0; index < days; index += 1) {
    const date = shiftDateKey(startDate, index);
    const row = byDate.get(date);

    trend.push({
      date,
      count: Number(row?.count || 0),
      amount: roundAmount(row?.amount || 0)
    });
  }

  return trend;
}

function buildSystemInfo() {
  const spendRequirement = getSpendRequirement();

  return {
    storage: "SQLite",
    publicBasePath: config.publicBasePath,
    sub2apiBaseUrl: config.sub2apiBaseUrl,
    authMePath: config.authMePath,
    adminAuthHeader: config.adminAuthHeader,
    adminAuthConfigured: Boolean(config.adminApiKey || config.adminAuthValue),
    balanceOperation: config.balanceOperation,
    balancePathTemplate: config.balancePathTemplate,
    balanceAmountField: config.balanceAmountField,
    spendRequirement,
    dailySpendConfigured: !spendRequirement.enabled || Boolean(config.dailySpendPathTemplate),
    dailySpendMethod: config.dailySpendMethod,
    dailySpendAuthHeader: config.dailySpendAuthHeader,
    dailySpendAuthConfigured: Boolean(config.dailySpendAuthValue),
    dailySpendPathTemplate: config.dailySpendPathTemplate,
    dailySpendBodyTemplate: config.dailySpendBodyTemplate,
    dailySpendAmountField: config.dailySpendAmountField,
    dbFile: config.dbFile,
    timezone: config.timezone,
    unit: config.unit,
    drawsPerDay: DRAWS_PER_DAY
  };
}

function requireAdmin(req) {
  if (!config.adminPassword) {
    throw httpError(403, "admin_disabled", "管理端未启用，请先配置 LOTTERY_ADMIN_PASSWORD。");
  }

  const provided = getAdminPassword(req);

  if (!safeEqual(provided, config.adminPassword)) {
    throw httpError(401, "invalid_admin_password", "管理密码错误。");
  }
}

function getAdminPassword(req) {
  const direct = req.headers["x-lottery-admin-password"] || req.headers["x-checkin-admin-password"];

  if (direct) {
    return String(direct);
  }

  const authorization = String(req.headers.authorization || "");

  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7);
  }

  if (authorization.toLowerCase().startsWith("basic ")) {
    try {
      const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
      const index = decoded.indexOf(":");
      return index === -1 ? decoded : decoded.slice(index + 1);
    } catch {
      return "";
    }
  }

  return "";
}

function stripPublicBasePath(pathname) {
  const base = config.publicBasePath;

  if (base === "/") {
    return pathname;
  }

  if (pathname === base) {
    return "/";
  }

  if (pathname.startsWith(`${base}/`)) {
    return pathname.slice(base.length) || "/";
  }

  return null;
}

function formatAmountText(value) {
  return String(roundAmount(value));
}
