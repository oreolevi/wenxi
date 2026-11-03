from datetime import date, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from . import activity
from .progress import report, finish


class ProgressTests(TestCase):
    def test_updates_preserve_order_and_failure_is_not_a_completed_step(self):
        job = SimpleNamespace()
        report(job, 'recognize', '识别文字')
        report(job, 'recognize', '已识别 8 页', 'done')
        report(job, 'extract', '提取字段')
        finish(job, 'error')
        self.assertEqual(len(job.events), 2)
        self.assertEqual([event['status'] for event in job.events], ['done', 'error'])
        self.assertIn('finishedAt', job.events[1])

    def test_cancel_leaves_completed_steps_intact(self):
        job = SimpleNamespace()
        report(job, 'read', '读取原文', 'done')
        report(job, 'recognize', '识别文字')
        finish(job, 'cancelled')
        self.assertEqual([event['status'] for event in job.events], ['done', 'cancelled'])


class ActivityTests(TestCase):
    def test_persistent_counts_do_not_turn_unknown_past_into_zero(self):
        with TemporaryDirectory() as directory, patch.object(activity, 'DATABASE', Path(directory) / 'activity.sqlite3'):
            activity.start('first')
            activity.start('first')
            activity.complete('first', 'failed')
            activity.start('second')
            result = activity.daily(3)
            self.assertEqual(result['trackingSince'], date.today().isoformat())
            self.assertEqual([day['count'] for day in result['days']], [None, None, 2])
            self.assertEqual(result['days'][-1]['date'], date.today().isoformat())
