from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class SkillContext:
    api_key: str = ""
    base_url: str = ""
    model: str = "gpt-4o-mini"
    db_session: Any = None
    data: dict = field(default_factory=dict)
    personality: str = "balanced"
    report_style: str = "professional"

    @property
    def system_prompt(self) -> str:
        from .personality import build_system_prompt
        return build_system_prompt(self.personality, self.report_style)


class Skill(ABC):
    name: str = ""
    description: str = ""
    dependencies: list[str] = []

    @abstractmethod
    def execute(self, ctx: SkillContext) -> dict:
        pass
