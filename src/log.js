const TAG = "[sub2api-choujiang]";

export function logInfo(event, data = {}) {
  writeLog("info", event, data);
}

export function logWarn(event, data = {}) {
  writeLog("warn", event, data);
}

export function logError(event, data = {}) {
  writeLog("error", event, data);
}

function writeLog(level, event, data) {
  const payload = {
    time: new Date().toISOString(),
    level,
    event,
    ...data
  };
  const line = `${TAG} ${JSON.stringify(payload)}`;

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}
