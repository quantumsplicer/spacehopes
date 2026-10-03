"""S3-compatible storage (a local S3 server in development, Cloudflare R2 in production). The media bucket stays
private; files are served through the API proxy. Backups can use a separate bucket and credentials."""
import asyncio
import boto3
from botocore.client import Config as BotoConfig
from botocore.exceptions import ClientError

from ..config import cfg

_clients: dict[bool, object] = {}


def _make(endpoint: str, key: str, secret: str):
    return boto3.client(
        "s3", endpoint_url=endpoint, aws_access_key_id=key, aws_secret_access_key=secret, region_name=cfg.s3_region,
        config=BotoConfig(signature_version="s3v4", s3={"addressing_style": "path"}, retries={"max_attempts": 3}))


def client(backup: bool = False):
    if backup not in _clients:
        _clients[backup] = _make(
            (cfg.s3_backup_endpoint or cfg.s3_endpoint) if backup else cfg.s3_endpoint,
            (cfg.s3_backup_access_key or cfg.s3_access_key) if backup else cfg.s3_access_key,
            (cfg.s3_backup_secret_key or cfg.s3_secret_key) if backup else cfg.s3_secret_key)
    return _clients[backup]


def bucket(backup: bool = False) -> str:
    return (cfg.s3_backup_bucket or cfg.s3_bucket) if backup else cfg.s3_bucket


def ensure_bucket_sync(backup: bool = False):
    c = client(backup)
    try:
        c.head_bucket(Bucket=bucket(backup))
    except ClientError:
        c.create_bucket(Bucket=bucket(backup))


async def ensure_bucket(backup: bool = False):
    await asyncio.to_thread(ensure_bucket_sync, backup)


async def put(key: str, data: bytes, content_type: str, backup: bool = False):
    await asyncio.to_thread(client(backup).put_object, Bucket=bucket(backup), Key=key, Body=data, ContentType=content_type)


async def get(key: str, backup: bool = False) -> tuple[bytes, str] | None:
    def _get():
        try:
            r = client(backup).get_object(Bucket=bucket(backup), Key=key)
            return r["Body"].read(), r.get("ContentType", "application/octet-stream")
        except ClientError:
            return None
    return await asyncio.to_thread(_get)


async def delete_prefix(prefix: str, backup: bool = False):
    def _del():
        c = client(backup)
        for page in c.get_paginator("list_objects_v2").paginate(Bucket=bucket(backup), Prefix=prefix):
            for o in page.get("Contents", []):
                c.delete_object(Bucket=bucket(backup), Key=o["Key"])
    await asyncio.to_thread(_del)


async def list_all(backup: bool = False) -> list[dict]:
    def _list():
        out = []
        for page in client(backup).get_paginator("list_objects_v2").paginate(Bucket=bucket(backup)):
            out += [{"key": o["Key"], "size": o["Size"]} for o in page.get("Contents", [])]
        return out
    return await asyncio.to_thread(_list)
