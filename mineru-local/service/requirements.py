"""Read field requirements from XLSX without executing formulas or sending a model request."""
from io import BytesIO
from pathlib import Path
import re
from zipfile import BadZipFile, ZipFile

from openpyxl import load_workbook
from pydantic import BaseModel, ConfigDict, Field, StrictStr, model_validator


class RequirementField(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: StrictStr = Field(min_length=1, max_length=40)
    rule: StrictStr = Field(default='', max_length=1000)
    cell: StrictStr = Field(min_length=2, max_length=15, pattern=r'^[A-Z]{1,3}[1-9][0-9]*$')
    ruleCell: StrictStr | None = Field(default=None, max_length=15, pattern=r'^[A-Z]{1,3}[1-9][0-9]*$')
    group: StrictStr = Field(default='', max_length=100)


class RequirementDefinition(BaseModel):
    model_config = ConfigDict(extra='forbid')
    fileName: StrictStr = Field(min_length=1, max_length=255)
    sheet: StrictStr = Field(min_length=1, max_length=31)
    fields: list[RequirementField] = Field(min_length=1, max_length=30)

    @model_validator(mode='after')
    def check_names(self):
        names = [item.name for item in self.fields]
        if len(set(names)) != len(names):
            raise ValueError('字段表包含重复字段，请合并后再上传。')
        if sum(len(item.rule) for item in self.fields) > 12000:
            raise ValueError('字段规则总长度超过12000字符，请缩短规则。')
        return self


FIELD_HEADERS = {'字段', '字段名', '字段名称', '提取字段', '提取字段名称', '提取要素', '要素名称'}
RULE_HEADERS = {'备注', '规则', '提取规则', '要求', '提取要求', '说明'}
GROUP_HEADERS = {'输出', '分组', '分类', '类别'}
MAX_WORKBOOK_BYTES = 8 * 1024 * 1024


def header(value) -> str:
    return re.sub(r'\s+', '', value).rstrip(':：') if isinstance(value, str) else ''


def read_sheet(sheet) -> dict | None:
    if sheet.max_row > 1000 or sheet.max_column > 40:
        raise ValueError(f'“{sheet.title}”范围过大，字段表每张最多1000行、40列。')
    rows = list(sheet.iter_rows())
    for index, cells in enumerate(rows[:30]):
        names = [header(cell.value) for cell in cells]
        field_columns = [i for i, name in enumerate(names) if name in FIELD_HEADERS]
        if not field_columns:
            continue
        if len(field_columns) != 1:
            raise ValueError(f'“{sheet.title}”包含多个字段列，请只保留一列字段名称。')
        field_column = field_columns[0]
        rule_columns = [i for i, name in enumerate(names) if name in RULE_HEADERS]
        group_columns = [i for i, name in enumerate(names) if name in GROUP_HEADERS]
        fields, group = [], ''
        for row in rows[index + 1:]:
            field_cell = row[field_column]
            if field_cell.value is None or not str(field_cell.value).strip():
                continue
            if field_cell.data_type == 'f':
                raise ValueError(f'“{sheet.title}”!{field_cell.coordinate}是公式，请先转为字段名称文字。')
            name = str(field_cell.value).strip()
            if header(name) in FIELD_HEADERS:
                raise ValueError(f'“{sheet.title}”出现重复表头，请将不同字段清单分到不同工作表。')
            rule_parts, rule_cell = [], None
            for column in rule_columns:
                cell = row[column]
                if cell.value is None:
                    continue
                if cell.data_type == 'f':
                    raise ValueError(f'“{sheet.title}”!{cell.coordinate}是公式，请先转为规则文字。')
                if str(cell.value).strip():
                    rule_parts.append(str(cell.value).strip())
                    rule_cell = rule_cell or cell.coordinate
            if group_columns and row[group_columns[0]].value is not None:
                group = str(row[group_columns[0]].value).strip()
            fields.append({'name': name, 'rule': '\n'.join(rule_parts), 'cell': field_cell.coordinate,
                           'ruleCell': rule_cell, 'group': group})
        if not fields:
            return None
        return RequirementDefinition(fileName='workbook.xlsx', sheet=sheet.title, fields=fields).model_dump(exclude={'fileName'})
    return None


def parse_workbook(content: bytes, filename: str) -> dict:
    if Path(filename).suffix.lower() != '.xlsx':
        raise ValueError('字段要求表请使用 .xlsx 格式；旧版 .xls 请先另存为 .xlsx。')
    if not content or len(content) > MAX_WORKBOOK_BYTES:
        raise ValueError('字段要求表应为非空且不超过8 MB的 .xlsx 文件。')
    try:
        with ZipFile(BytesIO(content)) as package:
            parts = package.infolist()
            if len(parts) > 2000 or sum(part.file_size for part in parts) > 32 * 1024 * 1024:
                raise ValueError('字段要求表解压后过大，请仅保留需要的字段清单。')
        workbook = load_workbook(BytesIO(content), read_only=True, data_only=False, keep_links=False)
        try:
            if len(workbook.sheetnames) > 10:
                raise ValueError('字段要求表最多10张工作表，请仅保留需要的字段清单。')
            sheets = [result for sheet in workbook if (result := read_sheet(sheet))]
        finally:
            workbook.close()
    except (BadZipFile, KeyError, OSError) as exc:
        raise ValueError('无法读取此 Excel，请确认是未加密且完整的 .xlsx 文件。') from exc
    if not sheets:
        raise ValueError('没有找到字段清单。请使用“字段”或“字段名称”作为表头，可另加“备注”或“提取要求”列。')
    return {'fileName': Path(filename).name, 'sheets': sheets}
