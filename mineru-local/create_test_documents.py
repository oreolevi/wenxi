"""Generate fictional Chinese text and image-only PDFs for local parsing QA."""
from pathlib import Path
import subprocess

from PIL import Image
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from pypdf import PdfReader

root = Path(__file__).resolve().parent
target = root / 'testdata'
rendered = root / 'tmp' / 'pdfs'
target.mkdir(parents=True, exist_ok=True)
rendered.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(TTFont('TestChinese', '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'))
text_pdf = target / 'fictional-application-text.pdf'
c = canvas.Canvas(str(text_pdf), pagesize=(595, 842))
c.setTitle('文析 - 虚构申请表测试件')

def page(title, subtitle, rows, number):
    c.setFillColorRGB(.12, .14, .18)
    c.setFont('TestChinese', 23)
    c.drawString(55, 760, title)
    c.setFont('TestChinese', 11)
    c.setFillColorRGB(.4, .43, .47)
    c.drawString(55, 733, subtitle)
    y = 674
    for label, value in rows:
        c.setFillColorRGB(.25, .28, .33)
        c.setFont('TestChinese', 14)
        c.drawString(55, y, label + '：')
        c.setFillColorRGB(.1, .12, .16)
        c.drawString(185, y, value)
        c.setStrokeColorRGB(.83, .85, .88)
        c.line(55, y - 19, 540, y - 19)
        y -= 62
    c.setFillColorRGB(.5, .52, .55)
    c.setFont('TestChinese', 10)
    c.drawString(55, 65, '本材料全部信息均为虚构，仅用于软件识别测试。')
    c.drawRightString(540, 65, f'{number} / 2')
    c.showPage()

page('企业资料变更申请表', '文析本机测试 / 申请信息', [
    ('企业名称', '上海文析测试有限公司'),
    ('提交人', '林晓'),
    ('通讯地址', '上海市浦东新区示例路88号12层'),
    ('申请日期', '2026年10月29日'),
    ('联系电话', '138****0268'),
], 1)
page('资料变更审核记录', '文析本机测试 / 审核信息', [
    ('初审人员', '张宁'),
    ('最终审核人员', '陈敏'),
    ('审核日期', '2026年10月29日'),
    ('审核意见', '同意变更通讯地址'),
], 2)
c.save()
subprocess.run(['pdftoppm', '-r', '150', '-png', str(text_pdf), str(rendered / 'application')], check=True)
pages = [Image.open(path).convert('RGB') for path in sorted(rendered.glob('application-*.png'))]
scan_pdf = target / 'fictional-application-scan.pdf'
pages[0].save(scan_pdf, save_all=True, append_images=pages[1:], resolution=150)
assert len(PdfReader(text_pdf).pages) == 2
assert all(not page.extract_text().strip() for page in PdfReader(scan_pdf).pages)
print(f'Created two 2-page PDFs, including a verified image-only scan: {target}')
