# Pulls the Metadata Engine Test Manual's content out of the artifact HTML into
# an ordered block list the docx builder walks. Inline <b>/<i>/<code> markup is
# left in place; the builder turns it into runs.
import json, re, sys, io

src = io.open(sys.argv[1], encoding='utf-8').read()
body = src[src.index('<div class="wrap">'):src.index('<script>')]
body = re.sub(r'<!--.*?-->', '', body, flags=re.S)
body = re.sub(r'<div class="progress-bar">.*?</div>\s*</div>', '', body, flags=re.S)

def clean(h):
    return re.sub(r'\s+', ' ', h.replace('&nbsp;', ' ')).strip()

def inner(tag, html):
    m = re.search(r'<%s[^>]*>(.*?)</%s>' % (tag, tag), html, re.S)
    return clean(m.group(1)) if m else ''

def lis(html):
    return [clean(x) for x in re.findall(r'<li>(.*?)</li>', html, re.S)]

def div_span(html, start):
    """Return the end offset of the <div> that opens at `start`, depth-aware."""
    depth, i = 0, start
    for m in re.finditer(r'<div\b[^>]*>|</div>', html[start:]):
        depth += 1 if m.group(0).startswith('<div') else -1
        if depth == 0:
            return start + m.end()
    raise ValueError('unbalanced div')

blocks = []
mast = re.search(r'<header class="mast">(.*?)</header>', body, re.S).group(1)
blocks.append({'t': 'mast',
               'eyebrow': inner('div', mast),
               'title': inner('h1', mast),
               'standfirst': clean(re.search(r'<p class="standfirst">(.*?)</p>', mast, re.S).group(1)),
               'meta': [clean(x) for x in re.findall(r'<span>(.*?)</span>', mast, re.S)]})

rest = body[body.index('</header>') + len('</header>'):]

def add_test(c):
    c = re.sub(r'\s+', ' ', c)
    title = re.search(r'<span class="t">(.*?)</span>', c).group(1)
    num, _, label = clean(title).partition('. ')
    asides = [{'title': clean(t), 'html': clean(h)} for t, h in
              re.findall(r'<div class="aside"><b>(.*?)</b>(.*?)</div>', c)]
    core = re.sub(r'<div class="aside">.*?</div>', '', c)
    blocks.append({
        't': 'test', 'num': num.strip(), 'title': label.strip(),
        'refs': [clean(r) for r in re.findall(r'<span class="ref">(.*?)</span>', c)],
        'steps': lis(re.search(r'<ol class="steps">(.*?)</ol>', core).group(1)),
        'expect': clean(re.search(r'<div class="expect">\s*<b>Expected</b>(.*?)</div>', core).group(1)),
        'asides': asides,
    })

def add_callout(c, warn):
    b = {'t': 'callout', 'kind': 'warn' if warn else 'plain',
         'title': inner('h3', c), 'items': lis(c),
         'defs': [[clean(a), clean(v)] for a, v in re.findall(r'<dt>(.*?)</dt><dd>(.*?)</dd>', c, re.S)],
         'tail': ''}
    tail = re.search(r'<p[^>]*>(.*?)</p>', c, re.S)
    if tail:
        b['tail'] = clean(tail.group(1))
    blocks.append(b)

i = 0
token = re.compile(r'<h2>(.*?)</h2>|<h3>(.*?)</h3>|<p class="sec-note">(.*?)</p>'
                   r'|<ul>(.*?)</ul>|<footer>(.*?)</footer>|<p>(.*?)</p>'
                   r'|<div class="(test|callout(?: warn)?)">', re.S)
while True:
    m = token.search(rest, i)
    if not m:
        break
    h2, h3, note, ul, foot, p, kind = m.groups()
    if kind:
        end = div_span(rest, m.start())
        chunk = rest[m.start():end]
        if kind == 'test':
            add_test(chunk)
        else:
            add_callout(chunk, 'warn' in kind)
        i = end
        continue
    if h2:      blocks.append({'t': 'h2', 'text': clean(h2)})
    elif h3:    blocks.append({'t': 'h3', 'text': clean(h3)})
    elif note:  blocks.append({'t': 'note', 'html': clean(note)})
    elif ul:    blocks.append({'t': 'ul', 'items': lis(ul)})
    elif foot:  blocks.append({'t': 'footer', 'html': clean(foot)})
    elif p:     blocks.append({'t': 'p', 'html': clean(p)})
    i = m.end()

json.dump(blocks, io.open('blocks.json', 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
from collections import Counter
print(Counter(b['t'] for b in blocks))
print('tests:', sum(1 for b in blocks if b['t'] == 'test'))
