import unittest
from .extraction import match_fields, read_blocks

def block(text, bbox=(.1, .1, .8, .15), page=0, index=0):
    return {'text': text, 'bbox': list(bbox), 'pageIndex': page, 'blockIndex': index, 'ref': f'p{page}-b{index}'}

class FieldMatchingTests(unittest.TestCase):
    def test_real_inline_values_preserve_original_characters(self):
        fields = match_fields([block('提交人：王明'), block('通讯地址：Ａ座１２层', page=1)], ['提交人', '通讯地址'])
        self.assertEqual([item['raw'] for item in fields], ['王明', 'Ａ座１２层'])
        self.assertEqual(fields[1]['page'], 2)
        self.assertEqual(fields[1]['evidence'][0]['bbox'], [.1, .1, .8, .15])

    def test_same_row_value_and_final_reviewer_are_distinct(self):
        items = [block('初审人员：李明'), block('最终审核人员：赵琳', page=1),
                 block('提交人：', (.1, .2, .2, .23), index=1), block('周甲', (.3, .2, .4, .23), index=2)]
        fields = match_fields(items, ['终审人员', '提交人'])
        self.assertEqual([item['value'] for item in fields], ['赵琳', '周甲'])
        self.assertEqual(fields[1]['ref'], 'p0-b2')

    def test_missing_and_ambiguous_do_not_generate_values(self):
        fields = match_fields([block('提交人：甲'), block('提交人：乙', page=1)], ['提交人', '证件号'])
        self.assertTrue(all(item['status'] == 'missing' and not item['value'] and not item['ref'] for item in fields))
        self.assertIn('多个', fields[0]['note'])

    def test_blank_value_does_not_borrow_the_next_field(self):
        items = [block('提交人：', (.1, .2, .2, .23)),
                 block('联系电话：', (.3, .2, .45, .23), index=1), block('123', (.5, .2, .6, .23), index=2)]
        self.assertEqual(match_fields(items, ['提交人'])[0]['status'], 'missing')

    def test_table_rows_share_only_table_level_evidence(self):
        payload = {'schema': 'docvortex.middle', 'schema_version': '2.0', 'is_full_document': True,
                   'pages': [{'page_idx': 0, 'blocks': [{'index': 0, 'type': 'table', 'bbox': [.1,.1,.8,.8],
                    'content': [{'content': '<table><tr><td>提交人</td><td>表格甲</td></tr><tr><td>审核日期</td><td>2026-10-30</td></tr></table>'}]}]}]}
        fields = match_fields(read_blocks(payload), ['提交人', '审核日期'])
        self.assertEqual([item['value'] for item in fields], ['表格甲', '2026-10-30'])
        self.assertEqual(fields[0]['evidence'][0]['bbox'], [.1,.1,.8,.8])

    def test_old_protocol_and_incomplete_results_rejected(self):
        for data in [{}, {'schema': 'docvortex.middle', 'schema_version': '2.0', 'is_full_document': False}]:
            with self.assertRaises(ValueError):
                read_blocks(data)

    def test_empty_scanned_pages_may_omit_blocks_without_losing_other_pages(self):
        payload = {'schema': 'docvortex.middle', 'schema_version': '2.0', 'is_full_document': True,
                   'pages': [{'page_idx': 0, 'blocks': [{'index': 0, 'type': 'text',
                              'bbox': [.1, .1, .8, .2], 'content': '提交人：王明'}]},
                             {'page_idx': 1}, {'page_idx': 2, 'blocks': []}]}
        blocks = read_blocks(payload)
        self.assertEqual(len(blocks), 1)
        self.assertEqual(match_fields(blocks, ['提交人'])[0]['value'], '王明')
        self.assertEqual(blocks[0]['ref'], 'p0-b0')

    def test_malformed_blocks_are_not_treated_as_an_empty_page(self):
        for invalid in [None, {}, 'invalid']:
            with self.assertRaisesRegex(ValueError, '文字块格式异常'):
                read_blocks({'schema': 'docvortex.middle', 'schema_version': '2.0',
                             'is_full_document': True, 'pages': [{'page_idx': 0, 'blocks': invalid}]})

if __name__ == '__main__':
    unittest.main()
