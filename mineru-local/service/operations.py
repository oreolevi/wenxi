"""Read-only, shared operational scope. No document text or credentials returned."""
from collections import Counter
from datetime import datetime, timedelta
import json
import math
from . import activity, profiles

PHASES = {'queue': '排队', 'prepare': '预处理与识别', 'recognize': 'OCR 与版面识别',
          'preview': '原文预览', 'semantic': '语义提取', 'validate': '引用校验', 'rule': '规则执行'}


def event_timings(events):
    values = {}
    for event in events:
        key = event.get('id', '')
        category = ('prepare' if key.startswith('prepare-') else 'semantic' if key.startswith('extract-')
                    else 'validate' if key.startswith('validate-') else key)
        if category not in PHASES or not event.get('finishedAt'):
            continue
        try:
            ms = (datetime.fromisoformat(event['finishedAt']) - datetime.fromisoformat(event['startedAt'])).total_seconds() * 1000
        except (KeyError, TypeError, ValueError):
            continue
        values[category] = round(values.get(category, 0) + max(0, ms), 2)
    return values


def _json(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def records():
    rows, legacy = [], 0
    for row in activity.records():
        if not row.get('scope'):
            legacy += 1
        elif row['scope'] == 'document':
            rows.append({**row, 'kind': 'document', 'name': '文析', 'targetId': '', 'version': ''})
        # Internal OCR/sample preparation is not another external API invocation.
    for kind, folder, definition in [('service', 'runs', 'profiles'), ('scene', 'scene-runs', 'scenes')]:
        for path in (profiles.ROOT / folder).glob('*/*.json'):
            value = _json(path)
            if not value:
                continue
            target = _json(profiles.ROOT / definition / (path.parent.name + '.json')) or {}
            rows.append({'id': f'{kind}:{path.stem}', 'kind': kind, 'targetId': path.parent.name,
                         'name': target.get('draft', {}).get('name', path.parent.name),
                         'createdAt': value.get('createdAt', ''), 'version': value.get('version', ''),
                         'status': value.get('status', 'succeeded' if value.get('passed') else 'needs_review'),
                         'totalElapsedMs': value.get('totalElapsedMs'),
                         'phases': value.get('phases', {'rule': value['ruleMs']} if value.get('ruleMs') is not None else {}),
                         'error': value.get('error', ''), 'caller': None})
            if kind == 'scene':
                rows[-1]['minutesSavedPerRun'] = value.get('minutesSavedPerRun')
    return rows, legacy


def efficiency_summary(rows):
    """Only successful external scene executions earn estimated time savings."""
    groups = {}
    excluded = 0
    for row in rows:
        if row['kind'] != 'scene':
            continue
        if row['status'] != 'succeeded':
            excluded += 1
            continue
        item = groups.setdefault(row['targetId'], {'id': row['targetId'], 'name': row['name'],
            'successfulCalls': 0, 'configuredCalls': 0, 'unconfiguredCalls': 0, 'savedMinutes': 0,
            'minutesMin': None, 'minutesMax': None})
        item['successfulCalls'] += 1
        minutes = row.get('minutesSavedPerRun')
        if isinstance(minutes, (int, float)) and not isinstance(minutes, bool) and math.isfinite(minutes) and 0 <= minutes <= 1440:
            item['configuredCalls'] += 1
            item['savedMinutes'] = round(item['savedMinutes'] + minutes, 2)
            item['minutesMin'] = minutes if item['minutesMin'] is None else min(item['minutesMin'], minutes)
            item['minutesMax'] = minutes if item['minutesMax'] is None else max(item['minutesMax'], minutes)
        else:
            item['unconfiguredCalls'] += 1
    items = sorted(groups.values(), key=lambda item: (-item['savedMinutes'], item['id']))
    return {'savedMinutes': round(sum(item['savedMinutes'] for item in items), 2),
            'configuredCalls': sum(item['configuredCalls'] for item in items),
            'unconfiguredCalls': sum(item['unconfiguredCalls'] for item in items),
            'excludedCalls': excluded, 'scenes': items}


def overview(days=30, kind='all', record_status='', record_target=''):
    through = datetime.now().astimezone().date()
    first = through - timedelta(days=days - 1)
    with activity.connect() as db:
        db.execute('INSERT OR IGNORE INTO settings VALUES (?, ?)', ('operationsTrackingSince', through.isoformat()))
        coverage = db.execute('SELECT value FROM settings WHERE key = ?', ('operationsTrackingSince',)).fetchone()[0]
    records_all, legacy = records()
    selected = []
    for row in records_all:
        try:
            day = datetime.fromisoformat(row['createdAt']).astimezone().date().isoformat()
        except (KeyError, TypeError, ValueError):
            continue
        if first.isoformat() <= day <= through.isoformat() and (kind == 'all' or row['kind'] == kind or kind == 'api' and row['kind'] in {'service', 'scene'}):
            selected.append({**row, 'day': day})
    selected.sort(key=lambda row: row['createdAt'], reverse=True)
    states = Counter(row['status'] for row in selected)
    ended = sum(states[key] for key in ['succeeded', 'needs_review', 'failed'])
    times = sorted(row['totalElapsedMs'] for row in selected if isinstance(row.get('totalElapsedMs'), (int, float)))
    phases = []
    for key, label in PHASES.items():
        values = [row['phases'][key] for row in selected if isinstance(row.get('phases', {}).get(key), (int, float))]
        phases.append({'id': key, 'name': label, 'count': len(values),
                       'averageMs': round(sum(values) / len(values), 2) if values else None})
    counts = Counter(row['day'] for row in selected)
    days_data = []
    for i in range(days):
        day = (first + timedelta(days=i)).isoformat()
        days_data.append({'date': day, 'count': counts[day] if day >= coverage or counts[day] else None})
    distribution = [{'id': key, 'name': label, 'count': sum(row['kind'] == key for row in selected)}
                    for key, label in [('document', '文析'), ('service', '服务接口'), ('scene', '场景接口')]]
    # Aggregate all external calls before limiting the detail list. Versions of one
    # target share a rank; a scene and a service with the same ID remain distinct.
    targets = {}
    for row in selected:
        if row['kind'] not in {'service', 'scene'}:
            continue
        key = f"{row['kind']}:{row['targetId']}"
        item = targets.setdefault(key, {'key': key, 'kind': row['kind'], 'targetId': row['targetId'],
                                        'name': row['name'], 'count': 0, 'failed': 0})
        item['count'] += 1
        item['failed'] += row['status'] == 'failed'
    ranking = sorted(targets.values(), key=lambda item: (-item['count'], item['key']))[:5]
    detail = [row for row in selected
              if (not record_status or row['status'] == record_status)
              and (not record_target or f"{row['kind']}:{row['targetId']}" == record_target)]
    return {'from': first.isoformat(), 'through': through.isoformat(), 'scope': 'local-recorded-invocations',
            'generatedAt': datetime.now().astimezone().isoformat(),
            'summary': {'calls': len(selected), 'completed': states['succeeded'] + states['needs_review'],
                        'documentCalls': sum(row['kind'] == 'document' for row in selected),
                        'apiCalls': sum(row['kind'] in {'service', 'scene'} for row in selected),
                        'failed': states['failed'], 'needsReview': states['needs_review'], 'cancelled': states['cancelled'],
                        'running': states['running'], 'completionRate': round((states['succeeded'] + states['needs_review']) / ended * 100) if ended else None,
                        'averageMs': round(sum(times) / len(times), 2) if times else None,
                        'p95Ms': times[max(0, math.ceil(len(times) * .95) - 1)] if times else None, 'timedCalls': len(times)},
            'phases': phases, 'distribution': distribution, 'ranking': ranking, 'efficiency': efficiency_summary(selected),
            'records': detail[:100], 'recordsTotal': len(detail),
            'activity': {'trackingSince': coverage, 'through': through.isoformat(), 'scope': 'recorded-invocations', 'days': days_data},
            'legacyCount': legacy, 'callerTracking': False}
