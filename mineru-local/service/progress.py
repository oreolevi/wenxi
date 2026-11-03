"""User-visible execution events; never includes model reasoning or prompts."""
from datetime import datetime, timezone


def report(job, key: str, label: str, status: str = 'running', detail: str = ''):
    if not hasattr(job, 'events'):
        job.events = []
    timestamp = datetime.now(timezone.utc).isoformat()
    existing = next((event for event in job.events if event['id'] == key), None)
    if existing:
        existing.update(label=label, status=status, detail=detail)
        if status != 'running':
            existing['finishedAt'] = timestamp
    else:
        for event in job.events:
            if event['status'] == 'running':
                event.update(status='done', finishedAt=timestamp)
        job.events.append({'id': key, 'label': label, 'detail': detail, 'status': status, 'startedAt': timestamp})
    job.phase = label


def finish(job, status: str):
    for event in getattr(job, 'events', []):
        if event['status'] == 'running':
            event.update(status=status, finishedAt=datetime.now(timezone.utc).isoformat())
