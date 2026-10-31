import { asBearerToken, httpError, parseCookieHeader } from "./http.js";
import { logError, logInfo } from "./log.js";
import { roundAmount } from "./prizes.js";
import { dailyRange } from "./time.js";

export function createSub2api(config) {
  async function fetchJson(url, options) {
    let response;

    try {
      response = await fetch(url, {
        ...options,
        signal: options?.signal || AbortSignal.timeout(15000)
      });
    } catch (error) {
      const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";

      logError("sub2api.fetch.failed", {
        url,
        method: options?.method || "GET",
        message: error.message
      });
      throw httpError(
        timedOut ? 504 : 502,
        timedOut ? "sub2api_timeout" : "sub2api_unreachable",
        timedOut ? "Sub2API 响应超时，请稍后再试。" : "无法连接 Sub2API。"
      );
    }

    const text = await response.text();
    let body = null;

    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text.slice(0, 1000) };
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      body
    };
  }

  function buildUserAuthHeaders(req = {}) {
    const headers = {};
    const requestHeaders = req.headers || {};
    const authorization = requestHeaders.authorization;
    const explicitToken = requestHeaders["x-sub2api-token"] || requestHeaders["x-user-token"];

    if (authorization) {
      headers.Authorization = authorization;
    } else if (explicitToken) {
      headers.Authorization = asBearerToken(String(explicitToken));
    }

    const cookies = parseCookieHeader(requestHeaders.cookie || "");
    const tokenCookieName = config.userTokenCookieNames.find((name) => cookies[name]);

    if (!headers.Authorization && tokenCookieName) {
      headers.Authorization = asBearerToken(cookies[tokenCookieName]);
    }

    if (requestHeaders.cookie) {
      headers.Cookie = requestHeaders.cookie;
    }

    return headers;
  }

  function getUserTokenFromRequest(req) {
    const headers = req.headers || {};
    const authorization = String(headers.authorization || "");
    const explicitToken = headers["x-sub2api-token"] || headers["x-user-token"];

    if (authorization.toLowerCase().startsWith("bearer ")) {
      return authorization.slice(7).trim();
    }

    if (authorization) {
      return authorization.trim();
    }

    if (explicitToken) {
      return String(explicitToken).replace(/^bearer\s+/i, "").trim();
    }

    const cookies = parseCookieHeader(headers.cookie || "");
    const tokenCookieName = config.userTokenCookieNames.find((name) => cookies[name]);

    return tokenCookieName ? String(cookies[tokenCookieName]).replace(/^bearer\s+/i, "").trim() : "";
  }

  function extractUser(payload) {
    const candidates = [
      payload?.data?.user,
      payload?.data?.currentUser,
      payload?.data,
      payload?.user,
      payload?.result?.user,
      payload?.result,
      payload
    ];

    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object") {
        continue;
      }

      const id = candidate.id ?? candidate.user_id ?? candidate.userId ?? candidate.uuid ?? candidate.sub;

      if (id === undefined || id === null || id === "") {
        continue;
      }

      return {
        id,
        name:
          candidate.username ??
          candidate.name ??
          candidate.displayName ??
          candidate.display_name ??
          candidate.nickname ??
          candidate.email ??
          "",
        email: candidate.email ?? "",
        balance: candidate.balance ?? candidate.quota ?? candidate.credit ?? null
      };
    }

    return null;
  }

  function extractUserFromJwt(req) {
    const token = getUserTokenFromRequest(req);

    if (!token) {
      return null;
    }

    const parts = token.split(".");

    if (parts.length < 2) {
      return null;
    }

    try {
      const payload = JSON.parse(Buffer.from(base64UrlToBase64(parts[1]), "base64").toString("utf8"));
      return extractUser(payload);
    } catch {
      return null;
    }
  }

  async function resolveCurrentUser(req) {
    const headers = buildUserAuthHeaders(req);
    const tokenUser = extractUserFromJwt(req);

    if (!headers.Authorization && !headers.Cookie) {
      throw httpError(
        401,
        "missing_user_token",
        "无法读取当前登录用户，请确认抽奖页与 Sub2API 同源部署。"
      );
    }

    const upstream = await fetchJson(`${config.sub2apiBaseUrl}${config.authMePath}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...headers
      }
    });

    if (!upstream.ok) {
      throw httpError(401, "invalid_user_token", "当前登录态验证失败，请重新登录 Sub2API 后再试。");
    }

    const user = mergeUserIdentity(extractUser(upstream.body), tokenUser);

    if (!user?.id) {
      logError("sub2api.user.unrecognized", { body: upstream.body });
      throw httpError(502, "unrecognized_user_response", "无法从 Sub2API 用户接口解析用户 ID。");
    }

    logInfo("sub2api.user.verified", {
      user: logUser(user),
      upstreamStatus: upstream.status
    });

    return user;
  }

  async function addUserBalance(userId, amount, note) {
    if (!config.adminAuthValue) {
      throw httpError(500, "missing_admin_api_key", "服务端未配置 SUB2API_ADMIN_API_KEY。");
    }

    const url = `${config.sub2apiBaseUrl}${config.balancePathTemplate.replace(
      "{id}",
      encodeURIComponent(String(userId))
    )}`;
    const body = {
      [config.balanceAmountField]: amount,
      operation: config.balanceOperation,
      notes: note
    };

    const upstream = await fetchJson(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        [config.adminAuthHeader]: config.adminAuthValue
      },
      body: JSON.stringify(body)
    });

    if (!upstream.ok) {
      logError("sub2api.balance.failed", {
        userId: String(userId),
        amount,
        operation: config.balanceOperation,
        status: upstream.status,
        body: upstream.body
      });
      throw httpError(502, "balance_update_failed", "Sub2API 余额发放失败，请稍后再试。");
    }

    return upstream;
  }

  async function fetchDailySpendAmount(userId, date) {
    if (!config.dailySpendAuthValue) {
      throw httpError(500, "missing_daily_spend_auth", "服务端未配置每日消费查询接口鉴权。");
    }

    const url = buildDailySpendUrl(userId, date);
    const method = config.dailySpendMethod || "GET";
    const body = ["GET", "HEAD"].includes(method) ? undefined : buildDailySpendBody(userId, date);
    const upstream = await fetchJson(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        [config.dailySpendAuthHeader]: config.dailySpendAuthValue
      },
      body
    });

    if (!upstream.ok) {
      logError("sub2api.daily_spend.failed", {
        userId: String(userId),
        date,
        status: upstream.status,
        url,
        method,
        body: upstream.body
      });

      if (upstream.status === 401 || upstream.status === 403) {
        throw httpError(
          502,
          "daily_spend_unauthorized",
          "Sub2API 拒绝了消费查询：请确认 SUB2API_ADMIN_API_KEY 填的是管理后台的 Admin API Key，且消费查询鉴权头为 x-api-key。",
          { upstreamStatus: upstream.status }
        );
      }

      if (upstream.status === 404) {
        throw httpError(
          502,
          "daily_spend_endpoint_not_found",
          "Sub2API 没有找到消费查询接口（404）：请检查 SUB2API_DAILY_SPEND_PATH_TEMPLATE 是否与当前 Sub2API 版本一致。",
          { upstreamStatus: upstream.status }
        );
      }

      throw httpError(
        502,
        "daily_spend_query_failed",
        `Sub2API 今日消费查询失败（HTTP ${upstream.status}）。`,
        { upstreamStatus: upstream.status }
      );
    }

    return extractDailySpendAmount(upstream.body, userId, date);
  }

  function buildDailySpendUrl(userId, date) {
    const rendered = renderDailySpendTemplate(config.dailySpendPathTemplate, userId, date);

    if (/^https?:\/\//i.test(rendered)) {
      return rendered;
    }

    return `${config.sub2apiBaseUrl}${ensureLeadingSlash(rendered)}`;
  }

  function buildDailySpendBody(userId, date) {
    if (!config.dailySpendBodyTemplate) {
      return undefined;
    }

    const rendered = renderDailySpendTemplate(config.dailySpendBodyTemplate, userId, date, {
      encodeValues: false
    });

    try {
      return JSON.stringify(JSON.parse(rendered));
    } catch {
      return rendered;
    }
  }

  function renderDailySpendTemplate(template, userId, date, options = {}) {
    const range = dailyRange(date, config.timezone);
    const encodeValues = options.encodeValues !== false;
    const replacements = {
      id: userId,
      userId,
      user_id: userId,
      date,
      start: range.startDate,
      end: range.endDate,
      start_date: range.startDate,
      end_date: range.endDate,
      start_iso: range.startIso,
      end_iso: range.endIso,
      start_ts: range.startTs,
      end_ts: range.endTs,
      start_ms: range.startMs,
      end_ms: range.endMs
    };

    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
      if (!(key in replacements)) {
        return match;
      }

      const value = String(replacements[key]);
      return encodeValues ? encodeURIComponent(value) : value;
    });
  }

  function extractDailySpendAmount(payload, userId, date) {
    const amountField = config.dailySpendAmountField
      ? renderDailySpendTemplate(config.dailySpendAmountField, userId, date, { encodeValues: false })
      : "";
    let rawAmount = amountField ? valueAtPath(payload, amountField) : undefined;
    let amount = normalizeSpendAmount(rawAmount);

    if (!Number.isFinite(amount)) {
      const batchAmount = extractBatchUsageAmount(payload, userId);

      if (Number.isFinite(batchAmount)) {
        amount = batchAmount;
        rawAmount = batchAmount;
      }
    }

    if (!Number.isFinite(amount)) {
      const detected = autoDetectSpendAmount(payload, userId);

      if (Number.isFinite(detected)) {
        amount = detected;
        rawAmount = detected;
      }
    }

    if (!Number.isFinite(amount)) {
      logError("sub2api.daily_spend.unrecognized", {
        amountField,
        body: payload
      });
      throw httpError(502, "unrecognized_daily_spend_response", "无法从 Sub2API 响应解析今日消费金额。");
    }

    return roundAmount(Math.max(0, amount));
  }

  async function probe() {
    const url = `${config.sub2apiBaseUrl}${config.authMePath}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" }
      });

      logInfo("sub2api.connection.ok", {
        baseUrl: config.sub2apiBaseUrl,
        authMePath: config.authMePath,
        status: response.status
      });
    } catch (error) {
      logError("sub2api.connection.failed", {
        baseUrl: config.sub2apiBaseUrl,
        authMePath: config.authMePath,
        message: error.message
      });
    }
  }

  return {
    resolveCurrentUser,
    addUserBalance,
    fetchDailySpendAmount,
    probe
  };
}

function extractBatchUsageAmount(payload, userId) {
  const userIdText = String(userId || "");
  const roots = [
    payload?.data?.stats,
    payload?.stats,
    payload?.data?.users,
    payload?.users,
    payload?.data,
    payload
  ];

  for (const root of roots) {
    if (!root || typeof root !== "object") {
      continue;
    }

    let entries = [];

    if (Array.isArray(root)) {
      entries = root;
    } else if (userIdText && root[userIdText] != null) {
      entries = [root[userIdText]];
    } else {
      entries = Object.values(root).filter((item) => item && typeof item === "object");
    }

    for (const entry of entries) {
      if (entry == null || typeof entry !== "object") {
        continue;
      }

      const entryUserId = String(entry.user_id ?? entry.userId ?? entry.id ?? "");

      if (entryUserId && userIdText && entryUserId !== userIdText) {
        continue;
      }

      for (const field of [
        "today_actual_cost",
        "todayActualCost",
        "today_cost",
        "todayCost",
        "actual_cost"
      ]) {
        const amount = normalizeSpendAmount(entry[field], { allowArray: false });

        if (Number.isFinite(amount)) {
          return amount;
        }
      }
    }
  }

  return NaN;
}

function autoDetectSpendAmount(payload, userId = "") {
  if (typeof payload === "number" || typeof payload === "string") {
    return normalizeSpendAmount(payload, { allowArray: false });
  }

  const userIdText = String(userId || "");

  if (payload && typeof payload === "object" && userIdText) {
    const userScopedCandidates = [
      payload?.data?.[userIdText],
      payload?.data?.users?.[userIdText],
      payload?.result?.[userIdText],
      payload?.result?.users?.[userIdText],
      payload?.users?.[userIdText],
      payload?.[userIdText]
    ];

    for (const candidate of userScopedCandidates) {
      if (candidate && candidate !== payload) {
        const amount = autoDetectSpendAmount(candidate);

        if (Number.isFinite(amount)) {
          return amount;
        }
      }
    }
  }

  const amountFields = [
    "data",
    "data.today_cost",
    "data.todayCost",
    "data.today_usage",
    "data.todayUsage",
    "data.daily_cost",
    "data.dailyCost",
    "data.total_cost",
    "data.totalCost",
    "data.total_amount",
    "data.totalAmount",
    "data.total",
    "data.cost",
    "data.usage",
    "data.used",
    "data.used_quota",
    "data.usedQuota",
    "data.quota",
    "result.total_cost",
    "result.totalCost",
    "result.total_amount",
    "result.totalAmount",
    "result.total",
    "result.today_cost",
    "result.todayCost",
    "result.today_usage",
    "result.todayUsage",
    "result.used_quota",
    "result.usedQuota",
    "result.quota",
    "result",
    "today_cost",
    "todayCost",
    "today_usage",
    "todayUsage",
    "daily_cost",
    "dailyCost",
    "total_cost",
    "totalCost",
    "total_amount",
    "totalAmount",
    "total",
    "cost",
    "usage",
    "used",
    "used_quota",
    "usedQuota",
    "quota",
    "amount"
  ];

  for (const field of amountFields) {
    const value = valueAtPath(payload, field);

    if (value !== undefined && value !== null) {
      const amount = normalizeSpendAmount(value, { allowArray: false });

      if (Number.isFinite(amount)) {
        return amount;
      }
    }
  }

  const arrays = [
    payload?.data?.items,
    payload?.data?.records,
    payload?.data?.logs,
    payload?.data?.list,
    payload?.result?.items,
    payload?.result?.records,
    payload?.items,
    payload?.records,
    payload?.logs,
    payload?.list,
    payload?.data,
    payload
  ].filter(Array.isArray);

  for (const items of arrays) {
    const amount = sumSpendRecords(filterSpendRecordsByUser(items, userIdText));

    if (Number.isFinite(amount)) {
      return amount;
    }
  }

  return NaN;
}

function filterSpendRecordsByUser(records, userId) {
  if (!userId) {
    return records;
  }

  const filtered = records.filter(
    (record) => String(record?.user_id ?? record?.userId ?? record?.id ?? "") === userId
  );
  return filtered.length > 0 ? filtered : records;
}

function normalizeSpendAmount(value, options = {}) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const amount = Number(value.trim());
    return Number.isFinite(amount) ? amount : NaN;
  }

  if (Array.isArray(value) && options.allowArray !== false) {
    return sumSpendRecords(value);
  }

  if (value && typeof value === "object") {
    return autoDetectSpendAmount(value);
  }

  return NaN;
}

function sumSpendRecords(records) {
  let total = 0;
  let matched = 0;

  for (const record of records) {
    const amount = extractSpendRecordAmount(record);

    if (Number.isFinite(amount)) {
      total += amount;
      matched += 1;
    }
  }

  return matched > 0 ? total : NaN;
}

function extractSpendRecordAmount(record) {
  if (!record || typeof record !== "object") {
    return NaN;
  }

  const fields = [
    "today_cost",
    "todayCost",
    "today_usage",
    "todayUsage",
    "daily_cost",
    "dailyCost",
    "cost",
    "amount",
    "price",
    "usage",
    "used",
    "quota",
    "used_quota",
    "usedQuota",
    "total_cost",
    "totalCost"
  ];

  for (const field of fields) {
    const amount = normalizeSpendAmount(record[field], { allowArray: false });

    if (Number.isFinite(amount)) {
      return amount;
    }
  }

  return NaN;
}

function valueAtPath(value, pathValue) {
  if (!pathValue) {
    return undefined;
  }

  return String(pathValue)
    .split(".")
    .filter(Boolean)
    .reduce((current, key) => (current == null ? undefined : current[key]), value);
}

function mergeUserIdentity(user, tokenUser) {
  if (!user) {
    return tokenUser;
  }

  if (!tokenUser) {
    return user;
  }

  return {
    ...user,
    id: user.id ?? tokenUser.id,
    name: firstNonEmpty(user.name, tokenUser.name),
    email: firstNonEmpty(user.email, tokenUser.email),
    balance: user.balance ?? tokenUser.balance ?? null
  };
}

function base64UrlToBase64(value) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  return base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
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

function ensureLeadingSlash(value) {
  return value.startsWith("/") ? value : `/${value}`;
}

function logUser(user) {
  return {
    id: String(user.id),
    name: user.name || "",
    email: user.email || ""
  };
}
