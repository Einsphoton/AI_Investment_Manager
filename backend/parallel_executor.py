"""
Parallel execution utilities for AI analysis operations.
Provides configurable thread pool management and parallel execution strategies.
"""

from __future__ import annotations
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed, Future
from dataclasses import dataclass, field
from typing import Any, Callable, Optional, TypeVar, Sequence

T = TypeVar("T")


@dataclass
class ParallelConfig:
    """Configuration for parallel execution strategy."""
    enabled: bool = True
    max_workers: int = 3
    batch_size: int = 5
    ai_timeout_seconds: int = 120
    parallel_skills: bool = True
    parallel_assets: bool = True
    parallel_dashboard_steps: bool = False

    def to_dict(self) -> dict:
        return {
            "enabled": self.enabled,
            "max_workers": self.max_workers,
            "batch_size": self.batch_size,
            "ai_timeout_seconds": self.ai_timeout_seconds,
            "parallel_skills": self.parallel_skills,
            "parallel_assets": self.parallel_assets,
            "parallel_dashboard_steps": self.parallel_dashboard_steps,
        }

    @classmethod
    def from_dict(cls, data: dict) -> ParallelConfig:
        return cls(
            enabled=bool(data.get("enabled", True)),
            max_workers=int(data.get("max_workers", 3)),
            batch_size=int(data.get("batch_size", 5)),
            ai_timeout_seconds=int(data.get("ai_timeout_seconds", 120)),
            parallel_skills=bool(data.get("parallel_skills", True)),
            parallel_assets=bool(data.get("parallel_assets", True)),
            parallel_dashboard_steps=bool(data.get("parallel_dashboard_steps", False)),
        )


def get_parallel_config(db_session) -> ParallelConfig:
    """Load parallel execution config from database settings."""
    try:
        from ai_service import get_setting
        raw = get_setting(db_session, "parallel_config")
        if raw:
            return ParallelConfig.from_dict(json.loads(raw))
    except Exception:
        pass
    return ParallelConfig()


def save_parallel_config(db_session, config: ParallelConfig) -> None:
    """Save parallel execution config to database settings."""
    try:
        from ai_service import set_setting
        set_setting(db_session, "parallel_config", json.dumps(config.to_dict()))
    except Exception as e:
        print(f"[ParallelExecutor] Failed to save config: {e}")


def parallel_map(
    func: Callable[..., T],
    items: Sequence[Any],
    max_workers: int = 3,
    timeout: Optional[int] = None,
    ordered: bool = False,
    description: str = "",
) -> list[T]:
    """
    Apply a function to each item in parallel using a thread pool.
    Returns results in the same order as input items.

    Args:
        func: Function to apply to each item
        items: Sequence of items to process
        max_workers: Maximum number of parallel workers
        timeout: Timeout per future in seconds
        ordered: If True, returns results in input order; otherwise returns as completed
        description: Optional description for logging

    Returns:
        List of results
    """
    if not items:
        return []

    if max_workers < 2:
        return [func(item) for item in items]

    results: list[tuple[int, T]] = []
    errors: list[tuple[int, Exception]] = []

    with ThreadPoolExecutor(max_workers=min(max_workers, len(items))) as executor:
        future_map: dict[Future, int] = {
            executor.submit(func, item): i for i, item in enumerate(items)
        }

        if ordered:
            for future in as_completed(future_map):
                idx = future_map[future]
                try:
                    results.append((idx, future.result(timeout=timeout)))
                except Exception as e:
                    errors.append((idx, e))
            results.sort(key=lambda x: x[0])
            # Return None for failed items so result length matches input length
            result_map = dict(results)
            return [result_map.get(i) for i in range(len(items))]
        else:
            for future in as_completed(future_map):
                idx = future_map[future]
                try:
                    results.append((idx, future.result(timeout=timeout)))
                except Exception as e:
                    errors.append((idx, e))
            results.sort(key=lambda x: x[0])
            result_map = dict(results)
            return [result_map.get(i) for i in range(len(items))]


def batch_items(items: list[Any], batch_size: int) -> list[list[Any]]:
    """Split a list into batches of specified size."""
    return [items[i:i + batch_size] for i in range(0, len(items), batch_size)]


def analyze_skill_dependencies(skills: dict[str, Any]) -> list[list[str]]:
    """
    Analyze skill dependencies and return execution levels.
    Each level contains skills that can run in parallel because they
    only depend on skills from previous levels.

    Returns:
        List of levels, where each level is a list of skill names
        that can run in parallel.
    """
    # Build dependency graph
    skill_deps: dict[str, set[str]] = {}
    for name, skill in skills.items():
        deps = set()
        for dep in skill.dependencies:
            if dep in skills:
                deps.add(dep)
        skill_deps[name] = deps

    # Topological sort with levels
    levels: list[list[str]] = []
    remaining = set(skill_deps.keys())
    processed: set[str] = set()

    while remaining:
        # Find skills whose all dependencies are already processed
        current_level = [
            name for name in remaining
            if skill_deps[name].issubset(processed)
        ]
        if not current_level:
            # Circular dependency or remaining skills depend on each other
            # Just add all remaining
            current_level = list(remaining)
            break

        levels.append(current_level)
        processed.update(current_level)
        remaining -= set(current_level)

    return levels
