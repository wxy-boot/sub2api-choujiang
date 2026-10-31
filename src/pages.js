export function renderIndex(config) {
  const base = config.publicBasePath === "/" ? "" : config.publicBasePath;

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark light" />
    <title>Sub2API 每日幸运大转盘</title>
    <link rel="stylesheet" href="${base}/styles.css" />
    <script>window.__LOTTERY_BASE_PATH__ = ${JSON.stringify(config.publicBasePath)};</script>
    <script type="module" src="${base}/app.js"></script>
  </head>
  <body>
    <main class="shell">
      <header class="page-head">
        <div class="head-copy">
          <p class="eyebrow">Daily Lucky Wheel</p>
          <h1>每日幸运大转盘</h1>
          <p class="summary" id="summary">正在读取当前登录用户...</p>
        </div>
        <div class="head-actions">
          <span class="user-chip" id="userChip" hidden>
            <i class="chip-dot" aria-hidden="true"></i>
            <span id="userName">-</span>
          </span>
          <button class="ghost-button" id="refreshButton" type="button">刷新状态</button>
        </div>
      </header>

      <section class="stage-grid">
        <article class="panel wheel-panel">
          <div class="panel-head stage-head">
            <div>
              <p class="eyebrow">Spin Now</p>
              <h2 id="wheelTitle">今天的手气，转一下就知道</h2>
            </div>
            <span class="pill" id="quotaPill">今日 1 次机会</span>
          </div>

          <div class="wheel-stage" id="wheelStage">
            <div class="wheel-glow" aria-hidden="true"></div>
            <div class="wheel-pointer" aria-hidden="true"></div>
            <div class="wheel-ring" id="wheelRing">
              <div class="wheel-rotor" id="wheelRotor">
                <canvas id="wheelCanvas" width="720" height="720" role="img" aria-label="奖品转盘"></canvas>
              </div>
              <button class="wheel-hub" id="spinButton" type="button" disabled>
                <span class="hub-label" id="spinButtonLabel">抽奖</span>
                <span class="hub-sub" id="spinButtonSub">读取中</span>
              </button>
            </div>
          </div>

          <p class="stage-message" id="message" data-tone="neutral" role="status" aria-live="polite">正在读取抽奖资格...</p>
          <p class="stage-hint" id="hint"></p>
        </article>

        <aside class="side-column">
          <article class="panel gate-panel">
            <div class="panel-head">
              <div>
                <p class="eyebrow">Spend Gate</p>
                <h2>今日抽奖门槛</h2>
              </div>
              <span class="status-badge" id="gateBadge">读取中</span>
            </div>
            <div
              class="gate-progress"
              id="gateProgress"
              role="progressbar"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow="0"
            >
              <i id="gateProgressBar"></i>
            </div>
            <p class="gate-caption" id="gateText">-</p>
            <dl class="metric-row">
              <div>
                <dt>今日已消费</dt>
                <dd id="spentText">-</dd>
              </div>
              <div>
                <dt>距离达标</dt>
                <dd id="remainingText">-</dd>
              </div>
              <div>
                <dt>抽奖机会</dt>
                <dd id="quotaText">-</dd>
              </div>
            </dl>
          </article>

          <article class="panel today-panel" id="todayPanel" hidden>
            <div class="panel-head">
              <div>
                <p class="eyebrow">Today</p>
                <h2>今日战果</h2>
              </div>
              <span class="status-badge is-win" id="todayBadge">已抽奖</span>
            </div>
            <p class="today-prize" id="todayPrize">-</p>
            <p class="today-meta" id="todayMeta"></p>
          </article>

          <article class="panel prizes-panel">
            <div class="panel-head">
              <div>
                <p class="eyebrow">Prize Pool</p>
                <h2>奖品池</h2>
              </div>
              <span class="pill" id="prizeCountPill">-</span>
            </div>
            <div class="prize-list" id="prizeList"></div>
            <p class="hint" id="prizeHint"></p>
          </article>
        </aside>

        <section class="panel history-panel">
          <div class="panel-head">
            <div>
              <p class="eyebrow">History</p>
              <h2 id="historyTitle">本月抽奖记录</h2>
            </div>
            <div class="month-actions">
              <button class="ghost-button" id="prevMonthButton" type="button">上月</button>
              <button class="ghost-button" id="currentMonthButton" type="button">本月</button>
              <button class="ghost-button" id="nextMonthButton" type="button">下月</button>
            </div>
          </div>
          <div class="history-summary" id="historySummary"></div>
          <div class="history-list" id="historyList"></div>
        </section>
      </section>
    </main>

    <div class="result-modal" id="resultModal" hidden>
      <div class="result-backdrop" data-close-modal></div>
      <section class="result-card" role="dialog" aria-modal="true" aria-labelledby="resultTitle">
        <p class="eyebrow">Congratulations</p>
        <p class="result-kicker" id="resultKicker">好运降临</p>
        <h2 class="result-title" id="resultTitle">-</h2>
        <p class="result-label" id="resultLabel"></p>
        <p class="result-note" id="resultNote"></p>
        <div class="result-actions">
          <button class="primary-button" id="resultCloseButton" type="button">收下好运</button>
        </div>
      </section>
    </div>
    <div class="confetti-layer" id="confettiLayer" aria-hidden="true"></div>
  </body>
</html>`;
}

export function renderAdmin(config) {
  const base = config.publicBasePath === "/" ? "" : config.publicBasePath;

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark light" />
    <title>Sub2API 转盘抽奖管理</title>
    <link rel="stylesheet" href="${base}/admin.css" />
    <script>window.__LOTTERY_BASE_PATH__ = ${JSON.stringify(config.publicBasePath)};</script>
    <script type="module" src="${base}/admin.js"></script>
  </head>
  <body>
    <main class="admin-shell">
      <header class="page-head hero">
        <div>
          <p class="eyebrow">Lucky Wheel Admin</p>
          <h1>转盘抽奖管理</h1>
          <p class="summary">配置每日消费门槛、奖品池与中奖权重，并查看抽奖数据。</p>
        </div>
        <span class="pill hero-pill">SQLite · 零依赖</span>
      </header>

      <section class="panel login-panel" id="loginPanel">
        <label for="passwordInput">管理密码</label>
        <div class="login-row">
          <input
            id="passwordInput"
            type="password"
            autocomplete="current-password"
            placeholder="LOTTERY_ADMIN_PASSWORD"
          />
          <button id="loginButton" type="button">进入后台</button>
        </div>
        <p class="hint">管理端只使用独立密码，Sub2API Admin API Key 不会暴露给浏览器。</p>
      </section>
      <p class="message global-message" id="message"></p>

      <nav class="admin-tabs" id="adminTabs" aria-label="管理端导航" hidden>
        <button class="tab-button" type="button" data-tab="overview">总览</button>
        <button class="tab-button" type="button" data-tab="prizes">奖品设置</button>
        <button class="tab-button" type="button" data-tab="gate">抽奖门槛</button>
        <button class="tab-button" type="button" data-tab="records">抽奖记录</button>
        <button class="tab-button" type="button" data-tab="system">系统信息</button>
      </nav>

      <section class="tab-page" id="overviewPanel" data-panel="overview" hidden>
        <section class="panel stats-panel">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Analytics</p>
              <h2>抽奖总览</h2>
            </div>
            <span class="panel-note" id="statsDateText">-</span>
          </div>
          <div class="stats-grid">
            <article>
              <span>今日抽奖次数</span>
              <strong id="todayCountText">-</strong>
              <small>今日发放 <b id="todayAmountText">-</b></small>
            </article>
            <article>
              <span>本月抽奖用户</span>
              <strong id="monthUsersText">-</strong>
              <small>本月发放 <b id="monthAmountText">-</b></small>
            </article>
            <article>
              <span>累计抽奖次数</span>
              <strong id="allTimeCountText">-</strong>
              <small>累计用户 <b id="allTimeUsersText">-</b></small>
            </article>
            <article>
              <span>累计发放总额</span>
              <strong id="allTimeAmountText">-</strong>
              <small>平均每次 <b id="averagePrizeText">-</b></small>
            </article>
            <article>
              <span>单次期望支出</span>
              <strong id="expectedValueText">-</strong>
              <small>按当前奖品权重计算</small>
            </article>
            <article>
              <span>历史最大奖</span>
              <strong id="topPrizeText">-</strong>
              <small id="topPrizeMeta">-</small>
            </article>
          </div>
        </section>

        <section class="dashboard-grid">
          <article class="panel">
            <div class="panel-head">
              <div>
                <p class="eyebrow">Trend</p>
                <h2>近 14 天抽奖趋势</h2>
              </div>
            </div>
            <div class="trend-chart" id="trendList"></div>
          </article>

          <article class="panel">
            <div class="panel-head">
              <div>
                <p class="eyebrow">Prizes</p>
                <h2>本月奖品分布</h2>
              </div>
            </div>
            <div class="breakdown-list" id="prizeBreakdownList"></div>
            <p class="breakdown-total" id="breakdownTotal"></p>
          </article>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Lucky Users</p>
              <h2>累计中奖榜</h2>
            </div>
            <span class="panel-note">按累计中奖金额排序</span>
          </div>
          <div class="winner-list" id="winnerList"></div>
        </section>
      </section>

      <section class="panel tab-page" id="prizesPanel" data-panel="prizes" hidden>
        <div class="panel-head">
          <div>
            <p class="eyebrow">Wheel Prizes</p>
            <h2>奖品池与权重</h2>
          </div>
          <div class="head-tools">
            <button class="secondary" id="reloadPrizesButton" type="button">重新加载</button>
            <button id="addPrizeButton" type="button">新增奖品</button>
          </div>
        </div>

        <div class="prize-meta">
          <div>
            <span>启用奖项</span>
            <strong id="prizeCountText">-</strong>
          </div>
          <div>
            <span>权重合计</span>
            <strong id="prizeWeightText">-</strong>
          </div>
          <div>
            <span>单次期望支出</span>
            <strong id="prizeEvText">-</strong>
          </div>
        </div>

        <p class="hint">
          转盘扇区等分显示，中奖概率 = 奖品权重 / 所有启用奖品权重总和。金额为 0 的奖品（如“谢谢参与”）不会调用余额接口。
        </p>

        <div class="prize-table">
          <div class="prize-table-head" aria-hidden="true">
            <span>启用</span>
            <span>奖品名称</span>
            <span>金额</span>
            <span>权重</span>
            <span>扇区颜色</span>
            <span>概率</span>
            <span></span>
          </div>
          <div class="prize-rows" id="prizeRows"></div>
        </div>

        <div class="settings-grid">
          <label class="toggle-card" for="showProbabilityInput">
            <span>公示中奖概率</span>
            <input id="showProbabilityInput" type="checkbox" />
            <small>开启后用户页奖品池会显示每个奖项的概率。</small>
          </label>
          <label class="field-card" for="notePrefixInput">
            <span>余额备注前缀</span>
            <input id="notePrefixInput" type="text" maxlength="120" placeholder="Lucky wheel draw" />
            <small>发放奖励时写入 Sub2API 余额备注，例如：Lucky wheel draw 2026-10-31 小确幸 0.1 USD</small>
          </label>
        </div>

        <div class="actions">
          <button class="secondary" id="reloadButton" type="button">撤销修改</button>
          <button class="primary" id="saveButton" type="button">保存全部配置</button>
        </div>
      </section>

      <section class="panel tab-page" id="gatePanel" data-panel="gate" hidden>
        <div class="panel-head">
          <div>
            <p class="eyebrow">Daily Spend Gate</p>
            <h2>抽奖门槛</h2>
          </div>
          <span class="pill">每人每天 1 次</span>
        </div>

        <div class="gate-form">
          <label class="toggle-card" for="spendEnabledInput">
            <span>启用每日消费门槛</span>
            <input id="spendEnabledInput" type="checkbox" />
            <small>关闭后，所有已登录 Sub2API 的用户每天都可以直接抽奖一次。</small>
          </label>
          <label class="field-card" for="spendRequiredInput">
            <span>当日消费满多少才能抽奖</span>
            <input id="spendRequiredInput" type="number" min="0" step="0.000001" placeholder="10" />
            <small>单位跟随 LOTTERY_UNIT，默认 USD。多数用户会配置为 10。</small>
          </label>
        </div>

        <p class="hint gate-preview" id="gatePreview"></p>
        <p class="hint">
          抽奖机会按服务端时区每天 0 点重置：当天没有抽奖，第二天仍然是 1 次，不会累积成多次。
        </p>

        <div class="actions">
          <button class="primary" id="saveGateButton" type="button">保存门槛设置</button>
        </div>
      </section>

      <section class="panel tab-page" id="recordsPanel" data-panel="records" hidden>
        <div class="panel-head">
          <div>
            <p class="eyebrow">Records</p>
            <h2>抽奖记录</h2>
          </div>
          <span class="panel-note" id="historyMetaText">-</span>
        </div>
        <div class="toolbar">
          <input id="recordSearchInput" type="search" placeholder="搜索用户、日期、奖品" />
          <button class="secondary" id="clearSearchButton" type="button">清空</button>
          <button class="secondary" id="exportCsvButton" type="button">导出 CSV</button>
        </div>
        <div class="history" id="history"></div>
      </section>

      <section class="tab-page" id="systemPanel" data-panel="system" hidden>
        <section class="panel">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Runtime</p>
              <h2>系统信息</h2>
            </div>
          </div>
          <div class="system-grid" id="systemGrid"></div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Checklist</p>
              <h2>部署检查</h2>
            </div>
          </div>
          <div class="checklist" id="checklist"></div>
        </section>
      </section>
    </main>
  </body>
</html>`;
}
