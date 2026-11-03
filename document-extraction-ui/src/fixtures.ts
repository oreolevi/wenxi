import type { Fixture, Scenario } from './types.ts';

export const fixtures: Record<Scenario, Fixture> = {
  "application": {
    "name": "企业资料变更申请表_示例.pdf",
    "label": "申请表要素",
    "description": "提交人、通讯地址、审核人员",
    "prompt": "提取提交人、通讯地址、最终审核人员、申请日期和联系电话，整理成表格。",
    "pages": 2,
    "fields": [
      {
        "key": "submitter",
        "name": "提交人",
        "value": "林晓",
        "raw": "林晓",
        "page": 1,
        "ref": "submitter",
        "aliases": [
          "提交人",
          "申请人",
          "经办人"
        ],
        "note": "",
        "status": "pending"
      },
      {
        "key": "address",
        "name": "通讯地址",
        "value": "上海市浦东新区示例路88号12层",
        "raw": "上海市浦东新区示例路88号\n12层",
        "page": 1,
        "ref": "address",
        "aliases": [
          "通讯地址",
          "联系地址",
          "邮寄地址"
        ],
        "note": "",
        "status": "pending"
      },
      {
        "key": "reviewer",
        "name": "最终审核人员",
        "value": "陈敏",
        "raw": "陈敏",
        "page": 2,
        "ref": "reviewer",
        "aliases": [
          "最终审核人员",
          "审核人员",
          "审核人",
          "复核人员",
          "复核人"
        ],
        "note": "",
        "status": "pending"
      },
      {
        "key": "date",
        "name": "申请日期",
        "value": "2026-10-26",
        "raw": "2026年10月26日",
        "page": 1,
        "ref": "date",
        "aliases": [
          "申请日期",
          "提交日期"
        ],
        "note": "",
        "status": "pending"
      },
      {
        "key": "phone",
        "name": "联系电话",
        "value": "138****0268",
        "raw": "138****0268",
        "page": 1,
        "ref": "phone",
        "aliases": [
          "联系电话",
          "电话",
          "手机号"
        ],
        "note": "",
        "status": "pending"
      },
      {
        "key": "registered",
        "name": "注册地址",
        "value": "上海市黄浦区示例路168号",
        "raw": "上海市黄浦区示例路168号",
        "page": 1,
        "ref": "registered",
        "aliases": [
          "注册地址"
        ],
        "note": "",
        "status": "pending"
      },
      {
        "key": "firstReviewer",
        "name": "初审人员",
        "value": "张宁",
        "raw": "张宁",
        "page": 2,
        "ref": "firstReviewer",
        "aliases": [
          "初审人员",
          "初审人"
        ],
        "note": "",
        "status": "pending"
      },
      {
        "key": "company",
        "name": "企业名称",
        "value": "上海示例商贸有限公司",
        "raw": "上海示例商贸有限公司",
        "page": 1,
        "ref": "company",
        "aliases": [
          "企业名称",
          "公司名称",
          "单位名称"
        ],
        "note": "",
        "status": "pending"
      },
      {
        "key": "subject",
        "name": "申请事项",
        "value": "企业账户资料变更",
        "raw": "企业账户资料变更",
        "page": 1,
        "ref": "subject",
        "aliases": [
          "申请事项",
          "变更事项"
        ],
        "note": "",
        "status": "pending"
      },
      {
        "key": "reviewDate",
        "name": "审核日期",
        "value": "2026-10-27",
        "raw": "2026年10月27日",
        "page": 2,
        "ref": "reviewDate",
        "aliases": [
          "审核日期",
          "复核日期"
        ],
        "note": "",
        "status": "pending"
      }
    ]
  },
  "contract": {
    "name": "设备采购合同_示例.pdf",
    "label": "合同关键信息",
    "description": "合同双方、金额、日期与依据",
    "prompt": "提取合同编号、甲方名称、乙方名称、合同金额和签订日期，金额统一为元。",
    "pages": 2,
    "fields": [
      {
        "key": "number",
        "name": "合同编号",
        "value": "HT-2026-1026",
        "raw": "HT-2026-1026",
        "page": 1,
        "ref": "number",
        "aliases": [
          "合同编号",
          "编号"
        ],
        "note": "",
        "status": "pending"
      },
      {
        "key": "partyA",
        "name": "甲方名称",
        "value": "上海示例商贸有限公司",
        "raw": "上海示例商贸有限公司",
        "page": 1,
        "ref": "partyA",
        "aliases": [
          "甲方名称",
          "甲方",
          "采购方"
        ],
        "note": "",
        "status": "pending"
      },
      {
        "key": "partyB",
        "name": "乙方名称",
        "value": "华东示例设备有限公司",
        "raw": "华东示例设备有限公司",
        "page": 1,
        "ref": "partyB",
        "aliases": [
          "乙方名称",
          "乙方",
          "供应商"
        ],
        "note": "",
        "status": "pending"
      },
      {
        "key": "amount",
        "name": "合同金额",
        "value": "128000.00",
        "raw": "12.8万元",
        "page": 1,
        "ref": "amount",
        "aliases": [
          "合同金额",
          "含税金额",
          "含税总额",
          "合同总价",
          "金额"
        ],
        "note": "单位已转换：原文 12.8 万元 → 128000.00 元",
        "status": "pending"
      },
      {
        "key": "date",
        "name": "签订日期",
        "value": "2026-10-26",
        "raw": "2026年10月26日",
        "page": 2,
        "ref": "date",
        "aliases": [
          "签订日期",
          "签署日期"
        ],
        "note": "",
        "status": "pending"
      },
      {
        "key": "reviewer",
        "name": "审核人员",
        "value": "陈敏",
        "raw": "陈敏",
        "page": 2,
        "ref": "reviewer",
        "aliases": [
          "审核人员",
          "审核人"
        ],
        "note": "",
        "status": "pending"
      },
      {
        "key": "address",
        "name": "交付地址",
        "value": "上海市浦东新区示例路88号",
        "raw": "上海市浦东新区示例路88号",
        "page": 2,
        "ref": "address",
        "aliases": [
          "交付地址",
          "交货地址"
        ],
        "note": "",
        "status": "pending"
      }
    ]
  }
};
