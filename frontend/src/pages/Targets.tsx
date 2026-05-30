import { useState, useEffect, useCallback, useRef } from 'react'
import { useAIWorkContext } from '../stores/AIWorkContext'
import {
  Card, Table, Button, Modal, Form, Input, Select, Space,
  Tag, message, Row, Col, Typography, Tooltip, Popconfirm, Popover,
  Radio, Spin
} from 'antd'
import {
  PlusOutlined, DeleteOutlined, BulbOutlined,
  RobotOutlined, ThunderboltOutlined, AimOutlined,
  StarOutlined, StarFilled, InfoCircleOutlined,
  FundOutlined, LineChartOutlined, GlobalOutlined,
  ThunderboltFilled, ExperimentOutlined, ClearOutlined,
  WarningOutlined, BarChartOutlined
} from '@ant-design/icons'

import { targetsApi, marketApi, settingsApi, Target, MarketHistoryItem, RecommendationStats } from '../api'
import {
  InteractiveKLineChart,
  type KLineInterval,
  KLineIntervalSelector,
  kLineHistoryParams,
} from '../components/MarketCharts'

const { Text } = Typography

const goldStyle = { color: '#c9a84c' }
const priorityColors: Record<string, string> = {
  HIGH: '#c9a84c', MEDIUM: '#e8d48b', LOW: '#a0893c',
}
const riskColors: Record<string, string> = {
  HIGH: '#cf1322', MEDIUM: '#c9a84c', LOW: '#3f8600',
}
const sourceLabels: Record<string, string> = { manual: '手动添加', ai_recommended: 'AI 推荐' }

const marketFilterOptions = [
  { label: '全部市场', value: '' },
  { label: 'A 股', value: 'A' },
  { label: '港股', value: 'HK' },
  { label: '美股', value: 'US' },
]

const assetTypeFilterOptions = [
  { label: '全部类型', value: '' },
  { label: '股票', value: 'stock' },
  { label: '场内基金', value: 'onshore_fund' },
  { label: '场外基金', value: 'offshore_fund' },
]

const sourceFilterOptions = [
  { label: '全部来源', value: '' },
  { label: '手动添加', value: 'manual' },
  { label: 'AI 推荐', value: 'ai_recommended' },
]

const groupByOptions = [
  { label: '不分组', value: 'none' },
  { label: '按类型', value: 'asset_type' },
  { label: '按来源', value: 'source' },
  { label: '按市场', value: 'market' },
]

const groupLabels: Record<string, Record<string, string>> = {
  asset_type: { stock: '股票', offshore_fund: '场外基金', onshore_fund: '场内基金' },
  source: { manual: '手动添加', ai_recommended: 'AI 推荐' },
  market: { A: 'A 股', HK: '港股', US: '美股' },
}

const assetTypeMap: Record<string, string> = {
  stock: '股票', offshore_fund: '场外基金', onshore_fund: '场内基金',
}

const marketColors: Record<string, string> = { A: '#c9a84c', HK: '#e8d48b', US: '#a0893c' }

const chartCache = new Map<string, MarketHistoryItem[]>()
const chartRequestCache = new Map<string, Promise<MarketHistoryItem[]>>()
const fundaCache = new Map<number, any>()
const fundaRequestCache = new Map<number, Promise<any>>()

const fundamentalGroups: { label: string; keys: string[] }[] = [
  { label: '估值', keys: ['trailing_pe', 'forward_pe', 'price_to_book'] },
  { label: '分红', keys: ['dividend_yield', 'dividend_rate', 'payout_ratio'] },
  { label: '盈利能力', keys: ['eps', 'profit_margins', 'operating_margins', 'return_on_equity', 'return_on_assets'] },
  { label: '成长性', keys: ['revenue_growth', 'earnings_growth'] },
  { label: '财务健康', keys: ['debt_to_equity', 'current_ratio', 'quick_ratio', 'beta', 'book_value'] },
  { label: '规模', keys: ['market_cap', 'revenue', 'shares_outstanding'] },
]

const fundamentalLabels: Record<string, string> = {
  trailing_pe: '市盈率 (TTM)', forward_pe: '远期市盈率',
  price_to_book: '市净率', dividend_yield: '股息率',
  dividend_rate: '每股股息/分红', payout_ratio: '派息率',
  eps: '每股收益', book_value: '每股净资产',
  market_cap: '总市值', beta: 'Beta 系数',
  revenue: '营业收入', revenue_growth: '营收增长率',
  profit_margins: '利润率', operating_margins: '营业利润率',
  return_on_equity: '净资产收益率 (ROE)',
  return_on_assets: '总资产收益率 (ROA)',
  debt_to_equity: '资产负债率', current_ratio: '流动比率',
  quick_ratio: '速动比率', earnings_growth: '盈利增长率',
  shares_outstanding: '总股本', short_ratio: '做空比率',
}

const fundamentalUnits: Record<string, string> = {
  trailing_pe: '倍', forward_pe: '倍',
  price_to_book: '倍', dividend_yield: '%',
  dividend_rate: '元/股', payout_ratio: '%',
  eps: '元', book_value: '元',
  market_cap: '亿', beta: '',
  revenue: '亿', revenue_growth: '%',
  profit_margins: '%', operating_margins: '%',
  return_on_equity: '%', return_on_assets: '%',
  debt_to_equity: '%', current_ratio: '',
  quick_ratio: '', earnings_growth: '%',
  shares_outstanding: '亿', short_ratio: '%',
}

function formatFundamental(value: any, key: string): string {
  if (value == null) return '-'
  let num = typeof value === 'number' ? value : parseFloat(value)
  if (isNaN(num)) return String(value)
  if (['market_cap', 'revenue', 'shares_outstanding'].includes(key)) {
    num = num / 1e8
  }
  if (['dividend_yield', 'payout_ratio', 'revenue_growth', 'profit_margins',
       'return_on_equity', 'return_on_assets', 'operating_margins',
       'earnings_growth', 'short_ratio'].includes(key)) {
    num = num * 100
  }
  const unit = fundamentalUnits[key] || ''
  if (num > 10000) return (num / 10000).toFixed(2) + '万亿'
  if (num < 0.01 && unit === '倍') return num.toFixed(2) + unit
  if (num < 0.01) return num.toFixed(4) + unit
  if (num < 1) return num.toFixed(3) + unit
  return num.toFixed(2) + unit
}

function FundamentalsDisplay({ data, loading }: { data: Record<string, any>, loading?: boolean }) {
  const available = fundamentalGroups.filter(g => g.keys.some(k => data[k] != null))
  const hasAny = available.length > 0

  return (
    <div style={{ marginBottom: 10 }}>
      <Space style={{ marginBottom: 8 }}>
        <BarChartOutlined style={{ color: '#c9a84c', fontSize: 12 }} />
        <Text style={{ color: '#e8e6e3', fontWeight: 600, fontSize: 12 }}>基本面指标</Text>
        {loading && <Spin size="small" />}
        {!loading && !hasAny && <Text style={{ color: '#5c5a55', fontSize: 11 }}>（暂无数据）</Text>}
      </Space>
      {loading && !hasAny && (
        <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(26, 26, 36, 0.3)', border: '1px solid rgba(255,255,255,0.04)' }}>
          <Text style={{ color: '#9a9892', fontSize: 11 }}>正在加载基本面指标...</Text>
        </div>
      )}
      {!loading && !hasAny && (
        <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(26, 26, 36, 0.3)', border: '1px solid rgba(255,255,255,0.04)' }}>
          <Text style={{ color: '#5c5a55', fontSize: 11 }}>该标的基本面数据暂不可用，请检查数据源配置或稍后重试</Text>
        </div>
      )}
      {available.map(group => (
        <div key={group.label} style={{ marginBottom: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(26, 26, 36, 0.5)', border: '1px solid rgba(255,255,255,0.04)' }}>
          <Text style={{ color: '#c9a84c', fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6, display: 'block' }}>{group.label}</Text>
          <div>
            {group.keys.map(k => {
              if (data[k] == null) return null
              return (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <span style={{ color: '#9a9892', fontSize: 11 }}>{fundamentalLabels[k] || k}</span>
                  <span style={{ color: '#e8e6e3', fontSize: 11, fontWeight: 500, fontFamily: 'monospace' }}>{formatFundamental(data[k], k)}</span>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function KLineChart({ data }: { data: MarketHistoryItem[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  if (!data.length) return null

  const isUp = data[data.length - 1]?.price >= data[0]?.price
  const chartColor = isUp ? '#3f8600' : '#cf1322'
  const minP = Math.min(...data.map(d => d.low ?? d.price))
  const maxP = Math.max(...data.map(d => d.high ?? d.price))
  const pad = (maxP - minP) * 0.08 || maxP * 0.02
  const yMin = minP - pad
  const yMax = maxP + pad
  const yRange = yMax - yMin || 1

  const margin = { top: 5, right: 5, bottom: 20, left: 55 }
  const svgW = 420
  const chartW = svgW - margin.left - margin.right
  const chartH = 180 - margin.top - margin.bottom

  const xScale = (i: number) => margin.left + (i / Math.max(1, data.length - 1)) * chartW
  const yScale = (v: number) => margin.top + (1 - (v - yMin) / yRange) * chartH

  const candleW = Math.max(2, Math.min(8, chartW / data.length - 1))

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width * svgW
    const idx = Math.round((x - margin.left) / chartW * (data.length - 1))
    setHoverIdx(Math.max(0, Math.min(data.length - 1, idx)))
  }

  const yMid = (yMin + yMax) / 2
  const yMidLabel = yMid % 1 < 0.01 || yMid % 1 > 0.99 ? yMid.toFixed(0) : yMid.toFixed(2)

  return (
    <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${svgW} 180`}
        style={{ width: '100%', height: 180, display: 'block' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <line x1={margin.left} y1={yScale(yMin)} x2={svgW - margin.right} y2={yScale(yMin)} stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" />
        <line x1={margin.left} y1={yScale(yMid)} x2={svgW - margin.right} y2={yScale(yMid)} stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" />
        <line x1={margin.left} y1={yScale(yMax)} x2={svgW - margin.right} y2={yScale(yMax)} stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" />

        <text x={margin.left - 5} y={yScale(yMax) + 3} textAnchor="end" fill="#5c5a55" fontSize={9}>{yMax.toFixed(2)}</text>
        <text x={margin.left - 5} y={yScale(yMid) + 3} textAnchor="end" fill="#5c5a55" fontSize={9}>{yMidLabel}</text>
        <text x={margin.left - 5} y={yScale(yMin) + 3} textAnchor="end" fill="#5c5a55" fontSize={9}>{yMin.toFixed(2)}</text>

        {data.map((d, i) => {
          const cx = xScale(i)
          const open = d.open ?? d.price
          const close = d.price
          const low = d.low ?? d.price
          const high = d.high ?? d.price
          const up = close >= open
          const color = up ? '#3f8600' : '#cf1322'
          const bodyTop = Math.min(yScale(open), yScale(close))
          const bodyH = Math.max(1, Math.abs(yScale(close) - yScale(open)))
          const opacity = hoverIdx === i ? 1 : 0.7

          return (
            <g key={i} opacity={opacity}>
              <line x1={cx} y1={yScale(high)} x2={cx} y2={yScale(low)} stroke={color} strokeWidth={0.5} />
              <rect x={cx - candleW / 2} y={bodyTop} width={candleW} height={bodyH} fill={color} rx={0.5} />
            </g>
          )
        })}

        <polyline points={data.map((d, i) => `${xScale(i)},${yScale(d.price)}`).join(' ')} fill="none" stroke={chartColor} strokeWidth={1.2} strokeOpacity={0.5} />

        {hoverIdx !== null && (
          <line x1={xScale(hoverIdx)} y1={margin.top} x2={xScale(hoverIdx)} y2={180 - margin.bottom} stroke="#c9a84c" strokeWidth={0.5} strokeDasharray="2 2" opacity={0.5} />
        )}

        {data.length > 1 && (
          <>
            <text x={margin.left} y={177} fill="#5c5a55" fontSize={9}>{data[0].date}</text>
            <text x={svgW - margin.right} y={177} textAnchor="end" fill="#5c5a55" fontSize={9}>{data[data.length - 1].date}</text>
          </>
        )}
      </svg>

      {hoverIdx !== null && (() => {
        const h = data[hoverIdx]
        return (
          <div style={{
            position: 'absolute', left: Math.min(xScale(hoverIdx) / svgW * 100, 60),
            top: 5, background: '#1a1a24', border: '1px solid rgba(201,168,76,0.2)',
            borderRadius: 8, padding: '6px 10px', fontSize: 11,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)', pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}>
            <div style={{ color: '#9a9892', marginBottom: 3, fontSize: 10 }}>{h.date}</div>
            <div style={{ color: '#e8e6e3' }}>
              开 <span style={{ fontFamily: 'monospace' }}>{h.open?.toFixed(3) ?? '-'}</span>
              <span style={{ marginLeft: 10 }}>收 <span style={{ fontFamily: 'monospace' }}>{h.price.toFixed(3)}</span></span>
            </div>
            <div style={{ color: '#e8e6e3', marginTop: 2 }}>
              高 <span style={{ fontFamily: 'monospace' }}>{h.high?.toFixed(3) ?? '-'}</span>
              <span style={{ marginLeft: 10 }}>低 <span style={{ fontFamily: 'monospace' }}>{h.low?.toFixed(3) ?? '-'}</span></span>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function ChartPopover({ target }: { target: Target }) {
  const [kInterval, setKInterval] = useState<KLineInterval>('day')
  const chartKey = `${target.id}:${kInterval}`
  const [history, setHistory] = useState<MarketHistoryItem[]>(chartCache.get(chartKey) || [])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyRetry, setHistoryRetry] = useState(0)
  const historyAttempted = useRef(false)
  const [fundamentals, setFundamentals] = useState<any>(fundaCache.get(target.id) || null)
  const [fundaLoading, setFundaLoading] = useState(false)
  const [fundaRetry, setFundaRetry] = useState(0)
  const fundaAttempted = useRef(false)
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fundaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current)
      if (fundaTimerRef.current) clearTimeout(fundaTimerRef.current)
    }
  }, [])

  useEffect(() => {
    let active = true
    if (!target.code) return
    const params = kLineHistoryParams[kInterval]
    const cacheKey = `${target.id}:${kInterval}`
    if (chartCache.has(cacheKey)) {
      setHistory(chartCache.get(cacheKey) || [])
      historyAttempted.current = true
      return
    }
    historyAttempted.current = true
    setHistory([])
    setHistoryLoading(true)
    let request = chartRequestCache.get(cacheKey)
    if (!request) {
      request = marketApi.historyFullRange(target.code, target.market, target.asset_type, params)
        .then(data => {
          const items = data.history || []
          chartCache.set(cacheKey, items)
          return items
        })
        .finally(() => { chartRequestCache.delete(cacheKey) })
      chartRequestCache.set(cacheKey, request)
    }
    request
      .then(items => {
        if (active) setHistory(items)
      })
      .catch(() => {
        if (!active) return
        setHistory([])
        if (!chartCache.has(cacheKey) && historyRetry < 2) {
          historyTimerRef.current = setTimeout(() => setHistoryRetry(r => r + 1), 3000)
        }
      })
      .finally(() => { if (active) setHistoryLoading(false) })
    return () => { active = false }
  }, [target.id, target.code, target.market, target.asset_type, kInterval, historyRetry])

  useEffect(() => {
    let active = true
    if (!target.code) return
    if (fundaCache.has(target.id)) {
      setFundamentals(fundaCache.get(target.id))
      fundaAttempted.current = true
      return
    }
    if (fundaAttempted.current && fundaRetry === 0) return
    fundaAttempted.current = true
    setFundaLoading(true)
    let request = fundaRequestCache.get(target.id)
    if (!request) {
      request = marketApi.fundamentals(target.code, target.market, target.asset_type)
        .then(data => {
          fundaCache.set(target.id, data.fundamentals)
          return data.fundamentals
        })
        .finally(() => { fundaRequestCache.delete(target.id) })
      fundaRequestCache.set(target.id, request)
    }
    request
      .then(data => {
        if (active) setFundamentals(data)
      })
      .catch(() => {
        if (!active) return
        setFundamentals(null)
        if (!fundaCache.has(target.id) && fundaRetry < 2) {
          fundaTimerRef.current = setTimeout(() => setFundaRetry(r => r + 1), 3000)
        }
      })
      .finally(() => { if (active) setFundaLoading(false) })
    return () => { active = false }
  }, [target.id, target.code, target.market, target.asset_type, fundaRetry])

  const showNoHistory = !historyLoading && historyAttempted.current && chartCache.has(chartKey) && history.length === 0
  const showHistoryError = !historyLoading && !chartCache.has(chartKey) && historyAttempted.current && historyRetry >= 2
  const showHistoryOk = history.length > 0 && chartCache.has(chartKey)

  let analysis: any = null
  try { analysis = JSON.parse(target.ai_analysis) } catch {}
  const a = analysis?.analysis || {}

  return (
    <div style={{ width: 420 }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
          <Space>
            <Text style={{ color: '#e8e6e3', fontWeight: 600, fontSize: 14 }}>{target.name}</Text>
            <Text style={{ color: '#9a9892', fontSize: 12 }}>{target.code}</Text>
            <Tag style={{ border: `1px solid ${marketColors[target.market] || '#666'}`, color: marketColors[target.market] || '#666', background: 'transparent', borderRadius: 6, fontSize: 11 }}>{target.market}</Tag>
          </Space>
          <KLineIntervalSelector value={kInterval} onChange={setKInterval} />
        </div>
        <div style={{ color: '#9a9892', fontSize: 11 }}>
          {historyLoading ? '正在加载行情数据...' : showHistoryOk ? `K 线（${history.length} 个交易日）` : showNoHistory ? '暂无行情数据' : showHistoryError ? '行情数据加载失败' : history.length > 0 ? `K 线（${history.length} 个交易日）` : ''}
        </div>
      </div>

      {historyLoading && (
        <div style={{ width: '100%', height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin />
        </div>
      )}

      {showHistoryOk && (
        <div style={{ marginBottom: 12 }}>
          <InteractiveKLineChart data={history} height={210} />
        </div>
      )}

      {!historyLoading && (showNoHistory || showHistoryError) && (
        <div style={{ width: '100%', minHeight: 100, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: 'rgba(26, 26, 36, 0.3)', border: '1px solid rgba(255,255,255,0.04)' }}>
          <Text style={{ color: '#5c5a55', fontSize: 12 }}>{showHistoryError ? '行情走势加载失败，请稍后重试' : '该标的暂无可用行情走势'}</Text>
        </div>
      )}

      <FundamentalsDisplay data={fundamentals || {}} loading={fundaLoading} />

      {a.fundamental && (
        <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(201,168,76,0.04)', border: '1px solid rgba(201,168,76,0.1)' }}>
          <Space style={{ marginBottom: 6 }}>
            <FundOutlined style={{ color: '#c9a84c', fontSize: 12 }} />
            <Text style={{ color: '#e8e6e3', fontWeight: 600, fontSize: 12 }}>AI 观点（以实时指标为准）</Text>
          </Space>
          <div style={{ color: '#c9c7c0', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{a.fundamental}</div>
        </div>
      )}
    </div>
  )
}

function AnalysisPopover({ target }: { target: Target }) {
  let analysis: any = null
  try { analysis = JSON.parse(target.ai_analysis) } catch {}
  if (!analysis) return <Text style={{ color: '#5c5a55' }}>暂无分析数据</Text>

  const a = analysis.analysis || {}
  const sectionStyle = {
    padding: '10px 14px',
    borderRadius: 8,
    background: 'rgba(26, 26, 36, 0.5)',
    border: '1px solid rgba(255,255,255,0.04)',
    marginBottom: 8,
  }
  const contentStyle: React.CSSProperties = { color: '#c9c7c0', fontSize: 12, lineHeight: 1.6 }

  return (
    <div style={{ width: 400, maxHeight: 440, overflowY: 'auto' as const, margin: '-4px 0' }}>
      {analysis.priority && (
        <div style={{ marginBottom: 10 }}>
          <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.12)', color: priorityColors[analysis.priority] || '#666' }}>
            <StarFilled style={{ marginRight: 2 }} />{analysis.priority === 'HIGH' ? '高' : analysis.priority === 'MEDIUM' ? '中' : '低'}优先级
          </span>
        </div>
      )}

      {analysis.reason && (
        <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.12)', marginBottom: 8 }}>
          <Text style={{ color: '#b0aea8', fontSize: 12 }}>{analysis.reason}</Text>
        </div>
      )}

      {a.fundamental && <div style={sectionStyle}>
        <Space style={{ marginBottom: 4 }}><FundOutlined style={{ color: '#c9a84c', fontSize: 12 }} /><Text style={{ color: '#e8e6e3', fontWeight: 600, fontSize: 12 }}>AI 基本面观点</Text></Space>
        <div style={contentStyle}>{a.fundamental}</div>
      </div>}

      {a.technical && <div style={sectionStyle}>
        <Space style={{ marginBottom: 4 }}><LineChartOutlined style={{ color: '#c9a84c', fontSize: 12 }} /><Text style={{ color: '#e8e6e3', fontWeight: 600, fontSize: 12 }}>技术面</Text></Space>
        <div style={contentStyle}>{a.technical}</div>
      </div>}

      {a.macro_impact && <div style={sectionStyle}>
        <Space style={{ marginBottom: 4 }}><GlobalOutlined style={{ color: '#c9a84c', fontSize: 12 }} /><Text style={{ color: '#e8e6e3', fontWeight: 600, fontSize: 12 }}>宏观影响</Text></Space>
        <div style={contentStyle}>{a.macro_impact}</div>
      </div>}

      {a.micro_catalysts && <div style={sectionStyle}>
        <Space style={{ marginBottom: 4 }}><ThunderboltFilled style={{ color: '#c9a84c', fontSize: 12 }} /><Text style={{ color: '#e8e6e3', fontWeight: 600, fontSize: 12 }}>催化剂</Text></Space>
        <div style={contentStyle}>{a.micro_catalysts}</div>
      </div>}

      {a.investment_thesis && <div style={{ ...sectionStyle, borderColor: 'rgba(201,168,76,0.2)', background: 'rgba(201,168,76,0.04)' }}>
        <Space style={{ marginBottom: 4 }}><ExperimentOutlined style={{ color: '#c9a84c', fontSize: 12 }} /><Text style={{ color: '#c9a84c', fontWeight: 600, fontSize: 12 }}>核心逻辑</Text></Space>
        <div style={{ ...contentStyle, color: '#d4d0c8' }}>{a.investment_thesis}</div>
      </div>}
    </div>
  )
}

export default function Targets() {
  const [targets, setTargets] = useState<Target[]>([])
  const [loading, setLoading] = useState(true)
  const aiCtx = useAIWorkContext()
  const [modalOpen, setModalOpen] = useState(false)
  const [clearModalOpen, setClearModalOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [prices, setPrices] = useState<Record<number, { current: number; change_pct: number | null }>>({})
  const [form] = Form.useForm()

  const [marketFilter, setMarketFilter] = useState<string[]>([])
  const [assetTypeFilter, setAssetTypeFilter] = useState<string[]>([])
  const [sourceFilter, setSourceFilter] = useState('')
  const [groupBy, setGroupBy] = useState<'none' | 'asset_type' | 'source' | 'market'>('none')
  const [viewMode, setViewMode] = useState<'all' | 'high_winrate'>('all')
  const [recommendationStats, setRecommendationStats] = useState<RecommendationStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const marketWarmupSeqRef = useRef(0)

  const idleDelay = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms))

  const warmTargetsMarketData = useCallback((targetList: Target[]) => {
    const seq = marketWarmupSeqRef.current + 1
    marketWarmupSeqRef.current = seq
    const liveTargets = targetList.filter(t => t.code)

    window.setTimeout(async () => {
      for (const target of liveTargets) {
        if (seq !== marketWarmupSeqRef.current) return
        try {
          const quote = await marketApi.quote(target.code, target.market, target.asset_type)
          if (quote.current_price != null) {
            setPrices(prev => ({ ...prev, [target.id]: { current: quote.current_price!, change_pct: quote.change_pct } }))
          }
        } catch {}
        await idleDelay(220)
      }

      for (const target of liveTargets) {
        if (seq !== marketWarmupSeqRef.current) return
        try {
          await marketApi.historyFullRange(target.code, target.market, target.asset_type, { period: '1y', interval: 'day' })
        } catch {}
        await idleDelay(320)
      }

      for (const target of liveTargets) {
        if (seq !== marketWarmupSeqRef.current) return
        try {
          await marketApi.fundamentals(target.code, target.market, target.asset_type)
        } catch {}
        await idleDelay(420)
      }
    }, 600)
  }, [])

  const fetchTargets = useCallback(async () => {
    setLoading(true)
    try {
      const data = await targetsApi.list({ status: 'active' })
      setTargets(data)
      setLoading(false)
      warmTargetsMarketData(data)
    } catch (e) {
      console.error(e)
      setLoading(false)
    }
  }, [warmTargetsMarketData])

  const fetchRecommendationStats = useCallback(async () => {
    setStatsLoading(true)
    try {
      const data = await targetsApi.recommendationStats()
      setRecommendationStats(data)
    } catch {
      setRecommendationStats(null)
    } finally {
      setStatsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTargets()
    fetchRecommendationStats()
    // Load saved AI recommend config
    Promise.all([
      settingsApi.get('ai_recommend_markets').catch(() => ({ value: '' })),
      settingsApi.get('ai_recommend_asset_types').catch(() => ({ value: '' })),
    ]).then(([m, t]) => {
      if (m.value) setMarketFilter(m.value.split(',').filter(Boolean))
      if (t.value) setAssetTypeFilter(t.value.split(',').filter(Boolean))
    })
  }, [fetchTargets])

  const saveFilterSettings = useCallback((markets: string[], types: string[]) => {
    settingsApi.update('ai_recommend_markets', markets.join(',')).catch(() => {})
    settingsApi.update('ai_recommend_asset_types', types.join(',')).catch(() => {})
  }, [])

  const handleMarketFilterChange = (v: string[]) => {
    setMarketFilter(v)
    saveFilterSettings(v, assetTypeFilter)
  }

  const handleAssetTypeFilterChange = (v: string[]) => {
    setAssetTypeFilter(v)
    saveFilterSettings(marketFilter, v)
  }

  const filteredTargets = targets.filter(t => {
    if (marketFilter.length > 0 && !marketFilter.includes(t.market)) return false
    if (assetTypeFilter.length > 0 && !assetTypeFilter.includes(t.asset_type)) return false
    if (sourceFilter && t.source !== sourceFilter) return false
    if (viewMode === 'high_winrate' && t.priority !== 'HIGH') return false
    return true
  })

  const getGroupedData = () => {
    if (groupBy === 'none') return null
    const groups: Record<string, Target[]> = {}
    filteredTargets.forEach(t => {
      const key = t[groupBy]
      const label = (groupLabels[groupBy] || {})[key] || key || '其他'
      if (!groups[label]) groups[label] = []
      groups[label].push(t)
    })
    return groups
  }

  const handleCreate = async () => {
    const values = await form.validateFields()
    await targetsApi.create({ ...values, source: 'manual', status: 'active' })
    message.success('添加成功')
    setModalOpen(false)
    form.resetFields()
    fetchTargets()
  }

  const handleDelete = async (id: number) => {
    await targetsApi.delete(id)
    message.success('已移除')
    fetchTargets()
  }

  const handleAiAnalyze = async () => {
    aiCtx.startTask('AI 标的投资建议')
    try {
      aiCtx.addLog('正在实时分析标的...', 'info')
      try {
        const result = await aiCtx.streamSSE('/api/targets/ai-analyze-stream')
        await fetchTargets()
        await fetchRecommendationStats()
        if (result && result.summary) {
          aiCtx.addLog(`✅ ${result.summary}`, 'success')
        }
      } catch (e: any) {
        // Fallback
        const result = await targetsApi.aiAnalyze({
          markets: marketFilter,
          asset_types: assetTypeFilter,
        })
        await fetchTargets()
        await fetchRecommendationStats()
        if (result && result.summary) {
          aiCtx.addLog(`✅ ${result.summary}`, 'success')
        }
      }
      aiCtx.completeTask()
    } catch (e: any) {
      aiCtx.failTask(e?.response?.data?.detail || '分析失败')
    }
  }

  const handleClearAll = async () => {
    setClearing(true)
    try {
      await targetsApi.clearAll()
      message.success('所有标的已清空')
      setClearModalOpen(false)
      fetchTargets()
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '清空失败')
    } finally {
      setClearing(false)
    }
  }

  const columns = [
    {
      title: '标的', key: 'name_combined', width: 200,
      render: (v: string, r: Target) => (
        <Space size={4}>
          <span style={{ color: '#e8e6e3', fontWeight: 500, fontSize: 13 }}>{r.name}</span>
          {r.source === 'ai_recommended' ? (
            <Tag style={{ borderRadius: 4, fontSize: 10, background: 'rgba(201,168,76,0.15)', border: 'none', color: '#c9a84c', lineHeight: '18px', padding: '0 6px', margin: 0 }}>AI</Tag>
          ) : (
            <Tag style={{ borderRadius: 4, fontSize: 10, background: 'rgba(255,255,255,0.05)', border: 'none', color: '#6b6a64', lineHeight: '18px', padding: '0 6px', margin: 0 }}>手动</Tag>
          )}
        </Space>
      ),
    },
    {
      title: '代码', dataIndex: 'code', key: 'code', width: 100,
      render: (v: string) => v ? <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#b0aea8' }}>{v}</span> : <span style={{ color: '#5c5a55' }}>-</span>,
    },
    {
      title: '市场', dataIndex: 'market', key: 'market', width: 55,
      render: (v: string) => (
        <Tag style={{ border: `1px solid ${marketColors[v] || '#666'}`, color: marketColors[v] || '#666', background: 'transparent', borderRadius: 4, fontSize: 10, lineHeight: '18px', padding: '0 6px' }}>{v}</Tag>
      ),
    },
    {
      title: '优', key: 'priority_short', width: 55,
      render: (v: string, r: Target) => {
        const labels: Record<string, string> = { HIGH: '高', MEDIUM: '中', LOW: '低' }
        return <span style={{ color: priorityColors[r.priority] || '#666', fontWeight: 600, fontSize: 12 }}>{labels[r.priority] || r.priority}</span>
      },
    },
    {
      title: '风险', key: 'risk_short', width: 55,
      render: (v: string, r: Target) => {
        const labels: Record<string, string> = { HIGH: '高', MEDIUM: '中', LOW: '低' }
        return <span style={{ color: riskColors[r.risk_level] || '#666', fontSize: 12 }}>{labels[r.risk_level] || r.risk_level}</span>
      },
    },
    {
      title: '推荐后涨跌', key: 'change', width: 100,
      render: (_: any, r: Target) => {
        const price = prices[r.id]
        let recPrice: number | null = null
        try { recPrice = JSON.parse(r.ai_analysis)?.recommended_price } catch {}
        if (recPrice != null && price) {
          const change = ((price.current - recPrice) / recPrice * 100)
          const isPositive = change >= 0
          return (
            <Tooltip title={`推荐时 ¥${recPrice.toFixed(2)} → 当前 ¥${price.current.toFixed(2)}`}>
              <span style={{ color: isPositive ? '#3f8600' : '#cf1322', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' }}>
                {isPositive ? '+' : ''}{change.toFixed(2)}%
              </span>
            </Tooltip>
          )
        }
        return <span style={{ color: '#5c5a55', fontSize: 11 }}>-</span>
      },
    },
    {
      title: '预期收益', dataIndex: 'expected_return', key: 'expected_return', width: 100,
      render: (v: string) => v ? <span style={{ color: '#3f8600', fontSize: 12, whiteSpace: 'nowrap' }}>{v}</span> : <span style={{ color: '#5c5a55' }}>-</span>,
    },
    {
      title: '', key: 'actions', width: 100,
      render: (_: any, r: Target) => {
        let hasAnalysis = false
        try {
          const parsed = JSON.parse(r.ai_analysis)
          const a = parsed?.analysis || {}
          hasAnalysis = !!(a.fundamental || a.technical || a.macro_impact || a.micro_catalysts)
        } catch {}
        return (
          <Space size={2}>
            <Popover
              content={<ChartPopover target={r} />}
              title={`${r.name} 行情走势`}
              trigger="hover"
              placement="left"
              overlayInnerStyle={{ padding: 14 }}
            >
              <Button type="text" size="small" icon={<BarChartOutlined />} style={{ color: '#9a9892' }} />
            </Popover>
            {hasAnalysis ? (
              <Popover
                content={<AnalysisPopover target={r} />}
                title={`${r.name} 分析详情`}
                trigger="hover"
                placement="left"
                overlayInnerStyle={{ padding: 14, maxHeight: 520, overflowY: 'auto' }}
              >
                <Button type="text" size="small" icon={<InfoCircleOutlined />} style={{ color: '#c9a84c' }} />
              </Popover>
            ) : r.ai_analysis && r.ai_analysis !== '{}' ? (
              <Popover
                content={<AnalysisPopover target={r} />}
                title={`${r.name} 分析详情`}
                trigger="hover"
                placement="left"
                overlayInnerStyle={{ padding: 14, maxHeight: 520, overflowY: 'auto' }}
              >
                <Button type="text" size="small" icon={<InfoCircleOutlined />} style={{ color: '#9a9892' }} />
              </Popover>
            ) : null}
            <Popconfirm title="移除该标的？" onConfirm={() => handleDelete(r.id)} okText="确定" cancelText="取消">
              <Button type="text" size="small" icon={<DeleteOutlined />} style={{ color: '#5c5a55' }} />
            </Popconfirm>
          </Space>
        )
      },
    },
  ]

  const renderGroupedTables = () => {
    const grouped = getGroupedData()
    if (!grouped) {
      return (
        <Table
          dataSource={filteredTargets}
          columns={columns}
          rowKey="id"
          loading={loading}
          scroll={{ x: 800 }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `共 ${t} 个标的` }}
        />
      )
    }
    return Object.entries(grouped).map(([group, items]) => (
      <div key={group} style={{ marginBottom: 20 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 12px', marginBottom: 8,
          borderRadius: 10, background: 'rgba(201,168,76,0.04)',
          border: '1px solid rgba(201,168,76,0.08)',
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#c9a84c' }} />
          <span style={{ fontWeight: 600, color: '#e8e6e3', fontSize: 14 }}>{group}</span>
          <span style={{ color: '#5c5a55', fontSize: 12 }}>共 {items.length} 项</span>
        </div>
        <Table
          dataSource={items}
          columns={columns}
          rowKey="id"
          loading={loading}
          scroll={{ x: 800 }}
          pagination={false}
        />
      </div>
    ))
  }

  return (
    <div className="page-enter">
      <Card
        title={<Space><AimOutlined style={goldStyle} /><span>我的标的</span></Space>}
        extra={
          <Space>
            <Button
              icon={<ClearOutlined />}
              onClick={() => setClearModalOpen(true)}
              style={{ borderRadius: 10, height: 36, fontWeight: 500, borderColor: 'rgba(207,19,34,0.3)', color: '#cf1322' }}
            >
              清空标的
            </Button>
            <Button
              icon={<PlusOutlined />}
              onClick={() => { form.resetFields(); setModalOpen(true) }}
              style={{ borderRadius: 10, height: 36, fontWeight: 500 }}
            >
              手动添加标的
            </Button>
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={aiCtx.state.isRunning}
              onClick={handleAiAnalyze}
              style={{ borderRadius: 10, height: 36, fontWeight: 500 }}
            >
              AI 标的投资建议
            </Button>
          </Space>
        }
      >
        <div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 10, background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.12)' }}>
          <Space>
            <BulbOutlined style={{ color: '#c9a84c', fontSize: 16 }} />
            <Text style={{ color: '#b0aea8', fontSize: 13 }}>
              标的是你关注的投资目标。鼠标悬停在标的名称上的 <InfoCircleOutlined style={{ color: '#c9a84c' }} /> 可查看 AI 基本面/技术面/宏观/催化剂多维分析，<BarChartOutlined style={{ color: '#9a9892' }} /> 可查看行情走势。
            </Text>
          </Space>
        </div>

        {targets.filter(t => t.priority === 'HIGH').length > 0 && (
          <div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 10, background: 'linear-gradient(135deg, rgba(201,168,76,0.12) 0%, rgba(201,168,76,0.04) 100%)', border: '1px solid rgba(201,168,76,0.25)' }}>
            <Row gutter={16} align="middle">
              <Col flex="auto">
                <Space>
                  <StarFilled style={{ color: '#c9a84c', fontSize: 18 }} />
                  <div>
                    <Text style={{ color: '#e8e6e3', fontWeight: 600, fontSize: 15 }}>高胜率标的</Text>
                    <Text style={{ color: '#9a9892', fontSize: 12, marginLeft: 8 }}>点击下方「⭐ 高胜率」可筛选查看</Text>
                  </div>
                </Space>
              </Col>
              <Col>
                <Text style={{ color: '#c9a84c', fontWeight: 600, fontSize: 20 }}>{targets.filter(t => t.priority === 'HIGH').length}</Text>
                <Text style={{ color: '#6b6a64', fontSize: 12, marginLeft: 4 }}>个</Text>
              </Col>
            </Row>
          </div>
        )}

        {(recommendationStats && recommendationStats.id > 0) ? (
          <div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 10, background: 'linear-gradient(135deg, rgba(201,168,76,0.08) 0%, rgba(201,168,76,0.02) 100%)', border: '1px solid rgba(201,168,76,0.15)' }}>
            <Row gutter={24} align="middle">
              <Col flex="auto">
                <Space size={4} style={{ marginBottom: 4 }}>
                  <RobotOutlined style={{ color: '#c9a84c', fontSize: 14 }} />
                  <Text style={{ color: '#9a9892', fontSize: 12 }}>最近一次 AI 推荐统计</Text>
                </Space>
              </Col>
              <Col>
                <Text style={{ color: '#6b6a64', fontSize: 11 }}>{recommendationStats.created_at ? new Date(recommendationStats.created_at).toLocaleString('zh-CN') : ''}</Text>
              </Col>
            </Row>
            <Row gutter={16} style={{ marginTop: 8 }}>
              <Col span={8}>
                <div style={{ textAlign: 'center', padding: '8px 4px', borderRadius: 8, background: 'rgba(82, 196, 26, 0.1)' }}>
                  <Text style={{ color: '#52c41a', fontSize: 24, fontWeight: 700, display: 'block' }}>{recommendationStats.added_count}</Text>
                  <Text style={{ color: '#b0aea8', fontSize: 12 }}>新增推荐</Text>
                </div>
              </Col>
              <Col span={8}>
                <div style={{ textAlign: 'center', padding: '8px 4px', borderRadius: 8, background: 'rgba(255, 77, 79, 0.1)' }}>
                  <Text style={{ color: '#ff4d4f', fontSize: 24, fontWeight: 700, display: 'block' }}>{recommendationStats.removed_count}</Text>
                  <Text style={{ color: '#b0aea8', fontSize: 12 }}>移除推荐</Text>
                </div>
              </Col>
              <Col span={8}>
                <div style={{ textAlign: 'center', padding: '8px 4px', borderRadius: 8, background: 'rgba(201, 168, 76, 0.1)' }}>
                  <Text style={{ color: '#c9a84c', fontSize: 24, fontWeight: 700, display: 'block' }}>{recommendationStats.maintained_count}</Text>
                  <Text style={{ color: '#b0aea8', fontSize: 12 }}>维持推荐</Text>
                </div>
              </Col>
            </Row>
            {recommendationStats.summary && (
              <div style={{ marginTop: 6, padding: '4px 8px', borderRadius: 6, background: 'rgba(201,168,76,0.05)' }}>
                <Text style={{ color: '#b0aea8', fontSize: 11, lineHeight: 1.6 }}>{recommendationStats.summary}</Text>
              </div>
            )}
            <div style={{ marginTop: 6, textAlign: 'right' }}>
              <Text style={{ color: '#6b6a64', fontSize: 11 }}>
                当前共 <span style={{ color: '#c9a84c', fontWeight: 600 }}>{recommendationStats.total_after}</span> 个标的
              </Text>
            </div>
          </div>
        ) : statsLoading ? (
          <div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 10, background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.12)' }}>
            <Space><Spin size="small" /><Text style={{ color: '#6b6a64', fontSize: 12 }}>加载推荐统计...</Text></Space>
          </div>
        ) : null}

        <Row gutter={[16, 12]} style={{ marginBottom: 16 }} align="middle">
          <Col flex="auto">
            <Space wrap size={[4, 8]}>
              <Space size={4}>
                <Text style={{ color: '#9a9892', fontSize: 12, whiteSpace: 'nowrap' }}>AI 推荐范围</Text>
                <Select
                  mode="multiple"
                  value={marketFilter}
                  onChange={handleMarketFilterChange}
                  options={marketFilterOptions.slice(1)}
                  style={{ minWidth: 150 }}
                  size="small"
                  placeholder="选择市场"
                  maxTagCount={2}
                />
                <Select
                  mode="multiple"
                  value={assetTypeFilter}
                  onChange={handleAssetTypeFilterChange}
                  options={assetTypeFilterOptions.slice(1)}
                  style={{ minWidth: 150 }}
                  size="small"
                  placeholder="选择类型"
                  maxTagCount={2}
                />
              </Space>
              <Select
                value={sourceFilter}
                onChange={setSourceFilter}
                options={sourceFilterOptions}
                style={{ width: 120 }}
                size="small"
              />
            </Space>
          </Col>
          <Col>
            <Radio.Group
              options={groupByOptions}
              value={groupBy}
              onChange={e => setGroupBy(e.target.value)}
              optionType="button"
              buttonStyle="solid"
              size="small"
            />
          </Col>
          <Col>
            <Radio.Group
              value={viewMode}
              onChange={e => setViewMode(e.target.value)}
              optionType="button"
              buttonStyle="solid"
              size="small"
            >
              <Radio.Button value="all">全部</Radio.Button>
              <Radio.Button value="high_winrate" style={{ borderColor: viewMode === 'high_winrate' ? '#c9a84c' : undefined }}>⭐ 高胜率</Radio.Button>
            </Radio.Group>
          </Col>
        </Row>

        {renderGroupedTables()}
      </Card>

      <Modal title="添加标的" open={modalOpen} onOk={handleCreate} onCancel={() => setModalOpen(false)} okText="添加" cancelText="取消" width={520} destroyOnClose>
        <Form form={form} layout="vertical" size="large" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="标的名称" rules={[{ required: true, message: '请输入标的名称' }]}>
            <Input placeholder="如：贵州茅台、腾讯控股" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="code" label="代码">
                <Input placeholder="如：600519" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="market" label="市场" initialValue="A">
                <Select options={[{ label: 'A 股', value: 'A' }, { label: '港股', value: 'HK' }, { label: '美股', value: 'US' }]} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="asset_type" label="类型" initialValue="stock">
                <Select options={[{ label: '股票', value: 'stock' }, { label: '场外基金', value: 'offshore_fund' }, { label: '场内基金', value: 'onshore_fund' }]} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="priority" label="优先级" initialValue="MEDIUM">
                <Select options={[{ label: '高', value: 'HIGH' }, { label: '中', value: 'MEDIUM' }, { label: '低', value: 'LOW' }]} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="reason" label="关注理由">
            <Input.TextArea rows={2} placeholder="为什么关注这个标的？" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={<Space><WarningOutlined style={{ color: '#ff4d4f' }} /><span style={{ color: '#ff4d4f' }}>清空所有标的</span></Space>}
        open={clearModalOpen}
        onOk={handleClearAll}
        onCancel={() => setClearModalOpen(false)}
        okText="确认清空"
        cancelText="取消"
        confirmLoading={clearing}
        okButtonProps={{ danger: true, style: { borderRadius: 10, fontWeight: 500 } }}
        cancelButtonProps={{ style: { borderRadius: 10 } }}
      >
        <div style={{ padding: 16, borderRadius: 10, background: 'rgba(207, 19, 34, 0.08)', border: '1px solid rgba(207, 19, 34, 0.2)', marginTop: 8 }}>
          <Space direction="vertical" size={8}>
            <Text style={{ color: '#ff4d4f', fontSize: 14, fontWeight: 500 }}>此操作将永久删除所有标的记录</Text>
            <ul style={{ color: '#b0aea8', fontSize: 13, margin: 0, paddingLeft: 20, lineHeight: 2 }}>
              <li>手动添加的标的</li>
              <li>AI 推荐的所有标的及分析数据</li>
            </ul>
            <Text style={{ color: '#cf1322', fontSize: 13, fontWeight: 500 }}>⚠️ 此操作不可撤销！</Text>
          </Space>
        </div>
      </Modal>
    </div>
  )
}
