import { randomInt } from "node:crypto";
import { httpError } from "./http.js";

export const PRIZE_PALETTE = [
  "#0f8f83",
  "#2b72c4",
  "#6350c2",
  "#a83fa8",
  "#b45f26",
  "#94750f",
  "#2b8f5f",
  "#b03d54",
  "#0e8fa8",
  "#5b6fd6",
  "#c04f86",
  "#8a7a2a"
];

export const MAX_PRIZES = 16;

export function roundAmount(value) {
  return Number(Number(value).toFixed(6));
}

export function resolvePrizeColor(prize, index) {
  return prize.color || PRIZE_PALETTE[index % PRIZE_PALETTE.length];
}

export function validatePrizeRules(rules, options = {}) {
  const allowEmpty = options.allowEmpty === true;

  if (!Array.isArray(rules)) {
    if (allowEmpty) {
      return [];
    }

    throw httpError(400, "invalid_prizes", "奖品必须是数组。");
  }

  const normalized = [];
  const usedIds = new Set();

  rules
    .map((rule, index) => ({
      id: sanitizePrizeId(rule?.id, index),
      label: sanitizePrizeLabel(rule?.label, rule?.amount),
      amount: roundAmount(Number(rule?.amount)),
      weight: Number(rule?.weight),
      color: sanitizeColor(rule?.color),
      enabled: rule?.enabled !== false
    }))
    .filter((rule) => rule.enabled || rule.amount || rule.weight || rule.label)
    .forEach((rule) => {
      normalized.push({ ...rule, id: uniquePrizeId(rule.id, usedIds) });
    });

  if (!allowEmpty && normalized.length === 0) {
    throw httpError(400, "empty_prizes", "至少需要配置一个奖品。");
  }

  if (normalized.length > MAX_PRIZES) {
    throw httpError(400, "too_many_prizes", `奖品最多 ${MAX_PRIZES} 个，太拥挤的转盘会看不清。`);
  }

  for (const prize of normalized) {
    if (!Number.isFinite(prize.amount) || prize.amount < 0) {
      throw httpError(400, "invalid_prize_amount", `奖品「${prize.label}」的金额不能小于 0。`);
    }

    if (!Number.isFinite(prize.weight) || prize.weight < 0) {
      throw httpError(400, "invalid_prize_weight", `奖品「${prize.label}」的权重不能小于 0。`);
    }
  }

  if (!allowEmpty && totalEnabledWeight(normalized) <= 0) {
    throw httpError(400, "invalid_prize_weight", "至少需要一个启用奖品的权重大于 0。");
  }

  return normalized;
}

export function totalEnabledWeight(prizes) {
  return prizes
    .filter((prize) => prize.enabled && prize.weight > 0)
    .reduce((sum, prize) => sum + prize.weight, 0);
}

export function activePrizes(prizes) {
  return prizes.filter((prize) => prize.enabled && prize.weight > 0);
}

export function summarizePrizes(prizes) {
  const active = activePrizes(prizes);
  const totalWeight = totalEnabledWeight(active);
  const amounts = active.map((prize) => prize.amount);
  const expectedValue =
    totalWeight > 0
      ? roundAmount(
          active.reduce((sum, prize) => sum + (prize.amount * prize.weight) / totalWeight, 0)
        )
      : 0;

  return {
    prizeCount: active.length,
    totalWeight,
    minAmount: active.length > 0 ? Math.min(...amounts) : 0,
    maxAmount: active.length > 0 ? Math.max(...amounts) : 0,
    expectedValue,
    prizes: active.map((prize) => ({
      id: prize.id,
      label: prize.label,
      amount: prize.amount,
      weight: prize.weight,
      color: prize.color,
      probability: totalWeight > 0 ? prize.weight / totalWeight : 0
    }))
  };
}

export function toPublicPrizes(prizes, options = {}) {
  const summary = summarizePrizes(prizes);
  const showProbability = options.showProbability === true;

  return summary.prizes.map((prize, index) => ({
    id: prize.id,
    label: prize.label,
    amount: prize.amount,
    color: resolvePrizeColor(prize, index),
    probability: showProbability ? prize.probability : null
  }));
}

export function pickWeightedPrize(prizes, random = secureRandom) {
  const active = activePrizes(prizes);
  const totalWeight = totalEnabledWeight(active);

  if (totalWeight <= 0) {
    return null;
  }

  let cursor = random() * totalWeight;

  for (const prize of active) {
    cursor -= prize.weight;

    if (cursor < 0) {
      return { ...prize };
    }
  }

  return { ...active[active.length - 1] };
}

function secureRandom() {
  return randomInt(0, 1_000_000_001) / 1_000_000_000;
}

function sanitizePrizeId(value, index) {
  const raw = String(value || `prize-${index + 1}`).trim();
  return raw.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64) || `prize-${index + 1}`;
}

function uniquePrizeId(value, usedIds) {
  let id = value;
  let suffix = 2;

  while (usedIds.has(id)) {
    id = `${value}-${suffix}`;
    suffix += 1;
  }

  usedIds.add(id);
  return id;
}

function sanitizePrizeLabel(label, amount) {
  const fallback = Number.isFinite(Number(amount)) ? `${roundAmount(amount)}` : "幸运奖品";
  const value = String(label ?? "").trim() || fallback;
  return value.slice(0, 40);
}

function sanitizeColor(value) {
  const color = String(value || "").trim();

  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) {
    return color.toLowerCase();
  }

  return "";
}
