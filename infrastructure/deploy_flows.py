#!/usr/bin/env python3
"""Idempotent Kestra flow deployment engine for Sentinel Grid.

The script validates every YAML document locally before importing it into
Kestra. It supports bearer tokens and basic auth without leaking secrets to
logs, and is intentionally transport-only: flow semantics stay in /flows.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import dataclasses
import hashlib
import os
from pathlib import Path
from typing import Final, Iterable

import httpx
import yaml


DEFAULT_API_URL: Final[str] = "http://127.0.0.1:8080"
DEFAULT_TENANT: Final[str] = "main"


@dataclasses.dataclass(frozen=True, slots=True)
class KestraAuth:
    token: str | None
    username: str | None
    password: str | None

    def headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        elif self.username and self.password:
            credentials = f"{self.username}:{self.password}".encode("utf-8")
            headers["Authorization"] = f"Basic {base64.b64encode(credentials).decode('ascii')}"
        return headers


@dataclasses.dataclass(frozen=True, slots=True)
class FlowDocument:
    path: Path
    namespace: str
    flow_id: str
    content: str
    sha256: str


class FlowValidationError(ValueError):
    pass


def _load_yaml(path: Path) -> dict[str, object]:
    try:
        parsed = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise FlowValidationError(f"{path}: invalid YAML: {exc}") from exc

    if not isinstance(parsed, dict):
        raise FlowValidationError(f"{path}: expected YAML mapping at document root")

    for key in ("id", "namespace", "tasks"):
        if key not in parsed:
            raise FlowValidationError(f"{path}: missing required Kestra key '{key}'")
    if not isinstance(parsed["tasks"], list) or not parsed["tasks"]:
        raise FlowValidationError(f"{path}: flow must define at least one task")

    return parsed


def discover_flows(flows_dir: Path) -> list[FlowDocument]:
    documents: list[FlowDocument] = []
    for path in sorted(flows_dir.glob("*.y*ml")):
        parsed = _load_yaml(path)
        content = path.read_text(encoding="utf-8")
        documents.append(
            FlowDocument(
                path=path,
                namespace=str(parsed["namespace"]),
                flow_id=str(parsed["id"]),
                content=content,
                sha256=hashlib.sha256(content.encode("utf-8")).hexdigest(),
            )
        )
    if not documents:
        raise FlowValidationError(f"No flow YAML files found in {flows_dir}")
    return documents


async def import_flow(client: httpx.AsyncClient, tenant: str, flow: FlowDocument, dry_run: bool) -> None:
    if dry_run:
        print(f"[dry-run] {flow.namespace}.{flow.flow_id} {flow.sha256[:12]} {flow.path}")
        return

    files = {"fileUpload": (flow.path.name, flow.content, "application/x-yaml")}
    response = await client.post(f"/api/v1/{tenant}/flows/import", files=files, params={"overwrite": "true"})
    if response.status_code not in {200, 201, 204}:
        raise RuntimeError(
            f"Kestra import failed for {flow.namespace}.{flow.flow_id}: "
            f"HTTP {response.status_code}: {response.text[:1000]}"
        )
    print(f"deployed {flow.namespace}.{flow.flow_id} {flow.sha256[:12]}")


async def deploy(api_url: str, tenant: str, auth: KestraAuth, flows: Iterable[FlowDocument], dry_run: bool) -> None:
    timeout = httpx.Timeout(connect=5.0, read=30.0, write=30.0, pool=5.0)
    async with httpx.AsyncClient(
        base_url=api_url.rstrip("/"),
        headers=auth.headers(),
        timeout=timeout,
        follow_redirects=False,
    ) as client:
        await asyncio.gather(*(import_flow(client, tenant, flow, dry_run) for flow in flows))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Deploy Sentinel Grid Kestra flows")
    parser.add_argument("--api-url", default=os.getenv("KESTRA_API_URL", DEFAULT_API_URL))
    parser.add_argument("--tenant", default=os.getenv("KESTRA_TENANT", DEFAULT_TENANT))
    parser.add_argument("--flows-dir", type=Path, default=Path(__file__).resolve().parents[1] / "flows")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    flows = discover_flows(args.flows_dir)
    auth = KestraAuth(
        token=os.getenv("KESTRA_API_TOKEN"),
        username=os.getenv("KESTRA_USERNAME"),
        password=os.getenv("KESTRA_PASSWORD"),
    )
    asyncio.run(deploy(args.api_url, args.tenant, auth, flows, args.dry_run))


if __name__ == "__main__":
    main()
