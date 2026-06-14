import { useEffect, useMemo, useState } from 'react'
import {
  Alert, Button, Card, Checkbox, Col, Descriptions, Empty, message, Modal, Progress,
  Row, Space, Spin, Table, Tag, Tooltip, Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  BarChartOutlined, CheckCircleOutlined, ClockCircleOutlined, CommentOutlined,
  DatabaseOutlined, EyeOutlined, ReloadOutlined, RocketOutlined, ThunderboltOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { ipoApi, IPOAnalysisItem, IPOAnalysisResponse, IPOItem, IPOListResponse, IPOMarket } from '../api'
import { useAIWorkContext } from '../stores/AIWorkContext'

const { Text, Paragraph } = Typography

const goldStyle = { color: '#c9a84c' }
const marketOptions: Array<{ label: string; value: IPOMarket }> = [
  { label: 'A 股', value: 'A' },
  { label: '港股', value: 'HK' },
  { label: '美股', value: 'US' },
]

const marketLabels: Record<string, string> = { A: 'A股', HK: '港股', US: '美股' }
const statusLabels: Record<string, string> = {
  upcoming: '即将申购',
  subscribing: '申购中',
  pending_listing: '待上市',
  listed: '已上市',
}

const formatNumber = (value?: number | null, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-'
  if (Math.abs(value) >= 100000000) return `${(value / 100000000).toFixed(digits)}亿`
  if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(digits)}万`
  return Number(value).toFixed(digits).replace(/\.00$/, '')
}

const currencySymbol = (currency?: string) => {
  if (currency === 'HKD') return 'HK$'
  if (currency === 'USD') return '$'
  return '¥'
}

const formatPrice = (item: IPOItem) => {
  if (item.issue_price != null) return `${currencySymbol(item.currency)}${formatNumber(item.issue_price, 2)}`
  if (item.price_range) return `${currencySymbol(item.currency)}${item.price_range}`
  return '-'
}

const recommendationColor = (value?: string) => {
  if (value === 'SUBSCRIBE') return '#40d280'
  if (value === 'WATCH') return '#c9a84c'
  return '#ff4d4f'
}

const scoreColor = (value: number) => {
  if (value >= 68) return '#40d280'
  if (value >= 52) return '#c9a84c'
  return '#ff4d4f'
}

const IPO_MARKETS_STORAGE_KEY = 'ipo_page_markets'
const IPO_SELECTED_ROWS_STORAGE_KEY = 'ipo_page_selected_rows'
const IPO_ANALYSIS_STORAGE_KEY = 'ipo_page_latest_analysis'

const readJsonStorage = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

const normalizeStoredMarkets = (value: unknown): IPOMarket[] => {
  const valid = new Set<IPOMarket>(['A', 'HK', 'US'])
  const rows = Array.isArray(value) ? value : []
  const markets = rows.filter((item): item is IPOMarket => valid.has(item))
  return markets.length ? markets : ['A', 'HK', 'US']
}

export default function IPO() {
  const aiCtx = useAIWorkContext()
  const [markets, setMarkets] = useState<IPOMarket[]>(() => normalizeStoredMarkets(readJsonStorage(IPO_MARKETS_STORAGE_KEY, ['A', 'HK', 'US'])))
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<IPOListResponse | null>(null)
  const [analysis, setAnalysis] = useState<IPOAnalysisResponse | null>(() => readJsonStorage<IPOAnalysisResponse | null>(IPO_ANALYSIS_STORAGE_KEY, null))
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>(() => readJsonStorage<string[]>(IPO_SELECTED_ROWS_STORAGE_KEY, []))
  const [detailItem, setDetailItem] = useState<IPOItem | null>(null)

  const analysisMap = useMemo(() => {
    const map = new Map<string, IPOAnalysisItem>()
    ;(analysis?.analyses || []).forEach(item => map.set(item.ipo_id, item))
    return map
  }, [analysis])

  const selectedItems = useMemo(() => {
    const keys = new Set(selectedRowKeys.map(String))
    return (data?.items || []).filter(item => keys.has(item.id))
  }, [data?.items, selectedRowKeys])

  const loadData = async (force = false) => {
    setLoading(true)
    try {
      const next = await ipoApi.list({ markets, limit: 40, force_refresh: force })
      setData(next)
      if (force) message.success('新股数据已刷新')
      ipoApi.latestAnalysis().then(setAnalysis).catch(() => {})
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || '新股数据获取失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [markets.join(',')])

  useEffect(() => {
    localStorage.setItem(IPO_MARKETS_STORAGE_KEY, JSON.stringify(markets))
  }, [markets])

  useEffect(() => {
    localStorage.setItem(IPO_SELECTED_ROWS_STORAGE_KEY, JSON.stringify(selectedRowKeys.map(String)))
  }, [selectedRowKeys])

  useEffect(() => {
    if (analysis) {
      localStorage.setItem(IPO_ANALYSIS_STORAGE_KEY, JSON.stringify(analysis))
    }
  }, [analysis])

  const runAI = async () => {
    const items = selectedItems.length > 0 ? selectedItems : (data?.items || [])
    if (items.length === 0) {
      message.warning('暂无可分析的新股数据')
      return
    }
    aiCtx.startTask(`AI 新股打新分析（${items.length} 只）`)
    try {
      aiCtx.addLog('正在结合发行数据、数据源状态和评论摘要评估打新胜率...', 'info')
      const result = await ipoApi.analyze({
        markets,
        items,
        limit: items.length,
        source_status: data?.source_status || {},
      })
      setAnalysis(result)
      aiCtx.addLog('✅ 新股打新分析已生成', 'success')
      aiCtx.completeTask()
    } catch (e: any) {
      aiCtx.failTask(e?.response?.data?.detail || e?.message || '新股打新分析失败')
    }
  }

  const columns: ColumnsType<IPOItem> = [
    {
      title: '市场',
      dataIndex: 'market',
      width: 84,
      render: value => (
        <Tag style={{ margin: 0, borderRadius: 4, background: 'rgba(201,168,76,0.12)', color: '#c9a84c', borderColor: 'rgba(201,168,76,0.24)' }}>
          {marketLabels[value] || value}
        </Tag>
      ),
    },
    {
      title: '新股',
      dataIndex: 'name',
      width: 220,
      render: (_, item) => (
        <Space direction="vertical" size={0}>
          <Space size={6} style={{ flexWrap: 'wrap' }}>
            <Text strong style={{ color: '#e8e6e3' }}>{item.name || item.code}</Text>
            <Text style={{ color: '#5c5a55', fontSize: 12 }}>{item.code}</Text>
          </Space>
          <Text style={{ color: '#8f8a82', fontSize: 12 }}>{item.exchange || item.sector || '-'}</Text>
        </Space>
      ),
    },
    {
      title: '申购/上市',
      width: 160,
      render: (_, item) => (
        <Space direction="vertical" size={0}>
          <Text style={{ color: '#e8e6e3', fontSize: 12 }}>申购 {item.apply_date || '-'}</Text>
          <Text style={{ color: '#8f8a82', fontSize: 12 }}>上市 {item.listing_date || '-'}</Text>
        </Space>
      ),
    },
    {
      title: '发行价',
      width: 110,
      render: (_, item) => <Text style={{ color: '#e8e6e3' }}>{formatPrice(item)}</Text>,
    },
    {
      title: '估值',
      width: 130,
      render: (_, item) => (
        <Space direction="vertical" size={0}>
          <Text style={{ color: '#e8e6e3', fontSize: 12 }}>PE {formatNumber(item.issue_pe, 2)}</Text>
          <Text style={{ color: '#8f8a82', fontSize: 12 }}>行业 {formatNumber(item.industry_pe, 2)}</Text>
        </Space>
      ),
    },
    {
      title: '热度',
      width: 120,
      render: (_, item) => (
        <Space direction="vertical" size={0}>
          <Text style={{ color: '#e8e6e3', fontSize: 12 }}>{formatNumber(item.subscription_multiple, 2)}倍</Text>
          <Text style={{ color: '#8f8a82', fontSize: 12 }}>中签 {formatNumber(item.winning_rate, 4)}</Text>
        </Space>
      ),
    },
    {
      title: 'AI 结论',
      width: 180,
      render: (_, item) => {
        const row = analysisMap.get(item.id)
        if (!row) return <Text style={{ color: '#5c5a55', fontSize: 12 }}>待分析</Text>
        return (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Tag style={{ margin: 0, borderRadius: 4, color: recommendationColor(row.recommendation), background: `${recommendationColor(row.recommendation)}18`, borderColor: `${recommendationColor(row.recommendation)}44` }}>
              {row.recommendation_label}
            </Tag>
            <Progress percent={Math.round(row.win_probability)} size="small" strokeColor={scoreColor(row.win_probability)} trailColor="rgba(255,255,255,0.06)" />
          </Space>
        )
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: value => (
        <Tag style={{ margin: 0, borderRadius: 4, background: 'rgba(255,255,255,0.04)', color: '#b0aea8', borderColor: 'rgba(255,255,255,0.08)' }}>
          {statusLabels[value] || value || '未知'}
        </Tag>
      ),
    },
    {
      title: '',
      width: 64,
      render: (_, item) => (
        <Tooltip title="查看详情">
          <Button size="small" type="text" icon={<EyeOutlined />} onClick={() => setDetailItem(item)} />
        </Tooltip>
      ),
    },
  ]

  if (loading && !data) {
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
            <RocketOutlined style={goldStyle} />
            <span>新股打新</span>
          </Space>
        }
        extra={
          <Space size={8} style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Checkbox.Group
              value={markets}
              options={marketOptions}
              onChange={values => {
                const next = values as IPOMarket[]
                if (next.length === 0) {
                  message.warning('至少选择一个市场')
                  return
                }
                localStorage.setItem(IPO_MARKETS_STORAGE_KEY, JSON.stringify(next))
                setMarkets(next)
              }}
              disabled={loading || aiCtx.state.isRunning}
            />
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => loadData(true)}>
              刷新数据
            </Button>
            <Button type="primary" icon={<ThunderboltOutlined />} loading={aiCtx.state.isRunning} onClick={runAI}>
              AI 分析打新
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Row gutter={[12, 12]}>
            {['A', 'HK', 'US'].map(market => {
              const status = data?.source_status?.[market]
              return (
                <Col xs={24} md={8} key={market}>
                  <div style={{
                    padding: 12,
                    borderRadius: 8,
                    background: 'rgba(0,0,0,0.18)',
                    border: status?.ok ? '1px solid rgba(64,210,128,0.16)' : '1px solid rgba(255,77,79,0.18)',
                    minHeight: 116,
                  }}>
                    <Space size={8} style={{ marginBottom: 6 }}>
                      {status?.ok ? <CheckCircleOutlined style={{ color: '#40d280' }} /> : <WarningOutlined style={{ color: '#ff4d4f' }} />}
                      <Text style={{ color: '#e8e6e3', fontWeight: 600 }}>{marketLabels[market]}</Text>
                      <Tag style={{ margin: 0, borderRadius: 4, fontSize: 11 }}>{status?.count || 0} 条</Tag>
                    </Space>
                    <Text style={{ color: '#c9a84c', fontSize: 12, display: 'block' }}>
                      {status?.label || data?.providers?.[market] || '-'}
                    </Text>
                    <Paragraph ellipsis={{ rows: 2 }} style={{ color: '#8f8a82', fontSize: 12, margin: '6px 0 0' }}>
                      {status?.ok ? (status.note || '数据源可用') : (status?.error || '数据源暂不可达，请稍后刷新')}
                    </Paragraph>
                  </div>
                </Col>
              )
            })}
          </Row>

          {analysis?.summary ? (
            <Alert
              type="info"
              showIcon
              icon={<BarChartOutlined />}
              message={analysis.summary}
              description={analysis.market_view?.notes?.length ? analysis.market_view.notes.join('；') : undefined}
              style={{ background: 'rgba(201,168,76,0.06)', borderColor: 'rgba(201,168,76,0.16)' }}
            />
          ) : null}
        </Space>
      </Card>

      <Card
        title={
          <Space>
            <ClockCircleOutlined style={goldStyle} />
            <span>最新新股数据</span>
            <Text style={{ color: '#5c5a55', fontSize: 12 }}>更新时间 {data?.generated_at || '-'}</Text>
          </Space>
        }
      >
        {!data?.items?.length ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无新股数据，请检查数据源配置或稍后刷新" />
        ) : (
          <Table
            rowKey="id"
            size="small"
            loading={loading}
            columns={columns}
            dataSource={data.items}
            pagination={{ pageSize: 12, showSizeChanger: false }}
            scroll={{ x: 1200 }}
            rowSelection={{
              selectedRowKeys,
              onChange: setSelectedRowKeys,
              preserveSelectedRowKeys: true,
            }}
          />
        )}
      </Card>

      {analysis?.analyses?.length ? (
        <Card
          title={
            <Space>
              <ThunderboltOutlined style={goldStyle} />
              <span>AI 打新判断</span>
            </Space>
          }
        >
          <Row gutter={[12, 12]}>
            {analysis.analyses.map(item => (
              <Col xs={24} lg={12} xl={8} key={item.ipo_id}>
                <div style={{
                  height: '100%',
                  padding: 14,
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.025)',
                  border: `1px solid ${recommendationColor(item.recommendation)}33`,
                }}>
                  <Space direction="vertical" size={10} style={{ width: '100%' }}>
                    <Space style={{ width: '100%', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <Space direction="vertical" size={0}>
                        <Space size={6} style={{ flexWrap: 'wrap' }}>
                          <Text strong style={{ color: '#e8e6e3' }}>{item.name}</Text>
                          <Text style={{ color: '#5c5a55', fontSize: 12 }}>{item.code}</Text>
                        </Space>
                        <Text style={{ color: '#8f8a82', fontSize: 12 }}>{item.market_label}</Text>
                      </Space>
                      <Tag style={{ margin: 0, borderRadius: 4, color: recommendationColor(item.recommendation), background: `${recommendationColor(item.recommendation)}18`, borderColor: `${recommendationColor(item.recommendation)}44` }}>
                        {item.recommendation_label}
                      </Tag>
                    </Space>
                    <Row gutter={10}>
                      <Col span={12}>
                        <Text style={{ color: '#5c5a55', fontSize: 11 }}>胜率评分</Text>
                        <Progress percent={Math.round(item.win_probability)} strokeColor={scoreColor(item.win_probability)} trailColor="rgba(255,255,255,0.06)" />
                      </Col>
                      <Col span={12}>
                        <Text style={{ color: '#5c5a55', fontSize: 11 }}>盈利预期</Text>
                        <div style={{ color: item.expected_profit_pct >= 0 ? '#40d280' : '#ff4d4f', fontWeight: 700, fontSize: 18 }}>
                          {item.expected_profit_pct >= 0 ? '+' : ''}{item.expected_profit_pct.toFixed(2)}%
                        </div>
                        <Text style={{ color: '#8f8a82', fontSize: 11 }}>{item.expected_profit_range}</Text>
                      </Col>
                    </Row>
                    <Paragraph style={{ color: '#cfcac1', fontSize: 12, lineHeight: 1.7, margin: 0 }}>
                      {item.action}
                    </Paragraph>
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      {(item.key_reasons || []).slice(0, 3).map((reason, idx) => (
                        <Text key={idx} style={{ color: '#b0aea8', fontSize: 12 }}>• {reason}</Text>
                      ))}
                    </Space>
                    {(item.comment_insights || []).length ? (
                      <div style={{ padding: 10, borderRadius: 8, background: 'rgba(201,168,76,0.05)', border: '1px solid rgba(201,168,76,0.1)' }}>
                        <Space size={6} style={{ marginBottom: 4 }}>
                          <CommentOutlined style={goldStyle} />
                          <Text style={{ color: '#c9a84c', fontSize: 12 }}>评论/情绪</Text>
                        </Space>
                        {(item.comment_insights || []).slice(0, 2).map((comment, idx) => (
                          <Text key={idx} style={{ color: '#b0aea8', fontSize: 12, display: 'block', lineHeight: 1.6 }}>{comment}</Text>
                        ))}
                      </div>
                    ) : null}
                  </Space>
                </div>
              </Col>
            ))}
          </Row>
        </Card>
      ) : null}

      <Modal
        title={
          <Space>
            <DatabaseOutlined style={goldStyle} />
            <span>{detailItem?.name || '新股详情'}</span>
          </Space>
        }
        open={Boolean(detailItem)}
        onCancel={() => setDetailItem(null)}
        footer={null}
        width={760}
      >
        {detailItem ? (
          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <Descriptions column={2} size="small" colon={false}
              styles={{ label: { color: '#5c5a55' }, content: { color: '#e8e6e3' } }}
            >
              <Descriptions.Item label="市场">{marketLabels[detailItem.market]}</Descriptions.Item>
              <Descriptions.Item label="代码">{detailItem.code}</Descriptions.Item>
              <Descriptions.Item label="公司">{detailItem.company_name || detailItem.name}</Descriptions.Item>
              <Descriptions.Item label="交易所">{detailItem.exchange || '-'}</Descriptions.Item>
              <Descriptions.Item label="行业">{detailItem.sector || '-'}</Descriptions.Item>
              <Descriptions.Item label="状态">{statusLabels[detailItem.status] || detailItem.status || '-'}</Descriptions.Item>
              <Descriptions.Item label="申购日">{detailItem.apply_date || '-'}</Descriptions.Item>
              <Descriptions.Item label="上市日">{detailItem.listing_date || '-'}</Descriptions.Item>
              <Descriptions.Item label="发行价">{formatPrice(detailItem)}</Descriptions.Item>
              <Descriptions.Item label="募资规模">{formatNumber(detailItem.fundraising_amount, 2)}</Descriptions.Item>
              <Descriptions.Item label="发行 PE">{formatNumber(detailItem.issue_pe, 2)}</Descriptions.Item>
              <Descriptions.Item label="行业 PE">{formatNumber(detailItem.industry_pe, 2)}</Descriptions.Item>
              <Descriptions.Item label="申购上限">{formatNumber(detailItem.online_apply_limit, 0)}</Descriptions.Item>
              <Descriptions.Item label="顶格资金">{formatNumber(detailItem.estimated_required_cash, 2)}</Descriptions.Item>
              <Descriptions.Item label="保荐/承销">{detailItem.sponsor || '-'}</Descriptions.Item>
              <Descriptions.Item label="来源">{detailItem.source_label}</Descriptions.Item>
            </Descriptions>
            {detailItem.business ? (
              <div style={{ padding: 12, borderRadius: 8, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <Text style={{ color: '#c9a84c', fontSize: 12, display: 'block', marginBottom: 6 }}>主营业务</Text>
                <Text style={{ color: '#cfcac1', fontSize: 12, lineHeight: 1.7 }}>{detailItem.business}</Text>
              </div>
            ) : null}
            <div style={{ padding: 12, borderRadius: 8, background: 'rgba(201,168,76,0.05)', border: '1px solid rgba(201,168,76,0.1)' }}>
              <Text style={{ color: '#c9a84c', fontSize: 12, display: 'block', marginBottom: 6 }}>评论/情绪摘要</Text>
              {(detailItem.comments || []).map((comment, idx) => (
                <Text key={idx} style={{ color: '#b0aea8', fontSize: 12, lineHeight: 1.7, display: 'block' }}>
                  {comment.content}
                </Text>
              ))}
            </div>
          </Space>
        ) : null}
      </Modal>
    </Space>
  )
}
