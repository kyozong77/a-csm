from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


def resolve_token(token: str | None = None, env_var: str = "HF_TOKEN") -> str:
    resolved = token or os.getenv(env_var)
    if not resolved:
        raise ValueError(f"Missing Hugging Face token. Set {env_var} or pass token explicitly.")
    return resolved


def hf_json_get(url: str, token: str) -> Any:
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def list_dataset_tree(dataset_id: str, token: str) -> list[dict[str, Any]]:
    quoted_id = urllib.parse.quote(dataset_id, safe="/")
    url = f"https://huggingface.co/api/datasets/{quoted_id}/tree/main?recursive=true&expand=false"
    payload = hf_json_get(url, token)
    if not isinstance(payload, list):
        raise ValueError(f"Unexpected tree payload for {dataset_id}.")
    return payload


def dataset_resolve_url(dataset_id: str, path: str) -> str:
    quoted_dataset = urllib.parse.quote(dataset_id, safe="/")
    quoted_path = urllib.parse.quote(path, safe="/")
    return f"https://huggingface.co/datasets/{quoted_dataset}/resolve/main/{quoted_path}?download=true"


def download_dataset_file(dataset_id: str, path: str, destination: str | Path, token: str, expected_size: int | None = None) -> dict[str, Any]:
    target = Path(destination)
    if target.exists():
        current_size = target.stat().st_size
        if expected_size is not None and current_size != expected_size:
            raise FileExistsError(f"{target} exists with size {current_size}, refusing to overwrite expected {expected_size}.")
        return {"path": str(target), "bytes": current_size, "status": "skipped"}

    target.parent.mkdir(parents=True, exist_ok=True)
    temp_path = target.parent / f"{target.name}.part-{os.getpid()}"
    if temp_path.exists():
        raise FileExistsError(f"Temporary path already exists: {temp_path}")

    request = urllib.request.Request(
        dataset_resolve_url(dataset_id, path),
        headers={"Authorization": f"Bearer {token}"},
    )
    bytes_written = 0
    try:
        with urllib.request.urlopen(request, timeout=120) as response, temp_path.open("wb") as handle:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                handle.write(chunk)
                bytes_written += len(chunk)
        if expected_size is not None and bytes_written != expected_size:
            raise ValueError(f"Downloaded size mismatch for {target}: expected {expected_size}, got {bytes_written}")
        temp_path.rename(target)
    except Exception:
        if temp_path.exists():
            temp_path.unlink()
        raise

    return {"path": str(target), "bytes": bytes_written, "status": "downloaded"}
