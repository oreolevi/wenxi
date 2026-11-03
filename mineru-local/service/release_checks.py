"""Read-only release checks, also enforced by the actual publication functions."""


def _issue(code, title, detail, area, **target):
    return {'code': code, 'title': title, 'detail': detail, 'target': {'area': area, **target}}


def _report(record, digest, issues):
    versions = record.get('versions', [])
    return {'ready': not issues, 'issues': issues, 'unchanged': not issues and record.get('publishedHash') == digest,
            'currentVersion': versions[-1] if versions else '', 'nextVersion': f'1.{len(versions)}.0'}


def service_check(record):
    from . import profiles
    draft = record['draft']
    templates = draft['templates']
    issues = []
    if not templates:
        issues.append(_issue('samples', '上传第一份版式样例', '请为每个版式配置字段并定位原文。', 'fields'))
    if draft.get('resourceKind') == 'parser' and templates:
        schema = lambda t: sorted((f['key'], f['name'], f['kind'], f['required']) for f in t['fields'])
        for template in templates[1:]:
            if schema(template) != schema(templates[0]):
                issues.append(_issue('schema', f"{template['name']}：补齐字段定义", '同一服务的各版式应使用相同字段定义，请补齐字段后再发布。', 'fields', templateId=template['id']))
    for template in templates:
        target = {'templateId': template['id']}
        if template.get('classification') == 'suggested' or (draft.get('materialTypes') and not template.get('materialTypeId')):
            issues.append(_issue('classification', f"{template['name']}：确认材料归属", '请先在材料分组中确认各版式所属的材料类型。', 'settings', **target))
        fields = template['fields']
        if not fields:
            issues.append(_issue('fields', f"{template['name']}：添加提取字段", '请为每个版式配置字段并定位原文。', 'fields', **target))
        unlocated = [f for f in fields if not f.get('region')]
        pending = [f for f in fields if f.get('review') == 'pending']
        for code, rows, verb in [('location', unlocated, '定位'), ('review', pending, '确认')]:
            if rows:
                names = '、'.join(f['name'] for f in rows[:3]) + ('等' if len(rows) > 3 else '')
                detail = '请先核对并确认 AI 生成的字段规则，再测试和发布。' if code == 'review' else '请在原文上定位这些字段的取值位置。'
                issues.append(_issue(code, f"{template['name']}：{len(rows)} 个字段待{verb}", f'{names}。{detail}', 'fields', fieldId=rows[0]['id'], **target))
    for kind in draft.get('materialTypes', []):
        if not any(t.get('materialTypeId') == kind['id'] for t in templates):
            issues.append(_issue('empty-type', f"{kind['name']}：尚无可用版式", '每个材料类型至少需要一个已配置版式，请补充或移除空类型。', 'settings'))
    digest = profiles.fingerprint(draft)
    tests = record.get('lastTest') or {}
    for template in templates:
        fields = template['fields']
        if not fields or any(not f.get('region') or f.get('review') == 'pending' for f in fields):
            continue
        result = tests.get('templates', {}).get(template['id'], {})
        if tests.get('hash') != digest or not result.get('passed'):
            title = '测试未通过' if tests.get('hash') == digest and result else '尚未完成当前配置的测试'
            issues.append(_issue('test', f"{template['name']}：{title}", '请先对当前配置的每个版式完成测试；修改配置后需重新测试。', 'test', templateId=template['id']))
    evaluation = record.get('lastEvaluation') or {}
    if evaluation.get('hash') == digest and not evaluation.get('passed'):
        issues.append(_issue('evaluation', '处理批量测试中的失败项', '最近一次批量回放未通过，请调整配置并重新测试。', 'evaluate'))
    return _report(record, digest, issues)


def scene_check(record):
    from . import profiles, scenes
    draft = record['draft']
    issues = []
    if not draft['bindings']:
        issues.append(_issue('services', '添加需要调用的服务', '请先添加服务，再进行整包联调。', 'services'))
    for binding in draft['bindings']:
        target = {'bindingId': binding['id']}
        if not binding['version']:
            issues.append(_issue('version', f"{binding['name']}：选择已发布版本", '未发布服务可以先配置并发布，再回到此处选择已发布版本。', 'services', **target))
            continue
        try:
            frozen = profiles.published(binding['parserId'], binding['version'])
            if len(frozen.get('materialTypes', [])) > 1:
                issues.append(_issue('legacy', f"{binding['name']}：更新服务引用", '请使用拆分后的独立服务。', 'services', **target))
        except (ValueError, FileNotFoundError):
            issues.append(_issue('missing-version', f"{binding['name']}：引用版本不可用", '此服务的已发布版本不存在，请重新选择。', 'services', **target))
    digest = scenes.digest(draft)
    last_test = record.get('lastTest') or {}
    if not issues and (last_test.get('hash') != digest or not last_test.get('passed')):
        issues.append(_issue('bundle-test', '完成当前组合的整包联调', '请先对当前场景完成一次通过的整包联调。', 'test'))
    return _report(record, digest, issues)
