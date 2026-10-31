import { timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";

export function httpError(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

export function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

export function sendHtml(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(html);
}

export function serveStatic(res, asset) {
  res.writeHead(200, {
    "Content-Type": asset.type,
    "Cache-Control": "no-store"
  });
  createReadStream(asset.file).pipe(res);
}

export async function readJsonBody(req) {
  let body = "";

  for await (const chunk of req) {
    body += chunk;

    if (body.length > 1024 * 1024) {
      throw httpError(413, "payload_too_large", "请求体过大。");
    }
  }

  if (!body.trim()) {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch {
    throw httpError(400, "invalid_json", "请求体不是合法 JSON。");
  }
}

export function parseCookieHeader(header) {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");

        if (index === -1) {
          return [part, ""];
        }

        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

export function asBearerToken(value) {
  return value.toLowerCase().startsWith("bearer ") ? value : `Bearer ${value}`;
}

export function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
