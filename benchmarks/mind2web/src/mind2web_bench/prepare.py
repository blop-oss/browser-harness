"""Normalize raw Mind2Web JSON into compact live-browser tasks."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Iterator

from .download import data_dir
from .websites import resolve_start_url

SPLIT_HINTS = ("test_task", "test_website", "test_domain", "train")


def split_for(path: Path) -> str:
    joined = "/".join(path.parts).lower()
    return next((hint for hint in SPLIT_HINTS if hint in joined), "unknown")


def iter_raw_tasks(raw_root: Path) -> Iterator[tuple[str, dict]]:
    for json_file in sorted(raw_root.rglob("*.json")):
        try:
            data = json.loads(json_file.read_text())
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        rows = data if isinstance(data, list) else [data]
        for row in rows:
            if isinstance(row, dict) and row.get("confirmed_task"):
                yield split_for(json_file), row


def normalize(split: str, row: dict) -> dict:
    website = (row.get("website") or "").strip()
    return {
        "id": row.get("annotation_id"),
        "split": split,
        "website": website,
        "domain": row.get("domain"),
        "subdomain": row.get("subdomain"),
        "task": (row.get("confirmed_task") or "").strip(),
        "start_url": resolve_start_url(website),
        "num_actions": len(row.get("actions") or []),
        "action_reprs": row.get("action_reprs") or [],
    }


def prepare(
    raw_root: Path | None = None,
    out_dir: Path | None = None,
    limit: int | None = None,
) -> list[dict]:
    raw_root = raw_root or (data_dir() / "raw")
    out_dir = out_dir or data_dir()
    if not raw_root.exists():
        raise SystemExit(f"No raw data at {raw_root}. Run download first.")

    tasks: list[dict] = []
    for split, row in iter_raw_tasks(raw_root):
        tasks.append(normalize(split, row))
        if limit and len(tasks) >= limit:
            break

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "tasks.json").write_text(json.dumps(tasks, indent=2))
    with (out_dir / "tasks.jsonl").open("w") as output:
        for task in tasks:
            output.write(json.dumps(task) + "\n")

    print(f"Prepared {len(tasks)} tasks at {out_dir / 'tasks.json'}")
    for split, count in sorted(Counter(task["split"] for task in tasks).items()):
        print(f"    {split:<14} {count}")
    return tasks
