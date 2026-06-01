import React, { createContext, useContext, useReducer, useCallback, useRef, useEffect } from 'react'

export interface LogEntry {
  timestamp: Date
  message: string
  type: 'info' | 'thinking' | 'progress' | 'success' | 'error'
  tag?: string
}

export interface SubTask {
  id: string
  name: string
  icon: string
  progress: number
  thinking: string
  status: 'pending' | 'running' | 'completed' | 'error'
}

export interface AIWorkState {
  isRunning: boolean
  taskName: string
  progress: number
  currentThinking: string
  logs: LogEntry[]
  error: string | null
  startTime: number | null
  subTasks: SubTask[]
  parallelMode: boolean
}

type AIWorkAction =
  | { type: 'START_TASK'; taskName: string }
  | { type: 'SET_PROGRESS'; progress: number }
  | { type: 'SET_THINKING'; message: string }
  | { type: 'ADD_LOG'; entry: LogEntry }
  | { type: 'SET_PARALLEL_MODE'; enabled: boolean }
  | { type: 'REGISTER_SUB_TASK'; task: SubTask }
  | { type: 'UPDATE_SUB_TASK'; id: string; patch: Partial<SubTask> }
  | { type: 'REMOVE_SUB_TASK'; id: string }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'COMPLETE' }
  | { type: 'AUTO_CLOSE' }
  | { type: 'RESET' }

const initialState: AIWorkState = {
  isRunning: false, taskName: '', progress: 0, currentThinking: '',
  logs: [], error: null, startTime: null, subTasks: [], parallelMode: false,
}

function recomputeAggregate(subTasks: SubTask[]): number {
  if (subTasks.length === 0) return 0
  const total = subTasks.reduce((sum, t) => sum + t.progress, 0)
  return Math.round(total / subTasks.length)
}

function aiWorkReducer(state: AIWorkState, action: AIWorkAction): AIWorkState {
  switch (action.type) {
    case 'START_TASK':
      return { ...initialState, isRunning: true, taskName: action.taskName, startTime: Date.now(),
        logs: [{ timestamp: new Date(), message: `🚀 开始${action.taskName}...`, type: 'info' }] }
    case 'SET_PROGRESS':
      return { ...state, progress: Math.min(100, Math.max(0, action.progress)) }
    case 'SET_THINKING':
      return { ...state, currentThinking: action.message }
    case 'ADD_LOG':
      return { ...state, logs: [...state.logs, action.entry] }
    case 'SET_PARALLEL_MODE':
      return { ...state, parallelMode: action.enabled }
    case 'REGISTER_SUB_TASK': {
      const subTasks = [...state.subTasks, action.task]
      return { ...state, subTasks, progress: recomputeAggregate(subTasks) }
    }
    case 'UPDATE_SUB_TASK': {
      const subTasks = state.subTasks.map(t => t.id === action.id ? { ...t, ...action.patch } : t)
      return { ...state, subTasks, progress: recomputeAggregate(subTasks) }
    }
    case 'REMOVE_SUB_TASK': {
      const subTasks = state.subTasks.filter(t => t.id !== action.id)
      return { ...state, subTasks, progress: recomputeAggregate(subTasks) }
    }
    case 'SET_ERROR':
      return { ...state, error: action.error, isRunning: false }
    case 'COMPLETE': {
      const allDone = state.subTasks.map(t => ({
        ...t, status: t.status === 'running' ? 'completed' as const : t.status, progress: 100,
      }))
      return { ...state, isRunning: false, progress: 100, subTasks: allDone, currentThinking: '✅ 完成',
        logs: [...state.logs, { timestamp: new Date(), message: '✅ 任务完成', type: 'success' }] }
    }
    case 'AUTO_CLOSE': {
      return initialState
    }
    case 'RESET':
      return initialState
    default:
      return state
  }
}

export interface PhaseConfig {
  /** Start progress value for this phase */
  from: number
  /** End progress value when phase completes */
  to: number
  /** Average expected duration in ms (e.g. 8000 = 8s). Progress streams smoothly over this. */
  duration?: number
  /** Thinking messages to rotate through during this phase */
  thinkingMessages?: string[]
  /** Periodic log messages during this phase */
  logMessages?: string[]
  /** Tag for log entries */
  tag?: string
}

interface AIWorkContextValue {
  state: AIWorkState
  startTask: (taskName: string) => void
  updateProgress: (progress: number) => void
  setThinking: (message: string) => void
  addLog: (message: string, type?: LogEntry['type'], tag?: string) => void
  completeTask: () => void
  failTask: (error: string) => void
  cancelTask: () => void
  resetTask: () => void
  setParallelMode: (enabled: boolean) => void
  registerSubTask: (id: string, name: string, icon?: string) => void
  updateSubTask: (id: string, patch: Partial<SubTask>) => void
  removeSubTask: (id: string) => void
  /** Execute an API call with smooth streaming progress, thinking rotations, and periodic logs */
  withPhase: <T>(config: PhaseConfig, apiCall: () => Promise<T>) => Promise<T>
  /** Run multiple phases sequentially with streaming progress */
  runPhases: <T>(phases: (PhaseConfig & { run: () => Promise<T> })[]) => Promise<T[]>
  /** Execute a POST SSE endpoint and dispatch real events as they arrive */
  streamSSE: (url: string, body?: any) => Promise<any>
}

const AIWorkContext = createContext<AIWorkContextValue | null>(null)
const POLLED_STREAM_URLS = new Set([
  '/api/analysis/run-stream',
  '/api/targets/ai-analyze-stream',
  '/api/investment-advice/run-stream',
])

export function AIWorkProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(aiWorkReducer, initialState)
  const intervalSetRef = useRef<Set<ReturnType<typeof setInterval>>>(new Set())
  const timeoutSetRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const abortRef = useRef<AbortController | null>(null)

  const clearAllIntervals = useCallback(() => {
    intervalSetRef.current.forEach(id => clearInterval(id))
    intervalSetRef.current.clear()
    timeoutSetRef.current.forEach(id => clearTimeout(id))
    timeoutSetRef.current.clear()
  }, [])

  useEffect(() => {
    return () => clearAllIntervals()
  }, [clearAllIntervals])

  // Safety net: if progress is 100%, all subtasks finished, and still running, auto-complete
  useEffect(() => {
    if (!state.isRunning) return
    if (state.subTasks.length === 0) return

    const anyRunning = state.subTasks.some(t => t.status === 'running' || t.status === 'pending')
    const allDone = state.subTasks.every(t => t.status === 'completed' || t.status === 'error')

    if (state.progress >= 100 && allDone) {
      // All visible work is complete - auto-finish
      const t = setTimeout(() => dispatch({ type: 'COMPLETE' }), 500)
      timeoutSetRef.current.add(t)
      return () => { clearTimeout(t); timeoutSetRef.current.delete(t) }
    }

    // Global timeout: NAS deployments can be slow when market data and AI calls run together.
    // Keep a guardrail, but do not fail legitimate long analyses after only a few minutes.
    if (state.startTime) {
      const elapsed = Date.now() - state.startTime
      if (elapsed > 900000 && !state.error) {
        dispatch({ type: 'ADD_LOG', entry: { timestamp: new Date(), message: '⏰ 任务超时，自动结束', type: 'info' } })
        dispatch({ type: 'SET_ERROR', error: '任务运行时间过长，已自动结束' })
      }
    }
  }, [state.isRunning, state.progress, state.subTasks, state.startTime, state.error])

  const startTask = useCallback((taskName: string) => {
    clearAllIntervals()
    // Cancel any previous task's AbortController
    if (abortRef.current) {
      abortRef.current.abort()
    }
    abortRef.current = new AbortController()
    dispatch({ type: 'START_TASK', taskName })
  }, [clearAllIntervals])

  const updateProgress = useCallback((progress: number) => {
    dispatch({ type: 'SET_PROGRESS', progress })
  }, [])

  const setThinking = useCallback((message: string) => {
    dispatch({ type: 'SET_THINKING', message })
    dispatch({ type: 'ADD_LOG', entry: { timestamp: new Date(), message, type: 'thinking' } })
  }, [])

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info', tag?: string) => {
    dispatch({ type: 'ADD_LOG', entry: { timestamp: new Date(), message, type, tag } })
  }, [])

  const completeTask = useCallback(() => {
    clearAllIntervals()
    abortRef.current = null
    // Dispatch COMPLETE first, then auto-close after 3 seconds
    const complete = setTimeout(() => {
      dispatch({ type: 'COMPLETE' })
      // Auto-close the overlay after showing completion for 3 seconds
      const autoClose = setTimeout(() => {
        dispatch({ type: 'AUTO_CLOSE' })
      }, 3000)
      timeoutSetRef.current.add(autoClose)
    }, 600)
    timeoutSetRef.current.add(complete)
  }, [clearAllIntervals])

  const failTask = useCallback((error: string) => {
    clearAllIntervals()
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    dispatch({ type: 'ADD_LOG', entry: { timestamp: new Date(), message: `❌ ${error}`, type: 'error' } })
    dispatch({ type: 'SET_ERROR', error })
  }, [clearAllIntervals])

  const cancelTask = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    clearAllIntervals()
    dispatch({ type: 'ADD_LOG', entry: { timestamp: new Date(), message: '⏹️ 用户取消分析', type: 'info' } })
    dispatch({ type: 'SET_ERROR', error: '用户已取消' })
  }, [clearAllIntervals])

  const resetTask = useCallback(() => {
    clearAllIntervals()
    dispatch({ type: 'RESET' })
  }, [clearAllIntervals])

  const setParallelMode = useCallback((enabled: boolean) => {
    dispatch({ type: 'SET_PARALLEL_MODE', enabled })
  }, [])

  const registerSubTask = useCallback((id: string, name: string, icon = '⚡') => {
    dispatch({ type: 'REGISTER_SUB_TASK', task: { id, name, icon, progress: 0, thinking: '等待中...', status: 'pending' } })
  }, [])

  const updateSubTask = useCallback((id: string, patch: Partial<SubTask>) => {
    dispatch({ type: 'UPDATE_SUB_TASK', id, patch })
  }, [])

  const removeSubTask = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_SUB_TASK', id })
  }, [])

  /** Core streaming helper: runs an API call while streaming progress + thinking + logs */
  const withPhase = useCallback(async <T,>(config: PhaseConfig, apiCall: () => Promise<T>): Promise<T> => {
    const to = Math.min(100, config.to)
    const from = Math.max(0, config.from)
    const duration = config.duration ?? 8000
    const startTime = Date.now()

    // 1) Smooth progress: slowly creep from → to over `duration` ms
    //    Uses ease-in curve (starts slow, builds up) + caps at ~75% of target
    //    so the bar never reaches the target before the API actually completes
    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - startTime
      const rawRatio = Math.min(1, elapsed / duration)
      // Ease-in curve: t^1.5 → starts slow, accelerates over time
      const eased = Math.pow(rawRatio, 1.5)
      // Cap at 75% of the way toward target so we never steal the "completed" thunder
      const capped = eased * 0.75
      const current = from + (to - from) * capped
      dispatch({ type: 'SET_PROGRESS', progress: current })
    }, 50)

    // 2) Rotating thinking: change message every 3s
    let thinkIdx = 0
    const thinkInterval = setInterval(() => {
      if (config.thinkingMessages && config.thinkingMessages.length > 0) {
        const msg = config.thinkingMessages[thinkIdx % config.thinkingMessages.length]
        dispatch({ type: 'SET_THINKING', message: msg })
        thinkIdx++
      }
    }, 2500)

    // 3) Periodic logs: emit every 3.5s
    let logIdx = 0
    const logInterval = setInterval(() => {
      if (config.logMessages && config.logMessages.length > 0) {
        const msg = config.logMessages[logIdx % config.logMessages.length]
        dispatch({ type: 'ADD_LOG', entry: { timestamp: new Date(), message: msg, type: 'info', tag: config.tag } })
        logIdx++
      }
    }, 3500)

    // Track intervals in the shared Set for cleanup
    intervalSetRef.current.add(progressInterval)
    intervalSetRef.current.add(thinkInterval)
    intervalSetRef.current.add(logInterval)

    try {
      const result = await apiCall()
      // Jump to target progress immediately
      dispatch({ type: 'SET_PROGRESS', progress: to })
      // Only clear our own intervals
      intervalSetRef.current.delete(progressInterval)
      intervalSetRef.current.delete(thinkInterval)
      intervalSetRef.current.delete(logInterval)
      clearInterval(progressInterval)
      clearInterval(thinkInterval)
      clearInterval(logInterval)
      return result
    } catch (e) {
      intervalSetRef.current.delete(progressInterval)
      intervalSetRef.current.delete(thinkInterval)
      intervalSetRef.current.delete(logInterval)
      clearInterval(progressInterval)
      clearInterval(thinkInterval)
      clearInterval(logInterval)
      throw e
    }
  }, [])

  /** Run multiple streaming phases sequentially */
  const runPhases = useCallback(async <T,>(phases: (PhaseConfig & { run: () => Promise<T> })[]): Promise<T[]> => {
    const results: T[] = []
    for (const phase of phases) {
      const result = await withPhase(phase, phase.run)
      results.push(result)
    }
    return results
  }, [withPhase])

  /** Read a real SSE stream from a POST endpoint and dispatch events to context.
   *  Events are throttled to ~200ms intervals to prevent React from being overwhelmed
   *  by rapid AI token streaming.
   */
  const streamSSE = useCallback(async (url: string, body?: any): Promise<any> => {
    clearAllIntervals()

    const controller = abortRef.current || new AbortController()
    abortRef.current = controller
    const signal = controller.signal

    let safetyTimer: ReturnType<typeof setTimeout> | undefined
    if (!signal.aborted) {
      safetyTimer = setTimeout(() => {
        controller.abort()
      }, 900000)
    }

    if (POLLED_STREAM_URLS.has(url)) {
      try {
        const started = await fetch('/api/stream-jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, body }),
          signal,
        })
        if (!started.ok) {
          const errText = await started.text().catch(() => '')
          throw new Error(errText || `${started.status} ${started.statusText}`)
        }
        const { job_id: jobId } = await started.json()
        let after = -1
        let completed = false

        while (!completed) {
          if (signal.aborted) {
            const cancelErr = new Error('分析已取消')
            ;(cancelErr as any).isCancelled = true
            throw cancelErr
          }

          const polled = await fetch(`/api/stream-jobs/${jobId}?after=${after}`, {
            headers: { 'Cache-Control': 'no-cache' },
            signal,
          })
          if (!polled.ok) {
            const errText = await polled.text().catch(() => '')
            throw new Error(errText || `${polled.status} ${polled.statusText}`)
          }
          const payload = await polled.json()
          for (const event of payload.events || []) {
            after = Math.max(after, Number(event.id))
            const data = event.data || {}
            switch (event.type) {
              case 'progress':
                if (data.progress !== undefined) {
                  dispatch({ type: 'SET_PROGRESS', progress: data.progress })
                }
                break
              case 'thinking':
                if (data.message) {
                  dispatch({ type: 'SET_THINKING', message: data.message })
                }
                break
              case 'log':
                if (data.message) {
                  dispatch({
                    type: 'ADD_LOG',
                    entry: {
                      timestamp: new Date(),
                      message: data.message,
                      type: data.message.startsWith('✅') ? 'success' : 'info',
                      tag: data.tag || undefined,
                    },
                  })
                }
                break
              case 'complete':
                if (safetyTimer) clearTimeout(safetyTimer)
                dispatch({ type: 'SET_PROGRESS', progress: 100 })
                return data
              case 'error':
                if (safetyTimer) clearTimeout(safetyTimer)
                throw new Error(data.detail || '分析失败')
            }
          }

          if (payload.done) {
            completed = true
            if (payload.error) throw new Error(payload.error)
            if (safetyTimer) clearTimeout(safetyTimer)
            return {}
          }
          await new Promise(resolve => setTimeout(resolve, 800))
        }
        if (safetyTimer) clearTimeout(safetyTimer)
        return {}
      } catch (e: any) {
        if (safetyTimer) clearTimeout(safetyTimer)
        if (e.name === 'AbortError' || e.type === 'aborted') {
          const cancelErr = new Error('分析已取消')
          ;(cancelErr as any).isCancelled = true
          throw cancelErr
        }
        throw e
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    }).catch((e: any) => {
      if (e.name === 'AbortError' || e.type === 'aborted') {
        const cancelErr = new Error('分析已取消')
        ;(cancelErr as any).isCancelled = true
        throw cancelErr
      }
      throw e
    })

    if (safetyTimer) clearTimeout(safetyTimer)

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error')
      let detail = errText
      try {
        const parsed = JSON.parse(errText)
        detail = parsed?.detail || parsed?.message || errText
      } catch {
        detail = errText
      }
      throw new Error(detail || `${response.status} ${response.statusText}`)
    }

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let lastDispatchTime = 0
    const THROTTLE_MS = 200
    let pendingProgress: number | null = null
    let pendingThinking: string | null = null
    let flushTimer: ReturnType<typeof setTimeout> | null = null

    // Flush pending throttled updates
    const flush = () => {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
      if (pendingProgress !== null) {
        dispatch({ type: 'SET_PROGRESS', progress: pendingProgress })
        pendingProgress = null
      }
      if (pendingThinking !== null) {
        dispatch({ type: 'SET_THINKING', message: pendingThinking })
        pendingThinking = null
      }
    }

    // Throttled dispatch: coalesces rapid events into periodic updates
    const throttledDispatch = (type: string, data: any) => {
      const now = Date.now()
      const elapsed = now - lastDispatchTime

      if (type === 'progress') {
        pendingProgress = data.progress
      } else if (type === 'thinking') {
        pendingThinking = data.message
      } else {
        // Non-throttled events (log, complete, error) dispatch immediately
        flush()
        return true // signal to dispatch now
      }

      if (elapsed >= THROTTLE_MS) {
        flush()
        lastDispatchTime = now
      } else if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flush()
          lastDispatchTime = Date.now()
        }, THROTTLE_MS - elapsed)
      }
      return false
    }

    return new Promise((resolve, reject) => {
      let currentEvent = ''
      let completed = false
      let streamError: Error | null = null

      const processRead = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              const trimmed = line.trim()
              if (trimmed.startsWith('event: ')) {
                currentEvent = trimmed.slice(7).trim()
              } else if (trimmed.startsWith('data: ')) {
                try {
                  const data = JSON.parse(trimmed.slice(6))

                  switch (currentEvent) {
                    case 'progress':
                      if (data.progress !== undefined) {
                        throttledDispatch('progress', data)
                      }
                      break
                    case 'thinking':
                      if (data.message) {
                        throttledDispatch('thinking', data)
                      }
                      break
                    case 'log':
                      if (data.message) {
                        dispatch({
                          type: 'ADD_LOG',
                          entry: {
                            timestamp: new Date(),
                            message: data.message,
                            type: data.message.startsWith('✅') ? 'success' : 'info',
                            tag: data.tag || undefined,
                          },
                        })
                      }
                      break
                    case 'complete':
                      completed = true
                      flush()
                      dispatch({ type: 'SET_PROGRESS', progress: 100 })
                      resolve(data)
                      return
                    case 'error':
                      completed = true
                      flush()
                      streamError = new Error(data.detail || '分析失败')
                      reject(streamError)
                      return
                  }
                } catch {
                  // Skip malformed JSON
                }
              }
            }
          }
          // Stream ended without complete/error event
          flush()
          if (!completed && !streamError) {
            resolve({})
          }
        } catch (e: any) {
          flush()
          if (!completed) {
            if (e.name === 'AbortError' || e.type === 'aborted') {
              const cancelErr = new Error('分析已取消')
              ;(cancelErr as any).isCancelled = true
              reject(cancelErr)
            } else {
              reject(e)
            }
          }
        }
      }
      processRead().catch((e: any) => {
        flush()
        if (!completed) {
          if (e.name === 'AbortError' || e.type === 'aborted') {
            const cancelErr = new Error('分析已取消')
            ;(cancelErr as any).isCancelled = true
            reject(cancelErr)
          } else {
            reject(e)
          }
        }
      })
    })
  }, [clearAllIntervals])

  return (
    <AIWorkContext.Provider value={{
      state, startTask, updateProgress, setThinking, addLog,
      completeTask, failTask, cancelTask, resetTask, setParallelMode,
      registerSubTask, updateSubTask, removeSubTask,
      withPhase, runPhases, streamSSE,
    }}>
      {children}
    </AIWorkContext.Provider>
  )
}

export function useAIWorkContext() {
  const ctx = useContext(AIWorkContext)
  if (!ctx) throw new Error('useAIWorkContext must be used within AIWorkProvider')
  return ctx
}

export default AIWorkContext
