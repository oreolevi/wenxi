"""Fragment scores cannot suppress unrelated facts or silently become accepted values."""
from copy import deepcopy
import json
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from . import grounding, seal_evidence, seals, semantic
from .test_seals import seal_block


def mixed_stamp(scores=(.80, .86, .91), page=0, index=1):
    stamp = seal_block('虚构示例公司\n演示章\n000000000000', 'low_confidence', page, index)
    stamp['sealRecognition']['lines'] = [
        {'text': text, 'confidence': score, 'polygon': [[.2, y], [.5, y], [.5, y + .05], [.2, y + .05]]}
        for text, score, y in zip(stamp['text'].splitlines(), scores, [.30, .40, .50])]
    return stamp


def fact(name, value, ref):
    return {'name': name, 'raw_value': value, 'evidence': [{'ref': ref, 'quote': value}]}


class SealFragmentTests(unittest.TestCase):
    def test_mixed_cached_stamp_exposes_independent_refs_and_scores_without_mutation(self):
        stamp = mixed_stamp(); before = deepcopy(stamp)
        rows = seal_evidence.sources([stamp])
        self.assertEqual([b['sealRecognition']['status'] for b in rows], ['low_confidence', 'recognized', 'recognized'])
        self.assertEqual([b['ref'] for b in rows], ['p0-b1-s0', 'p0-b1-s1', 'p0-b1-s2'])
        self.assertEqual(stamp, before)
        self.assertFalse(grounding.requires_image('印章单位', [stamp]))

    def test_good_category_and_code_survive_bad_organization(self):
        stamp = mixed_stamp()
        fields = grounding.validate_fields({'fields': [
            fact('印章类别', '演示章', 'p0-b1-s1'), fact('印章编码', '000000000000', 'p0-b1-s2')]}, [stamp])
        self.assertEqual([f['status'] for f in fields], ['pending', 'pending'])
        self.assertTrue(all(f['validationStatus'] == 'passed' for f in fields))
        self.assertTrue(all(not f.get('candidates') for f in fields))

    def test_unrelated_uncertain_quote_is_not_attached_to_reliable_category(self):
        data = fact('印章类别', '演示章', 'p0-b1-s1')
        data['evidence'].append({'ref': 'p0-b1-s0', 'quote': '虚构示例公司'})
        field = grounding.validate_fields({'fields': [data]}, [mixed_stamp()])[0]
        self.assertEqual(field['status'], 'pending')
        self.assertEqual([e['ref'] for e in field['evidence']], ['p0-b1-s1'])

    def test_uncertain_name_is_candidate_only_not_value_or_batch_confirmation(self):
        stamp = mixed_stamp()
        field = grounding.validate_fields({'fields': [fact('印章单位', '虚构示例公司', 'p0-b1-s0')]}, [stamp])[0]
        self.assertEqual((field['value'], field['raw'], field['status'], field['kind']), ('', '', 'visual_required', 'visual'))
        self.assertEqual(field['candidates'][0]['value'], '虚构示例公司')
        self.assertEqual(field['candidates'][0]['confidence'], .8)
        self.assertEqual(field['ref'], 'p0-b1-s0')
        self.assertIn('识别不确定', field['note'])

    def test_null_model_value_still_shows_unclassified_actual_candidate(self):
        stamp = mixed_stamp()
        field = grounding.validate_fields({'fields': [{'name': '印章单位', 'raw_value': None}]}, [stamp])[0]
        self.assertEqual(field['value'], '')
        self.assertEqual(field['candidates'][0]['value'], '虚构示例公司')

    def test_fabricated_candidate_wrong_ref_and_body_substitution_are_rejected(self):
        stamp = mixed_stamp()
        body = {**seal_block('虚构示例公司', index=2), 'blockType': 'text'}
        for value, ref in [('修改过的公司', 'p0-b1-s0'), ('虚构示例公司', 'p0-b1'), ('虚构示例公司', 'p0-b2')]:
            field = grounding.validate_fields({'fields': [fact('印章单位', value, ref)]}, [stamp, body])[0]
            self.assertEqual(field['status'], 'rejected')
            self.assertFalse(field.get('candidates'))
        field = grounding.validate_fields({'fields': [fact('申请单位', '虚构示例公司', 'p0-b1-s0')]}, [stamp, body])[0]
        self.assertEqual(field['status'], 'rejected')
        self.assertFalse(field.get('candidates'))

    def test_full_imprint_keeps_reliable_items_and_uncertain_fragment_separate(self):
        stamp = mixed_stamp()
        data = {'fields': [{'name': '印章内容', 'kind': 'list', 'items': [
            {'raw_value': line['text'], 'evidence': [{'ref': f'p0-b1-s{i}', 'quote': line['text']}]}
            for i, line in enumerate(stamp['sealRecognition']['lines'])]}]}
        field = grounding.validate_fields(data, [stamp])[0]
        self.assertEqual(field['validationStatus'], 'partial')
        self.assertNotIn('虚构示例公司', field['value'])
        self.assertIn('演示章', field['value'])
        self.assertEqual(field['candidates'][0]['value'], '虚构示例公司')
        self.assertEqual(len(field['evidence']), 2)

    def test_fragment_original_mapping_uses_exact_page_transform(self):
        stamp = mixed_stamp()
        seal_evidence.attach_mapping([stamp], [{'number': 1, 'toOriginal': [[0, -1, 1], [1, 0, 0], [0, 0, 1]]}])
        line = seal_evidence.sources([stamp])[1]
        for actual, expected in zip(line['originalBBox'], [.55, .2, .6, .5]):
            self.assertAlmostEqual(actual, expected)
        self.assertEqual(line['bbox'], [.2, .4, .5, .45])
        self.assertEqual(line['originalPageIndex'], 0)

    def test_generic_field_with_explicit_imprint_source_retains_null_candidate(self):
        data = {'fields': [{'name': '企业名称', 'raw_value': None, 'source_kind': 'seal'}]}
        field = grounding.validate_fields(data, [mixed_stamp()])[0]
        self.assertEqual(field['status'], 'visual_required')
        self.assertEqual(field['candidates'][0]['value'], '虚构示例公司')

    def test_full_imprint_cannot_silently_omit_uncertain_fragment(self):
        data = {'fields': [fact('印章内容', '演示章', 'p0-b1-s1')]}
        field = grounding.validate_fields(data, [mixed_stamp()])[0]
        self.assertEqual(field['validationStatus'], 'partial')
        self.assertEqual(field['value'], '演示章')
        self.assertEqual(field['candidates'][0]['value'], '虚构示例公司')

    def test_truth_and_signature_claims_cannot_become_candidates(self):
        for name in ['印章是否真实', '盖章人名称', '印章是否有效', '签名姓名']:
            field = grounding.validate_fields({'fields': [fact(name, '虚构示例公司', 'p0-b1-s0')]}, [mixed_stamp()])[0]
            self.assertEqual(field['status'], 'visual_required')
            self.assertFalse(field.get('candidates'))

    def test_all_low_scores_still_reach_candidate_mapping_and_untrusted_engine_does_not(self):
        stamp = mixed_stamp((.4, .5, .6))
        self.assertFalse(grounding.requires_image('印章单位', [stamp]))
        self.assertFalse(grounding.recognized_seals([stamp]))
        stamp['sealRecognition']['engine'] = 'untrusted'
        self.assertTrue(grounding.requires_image('印章单位', [stamp]))
        self.assertFalse(seal_evidence.candidates([stamp]))

    def test_model_context_uses_fragments_not_whole_stamp_as_value_source(self):
        stamp = mixed_stamp()
        context = json.loads(semantic.messages_for([stamp], '提取印章单位', ['印章单位'])[1]['content'])
        self.assertEqual([b['ref'] for b in context['blocks']], ['p0-b1-s0', 'p0-b1-s1', 'p0-b1-s2'])
        self.assertEqual(context['blocks'][0]['sealParentRef'], stamp['ref'])
        self.assertEqual(context['blocks'][0]['sealRecognition']['status'], 'low_confidence')

    def test_worker_mixed_lines_report_partial_instead_of_rejecting_whole_stamp(self):
        stamp = seal_block('', 'detected')
        crops = [{'block': stamp, 'bounds': [.2, .3, .6, .7], 'size': [40, 40]}]
        rows = [{'text': text, 'confidence': score, 'polygon': [[0, 0], [30, 0], [30, 10], [0, 10]]}
                for text, score in [('虚构公司', .8), ('演示章', .86)]]
        result = seals.decode_regions({'regions': [{'ref': stamp['ref'], 'lines': rows}]}, crops)
        self.assertEqual(result[0][1]['status'], 'partial')


class SealFragmentAsyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_cached_partial_scores_enter_same_semantic_batch(self):
        task = SimpleNamespace(blocks=[mixed_stamp()], latest_call=None)
        fields = grounding.validate_fields({'fields': [fact('印章单位', '虚构示例公司', 'p0-b1-s0'), fact('印章类别', '演示章', 'p0-b1-s1')]}, task.blocks)
        with patch.object(semantic, 'extract_batch', AsyncMock(return_value=(fields, {'model': 'offline', 'usage': None}))) as batch:
            await semantic.extract_fields(task, '提取印章单位、印章类别', ['印章单位', '印章类别'])
        self.assertEqual(batch.await_args.args[2], ['印章单位', '印章类别'])
