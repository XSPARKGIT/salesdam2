import PDFDocument from 'pdfkit';
import PdfTemplate from '../models/PdfTemplate.js';
import DynamicRecord from '../models/DynamicRecord.js';
import FieldMeta from '../models/FieldMeta.js';
import ObjectMeta from '../models/ObjectMeta.js';
import { AppError } from '../utils/errors.js';

/**
 * Render a PdfTemplate to a PDF buffer using actual record data.
 */
export const renderPdfTemplate = async (tenantId, templateId, recordId) => {
  const template = await PdfTemplate.findOne({ _id: templateId, tenantId });
  if (!template) throw new AppError('PDF template not found.', 404);

  let record = null;
  let fields = [];
  if (recordId) {
    record = await DynamicRecord.findOne({ _id: recordId, tenantId, isDeleted: false }).lean();
    if (!record) throw new AppError('Record not found.', 404);
    fields = await FieldMeta.find({ tenantId, objectApiName: record.objectApiName }).lean();
  }

  const fieldMap = Object.fromEntries(fields.map((f) => [f.apiName, f]));
  const recordData = record ? (record.data instanceof Map ? Object.fromEntries(record.data) : (record.data || {})) : {};

  const doc = new PDFDocument({
    size: template.pageSettings?.size || 'A4',
    layout: template.pageSettings?.orientation === 'landscape' ? 'landscape' : 'portrait',
    margins: {
      top: template.pageSettings?.marginTop ?? 40,
      bottom: template.pageSettings?.marginBottom ?? 40,
      left: template.pageSettings?.marginLeft ?? 40,
      right: template.pageSettings?.marginRight ?? 40,
    },
  });

  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  // Header
  if (template.pageSettings?.headerHtml) {
    doc.fontSize(10).text(template.pageSettings.headerHtml.replace(/<[^>]*>/g, ''), { align: 'center' });
    doc.moveDown(0.5);
  }

  // Blocks sorted by order
  const blocks = [...(template.blocks || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  for (const block of blocks) {
    switch (block.type) {
      case 'text': {
        const content = (block.config?.content || '').replace(/\{(\w+)\.(\w+)\}/g, (_, inputName, fieldApiName) => {
          if (inputName === 'record') return recordData[fieldApiName] ?? '';
          return '';
        });
        doc.fontSize(block.style?.fontSize || 12).text(content, {
          align: block.style?.align || 'left',
          bold: block.style?.bold,
        });
        doc.moveDown(block.style?.marginBottom ? block.style.marginBottom / 10 : 0.5);
        break;
      }
      case 'record_field': {
        const fieldApiName = block.config?.fieldApiName;
        const label = block.config?.label || fieldApiName;
        const val = recordData[fieldApiName] ?? '';
        if (block.config?.showLabel !== false) {
          doc.fontSize(block.style?.fontSize || 12).text(`${label}: ${val}`);
        } else {
          doc.fontSize(block.style?.fontSize || 12).text(String(val));
        }
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
      case 'datatable': {
        const columns = block.config?.columns || [];
        const items = recordData[block.config?.inputName] || [];
        if (Array.isArray(items) && items.length > 0) {
          // header
          doc.fontSize(10).font('Helvetica-Bold');
          columns.forEach((c, i) => {
            doc.text(c.label || c.fieldApiName, { continued: i < columns.length - 1, width: 100 });
          });
          doc.font('Helvetica').moveDown(0.3);
          // rows
          items.forEach((item) => {
            columns.forEach((c, i) => {
              const v = item[c.fieldApiName] ?? '';
              doc.text(String(v), { continued: i < columns.length - 1, width: 100 });
            });
            doc.moveDown(0.3);
          });
        }
        break;
      }
      default:
        break;
    }
  }

  // Footer
  if (template.pageSettings?.footerHtml) {
    doc.moveDown(1);
    doc.fontSize(9).text(template.pageSettings.footerHtml.replace(/<[^>]*>/g, ''), { align: 'center' });
  }

  doc.end();

  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
};

export default { renderPdfTemplate };
