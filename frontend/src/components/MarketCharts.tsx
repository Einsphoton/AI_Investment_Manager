import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { Empty, Radio } from 'antd'
import type { MarketHistoryItem } from '../api'

export type NetValuePeriod = '1m' | '3m' | '6m' | '1y' | '2y' | '3y' | '5y' | '10y'
export type KLineInterval = '1d' | '5d' | 'day' | 'week' | 'month' | 'quarter' | 'year'

export const netValuePeriodOptions: { label: string; value: NetValuePeriod }[] = [
  { label: '1 个月', value: '1m' },
  { label: '3 个月', value: '3m' },
  { label: '6 个月', value: '6m' },
  { label: '1 年', value: '1y' },
  { label: '2 年', value: '2y' },
  { label: '3 年', value: '3y' },
  { label: '5 年', value: '5y' },
  { label: '10 年', value: '10y' },
]

export const kLineIntervalOptions: { label: string; value: KLineInterval }[] = [
  { label: '1D', value: '1d' },
  { label: '5 日', value: '5d' },
  { label: '日 K', value: 'day' },
  { label: '周 K', value: 'week' },
  { label: '月 K', value: 'month' },
  { label: '季 K', value: 'quarter' },
  { label: '年 K', value: 'year' },
]

export const kLineHistoryParams: Record<KLineInterval, { period: string; interval: string }> = {
  '1d': { period: '1d', interval: 'intraday' },
  '5d': { period: '5d', interval: 'intraday' },
  day: { period: '1y', interval: 'day' },
  week: { period: '3y', interval: 'week' },
  month: { period: '5y', interval: 'month' },
  quarter: { period: '10y', interval: 'quarter' },
  year: { period: '10y', interval: 'year' },
}

export function NetValueRangeSelector({
  value,
  onChange,
}: {
  value: NetValuePeriod
  onChange: (value: NetValuePeriod) => void
}) {
  return (
    <Radio.Group
      options={netValuePeriodOptions}
      value={value}
      onChange={e => onChange(e.target.value)}
      optionType="button"
      buttonStyle="solid"
      size="small"
    />
  )
}

export function KLineIntervalSelector({
  value,
  onChange,
}: {
  value: KLineInterval
  onChange: (value: KLineInterval) => void
}) {
  return (
    <Radio.Group
      options={kLineIntervalOptions}
      value={value}
      onChange={e => onChange(e.target.value)}
      optionType="button"
      buttonStyle="solid"
      size="small"
    />
  )
}

const yLabel = (value: number) => {
  if (!Number.isFinite(value)) return '-'
  if (Math.abs(value) >= 100) return value.toFixed(1)
  if (Math.abs(value) >= 1) return value.toFixed(2)
  return value.toFixed(4)
}

export function PriceLineChart({
  data,
  height = 180,
  stroke = '#c9a84c',
}: {
  data: MarketHistoryItem[]
  height?: number
  stroke?: string
}) {
  const sorted = useMemo(
    () => [...data].filter(d => d.price > 0).sort((a, b) => a.date.localeCompare(b.date)),
    [data],
  )

  if (sorted.length < 2) {
    return (
      <div style={{ height, display: 'grid', placeItems: 'center' }}>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无走势数据" />
      </div>
    )
  }

  const w = 600
  const h = height
  const margin = { top: 12, right: 14, bottom: 20, left: 46 }
  const chartW = w - margin.left - margin.right
  const chartH = h - margin.top - margin.bottom
  const prices = sorted.map(item => item.price)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const pad = (max - min) * 0.08 || max * 0.02 || 1
  const yMin = min - pad
  const yMax = max + pad
  const range = yMax - yMin || 1
  const xScale = (i: number) => margin.left + (i / Math.max(1, sorted.length - 1)) * chartW
  const yScale = (v: number) => margin.top + (1 - (v - yMin) / range) * chartH
  const points = sorted.map((item, index) => `${xScale(index)},${yScale(item.price)}`).join(' ')
  const areaPoints = `${margin.left},${h - margin.bottom} ${points} ${w - margin.right},${h - margin.bottom}`
  const gradId = `line-grad-${sorted[0]?.date}-${sorted.length}`.replace(/[^a-zA-Z0-9_-]/g, '')

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height, display: 'block' }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.26} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      {[yMax, (yMin + yMax) / 2, yMin].map((value, index) => (
        <g key={index}>
          <line x1={margin.left} y1={yScale(value)} x2={w - margin.right} y2={yScale(value)} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
          <text x={margin.left - 7} y={yScale(value) + 3} textAnchor="end" fill="#5c5a55" fontSize={10}>{yLabel(value)}</text>
        </g>
      ))}
      <polyline points={areaPoints} fill={`url(#${gradId})`} />
      <polyline points={points} fill="none" stroke={stroke} strokeWidth={2} />
      <text x={margin.left} y={h - 4} fill="#5c5a55" fontSize={10}>{sorted[0].date}</text>
      <text x={w - margin.right} y={h - 4} textAnchor="end" fill="#5c5a55" fontSize={10}>{sorted[sorted.length - 1].date}</text>
    </svg>
  )
}

export function InteractiveKLineChart({
  data,
  height = 220,
}: {
  data: MarketHistoryItem[]
  height?: number
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [range, setRange] = useState({ start: 0, end: 0 })
  const dragRef = useRef<{ x: number; start: number; end: number } | null>(null)

  const sorted = useMemo(
    () => [...data].filter(d => d.price > 0).sort((a, b) => a.date.localeCompare(b.date)),
    [data],
  )

  useEffect(() => {
    const size = Math.min(sorted.length, 90)
    setRange({ start: Math.max(0, sorted.length - size), end: sorted.length })
    setHoverIdx(null)
  }, [sorted.length])

  if (!sorted.length) return null

  const start = Math.max(0, Math.min(range.start, sorted.length - 1))
  const end = Math.max(start + 1, Math.min(range.end || sorted.length, sorted.length))
  const visible = sorted.slice(start, end)
  const w = 620
  const h = height
  const margin = { top: 12, right: 12, bottom: 24, left: 56 }
  const chartW = w - margin.left - margin.right
  const chartH = h - margin.top - margin.bottom
  const minP = Math.min(...visible.map(d => d.low ?? d.price))
  const maxP = Math.max(...visible.map(d => d.high ?? d.price))
  const pad = (maxP - minP) * 0.08 || maxP * 0.02 || 1
  const yMin = minP - pad
  const yMax = maxP + pad
  const yRange = yMax - yMin || 1
  const xScale = (i: number) => margin.left + (i / Math.max(1, visible.length - 1)) * chartW
  const yScale = (v: number) => margin.top + (1 - (v - yMin) / yRange) * chartH
  const candleW = Math.max(2, Math.min(10, chartW / Math.max(1, visible.length) * 0.62))
  const lineColor = visible[visible.length - 1]?.price >= visible[0]?.price ? '#3f8600' : '#cf1322'

  const indexFromPointer = (e: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width * w
    return Math.max(0, Math.min(visible.length - 1, Math.round((x - margin.left) / chartW * (visible.length - 1))))
  }

  const shiftRange = (nextStart: number, nextEnd: number) => {
    const size = nextEnd - nextStart
    const clampedStart = Math.max(0, Math.min(sorted.length - size, nextStart))
    setRange({ start: clampedStart, end: clampedStart + size })
  }

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width * w
    const ratio = Math.max(0, Math.min(1, (x - margin.left) / chartW))
    const size = end - start
    const minSize = Math.min(sorted.length, 12)
    const nextSize = Math.max(minSize, Math.min(sorted.length, Math.round(size * (e.deltaY > 0 ? 1.18 : 0.84))))
    const anchor = start + ratio * size
    const nextStart = Math.round(anchor - ratio * nextSize)
    shiftRange(nextStart, nextStart + nextSize)
  }

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.x
      const delta = Math.round(-dx / Math.max(1, e.currentTarget.getBoundingClientRect().width) * (dragRef.current.end - dragRef.current.start))
      shiftRange(dragRef.current.start + delta, dragRef.current.end + delta)
      return
    }
    setHoverIdx(indexFromPointer(e))
  }

  const yMid = (yMin + yMax) / 2
  const hovered = hoverIdx !== null ? visible[hoverIdx] : null

  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        style={{ width: '100%', height, display: 'block', cursor: dragRef.current ? 'grabbing' : 'grab', touchAction: 'none' }}
        onWheel={handleWheel}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => { setHoverIdx(null); dragRef.current = null }}
        onPointerDown={e => {
          dragRef.current = { x: e.clientX, start, end }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerUp={e => {
          dragRef.current = null
          e.currentTarget.releasePointerCapture(e.pointerId)
        }}
      >
        {[yMax, yMid, yMin].map((value, index) => (
          <g key={index}>
            <line x1={margin.left} y1={yScale(value)} x2={w - margin.right} y2={yScale(value)} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
            <text x={margin.left - 7} y={yScale(value) + 3} textAnchor="end" fill="#5c5a55" fontSize={10}>{yLabel(value)}</text>
          </g>
        ))}

        {visible.map((d, i) => {
          const cx = xScale(i)
          const open = d.open ?? d.price
          const close = d.price
          const low = d.low ?? d.price
          const high = d.high ?? d.price
          const up = close >= open
          const color = up ? '#3f8600' : '#cf1322'
          const bodyTop = Math.min(yScale(open), yScale(close))
          const bodyH = Math.max(1, Math.abs(yScale(close) - yScale(open)))
          return (
            <g key={`${d.date}-${i}`} opacity={hoverIdx === i ? 1 : 0.82}>
              <line x1={cx} y1={yScale(high)} x2={cx} y2={yScale(low)} stroke={color} strokeWidth={1} />
              <rect x={cx - candleW / 2} y={bodyTop} width={candleW} height={bodyH} fill={color} rx={0.6} />
            </g>
          )
        })}

        <polyline points={visible.map((d, i) => `${xScale(i)},${yScale(d.price)}`).join(' ')} fill="none" stroke={lineColor} strokeWidth={1.2} strokeOpacity={0.34} />

        {hoverIdx !== null && (
          <line x1={xScale(hoverIdx)} y1={margin.top} x2={xScale(hoverIdx)} y2={h - margin.bottom} stroke="#c9a84c" strokeWidth={0.8} strokeDasharray="2 2" opacity={0.7} />
        )}

        <text x={margin.left} y={h - 5} fill="#5c5a55" fontSize={10}>{visible[0]?.date}</text>
        <text x={w - margin.right} y={h - 5} textAnchor="end" fill="#5c5a55" fontSize={10}>{visible[visible.length - 1]?.date}</text>
      </svg>

      {hovered && hoverIdx !== null && (
        <div style={{
          position: 'absolute',
          left: `${Math.min(68, Math.max(2, xScale(hoverIdx) / w * 100))}%`,
          top: 8,
          background: '#1a1a24',
          border: '1px solid rgba(201,168,76,0.2)',
          borderRadius: 8,
          padding: '6px 10px',
          fontSize: 11,
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
        }}>
          <div style={{ color: '#9a9892', marginBottom: 3, fontSize: 10 }}>{hovered.date}</div>
          <div style={{ color: '#e8e6e3' }}>
            开 <span style={{ fontFamily: 'monospace' }}>{hovered.open?.toFixed(3) ?? '-'}</span>
            <span style={{ marginLeft: 10 }}>收 <span style={{ fontFamily: 'monospace' }}>{hovered.price.toFixed(3)}</span></span>
          </div>
          <div style={{ color: '#e8e6e3', marginTop: 2 }}>
            高 <span style={{ fontFamily: 'monospace' }}>{hovered.high?.toFixed(3) ?? '-'}</span>
            <span style={{ marginLeft: 10 }}>低 <span style={{ fontFamily: 'monospace' }}>{hovered.low?.toFixed(3) ?? '-'}</span></span>
          </div>
        </div>
      )}
    </div>
  )
}
