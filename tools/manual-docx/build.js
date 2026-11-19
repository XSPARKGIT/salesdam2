/**
 * Metadata Engine Test Manual -> .docx, in the X Spark house format.
 *
 * Formatting follows "X Spark - Automation Step Runbook" exactly: Helvetica
 * Neue throughout, black body text, X Spark accent bars down the left of every
 * tinted panel, the same footer rule, and a Word TOC. Content comes verbatim
 * from blocks.json, which extract.py lifts out of the published manual.
 */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  TableOfContents, PageBreak, Footer, PageNumber, LevelFormat,
  convertInchesToTwip,
} = require('docx');

const HERE = __dirname;
const BLOCKS = JSON.parse(fs.readFileSync(path.join(HERE, 'blocks.json'), 'utf8'));

/* The manual is a web page; this is the printed edition, so its issue date and
   its closing line are restated for paper. */
const ISSUED = process.env.MANUAL_ISSUED || '19 November 2026';
const ISSUED_SHORT = ISSUED.replace(/ (\w{3})\w* /, ' $1 ');
// Per-run settings (see SECTION_TEST_PLAYBOOK.md): which manual this is.
const TITLE = process.env.MANUAL_TITLE || 'Metadata Engine Test Manual';
const FILE = process.env.MANUAL_FILE || 'Metadata-Engine-Test-Manual.docx';
const DESCRIPTION = process.env.MANUAL_DESCRIPTION
  || 'Client acceptance script for BRD Section 3 — Object & Field Metadata Engine.';
for (const b of BLOCKS) {
  if (b.t === 'mast') {
    b.meta = b.meta.map((m) => (m.startsWith('<b>Issued</b>') ? '<b>Issued</b> ' + ISSUED_SHORT : m));
  }
  if (b.t === 'footer') {
    b.html = b.html
      .replace(/issued \d+ \w+ \d{4}/, 'issued ' + ISSUED)
      .replace('Tick-box progress is remembered in this browser only.', 'Tick each test off as you complete it.');
  }
}

/* ---- X Spark palette ----------------------------------------------------- */
const INK     = '000000';   // body text, as the runbook ships
const NAVY    = '1F2442';   // primary dark — expectation bar, date
const PLUM    = '8E2488';   // asides
const CRIMSON = 'C21F3A';   // cautions
const MAGENTA = 'A8205E';   // accent — panels, page number
const PINK    = 'F2A0BF';   // light accent — step slabs
const LIGHTBG = 'F3F5F8';   // page-tint panels
const CODEBG  = 'F7F8FA';   // step slab ground
const BORDER  = 'E0E3EC';   // hairlines
const MUTED   = '5A6078';   // secondary text
const WHITE   = 'FFFFFF';

const FACE = 'Helvetica Neue';

/* ---- inline HTML -> TextRun[] -------------------------------------------- */
const ENT = { '&gt;': '>', '&lt;': '<', '&amp;': '&', '&nbsp;': ' ', '&quot;': '"', '&#39;': "'" };
const decode = (s) => s.replace(/&gt;|&lt;|&amp;|&nbsp;|&quot;|&#39;/g, (m) => ENT[m]);

/** Turns the manual's <b>/<i>/<code> markup into runs. */
function runs(html, base = {}) {
  if (!html) return [];
  const out = [];
  const re = /<(b|i|code)>([\s\S]*?)<\/\1>/g;
  let last = 0, m;
  const plain = (txt, extra) => {
    if (!txt) return;
    out.push(new TextRun({
      text: decode(txt), font: base.font || FACE,
      size: base.size || 20, color: base.color || INK, ...extra,
    }));
  };
  while ((m = re.exec(html)) !== null) {
    plain(html.slice(last, m.index));
    if (m[1] === 'b') plain(m[2], { bold: true });
    else if (m[1] === 'i') plain(m[2], { italics: true });
    else plain(m[2], { size: (base.size || 20) - 2 });  // <code>
    last = re.lastIndex;
  }
  plain(html.slice(last));
  return out;
}

/* ---- paragraph helpers --------------------------------------------------- */
const noBorder = { style: BorderStyle.NONE, size: 0, color: 'auto' };

const text = (t, o = {}) => new TextRun({
  text: t, font: o.font || FACE, size: o.size || 20, color: o.color || INK,
  bold: o.bold, italics: o.italics, characterSpacing: o.spacing,
});

/** A tinted panel: shaded paragraph with an accent bar down the left. */
function panel(children, { fill = LIGHTBG, bar = MAGENTA, after = 140, keepNext } = {}) {
  return new Paragraph({
    children,
    shading: { type: ShadingType.CLEAR, fill, color: 'auto' },
    border: {
      left: { style: BorderStyle.SINGLE, size: 18, color: bar, space: 8 },
      top: noBorder, bottom: noBorder, right: noBorder,
    },
    spacing: { before: 60, after, line: 276 },
    indent: { left: 170, right: 110 },
    keepNext,
  });
}

/* ---- tables -------------------------------------------------------------- */
const TOTAL_W = 9360;   // DXA across an A4 text column at 1" margins

function cell(children, w, { fill, head } = {}) {
  return new TableCell({
    width: { size: w, type: WidthType.DXA },
    shading: fill ? { type: ShadingType.CLEAR, fill, color: 'auto' } : undefined,
    margins: { top: 90, bottom: 90, left: 120, right: 120 },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
      left: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
      right: { style: BorderStyle.SINGLE, size: 4, color: BORDER },
    },
    children: children.map((c) => (typeof c === 'string'
      ? new Paragraph({
          children: [text(c, { size: 19, bold: head, color: head ? WHITE : INK })],
          spacing: { after: 0 },
        })
      : c)),
  });
}

function table(rows, widths, { headFill = NAVY } = {}) {
  return new Table({
    width: { size: TOTAL_W, type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map((r, i) => new TableRow({
      tableHeader: i === 0,
      children: r.map((c, j) => cell(Array.isArray(c) ? c : [c], widths[j],
        i === 0 ? { fill: headFill, head: true } : { fill: i % 2 ? WHITE : LIGHTBG })),
    })),
  });
}

/* ---- headings ------------------------------------------------------------ */
const H1 = (t) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  children: [text(t, { size: 30, bold: true })],
  spacing: { before: 320, after: 160 },
});
const H3 = (t) => new Paragraph({
  children: [text(t, { size: 24, bold: true })],
  spacing: { before: 300, after: 100 }, keepNext: true,
});
const SUB = (t) => new Paragraph({
  children: runs(t, { size: 19, color: MUTED }),
  spacing: { after: 200 }, indent: { right: 600 },
});

/* ---- one test ------------------------------------------------------------ */
const TICK = new TextRun({ text: 'o  ', font: 'Wingdings', size: 22, color: INK });

function testBlock(t) {
  const kids = [];

  // Tick box + number + title + BRD references, as Heading 2 so it reaches the TOC.
  kids.push(new Paragraph({
    children: [
      TICK,
      text(String(t.num).padStart(2, '0') + '  ', { size: 20, bold: true }),
      text(decode(t.title), { size: 21, bold: true }),
      text('   ' + t.refs.join('  ·  '), { size: 14, bold: true, spacing: 20 }),
    ],
    spacing: { before: 280, after: 80 },
    keepNext: true,
  }));

  // Steps — one numbered line each, on the step slab.
  t.steps.forEach((s, i) => kids.push(new Paragraph({
    numbering: { reference: 'steps', level: 0, instance: Number(t.num) },
    children: runs(s, { size: 19 }),
    shading: { type: ShadingType.CLEAR, fill: CODEBG, color: 'auto' },
    border: {
      left: { style: BorderStyle.SINGLE, size: 12, color: PINK, space: 10 },
      top: i === 0 ? { style: BorderStyle.SINGLE, size: 6, color: BORDER, space: 6 } : noBorder,
      bottom: i === t.steps.length - 1
        ? { style: BorderStyle.SINGLE, size: 6, color: BORDER, space: 6 } : noBorder,
      right: noBorder,
    },
    spacing: { before: i === 0 ? 80 : 0, after: i === t.steps.length - 1 ? 150 : 40, line: 264 },
    indent: { left: 600, hanging: 260, right: 110 },
    keepNext: i < t.steps.length - 1,
  })));

  // What the tester should see.
  kids.push(panel([text('Expected:  ', { bold: true, size: 19 }),
                   ...runs(t.expect, { size: 19 })], { bar: NAVY }));

  // Background notes that are not themselves a step.
  t.asides.forEach((a) => kids.push(panel(
    [text(decode(a.title) + '.  ', { bold: true, size: 19, color: PLUM }),
     ...runs(a.html, { size: 19 })],
    { fill: 'FBF4FA', bar: PLUM })));

  return kids;
}

/* ---- document ------------------------------------------------------------ */
const mast = BLOCKS.find((b) => b.t === 'mast');
const body = [];

/* Title block */
body.push(new Paragraph({
  children: [text(decode(mast.eyebrow).toUpperCase(), { size: 16, bold: true, spacing: 40 })],
  spacing: { after: 120 },
}));
body.push(new Paragraph({
  children: [text(decode(mast.title), { size: 52, bold: true })],
  spacing: { after: 160 },
}));
body.push(new Paragraph({
  children: runs(mast.standfirst, { size: 22 }),
  spacing: { after: 300 }, indent: { right: 900 },
}));

/* Scope strip */
const strip = mast.meta.map((m) => {
  const [, label, value] = m.match(/<b>(.*?)<\/b>\s*(.*)/);
  return { label: decode(label), value: decode(value) };
});
body.push(table([
  strip.map((s) => s.label),
  strip.map((s) => [new Paragraph({
    children: [text(s.value, { size: 24, bold: true })], spacing: { after: 0 },
  })]),
], strip.map(() => Math.floor(TOTAL_W / strip.length))));

body.push(new Paragraph({ children: [new PageBreak()] }));

/* Contents */
body.push(H1('Contents'));
body.push(new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-1' }));
body.push(new Paragraph({
  children: [text('Right-click → Update Field to populate this list in Word.',
    { size: 17, color: MUTED, italics: true })],
  spacing: { before: 120 },
}));
body.push(new Paragraph({ children: [new PageBreak()] }));

/* Everything else, in the order the manual sets it out */
for (const b of BLOCKS) {
  switch (b.t) {
    case 'mast':
      break;

    case 'h2':
      body.push(H1(decode(b.text)));
      break;

    case 'h3':
      body.push(H3(decode(b.text)));
      break;

    case 'note':
      body.push(SUB(b.html));
      break;

    case 'p':
      body.push(new Paragraph({ children: runs(b.html, { size: 20 }), spacing: { after: 140 } }));
      break;

    case 'ul':
      b.items.forEach((it) => body.push(new Paragraph({
        bullet: { level: 0 },
        children: runs(it, { size: 20 }),
        spacing: { after: 80, line: 264 },
        indent: { left: 460, hanging: 240 },
      })));
      break;

    case 'callout': {
      const warn = b.kind === 'warn';
      const bar = warn ? CRIMSON : MAGENTA;
      const fill = warn ? 'FCF2F4' : LIGHTBG;
      body.push(new Paragraph({
        children: [text(decode(b.title), { size: 21, bold: true, color: warn ? CRIMSON : INK })],
        spacing: { before: 220, after: 60 }, keepNext: true,
      }));
      b.defs.forEach(([k, v], i) => body.push(panel(
        [text(decode(k) + '   ', { bold: true, size: 19 }), ...runs(v, { size: 19 })],
        { fill, bar, after: i === b.defs.length - 1 ? 140 : 0 })));
      b.items.forEach((it, i) => body.push(panel(
        runs(it, { size: 19 }),
        { fill, bar, after: i === b.items.length - 1 ? 140 : 0 })));
      if (b.tail) {
        body.push(new Paragraph({
          children: runs(b.tail, { size: 18, color: MUTED }),
          spacing: { after: 180 }, indent: { left: 170, right: 600 },
        }));
      }
      break;
    }

    case 'test':
      body.push(...testBlock(b));
      break;

    case 'footer':
      body.push(new Paragraph({
        children: runs(b.html, { size: 17, color: MUTED, italics: true }),
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: BORDER, space: 8 },
                  bottom: noBorder, left: noBorder, right: noBorder },
        spacing: { before: 400, after: 0 }, indent: { right: 600 },
      }));
      break;

    default:
      throw new Error('unhandled block: ' + b.t);
  }
}

/* ---- assemble ------------------------------------------------------------ */
const doc = new Document({
  creator: 'X Spark',
  title: TITLE,
  description: DESCRIPTION,
  styles: {
    default: {
      document: { run: { font: FACE, size: 20, color: INK },
                  paragraph: { spacing: { line: 276 } } },
      heading1: { run: { font: FACE, size: 30, bold: true, color: INK } },
      heading2: { run: { font: FACE, size: 21, bold: true, color: INK } },
    },
  },
  numbering: {
    config: BLOCKS.filter((b) => b.t === 'test').map((b) => ({
      reference: 'steps',
      instance: Number(b.num),
      levels: [{
        level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START,
        style: { paragraph: { indent: { left: 600, hanging: 260 } },
                 run: { font: FACE, size: 19, bold: true } },
      }],
    })),
  },
  sections: [{
    properties: {
      page: { margin: {
        top: convertInchesToTwip(1), bottom: convertInchesToTwip(1),
        left: convertInchesToTwip(1), right: convertInchesToTwip(1),
      } },
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: BORDER, space: 6 },
                  bottom: noBorder, left: noBorder, right: noBorder },
        children: [
          new TextRun({ text: 'Salesdam · ' + TITLE + '     ',
                        font: FACE, size: 15, color: MUTED }),
          new TextRun({ children: [PageNumber.CURRENT],
                        font: FACE, size: 15, bold: true, color: MAGENTA }),
        ],
      })] }),
    },
    children: body,
  }],
});

const out = path.join(HERE, FILE);
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(out, buf);
  console.log('wrote ' + out);
  console.log('  ' + (buf.length / 1024).toFixed(0) + ' KB  ·  '
    + BLOCKS.filter((b) => b.t === 'test').length + ' tests  ·  '
    + BLOCKS.filter((b) => b.t === 'h2').length + ' sections');
});
