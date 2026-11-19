"""Splice the X Spark cover page and title-page logo into the generated docx.

Both come from the shipped Automation Step Runbook, so the front matter is
byte-identical to the house document rather than a re-creation of it: the
full-page cover artwork, the Appsolutely Software lockup and the date box.
"""
import io, os, re, shutil, sys, zipfile

REF = sys.argv[1]      # unpacked reference docx
MINE = sys.argv[2]     # unpacked generated docx
OUT = sys.argv[3]
DATE = sys.argv[4]

ref = io.open(os.path.join(REF, 'word/document.xml'), encoding='utf-8').read()

# Front matter runs from <w:body> to the end of the paragraph holding the logo.
start = ref.index('<w:body>') + len('<w:body>')
end = ref.index('</w:p>', ref.index('rId8')) + len('</w:p>')
front = ref[start:end]

# Two empty spacer paragraphs that follow it in the house document.
tail = ref[end:]
m = re.match(r'(?:<w:p [^>]*>(?:(?!<w:p[ >]).)*?</w:p>){2}', tail, re.S)
front += m.group(0)

# The date box carries the runbook's issue date, split across four runs.
front = re.sub(r'(<w:t>)16(</w:t>)', r'\g<1>%s\g<2>' % DATE.split()[0], front)
front = re.sub(r'(<w:t>)Novem(</w:t>)', r'\g<1>%s\g<2>' % DATE.split()[1][:5], front)
front = re.sub(r'(<w:t>)ber 2026(</w:t>)',
               r'\g<1>%s %s\g<2>' % (DATE.split()[1][5:], DATE.split()[2]), front)

# Point the two drawings at relationship ids that cannot collide with ours.
front = front.replace('r:embed="rId7"', 'r:embed="rId100"')
front = front.replace('r:embed="rId8"', 'r:embed="rId101"')

# --- splice into the generated document ------------------------------------
doc_path = os.path.join(MINE, 'word/document.xml')
doc = io.open(doc_path, encoding='utf-8').read()
assert 'rId100' not in doc
doc = doc.replace('<w:body>', '<w:body>' + front, 1)
io.open(doc_path, 'w', encoding='utf-8').write(doc)

os.makedirs(os.path.join(MINE, 'word/media'), exist_ok=True)
for src, dst in (('image1.emf', 'image1.emf'), ('image2.emf', 'image2.emf')):
    shutil.copyfile(os.path.join(REF, 'word/media', src), os.path.join(MINE, 'word/media', dst))

rels_path = os.path.join(MINE, 'word/_rels/document.xml.rels')
rels = io.open(rels_path, encoding='utf-8').read()
IMG = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
rels = rels.replace('</Relationships>',
    '<Relationship Id="rId100" Type="%s" Target="media/image1.emf"/>'
    '<Relationship Id="rId101" Type="%s" Target="media/image2.emf"/></Relationships>' % (IMG, IMG))
io.open(rels_path, 'w', encoding='utf-8').write(rels)

ct_path = os.path.join(MINE, '[Content_Types].xml')
ct = io.open(ct_path, encoding='utf-8').read()
if 'Extension="emf"' not in ct:
    ct = ct.replace('<Default ContentType="image/png" Extension="png"/>',
                    '<Default ContentType="image/x-emf" Extension="emf"/>'
                    '<Default ContentType="image/png" Extension="png"/>', 1)
io.open(ct_path, 'w', encoding='utf-8').write(ct)

# --- repack -----------------------------------------------------------------
if os.path.exists(OUT):
    os.remove(OUT)
names = []
for root, _, files in os.walk(MINE):
    for f in files:
        names.append(os.path.relpath(os.path.join(root, f), MINE))
# OPC requires the content-type map to be the first entry in the archive.
order = {'[Content_Types].xml': 0, '_rels/.rels': 1}
names.sort(key=lambda n: (order.get(n, 2), n))
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    for n in names:
        z.write(os.path.join(MINE, n), n)
print('wrote', OUT, '%.0f KB' % (os.path.getsize(OUT) / 1024))
