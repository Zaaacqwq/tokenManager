export type Locale = 'en' | 'zh';

const translations = {
  en: {
    // Header
    'app.title': 'Token Manager',
    'app.logout': 'Logout',
    'app.sync': 'Sync',

    // Toolbar
    'filter.provider': 'Provider',
    'filter.model': 'Model',
    'filter.all': 'All',
    'filter.label': 'Filter:',
    'filter.clear': 'Clear all',

    // Time range
    'time.24h': '24h',
    'time.7d': '7 Days',
    'time.30d': '30 Days',

    // Request stats
    'section.requests': 'Request Stats',
    'stat.totalRequests': 'Total Requests',
    'stat.errors': 'Errors',
    'stat.successRate': 'Success Rate',

    // Token stats
    'section.tokens': 'Token Stats',
    'stat.tokenIO': 'TOKEN Input / Output',
    'stat.cacheIO': 'Cache Input / Output',
    'stat.outputTps': 'Output TPS',
    'stat.outputTps.sub': 'tokens per request',
    'stat.totalCost': 'Total Cost',
    'stat.avgCost': 'Avg Cost / Request',

    // Charts
    'section.trend': 'Consumption Trend',
    'chart.token': 'Token Count',
    'chart.token.hourly': 'Token Count (Hourly)',
    'chart.cost': 'Cost Trend',
    'chart.cost.hourly': 'Cost Trend (Hourly)',
    'chart.noData': 'No data',

    // Chart legend
    'legend.input': 'Input',
    'legend.output': 'Output',
    'legend.cacheInput': 'Cache Input',
    'legend.cacheOutput': 'Cache Output',
    'legend.requests': 'Requests',
    'legend.cost': 'Cost',

    // Provider & Model
    'section.provider': 'Provider',
    'section.model': 'Model',
    'table.model': 'Model',
    'table.requests': 'Requests',
    'table.input': 'Input',
    'table.output': 'Output',
    'table.cost': 'Cost',
    'provider.requests': 'requests',
    'provider.in': 'In',
    'provider.out': 'Out',
  },
  zh: {
    'app.title': 'Token Manager',
    'app.logout': '退出',
    'app.sync': '同步',

    'filter.provider': 'Provider',
    'filter.model': 'Model',
    'filter.all': '全部',
    'filter.label': '筛选:',
    'filter.clear': '清空选择',

    'time.24h': '24 小时',
    'time.7d': '7 天',
    'time.30d': '30 天',

    'section.requests': '请求数据',
    'stat.totalRequests': '请求总数',
    'stat.errors': '错误数',
    'stat.successRate': '成功率',

    'section.tokens': 'Token 统计',
    'stat.tokenIO': 'TOKEN 输入/输出',
    'stat.cacheIO': '输入缓存/输出缓存',
    'stat.outputTps': '输出 TPS',
    'stat.outputTps.sub': 'tokens per request',
    'stat.totalCost': '总费用',
    'stat.avgCost': '平均费用/请求',

    'section.trend': '消耗趋势',
    'chart.token': 'Token 数',
    'chart.token.hourly': 'Token 数 (每小时)',
    'chart.cost': '费用趋势',
    'chart.cost.hourly': '费用趋势 (每小时)',
    'chart.noData': '暂无数据',

    'legend.input': '输入',
    'legend.output': '输出',
    'legend.cacheInput': '缓存输入',
    'legend.cacheOutput': '缓存输出',
    'legend.requests': '请求数',
    'legend.cost': '费用',

    'section.provider': 'Provider',
    'section.model': 'Model',
    'table.model': '模型',
    'table.requests': '请求',
    'table.input': '输入',
    'table.output': '输出',
    'table.cost': '费用',
    'provider.requests': '请求',
    'provider.in': '入',
    'provider.out': '出',
  },
} as const;

type TranslationKey = keyof typeof translations.en;

export function t(locale: Locale, key: TranslationKey): string {
  return translations[locale][key] || key;
}

export function getStoredLocale(): Locale {
  const stored = localStorage.getItem('locale');
  if (stored === 'zh' || stored === 'en') return stored;
  return 'en';
}

export function setStoredLocale(locale: Locale): void {
  localStorage.setItem('locale', locale);
}
