import json
from types import SimpleNamespace
import unittest

from .requirements import RequirementDefinition, parse_workbook, read_sheet
from .semantic import messages_for
from .grounding import validate_fields


def sheet(rows, title='字段要求'):
    cells = [[SimpleNamespace(value=value, data_type='f' if isinstance(value, str) and value.startswith('=') else 's',
                              coordinate=f'{chr(65 + col)}{index + 1}') for col, value in enumerate(row)]
             for index, row in enumerate(rows)]
    return SimpleNamespace(title=title, max_row=len(rows), max_column=len(rows[0]), iter_rows=lambda: iter(cells))


class RequirementTests(unittest.TestCase):
    def test_field_names_rules_and_coordinates_are_preserved(self):
        result = read_sheet(sheet([['输出', '字段', '备注'], ['合同', '合同编号', None],
                                   [None, '合同生效日期/合同签订日期', '同时存在时取生效日'],
                                   ['说明', None, '不应变成字段']]))
        self.assertEqual(len(result['fields']), 2)
        self.assertEqual(result['fields'][1], {'name': '合同生效日期/合同签订日期', 'rule': '同时存在时取生效日',
                                              'cell': 'B3', 'ruleCell': 'C3', 'group': '合同'})

    def test_formula_requirements_are_not_executed_or_silently_omitted(self):
        for rows in [[['字段', '备注'], ['=HYPERLINK("https://example.com")', None]],
                     [['字段', '备注'], ['金额', '=1+1']]]:
            with self.assertRaisesRegex(ValueError, '公式'):
                read_sheet(sheet(rows))

    def test_ambiguous_headers_duplicate_names_and_missing_headers(self):
        with self.assertRaisesRegex(ValueError, '多个字段列'):
            read_sheet(sheet([['字段', '字段名称'], ['金额', '日期']]))
        with self.assertRaisesRegex(ValueError, '重复字段'):
            read_sheet(sheet([['字段', '备注'], ['金额', None], ['金额', '另一口径']]))
        self.assertIsNone(read_sheet(sheet([['销售额', '日期'], [100, '2026-01-01']])))

    def test_oversized_and_invalid_files_fail_before_model_call(self):
        with self.assertRaisesRegex(ValueError, 'xlsx'):
            parse_workbook(b'fake', 'old.xls')
        with self.assertRaisesRegex(ValueError, '无法读取'):
            parse_workbook(b'not-a-workbook', 'fields.xlsx')
        with self.assertRaisesRegex(ValueError, '8 MB'):
            parse_workbook(b'x' * (8 * 1024 * 1024 + 1), 'fields.xlsx')

    def test_batch_receives_only_its_rules_and_rules_cannot_ground_values(self):
        requirements = RequirementDefinition(fileName='字段.xlsx', sheet='合同', fields=[
            {'name': '合同日期', 'rule': '优先生效日期', 'cell': 'B2'},
            {'name': '金额', 'rule': '例如999元', 'cell': 'B3'}]).model_dump()
        source = json.loads(messages_for([], '按Excel提取', ['合同日期'], requirements)[1]['content'])
        self.assertEqual([item['name'] for item in source['field_requirements']], ['合同日期'])
        self.assertEqual(source['requirements_source']['sheet'], '合同')
        result = validate_fields({'fields': [{'name': '金额', 'raw_value': '999元',
                                              'evidence': [{'ref': 'B3', 'quote': '例如999元'}]}]}, [], ['金额'])
        self.assertEqual(result[0]['status'], 'rejected')
