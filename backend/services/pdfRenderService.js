import PDFDocument from 'pdfkit';
import PdfTemplate from '../models/PdfTemplate.js';
import DynamicRecord from '../models/DynamicRecord.js';
import { evaluateFormula } from './formulaParser.js';
import configurationService from './configurationService.js';
import { AppError } from '../utils/errors.js';

const isId = (v) => typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);
const flatData = (r) => (r ? (r.data instanceof Map ? Object.fromEntries(r.data) : (r.data || {})) : {});
const fmt = (v) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * Render a PdfTemplate to a PDF buffer using actual record data.
 *   {record.field}            a field of the record
 *   {record.lookup.field}     a field of the record a lookup points at (one level)
 *   {name.field}              a field of a flow input (inputs: { name: {...} })
 *   {= price * qty}           a calculated value (same formula language as formula fields)
 * Block config: showIf (formula) = conditional section; datatable can read a flow
 * collection (inputName) or the record's children (relatedObject + lookupField) and
 * totals a column (column.total: 'sum'); image takes a data: URI or the tenant logo
 * (useBranding). Header and footer print on every page.
 */
export const renderPdfTemplate = async (tenantId, templateId, recordId, opts = {}) => {
  const template = await PdfTemplate.findOne({ _id: templateId, tenantId });
  if (!template) throw new AppError('PDF template not found.', 404);

  let record = null;
  if (recordId) {
    record = await DynamicRecord.findOne({ _id: recordId, tenantId, isDeleted: false }).lean();
    if (!record) throw new AppError('Record not found.', 404);
  }
  const recordData = flatData(record);
  const inputs = opts.inputs && typeof opts.inputs === 'object' ? opts.inputs : {};
  const relCache = new Map();
  const related = async (id) => {
    if (!isId(id)) return {};
    if (!relCache.has(id)) relCache.set(id, flatData(await DynamicRecord.findOne({ _id: id, tenantId, isDeleted: false }).lean()));
    return relCache.get(id);
  };
  const lookupPath = async (name, a, b) => {
    const base = name === 'record' ? recordData : inputs[name];
    if (base === undefined || base === null) return '';
    if (b === undefined) return fmt(base[a]);
    return fmt((await related(base[a]))[b]);
  };
  const merge = async (text) => {
    let out = String(text || '');
    const jobs = [];
    out.replace(/\{\{?=\s*([^{}]+?)\s*\}?\}/g, (m, expr) => { jobs.push([m, expr, true]); return m; });
    out.replace(/\{\{?(\w+)\.(\w+)(?:\.(\w+))?\}?\}/g, (m, n, a, b) => { jobs.push([m, [n, a, b], false]); return m; });
    for (const [m, x, isCalc] of jobs) {
      let v = '';
      if (isCalc) { try { v = fmt(evaluateFormula(x, { ...recordData })); } catch { v = ''; } } else v = await lookupPath(...x);
      out = out.split(m).join(v);
    }
    return out;
  };
  const visible = (block) => {
    const cond = block.config?.showIf;
    if (!cond) return true;
    try { return Boolean(evaluateFormula(cond, { ...recordData })); } catch { return false; }
  };

  const doc = new PDFDocument({
    size: template.pageSettings?.size || 'A4',
    layout: template.pageSettings?.orientation === 'landscape' ? 'landscape' : 'portrait',
    bufferPages: true,
    margins: {
      top: template.pageSettings?.marginTop ?? 40,
      bottom: template.pageSettings?.marginBottom ?? 40,
      left: template.pageSettings?.marginLeft ?? 40,
      right: template.pageSettings?.marginRight ?? 40,
    },
  });

  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  const blocks = [...(template.blocks || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  for (const block of blocks) {
    if (!visible(block)) continue;
    const font = block.style?.bold ? 'Helvetica-Bold' : 'Helvetica';
    switch (block.type) {
      case 'text': {
        const content = await merge(block.config?.content);
        doc.font(font).fontSize(block.style?.fontSize || 12).text(content, { align: block.style?.align || 'left' });
        doc.moveDown(block.style?.marginBottom ? block.style.marginBottom / 10 : 0.5);
        break;
      }
      case 'record_field': {
        const fieldApiName = block.config?.fieldApiName;
        const label = block.config?.label || fieldApiName;
        const src = block.config?.inputName && block.config.inputName !== 'record' && inputs[block.config.inputName] ? inputs[block.config.inputName] : recordData;
        const val = fmt(src[fieldApiName]);
        doc.font(font).fontSize(block.style?.fontSize || 12).text(block.config?.showLabel !== false ? `${label}: ${val}` : val);
        doc.moveDown(0.3);
        break;
      }
      case 'divider': {
        const y = doc.y;
        doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).stroke(block.config?.color || '#e2e8f0');
        doc.moveDown(0.5);
        break;
      }
      case 'spacer': {
        doc.moveDown((block.config?.height || 24) / 10);
        break;
      }
      case 'page_break': {
        doc.addPage();
        break;
      }
      case 'image': {
        let src = block.config?.url || '';
        if (block.config?.useBranding || block.config?.inputName === 'logo') {
          try { src = (await configurationService.resolve('branding.logo_url', tenantId)) || src; } catch { /* no logo set */ }
        } else if (block.config?.inputName && typeof inputs[block.config.inputName] === 'string') src = inputs[block.config.inputName];
        // Only embedded images: the server never fetches a URL named in a template.
        const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(String(src));
        if (m) {
          try { doc.image(Buffer.from(m[2], 'base64'), { width: Number(block.config?.width) || 120 }); doc.moveDown(0.5); } catch { /* unreadable image: skip */ }
        }
        break;
      }
      case 'datatable': {
        const columns = block.config?.columns || [];
        let items = inputs[block.config?.inputName] || recordData[block.config?.inputName] || [];
        if (block.config?.relatedObject && block.config?.lookupField && record) {
          const kids = await DynamicRecord.find({ tenantId, objectApiName: String(block.config.relatedObject), isDeleted: false, [`data.${String(block.config.lookupField).replace(/[^\w]/g, '')}`]: String(record._id) }).limit(200).lean();
          items = kids.map(flatData);
        }
        if (Array.isArray(items) && items.length > 0) {
          const colW = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / Math.max(columns.length, 1);
          const row = (cells, bold) => {
            const y = doc.y; let h = 0;
            cells.forEach((c, i) => {
              doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(String(c), doc.page.margins.left + i * colW, y, { width: colW - 4 });
              h = Math.max(h, doc.y - y);
            });
            doc.x = doc.page.margins.left; doc.y = y + h + 3;
          };
          row(columns.map((c) => c.label || c.fieldApiName), true);
          items.forEach((item) => row(columns.map((c) => fmt(item[c.fieldApiName])), false));
          if (columns.some((c) => c.total === 'sum')) {
            row(columns.map((c, i) => (c.total === 'sum' ? String(items.reduce((t, it) => t + (Number(it[c.fieldApiName]) || 0), 0)) : i === 0 ? 'Total' : '')), true);
          }
          doc.moveDown(0.5);
        }
        break;
      }
      default:
        break;
    }
  }

  // Header and footer on every page, inside the margins.
  const header = template.pageSettings?.headerHtml ? await merge(template.pageSettings.headerHtml.replace(/<[^>]*>/g, '')) : '';
  const footer = template.pageSettings?.footerHtml ? await merge(template.pageSettings.footerHtml.replace(/<[^>]*>/g, '')) : '';
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    const m = doc.page.margins;
    const w = doc.page.width - m.left - m.right;
    const bottom = m.bottom; doc.page.margins.bottom = 0;
    const tok = (x) => x.replace(/\{pageNumber\}/g, String(i + 1)).replace(/\{totalPages\}/g, String(range.count));
    if (header) doc.font('Helvetica').fontSize(10).text(tok(header), m.left, Math.max(12, m.top / 2 - 6), { width: w, align: 'center', lineBreak: false });
    const foot = /\{(pageNumber|totalPages)\}/.test(footer) ? tok(footer) : [footer, `Page ${i + 1} of ${range.count}`].filter(Boolean).join('   |   ');
    doc.font('Helvetica').fontSize(9).text(foot, m.left, doc.page.height - Math.max(24, bottom / 2 + 4), { width: w, align: 'center', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }

  doc.end();

  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
};

export default { renderPdfTemplate };
