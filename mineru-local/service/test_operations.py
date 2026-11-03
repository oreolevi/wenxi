import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from . import activity, operations, profiles

class OperationsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.db = patch.object(activity, 'DATABASE', self.root / 'activity.sqlite3')
        self.store = patch.object(profiles, 'ROOT', self.root / 'profiles')
        self.db.start(); self.store.start()
    def tearDown(self):
        self.db.stop(); self.store.stop(); self.tmp.cleanup()
    def test_legacy_migration_and_internal_recognition_not_double_counted(self):
        with sqlite3.connect(activity.DATABASE) as db:
            db.execute('CREATE TABLE invocations (id TEXT PRIMARY KEY, day TEXT NOT NULL, status TEXT NOT NULL)')
            db.execute("INSERT INTO invocations VALUES ('old','2026-01-01','succeeded')")
        activity.start('doc', {'scope': 'document'})
        activity.complete('doc', 'succeeded', {'totalElapsedMs': 1200, 'phases': {'semantic': 700}})
        activity.start('internal', {'scope': 'preparation'})
        activity.complete('internal', 'succeeded', {'totalElapsedMs': 300})
        value = operations.overview()
        self.assertEqual(value['summary']['calls'], 1)
        self.assertEqual(value['legacyCount'], 1)
        self.assertEqual(value['summary']['averageMs'], 1200)
        self.assertIsNone(next(v for v in value['phases'] if v['id'] == 'recognize')['averageMs'])
        self.assertEqual(sum(v['count'] or 0 for v in value['activity']['days']), 1)
        self.assertIsNone(value['activity']['days'][0]['count'])
    def test_service_scene_and_failures_share_filter_without_exposing_material_names(self):
        now = profiles.now()
        for folder, ident, record in [
            ('runs', 'invoice', {'status': 'failed', 'name': 'private.pdf', 'totalElapsedMs': 2400, 'error': '识别失败'}),
            ('scene-runs', 'payment', {'passed': False, 'totalElapsedMs': 900}),
        ]:
            path = profiles.ROOT / folder / ident / 'call.json'; path.parent.mkdir(parents=True)
            path.write_text(json.dumps({**record, 'version': '1.0.0', 'createdAt': now}))
        value = operations.overview(kind='service')
        self.assertEqual(value['summary']['calls'], 1)
        self.assertEqual(value['summary']['failed'], 1)
        self.assertNotIn('private.pdf', json.dumps(value))
        combined = operations.overview()
        self.assertEqual(combined['summary']['calls'], 2)
        self.assertEqual(combined['summary']['needsReview'], 1)
        self.assertEqual(combined['summary']['completionRate'], 50)
        self.assertEqual(sum(v['count'] or 0 for v in combined['activity']['days']), 2)
    def test_timings_are_measured_not_residual_estimates(self):
        timings = operations.event_timings([
            {'id': 'extract-0', 'startedAt': '2026-01-01T00:00:01Z', 'finishedAt': '2026-01-01T00:00:03Z'},
            {'id': 'recognize', 'startedAt': '2026-01-01T00:00:00Z'},
            {'id': 'extract-1', 'startedAt': '2026-01-01T00:00:03Z', 'finishedAt': '2026-01-01T00:00:04Z'},
        ])
        self.assertEqual(timings, {'semantic': 3000})

    def test_savings_use_recorded_baselines_and_only_successful_scenes(self):
        row = {'id': 'one', 'kind': 'scene', 'targetId': 'payment', 'name': '付款',
               'createdAt': profiles.now(), 'status': 'succeeded', 'minutesSavedPerRun': 12}
        rows = [row, {**row, 'minutesSavedPerRun': 15}, {**row, 'minutesSavedPerRun': None},
                {**row, 'kind': 'document'}, {**row, 'kind': 'service'},
                *[{**row, 'status': status} for status in ['needs_review', 'failed', 'cancelled', 'running']]]
        with patch.object(operations, 'records', return_value=(rows, 0)):
            value = operations.overview()
            api = operations.overview(kind='api')
        self.assertEqual(value['efficiency']['savedMinutes'], 27)
        self.assertEqual(value['efficiency']['configuredCalls'], 2)
        self.assertEqual(value['efficiency']['unconfiguredCalls'], 1)
        self.assertEqual(value['efficiency']['excludedCalls'], 4)
        self.assertEqual(value['summary']['documentCalls'], 1)
        self.assertEqual(value['summary']['apiCalls'], len(rows) - 1)
        self.assertEqual(api['efficiency'], value['efficiency'])
        self.assertEqual(api['summary']['calls'], len(rows) - 1)
        self.assertEqual(value['summary']['completionRate'], round(6 / 7 * 100))

    def test_full_period_ranking_and_detail_filters_do_not_change_summary(self):
        now = profiles.now()
        rows = [{'id': f'service:{index}', 'kind': 'service', 'targetId': 'same', 'name': '发票提取',
                 'createdAt': now, 'version': '1.0.0' if index % 2 else '2.0.0',
                 'status': 'failed' if index < 8 else 'succeeded', 'totalElapsedMs': 100, 'phases': {}}
                for index in range(120)]
        rows.append({**rows[0], 'id': 'scene:one', 'kind': 'scene', 'name': '付款场景', 'status': 'succeeded'})
        rows.append({**rows[0], 'id': 'doc', 'kind': 'document', 'targetId': '', 'status': 'succeeded'})
        with patch.object(operations, 'records', return_value=(rows, 0)):
            all_calls = operations.overview()
            failed = operations.overview(record_status='failed', record_target='service:same')
            scene = operations.overview(record_target='scene:same')
        self.assertEqual(all_calls['ranking'][0]['count'], 120)
        self.assertEqual(all_calls['ranking'][0]['failed'], 8)
        self.assertEqual(len(all_calls['ranking']), 2)
        self.assertEqual(len(all_calls['records']), 100)
        self.assertEqual(all_calls['recordsTotal'], 122)
        self.assertEqual(failed['recordsTotal'], 8)
        self.assertTrue(all(row['status'] == 'failed' for row in failed['records']))
        self.assertEqual(scene['recordsTotal'], 1)
        self.assertEqual(failed['summary'], all_calls['summary'])
        self.assertEqual(failed['ranking'], all_calls['ranking'])

if __name__ == '__main__': unittest.main()
