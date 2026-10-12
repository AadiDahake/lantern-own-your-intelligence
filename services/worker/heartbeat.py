"""Background heartbeat: one `status` trace event per project every 60 s so the console shows the worker online."""

from __future__ import annotations

import asyncio
import logging

import config
from steps import db

INTERVAL_S = 60
log = logging.getLogger("lantern.heartbeat")


def beat_once(engine: str) -> int:
    # Read on each beat, so a worker that is started again with or without the two variables says
    # what is true within one beat.
    sender, _ = config.sms_sender()
    projects = db.list_projects()
    for project in projects:
        db.heartbeat(project["id"], engine, sms=sender is not None)
    return len(projects)


async def run(engine: str, interval_s: int = INTERVAL_S) -> None:
    while True:
        try:
            await asyncio.to_thread(beat_once, engine)
        except Exception as error:  # noqa: BLE001 - a failed heartbeat must not stop the worker
            log.warning("heartbeat failed: %s", error)
        await asyncio.sleep(interval_s)
