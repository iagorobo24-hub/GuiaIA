"""Explicit MCP tool registry. All tools read-only or proposal-only."""
from __future__ import annotations

import json
from .planner import propose_gather

TOOL_DEFS = [
    {
        "name": "guia_status",
        "title": "Minecraft world status",
        "description": "Read sanitized status; does not reveal player names or change the world.",
        "annotations": {"readOnlyHint": True},
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "guia_performance",
        "title": "Minecraft performance snapshot",
        "description": "Read available metrics; absent data stays null (never guessed).",
        "annotations": {"readOnlyHint": True},
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "guia_diagnose",
        "title": "Diagnose performance without changing world",
        "description": "Interpret existing telemetry and propose safe next steps; never applies fixes.",
        "annotations": {"readOnlyHint": True},
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "guia_world_observe",
        "title": "Read bounded Fabric world observation",
        "description": "Read a recent, privacy-safe aggregate sample of one already-loaded chunk; no player identities or world changes.",
        "annotations": {"readOnlyHint": True},
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "guia_plan_gather",
        "title": "Propose a bounded companion mission",
        "description": "Parse a Spanish request into an explicit non-executing plan. No gameplay actions.",
        "annotations": {"readOnlyHint": True},
        "inputSchema": {
            "type": "object",
            "properties": {"message": {"type": "string", "maxLength": 180}},
            "required": ["message"], "additionalProperties": False,
        },
    },
]


class ToolError(ValueError):
    pass


class ToolRegistry:
    def __init__(self, observer):
        self.observer = observer

    def list(self) -> list[dict]:
        return TOOL_DEFS

    def invoke(self, name: str, arguments: dict | None) -> dict:
        if not isinstance(arguments, dict):
            raise ToolError("Tool arguments must be an object")
        if name not in {t["name"] for t in TOOL_DEFS}:
            raise ToolError("Unknown tool; no action performed")
        allowed = {"message"} if name == "guia_plan_gather" else set()
        if set(arguments) - allowed:
            raise ToolError("Unexpected arguments; no action performed")
        if name == "guia_status":
            return self.observer.status()
        if name == "guia_performance":
            return self.observer.performance()
        if name == "guia_world_observe":
            return self.observer.world()
        if name == "guia_plan_gather":
            try:
                return propose_gather(arguments.get("message"))
            except ValueError as exc:
                raise ToolError(str(exc)) from exc
        if name == "guia_diagnose":
            metrics = self.observer.performance()
            mspt = metrics.get("mspt_avg")
            tps = metrics.get("tps")
            entities = metrics.get("entities_loaded")
            sampled_entities = metrics.get("sampled_entities")
            findings = []
            if mspt is not None and mspt > 50:
                findings.append("Average tick time is above the 50 ms budget for 20 TPS")
            if tps is not None and tps < 18:
                findings.append("Reported tick rate is below 18 TPS")
            if entities is not None and entities > 300:
                findings.append("High loaded-entity count; investigate correlation, not proof of causality")
            if sampled_entities is not None and sampled_entities >= 64:
                findings.append("Sampled chunk reached maximum entity cap (64); potential entity clustering hotspot")
            world_sample = None
            try:
                if hasattr(self.observer, "world"):
                    w = self.observer.world()
                    world_sample = {
                        "chunks_loaded": w.get("chunks_loaded"),
                        "entities_loaded": w.get("entities_loaded"),
                        "entities_capped": w.get("entities_capped"),
                    }
                    if w.get("entities_capped"):
                        findings.append("Fabric observer entity cap active: excessive entity concentration detected")
            except Exception:
                pass
            if all(val is None for val in (mspt, tps, entities, sampled_entities)):
                findings.append("Performance metrics unavailable: enable a trusted telemetry exporter")
            return {
                "source": metrics.get("source"),
                "evidence": {
                    "mspt_avg": mspt,
                    "tps": tps,
                    "entities_loaded": entities,
                    "sampled_entities": sampled_entities,
                    "world_sample": world_sample,
                },
                "findings": findings,
                "recommendations": [
                    "Collect a bounded sampler profile in a separate QA world",
                    "Compare performance with an isolated control under equivalent load",
                    "Review world-saving and mod interaction without changing player data",
                ],
                "mode": "diagnosis_only",
                "production_changes": 0,
                "note": "Heuristic only, not confirmed root cause",
            }
        raise ToolError("Denied")


def format_content(data: dict, error: bool = False) -> dict:
    return {
        "content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False, sort_keys=True)}],
        "structuredContent": data,
        "isError": error,
    }
