const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SORT_OPTIONS = [
  { value: 'relevance', label: '综合排序' },
  { value: 'best-selling', label: '销量优先' },
  { value: 'price-asc', label: '价格从低到高' },
  { value: 'price-desc', label: '价格从高到低' },
];

const VERIFIED_OPTIONS = [
  { value: 'any', label: '不限' },
  { value: 'factory', label: '工厂' },
  { value: 'business', label: '诚信通商家' },
  { value: 'super-factory', label: '超级工厂' },
];

const ORDER_STATUS_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'waitbuyerpay', label: '待付款' },
  { value: 'waitsellersend', label: '待发货' },
  { value: 'waitbuyerreceive', label: '待收货' },
  { value: 'success', label: '已完成' },
  { value: 'cancel', label: '已取消' },
];

const COMMANDS = {
  search: {
    group: 'sourcing',
    label: '搜索词采集',
    argv: ['search'],
    positional: [{ name: 'keyword', label: '搜索词', required: true }],
    options: [
      numberOption('max', '--max', '采集数量', 10),
      selectOption('sort', '--sort', '1688排序方式', 'relevance', SORT_OPTIONS),
      numberOption('priceMin', '--price-min', '最低价'),
      numberOption('priceMax', '--price-max', '最高价'),
      textOption('province', '--province', '省份'),
      textOption('city', '--city', '城市'),
      selectOption('verified', '--verified', '供应商认证', 'any', VERIFIED_OPTIONS),
      numberOption('minTurnover', '--min-turnover', '最低成交'),
      boolOption('excludeAds', '--exclude-ads', '过滤广告位'),
      boolOption('deeppro', '--deeppro', '采集商品详情', true),
      numberOption('deepproDelayMin', '--deeppro-delay-min', '详情采集最小间隔/秒', 6),
      numberOption('deepproDelayMax', '--deeppro-delay-max', '详情采集最大间隔/秒', 10),
      selectOption('deepproSearchMode', '--deeppro-search-mode', 'DEEPPRO 搜索模式', 'inline', [
        { value: 'inline', label: 'inline：搜索和详情都绕过 daemon' },
        { value: 'daemon', label: 'daemon：搜索走 daemon，详情仍 pro 深采' },
      ]),
      textOption('deepproOutputDir', '--deeppro-output-dir', 'DEEPPRO 调试输出目录'),
      boolOption('headed', '--headed', '可视化打开浏览器'),
    ],
    resultType: 'products',
  },
  research: {
    group: 'sourcing',
    label: '商品调研',
    argv: ['research'],
    positional: [{ name: 'keywords', label: '关键词（一行一个）', required: true, array: true }],
    options: [
      numberOption('maxPerQuery', '--max-per-query', '每词数量', 20),
      selectOption('sort', '--sort', '排序', 'best-selling', SORT_OPTIONS),
      numberOption('priceMin', '--price-min', '最低价'),
      numberOption('priceMax', '--price-max', '最高价'),
      textOption('province', '--province', '省份'),
      textOption('city', '--city', '城市'),
      selectOption('verified', '--verified', '认证', 'any', VERIFIED_OPTIONS),
      numberOption('minTurnover', '--min-turnover', '最低成交'),
      boolOption('excludeAds', '--exclude-ads', '排除广告'),
      textOption('enrich', '--enrich', '增强', '0'),
      boolOption('jsonl', '--jsonl', 'JSONL'),
      boolOption('csv', '--csv', 'CSV'),
      textOption('output', '--output', '输出文件'),
      boolOption('headed', '--headed', '打开浏览器'),
    ],
    resultType: 'research',
  },
  offer: {
    group: 'sourcing',
    label: '商品详情',
    argv: ['offer'],
    positional: [{ name: 'offerIds', label: 'Offer IDs（一行一个）', required: true, array: true }],
    options: [boolOption('pro', '--pro', 'Pro 深采', true), boolOption('headed', '--headed', '打开浏览器')],
    resultType: 'offers',
  },
  compare: {
    group: 'sourcing',
    label: '商品对比',
    argv: ['compare'],
    positional: [{ name: 'offerIds', label: 'Offer IDs（一行一个）', required: true, array: true }],
    options: [boolOption('csv', '--csv', 'CSV'), textOption('output', '--output', '输出文件'), boolOption('headed', '--headed', '打开浏览器')],
    resultType: 'comparison',
  },
  similar: {
    group: 'sourcing',
    label: '找同款',
    argv: ['similar'],
    positional: [{ name: 'offerId', label: 'Offer ID', required: true }],
    options: [numberOption('max', '--max', '最大数量', 20), boolOption('headed', '--headed', '打开浏览器')],
    resultType: 'products',
  },
  imageSearch: {
    group: 'sourcing',
    label: '以图搜货',
    argv: ['image-search'],
    positional: [{ name: 'imagePath', label: '图片路径或 URL', required: true }],
    options: [numberOption('max', '--max', '最大数量', 20), boolOption('headed', '--headed', '打开浏览器')],
    resultType: 'products',
  },
  supplierInspect: {
    group: 'supplier',
    label: '供应商检查',
    argv: ['supplier', 'inspect'],
    positional: [{ name: 'target', label: 'Offer ID / memberId / URL', required: true }],
    options: [boolOption('headed', '--headed', '打开浏览器')],
    resultType: 'supplierInspect',
  },
  supplierSearch: {
    group: 'supplier',
    label: '供应商搜索',
    argv: ['supplier', 'search'],
    positional: [{ name: 'keywords', label: '关键词（一行一个）', required: true, array: true }],
    options: [
      numberOption('max', '--max', '最大数量', 20),
      boolOption('factoryOnly', '--factory-only', '只看工厂'),
      textOption('province', '--province', '省份'),
      textOption('city', '--city', '城市'),
      numberOption('minYears', '--min-years', '最低年限'),
      numberOption('minRepeatRate', '--min-repeat-rate', '最低复购率'),
      numberOption('minResponseRate', '--min-response-rate', '最低响应率'),
      textOption('enrich', '--enrich', '增强', '0'),
      boolOption('jsonl', '--jsonl', 'JSONL'),
      boolOption('csv', '--csv', 'CSV'),
      textOption('output', '--output', '输出文件'),
      boolOption('headed', '--headed', '打开浏览器'),
    ],
    resultType: 'suppliers',
  },
  supplierResearch: {
    group: 'supplier',
    label: '供应商调研',
    argv: ['supplier', 'research'],
    positional: [{ name: 'keywords', label: '关键词（一行一个）', required: true, array: true }],
    options: [
      numberOption('max', '--max', '最大数量', 20),
      boolOption('factoryOnly', '--factory-only', '只看工厂'),
      textOption('province', '--province', '省份'),
      textOption('city', '--city', '城市'),
      numberOption('minYears', '--min-years', '最低年限'),
      numberOption('minRepeatRate', '--min-repeat-rate', '最低复购率'),
      numberOption('minResponseRate', '--min-response-rate', '最低响应率'),
      textOption('enrich', '--enrich', '增强', 'top:10'),
      boolOption('jsonl', '--jsonl', 'JSONL'),
      boolOption('csv', '--csv', 'CSV'),
      textOption('output', '--output', '输出文件'),
      boolOption('headed', '--headed', '打开浏览器'),
    ],
    resultType: 'suppliers',
  },
  inbox: {
    group: 'communication',
    label: '旺旺会话',
    argv: ['inbox'],
    positional: [],
    options: [numberOption('limit', '--limit', '数量', 20), boolOption('unread', '--unread', '只看未读'), boolOption('headed', '--headed', '打开浏览器')],
    resultType: 'messages',
  },
  sellerInquire: {
    group: 'communication',
    label: '售前询盘',
    argv: ['seller', 'inquire'],
    write: true,
    positional: [
      { name: 'offerId', label: 'Offer ID', required: true },
      { name: 'message', label: '询盘内容', required: true, multiline: true },
    ],
    options: [textOption('to', '--to', '指定 sellerLoginId'), boolOption('headed', '--headed', '打开浏览器')],
    resultType: 'generic',
  },
  sellerMessages: {
    group: 'communication',
    label: '读取消息',
    argv: ['seller', 'messages'],
    positional: [{ name: 'target', label: '订单ID / seller / 可留空' }],
    options: [
      textOption('offer', '--offer', '按 Offer ID'),
      numberOption('limit', '--limit', '数量', 20),
      textOption('since', '--since', '起始时间 ISO'),
      boolOption('watch', '--watch', '持续监听'),
      numberOption('interval', '--interval', '监听间隔', 30),
      boolOption('headed', '--headed', '打开浏览器'),
    ],
    resultType: 'messages',
  },
  sellerChat: {
    group: 'communication',
    label: '卖家聊天',
    argv: ['seller', 'chat'],
    write: true,
    positional: [
      { name: 'target', label: '订单ID / seller', required: true },
      { name: 'message', label: '消息内容', required: true, multiline: true },
    ],
    options: [boolOption('noCard', '--no-card', '不附订单卡'), boolOption('prefix', '--prefix', '追加订单前缀'), boolOption('headed', '--headed', '打开浏览器')],
    resultType: 'generic',
  },
  cartList: {
    group: 'orders',
    label: '购物车列表',
    argv: ['cart', 'list'],
    positional: [],
    options: [boolOption('headed', '--headed', '打开浏览器')],
    resultType: 'table',
  },
  cartAdd: {
    group: 'orders',
    label: '加入购物车',
    argv: ['cart', 'add'],
    write: true,
    positional: [{ name: 'offerId', label: 'Offer ID', required: true }],
    options: [textOption('sku', '--sku', 'SKU ID', '', true), numberOption('qty', '--qty', '数量', 1), boolOption('headed', '--headed', '打开浏览器')],
    resultType: 'generic',
  },
  cartRemove: {
    group: 'orders',
    label: '移除购物车',
    argv: ['cart', 'remove'],
    write: true,
    positional: [{ name: 'cartId', label: 'Cart ID', required: true }],
    options: [boolOption('headed', '--headed', '打开浏览器')],
    resultType: 'generic',
  },
  checkoutPrepare: {
    group: 'orders',
    label: '下单预览',
    argv: ['checkout', 'prepare'],
    positional: [{ name: 'cartIds', label: 'Cart IDs（一行一个）', required: true, array: true }],
    options: [boolOption('headed', '--headed', '打开浏览器')],
    resultType: 'checkoutPrepare',
  },
  checkoutConfirm: {
    group: 'orders',
    label: '确认下单',
    argv: ['checkout', 'confirm'],
    write: true,
    checkoutConfirm: true,
    positional: [{ name: 'cartIds', label: 'Cart IDs（一行一个）', required: true, array: true }],
    options: [boolOption('agent', '--agent', 'Agent 模式', true), boolOption('yes', '--yes', '跳过提示')],
    resultType: 'generic',
  },
  orderList: {
    group: 'orders',
    label: '订单列表',
    argv: ['order', 'list'],
    positional: [],
    options: [
      selectOption('status', '--status', '状态', 'all', ORDER_STATUS_OPTIONS),
      numberOption('page', '--page', '页码', 1),
      numberOption('pageSize', '--page-size', '每页', 10),
      boolOption('headed', '--headed', '打开浏览器'),
    ],
    resultType: 'table',
  },
  orderGet: {
    group: 'orders',
    label: '订单详情',
    argv: ['order', 'get'],
    positional: [{ name: 'orderId', label: '订单 ID', required: true }],
    options: [numberOption('maxScanPages', '--max-scan-pages', '扫描页数', 5), textOption('status', '--status', '状态'), boolOption('headed', '--headed', '打开浏览器')],
    resultType: 'generic',
  },
  orderLogistics: {
    group: 'orders',
    label: '物流查询',
    argv: ['order', 'logistics'],
    positional: [{ name: 'orderId', label: '订单 ID', required: true }],
    options: [numberOption('maxScanPages', '--max-scan-pages', '扫描页数', 5), textOption('status', '--status', '状态'), boolOption('headed', '--headed', '打开浏览器')],
    resultType: 'generic',
  },
  shipped: {
    group: 'orders',
    label: '发货详情',
    argv: ['shipped'],
    positional: [{ name: 'orderId', label: '订单 ID', required: true }],
    options: [boolOption('headed', '--headed', '打开浏览器')],
    resultType: 'generic',
  },
  stuck: {
    group: 'orders',
    label: '未发货订单',
    argv: ['stuck'],
    positional: [],
    options: [numberOption('days', '--days', '天数', 3), numberOption('limit', '--limit', '数量', 50), boolOption('headed', '--headed', '打开浏览器')],
    resultType: 'table',
  },
  fakeShipped: {
    group: 'orders',
    label: '疑似虚假发货',
    argv: ['fake-shipped'],
    positional: [],
    options: [numberOption('days', '--days', '天数', 1), numberOption('maxPages', '--max-pages', '最大页', 2), numberOption('maxCheck', '--max-check', '检查数', 20), numberOption('limit', '--limit', '数量', 50), boolOption('debug', '--debug', '调试'), boolOption('headed', '--headed', '打开浏览器')],
    resultType: 'table',
  },
  sellerHistory: {
    group: 'orders',
    label: '卖家订单历史',
    argv: ['seller-history'],
    positional: [{ name: 'seller', label: '卖家名 / loginId', required: true }],
    options: [numberOption('maxPages', '--max-pages', '扫描页数', 10), boolOption('headed', '--headed', '打开浏览器')],
    resultType: 'table',
  },
  login: {
    group: 'account',
    label: '登录',
    argv: ['login'],
    write: true,
    positional: [],
    options: [boolOption('force', '--force', '强制重新登录'), numberOption('timeout', '--timeout', '超时秒数', 300), boolOption('headed', '--headed', '浏览器登录'), boolOption('noDaemon', '--no-daemon', '不启动 daemon')],
    resultType: 'generic',
  },
  logout: {
    group: 'account',
    label: '退出登录',
    argv: ['logout'],
    write: true,
    positional: [],
    options: [boolOption('yes', '--yes', '确认退出', true)],
    resultType: 'generic',
  },
  whoami: {
    group: 'account',
    label: '当前账号',
    argv: ['whoami'],
    positional: [],
    options: [boolOption('verify', '--verify', '在线验证')],
    resultType: 'account',
  },
  doctor: {
    group: 'account',
    label: '环境检查',
    argv: ['doctor'],
    positional: [],
    options: [boolOption('noLaunch', '--no-launch', '不启动浏览器'), boolOption('live', '--live', 'Live 检查')],
    resultType: 'diagnostics',
  },
  daemonStart: {
    group: 'account',
    label: '启动 Daemon',
    argv: ['daemon', 'start'],
    positional: [],
    options: [],
    resultType: 'daemon',
  },
  daemonStop: {
    group: 'account',
    label: '停止 Daemon',
    argv: ['daemon', 'stop'],
    write: true,
    positional: [],
    options: [],
    resultType: 'daemon',
  },
  daemonStatus: {
    group: 'account',
    label: 'Daemon 状态',
    argv: ['daemon', 'status'],
    positional: [],
    options: [],
    resultType: 'daemon',
  },
  daemonReload: {
    group: 'account',
    label: '重载 Daemon',
    argv: ['daemon', 'reload'],
    write: true,
    positional: [],
    options: [],
    resultType: 'daemon',
  },
  profileList: {
    group: 'account',
    label: 'Profile 列表',
    argv: ['profile', 'list'],
    addProfile: false,
    positional: [],
    options: [],
    resultType: 'profiles',
  },
  profileStatus: {
    group: 'account',
    label: 'Profile 状态',
    argv: ['profile', 'status'],
    addProfile: false,
    positional: [{ name: 'name', label: 'Profile', default: 'default' }],
    options: [],
    resultType: 'profiles',
  },
  debugList: {
    group: 'account',
    label: 'Debug 列表',
    argv: ['debug', 'list'],
    addProfile: false,
    positional: [],
    options: [numberOption('limit', '--limit', '数量', 20), boolOption('failed', '--failed', '只看失败')],
    resultType: 'debug',
  },
  debugLast: {
    group: 'account',
    label: '最近 Debug',
    argv: ['debug', 'last'],
    addProfile: false,
    positional: [],
    options: [boolOption('failed', '--failed', '只看失败')],
    resultType: 'debug',
  },
  debugShow: {
    group: 'account',
    label: 'Debug 详情',
    argv: ['debug', 'show'],
    addProfile: false,
    positional: [{ name: 'requestId', label: 'Request ID', required: true }],
    options: [],
    resultType: 'debug',
  },
  feedback: {
    group: 'account',
    label: '反馈',
    argv: ['feedback'],
    write: true,
    positional: [{ name: 'message', label: '反馈内容', required: true, multiline: true }],
    options: [boolOption('bug', '--bug', 'Bug'), boolOption('submit', '--submit', '直接提交'), boolOption('noOpen', '--no-open', '不打开浏览器')],
    resultType: 'generic',
  },
};

const GROUPS = [
  { id: 'sourcing', label: '采集/找货' },
  { id: 'supplier', label: '供应商' },
  { id: 'communication', label: '沟通' },
  { id: 'orders', label: '购物车/订单' },
  { id: 'account', label: '账号/诊断' },
];

const activeRuns = new Map();

function textOption(name, flag, label, defaultValue = '', required = false) {
  return { name, flag, label, type: 'text', default: defaultValue, required };
}

function numberOption(name, flag, label, defaultValue = '') {
  return { name, flag, label, type: 'number', default: defaultValue };
}

function boolOption(name, flag, label, defaultValue = false) {
  return { name, flag, label, type: 'boolean', default: defaultValue };
}

function selectOption(name, flag, label, defaultValue, values) {
  return {
    name, flag, label, type: 'select', default: defaultValue,
    values: values.map((item) => (typeof item === 'string' ? { value: item, label: item } : item)),
  };
}

function publicRegistry() {
  const commands = {};
  for (const [id, command] of Object.entries(COMMANDS)) {
    commands[id] = {
      id,
      group: command.group,
      label: command.label,
      positional: command.positional,
      options: command.options,
      write: !!command.write,
      checkoutConfirm: !!command.checkoutConfirm,
      resultType: command.resultType,
      argvPreview: command.argv.join(' '),
    };
  }
  return { groups: GROUPS, commands };
}

function buildArgv(commandId, input = {}) {
  const command = COMMANDS[commandId];
  if (!command) throw new Error(`Unknown command: ${commandId}`);

  const args = [...command.argv];
  const values = input.args || {};
  const options = input.options || {};
  const profile = cleanScalar(input.profile || 'default');

  for (const field of command.positional) {
    const raw = values[field.name] ?? field.default ?? '';
    const items = field.array ? splitList(raw) : [cleanScalar(raw)];
    const filtered = items.filter(Boolean);
    if (field.required && filtered.length === 0) {
      throw new Error(`${field.label || field.name} 不能为空`);
    }
    args.push(...filtered);
  }

  for (const option of command.options) {
    const value = options[option.name];
    if (option.required && !cleanScalar(value)) {
      throw new Error(`${option.label || option.name} 不能为空`);
    }
    if (option.type === 'boolean') {
      if (value === true) args.push(option.flag);
      continue;
    }
    const cleaned = cleanScalar(value);
    if (option.type === 'select' && cleaned) {
      const allowed = (option.values || []).map(optionValue);
      if (!allowed.includes(cleaned)) {
        throw new Error(`${option.label || option.name} 参数不在允许范围内。`);
      }
    }
    if (cleaned !== '') args.push(option.flag, cleaned);
  }

  if (profile && command.addProfile !== false) args.push('--profile', profile);
  if (command.addJson !== false && !args.includes('--json') && !args.includes('--csv') && !args.includes('--jsonl')) {
    args.push('--json');
  }
  if (command.addPretty !== false && args.includes('--json') && !args.includes('--pretty')) {
    args.push('--pretty');
  }
  return args;
}

function cleanScalar(value) {
  return String(value ?? '').trim();
}

function splitList(value) {
  return String(value ?? '')
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function mapExitStatus(exitCode) {
  switch (exitCode) {
    case 0: return 'success';
    case 3: return 'not_logged_in';
    case 4: return 'risk_control';
    case 5: return 'profile_busy';
    case 9: return 'network_error';
    case 130: return 'cancelled';
    default: return 'failed';
  }
}

/**
 * Normalize CLI exit status to a canonical account status string.
 */
function normalizeAccountStatus(status) {
  switch (status) {
    case 'success': return 'logged_in';
    case 'not_logged_in': return 'not_logged_in';
    case 'risk_control': return 'risk_control';
    case 'profile_busy': return 'busy';
    case 'network_error': return 'network_error';
    case 'failed':
    case 'timeout':
    case 'cancelled': return 'error';
    default: return status || 'unknown';
  }
}

function optionValue(item) {
  return typeof item === 'object' && item !== null ? cleanScalar(item.value) : cleanScalar(item);
}

function parseOutput(stdout, stderr) {
  const text = String(stdout || '').trim();
  const errText = String(stderr || '').trim();
  const stderrJson = parseJsonLines(errText).filter((item) => item && !item._notice);
  if (!text) return { kind: stderrJson.length ? 'jsonl' : 'empty', data: stderrJson.length ? stderrJson : null };

  try {
    return { kind: 'json', data: JSON.parse(text) };
  } catch {
    const jsonLines = parseJsonLines(text);
    if (jsonLines.length) return { kind: 'jsonl', data: jsonLines };
    const lastJson = parseLastJson(text);
    if (lastJson !== null) return { kind: 'json', data: lastJson };
    return { kind: 'text', data: text };
  }
}

function parseJsonLines(text) {
  const values = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !/^[{[]/.test(trimmed)) continue;
    try { values.push(JSON.parse(trimmed)); } catch { /* skip */ }
  }
  return values;
}

function parseLastJson(text) {
  for (const line of String(text || '').split(/\r?\n/).reverse()) {
    const trimmed = line.trim();
    if (!/^[{[]/.test(trimmed)) continue;
    try { return JSON.parse(trimmed); } catch { /* skip */ }
  }
  return null;
}

function resolveCliJs(runtime) {
  // Explicit cliPath takes priority (set by cli-resolver).
  if (runtime.cliPath) {
    if (!fs.existsSync(runtime.cliPath)) {
      const error = new Error(`CLI 不存在：${runtime.cliPath}\n请重新安装客户端或联系管理员。`);
      error.code = 'CLI_MISSING';
      throw error;
    }
    return runtime.cliPath;
  }
  // Fallback: dev-mode path from rootDir.
  const devPath = path.join(runtime.rootDir, 'dist', 'cli.js');
  if (fs.existsSync(devPath)) return devPath;
  const error = new Error('dist/cli.js 不存在，请先运行 npm run build。');
  error.code = 'CLI_NOT_BUILT';
  throw error;
}

/**
 * Execute a CLI command via child_process.
 *
 * @param {object} runtime — { rootDir, cliPath }
 * @param {string} historyDir
 * @param {object} payload
 */
async function runCommand(runtime, historyDir, payload = {}) {
  const command = COMMANDS[payload.commandId];
  if (!command) throw new Error(`Unknown command: ${payload.commandId}`);
  if (command.write && payload.confirmed !== true) {
    throw new Error('该命令会修改账号状态或发送消息，必须先确认。');
  }
  if (command.checkoutConfirm && !payload.prepareRunId) {
    throw new Error('确认下单前必须先运行 checkout prepare 并展示预览结果。');
  }

  const cliPath = resolveCliJs(runtime);
  const argv = buildArgv(payload.commandId, payload);
  if (payload.commandId === 'offer') {
    console.info('[cli-bridge] offer payload', {
      args: payload.args,
      options: payload.options,
      profile: payload.profile,
      argv,
    });
  }
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const startedAt = new Date().toISOString();
  const childArgs = [cliPath, ...argv];
  const timeoutMs = Number(payload.timeoutMs || 0);

  return await new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(process.execPath, childArgs, {
      cwd: runtime.rootDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        BB1688_JSON: '1',
      },
      windowsHide: false,
    });
    activeRuns.set(runId, child);
    const timeout = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          stderr += `\nCommand timed out after ${timeoutMs}ms.`;
          child.kill();
        }, timeoutMs)
      : null;

    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => { stderr += `\n${error.stack || error.message}`; });
    child.on('close', async (code) => {
      if (timeout) clearTimeout(timeout);
      activeRuns.delete(runId);
      const exitCode = typeof code === 'number' ? code : 1;
      const parsed = parseOutput(stdout, stderr);
      const endedAt = new Date().toISOString();
      const status = timedOut ? 'timeout' : mapExitStatus(exitCode);
      const record = {
        runId,
        commandId: payload.commandId,
        resultType: command.resultType,
        argv,
        profile: cleanScalar(payload.profile || 'default'),
        startedAt,
        endedAt,
        exitCode: timedOut ? 124 : exitCode,
        status,
        stdoutJson: parsed.data,
        outputKind: parsed.kind,
        stderrText: stderr.trim(),
        error: exitCode === 0 ? null : buildError(status, stderr, parsed.data),
      };
      if (payload.saveHistory !== false) {
        await writeHistory(historyDir, record);
      }
      resolve(record);
    });
  });
}

function buildError(status, stderr, parsedData) {
  const message =
    parsedData && typeof parsedData === 'object' && !Array.isArray(parsedData)
      ? parsedData.message || parsedData.error || ''
      : '';
  const fallback = {
    not_logged_in: '未登录或登录已过期，请运行 login。',
    risk_control: '触发风控，请使用 headed 手动完成验证。',
    profile_busy: '当前 profile 正在运行其他命令。',
    network_error: '网络错误。',
    cancelled: '任务已取消。',
    timeout: '命令执行超时。',
    failed: '命令执行失败。',
  };
  return { status, message: message || fallback[status] || fallback.failed, stderr: String(stderr || '').trim() };
}

async function writeHistory(historyDir, record) {
  await fs.promises.mkdir(historyDir, { recursive: true });
  const day = record.startedAt.slice(0, 10);
  const file = path.join(historyDir, `${day}.jsonl`);
  await fs.promises.appendFile(file, JSON.stringify(record) + '\n', 'utf8');
}

async function readHistory(historyDir, query = {}) {
  if (!fs.existsSync(historyDir)) return [];
  const limit = Number(query.limit || 50);
  const files = (await fs.promises.readdir(historyDir))
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
    .reverse();
  const records = [];
  for (const file of files) {
    const text = await fs.promises.readFile(path.join(historyDir, file), 'utf8');
    for (const line of text.trim().split(/\r?\n/).reverse()) {
      if (!line) continue;
      try {
        const item = JSON.parse(line);
        if (!query.type || item.resultType === query.type || item.commandId === query.type) {
          records.push(item);
        }
      } catch { /* ignore */ }
      if (records.length >= limit) return records;
    }
  }
  return records;
}

function cancelCommand(runId) {
  const child = activeRuns.get(runId);
  if (!child) return { ok: false, cancelled: false };
  child.kill();
  activeRuns.delete(runId);
  return { ok: true, cancelled: true };
}

module.exports = {
  COMMANDS,
  GROUPS,
  publicRegistry,
  buildArgv,
  parseOutput,
  mapExitStatus,
  normalizeAccountStatus,
  runCommand,
  readHistory,
  cancelCommand,
};
