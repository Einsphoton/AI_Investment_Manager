import { useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { useAIWorkContext } from '../stores/AIWorkContext'
import {
  Card, Row, Col, Statistic, Button, Spin, Typography, Space, Table, Tag, Switch, message
} from 'antd'
import {
  ArrowUpOutlined, ArrowDownOutlined, ThunderboltOutlined,
  DollarOutlined, WalletOutlined, RiseOutlined, BarChartOutlined
} from '@ant-design/icons'
import { dashboardApi, analysisApi, assetsApi, targetsApi, investmentAdviceApi, parallelApi, DashboardData, AnalysisRecord, Asset } from '../api'
import { useNavigate } from 'react-router-dom'

const { Text } = Typography

const goldStyle = { color: '#c9a84c' }
const greenStyle = { color: 'oklch(72% 0.14 145)' }
const redStyle = { color: 'oklch(65% 0.18 25)' }

const renderInlineMarkdown = (text: string): ReactNode[] => (
  text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean).map((part, idx) => {
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
)

function MarkdownBrief({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const nodes: ReactNode[] = []
  let i = 0
  const isTableSeparator = (line?: string) => !!line && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(line)

  while (i < lines.length) {
    const trimmed = lines[i].trim()
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
          overflowX: 'auto',
          borderRadius: 8,
          background: 'rgba(0,0,0,0.26)',
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
          color: level <= 2 ? '#f3df99' : '#e8e6e3',
          fontWeight: 700,
          fontSize: level <= 2 ? 16 : 14,
        }}>
          {renderInlineMarkdown(heading[2])}
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
                    {renderInlineMarkdown(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => (
                <tr key={rowIdx}>
                  {header.map((_, cellIdx) => (
                    <td key={cellIdx} style={{ padding: '7px 8px', color: '#d6d1c8', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      {renderInlineMarkdown(row[cellIdx] || '')}
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
            <li key={idx} style={{ marginBottom: 5, color: '#d6d1c8', lineHeight: 1.72 }}>
              {renderInlineMarkdown(item)}
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
          {renderInlineMarkdown(quoteLines.join(' '))}
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
      <p key={`p-${i}`} style={{ margin: '8px 0', color: '#d6d1c8', fontSize: 13, lineHeight: 1.78 }}>
        {renderInlineMarkdown(paragraph.join(' '))}
      </p>,
    )
  }

  return <div>{nodes}</div>
}

export default function Dashboard() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [analysis, setAnalysis] = useState<AnalysisRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const aiCtx = useAIWorkContext()
  const [includeTargets, setIncludeTargets] = useState(() => {
    return localStorage.getItem('dashboard_include_targets') === 'true'
  })
  const [includeAdvice, setIncludeAdvice] = useState(() => {
    return localStorage.getItem('dashboard_include_advice') === 'true'
  })
  const [parallelConfigEnabled, setParallelConfigEnabled] = useState(false)
  const [configLoaded, setConfigLoaded] = useState(false)
  const [assets, setAssets] = useState<Asset[]>([])
  const navigate = useNavigate()

  const fetchData = async () => {
    try {
      const [dash, assetsData, latestAnalysis, parallelCfg] = await Promise.all([
        dashboardApi.get(),
        assetsApi.list(),
        analysisApi.latest().catch(() => null),
        parallelApi.getConfig().catch(() => null),
      ])
      if (parallelCfg) {
        setParallelConfigEnabled(parallelCfg.parallel_dashboard_steps)
      }
      setConfigLoaded(true)
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

  const getErrorDetail = (e: any): string => {
    return e?.response?.data?.detail || e?.message || '未知错误'
  }

  const runAssetDetailAnalysis = async () => {
    if (assets.length === 0) return
    await analysisApi.agentRun({
      asset_ids: assets.map(asset => asset.id),
      goal: '请为当前全部持仓生成用于资产详情页展示的逐项 AI 分析报告。每项资产都要覆盖宏观影响、微观因素、基本面、技术面、风险提示和具体操作建议。',
      save_portfolio_record: false,
    })
  }

  const runAnalysis = async () => {
    aiCtx.startTask('一键 AI 分析')
    try {
      // Pre-check if advice is configured (non-SSE, lightweight call)
      let adviceConfigured = includeAdvice
      if (includeAdvice) {
        try {
          const check = await investmentAdviceApi.check()
          adviceConfigured = check.configured
          if (!check.configured) {
            aiCtx.addLog('⏭️ AI 投资建议已跳过（未配置平台额度）', 'info')
          }
        } catch {
          adviceConfigured = false
          aiCtx.addLog('⏭️ AI 投资建议跳过（检查配置失败）', 'info')
        }
      }

      // Use parallel UI when parallel_dashboard_steps is enabled AND there are multiple steps
      const hasMultipleSteps = configLoaded && parallelConfigEnabled && (includeTargets || adviceConfigured)
      if (hasMultipleSteps) {
        // === PARALLEL MODE with streaming sub-tasks ===
        const subtaskIds: string[] = []
        aiCtx.setParallelMode(true)

        const tasks: { id: string; name: string; icon: string; run: () => Promise<void> }[] = []
        tasks.push({
          id: 'portfolio', name: '资产分析', icon: '📊',
          run: async () => {
            aiCtx.updateSubTask('portfolio', { status: 'running', thinking: '正在通过实时流分析组合...', progress: 5 })
            try {
              const result = await aiCtx.streamSSE('/api/analysis/run-stream')
              // SSE completed - record was saved to DB, fetch the full record from API
              if (result && result.summary) {
                try {
                  const fullRecord = await analysisApi.latest()
                  setAnalysis(fullRecord)
                } catch {
                  // Fallback: use the SSE result if API fetch fails
                  setAnalysis(result as any)
                }
              }
            } catch (e: any) {
              // User cancelled - skip fallback
              if (e.isCancelled) throw e
              // SSE failed, fallback to regular API
              console.warn('SSE stream failed, falling back to regular API', e)
              try {
                const result = await analysisApi.run(false)
                setAnalysis(result)
              } catch (e2: any) {
                aiCtx.updateSubTask('portfolio', { status: 'error', progress: 0, thinking: '分析失败' })
                aiCtx.addLog('❌ AI 资产分析失败: ' + (e2?.response?.data?.detail || e2.message || '未知错误'), 'error', '资产分析')
                return
              }
            }
            aiCtx.updateSubTask('portfolio', { status: 'running', progress: 88, thinking: '正在写入资产详情分析...' })
            await runAssetDetailAnalysis()
            aiCtx.updateSubTask('portfolio', { status: 'completed', progress: 100, thinking: '分析完成' })
            aiCtx.addLog('✅ AI 资产分析与详情报告完成', 'success', '资产分析')
          },
        })
        if (includeTargets) {
          tasks.push({
            id: 'targets', name: '标的分析', icon: '🎯',
            run: async () => {
              aiCtx.updateSubTask('targets', { status: 'running', thinking: '正在通过实时流分析标的...', progress: 5 })
              try {
                const result = await aiCtx.streamSSE('/api/targets/ai-analyze-stream')
                if (result && result.summary) {
                  aiCtx.addLog('✅ AI 标的分析完成', 'success', '标的分析')
                }
              } catch (e: any) {
                // User cancelled - skip fallback
                if (e.isCancelled) throw e
                console.warn('SSE stream for targets failed, falling back to regular API', e)
                try {
                  await targetsApi.aiAnalyze()
                } catch (e2: any) {
                  aiCtx.updateSubTask('targets', { status: 'error', progress: 0, thinking: '分析失败' })
                  aiCtx.addLog('❌ AI 标的分析失败: ' + (e2?.response?.data?.detail || e2.message || '未知错误'), 'error', '标的分析')
                  return
                }
              }
              aiCtx.updateSubTask('targets', { status: 'completed', progress: 100, thinking: '分析完成' })
              aiCtx.addLog('✅ AI 推荐标的完成', 'success', '标的分析')
            },
          })
        }
        if (adviceConfigured) {
          tasks.push({
            id: 'advice', name: '投资建议', icon: '💡',
            run: async () => {
              aiCtx.updateSubTask('advice', { status: 'running', thinking: '正在通过实时流生成建议...', progress: 5 })
              try {
                const result = await aiCtx.streamSSE('/api/investment-advice/run-stream')
                if (result && result.summary) {
                  aiCtx.addLog('✅ AI 投资建议已生成', 'success', '投资建议')
                }
              } catch (e: any) {
                // User cancelled - skip fallback
                if (e.isCancelled) throw e
                // Budget/config not configured - skip gracefully
                const errMsg = e?.message || ''
                if (errMsg.includes('请先配置') || errMsg.includes('平台投资额度')) {
                  aiCtx.updateSubTask('advice', { status: 'completed', progress: 100, thinking: '已跳过（未配置）' })
                  aiCtx.addLog('⏭️ AI 投资建议已跳过（未配置平台额度）', 'info', '投资建议')
                  return
                }
                console.warn('SSE stream for advice failed, falling back to regular API', e)
                try {
                  await investmentAdviceApi.run()
                  aiCtx.addLog('✅ AI 投资建议已生成', 'success', '投资建议')
                } catch (e2: any) {
                  aiCtx.updateSubTask('advice', { status: 'error', progress: 0, thinking: '建议生成失败' })
                  aiCtx.addLog('❌ AI 投资建议失败: ' + (e2?.response?.data?.detail || e2.message || '未知错误'), 'error', '投资建议')
                  return
                }
              }
              aiCtx.updateSubTask('advice', { status: 'completed', progress: 100, thinking: '建议已生成' })
            },
          })
        }

        for (const t of tasks) {
          aiCtx.registerSubTask(t.id, t.name, t.icon)
          subtaskIds.push(t.id)
        }
        await new Promise(r => setTimeout(r, 200))
        const adviceTask = tasks.find(t => t.id === 'advice')
        const hasTargetTask = tasks.some(t => t.id === 'targets')
        if (adviceTask && hasTargetTask) {
          await Promise.all(tasks.filter(t => t.id !== 'advice').map(t => t.run()))
          await adviceTask.run()
        } else {
          await Promise.all(tasks.map(t => t.run()))
        }
        // Complete task early so overlay shows completion immediately
        aiCtx.completeTask()
        // Then fetch fresh data in background
        await fetchData()
      } else {
        // === SEQUENTIAL MODE with REAL SSE streaming ===
        aiCtx.addLog('正在连接 AI 分析引擎...', 'info')
        let portfolioSucceeded = false
        try {
          const result = await aiCtx.streamSSE('/api/analysis/run-stream')
          if (result && result.summary) {
            try {
              const fullRecord = await analysisApi.latest()
              setAnalysis(fullRecord)
            } catch {
              setAnalysis(result as any)
            }
            portfolioSucceeded = true
          }
        } catch (e: any) {
          // User cancelled - skip fallback
          if (e.isCancelled) throw e
          // Fallback: try regular API if SSE fails
          console.warn('SSE stream failed, falling back to regular API', e)
          try {
            const result = await analysisApi.run(false)
            setAnalysis(result)
            portfolioSucceeded = true
          } catch (e2: any) {
            aiCtx.addLog('❌ AI 资产分析失败: ' + (e2?.response?.data?.detail || e2.message || '未知错误'), 'error')
          }
        }
        if (portfolioSucceeded) {
          aiCtx.addLog('正在生成资产详情页分析报告...', 'info')
          await runAssetDetailAnalysis()
          aiCtx.addLog('✅ AI 资产分析与详情报告完成', 'success')
        }

        if (includeTargets) {
          try {
            await targetsApi.aiAnalyze()
            aiCtx.addLog('✅ AI 推荐标的完成', 'success')
          } catch (e: any) {
            aiCtx.addLog(`❌ 标的分析失败`, 'error')
          }
        }

        if (adviceConfigured) {
          try {
            await investmentAdviceApi.run()
            aiCtx.addLog('✅ AI 投资建议已生成', 'success')
          } catch (e: any) {
            const msg = e?.response?.data?.detail || e?.message || ''
            if (msg.includes('请先配置') || msg.includes('平台投资额度')) {
              aiCtx.addLog('⏭️ AI 投资建议已跳过（未配置平台额度）', 'info')
            } else {
              aiCtx.addLog('❌ 投资建议生成失败', 'error')
            }
          }
        }

        // Complete task early so overlay shows completion immediately
        aiCtx.completeTask()
        await fetchData()
      }
    } catch (e: any) {
      const errMsg = getErrorDetail(e)
      aiCtx.failTask(errMsg)
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
      icon: <WalletOutlined />,
    },
    {
      title: '浮动盈亏',
      value: dashboard?.total_pnl ?? 0,
      precision: 2,
      prefix: <ArrowIcon style={{ color: pnlColor, fontSize: 20 }} />,
      suffix: '¥',
      valueStyle: { color: pnlColor },
      extra: `(${isPositive ? '+' : ''}${dashboard?.total_pnl_percent?.toFixed(2)}%)`,
      icon: <ArrowIcon />,
    },
    {
      title: '已实现盈亏',
      value: dashboard?.realized_pnl ?? 0,
      precision: 2,
      prefix: <RiseOutlined style={{ ...goldStyle, fontSize: 20 }} />,
      suffix: '¥',
      icon: <RiseOutlined />,
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
        const effectivePrice = r.current_price != null && r.current_price > 0 ? r.current_price : r.buy_price
        const mv = r.shares * effectivePrice
        return <span style={{ fontWeight: 500 }}>¥{mv.toFixed(2)}</span>
      },
    },
    {
      title: '盈亏', key: 'pnl',
      render: (_: any, r: Asset) => {
        const effectivePrice = r.current_price != null && r.current_price > 0 ? r.current_price : r.buy_price
        const pnl = r.shares * (effectivePrice - r.buy_price)
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
            loading={aiCtx.state.isRunning}
            onClick={runAnalysis}
            style={{ borderRadius: 10, fontWeight: 600, height: 44, paddingInline: 28, fontSize: 15 }}
          >
            {aiCtx.state.isRunning ? '分析中...' : '一键 AI 分析'}
          </Button>
          <Space>
            <Switch
              checked={includeTargets}
              onChange={checked => { setIncludeTargets(checked); localStorage.setItem('dashboard_include_targets', String(checked)) }}
              size="small"
            />
            <Text style={{ color: '#9a9892', fontSize: 13, userSelect: 'none' }}>
              连带推荐标的
            </Text>
            <Switch
              checked={includeAdvice}
              onChange={checked => { setIncludeAdvice(checked); localStorage.setItem('dashboard_include_advice', String(checked)) }}
              size="small"
            />
            <Text style={{ color: '#9a9892', fontSize: 13, userSelect: 'none' }}>
              连带 AI 投资建议
            </Text>
          </Space>
        </Space>
        <Text style={{ color: '#5c5a55', fontSize: 12 }}>
          {includeTargets && includeAdvice
            ? '分析 → 推荐标的 → 投资建议'
            : includeTargets
            ? '分析完成后将自动更新标的推荐'
            : includeAdvice
            ? '分析完成后将自动生成投资建议'
            : '仅分析现有持仓'}
        </Text>
      </div>

      <Row gutter={[16, 16]}>
        {statCards.map((card, i) => (
          <Col xs={24} sm={12} lg={6} key={i}>
            <Card styles={{ body: { padding: '20px 24px', minHeight: 128 } }}>
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
                  color: card.valueStyle?.color || '#c9a84c',
                }}>
                  {card.icon}
                </span>
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 8,
                minWidth: 0,
                height: 34,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                color: card.valueStyle?.color || '#e8e6e3',
              }}>
                <span style={{
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  fontSize: 28,
                  fontWeight: 700,
                  lineHeight: 1.2,
                }}>
                  {card.suffix}{card.value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                {card.extra && (
                  <span style={{
                    flex: '0 0 auto',
                    fontSize: 13,
                    fontWeight: 600,
                  }}>
                    {card.extra}
                  </span>
                )}
              </div>
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
                  <MarkdownBrief content={analysis.detail} />
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
