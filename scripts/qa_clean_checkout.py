#!/usr/bin/env python3
"""Reproducible, disposable local clean-checkout verification (no network)."""
from __future__ import annotations

import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
import tempfile

SOURCE = Path(__file__).resolve().parents[1]


def run(args: list[str], *, cwd: Path, env: dict[str, str], timeout: int, label: str) -> str:
    try:
        done = subprocess.run(
            args, cwd=cwd, env=env, text=True, encoding="utf-8",
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            timeout=timeout, check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"{label}: exceeded isolated QA timeout") from exc
    if done.returncode != 0:
        raise RuntimeError(
            f"{label}: process exited {done.returncode}\n"
            + (done.stdout or "")[-3500:]
        )
    print(f"QA_STAGE_PASS={label}", flush=True)
    return done.stdout


def safe_export(archive_bytes: bytes, target: Path) -> None:
    with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode="r:") as bundle:
        items = bundle.getmembers()
        if not items or len(items) > 5000:
            raise RuntimeError("Unexpected QA release tree size")
        for entry in items:
            part = PurePosixPath(entry.name)
            if (
                part.is_absolute() or ".." in part.parts
                or not (entry.isfile() or entry.isdir())
                or entry.name.startswith("./")
                or not str(part)
            ):
                raise RuntimeError("Unsafe tracked QA archive member")
        bundle.extractall(target)


def main() -> int:
    if not (SOURCE / "companion" / "package-lock.json").is_file():
        raise RuntimeError("GuiaIA checkout not found")
    if Path.cwd().resolve() != SOURCE:
        raise RuntimeError("Run from the GuiaIA repository root")
    head = run(
        ["git", "rev-parse", "HEAD"], cwd=SOURCE, env=os.environ.copy(),
        timeout=10, label="git_head",
    ).strip()
    status = run(
        ["git", "status", "--porcelain"], cwd=SOURCE,
        env=os.environ.copy(), timeout=10, label="git_status",
    )
    if status.strip():
        raise RuntimeError("Refusing clean release QA on a dirty worktree")
    archive = subprocess.run(
        ["git", "archive", "--format=tar", "HEAD"],
        cwd=SOURCE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        timeout=20, check=True,
    )
    env = os.environ.copy()
    env.pop("GUIAIA_QA_OWNER", None)
    env.update({
        "PYTHONDONTWRITEBYTECODE": "1",
        "npm_config_offline": "true",
        "npm_config_audit": "false",
        "npm_config_fund": "false",
        "npm_config_update_notifier": "false",
        "npm_config_ignore_scripts": "true",
        "CI": "true",
    })
    with tempfile.TemporaryDirectory(prefix="guiaia-clean-install-qa-", dir="/tmp") as root:
        target = Path(root)
        os.chmod(target, 0o700)
        safe_export(archive.stdout, target)
        print(f"QA_EXPORTED_HEAD={head[:12]}", flush=True)
        lock = (target / "companion" / "package-lock.json").read_bytes()
        lock_sha = hashlib.sha256(lock).hexdigest()
        if lock_sha != hashlib.sha256(
            (SOURCE / "companion" / "package-lock.json").read_bytes()
        ).hexdigest():
            raise RuntimeError("Exported lockfile mismatch")
        node = target / "companion"
        run(
            ["npm", "ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"],
            cwd=node, env=env, timeout=180, label="npm_ci_offline",
        )
        if not (node / "node_modules" / "mineflayer" / "package.json").is_file():
            raise RuntimeError("Missing installed Mineflayer dependency")
        stdout = run(
            ["npm", "test"], cwd=node, env=env, timeout=250,
            label="node_full_regression",
        )
        total = re.search(r"(?m)^# tests (\d+)$", stdout)
        passed = re.search(r"(?m)^# pass (\d+)$", stdout)
        failed = re.search(r"(?m)^# fail (\d+)$", stdout)
        if not all((total, passed, failed)) or total.group(1) != passed.group(1) or failed.group(1) != "0":
            raise RuntimeError("Incomplete clean Node TAP summary")
        env["PYTHONPATH"] = str(target / "src")
        py = run(
            [sys.executable, "-m", "unittest", "discover", "-s", "tests"],
            cwd=target, env=env, timeout=90, label="python_full_regression",
        )
        match = re.search(r"Ran (\d+) tests in", py)
        if match is None or int(match.group(1)) < 1 or "\nOK" not in py:
            raise RuntimeError("Incomplete clean Python regression summary")
        denied = subprocess.run(
            ["node", "src/cli.js", "--qa-local-only"],
            cwd=node, env=env, capture_output=True, text=True, timeout=8,
        )
        if denied.returncode != 2 or "GUIAIA_QA_OWNER" not in denied.stderr:
            raise RuntimeError("Missing-owner QA CLI did not fail closed")
        print("QA_STAGE_PASS=cli_denies_missing_owner", flush=True)
        print("GUIAIA_CLEAN_CHECKOUT_QA_EVIDENCE=" + json.dumps({
            "result": "pass", "head": head, "lock_sha256": lock_sha,
            "npm_offline": True, "dependency_scripts_disabled": True,
            "node_tests": int(total.group(1)),
            "python_tests": int(match.group(1)),
            "missing_owner_denied": True,
            "separate_physical_computer": False,
            "production_touched": False,
            "temporary_checkout_removed_on_exit": True,
        }, sort_keys=True), flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, OSError, subprocess.SubprocessError, tarfile.TarError) as error:
        print(f"Clean checkout QA failed: {str(error)[-3500:]}", file=sys.stderr)
        sys.exit(1)
