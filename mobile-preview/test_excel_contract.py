"""Inspect existing workbook template headers without loading business data."""
from pathlib import Path
from openpyxl import load_workbook

root = Path(__file__).resolve().parent.parent
contracts = {
    'formula_brief_template.xlsx': {
        'ข้อมูลสินค้า': ['ชื่อลูกค้า', 'ชื่อแบรนด์', 'คอนเซป', 'รูปแบบสินค้า', 'ขนาดบรรจุ', 'น้ำหนักต่อหน่วย (mg)', 'กลุ่มเป้าหมาย', 'เพศ', 'ราคา/หน่วย (บาท)', 'สรรพคุณ (คั่นด้วย ,)', 'ข้อจำกัด (คั่นด้วย ,)', 'หมายเหตุ'],
        'สารสกัด': ['ลำดับ', 'ชื่อสาร', 'ปริมาณที่ชั่ง (mg)', 'แหล่งกำเนิด', 'ความเข้มข้น (%)', 'สารที่ได้จริง (mg)', 'Hero', 'หมายเหตุ'],
    },
    'formula_brief_multi_job_template.xlsx': {
        'งาน': ['รหัสงาน (JobID)', 'ชื่อลูกค้า', 'ชื่อแบรนด์', 'คอนเซป', 'รูปแบบสินค้า', 'ขนาดบรรจุ', 'น้ำหนักต่อหน่วย (mg)', 'กลุ่มเป้าหมาย', 'เพศ', 'ราคา/หน่วย (บาท)', 'สรรพคุณ (คั่นด้วย ,)', 'ข้อจำกัด (คั่นด้วย ,)', 'หมายเหตุ'],
        'สารสกัด': ['รหัสงาน (JobID)', 'ชื่อสาร', 'ปริมาณที่ชั่ง (mg)', 'แหล่งกำเนิด', 'ความเข้มข้น (%)', 'Hero', 'หมายเหตุ'],
    },
}
for filename, sheets in contracts.items():
    book = load_workbook(root / filename, read_only=True, data_only=True)
    try:
        for name, expected in sheets.items():
            assert name in book.sheetnames, f'{filename}: missing {name}'
            first_row = next(book[name].iter_rows(min_row=1, max_row=1, values_only=True))
            assert list(first_row) == expected, f'{filename}: headers changed in {name}'
    finally:
        book.close()
print('PASS: existing single-job and multi-job workbook template headers')
print('NOTE: checks template structure only; see workbook.test.cjs for the mobile adapter')
