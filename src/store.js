import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS prizes (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    amount REAL NOT NULL CHECK (amount >= 0),
    weight REAL NOT NULL CHECK (weight >= 0),
    color TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS draws (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL DEFAULT '',
    user_email TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL,
    prize_id TEXT NOT NULL DEFAULT '',
    prize_label TEXT NOT NULL DEFAULT '',
    amount REAL NOT NULL DEFAULT 0,
    unit TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 0,
    spend_amount REAL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    upstream_status INTEGER,
    UNIQUE (user_id, date)
  );

  CREATE INDEX IF NOT EXISTS idx_draws_created_at ON draws (created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_draws_user_date ON draws (user_id, date);
  CREATE INDEX IF NOT EXISTS idx_draws_date ON draws (date);
`;

const DRAW_COLUMNS = `
  id,
  user_id AS userId,
  user_name AS userName,
  user_email AS userEmail,
  date,
  prize_id AS prizeId,
  prize_label AS prizeLabel,
  amount,
  unit,
  weight,
  spend_amount AS spendAmount,
  note,
  created_at AS createdAt,
  upstream_status AS upstreamStatus
`;

export class Store {
  constructor(db, dbFile) {
    this.db = db;
    this.dbFile = dbFile;
    this.lock = Promise.resolve();
  }

  static async open(dbFile) {
    await mkdir(path.dirname(dbFile), { recursive: true });
    const db = new DatabaseSync(dbFile);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec(SCHEMA);

    return new Store(db, dbFile);
  }

  close() {
    try {
      this.db.close();
    } catch {
      // Ignore close errors during shutdown.
    }
  }

  withLock(task) {
    const next = this.lock.then(task, task);
    this.lock = next.catch(() => {});
    return next;
  }

  transaction(task) {
    this.db.exec("BEGIN");

    try {
      const result = task();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  // ---------- settings ----------

  getSetting(key) {
    return this.db.prepare("SELECT value FROM settings WHERE key = ? LIMIT 1").get(key)?.value || "";
  }

  setSetting(key, value) {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`
      )
      .run(key, String(value), new Date().toISOString());
  }

  readNumberSetting(key, fallback) {
    const value = this.getSetting(key);

    if (!value) {
      return fallback;
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  readBoolSetting(key, fallback) {
    const value = this.getSetting(key);

    if (value === "") {
      return fallback;
    }

    return ["1", "true", "yes", "on", "enabled"].includes(String(value).trim().toLowerCase());
  }

  seedSettings(defaults) {
    for (const [key, value] of Object.entries(defaults)) {
      if (this.getSetting(key) === "") {
        this.setSetting(key, value);
      }
    }
  }

  // ---------- prizes ----------

  countPrizes() {
    return Number(this.db.prepare("SELECT COUNT(*) AS count FROM prizes").get()?.count || 0);
  }

  getPrizes() {
    return this.db
      .prepare(
        `SELECT id, label, amount, weight, color, enabled
         FROM prizes
         ORDER BY sort_order ASC, rowid ASC`
      )
      .all()
      .map((row) => ({
        id: row.id,
        label: row.label,
        amount: Number(row.amount),
        weight: Number(row.weight),
        color: row.color || "",
        enabled: Boolean(row.enabled)
      }));
  }

  replacePrizes(prizes) {
    this.db.prepare("DELETE FROM prizes").run();
    const statement = this.db.prepare(
      `INSERT INTO prizes (id, label, amount, weight, color, enabled, sort_order, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const now = new Date().toISOString();

    prizes.forEach((prize, index) => {
      statement.run(
        prize.id,
        prize.label,
        prize.amount,
        prize.weight,
        prize.color || "",
        prize.enabled ? 1 : 0,
        index,
        now
      );
    });
  }

  // ---------- draws ----------

  findDraw(userId, date) {
    const row = this.db
      .prepare(`SELECT ${DRAW_COLUMNS} FROM draws WHERE user_id = ? AND date = ? LIMIT 1`)
      .get(String(userId), date);

    return row || null;
  }

  insertDraw(draw) {
    this.db
      .prepare(
        `INSERT INTO draws (
          id,
          user_id,
          user_name,
          user_email,
          date,
          prize_id,
          prize_label,
          amount,
          unit,
          weight,
          spend_amount,
          note,
          created_at,
          upstream_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        draw.id,
        String(draw.userId),
        draw.userName || "",
        draw.userEmail || "",
        draw.date,
        draw.prizeId || "",
        draw.prizeLabel || "",
        draw.amount,
        draw.unit,
        draw.weight || 0,
        draw.spendAmount ?? null,
        draw.note || "",
        draw.createdAt,
        draw.upstreamStatus ?? null
      );
  }

  updateDrawIdentity(id, identity) {
    this.db
      .prepare(
        `UPDATE draws
         SET
           user_name = CASE WHEN user_name = '' THEN ? ELSE user_name END,
           user_email = CASE WHEN user_email = '' THEN ? ELSE user_email END
         WHERE id = ?`
      )
      .run(identity.userName || "", identity.userEmail || "", id);
  }

  getMonthDraws(userId, month, nextMonth) {
    return this.db
      .prepare(
        `SELECT ${DRAW_COLUMNS}
         FROM draws
         WHERE user_id = ? AND date >= ? AND date < ?
         ORDER BY date ASC`
      )
      .all(String(userId), `${month}-01`, nextMonth);
  }

  getRecentDraws(limit) {
    return this.db
      .prepare(
        `SELECT ${DRAW_COLUMNS}
         FROM draws
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(limit);
  }

  aggregate(startDate, endDateExclusive) {
    const row = this.db
      .prepare(
        `SELECT
          COUNT(*) AS count,
          COUNT(DISTINCT user_id) AS users,
          COALESCE(SUM(amount), 0) AS amount
         FROM draws
         WHERE date >= ? AND date < ?`
      )
      .get(startDate, endDateExclusive);

    return {
      count: Number(row?.count || 0),
      users: Number(row?.users || 0),
      amount: Number(row?.amount || 0)
    };
  }

  getDailyTrendRows(startDate, endDateInclusive) {
    return this.db
      .prepare(
        `SELECT
          date,
          COUNT(*) AS count,
          COALESCE(SUM(amount), 0) AS amount
         FROM draws
         WHERE date >= ? AND date <= ?
         GROUP BY date`
      )
      .all(startDate, endDateInclusive);
  }

  getPrizeBreakdown(startDate, endDateExclusive) {
    return this.db
      .prepare(
        `SELECT
          COALESCE(NULLIF(prize_label, ''), prize_id) AS label,
          amount,
          unit,
          COUNT(*) AS count,
          COALESCE(SUM(amount), 0) AS totalAmount
         FROM draws
         WHERE date >= ? AND date < ?
         GROUP BY label, amount, unit
         ORDER BY count DESC, totalAmount DESC
         LIMIT 12`
      )
      .all(startDate, endDateExclusive)
      .map((row) => ({
        label: row.label || "奖品",
        amount: Number(row.amount || 0),
        unit: row.unit,
        count: Number(row.count || 0),
        totalAmount: Number(row.totalAmount || 0)
      }));
  }

  getTopWinners(limit) {
    return this.db
      .prepare(
        `SELECT
          user_id AS userId,
          MAX(user_name) AS userName,
          MAX(user_email) AS userEmail,
          COUNT(*) AS drawCount,
          COALESCE(SUM(amount), 0) AS totalAmount
         FROM draws
         GROUP BY user_id
         ORDER BY totalAmount DESC, drawCount DESC
         LIMIT ?`
      )
      .all(limit)
      .map((row) => ({
        userId: row.userId,
        userName: row.userName || "",
        userEmail: row.userEmail || "",
        drawCount: Number(row.drawCount || 0),
        totalAmount: Number(row.totalAmount || 0)
      }));
  }

  getTopPrize() {
    const row = this.db
      .prepare(
        `SELECT prize_label AS prizeLabel, amount, unit, date, user_id AS userId,
                user_name AS userName, user_email AS userEmail
         FROM draws
         ORDER BY amount DESC, created_at ASC
         LIMIT 1`
      )
      .get();

    return row || null;
  }
}
