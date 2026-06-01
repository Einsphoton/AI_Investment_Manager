import { useState, useEffect, useCallback, useRef } from 'react'
import { useAIWorkContext } from '../stores/AIWorkContext'
import {
  Card, Table, Button, Modal, Form, Input, InputNumber, Space,
  Tag, message, Row, Col, Radio, Popconfirm, Typography, DatePicker,
  Select, AutoComplete, Tooltip, Descriptions, Empty, Tabs, Divider, Spin
} from 'antd'
import dayjs from 'dayjs'
import {
  PlusOutlined, EditOutlined, DeleteOutlined,
  AppstoreOutlined, BankOutlined, StockOutlined, SearchOutlined, ReloadOutlined,
  EyeOutlined, PlusCircleOutlined, FileTextOutlined, ThunderboltOutlined
} from '@ant-design/icons'
import {
  AreaChart, Area, ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip as ChartTooltip, Scatter
} from 'recharts'
import {
  assetsApi, marketApi, analysisApi, Asset, AssetDetail,
  AssetTransaction, MarketFundamentals, MarketHistoryItem, transformMarketHistory
} from '../api'
import { NetValueRangeSelector, type NetValuePeriod } from '../components/MarketCharts'

const { Text } = Typography

const goldStyle = { color: '#c9a84c' }
const greenStyle = { color: 'oklch(72% 0.14 145)' }
const redStyle = { color: 'oklch(65% 0.18 25)' }

const assetTypeOptions = [
  { label: '股票', value: 'stock', icon: <StockOutlined /> },
  { label: '场外基金', value: 'offshore_fund', icon: <BankOutlined /> },
  { label: '场内基金', value: 'onshore_fund', icon: <AppstoreOutlined /> },
]

const marketOptions = [
  { label: 'A 股', value: 'A' },
  { label: '港股', value: 'HK' },
  { label: '美股', value: 'US' },
]

const groupOptions = [
  { label: '按类型', value: 'type' },
  { label: '按平台', value: 'platform' },
]

const platformOptions = [
  { value: '微信理财通' },
  { value: '支付宝' },
  { value: '招商银行' },
  { value: '招商证券' },
  { value: '富途牛牛' },
  { value: '平安银行' },
  { value: '中银国际' },
  { value: '中国银行' },
  { value: '工商银行' },
  { value: '建设银行' },
]

const typeColors: Record<string, string> = {
  stock: '#c9a84c',
  offshore_fund: '#e8d48b',
  onshore_fund: '#a0893c',
}

const marketTagColors: Record<string, string> = {
  A: '#c9a84c',
  HK: '#e8d48b',
  US: '#a0893c',
}

const fundamentalLabels: Record<keyof MarketFundamentals, string> = {
  market_cap: '总市值',
  fund_size: '基金规模',
  fund_name: '基金名称',
  fund_type: '基金类型',
  fund_manager: '基金经理',
  fund_managers: '基金经理',
  fund_manager_tenure: '经理任期',
  fund_established: '成立日期',
  fund_nav: '单位净值',
  fund_nav_date: '净值日期',
  fund_1m_return: '近 1 月',
  fund_3m_return: '近 3 月',
  fund_6m_return: '近 6 月',
  fund_1y_return: '近 1 年',
  fund_dividends: '分红记录',
  last_dividend_date: '最近分红日',
  last_dividend_amount: '最近分红',
  trailing_pe: '市盈率 TTM',
  forward_pe: '预期市盈率',
  price_to_book: '市净率',
  dividend_yield: '股息率',
  dividend_rate: '每股股息',
  payout_ratio: '派息率',
  beta: 'Beta',
  eps: 'EPS',
  revenue: '营收',
  revenue_growth: '营收增速',
  profit_margins: '利润率',
  return_on_equity: 'ROE',
  return_on_assets: 'ROA',
  debt_to_equity: '资产负债率',
  book_value: '每股净资产',
  shares_outstanding: '流通股本',
  short_ratio: '空头比率',
  current_ratio: '流动比率',
  quick_ratio: '速动比率',
  earnings_growth: '盈利增速',
  operating_margins: '经营利润率',
}

const fundFundamentalKeys: Array<keyof MarketFundamentals> = [
  'fund_size',
  'fund_type',
  'fund_manager',
  'fund_manager_tenure',
  'fund_established',
  'fund_nav',
  'fund_nav_date',
  'fund_1m_return',
  'fund_3m_return',
  'fund_6m_return',
  'fund_1y_return',
  'last_dividend_date',
  'last_dividend_amount',
]

const stockFundamentalKeys = Object.keys(fundamentalLabels).filter(key => ![
  'fund_size',
  'fund_name',
  'fund_type',
  'fund_manager',
  'fund_managers',
  'fund_manager_tenure',
  'fund_established',
  'fund_nav',
  'fund_nav_date',
  'fund_1m_return',
  'fund_3m_return',
  'fund_6m_return',
  'fund_1y_return',
  'fund_dividends',
  'last_dividend_date',
  'last_dividend_amount',
].includes(key)) as Array<keyof MarketFundamentals>

const formatMoney = (value?: number | null, digits = 2) => (
  value === null || value === undefined || Number.isNaN(value)
    ? '-'
    : `¥${value.toFixed(digits)}`
)

const formatCompactNumber = (value?: number | null) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-'
  const abs = Math.abs(value)
  if (abs >= 100000000) return `${(value / 100000000).toFixed(2)} 亿`
  if (abs >= 10000) return `${(value / 10000).toFixed(2)} 万`
  return value.toFixed(2)
}

const formatFundamentalValue = (key: keyof MarketFundamentals, value?: MarketFundamentals[keyof MarketFundamentals]) => {
  if (value === undefined || value === null || Number.isNaN(value)) return '-'
  if (Array.isArray(value)) return value.join('、')
  if (typeof value === 'string') return value || '-'
  if (['market_cap', 'fund_size', 'revenue', 'shares_outstanding'].includes(key)) return formatCompactNumber(value)
  if (['dividend_yield', 'payout_ratio', 'revenue_growth', 'profit_margins', 'return_on_equity', 'return_on_assets', 'earnings_growth', 'operating_margins'].includes(key)) {
    const percent = Math.abs(value) <= 2 ? value * 100 : value
    return `${percent.toFixed(2)}%`
  }
  if (['fund_1m_return', 'fund_3m_return', 'fund_6m_return', 'fund_1y_return'].includes(key)) {
    const percent = Math.abs(value) <= 2 ? value * 100 : value
    return `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%`
  }
  if (key === 'last_dividend_amount') return `${value.toFixed(4)} 元/份`
  if (key === 'fund_nav') return value.toFixed(4)
  return value.toFixed(2)
}

const renderTradeType = (type: string) => (
  <Tag
    color={type === 'buy' ? greenStyle.color : redStyle.color}
    style={{ border: 'none', color: '#fff', borderRadius: 6 }}
  >
    {type === 'buy' ? '买入' : '卖出'}
  </Tag>
)

const mergeAssetMarketFields = (nextAssets: Asset[], previousAssets: Asset[]) => {
  const previousById = new Map(previousAssets.map(asset => [asset.id, asset]))
  return nextAssets.map(asset => mergeAssetMarketField(asset, previousById.get(asset.id)))
}

const mergeAssetMarketField = (asset: Asset, previous?: Asset | null) => {
  if (!previous) return asset
  if (previous.id !== asset.id) return asset
  const nextHasPrice = asset.current_price != null && asset.current_price > 0
  const previousHasPrice = previous.current_price != null && previous.current_price > 0
  if (nextHasPrice || !previousHasPrice) return asset
  return {
    ...asset,
    current_price: previous.current_price,
    price_updated_at: previous.price_updated_at || asset.price_updated_at,
  }
}

export default function Assets() {
  const [assets, setAssets] = useState<Asset[]>([])
  const assetsRef = useRef<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null)
  const [groupBy, setGroupBy] = useState<'type' | 'platform'>('type')
  const [form] = Form.useForm()
  const [tradeForm] = Form.useForm()
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [assetDetail, setAssetDetail] = useState<AssetDetail | null>(null)
  const [detailFullHistory, setDetailFullHistory] = useState<MarketHistoryItem[]>([])
  const [detailHistoryLoading, setDetailHistoryLoading] = useState(false)
  const [detailFundamentalsLoading, setDetailFundamentalsLoading] = useState(false)
  const [transactionModalOpen, setTransactionModalOpen] = useState(false)
  const [savingTransaction, setSavingTransaction] = useState(false)
  const [assetListPeriod, setAssetListPeriod] = useState<NetValuePeriod>('1m')
  const [detailPeriod, setDetailPeriod] = useState<NetValuePeriod>('6m')

  const lastAutoNameRef = useRef<string | null>(null)
  const lookupSeqRef = useRef(0)
  const priceHistorySeqRef = useRef(0)
  const detailHistoryPrefetchKeyRef = useRef<string | null>(null)
  const marketWarmupSeqRef = useRef(0)

  const fillDetailPriceFromHistory = useCallback((
    assetId: number,
    history: MarketHistoryItem[] | undefined,
    options?: { force?: boolean },
  ) => {
    const latest = [...(history || [])].reverse().find(item => item.price != null && item.price > 0)
    if (!latest) return

    const updatedAt = latest.date || new Date().toISOString()
    const fillAsset = (asset: Asset) => {
      if (asset.id !== assetId) return asset
      const hasCurrentPrice = asset.current_price != null && asset.current_price > 0
      if (hasCurrentPrice && !options?.force) return asset
      return {
        ...asset,
        current_price: latest.price,
        price_updated_at: updatedAt,
      }
    }

    setSelectedAsset(prev => prev ? fillAsset(prev) : prev)
    setAssetDetail(prev => (
      prev?.asset.id === assetId ? { ...prev, asset: fillAsset(prev.asset) } : prev
    ))
    setAssets(prev => prev.map(fillAsset))
  }, [])

  useEffect(() => {
    assetsRef.current = assets
  }, [assets])

  const idleDelay = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms))

  const fetchPriceHistory = useCallback(async (assets: Asset[], period: NetValuePeriod = assetListPeriod) => {
    const seq = priceHistorySeqRef.current + 1
    priceHistorySeqRef.current = seq
    const nextResults: Record<number, MarketHistoryItem[]> = {}
    const queue = [...assets].filter(a => a.code)
    let cursor = 0
    const worker = async () => {
      while (cursor < queue.length) {
        const a = queue[cursor]
        cursor += 1
        if (!a) continue
        try {
          const data = await marketApi.history(a.code, a.market, a.asset_type, { period, interval: 'day' })
          if (seq !== priceHistorySeqRef.current) return
          if (data.history.length > 0) {
            nextResults[a.id] = data.history
            setPriceHistory(prev => ({ ...prev, [a.id]: data.history }))
          }
        } catch {
          // silent
        }
      }
    }
    await Promise.allSettled(Array.from({ length: Math.min(1, queue.length) }, worker))
    if (seq !== priceHistorySeqRef.current) return
    setPriceHistory(prev => ({ ...prev, ...nextResults }))
  }, [assetListPeriod])

  const warmAssetsMarketData = useCallback((assetList: Asset[]) => {
    const seq = marketWarmupSeqRef.current + 1
    marketWarmupSeqRef.current = seq
    const liveAssets = assetList.filter(asset => asset.code)

    window.setTimeout(async () => {
      for (const asset of liveAssets) {
        if (seq !== marketWarmupSeqRef.current) return
        try {
          const quote = await marketApi.quote(asset.code, asset.market, asset.asset_type)
          if (quote.current_price != null) {
            setAssets(prev => prev.map(item => (
              item.id === asset.id
                ? { ...item, current_price: quote.current_price, price_updated_at: new Date().toISOString() }
                : item
            )))
          }
        } catch {}
        await idleDelay(220)
      }

      for (const asset of liveAssets) {
        if (seq !== marketWarmupSeqRef.current) return
        try {
          const data = await marketApi.history(asset.code, asset.market, asset.asset_type, { period: assetListPeriod, interval: 'day' })
          if ((data.history || []).length > 0) {
            setPriceHistory(prev => ({ ...prev, [asset.id]: data.history || [] }))
          }
        } catch {}
        await idleDelay(260)
      }

      for (const asset of liveAssets) {
        if (seq !== marketWarmupSeqRef.current) return
        try {
          await marketApi.fundamentals(asset.code, asset.market, asset.asset_type)
        } catch {}
        await idleDelay(360)
      }
    }, 500)
  }, [assetListPeriod])

  const fetchAssets = async () => {
    setLoading(true)
    try {
      const data = await assetsApi.list()
      const mergedData = mergeAssetMarketFields(data, assetsRef.current)
      setAssets(mergedData)
      return mergedData
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const refreshPrices = async () => {
    setRefreshing(true)
    try {
      await assetsApi.refreshPrices()
      const data = await assetsApi.list()
      const mergedData = mergeAssetMarketFields(data, assetsRef.current)
      setAssets(mergedData)
      fetchPriceHistory(mergedData, assetListPeriod)
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '刷新行情失败')
    } finally {
      setRefreshing(false)
    }
  }

  const aiCtx = useAIWorkContext()

  const handleAnalyzeAll = async () => {
    if (assets.length === 0) {
      aiCtx.startTask('AI 全面分析')
      aiCtx.failTask('暂无资产需要分析')
      return
    }
    aiCtx.startTask('AI 全面分析')
    try {
      const ids = assets.map(a => a.id)
      const totalAssets = ids.length
      const batchSize = Math.min(3, Math.max(1, Math.ceil(totalAssets / 3)))
      const batches: number[][] = []
      for (let i = 0; i < ids.length; i += batchSize) {
        batches.push(ids.slice(i, i + batchSize))
      }

      aiCtx.setParallelMode(true)
      for (let i = 0; i < batches.length; i++) {
        aiCtx.registerSubTask(`batch-${i}`,
          `资产分析 (${i * batchSize + 1}-${Math.min((i + 1) * batchSize, totalAssets)})`, '📊')
      }

      aiCtx.addLog('正在获取市场行情与基本面数据...', 'thinking', '准备')
      await new Promise(r => setTimeout(r, 200))

      const batchTasks = batches.map(async (batchIds, i) => {
        aiCtx.updateSubTask(`batch-${i}`, { status: 'running', thinking: `开始分析 ${batchIds.length} 项资产...`, progress: 5 })
        aiCtx.addLog(`第 ${i + 1} 批: 分析 ${batchIds.length} 项资产...`, 'thinking', `批 ${i + 1}`)

        const result = await aiCtx.withPhase({
          from: 5, to: 95, duration: 15000, tag: `批 ${i + 1}`,
          thinkingMessages: [
            `AI 正在分析第 ${i + 1} 批资产...`,
            '正在评估资产基本面...',
            '正在分析技术面走势...',
            '正在计算风险指标...',
            '正在生成交易建议...',
          ],
          logMessages: [
            '调用 AI 模型分析中...',
            '分析资产基本面数据...',
            '评估市场行情走势...',
            '计算风险收益比...',
            '生成结构化分析报告...',
          ],
        }, () => analysisApi.agentRun({
          asset_ids: batchIds,
          goal: `请对以下 ${batchIds.length} 项投资资产生成详细分析报告。覆盖宏观、微观、基本面、技术面，给出具体投资建议。`,
          save_portfolio_record: false,
        }))
        aiCtx.updateSubTask(`batch-${i}`, { status: 'completed', progress: 100, thinking: '分析完成' })
        aiCtx.addLog(`✅ 第 ${i + 1} 批分析完成`, 'success', `批 ${i + 1}`)
        return result
      })

      await Promise.all(batchTasks)
      aiCtx.addLog('✅ AI 全面分析完成', 'success')

      if (detailOpen && selectedAsset) {
        await aiCtx.withPhase({
          from: 96, to: 100, duration: 2000, tag: '刷新',
          thinkingMessages: ['正在刷新资产详情...'],
          logMessages: ['更新页面数据...'],
        }, () => loadAssetDetail(selectedAsset))
      }
      aiCtx.completeTask()
    } catch (e: any) {
      aiCtx.failTask(e?.response?.data?.detail || 'AI 分析失败')
    }
  }

  useEffect(() => {
    const init = async () => {
      const data = await fetchAssets()
      if (data && data.length > 0) {
        warmAssetsMarketData(data)
      }
    }
    init()
  }, [])

  useEffect(() => {
    if (assets.length > 0) {
      fetchPriceHistory(assets, assetListPeriod)
    }
  }, [assetListPeriod])

  const openAddModal = () => {
    setEditingAsset(null)
    lastAutoNameRef.current = null
    lookupSeqRef.current += 1
    form.resetFields()
    setModalOpen(true)
  }

  const openEditModal = (asset: Asset) => {
    setEditingAsset(asset)
    lastAutoNameRef.current = null
    lookupSeqRef.current += 1
    form.setFieldsValue({ ...asset, buy_date: asset.buy_date ? dayjs(asset.buy_date) : null })
    setModalOpen(true)
  }

  const [lookupLoading, setLookupLoading] = useState(false)
  const [priceHistory, setPriceHistory] = useState<Record<number, MarketHistoryItem[]>>({})

  const handleLookupName = async (code?: string) => {
    const values = form.getFieldsValue()
    const c = (code || values.code || '').trim().toUpperCase()
    if (!c) return
    const market = values.market
    const assetType = values.asset_type
    if (!market || !assetType) return
    const currentName = (values.name || '').trim()
    if (currentName && currentName !== lastAutoNameRef.current) return
    const seq = lookupSeqRef.current + 1
    lookupSeqRef.current = seq
    setLookupLoading(true)
    try {
      const result = await marketApi.lookup(c, market, assetType)
      const latestValues = form.getFieldsValue()
      const latestCode = (latestValues.code || '').trim().toUpperCase()
      if (seq !== lookupSeqRef.current || latestCode !== c || latestValues.market !== market || latestValues.asset_type !== assetType) {
        return
      }
      if (result.name) {
        lastAutoNameRef.current = result.name
        form.setFieldsValue({ name: result.name })
      } else if ((latestValues.name || '').trim() === lastAutoNameRef.current) {
        lastAutoNameRef.current = null
        form.setFieldsValue({ name: undefined })
      }
    } catch (e) {
      // silent
    } finally {
      if (seq === lookupSeqRef.current) {
        setLookupLoading(false)
      }
    }
  }

  const [lookupTimer, setLookupTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  const scheduleLookup = () => {
    if (lookupTimer) clearTimeout(lookupTimer)
    if (editingAsset) return
    const code = form.getFieldValue('code')
    const market = form.getFieldValue('market')
    const assetType = form.getFieldValue('asset_type')
    const name = (form.getFieldValue('name') || '').trim()
    const nameWasAutoFilled = Boolean(name && name === lastAutoNameRef.current)
    if (nameWasAutoFilled) {
      form.setFieldsValue({ name: undefined })
      lastAutoNameRef.current = null
    }
    if (code && market && assetType && (!name || nameWasAutoFilled)) {
      const timer = setTimeout(() => handleLookupName(code), 400)
      setLookupTimer(timer)
    }
  }

  useEffect(() => {
    return () => { if (lookupTimer) clearTimeout(lookupTimer) }
  }, [lookupTimer])

  const handleDelete = async (id: number) => {
    await assetsApi.delete(id)
    message.success('删除成功')
    fetchAssets()
  }

  const handleSubmit = async () => {
    const values = await form.validateFields()
    const payload = { ...values, buy_date: values.buy_date ? values.buy_date.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD') }
    if (editingAsset) {
      await assetsApi.update(editingAsset.id, payload)
      message.success('更新成功')
    } else {
      await assetsApi.create(payload)
      message.success('添加成功')
    }
    setModalOpen(false)
    const data = await fetchAssets()
    if (data && data.length > 0) {
      warmAssetsMarketData(data)
    }
  }

  const loadAssetDetail = async (asset: Asset) => {
    setDetailLoading(true)
    try {
      const detail = await assetsApi.detail(asset.id)
      const previousAsset =
        assetDetail?.asset.id === asset.id
          ? assetDetail.asset
          : selectedAsset?.id === asset.id
            ? selectedAsset
            : assetsRef.current.find(item => item.id === asset.id) || asset
      const hydratedAsset = mergeAssetMarketField(detail.asset, previousAsset)
      const hydratedDetail = { ...detail, asset: hydratedAsset }
      setAssetDetail(prev => (
        prev?.asset.id === hydratedDetail.asset.id
          ? {
              ...hydratedDetail,
              history: prev.history?.length ? prev.history : detail.history,
              fundamentals: Object.keys(prev.fundamentals || {}).length ? prev.fundamentals : detail.fundamentals,
            }
          : hydratedDetail
      ))
      setSelectedAsset(hydratedAsset)
      return hydratedDetail
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '加载资产详情失败')
      setAssetDetail({
        asset,
        history: priceHistory[asset.id] || [],
        fundamentals: {},
        transactions: [],
        latest_analysis: null,
      })
    } finally {
      setDetailLoading(false)
    }
  }

  const openDetailModal = async (asset: Asset) => {
    setSelectedAsset(asset)
    setAssetDetail({
      asset,
      history: priceHistory[asset.id] || [],
      fundamentals: {},
      transactions: [],
      latest_analysis: null,
    })
    setDetailFullHistory([])
    setDetailPeriod('6m')
    setDetailOpen(true)
    loadAssetDetail(asset)
  }

  useEffect(() => {
    if (!detailOpen || !selectedAsset || !assetDetail) return
    let active = true
    const realtimeAsset = selectedAsset.asset_type !== 'offshore_fund'
    if (detailFullHistory.length > 0) {
      const transformedHistory = transformMarketHistory(detailFullHistory, detailPeriod, 'day')
      setAssetDetail(prev => prev ? { ...prev, history: transformedHistory } : prev)
      fillDetailPriceFromHistory(selectedAsset.id, transformedHistory)
      if (!realtimeAsset) {
        return () => { active = false }
      }
    }
    const fallback = priceHistory[selectedAsset.id]
    if (fallback?.length) {
      setAssetDetail(prev => prev ? { ...prev, history: fallback } : prev)
      fillDetailPriceFromHistory(selectedAsset.id, fallback)
    }
    setDetailHistoryLoading(true)
    marketApi.history(selectedAsset.code, selectedAsset.market, selectedAsset.asset_type, { period: detailPeriod, interval: 'day', force_refresh: realtimeAsset })
      .then(data => {
        if (!active) return
        const history = data.history || []
        if (history.length > 0) {
          setAssetDetail(prev => prev ? { ...prev, history } : prev)
          fillDetailPriceFromHistory(selectedAsset.id, history, { force: realtimeAsset })
        }
      })
      .catch(() => {})
      .finally(() => { if (active) setDetailHistoryLoading(false) })

    const prefetchKey = `${selectedAsset.id}:${selectedAsset.code}:${selectedAsset.market}:${selectedAsset.asset_type}`
    if (detailHistoryPrefetchKeyRef.current !== prefetchKey) {
      detailHistoryPrefetchKeyRef.current = prefetchKey
      window.setTimeout(() => {
        marketApi.historyFullRaw(selectedAsset.code, selectedAsset.market, selectedAsset.asset_type)
          .then(data => {
            if ((data.history || []).length > 0) {
              setDetailFullHistory(data.history || [])
            }
          })
          .catch(() => {})
      }, 600)
    }
    return () => { active = false }
  }, [detailPeriod, detailOpen, selectedAsset?.id, assetDetail?.asset.id, detailFullHistory.length, fillDetailPriceFromHistory])

  useEffect(() => {
    if (!detailOpen || !selectedAsset || !assetDetail) return
    let active = true
    setDetailFundamentalsLoading(true)
    marketApi.fundamentals(selectedAsset.code, selectedAsset.market, selectedAsset.asset_type)
      .then(data => {
        if (!active) return
        setAssetDetail(prev => prev ? { ...prev, fundamentals: data.fundamentals || {} } : prev)
      })
      .catch(() => {})
      .finally(() => { if (active) setDetailFundamentalsLoading(false) })
    return () => { active = false }
  }, [detailOpen, selectedAsset?.id, assetDetail?.asset.id])

  const openTransactionModal = () => {
    const asset = assetDetail?.asset || selectedAsset
    if (!asset) return
    tradeForm.setFieldsValue({
      trade_type: 'buy',
      trade_date: dayjs(),
      shares: undefined,
      price: asset.current_price || asset.buy_price,
      fee: 0,
      note: '',
    })
    setTransactionModalOpen(true)
  }

  const handleTransactionSubmit = async () => {
    const asset = assetDetail?.asset || selectedAsset
    if (!asset) return
    const values = await tradeForm.validateFields()
    setSavingTransaction(true)
    try {
      await assetsApi.createTransaction(asset.id, {
        ...values,
        trade_date: values.trade_date ? values.trade_date.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
      })
      message.success('交易记录已添加')
      setTransactionModalOpen(false)
      const refreshedAssets = await fetchAssets()
      const nextAsset = refreshedAssets?.find(a => a.id === asset.id) || asset
      await loadAssetDetail(nextAsset)
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '添加交易记录失败')
    } finally {
      setSavingTransaction(false)
    }
  }

  const handleRunAssetAnalysis = async () => {
    const asset = assetDetail?.asset || selectedAsset
    if (!asset) return
    aiCtx.startTask('AI 资产分析')
    try {
      aiCtx.setParallelMode(true)
      aiCtx.registerSubTask('data', '数据采集', '📡')
      aiCtx.registerSubTask('market', '行情分析', '📈')
      aiCtx.registerSubTask('ai', 'AI 深度分析', '🤖')

      // Phase 1: Data collection with streaming
      aiCtx.updateSubTask('data', { status: 'running', thinking: '正在获取资产数据...', progress: 5 })
      await aiCtx.withPhase({
        from: 5, to: 95, duration: 3000, tag: '数据',
        thinkingMessages: ['正在读取资产信息...', '正在加载交易记录...', '正在计算持仓成本...'],
        logMessages: ['查询资产基本信息...', '加载历史交易记录...', '计算持仓成本与市值...'],
      }, async () => { await new Promise(r => setTimeout(r, 400)); return })
      aiCtx.updateSubTask('data', { status: 'completed', progress: 100, thinking: '数据采集完成' })

      // Phase 2: Market data
      aiCtx.updateSubTask('market', { status: 'running', thinking: '正在获取市场行情...', progress: 5 })
      await aiCtx.withPhase({
        from: 5, to: 95, duration: 4000, tag: '行情',
        thinkingMessages: ['正在获取最新行情...', '正在获取基本面数据...', '正在分析技术面走势...'],
        logMessages: ['获取实时价格数据...', '获取基本面指标...', '获取历史走势数据...'],
      }, async () => { await new Promise(r => setTimeout(r, 500)); return })
      aiCtx.updateSubTask('market', { status: 'completed', progress: 100, thinking: '行情获取完成' })

      // Phase 3: AI deep analysis
      aiCtx.updateSubTask('ai', { status: 'running', thinking: 'AI 开始深度分析...', progress: 5 })
      await aiCtx.withPhase({
        from: 5, to: 95, duration: 15000, tag: 'AI',
        thinkingMessages: [
          'AI 正在深度分析资产...',
          '正在评估基本面数据...',
          '正在分析技术面走势...',
          '正在生成交易策略...',
          '正在编写分析报告...',
        ],
        logMessages: [
          '调用 AI 模型进行分析...',
          '分析资产基本面指标...',
          '评估技术面趋势...',
          '生成投资建议...',
          '生成结构化分析报告...',
        ],
      }, () => analysisApi.agentRun({
        asset_ids: [asset.id],
        goal: `请针对 ${asset.name || asset.code} 这一项资产生成详细分析报告，覆盖基本面、技术面交易策略、具体交易建议、宏观信息和微观信息。`,
        save_portfolio_record: false,
      }))
      aiCtx.updateSubTask('ai', { status: 'completed', progress: 100, thinking: 'AI 分析完成' })
      aiCtx.addLog('✅ AI 分析报告已更新', 'success', 'AI')

      await aiCtx.withPhase({
        from: 96, to: 100, duration: 2000, tag: '刷新',
        thinkingMessages: ['正在刷新页面...'],
        logMessages: ['加载最新分析报告...'],
      }, () => loadAssetDetail(asset))
      aiCtx.addLog('✅ 分析完成', 'success')
      aiCtx.completeTask()
    } catch (e: any) {
      aiCtx.failTask(e?.response?.data?.detail || 'AI 分析失败')
    }
  }

  const assetTypeMap: Record<string, string> = { stock: '股票', offshore_fund: '场外基金', onshore_fund: '场内基金' }

  const columns = [
    {
      title: '名称', dataIndex: 'name', key: 'name', width: 120,
      render: (v: string, r: Asset) => (
        <Space>
          <span style={{ color: '#e8e6e3', fontWeight: 500 }}>{v || r.code}</span>
        </Space>
      ),
    },
    { title: '代码', dataIndex: 'code', key: 'code', width: 85 },
    {
      title: '类型', dataIndex: 'asset_type', key: 'asset_type', width: 80,
      render: (v: string) => (
        <Tag color={typeColors[v]} style={{ borderRadius: 6, border: 'none', color: '#fff' }}>
          {assetTypeMap[v] || v}
        </Tag>
      ),
    },
    {
      title: '市场', dataIndex: 'market', key: 'market', width: 55,
      render: (v: string) => (
        <Tag style={{ borderRadius: 6, border: `1px solid ${marketTagColors[v] || '#666'}`, color: marketTagColors[v] || '#666', background: 'transparent' }}>
          {v}
        </Tag>
      ),
    },
    { title: '平台', dataIndex: 'platform', key: 'platform', width: 85 },
    {
      title: '份额', dataIndex: 'shares', key: 'shares', width: 75,
      render: (v: number) => <span style={{ fontWeight: 500 }}>{v.toFixed(2)}</span>,
    },
    {
      title: '买入单价', dataIndex: 'buy_price', key: 'buy_price', width: 95,
      render: (v: number) => <span style={{ color: '#9a9892' }}>¥{v.toFixed(4)}</span>,
    },
    {
      title: '当前价', dataIndex: 'current_price', key: 'current_price', width: 85,
      render: (v: number | null) => v != null && v > 0 ? <span style={{ color: '#9a9892' }}>¥{v.toFixed(3)}</span> : <span style={{ color: '#5c5a55' }}>-</span>,
    },
    {
      title: '当前市值', key: 'market_value', width: 100,
      render: (_: any, r: Asset) => {
        if (r.current_price == null || r.current_price <= 0) return <span style={{ color: '#5c5a55' }}>-</span>
        const mv = r.shares * r.current_price
        return (
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            minWidth: 92,
            padding: '4px 8px',
            borderRadius: 8,
            background: 'rgba(201, 168, 76, 0.1)',
            border: '1px solid rgba(201, 168, 76, 0.18)',
            boxShadow: 'inset 0 0 12px rgba(201, 168, 76, 0.04)',
          }}>
            <span style={{ color: '#f3df99', fontWeight: 700, fontSize: 13, lineHeight: 1.2 }}>
              ¥{mv.toFixed(2)}
            </span>
          </div>
        )
      },
    },
    {
      title: '已实现盈亏', key: 'realized_pnl', width: 100,
      render: () => <span style={{ color: '#5c5a55' }}>-</span>,
    },
    { title: '买入日期', dataIndex: 'buy_date', key: 'buy_date', width: 90 },
    {
      title: '盈亏', key: 'pnl', width: 110,
      render: (_: any, r: Asset) => {
        if (r.current_price == null || r.current_price <= 0) return <span style={{ color: '#5c5a55' }}>暂无数据</span>
        const pnl = r.shares * (r.current_price - r.buy_price)
        const pct = (r.current_price - r.buy_price) / r.buy_price * 100
        const color = pnl >= 0 ? greenStyle.color : redStyle.color
        return (
          <Space direction="vertical" size={0} style={{ gap: 0 }}>
            <span style={{ color, fontWeight: 600 }}>¥{pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}</span>
            <span style={{ color, fontSize: 11, opacity: 0.7 }}>{pnl >= 0 ? '+' : ''}{pct.toFixed(2)}%</span>
          </Space>
        )
      },
    },
    {
      title: '走势', key: 'chart', width: 100,
      render: (_: any, r: Asset) => {
        let data = priceHistory[r.id]
        if (!data || data.length < 2) {
          const cp = r.current_price
          if (cp == null || cp <= 0) return <span style={{ color: '#5c5a55' }}>-</span>
          data = Array.from({ length: 20 }, (_, i) => ({
            date: '',
            price: r.buy_price + (cp - r.buy_price) * (i + 1) / 20,
          }))
        }
        const isUp = (data[data.length - 1].price >= data[0].price)
        return (
          <ResponsiveContainer width="100%" height={36}>
            <AreaChart data={data}>
              <Area type="monotone" dataKey="price" stroke={isUp ? greenStyle.color : redStyle.color} fill={isUp ? greenStyle.color : redStyle.color} fillOpacity={0.08} strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )
      },
    },
    {
      title: '备注', dataIndex: 'note', key: 'note', ellipsis: true, width: 100,
      render: (v: string) => (
        <Tooltip title={v}>
          <span style={{ color: '#5c5a55' }}>{v || '-'}</span>
        </Tooltip>
      ),
    },
    {
      title: '', key: 'action', width: 100,
      render: (_: any, r: Asset) => (
        <Space>
          <Tooltip title="查看详情">
            <Button
              type="text"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => openDetailModal(r)}
              style={{ color: '#c9a84c' }}
            />
          </Tooltip>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEditModal(r)}
            style={{ color: '#9a9892' }}
          />
          <Popconfirm
            title="确定删除？"
            onConfirm={() => handleDelete(r.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button
              type="text"
              size="small"
              icon={<DeleteOutlined />}
              style={{ color: '#5c5a55' }}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const groupedData = () => {
    const groups: Record<string, Asset[]> = {}
    const key = groupBy === 'type' ? 'asset_type' : 'platform'
    assets.forEach(a => {
      const g = key === 'asset_type' ? (assetTypeMap[a[key]] || a[key]) : (a[key] || '其他')
      if (!groups[g]) groups[g] = []
      groups[g].push(a)
    })
    return groups
  }

  const tableProps = {
    rowKey: "id" as const,
    loading,
    scroll: { x: 1480 } as const,
    size: "small" as const,
    style: { margin: -4 } as const,
    components: {
      header: {
        cell: (props: any) => (
          <th {...props} style={{
            ...props.style,
            textTransform: 'uppercase' as const,
            fontSize: 11,
            letterSpacing: '0.08em',
            fontWeight: 600,
          }} />
        ),
      },
    },
  }

  const getDisplayTransactions = (detail: AssetDetail): AssetTransaction[] => {
    if (detail.transactions.length > 0) {
      return [...detail.transactions].sort((a, b) => a.trade_date.localeCompare(b.trade_date))
    }
    return [{
      id: -1,
      asset_id: detail.asset.id,
      trade_type: 'buy',
      trade_date: detail.asset.buy_date,
      shares: detail.asset.shares,
      price: detail.asset.buy_price,
      fee: 0,
      note: '初始买入',
      created_at: detail.asset.created_at,
    }]
  }

  const buildChartData = (detail: AssetDetail, useSyntheticFallback = true) => {
    const asset = detail.asset
    let base = (detail.history || [])
      .filter(item => item.date && item.price)
      .sort((a, b) => a.date.localeCompare(b.date))

    if (base.length < 2 && !useSyntheticFallback) {
      return []
    }

    if (base.length < 2) {
      const start = dayjs(asset.buy_date || asset.created_at)
      const end = dayjs()
      const calendarDays = Math.max(1, end.diff(start, 'day') || 1)
      const days = Math.max(2, Math.min(60, calendarDays + 1))
      const current = asset.current_price || asset.buy_price
      base = Array.from({ length: days }, (_, i) => {
        const ratio = days === 1 ? 1 : i / (days - 1)
        return {
          date: start.add(Math.round(ratio * calendarDays), 'day').format('YYYY-MM-DD'),
          price: asset.buy_price + (current - asset.buy_price) * ratio,
        }
      })
    }

    const transactions = getDisplayTransactions(detail)
    return base.map(item => {
      const trades = transactions.filter(t => t.trade_date === item.date)
      return {
        ...item,
        netValue: item.price * asset.shares,
        trades,
      }
    })
  }

  const getTradeMarkers = (detail: AssetDetail, chartData: any[]) => {
    const transactions = getDisplayTransactions(detail)
    return transactions.map(t => {
      const sameDay = chartData.find(point => point.date === t.trade_date)
      const fallback = chartData.reduce((nearest, point) => {
        const diff = Math.abs(dayjs(point.date).diff(dayjs(t.trade_date), 'day'))
        const nearestDiff = Math.abs(dayjs(nearest.date).diff(dayjs(t.trade_date), 'day'))
        return diff < nearestDiff ? point : nearest
      }, chartData[0])
      const point = sameDay || fallback
      return {
        ...point,
        trade: t,
        price: point?.price || t.price,
        date: point?.date || t.trade_date,
      }
    }).filter(Boolean)
  }

  const renderTradeMarker = (props: any) => {
    const { cx, cy, payload } = props
    const isBuy = payload?.trade?.trade_type === 'buy'
    return (
      <g>
        <circle cx={cx} cy={cy} r={6} fill={isBuy ? greenStyle.color : redStyle.color} stroke="#111118" strokeWidth={2} />
        <circle cx={cx} cy={cy} r={10} fill={isBuy ? greenStyle.color : redStyle.color} opacity={0.16} />
      </g>
    )
  }

  const renderChartTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const data = payload[0]?.payload || {}
    const marker = payload.find((item: any) => item?.payload?.trade)?.payload?.trade
    const trades = marker ? [marker] : (data.trades || [])
    return (
      <div style={{
        padding: 12,
        borderRadius: 8,
        background: 'rgba(17, 17, 24, 0.96)',
        border: '1px solid rgba(201, 168, 76, 0.24)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        color: '#e8e6e3',
        minWidth: 180,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{label || data.date}</div>
        <div style={{ color: '#9a9892', fontSize: 12 }}>收盘价：{formatMoney(data.price, 3)}</div>
        {data.open !== undefined && <div style={{ color: '#9a9892', fontSize: 12 }}>开盘：{formatMoney(data.open, 3)}</div>}
        {data.high !== undefined && <div style={{ color: '#9a9892', fontSize: 12 }}>最高：{formatMoney(data.high, 3)}</div>}
        {data.low !== undefined && <div style={{ color: '#9a9892', fontSize: 12 }}>最低：{formatMoney(data.low, 3)}</div>}
        <div style={{ color: '#9a9892', fontSize: 12 }}>持仓净值：{formatMoney(data.netValue)}</div>
        {trades.map((trade: AssetTransaction) => (
          <div key={`${trade.id}-${trade.trade_date}`} style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ color: trade.trade_type === 'buy' ? greenStyle.color : redStyle.color, fontWeight: 600 }}>
              {trade.trade_type === 'buy' ? '买入' : '卖出'} {trade.shares.toFixed(2)} 份
            </div>
            <div style={{ color: '#9a9892', fontSize: 12 }}>成交价：{formatMoney(trade.price, 3)} 手续费：{formatMoney(trade.fee)}</div>
            {trade.note && <div style={{ color: '#9a9892', fontSize: 12 }}>{trade.note}</div>}
          </div>
        ))}
      </div>
    )
  }

  const suggestionColor = (s: string) => {
    const m: Record<string, string> = {
      BUY: greenStyle.color, ADD: greenStyle.color,
      HOLD: goldStyle.color,
      REDUCE: redStyle.color, SELL: redStyle.color,
    }
    return m[s] || '#9a9892'
  }

  const suggestionLabel = (s: string) => {
    const m: Record<string, string> = {
      BUY: '买入', ADD: '加仓',
      HOLD: '持有',
      REDUCE: '减仓', SELL: '卖出',
    }
    return m[s] || s
  }

  const renderAnalysisContent = (detail: string) => {
    try {
      const parsed = JSON.parse(detail)
      if (parsed?.asset_code && parsed?.final_suggestion) {
        const s = parsed.final_suggestion
        const color = suggestionColor(s)
        const reportSections = [
          { title: '仓位诊断', value: parsed.position_diagnosis },
          { title: '宏观影响', value: parsed.macro_impact },
          { title: '微观因素', value: parsed.micro_factors },
          { title: '基本面分析', value: parsed.fundamentals_analysis },
          { title: '估值判断', value: parsed.valuation_analysis },
          { title: '技术面走势', value: parsed.technical_analysis },
          { title: '行动计划', value: parsed.action_plan },
          { title: '观察重点', value: parsed.watch_points },
          { title: '风险提示', value: parsed.risk_warning },
          { title: '数据质量', value: parsed.data_quality },
        ].filter(item => item.value)
        return (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <Tag color={color} style={{ borderRadius: 6, border: 'none', color: '#fff', fontWeight: 600, fontSize: 14, padding: '2px 14px' }}>
                {suggestionLabel(s)}
              </Tag>
              <div style={{ color: '#9a9892', fontSize: 12 }}>
                信心指数：<span style={{ color: '#e8e6e3', fontWeight: 500 }}>{parsed.confidence_score ?? '-'}/100</span>
              </div>
              <div style={{ color: '#9a9892', fontSize: 12 }}>
                周期：<span style={{ color: '#e8e6e3', fontWeight: 500 }}>{({ SHORT: '短期', MEDIUM: '中期', LONG: '长期' } as Record<string, string>)[parsed.time_horizon] || parsed.time_horizon || '-'}</span>
              </div>
            </div>

            <div style={{
              padding: 12, borderRadius: 8,
              background: 'rgba(201, 168, 76, 0.06)',
              border: '1px solid rgba(201, 168, 76, 0.12)',
              color: '#cfcac1', fontSize: 13, lineHeight: 1.7,
            }}>
              {parsed.suggested_action || parsed.action_plan || '暂无详细分析'}
            </div>

            {reportSections.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                {reportSections.map(section => (
                  <div key={section.title} style={{
                    padding: 12,
                    borderRadius: 8,
                    background: 'rgba(255,255,255,0.025)',
                    border: '1px solid rgba(255,255,255,0.07)',
                  }}>
                    <div style={{ color: '#e8e6e3', fontWeight: 600, fontSize: 12, marginBottom: 6 }}>
                      {section.title}
                    </div>
                    <div style={{ color: '#b0aea8', fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                      {section.value}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {(parsed.target_price || parsed.stop_loss) ? (
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {parsed.target_price ? (
                  <div style={{
                    padding: '8px 14px', borderRadius: 8,
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    <div style={{ color: '#9a9892', fontSize: 11, marginBottom: 2 }}>目标价</div>
                    <div style={{ color: '#e8e6e3', fontWeight: 600 }}>¥{Number(parsed.target_price).toFixed(3)}</div>
                  </div>
                ) : null}
                {parsed.stop_loss ? (
                  <div style={{
                    padding: '8px 14px', borderRadius: 8,
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    <div style={{ color: '#9a9892', fontSize: 11, marginBottom: 2 }}>止损价</div>
                    <div style={{ color: redStyle.color, fontWeight: 600 }}>¥{Number(parsed.stop_loss).toFixed(3)}</div>
                  </div>
                ) : null}
                {parsed.suggested_quantity ? (
                  <div style={{
                    padding: '8px 14px', borderRadius: 8,
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    <div style={{ color: '#9a9892', fontSize: 11, marginBottom: 2 }}>建议操作份额</div>
                    <div style={{ color: '#e8e6e3', fontWeight: 600 }}>{Number(parsed.suggested_quantity).toFixed(2)}</div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {parsed.summary ? (
              <div style={{
                padding: 10, borderRadius: 6,
                background: 'linear-gradient(135deg, rgba(201, 168, 76, 0.08), rgba(201, 168, 76, 0.02))',
                border: '1px solid rgba(201, 168, 76, 0.1)',
                color: '#b0aea8', fontSize: 12, lineHeight: 1.6,
              }}>
                {parsed.summary}
              </div>
            ) : null}
          </Space>
        )
      }

      if (parsed?.recommendations?.asset_recommendations?.length) {
        return (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <div style={{
              padding: 12, borderRadius: 8,
              background: 'rgba(201, 168, 76, 0.06)',
              border: '1px solid rgba(201, 168, 76, 0.12)',
              color: '#cfcac1', fontSize: 13, lineHeight: 1.7,
            }}>
              {parsed.summary || '分析完成'}
            </div>

            {parsed.macro_analysis ? (
              <div>
                <div style={{ color: '#e8e6e3', fontWeight: 600, marginBottom: 8, fontSize: 13 }}>
                  宏观环境
                </div>
                <div style={{ color: '#9a9892', fontSize: 12, lineHeight: 1.7, padding: '0 2px' }}>
                  {parsed.macro_analysis.global_overview ? (
                    <div style={{ marginBottom: 6 }}>🌍 {parsed.macro_analysis.global_overview}</div>
                  ) : null}
                  {parsed.macro_analysis.china_economy ? (
                    <div style={{ marginBottom: 6 }}>🇨🇳 {parsed.macro_analysis.china_economy}</div>
                  ) : null}
                  {parsed.macro_analysis.impact_assessment ? (
                    <div style={{ marginBottom: 6 }}>📊 {parsed.macro_analysis.impact_assessment}</div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div>
              <div style={{ color: '#e8e6e3', fontWeight: 600, marginBottom: 8, fontSize: 13 }}>
                逐项资产建议
              </div>
              {parsed.recommendations.asset_recommendations.map((r: any, i: number) => (
                <div key={i} style={{
                  padding: 12, borderRadius: 8, marginBottom: 8,
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ color: '#e8e6e3', fontWeight: 500, fontSize: 13 }}>
                      {r.asset_name || r.asset_code}
                    </span>
                    <Tag color={suggestionColor(r.final_suggestion)}
                      style={{ borderRadius: 6, border: 'none', color: '#fff', fontWeight: 500, fontSize: 11, padding: '0 10px' }}>
                      {suggestionLabel(r.final_suggestion)}
                    </Tag>
                  </div>
                  <div style={{ color: '#9a9892', fontSize: 12, lineHeight: 1.6 }}>{r.summary || r.suggested_action}</div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 11, color: '#5c5a55' }}>
                    {r.confidence_score ? <span>信心 {r.confidence_score}/100</span> : null}
                    {r.target_price ? <span>目标 ¥{Number(r.target_price).toFixed(3)}</span> : null}
                    {r.stop_loss ? <span>止损 ¥{Number(r.stop_loss).toFixed(3)}</span> : null}
                  </div>
                </div>
              ))}
            </div>

            {parsed.recommendations.overall_strategy ? (() => {
              const os = parsed.recommendations.overall_strategy
              return (
                <div>
                  <div style={{ color: '#e8e6e3', fontWeight: 600, marginBottom: 8, fontSize: 13 }}>
                    整体策略
                  </div>
                  <div style={{
                    padding: 12, borderRadius: 8,
                    background: 'rgba(201, 168, 76, 0.04)',
                    border: '1px solid rgba(201, 168, 76, 0.1)',
                    color: '#cfcac1', fontSize: 12, lineHeight: 1.7,
                  }}>
                    {os.overall_strategy ? <div style={{ marginBottom: 8 }}>{os.overall_strategy}</div> : null}
                    {os.key_focus ? <div style={{ marginBottom: 8, color: '#9a9892' }}>关注方向：{os.key_focus}</div> : null}
                    {os.suggested_cash_ratio != null ? (
                      <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                        <Tag style={{ borderRadius: 6, border: '1px solid rgba(201,168,76,0.2)', background: 'transparent', color: '#c9a84c' }}>
                          建议仓位 {(100 - os.suggested_cash_ratio).toFixed(0)}%
                        </Tag>
                        <Tag style={{ borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#9a9892' }}>
                          现金比例 {os.suggested_cash_ratio}%
                        </Tag>
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })() : null}
          </Space>
        )
      }

      return <Text style={{ whiteSpace: 'pre-wrap', color: '#cfcac1', lineHeight: 1.7 }}>{detail}</Text>
    } catch {
      return <Text style={{ whiteSpace: 'pre-wrap', color: '#cfcac1', lineHeight: 1.7 }}>{detail}</Text>
    }
  }

  return (
    <div className="page-enter">
      <Card
        styles={{ body: { padding: 0 } }}
        style={{ overflow: 'hidden' }}
        title={
          <Space>
            <StockOutlined style={goldStyle} />
            <span>我的资产</span>
          </Space>
        }
        extra={
          <Space>
            <Text style={{ color: '#9a9892', fontSize: 12 }}>时间段</Text>
            <NetValueRangeSelector value={assetListPeriod} onChange={setAssetListPeriod} />
            <Button
              icon={<ThunderboltOutlined />}
              onClick={handleAnalyzeAll}
              loading={aiCtx.state.isRunning}
              size="small"
              style={{ borderRadius: 10, fontSize: 13 }}
            >
              {aiCtx.state.isRunning ? '分析中...' : 'AI 全面分析'}
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={refreshPrices}
              loading={refreshing}
              size="small"
              style={{ borderRadius: 10, fontSize: 13 }}
            >
              刷新行情
            </Button>
            <Radio.Group
              options={groupOptions}
              value={groupBy}
              onChange={e => setGroupBy(e.target.value)}
              optionType="button"
              buttonStyle="solid"
              size="small"
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={openAddModal}
              style={{ borderRadius: 10, height: 36, fontSize: 13, fontWeight: 500 }}
            >
              添加资产
            </Button>
          </Space>
        }
      >
        <div style={{ padding: 16 }}>
          {groupBy === 'type' ? (
            <Table
              dataSource={assets}
              columns={columns}
              pagination={{
                pageSize: 20,
                showSizeChanger: true,
                showTotal: t => `共 ${t} 条`,
                size: 'small',
              }}
              {...tableProps}
            />
          ) : (
            Object.entries(groupedData()).map(([group, items], index, groups) => (
              <div
                key={group}
                style={{
                  marginBottom: index === groups.length - 1 ? 0 : 32,
                  padding: 16,
                  borderRadius: 12,
                  background: 'rgba(17, 17, 24, 0.42)',
                  border: '1px solid rgba(201, 168, 76, 0.12)',
                  boxShadow: '0 10px 24px rgba(0,0,0,0.12)',
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  marginBottom: 12,
                  borderRadius: 10,
                  background: 'rgba(201, 168, 76, 0.07)',
                  border: '1px solid rgba(201, 168, 76, 0.14)',
                }}>
                  <span style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: '#c9a84c',
                  }} />
                  <span style={{ fontWeight: 600, color: '#e8e6e3', fontSize: 14 }}>{group}</span>
                  <span style={{ color: '#5c5a55', fontSize: 12 }}>共 {items.length} 项</span>
                </div>
                <Table
                  dataSource={items}
                  columns={columns}
                  pagination={false}
                  {...tableProps}
                />
              </div>
            ))
          )}
        </div>
      </Card>

      <Modal
        title={
          <Space>
            <span style={{ fontSize: 18 }}>{editingAsset ? '✏️' : '➕'}</span>
            <span>{editingAsset ? '编辑资产' : '添加资产'}</span>
          </Space>
        }
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        width={640}
        destroyOnClose
        okText={editingAsset ? '保存' : '添加'}
        cancelText="取消"
        okButtonProps={{ style: { borderRadius: 10, fontWeight: 500 } }}
        cancelButtonProps={{ style: { borderRadius: 10 } }}
        styles={{ body: { paddingTop: 24 } }}
      >
        <Form form={form} layout="vertical" size="large" onValuesChange={(changed) => {
          if ('name' in changed && (changed.name || '').trim() !== lastAutoNameRef.current) {
            lastAutoNameRef.current = null
          }
          if ('code' in changed || 'market' in changed || 'asset_type' in changed) {
            scheduleLookup()
          }
        }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="asset_type" label="资产类型" rules={[{ required: true, message: '请选择资产类型' }]}>
                <Select options={assetTypeOptions} placeholder="选择资产类型" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="market" label="市场" rules={[{ required: true, message: '请选择市场' }]}>
                <Select options={marketOptions} placeholder="选择市场" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="platform" label="购买平台" rules={[{ required: true, message: '请输入购买平台' }]}>
                <AutoComplete options={platformOptions} placeholder="选择或输入购买平台" filterOption={(inputValue, option) => option!.value.toUpperCase().includes(inputValue.toUpperCase())} allowClear />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="code" label="代码" rules={[{ required: true, message: '请输入代码' }]}>
                <Input
                  placeholder="如：000001、AAPL"
                  onBlur={(e) => handleLookupName(e.target.value)}
                  suffix={
                    <SearchOutlined
                      style={{ color: '#9a9892', cursor: 'pointer' }}
                      onClick={() => handleLookupName()}
                    />
                  }
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="name"
            label={<Space size={4}>名称 {lookupLoading && <span style={{ color: '#9a9892', fontSize: 12 }}>查询中...</span>}</Space>}
            dependencies={['code', 'market', 'asset_type']}
          >
            <Input
              placeholder="资产名称（可选，输入代码后自动查询）"
              style={lookupLoading ? { opacity: 0.6 } : {}}
            />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="shares" label="买入份额" rules={[{ required: true, message: '请输入买入份额' }]}>
                <InputNumber style={{ width: '100%' }} min={0} step={0.01} placeholder="份额" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="buy_price" label="买入单价 (¥)" rules={[{ required: true, message: '请输入买入单价' }]}>
                <InputNumber style={{ width: '100%' }} min={0} step={0.001} placeholder="单价" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="buy_date" label="买入日期">
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" placeholder="选择买入日期" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} placeholder="备注信息（可选）" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={
          <Space>
            <EyeOutlined style={goldStyle} />
            <span>{selectedAsset?.name || selectedAsset?.code || '资产详情'}</span>
            {selectedAsset?.code && <Tag style={{ borderRadius: 6, background: 'transparent', color: '#9a9892', borderColor: 'rgba(255,255,255,0.12)' }}>{selectedAsset.code}</Tag>}
          </Space>
        }
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={1120}
        destroyOnClose
        styles={{ body: { paddingTop: 18, maxHeight: '78vh', overflow: 'auto' } }}
      >
        {detailLoading && !assetDetail ? (
          <div style={{ height: 360, display: 'grid', placeItems: 'center' }}>
            <Spin />
          </div>
        ) : assetDetail ? (() => {
          const hasRealHistory = (assetDetail.history || []).length >= 2
          const chartData = buildChartData(assetDetail, true)
          const markers = chartData.length > 0 ? getTradeMarkers(assetDetail, chartData) : []
          const asset = assetDetail.asset
          const effectivePrice = asset.current_price != null && asset.current_price > 0 ? asset.current_price : asset.buy_price
          const marketValue = asset.shares * effectivePrice
          const pnl = asset.shares * (effectivePrice - asset.buy_price)
          const pnlPct = asset.buy_price ? (effectivePrice - asset.buy_price) / asset.buy_price * 100 : 0
          const panelStyle = {
            border: '1px solid rgba(201, 168, 76, 0.12)',
            borderRadius: 8,
            padding: 16,
            background: 'rgba(17, 17, 24, 0.52)',
          }
          const isFundAsset = asset.asset_type.includes('fund')
          const fundamentalKeys = isFundAsset ? fundFundamentalKeys : stockFundamentalKeys
          const fundDividends = Array.isArray(assetDetail.fundamentals.fund_dividends)
            ? assetDetail.fundamentals.fund_dividends as Array<{ date: string; amount: number; unit?: string }>
            : []

          return (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Row gutter={[12, 12]}>
                {[
                  ['当前市值', formatMoney(marketValue)],
                  ['持仓份额', asset.shares.toFixed(2)],
                  ['持仓成本', formatMoney(asset.buy_price, 4)],
                  ['浮动盈亏', `${pnl >= 0 ? '+' : ''}${formatMoney(pnl)} / ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`],
                ].map(([label, value]) => (
                  <Col xs={12} md={6} key={label}>
                    <div style={panelStyle}>
                      <div style={{ color: '#9a9892', fontSize: 12, marginBottom: 6 }}>{label}</div>
                      <div style={{ color: label === '浮动盈亏' ? (pnl >= 0 ? greenStyle.color : redStyle.color) : '#e8e6e3', fontSize: 18, fontWeight: 700 }}>{value}</div>
                    </div>
                  </Col>
                ))}
              </Row>

              <Tabs
                defaultActiveKey="overview"
                items={[
                  {
                    key: 'overview',
                    label: '详情',
                    children: (
                      <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <div style={panelStyle}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                            <Space>
                              <StockOutlined style={goldStyle} />
                              <Text strong style={{ color: '#e8e6e3' }}>净值曲线</Text>
                            </Space>
                            <Space wrap>
                              <Text style={{ color: '#9a9892', fontSize: 12 }}>时间段</Text>
                              <NetValueRangeSelector value={detailPeriod} onChange={setDetailPeriod} />
                              <Button icon={<PlusCircleOutlined />} type="primary" onClick={openTransactionModal} style={{ borderRadius: 10 }}>
                                添加交易记录
                              </Button>
                            </Space>
                          </div>
                          <div style={{ height: 360, position: 'relative' }}>
                            {chartData.length >= 2 ? (
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={chartData} margin={{ top: 16, right: 24, left: 0, bottom: 8 }}>
                                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                                  <XAxis dataKey="date" stroke="#5c5a55" tick={{ fontSize: 11 }} minTickGap={28} />
                                  <YAxis stroke="#5c5a55" tick={{ fontSize: 11 }} width={58} tickFormatter={(v) => Number(v).toFixed(2)} domain={['auto', 'auto']} />
                                  <ChartTooltip content={renderChartTooltip} />
                                  <Line type="monotone" dataKey="price" stroke="#c9a84c" strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: '#111118', strokeWidth: 2 }} />
                                  <Scatter data={markers} dataKey="price" shape={renderTradeMarker} />
                                </LineChart>
                              </ResponsiveContainer>
                            ) : (
                              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该时间段暂无可用净值数据" style={{ paddingTop: 96 }} />
                            )}
                            {detailHistoryLoading && (
                              <div style={{
                                position: 'absolute',
                                top: 8,
                                right: 8,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '4px 8px',
                                borderRadius: 8,
                                background: 'rgba(17, 17, 24, 0.82)',
                                border: '1px solid rgba(201,168,76,0.12)',
                                color: '#9a9892',
                                fontSize: 12,
                              }}>
                                <Spin size="small" />
                                {hasRealHistory ? '更新中' : '加载真实走势'}
                              </div>
                            )}
                          </div>
                        </div>

                        <Row gutter={[16, 16]}>
                          <Col xs={24} lg={12}>
                            <div style={panelStyle}>
                              <Text strong style={{ color: '#e8e6e3' }}>{isFundAsset ? '基金信息' : '基本面数据'}</Text>
                              <Divider style={{ margin: '12px 0', borderColor: 'rgba(255,255,255,0.08)' }} />
                              {detailFundamentalsLoading ? (
                                <div style={{ minHeight: 120, display: 'grid', placeItems: 'center' }}>
                                  <Spin />
                                </div>
                              ) : Object.keys(assetDetail.fundamentals || {}).length === 0 ? (
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={isFundAsset ? '暂无基金信息' : '暂无基本面数据'} />
                              ) : (
                                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                  <Descriptions column={2} size="small">
                                    {fundamentalKeys
                                    .filter(key => assetDetail.fundamentals[key] !== undefined && assetDetail.fundamentals[key] !== null)
                                    .map(key => (
                                      <Descriptions.Item key={key} label={fundamentalLabels[key]}>
                                        <span style={{ color: '#e8e6e3' }}>{formatFundamentalValue(key, assetDetail.fundamentals[key])}</span>
                                      </Descriptions.Item>
                                    ))}
                                  </Descriptions>
                                  {isFundAsset && fundDividends.length > 0 && (
                                    <div>
                                      <Text style={{ color: '#9a9892', fontSize: 12 }}>分红记录</Text>
                                      <Table<{ date: string; amount: number; unit?: string }>
                                        rowKey={(record: { date: string; amount: number }) => `${record.date}-${record.amount}`}
                                        dataSource={fundDividends}
                                        pagination={false}
                                        size="small"
                                        style={{ marginTop: 8 }}
                                        columns={[
                                          { title: '日期', dataIndex: 'date', key: 'date', width: 120 },
                                          { title: '分红', key: 'amount', render: (_: any, r: { amount: number; unit?: string }) => `${r.amount.toFixed(4)} ${r.unit || '元/份'}` },
                                        ]}
                                      />
                                    </div>
                                  )}
                                </Space>
                              )}
                            </div>
                          </Col>
                          <Col xs={24} lg={12}>
                            <div style={panelStyle}>
                              <Text strong style={{ color: '#e8e6e3' }}>基础信息</Text>
                              <Divider style={{ margin: '12px 0', borderColor: 'rgba(255,255,255,0.08)' }} />
                              <Descriptions column={2} size="small">
                                <Descriptions.Item label="类型">{assetTypeMap[asset.asset_type] || asset.asset_type}</Descriptions.Item>
                                <Descriptions.Item label="市场">{asset.market}</Descriptions.Item>
                                <Descriptions.Item label="平台">{asset.platform || '-'}</Descriptions.Item>
                                <Descriptions.Item label="买入日期">{asset.buy_date || '-'}</Descriptions.Item>
                                <Descriptions.Item label="当前价">{asset.current_price ? formatMoney(asset.current_price, 3) : '-'}</Descriptions.Item>
                                <Descriptions.Item label="更新时间">{asset.price_updated_at || '-'}</Descriptions.Item>
                                <Descriptions.Item label="备注" span={2}>{asset.note || '-'}</Descriptions.Item>
                              </Descriptions>
                            </div>
                          </Col>
                        </Row>
                      </Space>
                    ),
                  },
                  {
                    key: 'analysis',
                    label: 'AI 分析',
                    children: (
                      <div style={panelStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                          <Space>
                            <FileTextOutlined style={goldStyle} />
                            <Text strong style={{ color: '#e8e6e3' }}>最近一次 AI 分析报告</Text>
                          </Space>
                          <Button onClick={handleRunAssetAnalysis} loading={aiCtx.state.isRunning} icon={<ReloadOutlined />} style={{ borderRadius: 10 }}>
                            更新分析
                          </Button>
                        </div>
                        {assetDetail.latest_analysis ? (
                          <Space direction="vertical" size={12} style={{ width: '100%' }}>
                            <div style={{ color: '#9a9892', fontSize: 12 }}>
                              {dayjs(assetDetail.latest_analysis.created_at).format('YYYY-MM-DD HH:mm')}
                            </div>
                            <Text strong style={{ color: '#e8e6e3' }}>{assetDetail.latest_analysis.summary}</Text>
                            <Divider style={{ margin: '4px 0', borderColor: 'rgba(255,255,255,0.08)' }} />
                            {renderAnalysisContent(assetDetail.latest_analysis.detail)}
                          </Space>
                        ) : (
                          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无该资产的 AI 分析报告">
                            <Button type="primary" onClick={handleRunAssetAnalysis} loading={aiCtx.state.isRunning} icon={<FileTextOutlined />} style={{ borderRadius: 10 }}>
                              生成分析报告
                            </Button>
                          </Empty>
                        )}
                      </div>
                    ),
                  },
                  {
                    key: 'transactions',
                    label: '交易记录',
                    children: (
                      <div style={panelStyle}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                          <Text strong style={{ color: '#e8e6e3' }}>交易记录</Text>
                          <Button type="primary" icon={<PlusCircleOutlined />} onClick={openTransactionModal} style={{ borderRadius: 10 }}>
                            添加交易记录
                          </Button>
                        </div>
                        <Table
                          rowKey={(record) => `${record.id}-${record.trade_date}`}
                          dataSource={[...getDisplayTransactions(assetDetail)].sort((a, b) => b.trade_date.localeCompare(a.trade_date))}
                          pagination={false}
                          size="small"
                          columns={[
                            { title: '日期', dataIndex: 'trade_date', key: 'trade_date', width: 110 },
                            { title: '类型', dataIndex: 'trade_type', key: 'trade_type', width: 90, render: renderTradeType },
                            { title: '份额', dataIndex: 'shares', key: 'shares', render: (v: number) => v.toFixed(2) },
                            { title: '价格', dataIndex: 'price', key: 'price', render: (v: number) => formatMoney(v, 3) },
                            { title: '手续费', dataIndex: 'fee', key: 'fee', render: (v: number) => formatMoney(v) },
                            { title: '金额', key: 'amount', render: (_: any, r: AssetTransaction) => formatMoney(r.shares * r.price + (r.trade_type === 'buy' ? r.fee : -r.fee)) },
                            { title: '备注', dataIndex: 'note', key: 'note', ellipsis: true, render: (v: string) => v || '-' },
                          ]}
                        />
                      </div>
                    ),
                  },
                ]}
              />
            </Space>
          )
        })() : null}
      </Modal>

      <Modal
        title={
          <Space>
            <PlusCircleOutlined style={goldStyle} />
            <span>添加交易记录</span>
          </Space>
        }
        open={transactionModalOpen}
        onCancel={() => setTransactionModalOpen(false)}
        onOk={handleTransactionSubmit}
        confirmLoading={savingTransaction}
        okText="保存"
        cancelText="取消"
        width={560}
        destroyOnClose
        okButtonProps={{ style: { borderRadius: 10, fontWeight: 500 } }}
        cancelButtonProps={{ style: { borderRadius: 10 } }}
      >
        <Form form={tradeForm} layout="vertical" size="large">
          <Form.Item name="trade_type" label="交易类型" rules={[{ required: true, message: '请选择交易类型' }]}>
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              options={[
                { label: '买入', value: 'buy' },
                { label: '卖出', value: 'sell' },
              ]}
            />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="trade_date" label="交易日期" rules={[{ required: true, message: '请选择交易日期' }]}>
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="shares" label="交易份额" rules={[{ required: true, message: '请输入交易份额' }]}>
                <InputNumber style={{ width: '100%' }} min={0.0001} step={0.01} placeholder="份额" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="price" label="成交价格 (¥)" rules={[{ required: true, message: '请输入成交价格' }]}>
                <InputNumber style={{ width: '100%' }} min={0.0001} step={0.001} placeholder="价格" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="fee" label="手续费 (¥)">
                <InputNumber style={{ width: '100%' }} min={0} step={0.01} placeholder="手续费" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} placeholder="交易备注（可选）" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
