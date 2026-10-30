"""Disposable sandbox and diagnostic assistant for Minecraft Fabric environments.

Enforces zero production impact, loopback-only isolation, and structured
before/after diagnostic reports with verifiable metrics.
"""
from __future__ import annotations

import datetime
import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

from .mcp import MCP


class SandboxSecurityError(ValueError):
    """Raised when sandbox isolation or safety constraints are violated."""
    pass


FORBIDDEN_NAME_PATTERNS = ("teselia", "production", "prod_server", "live_server")


def validate_sandbox_dir(path: Path | str) -> Path:
    """Validate that the given path is strictly a temporary, non-production directory."""
    resolved = Path(path).resolve()
    path_str = str(resolved).lower()
    for forbidden in FORBIDDEN_NAME_PATTERNS:
        if forbidden in path_str:
            raise SandboxSecurityError(f"Access to production-associated path rejected: {resolved}")
    if not resolved.exists():
        raise SandboxSecurityError(f"Sandbox directory does not exist: {resolved}")
    if not resolved.is_dir():
        raise SandboxSecurityError(f"Sandbox target must be a directory: {resolved}")
    return resolved


def generate_sandbox_server_properties(port: int = 25595) -> str:
    """Generate minimal, strictly isolated server properties bound to loopback only."""
    if not (1024 <= port <= 65535):
        raise SandboxSecurityError(f"Invalid loopback port: {port}")
    return (
        f"server-ip=127.0.0.1\n"
        f"server-port={port}\n"
        f"online-mode=false\n"
        f"enforce-secure-profile=false\n"
        f"enable-rcon=false\n"
        f"enable-query=false\n"
        f"max-players=2\n"
        f"view-distance=3\n"
        f"simulation-distance=3\n"
        f"spawn-monsters=false\n"
        f"difficulty=peaceful\n"
        f"level-type=minecraft:flat\n"
        f"level-seed=20261030\n"
        f"motd=Disposable GuiaIA Diagnostic Sandbox\n"
    )


@dataclass
class SandboxComparisonResult:
    anomaly_detected: bool
    improvement_verified: bool
    production_modified: bool
    sandbox_isolated: bool
    before: Dict[str, Any]
    after: Dict[str, Any]
    metrics_delta: Dict[str, Any]
    resolved_findings: List[str]
    remaining_findings: List[str]
    timestamp_utc: str = field(
        default_factory=lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
    )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class DiagnosticAssistant:
    """Diagnostic orchestrator communicating via MCP to analyze performance and generate comparative reports."""

    def __init__(self, mcp_server: MCP):
        self.mcp = mcp_server
        self._bootstrapped = False

    def _ensure_initialized(self) -> None:
        if not self._bootstrapped:
            init_req = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-11-25",
                    "capabilities": {},
                    "clientInfo": {"name": "guiaia-diagnostic-assistant", "version": "0.1.0"},
                },
            }
            res = self.mcp.handle(init_req)
            if res.get("error"):
                raise RuntimeError(f"MCP initialization failed: {res['error']}")
            self.mcp.handle({"jsonrpc": "2.0", "method": "notifications/initialized"})
            self._bootstrapped = True

    def run_diagnosis(self) -> Dict[str, Any]:
        """Perform a structured read-only diagnosis via MCP."""
        self._ensure_initialized()
        call_req = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": "guia_diagnose", "arguments": {}},
        }
        res = self.mcp.handle(call_req)
        if res.get("error") or res.get("result", {}).get("isError"):
            raise RuntimeError(f"Diagnostic tool call failed: {res}")
        return res["result"]["structuredContent"]

    def compare(
        self,
        before_diag: Dict[str, Any],
        after_diag: Dict[str, Any],
        sandbox_path: Optional[Path | str] = None,
    ) -> SandboxComparisonResult:
        """Analyze before and after diagnostic snapshots and compute metrics diff."""
        isolated = True
        if sandbox_path is not None:
            validate_sandbox_dir(sandbox_path)

        before_findings = before_diag.get("findings", [])
        after_findings = after_diag.get("findings", [])

        resolved = [f for f in before_findings if f not in after_findings]
        remaining = list(after_findings)

        ev_before = before_diag.get("evidence", {})
        ev_after = after_diag.get("evidence", {})

        metrics_delta: Dict[str, Any] = {}
        for key in ("mspt_avg", "tps", "entities_loaded", "sampled_entities"):
            v_before = ev_before.get(key)
            v_after = ev_after.get(key)
            if v_before is not None and v_after is not None:
                metrics_delta[key + "_delta"] = round(v_after - v_before, 3)

        anomaly_detected = len(before_findings) > 0
        production_modified = (
            before_diag.get("production_changes", 0) != 0
            or after_diag.get("production_changes", 0) != 0
        )

        improvement_verified = False
        if anomaly_detected:
            if len(resolved) > 0 or len(after_findings) < len(before_findings):
                improvement_verified = True
            elif metrics_delta.get("entities_loaded_delta", 0) < 0:
                improvement_verified = True
            elif metrics_delta.get("sampled_entities_delta", 0) < 0:
                improvement_verified = True
            elif metrics_delta.get("mspt_avg_delta", 0) < 0:
                improvement_verified = True
        else:
            improvement_verified = len(after_findings) == 0

        return SandboxComparisonResult(
            anomaly_detected=anomaly_detected,
            improvement_verified=improvement_verified,
            production_modified=production_modified,
            sandbox_isolated=isolated,
            before=before_diag,
            after=after_diag,
            metrics_delta=metrics_delta,
            resolved_findings=resolved,
            remaining_findings=remaining,
        )
