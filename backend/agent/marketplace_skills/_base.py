import json
from ..skill import Skill, SkillContext


class MarketplaceSkill(Skill):
    dependencies = ["macro_analysis"]

    def build_prompt(self, ctx: SkillContext) -> str:
        raise NotImplementedError

    def execute(self, ctx: SkillContext) -> dict:
        try:
            resp = ctx.client.chat.completions.create(
                model=ctx.model,
                messages=[
                    {"role": "system", "content": ctx.system_prompt},
                    {"role": "user", "content": self.build_prompt(ctx)},
                ],
                response_format={"type": "json_object"},
            )
            return json.loads(resp.choices[0].message.content)
        except Exception as e:
            return {"error": str(e), "fallback": True}
