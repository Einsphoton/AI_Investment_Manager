import { Component, ErrorInfo, ReactNode } from 'react'
import { Button, Typography, Space } from 'antd'

const { Text, Title } = Typography

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '60vh',
          padding: 40,
        }}>
          <div style={{
            padding: '32px 40px',
            borderRadius: 16,
            background: 'rgba(26, 26, 36, 0.8)',
            border: '1px solid rgba(207, 19, 34, 0.2)',
            maxWidth: 500,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>💥</div>
            <Title level={4} style={{ color: '#cf1322', margin: 0, marginBottom: 8 }}>
              页面渲染异常
            </Title>
            <Text style={{ color: '#9a9892', display: 'block', marginBottom: 16, fontSize: 13 }}>
              {this.state.error?.message || '发生了未知错误'}
            </Text>
            <Space>
              <Button
                type="primary"
                onClick={() => {
                  this.setState({ hasError: false, error: null })
                  window.location.reload()
                }}
                style={{ background: '#c9a84c', borderColor: '#c9a84c' }}
              >
                刷新页面
              </Button>
              <Button
                onClick={() => {
                  this.setState({ hasError: false, error: null })
                  window.location.href = '/dashboard'
                }}
              >
                返回首页
              </Button>
            </Space>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
