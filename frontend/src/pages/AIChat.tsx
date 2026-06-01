import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Row,
  Space,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import {
  ClearOutlined,
  DatabaseOutlined,
  MessageOutlined,
  ReloadOutlined,
  RobotOutlined,
  SendOutlined,
  UserOutlined,
} from '@ant-design/icons'
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
} from 'recharts'
import { AIChatContextResponse, AIChatMessage, chatApi } from '../api'

const { Paragraph, Text, Title } = Typography
const { TextArea } = Input

type ChatItem = AIChatMessage & {
  id: string
  model?: string
  createdAt: string
}

const STORAGE_KEY = 'ai_chat_messages_v1'

const formatAmount = (value?: number) => {
  if (value == null || Number.isNaN(value)) return '-'
  return `¥${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
}

const starterQuestions = [
  '我的整体资产组合目前最大的风险是什么？',
  '请结合持仓和标的池，给我一份本周重点观察清单。',
  '哪些持仓需要减仓或继续持有？请说明证据。',
  '如果我只想降低回撤，下一步应该怎么调整？',
]

const chartColors = ['#c9a84c', '#6bb6ff', '#7bd88f', '#f27d72', '#a78bfa', '#f6c177', '#82d8d8']

const renderInline = (text: string): ReactNode[] => {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean).map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={idx} style={{ color: '#f3df99' }}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={idx} style={{
          padding: '1px 5px',
          borderRadius: 5,
          background: 'rgba(255,255,255,0.08)',
          color: '#f6c177',
        }}>
          {part.slice(1, -1)}
        </code>
      )
    }
    return part
  })
}

function MarkdownContent({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const nodes: ReactNode[] = []
  let i = 0

  const isTableSeparator = (line?: string) => !!line && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(line)

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) {
      i += 1
      continue
    }

    if (trimmed.startsWith('```')) {
      const codeLines: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i += 1
      }
      i += 1
      nodes.push(
        <pre key={`code-${i}`} style={{
          margin: '10px 0',
          padding: 12,
          borderRadius: 8,
          overflowX: 'auto',
          background: 'rgba(0,0,0,0.28)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <code style={{ color: '#e8e6e3' }}>{codeLines.join('\n')}</code>
        </pre>,
      )
      continue
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      nodes.push(
        <div key={`h-${i}`} style={{
          margin: level <= 2 ? '14px 0 8px' : '10px 0 6px',
          fontSize: level <= 2 ? 17 : 15,
          fontWeight: 700,
          color: level <= 2 ? '#f3df99' : '#e8e6e3',
        }}>
          {renderInline(heading[2])}
        </div>,
      )
      i += 1
      continue
    }

    if (trimmed.includes('|') && isTableSeparator(lines[i + 1])) {
      const header = trimmed.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim())
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().includes('|')) {
        rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim()))
        i += 1
      }
      nodes.push(
        <div key={`table-${i}`} style={{ overflowX: 'auto', margin: '10px 0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {header.map((cell, idx) => (
                  <th key={idx} style={{ textAlign: 'left', padding: '7px 8px', color: '#f3df99', borderBottom: '1px solid rgba(201,168,76,0.18)' }}>
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => (
                <tr key={rowIdx}>
                  {header.map((_, cellIdx) => (
                    <td key={cellIdx} style={{ padding: '7px 8px', color: '#e8e6e3', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      {renderInline(row[cellIdx] || '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const ordered = /^\d+\.\s+/.test(trimmed)
      const items: string[] = []
      while (i < lines.length) {
        const item = lines[i].trim()
        if (ordered && /^\d+\.\s+/.test(item)) {
          items.push(item.replace(/^\d+\.\s+/, ''))
          i += 1
        } else if (!ordered && /^[-*]\s+/.test(item)) {
          items.push(item.replace(/^[-*]\s+/, ''))
          i += 1
        } else {
          break
        }
      }
      const ListTag = ordered ? 'ol' : 'ul'
      nodes.push(
        <ListTag key={`list-${i}`} style={{ margin: '8px 0 8px 20px', paddingLeft: 12 }}>
          {items.map((item, idx) => (
            <li key={idx} style={{ marginBottom: 5, color: '#e8e6e3', lineHeight: 1.72 }}>
              {renderInline(item)}
            </li>
          ))}
        </ListTag>,
      )
      continue
    }

    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''))
        i += 1
      }
      nodes.push(
        <blockquote key={`quote-${i}`} style={{
          margin: '10px 0',
          padding: '8px 12px',
          borderLeft: '3px solid #c9a84c',
          background: 'rgba(201,168,76,0.08)',
          color: '#d8d3c8',
        }}>
          {renderInline(quoteLines.join(' '))}
        </blockquote>,
      )
      continue
    }

    const paragraph: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,4})\s+/.test(lines[i].trim()) && !/^[-*]\s+/.test(lines[i].trim()) && !/^\d+\.\s+/.test(lines[i].trim()) && !lines[i].trim().startsWith('>') && !lines[i].trim().startsWith('```')) {
      paragraph.push(lines[i].trim())
      i += 1
    }
    nodes.push(
      <p key={`p-${i}`} style={{ margin: '8px 0', color: '#e8e6e3', lineHeight: 1.78 }}>
        {renderInline(paragraph.join(' '))}
      </p>,
    )
  }

  return <div>{nodes}</div>
}

function EmptyChart() {
  return <div style={{ height: 128, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5c5a55', fontSize: 12 }}>暂无数据</div>
}

function ChartBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{
      paddingTop: 12,
      borderTop: '1px solid rgba(255,255,255,0.06)',
    }}>
      <Text strong style={{ display: 'block', marginBottom: 8, color: '#e8e6e3' }}>{title}</Text>
      {children}
    </div>
  )
}

export default function AIChat() {
  const [messages, setMessages] = useState<ChatItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    } catch {
      return []
    }
  })
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [context, setContext] = useState<AIChatContextResponse | null>(null)
  const [contextLoading, setContextLoading] = useState(true)
  const [includeLiveQuotes, setIncludeLiveQuotes] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  const samples = useMemo(() => {
    const serverSamples = context?.sample_questions || []
    return serverSamples.length ? serverSamples : starterQuestions
  }, [context])

  const loadContext = async () => {
    setContextLoading(true)
    try {
      const data = await chatApi.context(includeLiveQuotes)
      setContext(data)
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '上下文加载失败')
    } finally {
      setContextLoading(false)
    }
  }

  useEffect(() => {
    loadContext()
  }, [includeLiveQuotes])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)))
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const ask = async (text?: string) => {
    const content = (text ?? input).trim()
    if (!content || loading) return

    const userMessage: ChatItem = {
      id: `u-${Date.now()}`,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setInput('')
    setLoading(true)

    try {
      const history = messages
        .slice(-12)
        .map(({ role, content }) => ({ role, content }))
      const result = await chatApi.ask(content, history, includeLiveQuotes)
      setMessages(prev => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: result.answer,
          model: result.model,
          createdAt: new Date().toISOString(),
        },
      ])
      if (result.context_meta) {
        setContext(prev => prev ? ({ ...prev, summary: { ...prev.summary, ...result.context_meta } }) : prev)
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || 'AI Chat 调用失败')
      setMessages(prev => prev.filter(item => item.id !== userMessage.id))
    } finally {
      setLoading(false)
    }
  }

  const clearMessages = () => {
    setMessages([])
    localStorage.removeItem(STORAGE_KEY)
  }

  const portfolio = context?.summary?.portfolio || {}
  const visual = context?.summary?.visual_data || {}
  const pnlRows = visual.pnl_by_asset || []
  const maxAbsPnl = Math.max(...pnlRows.map((item: any) => Math.abs(Number(item.value) || 0)), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 'calc(100vh - 112px)' }}>
      <Row gutter={[16, 16]} align="stretch">
        <Col xs={24} xl={17}>
          <Card
            title={
              <Space>
                <RobotOutlined style={{ color: '#c9a84c' }} />
                <span>AI Chat</span>
              </Space>
            }
            extra={
              <Space>
                <Text style={{ color: '#9a9892' }}>实时行情</Text>
                <Switch size="small" checked={includeLiveQuotes} onChange={setIncludeLiveQuotes} />
                <Tooltip title="刷新上下文">
                  <Button icon={<ReloadOutlined />} onClick={loadContext} loading={contextLoading} />
                </Tooltip>
                <Tooltip title="清空会话">
                  <Button icon={<ClearOutlined />} onClick={clearMessages} disabled={messages.length === 0 || loading} />
                </Tooltip>
              </Space>
            }
            styles={{ body: { padding: 0 } }}
            style={{ height: '100%', minHeight: 640 }}
          >
            <div
              ref={scrollRef}
              style={{
                height: 'calc(100vh - 310px)',
                minHeight: 420,
                overflowY: 'auto',
                padding: 20,
              }}
            >
              {messages.length === 0 ? (
                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={<Text style={{ color: '#9a9892' }}>选择一个问题，或直接输入你的问题</Text>}
                  />
                </div>
              ) : (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  {messages.map(item => {
                    const isUser = item.role === 'user'
                    return (
                      <div
                        key={item.id}
                        style={{
                          display: 'flex',
                          justifyContent: isUser ? 'flex-end' : 'flex-start',
                          gap: 10,
                        }}
                      >
                        {!isUser && (
                          <div style={{
                            width: 34,
                            height: 34,
                            borderRadius: 8,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'rgba(201, 168, 76, 0.12)',
                            color: '#c9a84c',
                            flex: '0 0 auto',
                          }}>
                            <RobotOutlined />
                          </div>
                        )}
                        <div
                          style={{
                            maxWidth: 'min(780px, 82%)',
                            border: `1px solid ${isUser ? 'rgba(201, 168, 76, 0.28)' : 'rgba(255,255,255,0.08)'}`,
                            background: isUser ? 'rgba(201, 168, 76, 0.12)' : 'rgba(17, 17, 24, 0.72)',
                            borderRadius: 8,
                            padding: '12px 14px',
                          }}
                        >
                          {isUser ? (
                            <Paragraph
                              style={{
                                color: '#e8e6e3',
                                whiteSpace: 'pre-wrap',
                                marginBottom: 0,
                                lineHeight: 1.72,
                              }}
                            >
                              {item.content}
                            </Paragraph>
                          ) : (
                            <MarkdownContent content={item.content} />
                          )}
                          <div style={{ marginTop: 8, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                            <Text style={{ color: '#5c5a55', fontSize: 12 }}>
                              {new Date(item.createdAt).toLocaleString('zh-CN')}
                            </Text>
                            {item.model ? <Tag color="gold">{item.model}</Tag> : null}
                          </div>
                        </div>
                        {isUser && (
                          <div style={{
                            width: 34,
                            height: 34,
                            borderRadius: 8,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'rgba(255, 255, 255, 0.06)',
                            color: '#e8e6e3',
                            flex: '0 0 auto',
                          }}>
                            <UserOutlined />
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {loading ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#9a9892' }}>
                      <Spin size="small" />
                      <span>AI 正在分析当前 APP 上下文...</span>
                    </div>
                  ) : null}
                </Space>
              )}
            </div>

            <div style={{ borderTop: '1px solid rgba(201,168,76,0.12)', padding: 16 }}>
              <Space wrap style={{ marginBottom: 12 }}>
                {samples.map(question => (
                  <Button
                    key={question}
                    size="small"
                    icon={<MessageOutlined />}
                    onClick={() => ask(question)}
                    disabled={loading}
                  >
                    {question}
                  </Button>
                ))}
              </Space>
              <Space.Compact style={{ width: '100%', alignItems: 'stretch' }}>
                <TextArea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onPressEnter={e => {
                    if (!e.shiftKey) {
                      e.preventDefault()
                      ask()
                    }
                  }}
                  placeholder="输入你的投资分析问题"
                  autoSize={{ minRows: 2, maxRows: 5 }}
                  disabled={loading}
                  style={{ resize: 'none' }}
                />
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  onClick={() => ask()}
                  loading={loading}
                  disabled={!input.trim()}
                  style={{ height: 'auto', minWidth: 92 }}
                >
                  发送
                </Button>
              </Space.Compact>
            </div>
          </Card>
        </Col>

        <Col xs={24} xl={7}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card title={<Space><DatabaseOutlined style={{ color: '#c9a84c' }} />上下文</Space>}>
              {contextLoading ? (
                <Spin />
              ) : (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Row gutter={[8, 8]}>
                    <Col span={12}><Tag style={{ width: '100%', textAlign: 'center', padding: '6px 0' }}>持仓 {context?.summary?.asset_count ?? 0}</Tag></Col>
                    <Col span={12}><Tag style={{ width: '100%', textAlign: 'center', padding: '6px 0' }}>标的 {context?.summary?.target_count ?? 0}</Tag></Col>
                    <Col span={12}><Tag style={{ width: '100%', textAlign: 'center', padding: '6px 0' }}>额度 {context?.summary?.budget_count ?? 0}</Tag></Col>
                    <Col span={12}><Tag style={{ width: '100%', textAlign: 'center', padding: '6px 0' }}>技能 {context?.summary?.installed_skill_count ?? 0}</Tag></Col>
                  </Row>
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
                    <Title level={5} style={{ margin: 0, marginBottom: 8 }}>组合概览</Title>
                    <Space direction="vertical" size={6}>
                      <Text style={{ color: '#9a9892' }}>市值 <Text strong>{formatAmount(portfolio.total_market_value)}</Text></Text>
                      <Text style={{ color: '#9a9892' }}>成本 <Text strong>{formatAmount(portfolio.total_cost)}</Text></Text>
                      <Text style={{ color: '#9a9892' }}>
                        盈亏 <Text strong style={{ color: (portfolio.total_pnl || 0) >= 0 ? 'oklch(72% 0.14 145)' : 'oklch(65% 0.18 25)' }}>
                          {formatAmount(portfolio.total_pnl)} ({portfolio.total_pnl_percent ?? 0}%)
                        </Text>
                      </Text>
                    </Space>
                  </div>
                  <ChartBlock title="市场分布">
                    {(visual.allocation_by_market || []).length ? (
                      <ResponsiveContainer width="100%" height={150}>
                        <PieChart>
                          <Pie
                            data={visual.allocation_by_market}
                            dataKey="value"
                            nameKey="label"
                            innerRadius={42}
                            outerRadius={62}
                            paddingAngle={2}
                          >
                            {(visual.allocation_by_market || []).map((_: any, idx: number) => (
                              <Cell key={idx} fill={chartColors[idx % chartColors.length]} />
                            ))}
                          </Pie>
                          <ChartTooltip
                            formatter={(value: any) => formatAmount(Number(value))}
                            contentStyle={{ background: '#1a1a24', border: '1px solid rgba(201,168,76,0.18)', borderRadius: 8, color: '#e8e6e3' }}
                            labelStyle={{ color: '#e8e6e3' }}
                            itemStyle={{ color: '#e8e6e3' }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : <EmptyChart />}
                  </ChartBlock>
                  <ChartBlock title="资产类型">
                    {(visual.allocation_by_type || []).length ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {(visual.allocation_by_type || []).map((item: any, idx: number) => {
                          const max = Math.max(...(visual.allocation_by_type || []).map((row: any) => row.value || 0), 1)
                          return (
                            <div key={item.name}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
                                <Text style={{ color: '#9a9892', fontSize: 12 }}>{item.label || item.name}</Text>
                                <Text style={{ color: '#e8e6e3', fontSize: 12 }}>{formatAmount(item.value)}</Text>
                              </div>
                              <div style={{ height: 7, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                                <div style={{ width: `${Math.max(4, (item.value / max) * 100)}%`, height: '100%', background: chartColors[idx % chartColors.length] }} />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : <EmptyChart />}
                  </ChartBlock>
                  <ChartBlock title="持仓盈亏">
                    {pnlRows.length ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {pnlRows.map((item: any, idx: number) => {
                          const pnl = Number(item.value) || 0
                          const color = pnl >= 0 ? 'oklch(72% 0.14 145)' : 'oklch(65% 0.18 25)'
                          const width = `${Math.max(3, Math.abs(pnl) / maxAbsPnl * 100)}%`
                          const name = item.name || item.code || `资产 ${idx + 1}`
                          return (
                            <div key={`${item.code || name}-${idx}`}>
                              <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'flex-start',
                                gap: 10,
                                marginBottom: 4,
                              }}>
                                <Tooltip title={name}>
                                  <Text style={{
                                    color: '#9a9892',
                                    fontSize: 12,
                                    lineHeight: 1.35,
                                    whiteSpace: 'normal',
                                    wordBreak: 'break-word',
                                  }}>
                                    {name}
                                  </Text>
                                </Tooltip>
                                <Text style={{
                                  flex: '0 0 auto',
                                  color,
                                  fontSize: 12,
                                  fontWeight: 600,
                                  whiteSpace: 'nowrap',
                                }}>
                                  {formatAmount(pnl)} / {item.pnl_percent ?? 0}%
                                </Text>
                              </div>
                              <div style={{
                                height: 8,
                                borderRadius: 4,
                                background: 'rgba(255,255,255,0.08)',
                                overflow: 'hidden',
                              }}>
                                <div style={{
                                  width,
                                  height: '100%',
                                  borderRadius: 4,
                                  background: color,
                                }} />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : <EmptyChart />}
                  </ChartBlock>
                  <ChartBlock title="标的优先级">
                    {(visual.targets_by_priority || []).length ? (
                      <Space wrap>
                        {(visual.targets_by_priority || []).map((item: any, idx: number) => (
                          <Tag key={item.name} color={idx === 0 ? 'gold' : idx === 1 ? 'blue' : 'default'}>
                            {item.label || item.name}：{item.value}
                          </Tag>
                        ))}
                      </Space>
                    ) : <EmptyChart />}
                  </ChartBlock>
                </Space>
              )}
            </Card>
            <Alert
              type="info"
              showIcon
              message="分析边界"
              description="AI 会使用当前应用数据回答；行情或基本面缺失时，结论会以已知数据为准。"
            />
          </Space>
        </Col>
      </Row>
    </div>
  )
}
