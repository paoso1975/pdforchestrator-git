from __future__ import annotations

import shutil
import time
from pathlib import Path
from typing import Any


_ORCHESTRATOR_REPLAY_SAFE = {
    "input.pdf", "input.pdf-list", "output.pdf", "output.tiff.pages", "output.tiff.multipage", "pdf.output", "loop.eachPage",
    "loop.forEach", "loop.while", "loop.repeatUntil", "flow.break",
    "flow.continue", "flow.jumpPage", "data.setVariable",
}


def is_plan_replay_safe(batch_version: dict[str, Any] | None, registry: Any) -> bool:
    """A crash restarts from immutable input references, never local temp paths."""
    if not isinstance(batch_version, dict):
        return False
    plan = batch_version.get("toolManifest")
    if not isinstance(plan, dict) or plan.get("formatVersion") not in (1, 2):
        return False
    blocks = plan.get("blocks")
    if not isinstance(blocks, list) or not blocks:
        return False
    for block in blocks:
        if not isinstance(block, dict):
            return False
        handler_id, version, runtime = block.get("handlerId"), block.get("version"), block.get("worker")
        if not isinstance(handler_id, str) or not isinstance(version, str):
            return False
        if runtime == "python":
            if not registry.idempotent(handler_id, version):
                return False
        elif runtime == "orchestrator":
            if handler_id not in _ORCHESTRATOR_REPLAY_SAFE:
                return False
        else:
            return False
    return True


def cleanup_stale_temp_dirs(temp_root: str | Path, retention_hours: int = 24, *, now: float | None = None) -> int:
    root = Path(temp_root).resolve()
    if root == Path(root.anchor) or retention_hours < 1:
        raise ValueError("WORKER_TEMP_ROOT o retention non sicura")
    cutoff = (time.time() if now is None else now) - retention_hours * 3600
    removed = 0
    for candidate in root.iterdir():
        if not candidate.name.startswith("pdforch-") or candidate.is_symlink() or not candidate.is_dir():
            continue
        resolved = candidate.resolve()
        if resolved.parent != root or candidate.stat().st_mtime > cutoff:
            continue
        shutil.rmtree(resolved)
        removed += 1
    return removed
