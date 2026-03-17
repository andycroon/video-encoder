---
date: "2026-03-17 00:00"
promoted: false
---

Cancel button on running queue jobs calls DELETE /api/jobs/{id} which purges the job from DB entirely. User is aware and may be OK with this behavior — decide later whether to add a separate PATCH /cancel endpoint that keeps the job in DB as CANCELLED status vs just letting delete-on-cancel stand as intended behavior.
