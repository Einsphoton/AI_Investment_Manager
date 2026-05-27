from __future__ import annotations
import json
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session
from models import InstalledSkill

CORE_SKILL_NAMES = {
    "stock_analysis", "tushare_finance", "macro_analysis",
    "fundamental_analysis", "technical_analysis", "recommendation", "target_analysis",
}


@dataclass
class SkillDefinition:
    id: str
    name: str
    description: str
    category: str
    version: str
    author: str
    icon: str
    long_description: str
    provider: str = "skillhub.cloud.tencent.com"
    is_core: bool = False


MARKETPLACE_SKILLS: list[SkillDefinition] = [
    # ===== 核心 Skill（内置，不可卸载）=====
    SkillDefinition(
        id="stock_analysis", name="Stock Analysis",
        description="对个股/基金进行深度分析，结合市场数据和公司基本面",
        category="核心分析", version="3.2.0", author="SkillHub Finance",
        icon="📈",
        long_description="集成 skillhub.cloud.tencent.com 的 Stock Analysis 金融数据接口，"
                        "对股票和基金进行多层次分析，涵盖市场环境、行业地位、业务模式与风险评估。",
        is_core=True,
    ),
    SkillDefinition(
        id="tushare_finance", name="Tushare Finance",
        description="集成 Tushare 金融数据接口，获取实时行情、财务数据、市场数据",
        category="核心分析", version="3.1.0", author="Tushare Pro",
        icon="💹",
        long_description="通过 skillhub.cloud.tencent.com 接入 Tushare Pro 金融数据接口，"
                        "提供实时行情、日线数据、财务指标、板块数据等全面的金融数据支持。",
        is_core=True,
    ),
    SkillDefinition(
        id="macro_analysis", name="宏观环境分析",
        description="分析全球及主要经济体的政治经济宏观环境，包括政策、经济数据、地缘政治",
        category="核心分析", version="2.0.0", author="AI Investment",
        icon="🌐",
        long_description="综合全球宏观经济数据与地缘政治信息，进行多维度的宏观环境扫描，"
                        "为投资决策提供宏观背景支持。",
        is_core=True,
    ),
    SkillDefinition(
        id="fundamental_analysis", name="基本面分析",
        description="对投资标的进行基本面分析，包括财务估值、成长性、竞争优势等",
        category="核心分析", version="2.1.0", author="AI Investment",
        icon="📊",
        long_description="从财务状况、估值水平、成长潜力、竞争壁垒等维度进行全方位基本面评估，"
                        "量化分析标的的内在价值与安全边际。",
        is_core=True,
    ),
    SkillDefinition(
        id="technical_analysis", name="技术面分析",
        description="对投资标的进行技术面分析，包括趋势判断、支撑阻力位、量价分析等",
        category="核心分析", version="2.0.0", author="AI Investment",
        icon="📉",
        long_description="通过趋势分析、动量指标、量价关系等技术分析工具，"
                        "判断标的的中短期走势方向与关键价格节点。",
        is_core=True,
    ),
    SkillDefinition(
        id="recommendation", name="投资建议生成",
        description="基于多维度分析结果生成最终投资建议和操作策略",
        category="核心分析", version="2.0.0", author="AI Investment",
        icon="🎯",
        long_description="综合宏观分析、基本面、技术面及 AI 主观判断等多个维度的分析结果，"
                        "生成具体的买卖建议、目标价位、止损设置与仓位管理策略。",
        is_core=True,
    ),
    SkillDefinition(
        id="target_analysis", name="AI 标的推荐",
        description="结合市场环境分析现有标的并推荐新标的",
        category="核心分析", version="1.0.0", author="AI Investment",
        icon="🎯",
        long_description="基于当前市场环境与用户关注列表，智能分析现有标的并推荐新的投资标的。",
        is_core=True,
    ),
    # ===== 市场可安装 Skill =====
    SkillDefinition(
        id="news_sentiment", name="新闻情绪分析",
        description="基于财经新闻与社交媒体的情感分析，判断市场情绪走向",
        category="数据分析", version="2.1.0", author="SkillHub Finance",
        icon="📰",
        long_description="通过 NLP 技术实时分析主流财经媒体与社交平台的情感倾向，"
                        "识别市场恐慌、贪婪等情绪指标，辅助判断短期市场走势。"  # noqa: E501
    ),
    SkillDefinition(
        id="industry_chain", name="产业链分析",
        description="深度分析产业链上下游关系，挖掘产业链投资机会",
        category="行业研究", version="1.8.0", author="SkillHub Finance",
        icon="🔗",
        long_description="梳理重点产业的上下游结构，分析各环节的利润分配、"
                        "竞争格局与景气度变化，帮助发现产业链中的高价值环节。"
    ),
    SkillDefinition(
        id="quant_strategy", name="量化策略回测",
        description="提供多因子模型、趋势跟踪等量化策略的历史回测与优化",
        category="量化投资", version="3.0.0", author="QuantWorks",
        icon="📊",
        long_description="集成多种经典量化策略（多因子、动量、均值回归等），"
                        "支持自定义参数回测与绩效分析，生成夏普比率、最大回撤等指标。"
    ),
    SkillDefinition(
        id="risk_control", name="风控模型分析",
        description="VaR 计算、压力测试、尾部风险建模等风控能力",
        category="风险管理", version="2.3.0", author="RiskMetrics Labs",
        icon="🛡️",
        long_description="提供投资组合的 VaR、CVaR 计算，支持蒙特卡洛模拟压力测试，"
                        "识别尾部风险与相关性突变，辅助设置动态止损策略。"
    ),
    SkillDefinition(
        id="global_markets", name="全球市场追踪",
        description="追踪全球主要股指、商品、汇率、债券市场的联动变化",
        category="市场数据", version="1.9.0", author="SkillHub Finance",
        icon="🌍",
        long_description="实时监测美股、欧股、日股、新兴市场等全球主要指数的表现，"
                        "分析跨资产类别的相关性与资金流向。"
    ),
    SkillDefinition(
        id="sector_rotation", name="行业轮动分析",
        description="识别市场风格切换与行业轮动周期，捕捉结构性机会",
        category="策略研究", version="1.5.0", author="MacroPulse",
        icon="🔄",
        long_description="基于经济周期与资金流向数据，分析各行业的相对强弱变化，"
                        "识别行业轮动拐点，提供行业配置建议。"
    ),
    SkillDefinition(
        id="dividend_analysis", name="分红派息分析",
        description="分析上市公司分红政策、股息率、除权除息日历",
        category="价值投资", version="1.2.0", author="ValueInvest Tech",
        icon="💰",
        long_description="跟踪 A 股/港股的除权除息日历，分析分红率、股息率的历史"
                        "变化与可持续性，辅助红利投资策略。"
    ),
    SkillDefinition(
        id="convertible_bond", name="可转债分析",
        description="可转债定价、溢价率分析、转股套利机会识别",
        category="固定收益", version="2.0.0", author="FixedIncome AI",
        icon="🔀",
        long_description="对可转债进行定价分析，计算转股溢价率、纯债价值、"
                        "隐含波动率等指标，识别转股套利与下修博弈机会。"
    ),
    SkillDefinition(
        id="reits_analysis", name="REITs 分析",
        description="不动产投资信托基金估值与分红分析",
        category="另类投资", version="1.3.0", author="RealAsset Labs",
        icon="🏢",
        long_description="分析 REITs 的资产组合质量、NAV 估值、分红收益率、"
                        " occupancy 率等关键指标，覆盖亚太市场主要 REITs 产品。"
    ),
    SkillDefinition(
        id="ipo_analysis", name="IPO 分析",
        description="新股招股书解读、估值对比、打新策略建议",
        category="新股研究", version="1.6.0", author="SkillHub Finance",
        icon="🚀",
        long_description="对即将上市的新股进行基本面分析，对比同行业估值水平，"
                        "评估发行定价合理性，给出打新参与建议。"
    ),
    SkillDefinition(
        id="ma_analysis", name="并购重组分析",
        description="并购重组事件驱动策略，分析交易结构与协同效应",
        category="事件驱动", version="1.4.0", author="EventAlpha",
        icon="🤝",
        long_description="分析并购重组交易的定价合理性、协同效应评估、"
                        "审批风险与套利空间，捕捉事件驱动型投资机会。"
    ),
    SkillDefinition(
        id="esg_analysis", name="ESG 可持续投资",
        description="环境、社会与治理评分，可持续投资策略分析",
        category="可持续投资", version="2.2.0", author="GreenFin AI",
        icon="🌱",
        long_description="基于 ESG 评分体系，评估企业的环境、社会和治理表现，"
                        "识别可持续发展主题投资机会，生成 ESG 投资组合建议。"
    ),
]


def get_all_skills() -> list[dict]:
    return [
        {
            "id": s.id, "name": s.name, "description": s.description,
            "category": s.category, "version": s.version, "author": s.author,
            "icon": s.icon, "long_description": s.long_description,
            "provider": s.provider, "is_core": s.is_core,
        }
        for s in MARKETPLACE_SKILLS
    ]


def get_core_skills() -> list[dict]:
    return [
        {
            "id": s.id, "name": s.name, "description": s.description,
            "category": s.category, "version": s.version, "author": s.author,
            "icon": s.icon, "long_description": s.long_description,
            "provider": "built-in", "is_core": True,
        }
        for s in MARKETPLACE_SKILLS
    ]


def get_skill_by_id(skill_id: str) -> dict | None:
    for s in MARKETPLACE_SKILLS:
        if s.id == skill_id:
            return {
                "id": s.id, "name": s.name, "description": s.description,
                "category": s.category, "version": s.version, "author": s.author,
                "icon": s.icon, "long_description": s.long_description,
                "provider": s.provider, "is_core": s.is_core,
            }
    return None


def get_installed_skill_names(db: Session) -> set[str]:
    installed = set(CORE_SKILL_NAMES)
    records = db.query(InstalledSkill).filter(InstalledSkill.enabled == True).all()
    installed.update(r.skill_id for r in records)
    return installed


def install_skill(db: Session, skill_id: str) -> bool:
    if skill_id in CORE_SKILL_NAMES:
        return True
    record = db.query(InstalledSkill).filter(InstalledSkill.skill_id == skill_id).first()
    if record:
        record.enabled = True
    else:
        record = InstalledSkill(skill_id=skill_id, enabled=True)
        db.add(record)
    db.commit()
    return True


def uninstall_skill(db: Session, skill_id: str) -> bool:
    if skill_id in CORE_SKILL_NAMES:
        return False
    record = db.query(InstalledSkill).filter(InstalledSkill.skill_id == skill_id).first()
    if record:
        record.enabled = False
        db.commit()
    return True
