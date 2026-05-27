import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import './styles/global.css'

const darkTheme = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#c9a84c',
    colorBgContainer: 'rgba(26, 26, 36, 0.6)',
    colorBgElevated: '#1a1a24',
    colorBgLayout: '#0a0a0f',
    colorText: '#e8e6e3',
    colorTextSecondary: '#9a9892',
    colorBorder: 'rgba(201, 168, 76, 0.12)',
    borderRadius: 12,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans SC', sans-serif",
    fontSize: 14,
    controlHeight: 40,
    wireframe: false,
  },
  components: {
    Layout: {
      headerBg: 'rgba(17, 17, 24, 0.8)',
      bodyBg: '#0a0a0f',
      siderBg: 'rgba(11, 11, 18, 0.95)',
      triggerBg: '#1a1a24',
      triggerHeight: 48,
    },
    Menu: {
      itemBg: 'transparent',
      itemColor: '#9a9892',
      itemHoverBg: 'rgba(201, 168, 76, 0.08)',
      itemHoverColor: '#e8e6e3',
      itemSelectedBg: 'rgba(201, 168, 76, 0.15)',
      itemSelectedColor: '#c9a84c',
      itemBorderRadius: 10,
      itemMarginInline: 12,
      itemMarginBlock: 4,
      subMenuItemBg: 'transparent',
      groupTitleColor: '#5c5a55',
    },
    Table: {
      headerBg: 'rgba(26, 26, 36, 0.8)',
      headerColor: '#9a9892',
      rowHoverBg: 'rgba(201, 168, 76, 0.04)',
      borderColor: 'rgba(255, 255, 255, 0.04)',
    },
    Card: {
      paddingLG: 24,
    },
  },
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider theme={darkTheme} locale={zhCN}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>,
)
