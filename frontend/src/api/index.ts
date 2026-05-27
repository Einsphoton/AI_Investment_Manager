import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
})

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
  current_price: number
  price_updated_at: string
  note: string
  created_at: string
  updated_at: string
}

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

export const dashboardApi = {
  get: () => api.get<DashboardData>('/dashboard').then(r => r.data),
}

export const assetsApi = {
  list: (params?: { asset_type?: string; market?: string }) =>
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
  agentRun: (req?: { asset_ids?: number[]; target_ids?: number[]; goal?: string }) =>
    api.post<AgentAnalysisResponse>('/analysis/agent-run', req || { goal: '全面分析投资组合' }).then(r => r.data),
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

export const settingsApiFull = {
  checkModels: (apiKey: string, baseUrl: string) =>
    api.post<{ models: string[] }>('/settings/check-models', { api_key: apiKey, base_url: baseUrl }).then(r => r.data),
}

export const backupApi = {
  export: () => api.post('/backup/export').then(r => r.data),
  import: (data: any) => api.post('/backup/import', data).then(r => r.data),
  download: () => api.post('/backup/download', {}, { responseType: 'blob' }).then(r => {
    const url = URL.createObjectURL(r.data)
    const a = document.createElement('a')
    a.href = url
    a.download = 'investment_backup.json'
    a.click()
    URL.revokeObjectURL(url)
  }),
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
    api.post<MarketLookupResult>('/market/lookup', { code, market, asset_type }).then(r => r.data),
  quote: (code: string, market: string, asset_type: string) =>
    api.post<MarketQuoteResult>('/market/quote', { code, market, asset_type }).then(r => r.data),
  search: (keyword: string, market: string, asset_type: string) =>
    api.post<{ results: MarketSearchItem[] }>('/market/search', { keyword, market, asset_type }).then(r => r.data),
  providers: () =>
    api.get<MarketProviders>('/market/providers').then(r => r.data),
  history: (code: string, market: string, asset_type: string) =>
    api.post<{ code: string; market: string; history: MarketHistoryItem[] }>('/market/history', { code, market, asset_type }).then(r => r.data),
  fundamentals: (code: string, market: string, asset_type: string) =>
    api.post<MarketFundamentalsResponse>('/market/fundamentals', { code, market, asset_type }).then(r => r.data),
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
