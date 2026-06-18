import { useState, useEffect, useRef, useCallback } from 'react'
import { useAIWorkContext } from '../stores/AIWorkContext'
import { Button, Card, Col, DatePicker, Empty, Form, Input, InputNumber, message, Modal, Row, Space, Spin, Tag, Tooltip, Typography, Progress, Descriptions, Radio } from 'antd'
import dayjs from 'dayjs'
import {
  CheckOutlined, CloseOutlined, DollarOutlined, RobotOutlined,
  ThunderboltOutlined, WalletOutlined, ReloadOutlined, BarChartOutlined, FundOutlined,
  RocketOutlined,
} from '@ant-design/icons'
import { investmentAdviceApi, ipoApi, InvestmentAdviceItem, InvestmentAdviceResponse, IPOInvestmentAdviceItem, IPOTradeRecord, marketApi, MarketHistoryItem, transformMarketHistory, type AssetScope, type AssetSource } from '../api'
import { type NetValuePeriod, NetValueRangeSelector, PriceLineChart } from '../components/MarketCharts'

const { Text } = Typography

const goldStyle = { color: '#c9a84c' }
const greenStyle = { color: 'oklch(72% 0.14 145)' }
const redStyle = { color: 'oklch(65% 0.18 25)' }

const formatAmount = (value: number, currency?: string) => {
  const symbol = currency === 'HKD' ? 'HK$' : currency === 'USD' ? '$' : '¥'
  if (Math.abs(value || 0) >= 10000) {
    return `${symbol}${(value / 10000).toFixed(2)}万`
  }
  return `${symbol}${Number(value || 0).toFixed(2)}`
}

const percentOf = (used: number, total: number) => {
  if (total <= 0) return 0
  return Math.min(100, Math.round((used / total) * 100))
}

const assetScopeOptions = [
  { label: '全部资产', value: 'all' },
  { label: '手动资产', value: 'manual' },
  { label: 'AI 建仓', value: 'ai_advice' },
]

const assetScopeLabel = (scope?: string) => {
  if (scope === 'manual') return '手动资产'
  if (scope === 'ai_advice') return 'AI 建仓资产'
  return '全部资产'
}

const adviceAssetSource = (item?: Partial<InvestmentAdviceItem> | null, fallbackScope?: string): AssetSource => {
  if (item?.asset_source === 'manual' || item?.asset_source === 'ai_advice') return item.asset_source
  if (fallbackScope === 'manual' || fallbackScope === 'ai_advice') return fallbackScope
  return item?.source === 'holding' ? 'manual' : 'ai_advice'
}

const adviceAssetSourceLabel = (item?: Partial<InvestmentAdviceItem> | null, fallbackScope?: string) => (
  item?.asset_source_label || assetScopeLabel(adviceAssetSource(item, fallbackScope))
)

const ipoDecisionColor = (decision?: string) => {
  if (decision === 'SUBSCRIBE') return '#40d280'
  if (decision === 'WATCH') return '#c9a84c'
  return '#ff4d4f'
}

const formatSignedPercent = (value?: number | null) => {
  const num = Number(value || 0)
  return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`
}

const ipoTradeMatchesAdvice = (trade: IPOTradeRecord, item: IPOInvestmentAdviceItem) => {
  const tradeIpoId = String(trade.ipo_id || '').trim()
  const itemIpoId = String(item.ipo_id || '').trim()
  if (tradeIpoId && itemIpoId && tradeIpoId === itemIpoId) return true

  const sameMarket = String(trade.market || '').toUpperCase() === String(item.market || '').toUpperCase()
  const sameCode = String(trade.code || '').toUpperCase() === String(item.code || '').toUpperCase()
  const tradePlatform = String(trade.platform || '').trim()
  const itemPlatform = String(item.platform || '').trim()
  const samePlatform = !tradePlatform || !itemPlatform || tradePlatform === itemPlatform
  return sameMarket && sameCode && samePlatform
}

const ipoTradeMatchesTrade = (trade: IPOTradeRecord, base: IPOTradeRecord) => {
  const tradeIpoId = String(trade.ipo_id || '').trim()
  const baseIpoId = String(base.ipo_id || '').trim()
  if (tradeIpoId && baseIpoId && tradeIpoId === baseIpoId) return true

  const sameMarket = String(trade.market || '').toUpperCase() === String(base.market || '').toUpperCase()
  const sameCode = String(trade.code || '').toUpperCase() === String(base.code || '').toUpperCase()
  const tradePlatform = String(trade.platform || '').trim()
  const basePlatform = String(base.platform || '').trim()
  const samePlatform = !tradePlatform || !basePlatform || tradePlatform === basePlatform
  return sameMarket && sameCode && samePlatform
}

type IpoAdviceTradeType = 'APPLY' | 'SUBSCRIBE' | 'NO_WIN' | 'SELL'
type IpoAdviceStatus = 'applied' | 'won' | 'missed' | 'sold'

const ipoTradeTypeLabel: Record<IpoAdviceTradeType, string> = {
  APPLY: '记录申购',
  SUBSCRIBE: '确认中签',
  NO_WIN: '记录未中签',
  SELL: '记录新股卖出',
}

const ipoTradeDateLabel: Record<IpoAdviceTradeType, string> = {
  APPLY: '申购日期',
  SUBSCRIBE: '中签确认日期',
  NO_WIN: '确认日期',
  SELL: '卖出日期',
}

const ipoTradePriceLabel: Record<IpoAdviceTradeType, string> = {
  APPLY: '参考价',
  SUBSCRIBE: '中签成本价',
  NO_WIN: '价格',
  SELL: '成交价',
}

const currencyLabel = (currency?: string) => {
  if (currency === 'HKD') return '港元'
  if (currency === 'USD') return '美元'
  return '人民币'
}

const ipoAdviceFromApplyRecord = (record: IPOTradeRecord): IPOInvestmentAdviceItem => {
  const snapshot = (record.advice_snapshot || {}) as Partial<IPOInvestmentAdviceItem>
  const currency = record.currency || snapshot.currency || 'CNY'
  const suggestedShares = Number(record.shares || snapshot.suggested_shares || snapshot.lot_size || 1)
  const suggestedPrice = Number(record.price || snapshot.suggested_price || snapshot.issue_price || 0)
  return {
    id: `ipo-follow-up-${record.id}`,
    ipo_id: record.ipo_id || snapshot.ipo_id || '',
    market: record.market || snapshot.market || '',
    market_label: snapshot.market_label || String(record.market || ''),
    code: record.code || snapshot.code || '',
    name: record.name || snapshot.name || record.code || '',
    decision: 'SUBSCRIBE',
    decision_label: '待确认中签',
    suggested_shares: suggestedShares,
    suggested_price: suggestedPrice,
    estimated_amount: suggestedShares * suggestedPrice,
    currency,
    currency_label: snapshot.currency_label || currencyLabel(currency),
    platform: record.platform || snapshot.platform || '',
    win_probability: Number(snapshot.win_probability || 0),
    expected_profit_pct: Number(snapshot.expected_profit_pct || 0),
    expected_profit_range: snapshot.expected_profit_range || '',
    confidence_score: Number(snapshot.confidence_score || 0),
    reason: snapshot.reason || record.note || '',
    sell_timing: snapshot.sell_timing || '',
    take_profit: snapshot.take_profit || '',
    stop_loss: snapshot.stop_loss || '',
    evidence: snapshot.evidence || [],
    risk_note: snapshot.risk_note || '',
    key_reasons: snapshot.key_reasons || [],
    comment_insights: snapshot.comment_insights || [],
    risk_flags: snapshot.risk_flags || [],
    apply_date: snapshot.apply_date || record.trade_date || '',
    listing_date: snapshot.listing_date || '',
    follow_up_date: record.follow_up_date || snapshot.follow_up_date || '',
    issue_price: snapshot.issue_price ?? suggestedPrice,
    price_range: snapshot.price_range || '',
    lot_size: snapshot.lot_size || suggestedShares,
    source_label: snapshot.source_label || '',
    source_url: snapshot.source_url || '',
    analysis_snapshot: record.analysis_snapshot || snapshot.analysis_snapshot || {},
    generated_at: snapshot.generated_at || '',
  }
}

const buildPendingIpoFollowUps = (trades: IPOTradeRecord[]) => (
  trades
    .filter(trade => trade.trade_type === 'APPLY')
    .filter(applyTrade => !trades.some(trade => (
      ipoTradeMatchesTrade(trade, applyTrade)
      && ['SUBSCRIBE', 'NO_WIN'].includes(trade.trade_type)
    )))
    .map(ipoAdviceFromApplyRecord)
)

export default function InvestmentAdvice() {
  const aiCtx = useAIWorkContext()
  const [initialLoading, setInitialLoading] = useState(true)
  const [acceptingId, setAcceptingId] = useState<string | null>(null)
  const [result, setResult] = useState<InvestmentAdviceResponse | null>(null)
  const [statuses, setStatuses] = useState<Record<string, 'accepted' | 'dismissed'>>({})
  const [ipoStatuses, setIpoStatuses] = useState<Record<string, IpoAdviceStatus>>({})
  const [pendingIpoFollowUps, setPendingIpoFollowUps] = useState<IPOInvestmentAdviceItem[]>([])
  const [budgetStatus, setBudgetStatus] = useState<any[]>([])
  const [ipoTradeForm] = Form.useForm()
  const [ipoTradeModal, setIpoTradeModal] = useState<{ open: boolean; item: IPOInvestmentAdviceItem | null; tradeType: IpoAdviceTradeType }>({
    open: false,
    item: null,
    tradeType: 'APPLY',
  })
  const [recordingIpoTrade, setRecordingIpoTrade] = useState(false)
  const [assetScope, setAssetScope] = useState<AssetScope>(() => {
    const saved = localStorage.getItem('investment_advice_asset_scope') as AssetScope | null
    return saved === 'manual' || saved === 'ai_advice' || saved === 'all' ? saved : 'all'
  })
  const timerRef = useRef<ReturnType<typeof setInterval>>()

  // Load budget status independently & periodically
  const loadBudgetStatus = useCallback(async () => {
    try {
      const data = await investmentAdviceApi.budgetStatus()
      setBudgetStatus(data)
    } catch {
      // Budget not configured yet
    }
  }, [])

  // Load latest advice on mount
  useEffect(() => {
    (async () => {
      try {
        const data = await investmentAdviceApi.latest()
        setResult(data)
        if (data.budget_status) {
          setBudgetStatus(data.budget_status)
        }
      } catch {
        // no history data
      } finally {
        setInitialLoading(false)
      }
    })()
  }, [])

  // Periodically refresh budget status
  useEffect(() => {
    loadBudgetStatus()
    timerRef.current = setInterval(loadBudgetStatus, 30000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [loadBudgetStatus])

  // Refresh budget status after accept/reset
  const refreshBudget = () => {
    loadBudgetStatus()
    investmentAdviceApi.latest().then(d => setResult(d)).catch(() => {})
  }

  const changeAssetScope = (nextScope: AssetScope) => {
    setAssetScope(nextScope)
    localStorage.setItem('investment_advice_asset_scope', nextScope)
  }

  const loadPendingIpoFollowUps = useCallback(async () => {
    try {
      const trades = await ipoApi.trades()
      setPendingIpoFollowUps(buildPendingIpoFollowUps(trades))
    } catch {
      setPendingIpoFollowUps([])
    }
  }, [])

  const loadIpoTradeStatuses = useCallback(async (items: IPOInvestmentAdviceItem[] = result?.ipo_advice || []) => {
    if (!items.length) {
      setIpoStatuses({})
      return
    }
    try {
      const trades = await ipoApi.trades()
      const next: Record<string, IpoAdviceStatus> = {}
      items.forEach(item => {
        const matched = trades.filter(trade => ipoTradeMatchesAdvice(trade, item))
        if (matched.some(trade => trade.trade_type === 'SELL')) {
          next[item.id] = 'sold'
        } else if (matched.some(trade => trade.trade_type === 'SUBSCRIBE')) {
          next[item.id] = 'won'
        } else if (matched.some(trade => trade.trade_type === 'NO_WIN')) {
          next[item.id] = 'missed'
        } else if (matched.some(trade => trade.trade_type === 'APPLY')) {
          next[item.id] = 'applied'
        }
      })
      setIpoStatuses(next)
    } catch {
      // IPO trade status is auxiliary; advice itself can still be shown.
    }
  }, [result?.ipo_advice])

  useEffect(() => {
    loadIpoTradeStatuses(result?.ipo_advice || [])
    loadPendingIpoFollowUps()
  }, [result?.ipo_advice, loadIpoTradeStatuses, loadPendingIpoFollowUps])

  const runAdvice = async () => {
    aiCtx.startTask(`AI 投资建议（${assetScopeLabel(assetScope)}）`)
    setStatuses({})
    try {
      aiCtx.addLog(`正在实时生成${assetScopeLabel(assetScope)}投资建议...`, 'info')
      let ranEmpty = false
      try {
        const data = await aiCtx.streamSSE('/api/investment-advice/run-stream', { asset_scope: assetScope })
        if (data) {
          setResult(data as any)
          if ((data as any).budget_status) {
            setBudgetStatus((data as any).budget_status)
          }
          if (((data as any).advice || []).length === 0 && ((data as any).ipo_advice || []).length === 0) ranEmpty = true
        }
      } catch (e: any) {
        const data = await investmentAdviceApi.run(assetScope)
        setResult(data)
        if (data.budget_status) {
          setBudgetStatus(data.budget_status)
        }
        if ((data.advice || []).length === 0 && (data.ipo_advice || []).length === 0) ranEmpty = true
      }
      if (ranEmpty) {
        aiCtx.addLog('⚠️ AI 未生成可执行建议，详见覆盖层日志', 'warning')
        message.warning({
          content: 'AI 投资建议完成但 0 条入库，请打开覆盖层日志查看过滤原因。',
          duration: 6,
        })
        aiCtx.completeTask()
      } else {
        aiCtx.addLog('✅ AI 投资建议已生成', 'success')
        aiCtx.completeTask()
      }
    } catch (e: any) {
      aiCtx.failTask(e?.response?.data?.detail || 'AI 投资建议生成失败')
    }
  }

  const acceptAdvice = async (item: InvestmentAdviceItem) => {
    setAcceptingId(item.id)
    try {
      await investmentAdviceApi.accept(item)
      setStatuses(prev => ({ ...prev, [item.id]: 'accepted' }))
      setResult(prev => prev ? {
        ...prev,
        advice: prev.advice.filter(advice => advice.id !== item.id),
      } : prev)
      message.success(`已采纳并写入${adviceAssetSourceLabel(item, result?.asset_scope)}`)
      // Refresh budget status
      loadBudgetStatus()
      investmentAdviceApi.latest().then(d => setResult(d)).catch(() => {})
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '采纳失败')
    } finally {
      setAcceptingId(null)
    }
  }

  const dismissAdvice = (item: InvestmentAdviceItem) => {
    setStatuses(prev => ({ ...prev, [item.id]: 'dismissed' }))
    message.success('已放弃该建议')
  }

  const openIpoTradeModal = (item: IPOInvestmentAdviceItem, tradeType: IpoAdviceTradeType) => {
    setIpoTradeModal({ open: true, item, tradeType })
    const isNoWin = tradeType === 'NO_WIN'
    const fallbackShares = item.suggested_shares || item.lot_size || 1
    const fallbackPrice = item.suggested_price || item.issue_price || 0
    const defaultNote = tradeType === 'APPLY'
      ? `按 AI 新股建议记录申购申请，${item.follow_up_date ? `${item.follow_up_date} 回访确认是否中签` : '待回访确认是否中签'}：${item.reason || ''}`
      : tradeType === 'SUBSCRIBE'
        ? '申购结束后回访：确认已中签，记录实际中签数量。'
        : tradeType === 'NO_WIN'
          ? '申购结束后回访：确认未中签。'
          : `按 AI 新股卖出计划记录卖出：${item.sell_timing || ''}`
    ipoTradeForm.setFieldsValue({
      platform: item.platform || '',
      trade_date: dayjs(),
      shares: isNoWin ? 0 : fallbackShares,
      price: isNoWin ? 0 : fallbackPrice,
      fee: 0,
      follow_up_date: item.follow_up_date ? dayjs(item.follow_up_date) : dayjs().add(3, 'day'),
      note: defaultNote,
    })
  }

  const submitIpoTrade = async () => {
    if (!ipoTradeModal.item) return
    const item = ipoTradeModal.item
    const tradeType = ipoTradeModal.tradeType
    setRecordingIpoTrade(true)
    try {
      const values = await ipoTradeForm.validateFields()
      const record = await ipoApi.createTrade({
        ipo_id: item.ipo_id,
        code: item.code,
        name: item.name,
        market: item.market,
        platform: values.platform || item.platform || '',
        currency: item.currency || 'CNY',
        trade_type: tradeType,
        shares: tradeType === 'NO_WIN' ? 0 : Number(values.shares || 0),
        price: tradeType === 'NO_WIN' ? 0 : Number(values.price || 0),
        fee: tradeType === 'NO_WIN' ? 0 : Number(values.fee || 0),
        trade_date: values.trade_date ? values.trade_date.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
        follow_up_date: values.follow_up_date ? values.follow_up_date.format('YYYY-MM-DD') : item.follow_up_date || '',
        analysis_snapshot: item.analysis_snapshot || {},
        advice_snapshot: item,
        note: values.note || '',
      })
      const nextStatus: IpoAdviceStatus = tradeType === 'SELL'
        ? 'sold'
        : tradeType === 'SUBSCRIBE'
          ? 'won'
          : tradeType === 'NO_WIN'
            ? 'missed'
            : 'applied'
      setIpoStatuses(prev => ({
        ...prev,
        [item.id]: nextStatus,
      }))
      setIpoTradeModal({ open: false, item: null, tradeType: 'APPLY' })
      if (tradeType === 'SELL') {
        message.success(`已记录卖出，已实现盈亏 ${formatAmount(record.realized_pnl || 0, item.currency)}`)
      } else if (tradeType === 'SUBSCRIBE') {
        message.success('已确认中签，后续可记录卖出')
      } else if (tradeType === 'NO_WIN') {
        message.success('已记录未中签')
      } else {
        message.success(`已记录申购，${record.follow_up_date ? `${record.follow_up_date} 回访确认是否中签` : '待回访确认是否中签'}`)
      }
      loadIpoTradeStatuses()
      loadPendingIpoFollowUps()
    } catch (e: any) {
      if (e?.errorFields) return
      message.error(e?.response?.data?.detail || e?.message || '新股交易记录失败')
    } finally {
      setRecordingIpoTrade(false)
    }
  }

  // Analysis modal
  const [analysisModal, setAnalysisModal] = useState<{ open: boolean; item: InvestmentAdviceItem | null; fundamentals: any; history: MarketHistoryItem[]; rawHistory: MarketHistoryItem[]; loading: boolean }>({
    open: false, item: null, fundamentals: null, history: [], rawHistory: [], loading: false,
  })
  const [analysisPeriod, setAnalysisPeriod] = useState<NetValuePeriod>('6m')

  const showAnalysis = async (item: InvestmentAdviceItem) => {
    setAnalysisPeriod('6m')
    setAnalysisModal({ open: true, item, fundamentals: null, history: [], rawHistory: [], loading: true })
    try {
      const [fundamentals, hist] = await Promise.all([
        marketApi.fundamentals(item.code, item.market, item.asset_type).catch(() => null),
        marketApi.historyFullRaw(item.code, item.market, item.asset_type).catch(() => null),
      ])
      const rawHistory = hist?.history || []
      setAnalysisModal(prev => ({
        ...prev,
        fundamentals: fundamentals?.fundamentals || null,
        rawHistory,
        history: transformMarketHistory(rawHistory, '6m', 'day'),
        loading: false,
      }))
    } catch {
      setAnalysisModal(prev => ({ ...prev, loading: false }))
    }
  }

  useEffect(() => {
    if (!analysisModal.open || !analysisModal.item) return
    let active = true
    if (analysisModal.rawHistory.length > 0) {
      setAnalysisModal(prev => ({ ...prev, history: transformMarketHistory(prev.rawHistory, analysisPeriod, 'day') }))
      return () => { active = false }
    }
    marketApi.historyFullRange(analysisModal.item.code, analysisModal.item.market, analysisModal.item.asset_type, { period: analysisPeriod, interval: 'day' })
      .then(data => {
        if (active) setAnalysisModal(prev => ({ ...prev, history: data.history || [] }))
      })
      .catch(() => {})
    return () => { active = false }
  }, [analysisPeriod, analysisModal.open, analysisModal.item?.id, analysisModal.rawHistory.length])

  if (initialLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <Spin size="large" />
      </div>
    )
  }

  return (<>
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {/* Top: Budget Status Bar - always visible */}
      {budgetStatus.length > 0 && (
        <div style={{
          background: 'rgba(26, 26, 36, 0.5)',
          border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: 12,
          overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 20px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}>
            <Space>
              <WalletOutlined style={goldStyle} />
              <span style={{ fontSize: 14, fontWeight: 600, color: '#e8e6e3' }}>平台额度概览</span>
            </Space>
            <Button
              size="small"
              type="text"
              icon={<ReloadOutlined />}
              onClick={refreshBudget}
              style={{ color: '#9a9892' }}
            />
          </div>
          <div style={{
            display: 'flex', gap: 12, flexWrap: 'wrap',
            padding: '14px 20px',
          }}>
            {budgetStatus.map((budget: any) => {
              const usedPct = percentOf(budget.used_amount, budget.amount)
              const remaining = budget.remaining_amount
              const isLow = remaining < budget.amount * 0.2
              return (
                <div key={budget.id} style={{
                  flex: '0 0 auto',
                  width: 220,
                  padding: '12px 14px',
                  borderRadius: 10,
                  background: 'rgba(0,0,0,0.2)',
                  border: '1px solid rgba(255,255,255,0.05)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <Text style={{ color: '#e8e6e3', fontWeight: 600, fontSize: 13 }}>{budget.platform}</Text>
                    <Tag style={{
                      margin: 0, borderRadius: 4, fontSize: 10, lineHeight: '18px', padding: '0 6px',
                      background: 'rgba(201,168,76,0.15)', border: 'none', color: '#c9a84c',
                    }}>
                      {budget.currency_label}
                    </Tag>
                  </div>
                  <div style={{ marginBottom: 6 }}>
                    <Progress
                      percent={usedPct}
                      size="small"
                      showInfo={false}
                      strokeColor={isLow ? '#cf1322' : '#c9a84c'}
                      trailColor="rgba(255,255,255,0.06)"
                      style={{ margin: 0, lineHeight: 0 }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div>
                      <div style={{ color: remaining > 0 ? '#b0aea8' : '#ff4d4f', fontWeight: 700, fontSize: 16, lineHeight: '22px' }}>
                        {formatAmount(remaining, budget.currency)}
                      </div>
                      <div style={{ color: '#5c5a55', fontSize: 10, lineHeight: '14px' }}>
                        可用额度
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: '#9a9892', fontSize: 12, lineHeight: '18px' }}>
                        {formatAmount(budget.used_amount, budget.currency)}
                      </div>
                      <div style={{ color: '#5c5a55', fontSize: 10, lineHeight: '14px' }}>
                        已用 / 总额 {formatAmount(budget.amount, budget.currency)}
                      </div>
                    </div>
                  </div>
                  <div style={{ color: '#5c5a55', fontSize: 10, marginTop: 6 }}>
                    {(budget.market_labels || []).join(' / ')} · {(budget.asset_type_labels || []).join(' / ')}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Main: AI Advice Panel */}
      <Card
        title={
          <Space>
            <RobotOutlined style={goldStyle} />
            <span>AI 投资建议</span>
          </Space>
        }
        extra={
          <Space size={8} style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Radio.Group
              size="small"
              optionType="button"
              buttonStyle="solid"
              options={assetScopeOptions}
              value={assetScope}
              disabled={aiCtx.state.isRunning}
              onChange={e => changeAssetScope(e.target.value)}
            />
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={aiCtx.state.isRunning}
              onClick={runAdvice}
              style={{ borderRadius: 10, fontWeight: 600 }}
            >
              AI 投资建议
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {result?.summary ? (
            <div style={{
              padding: 12,
              borderRadius: 8,
              background: 'rgba(201,168,76,0.06)',
              border: '1px solid rgba(201,168,76,0.12)',
              color: '#cfcac1',
              lineHeight: 1.7,
              fontSize: 13,
            }}>
              {result.summary}
            </div>
          ) : null}
          {result?.market_context?.observations?.length ? (
            <div style={{
              padding: 12,
              borderRadius: 8,
              background: 'rgba(255,255,255,0.025)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Space size={8}>
                  <Tag style={{
                    margin: 0,
                    borderRadius: 4,
                    background: 'rgba(201,168,76,0.12)',
                    border: '1px solid rgba(201,168,76,0.2)',
                    color: '#c9a84c',
                  }}>
                    {result.market_context.regime || '市场环境'}
                  </Tag>
                  <Text style={{ color: '#9a9892', fontSize: 12 }}>本次建议的市场判断</Text>
                </Space>
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  {result.market_context.observations.slice(0, 4).map((item, idx) => (
                    <Text key={idx} style={{ color: '#b0aea8', fontSize: 12, lineHeight: 1.6 }}>
                      {item}
                    </Text>
                  ))}
                </Space>
              </Space>
            </div>
          ) : null}
          {result?.decision_audit?.length ? (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 8,
            }}>
              {result.decision_audit.slice(0, 6).map((item, idx) => (
                <div key={`${item.code || idx}-${idx}`} style={{
                  padding: 10,
                  borderRadius: 8,
                  background: 'rgba(0,0,0,0.18)',
                  border: '1px solid rgba(255,255,255,0.05)',
                  minHeight: 76,
                }}>
                  <Space size={6} style={{ marginBottom: 4, flexWrap: 'wrap' }}>
                    <Text style={{ color: '#e8e6e3', fontSize: 12, fontWeight: 600 }}>{item.code || '组合'}</Text>
                    <Tag style={{ margin: 0, borderRadius: 4, fontSize: 10, lineHeight: '18px', padding: '0 6px' }}>
                      {item.decision || '审视'}
                    </Tag>
                  </Space>
                  <Text style={{ color: '#8f8a82', fontSize: 11, lineHeight: 1.5, display: 'block' }}>
                    {item.why || (item.key_facts || []).join('；')}
                  </Text>
                </div>
              ))}
            </div>
          ) : null}
        </Space>
      </Card>

      {/* Advice List */}
      <Card
        title={
          <Space>
            <DollarOutlined style={goldStyle} />
            <span>建议列表</span>
          </Space>
        }
      >
        {!result ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="点击上方按钮生成 AI 投资建议" />
        ) : result.advice.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可执行建议" />
        ) : (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {result.advice.map((item: any) => {
              const status = statuses[item.id]
              const isBuy = item.trade_type === 'BUY'
              const itemAssetSource = adviceAssetSource(item, result?.asset_scope)
              return (
                <Card key={item.id} size="small" style={{
                  borderRadius: 8,
                  background: status === 'accepted' ? 'rgba(64,210,128,0.04)'
                    : status === 'dismissed' ? 'rgba(255,255,255,0.02)'
                    : 'rgba(255,255,255,0.02)',
                  border: status === 'accepted' ? '1px solid rgba(64,210,128,0.15)'
                    : '1px solid rgba(255,255,255,0.05)',
                  opacity: status === 'dismissed' ? 0.5 : 1,
                }}>
                  <Row gutter={[10, 6]} align="middle">
                    {/* Col 1: [BUY] Name · Code · Asset Type */}
                    <Col xs={24} lg={8}>
                      <Space size={4} style={{ flexWrap: 'wrap' }}>
                        <Tag color={isBuy ? '#40d280' : '#ff4d4f'} style={{ border: 'none', color: '#fff', borderRadius: 4, fontSize: 10, lineHeight: '18px', padding: '0 6px', margin: 0, flexShrink: 0 }}>
                          {item.trade_type_label}
                        </Tag>
                        <Text strong style={{ color: '#e8e6e3', fontSize: 13, whiteSpace: 'nowrap' }}>{item.name || item.code}</Text>
                        <Text style={{ color: '#5c5a55', fontSize: 11, whiteSpace: 'nowrap' }}>
                          {item.code}·{item.asset_type_label}
                        </Text>
                        <Text style={{ color: '#5c5a55', fontSize: 11, whiteSpace: 'nowrap' }}>{item.market_label}</Text>
                        <Tag style={{
                          margin: 0, borderRadius: 4, fontSize: 10, lineHeight: '18px', padding: '0 6px',
                          background: itemAssetSource === 'manual' ? 'rgba(120,185,255,0.12)' : 'rgba(201,168,76,0.12)',
                          border: itemAssetSource === 'manual' ? '1px solid rgba(120,185,255,0.24)' : '1px solid rgba(201,168,76,0.24)',
                          color: itemAssetSource === 'manual' ? '#78b9ff' : '#c9a84c',
                        }}>
                          {adviceAssetSourceLabel(item, result?.asset_scope)}
                        </Tag>
                      </Space>
                    </Col>

                    {/* Col 2: Platform (prominent) */}
                    <Col xs={12} lg={3}>
                      <Tag style={{
                        borderRadius: 4, fontSize: 11, lineHeight: '20px', padding: '0 8px', margin: 0,
                        background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.25)', color: '#c9a84c',
                      }}>
                        {item.platform}
                      </Tag>
                    </Col>

                    {/* Col 3: Shares */}
                    <Col xs={6} lg={2}>
                      <Text style={{ color: '#5c5a55', fontSize: 10, display: 'block' }}>份额</Text>
                      <Text style={{ color: '#e8e6e3', fontWeight: 600, fontSize: 12 }}>{item.shares?.toFixed(2)}</Text>
                    </Col>

                    {/* Col 4: Amount */}
                    <Col xs={6} lg={2}>
                      <Text style={{ color: '#5c5a55', fontSize: 10, display: 'block' }}>金额</Text>
                      <Text style={{ color: '#e8e6e3', fontWeight: 600, fontSize: 12 }}>{formatAmount(item.estimated_amount, item.currency)}</Text>
                    </Col>

                    {/* Col 5: Reason (compact + Tooltip) */}
                    <Col xs={24} lg={4}>
                      {item.reason ? (
                        <Tooltip title={item.reason} color="#2d2d3d">
                          <span style={{ cursor: 'pointer' }}>
                            <Text style={{ color: '#7c776d', fontSize: 10, display: 'block' }}>理由</Text>
                            <Text style={{ color: '#7c776d', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%', display: 'block' }}>
                              {(item.reason || '').length > 30 ? (item.reason || '').slice(0, 30) + '…' : item.reason}
                            </Text>
                          </span>
                        </Tooltip>
                      ) : item.risk_note ? (
                        <Tooltip title={item.risk_note} color="#2d2d3d">
                          <span style={{ cursor: 'pointer' }}>
                            <Text style={{ color: '#7c776d', fontSize: 10, display: 'block' }}>风险</Text>
                            <Text style={{ color: '#7c776d', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%', display: 'block' }}>
                              {(item.risk_note || '').length > 30 ? (item.risk_note || '').slice(0, 30) + '…' : item.risk_note}
                            </Text>
                          </span>
                        </Tooltip>
                      ) : null}
                    </Col>

                    {/* Col 6: Actions */}
                    <Col xs={24} lg={5}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
                        {status === 'accepted' ? (
                          <Tag color="#40d280" style={{ border: 'none', color: '#fff', borderRadius: 4, fontSize: 11, margin: 0 }}>已采纳</Tag>
                        ) : status === 'dismissed' ? (
                          <Tag style={{ borderRadius: 4, background: 'transparent', color: '#9a9892', borderColor: 'rgba(255,255,255,0.12)', margin: 0, fontSize: 11 }}>已放弃</Tag>
                        ) : (
                          <>
                            <Button size="small" icon={<BarChartOutlined />}
                              onClick={() => showAnalysis(item)}
                              style={{ borderRadius: 6, height: 28, fontSize: 11, paddingInline: 6 }}
                            >分析</Button>
                            <Button type="primary" size="small" icon={<CheckOutlined />}
                              loading={acceptingId === item.id}
                              onClick={() => acceptAdvice(item)}
                              style={{ borderRadius: 6, height: 28, fontSize: 11, paddingInline: 8 }}
                            >采纳</Button>
                            <Button size="small" icon={<CloseOutlined />}
                              onClick={() => dismissAdvice(item)}
                              style={{ borderRadius: 6, height: 28, fontSize: 11, paddingInline: 6 }}
                            >放弃</Button>
                          </>
                        )}
                      </div>
                    </Col>
                  </Row>
                </Card>
              )
            })}
          </Space>
        )}
      </Card>

      {/* IPO Advice List */}
      <Card
        title={
          <Space>
            <RocketOutlined style={goldStyle} />
            <span>新股申购建议</span>
          </Space>
        }
      >
        {!result && !pendingIpoFollowUps.length ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="点击上方按钮生成 AI 投资建议" />
        ) : !(result?.ipo_advice || []).length && !pendingIpoFollowUps.length ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无新股申购建议" />
        ) : (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {pendingIpoFollowUps.length ? (
              <div style={{ padding: 12, borderRadius: 8, background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.14)' }}>
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  <Text style={{ color: '#c9a84c', fontSize: 12, fontWeight: 600 }}>待回访确认中签结果</Text>
                  {pendingIpoFollowUps.map(item => (
                    <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <Space direction="vertical" size={0}>
                        <Text style={{ color: '#e8e6e3', fontSize: 13, fontWeight: 600 }}>{item.name || item.code}</Text>
                        <Text style={{ color: '#8f8a82', fontSize: 12 }}>
                          {item.market_label || item.market} · {item.platform || '未填平台'} · {item.follow_up_date ? `回访 ${item.follow_up_date}` : '待回访'}
                        </Text>
                      </Space>
                      <Space size={6}>
                        <Button
                          size="small"
                          icon={<CheckOutlined />}
                          onClick={() => openIpoTradeModal(item, 'SUBSCRIBE')}
                          style={{ borderRadius: 6, height: 28, fontSize: 11, paddingInline: 8 }}
                        >
                          确认中签
                        </Button>
                        <Button
                          size="small"
                          icon={<CloseOutlined />}
                          onClick={() => openIpoTradeModal(item, 'NO_WIN')}
                          style={{ borderRadius: 6, height: 28, fontSize: 11, paddingInline: 8 }}
                        >
                          未中签
                        </Button>
                      </Space>
                    </div>
                  ))}
                </Space>
              </div>
            ) : null}
            {(result?.ipo_advice || []).length ? (
              <Row gutter={[12, 12]}>
                {(result?.ipo_advice || []).map(item => {
              const color = ipoDecisionColor(item.decision)
              const status = ipoStatuses[item.id]
              const statusLabel = status === 'applied'
                ? '待回访'
                : status === 'won'
                  ? '已中签'
                  : status === 'missed'
                    ? '未中签'
                    : status === 'sold'
                      ? '已卖出'
                      : ''
              const followUpText = item.follow_up_date ? `回访 ${item.follow_up_date}` : ''
              return (
                <Col xs={24} lg={12} xl={8} key={item.id || item.ipo_id || item.code}>
                  <div style={{
                    height: '100%',
                    padding: 14,
                    borderRadius: 8,
                    background: status === 'sold' ? 'rgba(64,210,128,0.04)' : 'rgba(255,255,255,0.025)',
                    border: `1px solid ${color}33`,
                  }}>
                    <Space direction="vertical" size={10} style={{ width: '100%' }}>
                      <Space style={{ width: '100%', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <Space direction="vertical" size={0}>
                          <Space size={6} style={{ flexWrap: 'wrap' }}>
                            <Text strong style={{ color: '#e8e6e3' }}>{item.name || item.code}</Text>
                            <Text style={{ color: '#5c5a55', fontSize: 12 }}>{item.code}</Text>
                          </Space>
                          <Text style={{ color: '#8f8a82', fontSize: 12 }}>
                            {item.market_label || item.market} · 上市 {item.listing_date || '-'}
                            {followUpText ? ` · ${followUpText}` : ''}
                          </Text>
                        </Space>
                        <Tag style={{ margin: 0, borderRadius: 4, color, background: `${color}18`, borderColor: `${color}44` }}>
                          {item.decision_label}
                        </Tag>
                      </Space>

                      <Row gutter={10}>
                        <Col span={12}>
                          <Text style={{ color: '#5c5a55', fontSize: 11 }}>胜率评分</Text>
                          <Progress percent={Math.round(item.win_probability || 0)} size="small" strokeColor={color} trailColor="rgba(255,255,255,0.06)" />
                        </Col>
                        <Col span={12}>
                          <Text style={{ color: '#5c5a55', fontSize: 11 }}>盈利预期</Text>
                          <div style={{ color: (item.expected_profit_pct || 0) >= 0 ? '#40d280' : '#ff4d4f', fontWeight: 700, fontSize: 18 }}>
                            {formatSignedPercent(item.expected_profit_pct)}
                          </div>
                          <Text style={{ color: '#8f8a82', fontSize: 11 }}>{item.expected_profit_range || '-'}</Text>
                        </Col>
                      </Row>

                      <div style={{ padding: 10, borderRadius: 8, background: 'rgba(201,168,76,0.05)', border: '1px solid rgba(201,168,76,0.1)' }}>
                        <Text style={{ color: '#c9a84c', fontSize: 12, display: 'block', marginBottom: 4 }}>卖出计划</Text>
                        <Text style={{ color: '#cfcac1', fontSize: 12, lineHeight: 1.7, display: 'block' }}>{item.sell_timing || '-'}</Text>
                        <Text style={{ color: '#8f8a82', fontSize: 11, lineHeight: 1.6, display: 'block', marginTop: 4 }}>止盈：{item.take_profit || '-'}</Text>
                        <Text style={{ color: '#8f8a82', fontSize: 11, lineHeight: 1.6, display: 'block' }}>止损：{item.stop_loss || '-'}</Text>
                      </div>

                      <Text style={{ color: '#cfcac1', fontSize: 12, lineHeight: 1.7 }}>
                        {item.reason || '基于最新新股打新分析生成建议'}
                      </Text>

                      {(item.evidence || []).length ? (
                        <Space direction="vertical" size={4} style={{ width: '100%' }}>
                          {(item.evidence || []).slice(0, 3).map((evidence, idx) => (
                            <Text key={idx} style={{ color: '#b0aea8', fontSize: 12 }}>• {evidence}</Text>
                          ))}
                        </Space>
                      ) : null}

                      <Space size={6} style={{ justifyContent: 'space-between', width: '100%', flexWrap: 'wrap' }}>
                        <Text style={{ color: '#8f8a82', fontSize: 12 }}>
                          {item.suggested_price ? `参考价 ${formatAmount(item.suggested_price, item.currency)}` : '参考价 -'}
                          {item.suggested_shares ? ` · ${item.suggested_shares} 股` : ''}
                        </Text>
                        <Space size={6} style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          {statusLabel ? (
                            <Tag color={status === 'missed' ? '#9a9892' : '#40d280'} style={{ border: 'none', color: '#fff', borderRadius: 4, margin: 0 }}>
                              {statusLabel}
                            </Tag>
                          ) : null}
                          {!status ? (
                            <Button
                              size="small"
                              type="primary"
                              icon={<CheckOutlined />}
                              disabled={item.decision !== 'SUBSCRIBE'}
                              onClick={() => openIpoTradeModal(item, 'APPLY')}
                              style={{ borderRadius: 6, height: 28, fontSize: 11, paddingInline: 8 }}
                            >
                              记录申购
                            </Button>
                          ) : null}
                          {status === 'applied' ? (
                            <>
                              <Button
                                size="small"
                                icon={<CheckOutlined />}
                                onClick={() => openIpoTradeModal(item, 'SUBSCRIBE')}
                                style={{ borderRadius: 6, height: 28, fontSize: 11, paddingInline: 8 }}
                              >
                                确认中签
                              </Button>
                              <Button
                                size="small"
                                icon={<CloseOutlined />}
                                onClick={() => openIpoTradeModal(item, 'NO_WIN')}
                                style={{ borderRadius: 6, height: 28, fontSize: 11, paddingInline: 8 }}
                              >
                                未中签
                              </Button>
                            </>
                          ) : null}
                          {status === 'won' ? (
                            <Button
                              size="small"
                              icon={<DollarOutlined />}
                              onClick={() => openIpoTradeModal(item, 'SELL')}
                              style={{ borderRadius: 6, height: 28, fontSize: 11, paddingInline: 8 }}
                            >
                              记录卖出
                            </Button>
                          ) : null}
                        </Space>
                      </Space>
                    </Space>
                  </div>
                </Col>
              )
                })}
              </Row>
            ) : null}
          </Space>
        )}
      </Card>
    </Space>

{/* Analysis Modal */}
      <Modal
        title={
          <Space>
            <BarChartOutlined style={goldStyle} />
            <span>{analysisModal.item?.name || analysisModal.item?.code || '分析'} · {analysisModal.item?.code}</span>
          </Space>
        }
        open={analysisModal.open}
        onCancel={() => setAnalysisModal(prev => ({ ...prev, open: false }))}
        footer={null}
        width={640}
      >
        {analysisModal.loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {/* Platform & meta */}
            <Descriptions column={2} size="small" colon={false}
              styles={{
                label: { color: '#5c5a55', fontSize: 12 },
                content: { color: '#e8e6e3', fontSize: 12 },
              }}
            >
              <Descriptions.Item label="平台">{analysisModal.item?.platform}</Descriptions.Item>
              <Descriptions.Item label="资产空间">{adviceAssetSourceLabel(analysisModal.item, result?.asset_scope)}</Descriptions.Item>
              <Descriptions.Item label="资产类型">{analysisModal.item?.asset_type_label}</Descriptions.Item>
              <Descriptions.Item label="市场">{analysisModal.item?.market_label}</Descriptions.Item>
              <Descriptions.Item label="买卖">{analysisModal.item?.trade_type_label}</Descriptions.Item>
              <Descriptions.Item label="份额">{analysisModal.item?.shares?.toFixed(4)}</Descriptions.Item>
              <Descriptions.Item label="金额">{analysisModal.item ? formatAmount(analysisModal.item.estimated_amount, analysisModal.item.currency) : ''}</Descriptions.Item>
            </Descriptions>

            {/* Reason */}
            {analysisModal.item?.reason ? (
              <div style={{ padding: 10, borderRadius: 8, background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.12)', color: '#cfcac1', fontSize: 12, lineHeight: 1.7 }}>
                <Text style={{ color: '#c9a84c', fontWeight: 500, fontSize: 11, display: 'block', marginBottom: 4 }}>💡 理由</Text>
                {analysisModal.item.reason}
              </div>
            ) : null}
            {analysisModal.item?.evidence?.length ? (
              <div style={{ padding: 10, borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', color: '#b0aea8', fontSize: 12, lineHeight: 1.7 }}>
                <Text style={{ color: '#c9a84c', fontWeight: 500, fontSize: 11, display: 'block', marginBottom: 4 }}>证据</Text>
                {(analysisModal.item.evidence || []).map((evidence, idx) => (
                  <div key={idx}>{evidence}</div>
                ))}
              </div>
            ) : null}
            {analysisModal.item?.risk_note ? (
              <div style={{ padding: 10, borderRadius: 8, background: 'rgba(207,19,34,0.06)', border: '1px solid rgba(207,19,34,0.12)', color: '#ffccc7', fontSize: 12, lineHeight: 1.7 }}>
                <Text style={{ color: '#ff4d4f', fontWeight: 500, fontSize: 11, display: 'block', marginBottom: 4 }}>⚠️ 风险提示</Text>
                {analysisModal.item.risk_note}
              </div>
            ) : null}

            {/* Fundamentals */}
            {analysisModal.fundamentals ? (
              <div style={{ padding: 12, borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <Text style={{ color: '#c9a84c', fontWeight: 500, fontSize: 12, display: 'block', marginBottom: 8 }}><FundOutlined /> 基本面数据</Text>
                <Descriptions column={3} size="small" colon={false}
                  styles={{
                    label: { color: '#5c5a55', fontSize: 11 },
                    content: { color: '#e8e6e3', fontSize: 11 },
                  }}
                >
                  {analysisModal.fundamentals.trailing_pe != null ? <Descriptions.Item label="市盈率(PE)">{analysisModal.fundamentals.trailing_pe?.toFixed(2)}</Descriptions.Item> : null}
                  {analysisModal.fundamentals.forward_pe != null ? <Descriptions.Item label="远期PE">{analysisModal.fundamentals.forward_pe?.toFixed(2)}</Descriptions.Item> : null}
                  {analysisModal.fundamentals.price_to_book != null ? <Descriptions.Item label="市净率(PB)">{analysisModal.fundamentals.price_to_book?.toFixed(2)}</Descriptions.Item> : null}
                  {analysisModal.fundamentals.market_cap != null ? <Descriptions.Item label="市值">¥{(analysisModal.fundamentals.market_cap / 1e8).toFixed(2)}亿</Descriptions.Item> : null}
                  {analysisModal.fundamentals.dividend_yield != null ? <Descriptions.Item label="股息率">{(analysisModal.fundamentals.dividend_yield * 100).toFixed(2)}%</Descriptions.Item> : null}
                  {analysisModal.fundamentals.beta != null ? <Descriptions.Item label="Beta">{analysisModal.fundamentals.beta?.toFixed(2)}</Descriptions.Item> : null}
                  {analysisModal.fundamentals.eps != null ? <Descriptions.Item label="每股收益">{analysisModal.fundamentals.eps?.toFixed(2)}</Descriptions.Item> : null}
                  {analysisModal.fundamentals.revenue != null ? <Descriptions.Item label="营收">¥{(analysisModal.fundamentals.revenue / 1e8).toFixed(2)}亿</Descriptions.Item> : null}
                  {analysisModal.fundamentals.profit_margins != null ? <Descriptions.Item label="利润率">{(analysisModal.fundamentals.profit_margins * 100).toFixed(2)}%</Descriptions.Item> : null}
                  {analysisModal.fundamentals.fund_name ? <Descriptions.Item label="基金名称" span={2}>{analysisModal.fundamentals.fund_name}</Descriptions.Item> : null}
                  {analysisModal.fundamentals.fund_manager ? <Descriptions.Item label="基金经理">{analysisModal.fundamentals.fund_manager}</Descriptions.Item> : null}
                  {analysisModal.fundamentals.fund_size != null ? <Descriptions.Item label="基金规模">¥{(analysisModal.fundamentals.fund_size / 1e8).toFixed(2)}亿</Descriptions.Item> : null}
                </Descriptions>
              </div>
            ) : null}

            {/* History chart */}
            {analysisModal.history.length > 0 && (
              <div style={{ padding: 12, borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <Text style={{ color: '#c9a84c', fontWeight: 500, fontSize: 12 }}>价格走势</Text>
                  <NetValueRangeSelector value={analysisPeriod} onChange={setAnalysisPeriod} />
                </div>
                <PriceLineChart data={analysisModal.history} height={180} />
              </div>
            )}
          </Space>
        )}
      </Modal>
      <Modal
        title={
          <Space>
            <RocketOutlined style={goldStyle} />
            <span>
              {ipoTradeTypeLabel[ipoTradeModal.tradeType]}
              {ipoTradeModal.item ? ` · ${ipoTradeModal.item.name || ipoTradeModal.item.code}` : ''}
            </span>
          </Space>
        }
        open={ipoTradeModal.open}
        onCancel={() => setIpoTradeModal({ open: false, item: null, tradeType: 'APPLY' })}
        onOk={submitIpoTrade}
        confirmLoading={recordingIpoTrade}
        okText="保存"
        cancelText="取消"
        width={560}
      >
        <Form form={ipoTradeForm} layout="vertical" size="middle">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="platform" label="平台">
                <Input placeholder="申购/交易平台" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="trade_date" label={ipoTradeDateLabel[ipoTradeModal.tradeType]} rules={[{ required: true, message: '请选择日期' }]}>
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
              </Form.Item>
            </Col>
          </Row>
          {ipoTradeModal.tradeType !== 'NO_WIN' ? (
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item
                  name="shares"
                  label={ipoTradeModal.tradeType === 'SUBSCRIBE' ? '中签股数' : ipoTradeModal.tradeType === 'APPLY' ? '申购股数' : '份额'}
                  rules={[{ required: true, message: '请输入份额' }]}
                >
                  <InputNumber style={{ width: '100%' }} min={0.0001} step={1} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="price" label={`${ipoTradePriceLabel[ipoTradeModal.tradeType]} (${ipoTradeModal.item?.currency || 'CNY'})`} rules={[{ required: true, message: '请输入价格' }]}>
                  <InputNumber style={{ width: '100%' }} min={0.0001} step={0.001} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="fee" label="手续费">
                  <InputNumber style={{ width: '100%' }} min={0} step={0.01} />
                </Form.Item>
              </Col>
            </Row>
          ) : null}
          {ipoTradeModal.tradeType === 'APPLY' ? (
            <Form.Item name="follow_up_date" label="回访日期" rules={[{ required: true, message: '请选择回访日期' }]}>
              <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
            </Form.Item>
          ) : null}
          {ipoTradeModal.item ? (
            <div style={{ padding: 10, borderRadius: 8, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)', marginBottom: 12 }}>
              <Text style={{ color: '#c9a84c', fontSize: 12, display: 'block', marginBottom: 4 }}>
                {ipoTradeModal.tradeType === 'APPLY'
                  ? '回访安排'
                  : ipoTradeModal.tradeType === 'SELL'
                    ? 'AI 卖出计划'
                    : '回访确认'}
              </Text>
              {ipoTradeModal.tradeType === 'APPLY' ? (
                <Text style={{ color: '#b0aea8', fontSize: 12, lineHeight: 1.7, display: 'block' }}>
                  申购后不会直接计入持仓；到回访日期再确认是否中签及实际中签股数。
                </Text>
              ) : ipoTradeModal.tradeType === 'SELL' ? (
                <>
                  <Text style={{ color: '#b0aea8', fontSize: 12, lineHeight: 1.7, display: 'block' }}>{ipoTradeModal.item.sell_timing || '-'}</Text>
                  <Text style={{ color: '#8f8a82', fontSize: 11, lineHeight: 1.6, display: 'block' }}>止盈：{ipoTradeModal.item.take_profit || '-'}</Text>
                  <Text style={{ color: '#8f8a82', fontSize: 11, lineHeight: 1.6, display: 'block' }}>止损：{ipoTradeModal.item.stop_loss || '-'}</Text>
                </>
              ) : (
                <Text style={{ color: '#b0aea8', fontSize: 12, lineHeight: 1.7, display: 'block' }}>
                  {ipoTradeModal.tradeType === 'SUBSCRIBE'
                    ? '根据申购结束后的回访结果，记录实际中签股数和成本价；确认后才会进入可卖持仓。'
                    : '确认未中签后只记录回访结果，不会生成持仓或可卖份额。'}
                </Text>
              )}
            </div>
          ) : null}
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} placeholder="交易备注（可选）" />
          </Form.Item>
        </Form>
      </Modal>
      </>
  )
}
