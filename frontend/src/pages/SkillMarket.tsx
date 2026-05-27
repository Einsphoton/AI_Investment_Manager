import { useState, useEffect } from 'react'
import {
  Card, Row, Col, Button, Tag, Space, Typography, Spin, message,
  Input, Select, Empty, Tooltip
} from 'antd'
import {
  DownloadOutlined, DeleteOutlined, CheckCircleFilled,
  SearchOutlined, AppstoreOutlined, FilterOutlined,
  ExperimentOutlined, StarFilled
} from '@ant-design/icons'
import { skillsApi, MarketplaceSkill } from '../api'

const { Text, Title, Paragraph } = Typography

const categoryIcons: Record<string, string> = {
  '数据分析': '📊', '行业研究': '🔬', '量化投资': '🤖',
  '风险管理': '🛡️', '市场数据': '📈', '策略研究': '📐',
  '价值投资': '💎', '固定收益': '🏦', '另类投资': '🏗️',
  '新股研究': '🚀', '事件驱动': '⚡', '可持续投资': '🌱',
}

export default function SkillMarket() {
  const [skills, setSkills] = useState<MarketplaceSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('')

  const fetchSkills = async () => {
    setLoading(true)
    try {
      const data = await skillsApi.installed()
      setSkills(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchSkills() }, [])

  const handleToggle = async (skill: MarketplaceSkill) => {
    setInstalling(skill.id)
    try {
      if (skill.installed) {
        await skillsApi.uninstall(skill.id)
        message.success(`已卸载 ${skill.name}`)
      } else {
        await skillsApi.install(skill.id)
        message.success(`已安装 ${skill.name}`)
      }
      await fetchSkills()
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '操作失败')
    } finally {
      setInstalling(null)
    }
  }

  const categories = Array.from(new Set(skills.map(s => s.category))).sort()

  const filtered = skills.filter(s => {
    if (search && !s.name.includes(search) && !s.description.includes(search)) return false
    if (categoryFilter && s.category !== categoryFilter) return false
    return true
  })

  const installedCount = skills.filter(s => s.installed).length

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}><Spin size="large" /></div>
  }

  return (
    <div className="page-enter">
      <Card
        title={<Space><AppstoreOutlined style={{ color: '#c9a84c' }} /><span>Skill 市场</span></Space>}
        styles={{ body: { padding: 0 } }}
      >
        <div style={{ padding: '16px 24px', borderBottom: '1px solid rgba(201,168,76,0.08)' }}>
          <Row gutter={[16, 16]} align="middle">
            <Col xs={24} md={8}>
              <Input
                prefix={<SearchOutlined style={{ color: '#5c5a55' }} />}
                placeholder="搜索 Skill..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                variant="borderless"
                style={{ background: 'rgba(26,26,36,0.8)', borderRadius: 10, height: 40 }}
              />
            </Col>
            <Col xs={12} md={6}>
              <Select
                placeholder="筛选分类"
                value={categoryFilter || undefined}
                onChange={v => setCategoryFilter(v || '')}
                allowClear
                style={{ width: '100%' }}
                options={categories.map(c => ({ label: `${categoryIcons[c] || '📦'} ${c}`, value: c }))}
              />
            </Col>
            <Col xs={12} md={10}>
              <Space style={{ float: 'right' }}>
                <Text style={{ color: '#5c5a55', fontSize: 13 }}>
                  共 <span style={{ color: '#9a9892' }}>{skills.length}</span> 个 Skill
                </Text>
                <Tag style={{ borderRadius: 6, background: 'rgba(201,168,76,0.12)', border: 'none', color: '#c9a84c' }}>
                  已安装 {installedCount}/{skills.length}
                </Tag>
              </Space>
            </Col>
          </Row>
        </div>

        {filtered.length === 0 ? (
          <Empty description="没有匹配的 Skill" style={{ padding: 60 }} />
        ) : (
          <div style={{ padding: 16 }}>
            <Row gutter={[12, 12]}>
              {filtered.map(skill => (
                <Col xs={24} sm={12} lg={8} xl={6} key={skill.id}>
                  <div style={{
                    padding: 20,
                    borderRadius: 14,
                    background: skill.installed
                      ? 'linear-gradient(135deg, rgba(201,168,76,0.08), rgba(201,168,76,0.02))'
                      : 'rgba(26,26,36,0.5)',
                    border: skill.installed
                      ? '1px solid rgba(201,168,76,0.2)'
                      : '1px solid rgba(255,255,255,0.04)',
                    transition: 'all 0.3s ease',
                    height: '100%',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                  className={skill.installed ? 'pulse-glow' : ''}
                  onMouseEnter={e => {
                    e.currentTarget.style.transform = 'translateY(-2px)'
                    e.currentTarget.style.borderColor = 'rgba(201,168,76,0.3)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.transform = 'translateY(0)'
                    e.currentTarget.style.borderColor = skill.installed ? 'rgba(201,168,76,0.2)' : 'rgba(255,255,255,0.04)'
                  }}
                  >
                    {skill.installed && (
                      <div style={{ position: 'absolute', top: 12, right: 12 }}>
                        <CheckCircleFilled style={{ color: '#c9a84c', fontSize: 16 }} />
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                      <div style={{
                        width: 44, height: 44, borderRadius: 12,
                        background: 'rgba(201,168,76,0.1)',
                        border: '1px solid rgba(201,168,76,0.15)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 22, flexShrink: 0,
                      }}>
                        {skill.icon}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                          <Text style={{ color: '#e8e6e3', fontWeight: 600, fontSize: 14 }} ellipsis>
                            {skill.name}
                          </Text>
                          {skill.is_core && (
                            <Tooltip title="核心 Skill">
                              <StarFilled style={{ color: '#c9a84c', fontSize: 12 }} />
                            </Tooltip>
                          )}
                        </div>
                        <Text style={{ color: '#5c5a55', fontSize: 11 }}>
                          v{skill.version} · {skill.author}
                        </Text>
                      </div>
                    </div>

                    <Paragraph style={{ color: '#9a9892', fontSize: 12, marginBottom: 12, lineHeight: 1.6 }}>
                      {skill.description}
                    </Paragraph>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
                      <Tag style={{
                        borderRadius: 6, fontSize: 11,
                        background: 'rgba(255,255,255,0.04)', border: 'none', color: '#5c5a55',
                      }}>
                        {categoryIcons[skill.category] || '📦'} {skill.category}
                      </Tag>
                      <Button
                        type={skill.installed ? 'default' : 'primary'}
                        size="small"
                        icon={skill.installed ? <DeleteOutlined /> : <DownloadOutlined />}
                        loading={installing === skill.id}
                        onClick={() => handleToggle(skill)}
                        disabled={skill.is_core}
                        style={{
                          borderRadius: 8, fontSize: 12, height: 30,
                          ...(skill.installed ? {
                            borderColor: 'rgba(201,168,76,0.3)', color: '#c9a84c', background: 'transparent',
                          } : {}),
                        }}
                      >
                        {skill.is_core ? '内置' : skill.installed ? '卸载' : '安装'}
                      </Button>
                    </div>
                  </div>
                </Col>
              ))}
            </Row>
          </div>
        )}
      </Card>
    </div>
  )
}
