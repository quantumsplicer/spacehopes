"""In-process jobs (no Redis, no Celery): scheduled publishing, housekeeping, nightly encrypted backup."""
import datetime as dt
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import delete, select

from .db import SessionLocal
from .models import AuthFailure, Post, ReaderOtp, Session, now
from .services.publishing import PublishError, publish

log = logging.getLogger("scheduler")


async def publish_due():
    async with SessionLocal() as db:
        due = (await db.execute(select(Post).where(Post.status == "scheduled", Post.publish_at <= now()))).scalars().all()
        for p in due:
            try:
                await publish(db, p, when=p.publish_at)
                log.info("published scheduled post %s", p.id)
            except PublishError:
                p.status = "draft"  # something changed since it was scheduled; hand it back to the owner
                await db.commit()


async def housekeeping():
    async with SessionLocal() as db:
        t = now()
        await db.execute(delete(Session).where(Session.expires_at < t))
        await db.execute(delete(AuthFailure).where(AuthFailure.created_at < t - dt.timedelta(days=1)))
        await db.execute(delete(ReaderOtp).where(ReaderOtp.expires_at < t))
        await db.commit()


async def nightly_backup():
    from .cli import backup
    try:
        await backup()
    except Exception:  # noqa: BLE001
        log.exception("nightly backup failed")


def start_scheduler() -> AsyncIOScheduler:
    s = AsyncIOScheduler(timezone="UTC")
    s.add_job(publish_due, "interval", seconds=30, id="publish_due", max_instances=1, coalesce=True)
    s.add_job(housekeeping, "interval", minutes=15, id="housekeeping", max_instances=1)
    s.add_job(nightly_backup, "cron", hour=21, minute=30, id="backup", max_instances=1)  # 03:00 IST
    s.start()
    return s
