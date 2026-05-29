import { useState, useEffect } from 'react'
import { useAIWorkContext } from '../stores/AIWorkContext'
import { Button, Card, Col, Empty, message, Row, Space, Spin, Tag, Typography } from 'antd'
import {
  CheckOutlined, CloseOutlined, DollarOutlined, RobotOutlined,
  ThunderboltOutlined, WalletOutlined,
} from '@ant-design/icons'
import { investmentAdviceApi, InvestmentAdviceItem, InvestmentAdviceResponse } from '../api'

const { Text } = Typography

const goldStyle = { color: '#c9a84c' }
const greenStyle = { color: 'oklch(72% 0.14 145)' }
const redStyle = { color: 'oklch(65% 0.18 25)' }

const formatAmount = (value: number, currency?: string) => {
  const symbol = currency === 'HKD' ? 'HK$' : currency === 'USD' ? '$' : '¥'
  return `${symbol}${Number(value || 0).toFixed(2)}`
}

export default function InvestmentAdvice() {
  const aiCtx = useAIWorkContext()
  const [initialLoading, setInitialLoading] = useState(true)
  const [acceptingId, setAcceptingId] = useState<string | null>(null)
  const [result, setResult] = useState<InvestmentAdviceResponse | null>(null)
  const [statuses, setStatuses] = useState<Record<string, 'accepted' | 'dismissed'>>({})

  // 页面加载时自动读取最新投资建议
  useEffect(() => {
    (async () => {
      try {
        const data = await investmentAdviceApi.latest()
        setResult(data)
      } catch {
        // 没有历史数据，保持空白
      } finally {
        setInitialLoading(false)
      }
    })()
  }, [])

  const runAdvice = async () => {
    aiCtx.startTask('AI 投资建议')
    setStatuses({})
    try {
      aiCtx.addLog('正在实时生成投资建议...', 'info')
      try {
        const data = await aiCtx.streamSSE('/api/investment-advice/run-stream')
        if (data) {
          setResult(data as any)
        }
      } catch (e: any) {
        const data = await investmentAdviceApi.run()
        setResult(data)
      }
      aiCtx.addLog('✅ AI 投资建议已生成', 'success')
      aiCtx.completeTask()
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

  if (initialLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
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
            }}>
              {result.summary}
            </div>
          ) : null}

          {result?.budget_status?.length ? (
            <Row gutter={[12, 12]}>
              {result.budget_status.map((budget: any) => (
                <Col xs={24} md={12} xl={8} key={budget.id}>
                  <Card size="small" style={{ borderRadius: 8, background: 'rgba(255,255,255,0.02)' }}>
                    <Space direction="vertical" size={6} style={{ width: '100%' }}>
                      <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                        <Text strong style={{ color: '#e8e6e3' }}>
                          <WalletOutlined style={{ ...goldStyle, marginRight: 6 }} />
                          {budget.platform}
                        </Text>
                        <Tag style={{ borderRadius: 6, background: 'transparent', borderColor: 'rgba(201,168,76,0.2)', color: '#c9a84c' }}>
                          {budget.currency_label}
                        </Tag>
                      </Space>
                      <div style={{ color: '#9a9892', fontSize: 12 }}>
                        已用 {formatAmount(budget.used_amount, budget.currency)} / 额度 {formatAmount(budget.amount, budget.currency)}
                      </div>
                      <div style={{ color: budget.remaining_amount > 0 ? greenStyle.color : redStyle.color, fontWeight: 600 }}>
                        剩余 {formatAmount(budget.remaining_amount, budget.currency)}
                      </div>
                      <div style={{ color: '#5c5a55', fontSize: 11 }}>
                        {(budget.market_labels || []).join('、')} · {(budget.asset_type_labels || []).join('、')}
                      </div>
                    </Space>
                  </Card>
                </Col>
              ))}
            </Row>
          ) : null}
        </Space>
      </Card>

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
                <Card key={item.id} size="small" style={{ borderRadius: 8, background: 'rgba(255,255,255,0.02)' }}>
                  <Row gutter={[12, 12]} align="middle">
                    <Col xs={24} lg={7}>
                      <Space direction="vertical" size={2}>
                        <Space>
                          <Text strong style={{ color: '#e8e6e3' }}>{item.name || item.code}</Text>
                          <Tag color={isBuy ? greenStyle.color : redStyle.color} style={{ border: 'none', color: '#fff', borderRadius: 6 }}>
                            {item.trade_type_label}
                          </Tag>
                        </Space>
                        <Text style={{ color: '#9a9892', fontSize: 12 }}>
                          {item.code} · {item.platform} · {item.market_label} · {item.asset_type_label}
                        </Text>
                      </Space>
                    </Col>
                    <Col xs={12} lg={4}>
                      <Text style={{ color: '#5c5a55', fontSize: 12 }}>份额</Text>
                      <div style={{ color: '#e8e6e3', fontWeight: 600 }}>{item.shares?.toFixed(4)}</div>
                    </Col>
                    <Col xs={12} lg={4}>
                      <Text style={{ color: '#5c5a55', fontSize: 12 }}>金额</Text>
                      <div style={{ color: '#e8e6e3', fontWeight: 600 }}>{formatAmount(item.estimated_amount, item.currency)}</div>
                    </Col>
                    <Col xs={24} lg={5}>
                      <Text style={{ color: '#5c5a55', fontSize: 12 }}>理由</Text>
                      <div style={{ color: '#b0aea8', fontSize: 12, lineHeight: 1.6 }}>{item.reason}</div>
                      {item.risk_note ? <div style={{ color: '#7c776d', fontSize: 11, marginTop: 4 }}>{item.risk_note}</div> : null}
                    </Col>
                    <Col xs={24} lg={4}>
                      {status === 'accepted' ? (
                        <Tag color={greenStyle.color} style={{ border: 'none', color: '#fff', borderRadius: 6 }}>已采纳</Tag>
                      ) : status === 'dismissed' ? (
                        <Tag style={{ borderRadius: 6, background: 'transparent', color: '#9a9892', borderColor: 'rgba(255,255,255,0.12)' }}>已放弃</Tag>
                      ) : (
                        <Space>
                          <Button
                            type="primary"
                            icon={<CheckOutlined />}
                            loading={acceptingId === item.id}
                            onClick={() => acceptAdvice(item)}
                            style={{ borderRadius: 8 }}
                          >
                            采纳
                          </Button>
                          <Button
                            icon={<CloseOutlined />}
                            onClick={() => dismissAdvice(item)}
                            style={{ borderRadius: 8 }}
                          >
                            放弃
                          </Button>
                        </Space>
                      )}
                    </Col>
                  </Row>
                </Card>
              )
            })}
          </Space>
        )}
      </Card>
    </Space>
  )
}
