import { useState, useEffect, useRef } from 'react'
import {
  Card, Form, Input, Button, Switch, message, Space, Typography,
  InputNumber, Modal, Row, Col, Select, Radio, Divider, Spin
} from 'antd'
import {
  ApiOutlined, ClockCircleOutlined, DownloadOutlined, UploadOutlined,
  KeyOutlined, SettingOutlined, SafetyOutlined, RobotOutlined, FileTextOutlined,
  DatabaseOutlined, StockOutlined, BankOutlined, ReloadOutlined, DeleteOutlined,
  WarningOutlined
} from '@ant-design/icons'
import { settingsApi, backupApi, schedulerApi, marketApi, settingsApiFull, dataApi, MarketProviders } from '../api'

const { Text, Paragraph } = Typography
const goldStyle = { color: '#c9a84c' }

const PERSONALITIES: Record<string, { label: string; description: string }> = {
  balanced: { label: '均衡型', description: '风险与收益平衡，适合大多数投资者' },
  conservative: { label: '稳健型', description: '低风险偏好，注重本金安全和稳定收益' },
  aggressive: { label: '进攻型', description: '高风险偏好，追求超额收益，容忍较大回撤' },
  dividend: { label: '收息养老型', description: '注重持续现金流收入，适合退休或现金流需求型投资者' },
  growth: { label: '成长型', description: '聚焦高增长行业和公司，追求资本增值' },
  value: { label: '价值型', description: '寻找被低估的标的，坚持价值投资理念' },
  short_term: { label: '短线交易型', description: '短期波段操作，注重技术面和市场情绪' },
}

const REPORT_STYLES: Record<string, { label: string; description: string }> = {
  professional: { label: '专业模式', description: '使用专业金融术语和结构化分析报告' },
  beginner: { label: '新手模式', description: '用通俗易懂的语言，让投资新手也能轻松理解' },
}

const SCHEDULER_INTERVAL_TYPES: Record<string, string> = {
  minutes: '分钟',
  hours: '小时',
  daily: '每天固定时间',
}

const MARKET_OPTIONS = [
  { value: 'A', label: 'A股' },
  { value: 'HK', label: '港股' },
  { value: 'US', label: '美股' },
]

const normalizeModelOptions = (models: string[]) => {
  const seen = new Set<string>()
  return models
    .map(model => String(model || '').trim())
    .filter(model => {
      if (!model || model.startsWith('ft:') || seen.has(model)) return false
      seen.add(model)
      return true
    })
}

export default function Settings() {
  const [apiForm] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importFileName, setImportFileName] = useState('')
  const [importLoading, setImportLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [clearModalOpen, setClearModalOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [personality, setPersonality] = useState('balanced')
  const [reportStyle, setReportStyle] = useState('professional')

  const [autoAnalyze, setAutoAnalyze] = useState(false)
  const [intervalType, setIntervalType] = useState('hours')
  const [intervalValue, setIntervalValue] = useState(1)
  const [dailyTime, setDailyTime] = useState('09:00')
  const [markets, setMarkets] = useState<string[]>([])
  const [includeTargets, setIncludeTargets] = useState(false)

  const [stockProviders, setStockProviders] = useState<Record<string, string>>({})
  const [fundProviders, setFundProviders] = useState<Record<string, string>>({})
  const [providerLabels, setProviderLabels] = useState<Record<string, string>>({})
  const [stockProviderOpts, setStockProviderOpts] = useState<Record<string, string[]>>({})
  const [fundProviderOpts, setFundProviderOpts] = useState<Record<string, string[]>>({})
  const [ocrUseSeparate, setOcrUseSeparate] = useState(false)
  const [aiModelOptions, setAiModelOptions] = useState<string[]>([])
  const [ocrModelOptions, setOcrModelOptions] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState<'ai' | 'ocr' | null>(null)

  const fetchModels = async (target: 'ai' | 'ocr') => {
    const values = apiForm.getFieldsValue()
    const apiKey = target === 'ai' ? values.openai_api_key : values.ocr_api_key
    const baseUrl = target === 'ai' ? values.openai_base_url : values.ocr_base_url
    if (!apiKey) {
      message.warning('请先输入 API Key')
      return
    }
    setLoadingModels(target)
    try {
      const result = await settingsApiFull.checkModels(apiKey, baseUrl || '')
      const models = normalizeModelOptions(result.models)
      if (target === 'ai') {
        setAiModelOptions(models)
      } else {
        setOcrModelOptions(models)
      }
      message.success(`获取到 ${models.length} 个模型`)
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '获取模型列表失败')
    } finally {
      setLoadingModels(null)
    }
  }

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const [apiKey, baseUrl, model, pers, style, schedCfg,
        dsStockA, dsStockHK, dsStockUS, dsFundA, dsFundHK, dsFundUS, providersInfo,
        ocrSame, ocrKey, ocrBase, ocrModel] = await Promise.all([
        settingsApi.get('openai_api_key'),
        settingsApi.get('openai_base_url'),
        settingsApi.get('openai_model'),
        settingsApi.get('ai_personality'),
        settingsApi.get('ai_report_style'),
        schedulerApi.config(),
        settingsApi.get('datasource_stock_A'),
        settingsApi.get('datasource_stock_HK'),
        settingsApi.get('datasource_stock_US'),
        settingsApi.get('datasource_fund_A'),
        settingsApi.get('datasource_fund_HK'),
        settingsApi.get('datasource_fund_US'),
        marketApi.providers(),
        settingsApi.get('ocr_use_same_as_ai'),
        settingsApi.get('ocr_api_key'),
        settingsApi.get('ocr_base_url'),
        settingsApi.get('ocr_model'),
      ])
      apiForm.setFieldsValue({
        openai_api_key: apiKey.value,
        openai_base_url: baseUrl.value,
        openai_model: model.value || 'gpt-4o-mini',
        ocr_api_key: ocrKey.value,
        ocr_base_url: ocrBase.value,
        ocr_model: ocrModel.value || 'gpt-4o-mini',
      })
      setOcrUseSeparate(ocrSame.value === 'false')
      setPersonality(pers.value || 'balanced')
      setReportStyle(style.value || 'professional')
      setAutoAnalyze(schedCfg.enabled)
      setIntervalType(schedCfg.interval_type || 'hours')
      setIntervalValue(schedCfg.interval_value || 1)
      setDailyTime(schedCfg.daily_time || '09:00')
      setMarkets(schedCfg.markets || [])
      setIncludeTargets(schedCfg.include_targets || false)
      setStockProviders({
        A: dsStockA.value || 'sina',
        HK: dsStockHK.value || 'sina',
        US: dsStockUS.value || 'yahoo',
      })
      setFundProviders({
        A: dsFundA.value || 'eastmoney',
        HK: dsFundHK.value || 'eastmoney',
        US: dsFundUS.value || 'yahoo',
      })
      setProviderLabels(providersInfo.labels)
      setStockProviderOpts(providersInfo.stock_options)
      setFundProviderOpts(providersInfo.fund_options)
    } catch (e) {
      console.error('Failed to load settings', e)
    }
  }

  const handleSaveApi = async () => {
    setSaving(true)
    try {
      const values = apiForm.getFieldsValue()
      await Promise.all([
        settingsApi.update('openai_api_key', values.openai_api_key),
        settingsApi.update('openai_base_url', values.openai_base_url || ''),
        settingsApi.update('openai_model', values.openai_model || 'gpt-4o-mini'),
        settingsApi.update('ocr_use_same_as_ai', String(!ocrUseSeparate)),
        settingsApi.update('ocr_api_key', values.ocr_api_key || ''),
        settingsApi.update('ocr_base_url', values.ocr_base_url || ''),
        settingsApi.update('ocr_model', values.ocr_model || 'gpt-4o-mini'),
      ])
      message.success('API 配置保存成功')
    } catch (e) {
      message.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleAutoAnalyzeChange = async (checked: boolean) => {
    setAutoAnalyze(checked)
    await settingsApi.update('auto_analyze_enabled', String(checked))
    message.success(checked ? '已开启定时分析' : '已关闭定时分析')
  }

  const handleExport = async () => {
    try {
      await backupApi.download()
      message.success('备份文件已下载')
    } catch (e) {
      message.error('导出失败')
    }
  }

  const handleImport = async (file: File) => {
    setImportLoading(true)
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      await backupApi.import(data)
      message.success('数据恢复成功')
      setImportModalOpen(false)
      setImportFileName('')
    } catch (e) {
      message.error('导入失败，请检查 JSON 文件格式')
    } finally {
      setImportLoading(false)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportFileName(file.name)
    handleImport(file)
    e.target.value = ''
  }

  const handleClearData = async () => {
    setClearing(true)
    try {
      await dataApi.clear()
      message.success('所有数据已清空')
      setClearModalOpen(false)
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '清空数据失败')
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="page-enter">
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Form form={apiForm} layout="vertical" size="large">
          <Card
            title={
              <Space>
                <ApiOutlined style={goldStyle} />
                <span>OpenAI API 配置</span>
              </Space>
            }
            style={{ marginBottom: 16 }}
          >
              <Form.Item
                name="openai_api_key"
                label={
                  <Space size={4}>
                    <KeyOutlined style={{ color: '#9a9892' }} />
                    <span>API Key</span>
                  </Space>
                }
                rules={[{ required: true, message: '请输入 API Key' }]}
              >
                <Input.Password
                  placeholder="sk-..."
                  style={{ fontFamily: 'monospace' }}
                />
              </Form.Item>
              <Form.Item
                name="openai_base_url"
                label={
                  <Space size={4}>
                    <SettingOutlined style={{ color: '#9a9892' }} />
                    <span>Base URL（可选）</span>
                  </Space>
                }
              >
                <Input placeholder="https://api.openai.com/v1" />
              </Form.Item>
              <Form.Item
                name="openai_model"
                label={
                  <Space size={4}>
                    <SafetyOutlined style={{ color: '#9a9892' }} />
                    <span>模型</span>
                    <Button
                      type="link" size="small"
                      icon={<ReloadOutlined />}
                      loading={loadingModels === 'ai'}
                      onClick={() => fetchModels('ai')}
                      style={{ color: '#9a9892', padding: '0 4px', fontSize: 12 }}
                    >
                      获取列表
                    </Button>
                  </Space>
                }
              >
                <Select
                  showSearch
                  allowClear
                  placeholder="gpt-4o-mini"
                  notFoundContent={aiModelOptions.length === 0 ? '点击「获取列表」加载模型' : '无匹配模型'}
                  options={aiModelOptions.map(m => ({ key: m, value: m, label: m }))}
                  filterOption={(input, option) =>
                    (option?.label as string || '').toLowerCase().includes(input.toLowerCase())
                  }
                />
              </Form.Item>
          </Card>

          <Card
            title={
              <Space>
                <FileTextOutlined style={goldStyle} />
                <span>OCR 识别模型配置</span>
              </Space>
            }
            style={{ marginBottom: 16 }}
          >
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '16px 20px', borderRadius: 12,
                background: 'rgba(26, 26, 36, 0.5)',
                border: '1px solid rgba(255,255,255,0.04)',
              }}>
                <Space direction="vertical" size={2}>
                  <Text style={{ color: '#e8e6e3', fontWeight: 500, fontSize: 14 }}>使用独立 OCR 模型</Text>
                  <Text style={{ color: '#5c5a55', fontSize: 12 }}>
                    关闭则使用上方 AI 分析的模型配置
                  </Text>
                </Space>
                <Switch
                  checked={ocrUseSeparate}
                  onChange={async (checked) => {
                    setOcrUseSeparate(checked)
                    await settingsApi.update('ocr_use_same_as_ai', String(!checked))
                    message.success(checked ? '已启用独立 OCR 模型' : '已使用 AI 分析模型')
                  }}
                />
              </div>
              {ocrUseSeparate && (
                <div style={{
                  padding: '16px 20px', borderRadius: 12,
                  background: 'rgba(26, 26, 36, 0.5)',
                  border: '1px solid rgba(255,255,255,0.04)',
                }}>
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Text style={{ color: '#5c5a55', fontSize: 12, marginBottom: 8 }}>
                      配置专用的 OCR 识别模型（需支持 Vision/Multimodal 能力）
                    </Text>
                    <Form.Item
                      name="ocr_api_key"
                      label={<Space size={4}><KeyOutlined style={{ color: '#9a9892' }} /><span>OCR API Key</span></Space>}
                    >
                      <Input.Password placeholder="sk-..." style={{ fontFamily: 'monospace' }} />
                    </Form.Item>
                    <Form.Item
                      name="ocr_base_url"
                      label={<Space size={4}><SettingOutlined style={{ color: '#9a9892' }} /><span>OCR Base URL（可选）</span></Space>}
                    >
                      <Input placeholder="https://api.openai.com/v1" />
                    </Form.Item>
                    <Form.Item
                      name="ocr_model"
                      label={
                        <Space size={4}>
                          <SafetyOutlined style={{ color: '#9a9892' }} />
                          <span>OCR 模型</span>
                          <Button
                            type="link" size="small"
                            icon={<ReloadOutlined />}
                            loading={loadingModels === 'ocr'}
                            onClick={() => fetchModels('ocr')}
                            style={{ color: '#9a9892', padding: '0 4px', fontSize: 12 }}
                          >
                            获取列表
                          </Button>
                        </Space>
                      }
                    >
                      <Select
                        showSearch
                        allowClear
                        placeholder="gpt-4o-mini"
                        notFoundContent={ocrModelOptions.length === 0 ? '点击「获取列表」加载模型' : '无匹配模型'}
                        options={ocrModelOptions.map(m => ({ key: m, value: m, label: m }))}
                        filterOption={(input, option) =>
                          (option?.label as string || '').toLowerCase().includes(input.toLowerCase())
                        }
                      />
                    </Form.Item>
                  </Space>
                </div>
              )}
            </Space>
          </Card>
          </Form>
        </Col>
          <Col xs={24} lg={12}>
            <Card
              title={
                <Space>
                  <RobotOutlined style={goldStyle} />
                  <span>AI 投资性格与报告风格</span>
                </Space>
              }
              style={{ marginBottom: 16 }}
            >
              <Space direction="vertical" style={{ width: '100%' }} size="large">
                <div style={{
                  padding: '16px 20px', borderRadius: 12,
                  background: 'rgba(26, 26, 36, 0.5)',
                  border: '1px solid rgba(255,255,255,0.04)',
                }}>
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Text style={{ color: '#e8e6e3', fontWeight: 500, fontSize: 14 }}>
                      AI 投资性格
                    </Text>
                    <Text style={{ color: '#5c5a55', fontSize: 12, marginBottom: 8 }}>
                      选择 AI 分析师的投资风格偏好
                    </Text>
                    <Select
                      value={personality}
                      onChange={async (v) => {
                        setPersonality(v)
                        await settingsApi.update('ai_personality', v)
                        message.success('AI 性格已更新为 ' + PERSONALITIES[v].label)
                      }}
                      style={{ width: '100%' }}
                      options={Object.entries(PERSONALITIES).map(([k, v]) => ({
                        value: k, label: v.label,
                      }))}
                    />
                    <Paragraph style={{
                      color: '#9a9892', fontSize: 12, marginTop: 8, marginBottom: 0,
                      padding: '8px 12px', borderRadius: 8,
                      background: 'rgba(201, 168, 76, 0.06)',
                      border: '1px solid rgba(201, 168, 76, 0.1)',
                    }}>
                      {PERSONALITIES[personality]?.description}
                    </Paragraph>
                  </Space>
                </div>
                <div style={{
                  padding: '16px 20px', borderRadius: 12,
                  background: 'rgba(26, 26, 36, 0.5)',
                  border: '1px solid rgba(255,255,255,0.04)',
                }}>
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Text style={{ color: '#e8e6e3', fontWeight: 500, fontSize: 14 }}>
                      AI 报告风格
                    </Text>
                    <Text style={{ color: '#5c5a55', fontSize: 12, marginBottom: 8 }}>
                      选择 AI 生成分析报告的语言风格
                    </Text>
                    <Radio.Group
                      value={reportStyle}
                      onChange={async (e) => {
                        setReportStyle(e.target.value)
                        await settingsApi.update('ai_report_style', e.target.value)
                        message.success('报告风格已更新为 ' + REPORT_STYLES[e.target.value].label)
                      }}
                      style={{ width: '100%' }}
                    >
                      <Space direction="vertical" style={{ width: '100%' }}>
                        {Object.entries(REPORT_STYLES).map(([k, v]) => (
                          <div key={k} style={{
                            display: 'flex', alignItems: 'center', gap: 12,
                            padding: '10px 16px', borderRadius: 10,
                            border: reportStyle === k
                              ? '1px solid rgba(201, 168, 76, 0.4)'
                              : '1px solid rgba(255,255,255,0.06)',
                            background: reportStyle === k
                              ? 'rgba(201, 168, 76, 0.06)'
                              : 'transparent',
                            cursor: 'pointer',
                          }} onClick={() => {
                            setReportStyle(k)
                            settingsApi.update('ai_report_style', k)
                            message.success('报告风格已更新为 ' + REPORT_STYLES[k].label)
                          }}>
                            <Radio value={k} />
                            <Space direction="vertical" size={0}>
                              <Text style={{ color: '#e8e6e3', fontWeight: 500, fontSize: 13 }}>
                                {v.label}
                              </Text>
                              <Text style={{ color: '#5c5a55', fontSize: 11 }}>
                                {v.description}
                              </Text>
                            </Space>
                          </div>
                        ))}
                      </Space>
                    </Radio.Group>
                  </Space>
                </div>
              </Space>
            </Card>

            <Card
              title={
                <Space>
                  <DatabaseOutlined style={goldStyle} />
                  <span>数据源配置</span>
                </Space>
              }
              style={{ marginBottom: 16 }}
            >
              <Space direction="vertical" style={{ width: '100%' }} size="large">
                <div style={{
                  padding: '16px 20px', borderRadius: 12,
                  background: 'rgba(26, 26, 36, 0.5)',
                  border: '1px solid rgba(255,255,255,0.04)',
                }}>
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Text style={{ color: '#e8e6e3', fontWeight: 500, fontSize: 14 }}>
                      <StockOutlined style={{ marginRight: 6, color: '#c9a84c' }} />
                      股票数据源
                    </Text>
                    <Text style={{ color: '#5c5a55', fontSize: 12, marginBottom: 8 }}>
                      选择各市场股票的实时行情数据来源
                    </Text>
                    {['A', 'HK', 'US'].map(market => {
                      const marketLabel = { A: 'A 股', HK: '港股', US: '美股' }[market]
                      return (
                        <div key={`stock-${market}`} style={{
                          display: 'flex', alignItems: 'center', gap: 12, marginTop: 8,
                          padding: '8px 12px', borderRadius: 8,
                          background: 'rgba(255,255,255,0.02)',
                        }}>
                          <Text style={{ color: '#9a9892', minWidth: 50, fontSize: 13 }}>{marketLabel}</Text>
                          <Select
                            value={stockProviders[market] || 'sina'}
                            onChange={async (v) => {
                              setStockProviders(prev => ({ ...prev, [market]: v }))
                              await settingsApi.update(`datasource_stock_${market}`, v)
                              message.success(`${marketLabel}股票数据源已更新`)
                            }}
                            style={{ flex: 1 }}
                            options={(stockProviderOpts[market] || ['sina', 'tencent', 'eastmoney']).map(p => ({
                              value: p, label: providerLabels[p] || p,
                            }))}
                          />
                        </div>
                      )
                    })}
                  </Space>
                </div>
                <div style={{
                  padding: '16px 20px', borderRadius: 12,
                  background: 'rgba(26, 26, 36, 0.5)',
                  border: '1px solid rgba(255,255,255,0.04)',
                }}>
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Text style={{ color: '#e8e6e3', fontWeight: 500, fontSize: 14 }}>
                      <BankOutlined style={{ marginRight: 6, color: '#c9a84c' }} />
                      基金数据源
                    </Text>
                    <Text style={{ color: '#5c5a55', fontSize: 12, marginBottom: 8 }}>
                      选择各市场基金（场内外）的实时净值估算数据来源
                    </Text>
                    {['A', 'HK', 'US'].map(market => {
                      const marketLabel = { A: 'A 股', HK: '港股', US: '美股' }[market]
                      return (
                        <div key={`fund-${market}`} style={{
                          display: 'flex', alignItems: 'center', gap: 12, marginTop: 8,
                          padding: '8px 12px', borderRadius: 8,
                          background: 'rgba(255,255,255,0.02)',
                        }}>
                          <Text style={{ color: '#9a9892', minWidth: 50, fontSize: 13 }}>{marketLabel}</Text>
                          <Select
                            value={fundProviders[market] || 'eastmoney'}
                            onChange={async (v) => {
                              setFundProviders(prev => ({ ...prev, [market]: v }))
                              await settingsApi.update(`datasource_fund_${market}`, v)
                              message.success(`${marketLabel}基金数据源已更新`)
                            }}
                            style={{ flex: 1 }}
                            options={(fundProviderOpts[market] || ['eastmoney', 'yahoo']).map(p => ({
                              value: p, label: providerLabels[p] || p,
                            }))}
                          />
                        </div>
                      )
                    })}
                  </Space>
                </div>
              </Space>
            </Card>

            <Card
              title={
                <Space>
                  <ClockCircleOutlined style={goldStyle} />
                  <span>定时 AI 分析</span>
                </Space>
              }
              style={{ marginBottom: 16 }}
            >
              <Space direction="vertical" style={{ width: '100%' }} size="large">
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '16px 20px', borderRadius: 12,
                  background: 'rgba(26, 26, 36, 0.5)',
                  border: '1px solid rgba(255,255,255,0.04)',
                }}>
                  <Space direction="vertical" size={2}>
                    <Text style={{ color: '#e8e6e3', fontWeight: 500, fontSize: 14 }}>开启定时分析</Text>
                    <Text style={{ color: '#5c5a55', fontSize: 12 }}>自动运行 AI 分析并生成报告</Text>
                  </Space>
                  <Switch checked={autoAnalyze} onChange={handleAutoAnalyzeChange} />
                </div>

                <div style={{
                  padding: '16px 20px', borderRadius: 12,
                  background: 'rgba(26, 26, 36, 0.5)',
                  border: '1px solid rgba(255,255,255,0.04)',
                }}>
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Text style={{ color: '#e8e6e3', fontWeight: 500, fontSize: 14 }}>交易日限制</Text>
                    <Text style={{ color: '#5c5a55', fontSize: 12, marginBottom: 8 }}>
                      选择后，仅在所选市场的交易日运行分析（周末及法定节假日跳过）
                    </Text>
                    <Select
                      mode="multiple"
                      value={markets}
                      onChange={async (v: string[]) => {
                        setMarkets(v)
                        await settingsApi.update('auto_analyze_markets', v.join(','))
                        message.success('交易日限制已更新')
                      }}
                      placeholder="不限制（每天都运行）"
                      style={{ width: '100%' }}
                      options={MARKET_OPTIONS}
                      maxTagCount={3}
                    />
                    {markets.length > 0 && (
                      <Text style={{ color: '#9a9892', fontSize: 11, marginTop: 4 }}>
                        分析将在 {markets.map(m => MARKET_OPTIONS.find(o => o.value === m)?.label).join('、')} 的交易日运行
                      </Text>
                    )}
                  </Space>
                </div>

                <div style={{
                  padding: '16px 20px', borderRadius: 12,
                  background: 'rgba(26, 26, 36, 0.5)',
                  border: '1px solid rgba(255,255,255,0.04)',
                }}>
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Text style={{ color: '#e8e6e3', fontWeight: 500, fontSize: 14 }}>分析间隔</Text>
                    <Text style={{ color: '#5c5a55', fontSize: 12, marginBottom: 8 }}>
                      选择分析频率和间隔时间
                    </Text>
                    <Space style={{ width: '100%' }}>
                      <Select
                        value={intervalType}
                        onChange={async (v: string) => {
                          setIntervalType(v)
                          await settingsApi.update('auto_analyze_interval_type', v)
                          message.success('间隔类型已更新')
                        }}
                        style={{ width: 130 }}
                        options={Object.entries(SCHEDULER_INTERVAL_TYPES).map(([k, v]) => ({
                          value: k, label: v,
                        }))}
                      />
                      {intervalType !== 'daily' ? (
                        <InputNumber
                          min={intervalType === 'minutes' ? 5 : 1}
                          max={intervalType === 'minutes' ? 1440 : 72}
                          value={intervalValue}
                          onChange={async (v) => {
                            if (!v) return
                            setIntervalValue(v)
                            await settingsApi.update('auto_analyze_interval_value', String(v))
                            message.success(`间隔已设为每 ${v} ${intervalType === 'minutes' ? '分钟' : '小时'}`)
                          }}
                          style={{ width: 100 }}
                          addonAfter={intervalType === 'minutes' ? '分钟' : '小时'}
                        />
                      ) : (
                        <Space>
                          <Input
                            type="time"
                            value={dailyTime}
                            onChange={async (e) => {
                              const t = e.target.value
                              setDailyTime(t)
                              await settingsApi.update('auto_analyze_time', t)
                              message.success(`每日分析时间已设为 ${t}`)
                            }}
                            style={{ width: 130 }}
                          />
                          <Text style={{ color: '#5c5a55', fontSize: 12 }}>运行</Text>
                        </Space>
                      )}
                    </Space>
                  </Space>
                </div>

                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '16px 20px', borderRadius: 12,
                  background: 'rgba(26, 26, 36, 0.5)',
                  border: '1px solid rgba(255,255,255,0.04)',
                }}>
                  <Space direction="vertical" size={2}>
                    <Text style={{ color: '#e8e6e3', fontWeight: 500, fontSize: 14 }}>AI 推荐标的</Text>
                    <Text style={{ color: '#5c5a55', fontSize: 12 }}>
                      定时分析时同时启动 AI 标的推荐
                    </Text>
                  </Space>
                  <Switch
                    checked={includeTargets}
                    onChange={async (checked) => {
                      setIncludeTargets(checked)
                      await settingsApi.update('auto_analyze_include_targets', String(checked))
                      message.success(checked ? '已开启定时推荐标的' : '已关闭定时推荐标的')
                    }}
                  />
                </div>
              </Space>
            </Card>

          <Card
            title={
              <Space>
                <DownloadOutlined style={goldStyle} />
                <span>数据备份与恢复</span>
              </Space>
            }
          >
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 20px',
                borderRadius: 12,
                background: 'rgba(26, 26, 36, 0.5)',
                border: '1px solid rgba(255,255,255,0.04)',
              }}>
                <Space direction="vertical" size={2}>
                  <Text style={{ color: '#e8e6e3', fontWeight: 500, fontSize: 14 }}>下载备份</Text>
                  <Text style={{ color: '#5c5a55', fontSize: 12 }}>导出资产数据和设置到 JSON 文件</Text>
                </Space>
                <Button
                  type="primary"
                  icon={<DownloadOutlined />}
                  onClick={handleExport}
                  style={{ borderRadius: 10, fontWeight: 500 }}
                  ghost
                >
                  下载备份
                </Button>
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 20px',
                borderRadius: 12,
                background: 'rgba(26, 26, 36, 0.5)',
                border: '1px solid rgba(255,255,255,0.04)',
              }}>
                <Space direction="vertical" size={2}>
                  <Text style={{ color: '#e8e6e3', fontWeight: 500, fontSize: 14 }}>恢复数据</Text>
                  <Text style={{ color: '#5c5a55', fontSize: 12 }}>从备份文件恢复资产和设置</Text>
                </Space>
                <Button
                  icon={<UploadOutlined />}
                  onClick={() => setImportModalOpen(true)}
                  style={{ borderRadius: 10, fontWeight: 500, borderColor: 'rgba(201, 168, 76, 0.3)', color: '#c9a84c' }}
                >
                  恢复数据
                </Button>
              </div>
              <Divider style={{ borderColor: 'rgba(255,255,255,0.04)', margin: '4px 0' }} />
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 20px',
                borderRadius: 12,
                background: 'rgba(207, 19, 34, 0.04)',
                border: '1px solid rgba(207, 19, 34, 0.15)',
              }}>
                <Space direction="vertical" size={2}>
                  <Text style={{ color: '#ff4d4f', fontWeight: 500, fontSize: 14 }}>
                    <WarningOutlined style={{ marginRight: 6 }} />清空数据
                  </Text>
                  <Text style={{ color: '#5c5a55', fontSize: 12 }}>清空所有资产数据、标的和设置（不可恢复）</Text>
                </Space>
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => setClearModalOpen(true)}
                  style={{ borderRadius: 10, fontWeight: 500 }}
                >
                  清空数据
                </Button>
              </div>
            </Space>
          </Card>
        </Col>
      </Row>

      <input
        type="file"
        accept=".json"
        ref={fileInputRef}
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />

      <Modal
        title={
          <Space>
            <span style={{ fontSize: 18 }}>📥</span>
            <span>恢复数据</span>
          </Space>
        }
        open={importModalOpen}
        onCancel={() => { setImportModalOpen(false); setImportFileName('') }}
        footer={null}
        width={480}
      >
        <div style={{
          padding: 12,
          borderRadius: 10,
          background: 'rgba(201, 168, 76, 0.06)',
          border: '1px solid rgba(201, 168, 76, 0.15)',
          marginBottom: 20,
          fontSize: 13,
          color: '#c9a84c',
        }}>
          ⚠️ 注意：恢复操作将<strong>覆盖</strong>现有数据！
        </div>

        <div
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: '2px dashed rgba(201, 168, 76, 0.3)',
            borderRadius: 12,
            padding: '40px 20px',
            textAlign: 'center',
            cursor: 'pointer',
            background: 'rgba(201, 168, 76, 0.03)',
            transition: 'border-color 0.2s',
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = '#c9a84c')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(201, 168, 76, 0.3)')}
        >
          <UploadOutlined style={{ fontSize: 36, color: '#c9a84c', display: 'block', marginBottom: 12 }} />
          <Text style={{ color: '#e8e6e3', fontSize: 15, fontWeight: 500, display: 'block', marginBottom: 6 }}>
            {importFileName || '点击选择备份文件'}
          </Text>
          <Text style={{ color: '#5c5a55', fontSize: 12 }}>
            {importLoading ? '正在恢复数据...' : '支持 .json 格式的备份文件'}
          </Text>
          {importLoading && (
            <div style={{ marginTop: 16 }}>
              <Spin />
            </div>
          )}
        </div>
      </Modal>

      <Modal
        title={
          <Space>
            <WarningOutlined style={{ color: '#ff4d4f', fontSize: 18 }} />
            <span style={{ color: '#ff4d4f' }}>清空所有数据</span>
          </Space>
        }
        open={clearModalOpen}
        onOk={handleClearData}
        onCancel={() => setClearModalOpen(false)}
        okText="确认清空"
        cancelText="取消"
        confirmLoading={clearing}
        okButtonProps={{ danger: true, style: { borderRadius: 10, fontWeight: 500 } }}
        cancelButtonProps={{ style: { borderRadius: 10 } }}
      >
        <div style={{
          padding: 16,
          borderRadius: 10,
          background: 'rgba(207, 19, 34, 0.08)',
          border: '1px solid rgba(207, 19, 34, 0.2)',
          marginTop: 8,
        }}>
          <Space direction="vertical" size={8}>
            <Text style={{ color: '#ff4d4f', fontSize: 14, fontWeight: 500 }}>
              此操作将永久删除以下所有数据：
            </Text>
            <ul style={{ color: '#b0aea8', fontSize: 13, margin: 0, paddingLeft: 20, lineHeight: 2 }}>
              <li>所有资产记录（股票、基金等持仓数据）</li>
              <li>所有关注标的（手动添加和 AI 推荐）</li>
              <li>所有分析报告和历史记录</li>
              <li>所有设置和 API 配置</li>
            </ul>
            <Text style={{ color: '#cf1322', fontSize: 13, fontWeight: 500 }}>
              ⚠️ 此操作不可撤销！建议先下载备份。
            </Text>
          </Space>
        </div>
      </Modal>

      <div style={{
        position: 'sticky', bottom: 0, zIndex: 10,
        marginTop: 24, padding: '16px 0',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(18, 18, 28, 0.95)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        textAlign: 'right',
      }}>
        <Button
          type="primary"
          loading={saving}
          onClick={handleSaveApi}
          style={{ borderRadius: 10, fontWeight: 500, height: 44, paddingInline: 40, fontSize: 15 }}
        >
          保存所有配置
        </Button>
      </div>
    </div>
  )
}
