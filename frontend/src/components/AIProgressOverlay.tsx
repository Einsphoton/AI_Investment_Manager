import { useEffect, useRef } from 'react'
import { Progress, Typography, Space } from 'antd'
import {
  RobotOutlined, LoadingOutlined, CheckCircleOutlined, CloseCircleOutlined,
  ThunderboltOutlined, CloseOutlined
} from '@ant-design/icons'
import { useAIWorkContext, LogEntry, SubTask } from '../stores/AIWorkContext'

const { Text } = Typography

const logTypeStyles: Record<LogEntry['type'], { color: string; icon: string }> = {
  info: { color: '#9a9892', icon: '' },
  thinking: { color: '#c9a84c', icon: '💭' },
  progress: { color: '#c9a84c', icon: '⏳' },
  success: { color: '#3f8600', icon: '✅' },
  error: { color: '#cf1322', icon: '❌' },
}

const subTaskStatusIcon: Record<SubTask['status'], { icon: string; color: string }> = {
  pending: { icon: '◻', color: '#5c5a55' },
  running: { icon: '⏳', color: '#c9a84c' },
  completed: { icon: '✅', color: '#3f8600' },
  error: { icon: '❌', color: '#cf1322' },
}

export default function AIProgressOverlay() {
  const { state, resetTask, cancelTask } = useAIWorkContext()
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [state.logs])

  if (!state.isRunning && state.logs.length === 0 && !state.error) return null

  const isComplete = !state.isRunning && !state.error && state.progress === 100
  const isError = !state.isRunning && !!state.error
  const runningSubTasks = state.subTasks.filter(t => t.status === 'running')
  const hasParallel = state.parallelMode && state.subTasks.length > 0

  return (
    <div style={{
      position: 'fixed',
      bottom: 24,
      right: 24,
      width: 440,
      maxHeight: 560,
      background: 'rgba(18, 18, 28, 0.96)',
      borderRadius: 16,
      border: '1px solid rgba(201, 168, 76, 0.2)',
      boxShadow: '0 8px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(201, 168, 76, 0.08)',
      backdropFilter: 'blur(20px)',
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      animation: 'slide-up-fade 0.3s ease-out',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 18px',
        borderBottom: '1px solid rgba(201, 168, 76, 0.1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'linear-gradient(135deg, rgba(201, 168, 76, 0.08), rgba(201, 168, 76, 0.02))',
      }}>
        <Space>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: isComplete
              ? 'linear-gradient(135deg, rgba(63, 134, 0, 0.2), rgba(63, 134, 0, 0.05))'
              : isError
                ? 'linear-gradient(135deg, rgba(207, 19, 34, 0.2), rgba(207, 19, 34, 0.05))'
                : 'linear-gradient(135deg, rgba(201, 168, 76, 0.2), rgba(201, 168, 76, 0.05))',
            border: `1px solid ${
              isComplete ? 'rgba(63, 134, 0, 0.2)' : isError ? 'rgba(207, 19, 34, 0.2)' : 'rgba(201, 168, 76, 0.2)'
            }`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
          }}>
            {isComplete ? <CheckCircleOutlined style={{ color: '#3f8600' }} /> :
             isError ? <CloseCircleOutlined style={{ color: '#cf1322' }} /> :
             <RobotOutlined style={{ color: '#c9a84c' }} />}
          </div>
          <div>
            <Text style={{ color: '#e8e6e3', fontWeight: 600, fontSize: 14 }}>
              {isComplete ? '✅ 分析完成' : isError ? '❌ 分析失败' : state.taskName}
            </Text>
            <div style={{ fontSize: 11, color: '#5c5a55', marginTop: 1 }}>
              {state.startTime
                ? `耗时 ${((Date.now() - state.startTime) / 1000).toFixed(0)}s`
                : '正在准备...'}
            </div>
          </div>
        </Space>
        {state.isRunning ? (
          <div
            onClick={() => {
              if (window.confirm('确定要停止当前分析任务吗？')) {
                cancelTask()
              }
            }}
            style={{
              cursor: 'pointer', color: '#cf1322', fontSize: 12,
              padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(207,19,34,0.2)',
              transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
            onMouseEnter={e => { (e.target as HTMLElement).style.borderColor = 'rgba(207,19,34,0.4)'; (e.target as HTMLElement).style.background = 'rgba(207,19,34,0.08)' }}
            onMouseLeave={e => { (e.target as HTMLElement).style.borderColor = 'rgba(207,19,34,0.2)'; (e.target as HTMLElement).style.background = 'transparent' }}
          >
            <CloseOutlined style={{ fontSize: 10 }} /> 停止
          </div>
        ) : (
          <div
            onClick={resetTask}
            style={{
              cursor: 'pointer', color: '#5c5a55', fontSize: 12,
              padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.06)',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => { (e.target as HTMLElement).style.borderColor = 'rgba(201,168,76,0.3)'; (e.target as HTMLElement).style.color = '#9a9892' }}
            onMouseLeave={e => { (e.target as HTMLElement).style.borderColor = 'rgba(255,255,255,0.06)'; (e.target as HTMLElement).style.color = '#5c5a55' }}
          >关闭</div>
        )}
      </div>

      {/* Thinking + Progress Bar */}
      <div style={{ padding: '14px 18px 8px' }}>
        {state.isRunning && (
          <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <LoadingOutlined style={{ color: '#c9a84c', fontSize: 14 }} />
            <Text style={{ color: '#c9a84c', fontSize: 12, fontWeight: 500, flex: 1 }}>
              {hasParallel
                ? `并行执行中（${runningSubTasks.length} 个任务同时运行）`
                : (state.currentThinking || 'AI 正在思考...')}
            </Text>
            <Text style={{ color: '#5c5a55', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
              {state.progress}%
            </Text>
          </div>
        )}
        <Progress
          percent={state.progress}
          showInfo={false}
          strokeColor={{ from: '#c9a84c', to: '#e8d48b' }}
          trailColor="rgba(255,255,255,0.04)"
          size="small"
          style={{ margin: 0 }}
        />
      </div>

      {/* Sub-task Panel */}
      {hasParallel && (
        <div style={{
          margin: '4px 18px',
          padding: '10px 14px',
          borderRadius: 10,
          background: 'rgba(201, 168, 76, 0.04)',
          border: '1px solid rgba(201, 168, 76, 0.1)',
          animation: 'panel-slide-in 0.4s ease-out',
        }}>
          <div style={{ fontSize: 11, color: '#9a9892', marginBottom: 6, fontWeight: 500, letterSpacing: '0.03em' }}>
            并行任务
          </div>
          {state.subTasks.map(t => {
            const si = subTaskStatusIcon[t.status]
            const isActive = t.status === 'running'
            return (
              <div key={t.id} style={{ marginBottom: t === state.subTasks[state.subTasks.length - 1] ? 0 : 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>{si.icon}</span>
                  <span style={{
                    fontSize: 12,
                    color: isActive ? '#e8e6e3' : t.status === 'completed' ? '#3f8600' : t.status === 'error' ? '#cf1322' : '#5c5a55',
                    fontWeight: isActive ? 500 : 400,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {t.icon} {t.name}
                  </span>
                  <span style={{
                    fontSize: 10,
                    color: isActive ? '#c9a84c' : '#5c5a55',
                    fontVariantNumeric: 'tabular-nums',
                    flexShrink: 0,
                  }}>
                    {t.status === 'completed' ? '100%' : t.status === 'pending' ? '0%' : `${t.progress}%`}
                  </span>
                </div>
                {isActive && (
                  <Progress
                    percent={t.progress}
                    showInfo={false}
                    strokeColor={{ from: '#c9a84c', to: '#e8d48b' }}
                    trailColor="rgba(255,255,255,0.04)"
                    size="small"
                    style={{ margin: 0, paddingLeft: 22 }}
                  />
                )}
                {t.status === 'running' && t.thinking && (
                  <div style={{ fontSize: 10, color: '#9a9892', paddingLeft: 22, marginTop: 1, lineHeight: 1.4 }}>
                    {t.thinking}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Error */}
      {state.error && (
        <div style={{
          margin: '0 18px 8px', padding: '8px 12px', borderRadius: 8,
          background: 'rgba(207, 19, 34, 0.08)', border: '1px solid rgba(207, 19, 34, 0.2)',
        }}>
          <Text style={{ color: '#cf1322', fontSize: 12 }}>{state.error}</Text>
        </div>
      )}

      {/* Final thinking */}
      {state.currentThinking && !state.isRunning && (
        <div style={{ padding: '6px 18px', display: 'flex', alignItems: 'center', gap: 6 }}>
          {isComplete ? <CheckCircleOutlined style={{ color: '#3f8600', fontSize: 12 }} /> : null}
          {isError ? <CloseCircleOutlined style={{ color: '#cf1322', fontSize: 12 }} /> : null}
          <Text style={{ fontSize: 12, color: isComplete ? '#3f8600' : isError ? '#cf1322' : '#9a9892' }}>
            {state.currentThinking}
          </Text>
        </div>
      )}

      {/* Logs */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '8px 18px 14px', maxHeight: 260,
      }}>
        <div style={{
          fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
          fontSize: 11, lineHeight: 1.8,
        }}>
          {state.logs.map((log, i) => (
            <div key={i} style={{
              color: logTypeStyles[log.type].color,
              display: 'flex', alignItems: 'flex-start', gap: 4,
              opacity: i === state.logs.length - 1 && state.isRunning ? 1 : 0.85,
              animation: i === state.logs.length - 1 ? 'fade-in 0.3s ease-out' : 'none',
            }}>
              {/* Tag badge */}
              {log.tag && (
                <span style={{
                  flexShrink: 0,
                  fontSize: 10,
                  padding: '0 5px',
                  borderRadius: 3,
                  background: 'rgba(201, 168, 76, 0.12)',
                  color: '#c9a84c',
                  fontWeight: 500,
                  marginTop: 1,
                }}>
                  {log.tag}
                </span>
              )}
              {logTypeStyles[log.type].icon && !log.tag && (
                <span style={{ flexShrink: 0 }}>{logTypeStyles[log.type].icon}</span>
              )}
              <span style={{ wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
                {log.message}
              </span>
            </div>
          ))}
          {state.isRunning && (
            <span style={{ color: '#c9a84c', animation: 'pulse-dot 1.5s infinite' }}>
              <ThunderboltOutlined style={{ marginRight: 4 }} />
              {hasParallel
                ? `${runningSubTasks.length}/${state.subTasks.length} 个并行任务运行中...`
                : '正在运行...'}
            </span>
          )}
          <div ref={logEndRef} />
        </div>
      </div>

      <style>{`
        @keyframes slide-up-fade {
          from { opacity: 0; transform: translateY(20px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translateX(-4px); }
          to { opacity: 0.85; transform: translateX(0); }
        }
        @keyframes panel-slide-in {
          from { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; margin-top: 0; margin-bottom: 0; }
          to { opacity: 1; max-height: 300px; }
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  )
}
