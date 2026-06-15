import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
})

api.interceptors.response.use(
  response => response,
  error => {
    const detail = error?.response?.data?.detail
    if (detail) {
      error.message = detail
    } else if (error?.response?.status === 404) {
      const method = (error?.config?.method || 'request').toUpperCase()
      const url = `${error?.config?.baseURL || ''}${error?.config?.url || ''}`
      error.message = `${method} ${url} 返回 404，请检查访问路径、反向代理或 API Base URL 配置`
    }
    return Promise.reject(error)
  },
)

const CACHE_MISS = Symbol('cache-miss')
const responseCache = new Map<string, { expires: number; value: any }>()
const requestCache = new Map<string, Promise<any>>()

const CACHE_VERSION = 'market-cache-v2'
const cacheKey = (name: string, payload: any) => `${CACHE_VERSION}:${name}:${JSON.stringify(payload)}`

const cloneValue = <T,>(value: T): T => {
  if (Array.isArray(value)) return value.map(item => ({ ...item })) as T
  if (value && typeof value === 'object') return { ...(value as any) }
  return value
}

const getCached = <T,>(key: string): T | typeof CACHE_MISS => {
  const item = responseCache.get(key)
  if (!item) return CACHE_MISS
  if (Date.now() > item.expires) {
    responseCache.delete(key)
    return CACHE_MISS
  }
  return cloneValue(item.value)
}

const setCached = <T,>(key: string, value: T, ttlMs: number): T => {
  responseCache.set(key, { expires: Date.now() + ttlMs, value: cloneValue(value) })
  if (responseCache.size > 600) {
    Array.from(responseCache.keys()).slice(0, 100).forEach(k => responseCache.delete(k))
  }
  return cloneValue(value)
}

const postCached = <T,>(url: string, payload: any, ttlMs: number): Promise<T> => {
  const key = cacheKey(url, payload)
  const cached = getCached<T>(key)
  if (cached !== CACHE_MISS) return Promise.resolve(cached)

  const pending = requestCache.get(key)
  if (pending) return pending.then(cloneValue)

  const request = api.post<T>(url, payload)
    .then(r => setCached(key, r.data, ttlMs))
    .finally(() => requestCache.delete(key))
  requestCache.set(key, request)
  return request.then(cloneValue)
}

export interface Asset {
  id: number
  asset_type: string
  market: string
  platform: string
  code: string
  name: string
  shares: number
  buy_price: number
  buy_date: string
  current_price: number | null
  price_updated_at: string
  note: string
  source: string
  created_at: string
  updated_at: string
}

export type AssetSource = 'manual' | 'ai_advice'
export type AssetScope = 'all' | AssetSource

export interface DashboardData {
  total_market_value: number
  total_cost: number
  total_pnl: number
  total_pnl_percent: number
  realized_pnl: number
  assets_count: number
  analysis_summary: string
}

export interface AnalysisRecord {
  id: number
  summary: string
  detail: string
  total_market_value: number
  total_cost: number
  total_pnl: number
  total_pnl_percent: number
  realized_pnl: number
  created_at: string
}

export interface AssetTransaction {
  id: number
  asset_id: number
  trade_type: 'buy' | 'sell'
  trade_date: string
  shares: number
  price: number
  fee: number
  note: string
  created_at: string
}

export interface AssetAnalysisSnippet {
  id: number
  summary: string
  detail: string
  created_at: string
}

export interface AssetDetail {
  asset: Asset
  history: MarketHistoryItem[]
  fundamentals: MarketFundamentals
  transactions: AssetTransaction[]
  latest_analysis: AssetAnalysisSnippet | null
}

export interface SettingsResponse {
  key: string
  value: string
}

export interface Target {
  id: number
  code: string
  name: string
  market: string
  asset_type: string
  source: string
  reason: string
  priority: string
  risk_level: string
  expected_return: string
  status: string
  note: string
  ai_analysis: string
  last_analyzed_at: string
  created_at: string
  updated_at: string
}

export interface AgentAnalysisResponse {
  summary: string
  report: any
}

export interface InvestmentBudgetConfig {
  id: string
  platform: string
  amount: number
  currency: 'CNY' | 'HKD' | 'USD'
  asset_types: string[]
  markets: string[]
}

export interface InvestmentAdviceItem {
  id: string
  budget_id: string
  platform: string
  currency: string
  currency_label: string
  market: string
  market_label: string
  asset_type: string
  asset_type_label: string
  code: string
  name: string
  trade_type: 'BUY' | 'SELL'
  trade_type_label: string
  shares: number
  price: number
  estimated_amount: number
  reason: string
  evidence?: string[]
  confidence_score: number
  risk_note: string
  source: string
  asset_source: AssetSource
  asset_source_label: string
  asset_id: number | null
}

export interface IPOInvestmentAdviceItem {
  id: string
  ipo_id: string
  market: IPOMarket | string
  market_label: string
  code: string
  name: string
  decision: 'SUBSCRIBE' | 'WATCH' | 'AVOID'
  decision_label: string
  suggested_shares: number
  suggested_price: number
  estimated_amount: number
  currency: string
  currency_label: string
  platform: string
  win_probability: number
  expected_profit_pct: number
  expected_profit_range: string
  confidence_score: number
  reason: string
  sell_timing: string
  take_profit: string
  stop_loss: string
  evidence?: string[]
  risk_note: string
  key_reasons?: string[]
  comment_insights?: string[]
  risk_flags?: string[]
  apply_date?: string
  listing_date?: string
  issue_price?: number | null
  price_range?: string
  lot_size?: number
  source_label?: string
  source_url?: string
  analysis_snapshot?: any
  generated_at?: string
}

export interface InvestmentAdviceResponse {
  summary: string
  advice: InvestmentAdviceItem[]
  ipo_advice: IPOInvestmentAdviceItem[]
  budget_status: any[]
  market_context?: {
    regime?: string
    observations?: string[]
  }
  market_snapshot?: any
  decision_audit?: Array<{
    code?: string
    decision?: string
    key_facts?: string[]
    why?: string
  }>
  asset_scope?: AssetScope
  asset_scope_label?: string
}

export type IPOMarket = 'A' | 'HK' | 'US'

export interface IPOItem {
  id: string
  market: IPOMarket
  code: string
  apply_code: string
  name: string
  company_name: string
  exchange: string
  sector: string
  business: string
  apply_date: string
  listing_date: string
  pricing_date: string
  issue_price: number | null
  price_range: string
  currency: 'CNY' | 'HKD' | 'USD' | string
  issue_pe: number | null
  industry_pe: number | null
  issue_size: number | null
  fundraising_amount: number | null
  online_apply_limit: number | null
  estimated_required_cash: number | null
  lot_size: number | null
  subscription_multiple: number | null
  winning_rate: number | null
  sponsor: string
  raw_status: string
  status: string
  source: string
  source_label: string
  source_url: string
  updated_at: string
  comments: Array<{
    source: string
    author: string
    content: string
    sentiment: string
  }>
}

export interface IPOSourceStatus {
  provider: string
  label: string
  ok: boolean
  count: number
  note?: string
  error?: string
}

export interface IPOListResponse {
  items: IPOItem[]
  source_status: Record<string, IPOSourceStatus>
  providers: Record<string, string>
  generated_at: string
}

export interface IPOAnalysisItem {
  ipo_id: string
  code: string
  name: string
  market: IPOMarket
  market_label: string
  recommendation: 'SUBSCRIBE' | 'WATCH' | 'AVOID'
  recommendation_label: string
  win_probability: number
  expected_profit_pct: number
  expected_profit_range: string
  confidence: number
  action: string
  key_reasons: string[]
  comment_insights: string[]
  risk_flags: string[]
  data_quality: string
}

export interface IPOAnalysisResponse {
  summary: string
  analyses: IPOAnalysisItem[]
  market_view: {
    regime?: string
    notes?: string[]
    [key: string]: any
  }
  data_quality: Record<string, any>
  source_status: Record<string, IPOSourceStatus>
  generated_at: string
}

export interface IPOProviders {
  labels: Record<string, string>
  options: Record<string, string[]>
  defaults: Record<string, string>
}

export interface IPOTradeCreate {
  ipo_id?: string
  code: string
  name?: string
  market: string
  platform?: string
  currency?: string
  trade_type: 'SUBSCRIBE' | 'SELL'
  shares: number
  price: number
  fee?: number
  trade_date?: string
  analysis_snapshot?: any
  advice_snapshot?: any
  note?: string
}

export interface IPOTradeRecord extends IPOTradeCreate {
  id: number
  realized_pnl: number
  created_at: string
  analysis_snapshot: any
  advice_snapshot: any
}

export interface IPORealizedPnl {
  realized_pnl: number
  total_sell_amount: number
  total_cost_basis: number
  total_fee: number
  closed_trades: number
  open_positions: Array<{
    market: string
    code: string
    platform: string
    currency: string
    shares: number
    cost_basis: number
    avg_cost: number
  }>
}

export interface AIChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AIChatResponse {
  answer: string
  model: string
  context_meta: {
    generated_at?: string
    asset_count?: number
    target_count?: number
    budget_count?: number
    installed_skill_count?: number
    live_quotes?: boolean
    [key: string]: any
  }
}

export interface AIChatContextResponse {
  summary: {
    asset_count?: number
    target_count?: number
    budget_count?: number
    installed_skill_count?: number
    portfolio?: any
    visual_data?: any
    [key: string]: any
  }
  sample_questions: string[]
}

export const dashboardApi = {
  get: () => api.get<DashboardData>('/dashboard').then(r => r.data),
  holdingsOverview: (limit = 5) =>
    api.get<Asset[]>('/dashboard/holdings-overview', { params: { limit } }).then(r => r.data),
  refreshHoldingsOverviewPrices: (limit = 5) =>
    api.post<Asset[]>('/dashboard/holdings-overview/refresh-prices', null, { params: { limit } }).then(r => r.data),
}

export const assetsApi = {
  list: (params?: { asset_type?: string; market?: string; source?: AssetScope }) =>
    api.get<Asset[]>('/assets', { params }).then(r => r.data),
  create: (data: Partial<Asset>) =>
    api.post<Asset>('/assets', data).then(r => r.data),
  update: (id: number, data: Partial<Asset>) =>
    api.put<Asset>(`/assets/${id}`, data).then(r => r.data),
  delete: (id: number) =>
    api.delete(`/assets/${id}`).then(r => r.data),
  batchDelete: (ids: number[]) =>
    api.post('/assets/batch-delete', ids).then(r => r.data),
  refreshPrices: () =>
    api.post<Asset[]>('/assets/refresh-prices').then(r => r.data),
  detail: (id: number) =>
    api.get<AssetDetail>(`/assets/${id}/detail`).then(r => r.data),
  createTransaction: (id: number, data: Partial<AssetTransaction>) =>
    api.post<AssetTransaction>(`/assets/${id}/transactions`, data).then(r => r.data),
}

export const analysisApi = {
  run: (includeTargets?: boolean) => api.post<AnalysisRecord>(`/analysis/run${includeTargets ? '?include_targets=true' : ''}`).then(r => r.data),
  latest: () => api.get<AnalysisRecord>('/analysis/latest').then(r => r.data),
  history: () => api.get<AnalysisRecord[]>('/analysis/history').then(r => r.data),
  agentRun: (req?: { asset_ids?: number[]; target_ids?: number[]; goal?: string; save_portfolio_record?: boolean }) =>
    api.post<AgentAnalysisResponse>('/analysis/agent-run', req || { goal: '全面分析投资组合' }).then(r => r.data),
}

export const investmentAdviceApi = {
  latest: () => api.get<InvestmentAdviceResponse>("/investment-advice/latest").then(r => r.data),
  run: (assetScope: AssetScope = 'all') =>
    api.post<InvestmentAdviceResponse>('/investment-advice/run', null, { params: { asset_scope: assetScope } }).then(r => r.data),
  accept: (advice: InvestmentAdviceItem) =>
    api.post('/investment-advice/accept', { advice }).then(r => r.data),
  check: () => api.get<{configured: boolean; budget_count: number}>('/investment-advice/check').then(r => r.data),
  resetBudget: () =>
    api.post<{message: string; reset_count: number}>('/investment-advice/reset-budget').then(r => r.data),
  budgetStatus: () =>
    api.get<any[]>('/investment-advice/budget-status').then(r => r.data),
}

export const ipoApi = {
  list: (params: { markets?: IPOMarket[]; limit?: number; force_refresh?: boolean } = {}) =>
    api.post<IPOListResponse>('/ipo/list', {
      markets: params.markets || ['A', 'HK', 'US'],
      limit: params.limit || 30,
      force_refresh: Boolean(params.force_refresh),
    }).then(r => r.data),
  analyze: (params: { markets?: IPOMarket[]; ipo_ids?: string[]; items?: IPOItem[]; limit?: number; force_refresh?: boolean; source_status?: Record<string, IPOSourceStatus> } = {}) =>
    api.post<IPOAnalysisResponse>('/ipo/analyze', {
      markets: params.markets || ['A', 'HK', 'US'],
      ipo_ids: params.ipo_ids || [],
      items: params.items || [],
      limit: params.limit || 30,
      force_refresh: Boolean(params.force_refresh),
      source_status: params.source_status || {},
    }).then(r => r.data),
  latestAnalysis: () =>
    api.get<IPOAnalysisResponse>('/ipo/latest-analysis').then(r => r.data),
  providers: () =>
    api.get<IPOProviders>('/ipo/providers').then(r => r.data),
  trades: (params?: { market?: string; code?: string; platform?: string }) =>
    api.get<IPOTradeRecord[]>('/ipo/trades', { params }).then(r => r.data),
  createTrade: (data: IPOTradeCreate) =>
    api.post<IPOTradeRecord>('/ipo/trades', data).then(r => r.data),
  realizedPnl: () =>
    api.get<IPORealizedPnl>('/ipo/realized-pnl').then(r => r.data),
}

export const chatApi = {
  context: (includeLiveQuotes = true) =>
    api.get<AIChatContextResponse>('/chat/context', { params: { include_live_quotes: includeLiveQuotes } }).then(r => r.data),
  ask: (message: string, history: AIChatMessage[] = [], includeLiveQuotes = true) =>
    api.post<AIChatResponse>('/chat', { message, history, include_live_quotes: includeLiveQuotes }).then(r => r.data),
}

export const settingsApi = {
  get: (key: string) =>
    api.get<SettingsResponse>(`/settings/${key}`).then(r => r.data),
  update: (key: string, value: string) =>
    api.put<SettingsResponse>(`/settings/${key}`, { key, value }).then(r => r.data),
}

export const schedulerApi = {
  config: () => api.get<any>('/scheduler/config').then(r => r.data),
}

export interface ParallelConfig {
  enabled: boolean
  max_workers: number
  batch_size: number
  ai_timeout_seconds: number
  parallel_skills: boolean
  parallel_assets: boolean
  parallel_dashboard_steps: boolean
}

export const parallelApi = {
  getConfig: () => api.get<ParallelConfig>('/settings/parallel-config').then(r => r.data),
  saveConfig: (config: Partial<ParallelConfig>) =>
    api.post<{ message: string; config: ParallelConfig }>('/settings/parallel-config', config).then(r => r.data),
}

export const settingsApiFull = {
  checkModels: (apiKey: string, baseUrl: string) =>
    api.post<{ models: string[] }>('/settings/check-models', { api_key: apiKey, base_url: baseUrl }).then(r => r.data),
}

export const backupApi = {
  export: (includeSettings = true) => api.post('/backup/export', {}, { params: { include_settings: includeSettings } }).then(r => r.data),
  import: (data: any) => api.post('/backup/import', data).then(r => r.data),
  download: (includeSettings = true) => api.post('/backup/download', {}, {
    params: { include_settings: includeSettings },
    responseType: 'blob',
  }).then(r => {
    const url = URL.createObjectURL(r.data)
    const a = document.createElement('a')
    const disposition = r.headers['content-disposition'] || ''
    const match = disposition.match(/filename="?([^"]+)"?/)
    a.href = url
    a.download = match?.[1] || `investment_backup_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }),
}

export interface RecommendationStats {
  id: number
  added_count: number
  removed_count: number
  maintained_count: number
  total_after: number
  summary: string
  created_at: string | null
}

export const targetsApi = {
  list: (params?: { source?: string; status?: string }) =>
    api.get<Target[]>('/targets', { params }).then(r => r.data),
  create: (data: Partial<Target>) =>
    api.post<Target>('/targets', data).then(r => r.data),
  update: (id: number, data: Partial<Target>) =>
    api.put<Target>(`/targets/${id}`, data).then(r => r.data),
  delete: (id: number) =>
    api.delete(`/targets/${id}`).then(r => r.data),
  aiAnalyze: (params?: { markets?: string[]; asset_types?: string[] }) =>
    api.post<AgentAnalysisResponse>('/targets/ai-analyze', params || {}).then(r => r.data),
  clearAll: () =>
    api.post<{ message: string }>('/targets/clear-all').then(r => r.data),
  recommendationStats: () =>
    api.get<RecommendationStats>('/targets/recommendation-stats').then(r => r.data),
}

export interface MarketplaceSkill {
  id: string
  name: string
  description: string
  category: string
  version: string
  author: string
  icon: string
  long_description: string
  provider: string
  is_core: boolean
  installed?: boolean
}

export const skillsApi = {
  marketplace: () => api.get<MarketplaceSkill[]>('/skills/market').then(r => r.data),
  installed: () => api.get<MarketplaceSkill[]>('/skills/installed').then(r => r.data),
  install: (skill_id: string) => api.post('/skills/install', { skill_id }).then(r => r.data),
  uninstall: (skill_id: string) => api.post('/skills/uninstall', { skill_id }).then(r => r.data),
}

export interface MarketLookupResult {
  name: string | null
  code: string
  market: string
}

export interface MarketQuoteResult {
  name: string | null
  code: string
  market: string
  current_price: number | null
  prev_close: number | null
  change: number | null
  change_pct: number | null
  source: string | null
}

export interface MarketSearchItem {
  code: string
  name: string
  market: string
}

export interface MarketHistoryItem {
  date: string
  price: number
  open?: number
  high?: number
  low?: number
}

const historyPeriodDays: Record<string, number> = {
  '1d': 1,
  '5d': 5,
  '1m': 31,
  '3m': 93,
  '6m': 186,
  '1y': 366,
  '2y': 366 * 2,
  '3y': 366 * 3,
  '5y': 366 * 5,
  '10y': 366 * 10,
}

export const filterMarketHistory = (history: MarketHistoryItem[], period = '6m') => {
  const sorted = [...history].filter(item => item.date && item.price > 0).sort((a, b) => a.date.localeCompare(b.date))
  const days = historyPeriodDays[period]
  if (!days || sorted.length === 0) return sorted
  const latest = new Date(sorted[sorted.length - 1].date.slice(0, 10)).getTime()
  const cutoff = latest - days * 24 * 60 * 60 * 1000
  const filtered = sorted.filter(item => new Date(item.date.slice(0, 10)).getTime() >= cutoff)
  return filtered.length > 0 ? filtered : sorted.slice(-days)
}

const bucketKey = (date: string, interval: string) => {
  const d = new Date(date.slice(0, 10))
  if (interval === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  if (interval === 'quarter') return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`
  if (interval === 'year') return String(d.getFullYear())
  if (interval === 'week') {
    const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
    const day = target.getUTCDay() || 7
    target.setUTCDate(target.getUTCDate() + 4 - day)
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
    const week = Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
    return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
  }
  return date.slice(0, 10)
}

export const aggregateMarketHistory = (history: MarketHistoryItem[], interval = 'day') => {
  const sorted = [...history].filter(item => item.date && item.price > 0).sort((a, b) => a.date.localeCompare(b.date))
  if (!['week', 'month', 'quarter', 'year'].includes(interval)) return sorted
  const buckets: MarketHistoryItem[] = []
  let currentKey = ''
  let current: MarketHistoryItem | null = null
  sorted.forEach(item => {
    const key = bucketKey(item.date, interval)
    const open = item.open ?? item.price
    const high = item.high ?? item.price
    const low = item.low ?? item.price
    if (key !== currentKey) {
      if (current) buckets.push(current)
      currentKey = key
      current = { date: item.date.slice(0, 10), price: item.price, open, high, low }
    } else if (current) {
      current.date = item.date.slice(0, 10)
      current.price = item.price
      current.high = Math.max(current.high ?? high, high)
      current.low = Math.min(current.low ?? low, low)
    }
  })
  if (current) buckets.push(current)
  return buckets
}

export const transformMarketHistory = (history: MarketHistoryItem[], period = '6m', interval = 'day') =>
  aggregateMarketHistory(filterMarketHistory(history, period), interval)

export interface FundDividendRecord {
  date: string
  amount: number
  unit?: string
}

export interface MarketFundamentals {
  market_cap?: number
  fund_size?: number
  fund_name?: string
  fund_type?: string
  fund_manager?: string
  fund_managers?: string[]
  fund_manager_tenure?: string
  fund_established?: string
  fund_nav?: number
  fund_nav_date?: string
  fund_1m_return?: number
  fund_3m_return?: number
  fund_6m_return?: number
  fund_1y_return?: number
  fund_dividends?: FundDividendRecord[]
  last_dividend_date?: string
  last_dividend_amount?: number
  trailing_pe?: number
  forward_pe?: number
  price_to_book?: number
  dividend_yield?: number
  dividend_rate?: number
  payout_ratio?: number
  beta?: number
  eps?: number
  revenue?: number
  revenue_growth?: number
  profit_margins?: number
  return_on_equity?: number
  return_on_assets?: number
  debt_to_equity?: number
  book_value?: number
  shares_outstanding?: number
  short_ratio?: number
  current_ratio?: number
  quick_ratio?: number
  earnings_growth?: number
  operating_margins?: number
}

export interface MarketFundamentalsResponse {
  code: string
  market: string
  fundamentals: MarketFundamentals
}

export interface MarketProviders {
  labels: Record<string, string>
  stock_options: Record<string, string[]>
  fund_options: Record<string, string[]>
}

export const marketApi = {
  lookup: (code: string, market: string, asset_type: string) =>
    postCached<MarketLookupResult>('/market/lookup', { code, market, asset_type }, 10 * 60 * 1000),
  quote: (code: string, market: string, asset_type: string, options?: { force_refresh?: boolean }) => {
    const normalPayload = { code, market, asset_type }
    if (options?.force_refresh) {
      return api.post<MarketQuoteResult>('/market/quote', { ...normalPayload, force_refresh: true }).then(r => {
        setCached(cacheKey('/market/quote', normalPayload), r.data, 90 * 1000)
        return r.data
      })
    }
    return postCached<MarketQuoteResult>('/market/quote', normalPayload, 90 * 1000)
  },
  search: (keyword: string, market: string, asset_type: string) =>
    api.post<{ results: MarketSearchItem[] }>('/market/search', { keyword, market, asset_type }).then(r => r.data),
  providers: () =>
    api.get<MarketProviders>('/market/providers').then(r => r.data),
  history: (code: string, market: string, asset_type: string, params?: { period?: string; interval?: string; force_refresh?: boolean }) => {
    const { force_refresh, ...rest } = params || {}
    const normalPayload = { code, market, asset_type, ...rest }
    if (force_refresh) {
      return api.post<{ code: string; market: string; history: MarketHistoryItem[] }>('/market/history', { ...normalPayload, force_refresh: true }).then(r => {
        setCached(cacheKey('/market/history', normalPayload), r.data, 20 * 60 * 1000)
        return r.data
      })
    }
    return postCached<{ code: string; market: string; history: MarketHistoryItem[] }>('/market/history', normalPayload, 20 * 60 * 1000)
  },
  historyFullRange: async (code: string, market: string, asset_type: string, params?: { period?: string; interval?: string }) => {
    const period = params?.period || '6m'
    const interval = params?.interval || 'day'
    if (interval === 'intraday') {
      return marketApi.history(code, market, asset_type, { period, interval })
    }
    const data = await marketApi.historyFullRaw(code, market, asset_type)
    return { ...data, history: transformMarketHistory(data.history || [], period, interval) }
  },
  historyFullRaw: async (code: string, market: string, asset_type: string) => {
    const periods = ['10y', '5y', '3y', '1y', '6m']
    let last: { code: string; market: string; history: MarketHistoryItem[] } | null = null
    for (const period of periods) {
      const data = await postCached<{ code: string; market: string; history: MarketHistoryItem[] }>(
        '/market/history',
        { code, market, asset_type, period, interval: 'day' },
        20 * 60 * 1000,
      )
      last = data
      if ((data.history || []).length > 0) return data
    }
    return last || { code, market, history: [] }
  },
  fundamentals: (code: string, market: string, asset_type: string, options?: { force_refresh?: boolean }) => {
    const normalPayload = { code, market, asset_type }
    if (options?.force_refresh) {
      return api.post<MarketFundamentalsResponse>('/market/fundamentals', { ...normalPayload, force_refresh: true }).then(r => {
        setCached(cacheKey('/market/fundamentals', normalPayload), r.data, 60 * 60 * 1000)
        return r.data
      })
    }
    return postCached<MarketFundamentalsResponse>('/market/fundamentals', normalPayload, 60 * 60 * 1000)
  },
}

export interface OcrAssetItem {
  asset_type: string
  market: string
  platform: string
  code: string
  name: string
  shares: number | null
  buy_price: number | null
  buy_date: string
  confidence: number
  warnings: string[]
  evidence: string
  source_filename: string
  status: 'ready' | 'review' | 'invalid'
}

export interface OcrParseResponse {
  assets: OcrAssetItem[]
}

export const ocrApi = {
  parse: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<OcrParseResponse>('/ocr/parse', fd).then(r => r.data)
  },
  batchCreate: (assets: Partial<Asset>[]) =>
    api.post<Asset[]>('/assets/batch-create', { assets }).then(r => r.data),
}

export const dataApi = {
  clear: () => api.post<{ message: string }>('/data/clear').then(r => r.data),
}

export default api
