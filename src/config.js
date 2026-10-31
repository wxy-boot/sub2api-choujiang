import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const rootDir = path.resolve(__dirname, "..");

export const DEFAULT_PRIZES = [
  { id: "prize-1", label: "小确幸", amount: 0.1, weight: 280, enabled: true, color: "" },
  { id: "prize-2", label: "小惊喜", amount: 0.2, weight: 220, enabled: true, color: "" },
  { id: "prize-3", label: "好运到", amount: 0.3, weight: 160, enabled: true, color: "" },
  { id: "prize-4", label: "幸运星", amount: 0.5, weight: 120, enabled: true, color: "" },
  { id: "prize-5", label: "小锦鲤", amount: 0.8, weight: 90, enabled: true, color: "" },
  { id: "prize-6", label: "欧气满满", amount: 1, weight: 70, enabled: true, color: "" },
  { id: "prize-7", label: "超级幸运", amount: 1.5, weight: 40, enabled: true, color: "" },
  { id: "prize-8", label: "锦鲤附体", amount: 2, weight: 20, enabled: true, color: "" }
];

const requiredDailySpend = readFloatEnv(
  "LOTTERY_REQUIRED_DAILY_SPEND",
  readFloatEnv("LOTTERY_DAILY_SPEND", 10)
);

// Sub2API 自带的批量用户用量接口。没有显式配置消费查询时直接用它，
// 这样部署后无需额外配置就能按当天实际扣除金额判断门槛。
const customSpendPath =
  process.env.SUB2API_DAILY_SPEND_PATH_TEMPLATE ||
  process.env.LOTTERY_DAILY_SPEND_PATH_TEMPLATE ||
  "";
const useBuiltinSpendEndpoint = !customSpendPath;

// 如果消费查询没有自己的 token（例如只配置了 Admin API Key），
// 鉴权头要跟随 Sub2API 管理端鉴权头，通常是 x-api-key；
// 否则旧版 .env 里遗留的 Authorization 会把 Admin Key 当成 JWT 发出去。
const explicitSpendAuthValue = firstUsableSecret(
  process.env.SUB2API_DAILY_SPEND_AUTH_VALUE,
  process.env.LOTTERY_DAILY_SPEND_AUTH_VALUE
);
const spendAuthValue =
  explicitSpendAuthValue ||
  firstUsableSecret(process.env.SUB2API_ADMIN_AUTH_VALUE, process.env.SUB2API_ADMIN_API_KEY);
const spendAuthHeader = explicitSpendAuthValue
  ? process.env.SUB2API_DAILY_SPEND_AUTH_HEADER ||
    process.env.LOTTERY_DAILY_SPEND_AUTH_HEADER ||
    process.env.SUB2API_ADMIN_AUTH_HEADER ||
    "x-api-key"
  : process.env.SUB2API_ADMIN_AUTH_HEADER || "x-api-key";

export const config = {
  serviceName: "sub2api-choujiang",
  port: readIntEnv("PORT", 8788),
  publicBasePath: normalizeBasePath(process.env.PUBLIC_BASE_PATH || "/"),
  sub2apiBaseUrl: trimTrailingSlash(process.env.SUB2API_BASE_URL || "http://127.0.0.1:3000"),
  authMePath: ensureLeadingSlash(process.env.SUB2API_AUTH_ME_PATH || "/api/v1/auth/me"),
  adminApiKey: process.env.SUB2API_ADMIN_API_KEY || "",
  adminAuthHeader: process.env.SUB2API_ADMIN_AUTH_HEADER || "x-api-key",
  adminAuthValue: firstUsableSecret(
    process.env.SUB2API_ADMIN_AUTH_VALUE,
    process.env.SUB2API_ADMIN_API_KEY
  ),
  balancePathTemplate:
    process.env.SUB2API_BALANCE_PATH_TEMPLATE || "/api/v1/admin/users/{id}/balance",
  balanceOperation: process.env.SUB2API_BALANCE_OPERATION || "add",
  balanceAmountField: process.env.SUB2API_BALANCE_AMOUNT_FIELD || "balance",
  requireDailySpend: readBoolEnv("LOTTERY_REQUIRE_DAILY_SPEND", requiredDailySpend > 0),
  requiredDailySpend,
  dailySpendAuthHeader: spendAuthHeader,
  dailySpendAuthValue: spendAuthValue,
  dailySpendPathTemplate: customSpendPath || "/api/v1/admin/dashboard/users-usage",
  dailySpendBodyTemplate:
    process.env.SUB2API_DAILY_SPEND_BODY_TEMPLATE ||
    process.env.LOTTERY_DAILY_SPEND_BODY_TEMPLATE ||
    (useBuiltinSpendEndpoint ? '{"user_ids":[{id}]}' : ""),
  dailySpendMethod: (
    process.env.SUB2API_DAILY_SPEND_METHOD || (useBuiltinSpendEndpoint ? "POST" : "GET")
  ).toUpperCase(),
  dailySpendAmountField:
    process.env.SUB2API_DAILY_SPEND_AMOUNT_FIELD ||
    (useBuiltinSpendEndpoint ? "data.stats.{id}.today_actual_cost" : ""),
  unit: process.env.LOTTERY_UNIT || "USD",
  timezone: process.env.LOTTERY_TIMEZONE || "Asia/Shanghai",
  notePrefix: process.env.LOTTERY_NOTE_PREFIX || "Lucky wheel draw",
  showProbability: readBoolEnv("LOTTERY_SHOW_PROBABILITY", false),
  adminPassword: process.env.LOTTERY_ADMIN_PASSWORD || "",
  dbFile: path.resolve(
    rootDir,
    process.env.LOTTERY_DB_FILE || process.env.SQLITE_FILE || "./data/lottery.db"
  ),
  defaultPrizes: parsePrizesEnv(process.env.LOTTERY_PRIZES || ""),
  publicTokenStorageKeys: splitCsv(
    process.env.PUBLIC_TOKEN_STORAGE_KEYS ||
      "token,access_token,auth_token,sub2api_token,auth-storage,user,sub2api-auth"
  ),
  userTokenCookieNames: splitCsv(
    process.env.USER_TOKEN_COOKIE_NAMES || "token,access_token,auth_token,sub2api_token"
  )
};

function parsePrizesEnv(value) {
  const text = String(value || "").trim();

  if (!text) {
    return DEFAULT_PRIZES.map((prize) => ({ ...prize }));
  }

  try {
    const parsed = JSON.parse(text);

    if (Array.isArray(parsed)) {
      const parsedPrizes = parsed.map((prize, index) => ({
        id: `env-${index + 1}`,
        label: String(prize?.label ?? prize?.name ?? "").trim(),
        amount: Number(prize?.amount),
        weight: Number(prize?.weight),
        enabled: prize?.enabled !== false,
        color: String(prize?.color || "")
      }));

      return parsedPrizes.length > 0 ? parsedPrizes : DEFAULT_PRIZES.map((prize) => ({ ...prize }));
    }
  } catch {
    // Fall through to the compact amount:weight:label syntax.
  }

  const csvPrizes = text
    .split(",")
    .map((item, index) => {
      const [amount, weight = "1", label = ""] = item.split(":").map((part) => part.trim());

      return {
        id: `env-${index + 1}`,
        label,
        amount: Number(amount),
        weight: Number(weight),
        enabled: true,
        color: ""
      };
    })
    .filter((prize) => Number.isFinite(prize.amount));

  return csvPrizes.length > 0 ? csvPrizes : DEFAULT_PRIZES.map((prize) => ({ ...prize }));
}

export function readIntEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) ? value : fallback;
}

export function readFloatEnv(name, fallback) {
  const value = Number.parseFloat(process.env[name] || "");
  return Number.isFinite(value) ? value : fallback;
}

export function readBoolEnv(name, fallback = false) {
  const value = String(process.env[name] || "").trim().toLowerCase();

  if (["1", "true", "yes", "on", "enabled"].includes(value)) {
    return true;
  }

  if (["0", "false", "no", "off", "disabled"].includes(value)) {
    return false;
  }

  return fallback;
}

function splitCsv(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

// 忽略 .env.example 里的示例值，避免用户只改域名后把占位 token 发到 Sub2API。
function usableSecret(value) {
  const text = String(value || "").trim();

  if (!text) {
    return "";
  }

  if (/your-admin-token|your-admin-api-key|change-this/i.test(text)) {
    return "";
  }

  return text;
}

function firstUsableSecret(...values) {
  for (const value of values) {
    const secret = usableSecret(value);

    if (secret) {
      return secret;
    }
  }

  return "";
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function ensureLeadingSlash(value) {
  return value.startsWith("/") ? value : `/${value}`;
}

function normalizeBasePath(value) {
  const pathValue = ensureLeadingSlash(value || "/").replace(/\/+$/, "");
  return pathValue || "/";
}
