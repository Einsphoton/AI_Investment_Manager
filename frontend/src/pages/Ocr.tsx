import { useState } from 'react'
import {
  Card, Upload, Button, Table, Space, Tag, Typography, message,
  Modal, Form, Input, InputNumber, Row, Col, Popconfirm, Spin, DatePicker,
  Select, AutoComplete
} from 'antd'
import dayjs from 'dayjs'
import {
  InboxOutlined, ScanOutlined, SaveOutlined,
  DeleteOutlined, PlusOutlined, EditOutlined, EyeOutlined
} from '@ant-design/icons'
import { ocrApi, assetsApi, OcrAssetItem, Asset } from '../api'
import { useNavigate } from 'react-router-dom'

const { Text } = Typography
const { Dragger } = Upload
const goldStyle = { color: '#c9a84c' }

const assetTypeOptions = [
  { label: '股票', value: 'stock' },
  { label: '场外基金', value: 'offshore_fund' },
  { label: '场内基金', value: 'onshore_fund' },
]

const marketOptions = [
  { label: 'A 股', value: 'A' },
  { label: '港股', value: 'HK' },
  { label: '美股', value: 'US' },
]

const typeColors: Record<string, string> = {
  stock: '#c9a84c',
  offshore_fund: '#e8d48b',
  onshore_fund: '#a0893c',
}

const statusMeta: Record<string, { label: string; color: string }> = {
  ready: { label: '可保存', color: 'success' },
  review: { label: '需复核', color: 'warning' },
  invalid: { label: '缺字段', color: 'error' },
}

const platformOptions = [
  { value: '微信理财通' },
  { value: '支付宝' },
  { value: '招商银行' },
  { value: '招商证券' },
  { value: '富途牛牛' },
  { value: '平安银行' },
  { value: '中银国际' },
  { value: '中国银行' },
  { value: '工商银行' },
  { value: '建设银行' },
]

const emptyAsset = (): OcrAssetItem => ({
  asset_type: 'stock',
  market: 'A',
  platform: '',
  code: '',
  name: '',
  shares: null,
  buy_price: null,
  buy_date: '',
  confidence: 0,
  warnings: ['手动添加，请完善信息'],
  evidence: '',
  source_filename: '',
  status: 'review',
})

const missingFieldWarnings = (asset: OcrAssetItem) => {
  const warnings: string[] = []
  if (!asset.code) warnings.push('缺少代码')
  if (!asset.name) warnings.push('缺少名称')
  if (asset.shares == null || asset.shares <= 0) warnings.push('缺少有效持有份额')
  if (asset.buy_price == null || asset.buy_price <= 0) warnings.push('缺少有效买入单价')
  if (!asset.market) warnings.push('缺少市场')
  if (!asset.platform) warnings.push('缺少购买平台')
  return warnings
}

const normalizeEditedAsset = (asset: OcrAssetItem): OcrAssetItem => {
  const persistentWarnings = (asset.warnings || []).filter(w => !w.startsWith('缺少') && !w.includes('有效'))
  const warnings = Array.from(new Set([...persistentWarnings, ...missingFieldWarnings(asset)]))
  let status: OcrAssetItem['status'] = 'ready'
  if (!asset.code || !asset.name) status = 'invalid'
  else if (asset.shares == null || asset.shares <= 0 || asset.buy_price == null || asset.buy_price <= 0 || warnings.length > 0) status = 'review'
  return {
    ...asset,
    warnings,
    status,
    confidence: asset.confidence || (status === 'ready' ? 0.85 : 0.55),
  }
}

const canSaveAsset = (asset: OcrAssetItem) => (
  Boolean(asset.code && asset.name && asset.shares != null && asset.shares > 0 && asset.buy_price != null && asset.buy_price > 0)
)

export default function Ocr() {
  const navigate = useNavigate()
  const [parsedAssets, setParsedAssets] = useState<OcrAssetItem[]>([])
  const [scanCount, setScanCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editForm] = Form.useForm()
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const scanning = scanCount > 0

  const handleUpload = async (file: File) => {
    setScanCount(count => count + 1)
    try {
      const result = await ocrApi.parse(file)
      if (result.assets.length === 0) {
        message.warning(`${file.name} 未识别到资产，请尝试更清晰的截图`)
      } else {
        setParsedAssets(prev => [...prev, ...result.assets.map(normalizeEditedAsset)])
        message.success(`${file.name} 成功识别 ${result.assets.length} 条资产`)
      }
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.message || '识别失败'
      message.error(msg)
    } finally {
      setScanCount(count => Math.max(0, count - 1))
    }
  }

  const openEdit = (index: number) => {
    setEditingIndex(index)
    const asset = parsedAssets[index]
    editForm.setFieldsValue({ ...asset, buy_date: asset.buy_date ? dayjs(asset.buy_date) : null })
    setEditModalOpen(true)
  }

  const handleEditSave = async () => {
    if (editingIndex === null) return
    const values = await editForm.validateFields()
    const updated = [...parsedAssets]
    updated[editingIndex] = normalizeEditedAsset({
      ...updated[editingIndex],
      ...values,
      buy_date: values.buy_date ? values.buy_date.format('YYYY-MM-DD') : '',
    })
    setParsedAssets(updated)
    setEditModalOpen(false)
    message.success('已更新')
  }

  const handleDelete = (index: number) => {
    setParsedAssets(prev => prev.filter((_, i) => i !== index))
    message.success('已删除')
  }

  const handleAddManual = () => {
    const next = emptyAsset()
    setParsedAssets(prev => [...prev, next])
    setEditingIndex(parsedAssets.length)
    editForm.setFieldsValue({ ...next, buy_date: null })
    setEditModalOpen(true)
  }

  const handleSaveAll = async () => {
    const valid = parsedAssets.filter(canSaveAsset)
    if (valid.length === 0) {
      message.warning('没有可保存的有效资产（需至少填写代码、名称、份额、单价）')
      return
    }
    if (valid.length < parsedAssets.length) {
      Modal.confirm({
        title: '部分资产信息不完整',
        content: `${parsedAssets.length - valid.length} 条资产缺少必要信息（代码、名称、份额、单价），将跳过。是否继续？`,
        okText: '继续保存',
        cancelText: '取消',
        onOk: doSave,
      })
    } else {
      doSave()
    }
  }

  const doSave = async () => {
    setSaving(true)
    try {
      const valid = parsedAssets.filter(canSaveAsset)
      const payload = valid.map(a => ({
        asset_type: a.asset_type || 'stock',
        market: a.market || 'A',
        platform: a.platform || '',
        code: a.code,
        name: a.name,
        shares: a.shares || 0,
        buy_price: a.buy_price || 0,
        buy_date: a.buy_date || '',
        current_price: 0,
        note: '',
      }))
      await ocrApi.batchCreate(payload)
      message.success(`成功保存 ${payload.length} 条资产`)
      setParsedAssets([])
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const readyCount = parsedAssets.filter(a => a.status === 'ready').length
  const reviewCount = parsedAssets.filter(a => a.status !== 'ready').length

  const columns = [
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 92,
      render: (v: string, record: OcrAssetItem) => {
        const meta = statusMeta[v] || statusMeta.review
        return (
          <Space direction="vertical" size={2}>
            <Tag color={meta.color} style={{ borderRadius: 6 }}>{meta.label}</Tag>
            {record.confidence > 0 && (
              <Text style={{ color: '#5c5a55', fontSize: 11 }}>
                {Math.round(record.confidence * 100)}%
              </Text>
            )}
          </Space>
        )
      },
    },
    {
      title: '类型', dataIndex: 'asset_type', key: 'asset_type', width: 100,
      render: (v: string) => v ? (
        <Tag color={typeColors[v]} style={{ borderRadius: 6, border: 'none', color: '#fff' }}>
          {assetTypeOptions.find(o => o.value === v)?.label || v}
        </Tag>
      ) : <Tag style={{ borderRadius: 6 }}>待确认</Tag>,
    },
    {
      title: '市场', dataIndex: 'market', key: 'market', width: 70,
      render: (v: string) => v ? (
        <Tag style={{ borderRadius: 6, border: '1px solid #c9a84c', color: '#c9a84c', background: 'transparent' }}>{v}</Tag>
      ) : <span style={{ color: '#5c5a55' }}>-</span>,
    },
    { title: '平台', dataIndex: 'platform', key: 'platform', width: 100, ellipsis: true,
      render: (v: string) => v || <span style={{ color: '#5c5a55' }}>-</span>,
    },
    { title: '代码', dataIndex: 'code', key: 'code', width: 90,
      render: (v: string) => v ? <Text strong style={{ color: '#e8e6e3', fontFamily: 'monospace' }}>{v}</Text> : <span style={{ color: '#5c5a55' }}>-</span>,
    },
    { title: '名称', dataIndex: 'name', key: 'name', width: 130, ellipsis: true,
      render: (v: string) => v || <span style={{ color: '#5c5a55' }}>-</span>,
    },
    {
      title: '份额', dataIndex: 'shares', key: 'shares', width: 100,
      render: (v: number | null) => v != null ? <span style={{ fontWeight: 500 }}>{v.toFixed(2)}</span> : <span style={{ color: '#5c5a55' }}>-</span>,
    },
    {
      title: '买入单价', dataIndex: 'buy_price', key: 'buy_price', width: 100,
      render: (v: number | null) => v != null ? <span style={{ color: '#9a9892' }}>¥{v.toFixed(3)}</span> : <span style={{ color: '#5c5a55' }}>-</span>,
    },
    {
      title: '复核提示', dataIndex: 'warnings', key: 'warnings', width: 180,
      render: (warnings: string[], record: OcrAssetItem) => {
        const text = warnings?.length ? warnings.join('；') : (record.evidence || '')
        return text ? <Text style={{ color: '#9a9892', fontSize: 12 }}>{text}</Text> : <span style={{ color: '#5c5a55' }}>-</span>
      },
    },
    {
      title: '', key: 'action', width: 100,
      render: (_: any, __: any, index: number) => (
        <Space>
          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(index)} style={{ color: '#9a9892' }} />
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(index)} okText="确定" cancelText="取消">
            <Button type="text" size="small" icon={<DeleteOutlined />} style={{ color: '#5c5a55' }} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div className="page-enter">
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <Card
            title={
              <Space>
                <ScanOutlined style={goldStyle} />
                <span>上传截图</span>
              </Space>
            }
            style={{ marginBottom: 16 }}
          >
            <Dragger
              accept="image/png,image/jpeg,image/jpg,image/webp"
              multiple
              showUploadList={false}
              beforeUpload={(file) => {
                const url = URL.createObjectURL(file)
                setPreviewUrl(url)
                handleUpload(file)
                return false
              }}
              disabled={scanning}
            >
              {scanning ? (
                <Space direction="vertical" size={12}>
                  <Spin size="large" />
                  <Text style={{ color: '#9a9892' }}>正在识别 {scanCount} 张截图...</Text>
                </Space>
              ) : (
                <Space direction="vertical" size={8}>
                  <p className="ant-upload-drag-icon">
                    <InboxOutlined />
                  </p>
                  <p className="ant-upload-text" style={{ color: '#e8e6e3' }}>
                    点击或拖拽截图到此处，可一次选择多张
                  </p>
                  <p className="ant-upload-hint" style={{ color: '#5c5a55' }}>
                    支持 PNG / JPG / WebP 格式，建议使用清晰的原图截图
                  </p>
                </Space>
              )}
            </Dragger>
            {previewUrl && !scanning && (
              <div style={{ marginTop: 12, textAlign: 'center' }}>
                <Button
                  type="link"
                  icon={<EyeOutlined />}
                  onClick={() => window.open(previewUrl, '_blank')}
                  style={{ color: '#9a9892' }}
                >
                  查看最后识别的截图
                </Button>
              </div>
            )}
          </Card>

          <Card>
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '16px 20px', borderRadius: 12,
                background: 'rgba(26, 26, 36, 0.5)',
                border: '1px solid rgba(255,255,255,0.04)',
              }}>
                <Space direction="vertical" size={2}>
                  <Text style={{ color: '#e8e6e3', fontWeight: 500, fontSize: 14 }}>
                    批量保存到资产列表
                  </Text>
                  <Text style={{ color: '#5c5a55', fontSize: 12 }}>
                    共 {parsedAssets.length} 条，{readyCount} 条可保存，{reviewCount} 条需复核
                  </Text>
                </Space>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  onClick={handleSaveAll}
                  loading={saving}
                  disabled={parsedAssets.length === 0}
                  style={{ borderRadius: 10, fontWeight: 500 }}
                >
                  保存全部
                </Button>
              </div>
              <Button
                block
                icon={<PlusOutlined />}
                onClick={handleAddManual}
                style={{
                  borderRadius: 10, height: 40,
                  borderColor: 'rgba(201, 168, 76, 0.3)', color: '#c9a84c',
                }}
              >
                手动添加一条资产
              </Button>
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={14}>
          <Card
            title={
              <Space>
                <span style={{ color: '#c9a84c', fontWeight: 600 }}>{parsedAssets.length}</span>
                <span>条识别结果</span>
              </Space>
            }
            styles={{ body: { padding: parsedAssets.length === 0 ? 24 : 0 } }}
          >
            {parsedAssets.length === 0 ? (
              <div style={{
                textAlign: 'center', padding: '60px 20px',
                color: '#5c5a55',
              }}>
                <ScanOutlined style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }} />
                <Text style={{ display: 'block', color: '#5c5a55' }}>
                  上传截图后，识别结果将显示在此处
                </Text>
                <Text style={{ display: 'block', color: '#5c5a55', fontSize: 12, marginTop: 8 }}>
                  识别后可以编辑或删除每一条数据
                </Text>
              </div>
            ) : (
              <Table
                dataSource={parsedAssets.map((a, i) => ({ ...a, _key: i }))}
                columns={columns}
                rowKey="_key"
                pagination={{ pageSize: 50, size: 'small', showTotal: t => `共 ${t} 条` }}
                size="small"
                scroll={{ x: 1100 }}
                style={{ margin: 0 }}
              />
            )}
          </Card>
        </Col>
      </Row>

      <Modal
        title="编辑资产"
        open={editModalOpen}
        onOk={handleEditSave}
        onCancel={() => setEditModalOpen(false)}
        width={600}
        destroyOnHidden
        forceRender
        okText="保存"
        cancelText="取消"
        okButtonProps={{ style: { borderRadius: 10, fontWeight: 500 } }}
        cancelButtonProps={{ style: { borderRadius: 10 } }}
        styles={{ body: { paddingTop: 24 } }}
      >
        <Form form={editForm} layout="vertical" size="middle">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="asset_type" label="资产类型">
                <Select options={assetTypeOptions} placeholder="自动识别" allowClear />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="market" label="市场">
                <Select options={marketOptions} placeholder="自动识别" allowClear />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="code" label="代码" rules={[{ required: true, message: '请输入代码' }]}>
                <Input placeholder="如：000001" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
                <Input placeholder="如：平安银行" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="platform" label="购买平台">
            <AutoComplete options={platformOptions} placeholder="选择或输入购买平台" filterOption={(inputValue, option) => option!.value.toUpperCase().includes(inputValue.toUpperCase())} allowClear />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="shares" label="份额" rules={[{ required: true, message: '请输入份额' }]}>
                <InputNumber style={{ width: '100%' }} min={0} step={0.01} placeholder="份额" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="buy_price" label="买入单价 (¥)" rules={[{ required: true, message: '请输入单价' }]}>
                <InputNumber style={{ width: '100%' }} min={0} step={0.001} placeholder="单价" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="buy_date" label="买入日期">
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" placeholder="选择买入日期" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  )
}
