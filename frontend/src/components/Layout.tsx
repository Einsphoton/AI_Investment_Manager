import { Layout, Menu } from 'antd'
import {
  DashboardOutlined,
  WalletOutlined,
  SettingOutlined,
  AimOutlined,
  AppstoreOutlined,
  ScanOutlined,
} from '@ant-design/icons'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'

const { Header, Sider, Content } = Layout

const menuItems = [
  {
    key: '/dashboard',
    icon: <DashboardOutlined />,
    label: 'Dashboard',
  },
  {
    key: '/assets',
    icon: <WalletOutlined />,
    label: '我的资产',
  },
  {
    key: '/ocr',
    icon: <ScanOutlined />,
    label: 'OCR 导入',
  },
  {
    key: '/targets',
    icon: <AimOutlined />,
    label: '我的标的',
  },
  {
    key: '/skills',
    icon: <AppstoreOutlined />,
    label: 'Skill 市场',
  },
  {
    key: '/settings',
    icon: <SettingOutlined />,
    label: '设置',
  },
]

export default function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()

  const currentLabel = menuItems.find(i => i.key === location.pathname)?.label || 'AI 投资分析平台'

  return (
    <Layout style={{ minHeight: '100vh', position: 'relative' }}>
      <div style={{
        position: 'fixed',
        inset: 0,
        background: 'radial-gradient(ellipse 80% 60% at 50% -20%, rgba(201, 168, 76, 0.06), transparent), radial-gradient(ellipse 60% 40% at 80% 80%, rgba(201, 168, 76, 0.04), transparent), radial-gradient(ellipse 40% 30% at 20% 60%, rgba(201, 168, 76, 0.03), transparent)',
        pointerEvents: 'none',
        zIndex: 0,
      }} />
      <Sider
        breakpoint="lg"
        collapsedWidth="0"
        width={240}
        style={{
          position: 'relative',
          zIndex: 1,
          borderRight: '1px solid rgba(201, 168, 76, 0.08)',
        }}
      >
        <div style={{
          height: 72,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          borderBottom: '1px solid rgba(201, 168, 76, 0.08)',
          margin: '0 16px',
        }}>
          <div style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: 'linear-gradient(135deg, rgba(201, 168, 76, 0.2), rgba(201, 168, 76, 0.05))',
            border: '1px solid rgba(201, 168, 76, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 20,
            marginBottom: 4,
          }}>
            📈
          </div>
          <span style={{
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '0.05em',
            background: 'linear-gradient(135deg, #c9a84c, #e8d48b)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>
            AI 投资分析
          </span>
        </div>
        <div style={{ padding: '16px 0' }}>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[location.pathname]}
            items={menuItems}
            onClick={({ key }) => navigate(key)}
            style={{ background: 'transparent', border: 'none' }}
          />
        </div>
      </Sider>
      <Layout style={{ position: 'relative', zIndex: 1 }}>
        <Header style={{
          padding: '0 32px',
          background: 'rgba(17, 17, 24, 0.6)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(201, 168, 76, 0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 64,
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}>
          <span style={{
            fontSize: 18,
            fontWeight: 600,
            color: '#e8e6e3',
            letterSpacing: '0.02em',
          }}>
            {currentLabel}
          </span>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13,
            color: 'rgba(201, 168, 76, 0.6)',
            letterSpacing: '0.03em',
          }}>
            <span style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#c9a84c',
              display: 'inline-block',
              animation: 'pulse-glow 2s ease-in-out infinite',
            }} />
            System Online
          </div>
        </Header>
        <Content style={{
          margin: 0,
          padding: 24,
          minHeight: 'calc(100vh - 64px)',
          position: 'relative',
        }}>
          <div className="page-enter">
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  )
}
