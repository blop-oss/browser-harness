"""Fetch the Mind2Web dataset from the Hugging Face Hub."""

from __future__ import annotations

import zipfile
from pathlib import Path

from huggingface_hub import hf_hub_download, snapshot_download

REPO_ID = "osunlp/Mind2Web"
ZIP_PASSWORD = b"mind2web"


def data_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "data"


def raw_dir() -> Path:
    directory = data_dir() / "raw"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def download_test(force: bool = False) -> Path:
    raw = raw_dir()
    print(f"Downloading test.zip from {REPO_ID} (about 567 MB)...")
    zip_path = hf_hub_download(
        repo_id=REPO_ID,
        repo_type="dataset",
        filename="test.zip",
        local_dir=str(raw),
    )
    destination = raw / "test"
    if destination.exists() and any(destination.rglob("*.json")) and not force:
        print(f"Already extracted at {destination}")
        return destination
    extract_zip(Path(zip_path), destination)
    return destination


def download_train() -> Path:
    raw = raw_dir()
    print(f"Downloading train data from {REPO_ID} (about 5.4 GB)...")
    snapshot_download(
        repo_id=REPO_ID,
        repo_type="dataset",
        allow_patterns=["data/train/*.json"],
        local_dir=str(raw),
    )
    return raw / "data" / "train"


def extract_zip(zip_path: Path, destination: Path, password: bytes = ZIP_PASSWORD) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(zip_path) as archive:
            archive.extractall(path=destination, pwd=password)
    except NotImplementedError:
        import pyzipper

        with pyzipper.AESZipFile(zip_path) as archive:
            archive.extractall(path=destination, pwd=password)
