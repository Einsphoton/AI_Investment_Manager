import { useState, useEffect, useRef, useCallback } from 'react'
import { useAIWorkContext } from '../stores/AIWorkContext'
import { Button, Card, Col, Empty, message, Modal, Row, Space, Spin, Tag, Tooltip, Typography, Progress, Descriptions } from 'antd'
import {
  CheckOutlined, CloseOutlined, DollarOutlined, RobotOutlined,
  ThunderboltOutlined, WalletOutlined, ReloadOutlined, BarChartOutlined, FundOutlined,
} from '@ant-design/icons'
import { investmentAdviceApi, InvestmentAdviceItem, InvestmentAdviceResponse, marketApi, MarketHistoryItem, transformMarketHistory } from '../api'
import { type NetValuePeriod, NetValueRangeSelector, PriceLineChart } from '../components/MarketCharts'

const { Text } = Typography

const goldStyle = { color: '#c9a84c' }
const greenStyle = { color: 'oklch(72% 0.14 145)' }
const redStyle = { color: 'oklch(65% 0.18 25)' }

const formatAmount = (value: number, currency?: string) => {
  const symbol = currency === 'HKD' ? 'HK$' : currency === 'USD' ? '$' : '¥'
  if (value >= 10000) {
    return `${symbol}${(value / 10000).toFixed(2)}万`
  }
  return `${symbol}${Number(value || 0).toFixed(2)}`
}

const percentOf = (used: number, total: number) => {
  if (total <= 0) return 0
  return Math.min(100, Math.round((used / total) * 100))
}

export default function InvestmentAdvice() {
  const aiCtx = useAIWorkContext()
  const [initialLoading, setInitialLoading] = useState(true)
  const [acceptingId, setAcceptingId] = useState<string | null>(null)
  const [result, setResult] = useState<InvestmentAdviceResponse | null>(null)
  const [statuses, setStatuses] = useState<Record<string, 'accepted' | 'dismissed'>>({})
  const [budgetStatus, setBudgetStatus] = useState<any[]>([])
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

  const runAdvice = async () => {
    aiCtx.startTask('AI 投资建议')
    setStatuses({})
    try {
      aiCtx.addLog('正在实时生成投资建议...', 'info')
      let ranEmpty = false
      try {
        const data = await aiCtx.streamSSE('/api/investment-advice/run-stream')
        if (data) {
          setResult(data as any)
          if ((data as any).budget_status) {
            setBudgetStatus((data as any).budget_status)
          }
          if (((data as any).advice || []).length === 0) ranEmpty = true
        }
      } catch (e: any) {
        const data = await investmentAdviceApi.run()
        setResult(data)
        if (data.budget_status) {
          setBudgetStatus(data.budget_status)
        }
        if ((data.advice || []).length === 0) ranEmpty = true
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
      message.success('已采纳并写入我的资产')
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
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={aiCtx.state.isRunning}
            onClick={runAdvice}
            style={{ borderRadius: 10, fontWeight: 600 }}
          >
            AI 投资建议
          </Button>
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
      </>
  )
}
