import { useState, useEffect, useCallback } from 'react'
import {
  Card, Table, Button, Modal, Form, Input, InputNumber, Space,
  Tag, message, Row, Col, Radio, Popconfirm, Typography, DatePicker,
  Select, AutoComplete, Tooltip, Descriptions, Empty, Tabs, Divider, Spin
} from 'antd'
import dayjs from 'dayjs'
import {
  PlusOutlined, EditOutlined, DeleteOutlined,
  AppstoreOutlined, BankOutlined, StockOutlined, SearchOutlined, ReloadOutlined,
  EyeOutlined, PlusCircleOutlined, FileTextOutlined
} from '@ant-design/icons'
import {
  AreaChart, Area, ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip as ChartTooltip, Scatter
} from 'recharts'
import {
  assetsApi, marketApi, analysisApi, Asset, AssetDetail,
  AssetTransaction, MarketFundamentals, MarketHistoryItem
} from '../api'

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

export default function Assets() {
  const [assets, setAssets] = useState<Asset[]>([])
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
  const [transactionModalOpen, setTransactionModalOpen] = useState(false)
  const [savingTransaction, setSavingTransaction] = useState(false)
  const [aiAnalyzing, setAiAnalyzing] = useState(false)

  const fetchPriceHistory = useCallback(async (assets: Asset[]) => {
    const results: Record<number, MarketHistoryItem[]> = {}
    await Promise.allSettled(assets.map(async (a) => {
      try {
        const data = await marketApi.history(a.code, a.market, a.asset_type)
        if (data.history.length > 0) {
          results[a.id] = data.history
        }
      } catch (e) {
        // silent
      }
    }))
    setPriceHistory(results)
  }, [])

  const fetchAssets = async () => {
    setLoading(true)
    try {
      const data = await assetsApi.list()
      setAssets(data)
      return data
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
      setAssets(data)
      await fetchPriceHistory(data)
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '刷新行情失败')
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    const init = async () => {
      const data = await fetchAssets()
      if (data && data.length > 0) {
        await refreshPrices()
      }
    }
    init()
  }, [])

  const openAddModal = () => {
    setEditingAsset(null)
    form.resetFields()
    setModalOpen(true)
  }

  const openEditModal = (asset: Asset) => {
    setEditingAsset(asset)
    form.setFieldsValue({ ...asset, buy_date: asset.buy_date ? dayjs(asset.buy_date) : null })
    setModalOpen(true)
  }

  const [lookupLoading, setLookupLoading] = useState(false)
  const [priceHistory, setPriceHistory] = useState<Record<number, MarketHistoryItem[]>>({})

  const handleLookupName = async (code?: string) => {
    const values = form.getFieldsValue()
    const c = code || values.code
    if (!c || values.name) return
    const market = values.market
    const assetType = values.asset_type
    if (!market || !assetType) return
    setLookupLoading(true)
    try {
      const result = await marketApi.lookup(c.trim().toUpperCase(), market, assetType)
      if (result.name) {
        form.setFieldsValue({ name: result.name })
      }
    } catch (e) {
      // silent
    } finally {
      setLookupLoading(false)
    }
  }

  const [lookupTimer, setLookupTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  const scheduleLookup = () => {
    if (lookupTimer) clearTimeout(lookupTimer)
    if (editingAsset) return
    const code = form.getFieldValue('code')
    const market = form.getFieldValue('market')
    const assetType = form.getFieldValue('asset_type')
    const name = form.getFieldValue('name')
    if (code && market && assetType && !name) {
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
    fetchAssets()
  }

  const loadAssetDetail = async (asset: Asset) => {
    setDetailLoading(true)
    try {
      const detail = await assetsApi.detail(asset.id)
      setAssetDetail(detail)
      setSelectedAsset(detail.asset)
      return detail
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
    setAssetDetail(null)
    setDetailOpen(true)
    await loadAssetDetail(asset)
  }

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
    setAiAnalyzing(true)
    try {
      await analysisApi.agentRun({
        asset_ids: [asset.id],
        goal: `请针对 ${asset.name || asset.code} 这一项资产生成详细分析报告，覆盖基本面、技术面交易策略、具体交易建议、宏观信息和微观信息。`,
      })
      message.success('AI 分析报告已更新')
      await loadAssetDetail(asset)
    } catch (e: any) {
      message.error(e?.response?.data?.detail || 'AI 分析失败')
    } finally {
      setAiAnalyzing(false)
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
      title: '买入单价', dataIndex: 'buy_price', key: 'buy_price', width: 90,
      render: (v: number) => <span style={{ color: '#9a9892' }}>¥{v.toFixed(3)}</span>,
    },
    {
      title: '当前价', dataIndex: 'current_price', key: 'current_price', width: 85,
      render: (v: number) => v ? <span style={{ color: '#9a9892' }}>¥{v.toFixed(3)}</span> : <span style={{ color: '#5c5a55' }}>-</span>,
    },
    {
      title: '当前市值', key: 'market_value', width: 100,
      render: (_: any, r: Asset) => {
        if (!r.current_price) return <span style={{ color: '#5c5a55' }}>-</span>
        const mv = r.shares * r.current_price
        return <span style={{ fontWeight: 500, color: '#e8e6e3' }}>¥{mv.toFixed(2)}</span>
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
        if (!r.current_price) return <span style={{ color: '#5c5a55' }}>暂无数据</span>
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
          if (!r.current_price) return <span style={{ color: '#5c5a55' }}>-</span>
          data = Array.from({ length: 20 }, (_, i) => ({
            date: '',
            price: r.buy_price + (r.current_price - r.buy_price) * (i + 1) / 20,
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

  const buildChartData = (detail: AssetDetail) => {
    const asset = detail.asset
    let base = (detail.history || [])
      .filter(item => item.date && item.price)
      .sort((a, b) => a.date.localeCompare(b.date))

    if (base.length < 2) {
      const start = dayjs(asset.buy_date || asset.created_at)
      const end = dayjs()
      const days = Math.max(14, Math.min(60, end.diff(start, 'day') || 14))
      const current = asset.current_price || asset.buy_price
      base = Array.from({ length: days }, (_, i) => {
        const ratio = days === 1 ? 1 : i / (days - 1)
        return {
          date: start.add(i, 'day').format('YYYY-MM-DD'),
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

  const renderAnalysisContent = (detail: string) => {
    try {
      const parsed = JSON.parse(detail)
      return (
        <pre style={{
          whiteSpace: 'pre-wrap',
          margin: 0,
          color: '#cfcac1',
          fontSize: 12,
          lineHeight: 1.7,
          maxHeight: 360,
          overflow: 'auto',
        }}>
          {JSON.stringify(parsed, null, 2)}
        </pre>
      )
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
            Object.entries(groupedData()).map(([group, items]) => (
              <div key={group} style={{ marginBottom: 24 }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  marginBottom: 8,
                  borderRadius: 10,
                  background: 'rgba(201, 168, 76, 0.04)',
                  border: '1px solid rgba(201, 168, 76, 0.08)',
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
          const chartData = buildChartData(assetDetail)
          const markers = getTradeMarkers(assetDetail, chartData)
          const asset = assetDetail.asset
          const marketValue = asset.shares * (asset.current_price || asset.buy_price)
          const pnl = asset.shares * ((asset.current_price || asset.buy_price) - asset.buy_price)
          const pnlPct = asset.buy_price ? ((asset.current_price || asset.buy_price) - asset.buy_price) / asset.buy_price * 100 : 0
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
                  ['持仓成本', formatMoney(asset.buy_price, 3)],
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
                            <Button icon={<PlusCircleOutlined />} type="primary" onClick={openTransactionModal} style={{ borderRadius: 10 }}>
                              添加交易记录
                            </Button>
                          </div>
                          <div style={{ height: 360 }}>
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
                          </div>
                        </div>

                        <Row gutter={[16, 16]}>
                          <Col xs={24} lg={12}>
                            <div style={panelStyle}>
                              <Text strong style={{ color: '#e8e6e3' }}>{isFundAsset ? '基金信息' : '基本面数据'}</Text>
                              <Divider style={{ margin: '12px 0', borderColor: 'rgba(255,255,255,0.08)' }} />
                              {Object.keys(assetDetail.fundamentals || {}).length === 0 ? (
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
                          <Button onClick={handleRunAssetAnalysis} loading={aiAnalyzing} icon={<ReloadOutlined />} style={{ borderRadius: 10 }}>
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
                            <Button type="primary" onClick={handleRunAssetAnalysis} loading={aiAnalyzing} icon={<FileTextOutlined />} style={{ borderRadius: 10 }}>
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
