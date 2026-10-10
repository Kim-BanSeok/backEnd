# API 명세서(docx)를 읽기 쉬운 마크다운(docs/API_명세서_v0.3.md)으로 바꾼다. 파이썬 기본 기능만 쓴다.
# 사용: python scripts/docx-to-md.py docs/Material_Loop_API_명세서_v0.3.docx docs/API_명세서_v0.3.md
# 이어서 npm run docs:build 로 Swagger 문서(src/docs/openapi.json)를 다시 만든다.
import sys, zipfile, re
import xml.etree.ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def text_of(p):
    out = []
    for n in p.iter():
        if n.tag == W + 't':
            out.append(n.text or '')
        elif n.tag in (W + 'tab', W + 'br'):
            out.append(' ')
    return ''.join(out).strip()


def style_of(p):
    s = p.find(f'{W}pPr/{W}pStyle')
    return s.get(W + 'val') if s is not None else ''


def render_table(tbl):
    rows = []
    for tr in tbl.findall(W + 'tr'):
        cells = []
        for tc in tr.findall(W + 'tc'):
            parts = [t for t in (text_of(p) for p in tc.iter(W + 'p')) if t]
            cells.append(' / '.join(parts).replace('|', '/'))
        rows.append('| ' + ' | '.join(cells) + ' |')
    if rows:
        ncol = rows[0].count('|') - 1
        rows.insert(1, '|' + ' --- |' * ncol)
    return '\n'.join(rows)


z = zipfile.ZipFile(sys.argv[1])
root = ET.fromstring(z.read('word/document.xml'))
body = root.find(W + 'body')
out = []
for el in body:
    if el.tag == W + 'p':
        t = text_of(el)
        if not t:
            continue
        m = re.match(r'Heading(\d)', style_of(el))
        out.append(('#' * int(m.group(1)) + ' ' if m else '') + t)
    elif el.tag == W + 'tbl':
        out.append(render_table(el))

# 윈도우에서도 줄바꿈을 LF 로 고정한다. (저장소와 같은 결과가 나오게)
with open(sys.argv[2], 'w', encoding='utf-8', newline='\n') as f:
    f.write('\n\n'.join(out))
