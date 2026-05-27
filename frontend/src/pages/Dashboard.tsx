import { useState, useEffect } from 'react'
import {
  Card, Row, Col, Statistic, Button, Spin, Typography, Space, Table, Tag, Switch
} from 'antd'
import {
  ArrowUpOutlined, ArrowDownOutlined, ThunderboltOutlined,
  DollarOutlined, WalletOutlined, RiseOutlined, BarChartOutlined
} from '@ant-design/icons'
import { dashboardApi, analysisApi, assetsApi, DashboardData, AnalysisRecord, Asset } from '../api'
import { useNavigate } from 'react-router-dom'

const { Text, Paragraph } = Typography

const goldStyle = { color: '#c9a84c' }
const greenStyle = { color: 'oklch(72% 0.14 145)' }
const redStyle = { color: 'oklch(65% 0.18 25)' }

export default function Dashboard() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [analysis, setAnalysis] = useState<AnalysisRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [includeTargets, setIncludeTargets] = useState(() => {
    return localStorage.getItem('dashboard_include_targets') === 'true'
  })
  const [assets, setAssets] = useState<Asset[]>([])
  const navigate = useNavigate()

  const fetchData = async () => {
    try {
      const [dash, assetsData, latestAnalysis] = await Promise.all([
        dashboardApi.get(),
        assetsApi.list(),
        analysisApi.latest().catch(() => null),
      ])
      setDashboard(dash)
      setAssets(assetsData)
      setAnalysis(latestAnalysis)
    } catch (e) {
      console.error('Failed to fetch dashboard data', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const runAnalysis = async () => {
    setAnalyzing(true)
    try {
      const result = await analysisApi.run(includeTargets)
      setAnalysis(result)
      await fetchData()
    } catch (e) {
      console.error('Analysis failed', e)
    } finally {
      setAnalyzing(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <Spin size="large" />
      </div>
    )
  }

  const isPositive = (dashboard?.total_pnl ?? 0) >= 0
  const pnlColor = isPositive ? greenStyle.color : redStyle.color
  const ArrowIcon = isPositive ? ArrowUpOutlined : ArrowDownOutlined

  const statCards = [
    {
      title: '持仓市值',
      value: dashboard?.total_market_value ?? 0,
      precision: 2,
      prefix: <DollarOutlined style={{ ...goldStyle, fontSize: 20 }} />,
      suffix: '¥',
      icon: <DollarOutlined />,
    },
    {
      title: '持仓成本',
      value: dashboard?.total_cost ?? 0,
      precision: 2,
      prefix: <WalletOutlined style={{ ...goldStyle, fontSize: 20 }} />,
      suffix: '¥',
    },
    {
      title: '浮动盈亏',
      value: dashboard?.total_pnl ?? 0,
      precision: 2,
      prefix: <ArrowIcon style={{ color: pnlColor, fontSize: 20 }} />,
      suffix: '¥',
      valueStyle: { color: pnlColor },
      extra: `(${isPositive ? '+' : ''}${dashboard?.total_pnl_percent?.toFixed(2)}%)`,
    },
    {
      title: '已实现盈亏',
      value: dashboard?.realized_pnl ?? 0,
      precision: 2,
      prefix: <RiseOutlined style={{ ...goldStyle, fontSize: 20 }} />,
      suffix: '¥',
    },
  ]

  const assetColumns = [
    {
      title: '名称', dataIndex: 'name', key: 'name',
      render: (v: string, r: Asset) => (
        <Space>
          <span style={{ color: '#e8e6e3', fontWeight: 500 }}>{r.name || r.code}</span>
        </Space>
      ),
    },
    {
      title: '类型', dataIndex: 'asset_type', key: 'asset_type',
      render: (v: string) => {
        const map: Record<string, string> = { stock: '股票', offshore_fund: '场外基金', onshore_fund: '场内基金' }
        return <Tag style={{ borderRadius: 6 }}>{map[v] || v}</Tag>
      },
    },
    {
      title: '市场', dataIndex: 'market', key: 'market',
      render: (v: string) => {
        const colors: Record<string, string> = { A: '#c9a84c', HK: '#e8d48b', US: '#a0893c' }
        return <Tag color={colors[v] || undefined} style={{ borderRadius: 6 }}>{v}</Tag>
      },
    },
    {
      title: '市值', key: 'mv',
      render: (_: any, r: Asset) => {
        const mv = r.shares * (r.current_price || r.buy_price)
        return <span style={{ fontWeight: 500 }}>¥{mv.toFixed(2)}</span>
      },
    },
    {
      title: '盈亏', key: 'pnl',
      render: (_: any, r: Asset) => {
        const pnl = r.shares * ((r.current_price || r.buy_price) - r.buy_price)
        const color = pnl >= 0 ? greenStyle.color : redStyle.color
        return (
          <span style={{ color, fontWeight: 600 }}>
            {pnl >= 0 ? '+' : ''}¥{pnl.toFixed(2)}
          </span>
        )
      },
    },
  ]

  return (
    <div className="stagger-children">
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 24px', marginBottom: 16,
        borderRadius: 12, background: 'rgba(26, 26, 36, 0.5)',
        border: '1px solid rgba(255,255,255,0.04)',
      }}>
        <Space size={16}>
          <Button
            type="primary"
            size="large"
            icon={<ThunderboltOutlined />}
            loading={analyzing}
            onClick={runAnalysis}
            style={{ borderRadius: 10, fontWeight: 600, height: 44, paddingInline: 28, fontSize: 15 }}
          >
            {analyzing ? '分析中...' : '一键 AI 分析'}
          </Button>
          <Space>
            <Switch
              checked={includeTargets}
              onChange={checked => {
                setIncludeTargets(checked)
                localStorage.setItem('dashboard_include_targets', String(checked))
              }}
              size="small"
            />
            <Text style={{ color: '#9a9892', fontSize: 13, userSelect: 'none' }}>
              连带推荐标的
            </Text>
          </Space>
        </Space>
        <Text style={{ color: '#5c5a55', fontSize: 12 }}>
          {includeTargets ? '分析完成后将自动更新标的推荐' : '仅分析现有持仓'}
        </Text>
      </div>

      <Row gutter={[16, 16]}>
        {statCards.map((card, i) => (
          <Col xs={24} sm={12} lg={6} key={i}>
            <Card styles={{ body: { padding: '20px 24px' } }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <span style={{
                  fontSize: 12,
                  color: '#9a9892',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  fontWeight: 500,
                }}>
                  {card.title}
                </span>
                <span style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  background: 'rgba(201, 168, 76, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 16,
                }}>
                  {card.icon}
                </span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2, color: card.valueStyle?.color || '#e8e6e3' }}>
                {card.suffix}{card.value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              {card.extra && (
                <div style={{ fontSize: 13, color: card.valueStyle?.color || '#9a9892', marginTop: 4, fontWeight: 500 }}>
                  {card.extra}
                </div>
              )}
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={14}>
          <Card
            title={
              <Space>
                <BarChartOutlined style={goldStyle} />
                <span>AI 资产简报</span>
              </Space>
            }
          >
            {analysis ? (
              <div>
                <div style={{
                  padding: '12px 16px',
                  borderRadius: 10,
                  background: 'linear-gradient(135deg, rgba(201, 168, 76, 0.1), rgba(201, 168, 76, 0.03))',
                  border: '1px solid rgba(201, 168, 76, 0.15)',
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}>
                  <span style={{ fontSize: 20 }}>💡</span>
                  <span style={{ color: '#c9a84c', fontWeight: 500, fontSize: 14 }}>
                    {analysis.summary}
                  </span>
                </div>
                <div style={{
                  padding: 16,
                  borderRadius: 10,
                  background: 'rgba(26, 26, 36, 0.5)',
                  border: '1px solid rgba(255,255,255,0.04)',
                }}>
                  <Paragraph style={{
                    whiteSpace: 'pre-wrap',
                    margin: 0,
                    color: '#b0aea8',
                    fontSize: 13,
                    lineHeight: 1.7,
                  }}>
                    {analysis.detail}
                  </Paragraph>
                </div>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: 12,
                }}>
                  <Text style={{ fontSize: 12, color: '#5c5a55' }}>
                    分析时间：{new Date(analysis.created_at).toLocaleString('zh-CN')}
                  </Text>
                  <div style={{
                    display: 'flex',
                    gap: 16,
                    fontSize: 12,
                    color: '#5c5a55',
                  }}>
                    <span>市值 <strong style={{ color: '#9a9892' }}>¥{analysis.total_market_value.toFixed(2)}</strong></span>
                    <span>成本 <strong style={{ color: '#9a9892' }}>¥{analysis.total_cost.toFixed(2)}</strong></span>
                    <span>盈亏 <strong style={{
                      color: analysis.total_pnl >= 0 ? greenStyle.color : redStyle.color,
                    }}>{analysis.total_pnl >= 0 ? '+' : ''}{analysis.total_pnl_percent.toFixed(2)}%</strong></span>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{
                textAlign: 'center',
                padding: '40px 20px',
                color: '#5c5a55',
              }}>
                <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.5 }}>📊</div>
                <div style={{ fontSize: 15, fontWeight: 500, color: '#9a9892', marginBottom: 8 }}>
                  暂无分析报告
                </div>
                <div style={{ fontSize: 13 }}>
                  点击上方「一键 AI 分析」按钮开始分析您的投资组合
                </div>
              </div>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card
            title={
              <Space>
                <WalletOutlined style={goldStyle} />
                <span>持仓概览</span>
              </Space>
            }
            extra={
              <Button
                type="link"
                onClick={() => navigate('/assets')}
                style={{ color: '#c9a84c', fontSize: 13 }}
              >
                查看全部 →
              </Button>
            }
          >
            {assets.length > 0 ? (
              <Table
                dataSource={assets.slice(0, 5)}
                columns={assetColumns}
                rowKey="id"
                pagination={false}
                size="small"
                showHeader={false}
                style={{ margin: -4 }}
              />
            ) : (
              <div style={{
                textAlign: 'center',
                padding: '32px 20px',
                color: '#5c5a55',
              }}>
                <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.5 }}>💼</div>
                <div style={{ fontSize: 14, color: '#9a9892', marginBottom: 4 }}>
                  还没有资产记录
                </div>
                <Button
                  type="link"
                  onClick={() => navigate('/assets')}
                  style={{ color: '#c9a84c' }}
                >
                  去添加资产 →
                </Button>
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  )
}
