"""Separate catalog of explicitly shared, immutable published scene versions.

Publisher labels are supplied by this local prototype. Enterprise identity and
authorization must replace these labels before this API is exposed to a team.
"""
import hashlib
import json
import uuid
from typing import Literal
from pydantic import BaseModel, Field
from . import profiles


class Publication(BaseModel):
    version: str = Field(min_length=1, max_length=30)
    publisher: str = Field(min_length=1, max_length=80)
    team: str = Field(default='', max_length=100)


def listing():
    with profiles.LOCK:
        values = [json.loads(path.read_text()) for path in (profiles.ROOT / 'library').glob('*.json')]
    return sorted([{key: value for key, value in entry.items() if key != 'draft'} for entry in values], key=lambda entry: entry['publishedAt'], reverse=True)


def read(entry_id):
    path = profiles.ROOT / 'library' / (profiles.checked(entry_id) + '.json')
    if not path.is_file():
        raise FileNotFoundError('公共场景不存在或已移除。')
    with profiles.LOCK:
        return json.loads(path.read_text())


def snapshot(profile_id, body):
    data = Publication.model_validate(body)
    publisher = data.publisher.strip()
    if not publisher:
        raise ValueError('请填写发布人。')
    with profiles.LOCK:
        draft = profiles.published(profile_id, data.version)
        entry_id = hashlib.sha256(f'{profile_id}:{data.version}'.encode()).hexdigest()[:24]
        kinds = {kind['id']: kind for kind in draft.get('materialTypes', [])}
        fields = {}
        for template in draft['templates']:
            kind = kinds.get(template.get('materialTypeId'))
            for field in template['fields']:
                key = f'{kind["outputKey"]}[].{field["key"]}' if kind else field['key']
                fields[key] = {'key': key, 'name': field['name'], 'kind': field['kind']}
        entry = {'id': entry_id, 'profileId': profile_id, 'name': draft['name'], 'description': draft.get('description', ''),
                 'version': data.version, 'publisher': publisher, 'team': data.team.strip(), 'publishedAt': profiles.now(),
                 'templates': len(draft['templates']), 'fields': list(fields.values()), 'inputs': ['PDF', 'PNG', 'JPEG', 'WebP'],
                 'endpoint': f'/api/extraction-profiles/{profile_id}/' + ('execute-bundle' if draft.get('materialTypes') else 'execute'), 'draft': draft,
                 **({'materialTypes': draft['materialTypes'], 'inputs': ['PDF', 'PNG', 'JPEG', 'WebP', 'ZIP'], 'output': draft.get('output') or {'mode': 'by_type'}} if draft.get('materialTypes') else {})}
    return entry


def share(profile_id, body):
    """Internal catalog writer. Public HTTP requests use submit + decide."""
    entry = snapshot(profile_id, body)
    with profiles.LOCK:
        profiles.atomic(profiles.ROOT / 'library' / (entry['id'] + '.json'), entry)
    return entry


def reviews():
    with profiles.LOCK:
        values = [json.loads(path.read_text()) for path in (profiles.ROOT / 'publication-reviews').glob('*.json')]
    return sorted([{key: value for key, value in row.items() if key != 'snapshot'} for row in values], key=lambda row: row['submittedAt'], reverse=True)


def submit(profile_id, body):
    """Freeze the selected published version; submission never makes it public."""
    with profiles.LOCK:
        entry = snapshot(profile_id, body)
        existing = next((row for row in reviews() if row['profileId'] == profile_id and row['version'] == entry['version'] and row['status'] in ('pending', 'approved')), None)
        if existing:
            return existing
        row = {key: entry[key] for key in ('profileId', 'name', 'description', 'version', 'publisher', 'team')}
        row.update(id=uuid.uuid4().hex, status='pending', submittedAt=profiles.now(), reviewedAt=None,
                   reviewer='', comment='', entryId=entry['id'], mock=True, snapshot=entry)
        profiles.atomic(profiles.ROOT / 'publication-reviews' / (row['id'] + '.json'), row)
        return {key: value for key, value in row.items() if key != 'snapshot'}


class Decision(BaseModel):
    decision: Literal['approved', 'rejected']
    reviewer: str = Field(min_length=1, max_length=80)
    comment: str = Field(default='', max_length=1000)


def decide(review_id, body):
    """Local mock reviewer action; replace with authenticated approval in production."""
    decision = Decision.model_validate(body)
    if not decision.reviewer.strip():
        raise ValueError('请填写审核人。')
    if decision.decision == 'rejected' and not decision.comment.strip():
        raise ValueError('退回时请填写修改意见。')
    path = profiles.ROOT / 'publication-reviews' / (profiles.checked(review_id) + '.json')
    with profiles.LOCK:
        if not path.is_file():
            raise FileNotFoundError('公开申请不存在。')
        row = json.loads(path.read_text())
        if row['status'] != 'pending':
            raise ValueError('这份申请已处理，请刷新列表。')
        if decision.decision == 'approved':
            entry = row['snapshot']
            entry['publishedAt'] = profiles.now()
            profiles.atomic(profiles.ROOT / 'library' / (entry['id'] + '.json'), entry)
        row.update(status=decision.decision, reviewer=decision.reviewer.strip(), comment=decision.comment.strip(), reviewedAt=profiles.now())
        profiles.atomic(path, row)
        return {key: value for key, value in row.items() if key != 'snapshot'}
