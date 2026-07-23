"""Download and prepare Mind2Web data for live browser evaluation."""

from __future__ import annotations

import argparse

from .download import data_dir, download_test, download_train
from .prepare import prepare


def _download(split: str, force: bool) -> None:
    if split in ("test", "all"):
        download_test(force=force)
    if split in ("train", "all"):
        download_train()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="mind2web-bench", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    download = sub.add_parser("download", help="fetch and extract the dataset")
    download.add_argument("--split", choices=["test", "train", "all"], default="test")
    download.add_argument("--force", action="store_true")

    prepare_command = sub.add_parser("prepare", help="normalize raw tasks")
    prepare_command.add_argument("--limit", type=int, default=None)

    build = sub.add_parser("build", help="download and prepare in one step")
    build.add_argument("--split", choices=["test", "train", "all"], default="test")
    build.add_argument("--limit", type=int, default=None)
    build.add_argument("--force", action="store_true")

    args = parser.parse_args(argv)
    if args.command == "download":
        _download(args.split, args.force)
    elif args.command == "prepare":
        prepare(limit=args.limit)
    else:
        _download(args.split, args.force)
        prepare(limit=args.limit)

    print(f"\ndata dir: {data_dir()}")
