"""Persistent local invocation counts, without filenames or document content."""
from contextlib import contextmanager
from datetime import date, timedelta
from pathlib import Path
from datetime import datetime, timezone
import json
import sqlite3

DATABASE = Path(__file__).resolve().parents[2] / '.runtime' / 'wenxi-activity.sqlite3'


@contextmanager
def connect():
    DATABASE.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DATABASE, timeout=5)
    db.execute('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    db.execute('CREATE TABLE IF NOT EXISTS invocations (id TEXT PRIMARY KEY, day TEXT NOT NULL, status TEXT NOT NULL)')
    columns = {row[1] for row in db.execute('PRAGMA table_info(invocations)')}
    if 'metadata' not in columns:
        db.execute('ALTER TABLE invocations ADD COLUMN metadata TEXT')
    db.execute('INSERT OR IGNORE INTO settings VALUES (?, ?)', ('trackingSince', date.today().isoformat()))
    db.commit()
    DATABASE.chmod(0o600)
    try:
        yield db
        db.commit()
    finally:
        db.close()


def start(call_id: str, metadata=None):
    with connect() as db:
        value = {**(metadata or {}), 'createdAt': datetime.now(timezone.utc).isoformat()}
        db.execute('INSERT OR IGNORE INTO invocations (id, day, status, metadata) VALUES (?, ?, ?, ?)',
                   (call_id, date.today().isoformat(), 'running', json.dumps(value)))


def complete(call_id: str, status: str, metadata=None):
    with connect() as db:
        row = db.execute('SELECT metadata FROM invocations WHERE id = ?', (call_id,)).fetchone()
        if row:
            value = {**json.loads(row[0] or '{}'), **(metadata or {})}
            db.execute('UPDATE invocations SET status = ?, metadata = ? WHERE id = ?', (status, json.dumps(value), call_id))


def records():
    with connect() as db:
        return [{'id': row[0], 'day': row[1], 'status': row[2], **json.loads(row[3] or '{}')}
                for row in db.execute('SELECT id, day, status, metadata FROM invocations')]


def daily(days: int = 365):
    today = date.today()
    first = today - timedelta(days=days - 1)
    with connect() as db:
        since = db.execute('SELECT value FROM settings WHERE key = ?', ('trackingSince',)).fetchone()[0]
        counts = dict(db.execute('SELECT day, COUNT(*) FROM invocations WHERE day >= ? GROUP BY day', (first.isoformat(),)))
    return {'trackingSince': since, 'through': today.isoformat(), 'scope': 'local-service',
            'days': [{'date': (first + timedelta(days=i)).isoformat(),
                      'count': counts.get((first + timedelta(days=i)).isoformat(), 0)
                      if (first + timedelta(days=i)).isoformat() >= since else None} for i in range(days)]}
