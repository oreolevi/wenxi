from copy import deepcopy
from unittest import TestCase

from . import profiles, layout_alignment


class LayoutAlignmentTests(TestCase):
    def test_small_glyph_metric_offset_requires_overlap_and_excludes_other_rows(self):
        box=[.4,.6,.6,.61]
        self.assertTrue(profiles.inside_region({'bbox':[.4,.602,.6,.626]},box))
        self.assertFalse(profiles.inside_region({'bbox':[.4,.62,.6,.644]},box))
        self.assertFalse(profiles.inside_region({'bbox':[.1,.602,.2,.626]},box))
        self.assertFalse(profiles.inside_region({'bbox':[.4,.4,.6,.9]},box))

    def pair(self):
        labels=[('演示发票',[.1,.05,.5,.09]),('客户名称：演示企业',[.1,.2,.6,.24]),('开票日期：2026-11-03',[.1,.35,.6,.39]),
                ('价税合计：',[.1,.6,.3,.65]),('123.45',[.4,.6,.6,.65]),('备注：虚构测试',[.1,.8,.6,.84])]
        ref={'engine':'fixture','pages':[{'number':1,'width':600,'height':800,'deskewAngle':0}],
             'blocks':[{'ref':f'b{i}','pageIndex':0,'text':text,'bbox':box} for i,(text,box) in enumerate(labels)]}
        inc=deepcopy(ref)
        inc['pages'][0].update(width=600*.96/.92,height=800,deskewAngle=-2)
        transform=[.92,.96,.04,.02]
        for b in inc['blocks']: b['bbox']=layout_alignment.box_incoming(b['bbox'],transform)
        inc['blocks'][4]['text']='999.50'
        template={'id':'invoice','name':'发票','matchTexts':['演示发票'],'fields':[{'key':'total','name':'金额','page':1,'region':[.38,.58,.63,.67],
                  'method':'region','kind':'amount','required':True,'stripLabel':False}]}
        return ref,inc,template

    def test_padding_alignment_reads_new_value_and_keeps_evidence_in_input_coordinates(self):
        ref,inc,template=self.pair();original=deepcopy(template)
        self.assertTrue(profiles.matches_layout(ref,inc,template))
        result=profiles.extract(ref,inc,template)
        self.assertTrue(result['passed'])
        self.assertEqual(result['fields'][0]['value'],'999.50')
        self.assertEqual(result['fields'][0]['bbox'],inc['blocks'][4]['bbox'])
        self.assertEqual(template,original)

    def test_inconsistent_labels_or_large_transform_are_rejected(self):
        for change in ['nonuniform','scale','offset','heading']:
            with self.subTest(change=change):
                ref,inc,template=self.pair()
                if change=='nonuniform': inc['blocks'][1]['bbox'][1]+=.08;inc['blocks'][1]['bbox'][3]+=.08
                if change=='scale': inc['pages'][0]['width']*=1.5
                if change=='offset':
                    for b in inc['blocks']: b['bbox'][0]+=.15;b['bbox'][2]+=.15
                if change=='heading': inc['blocks'][0]['text']='另一种材料'
                self.assertFalse(profiles.matches_layout(ref,inc,template))

    def test_values_and_duplicate_labels_cannot_be_used_as_registration_anchors(self):
        ref,inc,template=self.pair()
        inc['blocks']=[inc['blocks'][0],inc['blocks'][4]]
        self.assertIsNone(layout_alignment.transforms(ref,inc,template))
        ref,inc,template=self.pair()
        for idx in [1,2,3,5]:
            inc['blocks'].append(deepcopy(inc['blocks'][idx]))
        self.assertIsNone(layout_alignment.transforms(ref,inc,template))
