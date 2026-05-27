from .news_sentiment import NewsSentimentSkill
from .industry_chain import IndustryChainSkill
from .quant_strategy import QuantStrategySkill
from .risk_control import RiskControlSkill
from .global_markets import GlobalMarketsSkill
from .sector_rotation import SectorRotationSkill
from .dividend_analysis import DividendAnalysisSkill
from .convertible_bond import ConvertibleBondSkill
from .reits_analysis import REITsAnalysisSkill
from .ipo_analysis import IPOAnalysisSkill
from .ma_analysis import MAAnalysisSkill
from .esg_analysis import ESGAnalysisSkill


MARKETPLACE_SKILL_MAP = {
    "news_sentiment": NewsSentimentSkill,
    "industry_chain": IndustryChainSkill,
    "quant_strategy": QuantStrategySkill,
    "risk_control": RiskControlSkill,
    "global_markets": GlobalMarketsSkill,
    "sector_rotation": SectorRotationSkill,
    "dividend_analysis": DividendAnalysisSkill,
    "convertible_bond": ConvertibleBondSkill,
    "reits_analysis": REITsAnalysisSkill,
    "ipo_analysis": IPOAnalysisSkill,
    "ma_analysis": MAAnalysisSkill,
    "esg_analysis": ESGAnalysisSkill,
}


def get_marketplace_skill_class(skill_id: str):
    return MARKETPLACE_SKILL_MAP.get(skill_id)
