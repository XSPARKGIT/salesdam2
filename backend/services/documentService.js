import DynamicRecord from '../models/DynamicRecord.js';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';
import logger from '../utils/logger.js';
import { ValidationError } from '../utils/errors.js';
import { applyAutoNumbers } from './autoNumberService.js';
import { buildSearchText } from './searchService.js';

/**
 * Document Service - Handles generation of Quotes and Invoices
 */

/**
 * Validate that required quote settings are configured
 */
const validateQuoteSettings = (settings) => {
  const errors = [];
  if (!settings.companyName) {
    errors.push('Company name is not configured. Please update Invoice & Quote settings.');
  }
  if (!settings.quotePrefix && !settings.quoteNumberingFormat) {
    errors.push('Quote numbering format is not configured. Please update Invoice & Quote settings.');
  }
  if (errors.length > 0) {
    throw new ValidationError(errors);
  }
};

/**
 * Validate that required invoice settings are configured
 */
const validateInvoiceSettings = (settings) => {
  const errors = [];
  if (!settings.companyName) {
    errors.push('Company name is not configured. Please update Invoice & Quote settings.');
  }
  if (!settings.invoicePrefix && !settings.invoiceNumberingFormat) {
    errors.push('Invoice numbering format is not configured. Please update Invoice & Quote settings.');
  }
  if (errors.length > 0) {
    throw new ValidationError(errors);
  }
};

/**
 * Generate a quote from a deal
 */
export const generateQuote = async (tenantId, dealId, userId) => {
  try {
    const [deal, quoteObjectMeta, tenant, user] = await Promise.all([
      DynamicRecord.findOne({
        _id: dealId,
        tenantId,
        objectApiName: 'deal',
        isDeleted: false,
      })
        .populate('createdBy', 'firstName lastName')
        .populate('lastModifiedBy', 'firstName lastName'),
      ObjectMeta.findOne({
        tenantId,
        apiName: 'quote',
      }),
      (async () => {
        const Tenant = (await import('../models/Tenant.js')).default;
        return Tenant.findById(tenantId);
      })(),
      (async () => {
        const User = (await import('../models/User.js')).default;
        return User.findById(userId).select('firstName lastName');
      })(),
    ]);

    if (!deal) throw new Error('Deal not found');
    if (!quoteObjectMeta) throw new Error('Quote object not found');

    // Validate quote settings
    const quoteSettings = tenant?.invoiceQuoteSettings || {};
    validateQuoteSettings(quoteSettings);

    // Fetch deal line items
    const lineItems = await DynamicRecord.find({
      tenantId,
      objectApiName: 'deal_line_item',
      'data.deal': dealId,
      isDeleted: false,
    });

    // Get deal client (account)
    const clientId = deal.data.get('client');
    const client = clientId
      ? await DynamicRecord.findOne({
          _id: clientId,
          tenantId,
          objectApiName: 'client',
          isDeleted: false,
        })
      : null;

    // Calculate totals
    let subTotal = 0;
    lineItems.forEach((item) => {
      const subtotal = item.data.get('subtotal') || 0;
      subTotal += subtotal;
    });

    const discountPercent = deal.data.get('discount_percent') || 0;
    const discountAmount = (subTotal * discountPercent) / 100;
    const taxAmount = (subTotal - discountAmount) * 0.15; // Assuming 15% tax
    const total = subTotal - discountAmount + taxAmount;

    // Build the quote record, then generate quote_number from the field's
    // auto-number rules before saving. This path bypasses the record API, so it
    // has to do the generation itself.
    const quoteFields = await FieldMeta.find({ tenantId, objectApiName: 'quote' });

    const userFullName = user ? `${user.firstName} ${user.lastName}`.trim() : '';

    const quote = new DynamicRecord({
      tenantId,
      objectId: quoteObjectMeta._id,
      objectApiName: 'quote',
      data: new Map([
        ['deal', dealId],
        ['quote_date', new Date()],
        ['client', clientId],
        ['sub_total', subTotal],
        ['discount_amount', discountAmount],
        ['tax_amount', taxAmount],
        ['total', total],
        ['client_name', userFullName],
      ]),
      ownerId: userId,
      createdBy: userId,
      lastModifiedBy: userId,
    });

    await applyAutoNumbers(quote, quoteFields, tenantId, 'quote');
    quote._searchText = await buildSearchText(quote, quoteFields);
    await quote.save();

    // Persist generated document as a File attached to the originating deal
    try {
      const File = (await import('../models/File.js')).default;
      await File.create({
        tenantId,
        createdBy: userId,
        lastModifiedBy: userId,
        name: `quote-${quote._id}.json`,
        mimeType: 'application/json',
        data: JSON.stringify({ id: quote._id, ...quote.toDataObject() }),
        sizeBytes: 0,
        relatedTo: { objectApiName: 'deal', recordId: dealId },
        scanStatus: 'skipped',
        scanResult: 'Generated document',
        isAvailable: true,
        version: 1,
      });
    } catch (e) {
      // Non-blocking: document generation should not fail if file save fails
    }

    // Populate product information for each line item
    const lineItemsWithProducts = await Promise.all(
      lineItems.map(async (li) => {
        const productId = li.data.get('product');
        const product = productId
          ? await DynamicRecord.findOne({
              _id: productId,
              tenantId,
              objectApiName: 'product',
              isDeleted: false,
            })
          : null;

        return {
          ...li.toDataObject(),
          product_name: product ? product.data.get('name') : 'Product',
        };
      })
    );

    return {
      id: quote._id,
      ...quote.toDataObject(),
      objectApiName: 'quote',
      client: client ? client.toDataObject() : null,
      lineItems: lineItemsWithProducts,
      settings: tenant?.invoiceQuoteSettings || {},
    };
  } catch (error) {
    logger.error('Error generating quote:', error);
    throw error;
  }
};

/**
 * Generate an invoice from an order
 */
export const generateInvoice = async (tenantId, orderId, userId) => {
  try {
    const [order, invoiceObjectMeta, tenant, user] = await Promise.all([
      DynamicRecord.findOne({
        _id: orderId,
        tenantId,
        objectApiName: 'order',
        isDeleted: false,
      })
        .populate('createdBy', 'firstName lastName')
        .populate('lastModifiedBy', 'firstName lastName'),
      ObjectMeta.findOne({
        tenantId,
        apiName: 'invoice',
      }),
      (async () => {
        const Tenant = (await import('../models/Tenant.js')).default;
        return Tenant.findById(tenantId);
      })(),
      (async () => {
        const User = (await import('../models/User.js')).default;
        return User.findById(userId).select('firstName lastName');
      })(),
    ]);

    if (!order) throw new Error('Order not found');
    if (!invoiceObjectMeta) throw new Error('Invoice object not found');

    // Validate invoice settings
    const invoiceSettings = tenant?.invoiceQuoteSettings || {};
    validateInvoiceSettings(invoiceSettings);

    // Fetch order line items
    const lineItems = await DynamicRecord.find({
      tenantId,
      objectApiName: 'order_line_item',
      'data.order': orderId,
      isDeleted: false,
    });

    // Get order client (account)
    const clientId = order.data.get('client');
    const client = clientId
      ? await DynamicRecord.findOne({
          _id: clientId,
          tenantId,
          objectApiName: 'client',
          isDeleted: false,
        })
      : null;

    // Calculate totals
    let subTotal = 0;
    lineItems.forEach((item) => {
      const subtotal = item.data.get('subtotal') || 0;
      subTotal += subtotal;
    });

    const taxAmount = subTotal * 0.15; // Assuming 15% tax
    const total = subTotal + taxAmount;

    // Build the invoice record, then generate invoice_number from the field's
    // auto-number rules before saving. This path bypasses the record API, so it
    // has to do the generation itself.
    const invoiceFields = await FieldMeta.find({
      tenantId,
      objectApiName: 'invoice',
    });

    const userFullName = user ? `${user.firstName} ${user.lastName}`.trim() : '';

    const invoice = new DynamicRecord({
      tenantId,
      objectId: invoiceObjectMeta._id,
      objectApiName: 'invoice',
      data: new Map([
        ['invoice_date', new Date()],
        ['order', orderId],
        ['client', clientId],
        ['sub_total', subTotal],
        ['tax_amount', taxAmount],
        ['total', total],
        ['payment_due_date', new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)], // 30 days
        ['client_name', userFullName],
      ]),
      ownerId: userId,
      createdBy: userId,
      lastModifiedBy: userId,
    });

    await applyAutoNumbers(invoice, invoiceFields, tenantId, 'invoice');
    invoice._searchText = await buildSearchText(invoice, invoiceFields);
    await invoice.save();

    // Persist generated document as a File attached to the originating order
    try {
      const File = (await import('../models/File.js')).default;
      await File.create({
        tenantId,
        createdBy: userId,
        lastModifiedBy: userId,
        name: `invoice-${invoice._id}.json`,
        mimeType: 'application/json',
        data: JSON.stringify({ id: invoice._id, ...invoice.toDataObject() }),
        sizeBytes: 0,
        relatedTo: { objectApiName: 'order', recordId: orderId },
        scanStatus: 'skipped',
        scanResult: 'Generated document',
        isAvailable: true,
        version: 1,
      });
    } catch (e) {
      // Non-blocking
    }

    // Populate product information for each line item
    const lineItemsWithProducts = await Promise.all(
      lineItems.map(async (li) => {
        const productId = li.data.get('product');
        const product = productId
          ? await DynamicRecord.findOne({
              _id: productId,
              tenantId,
              objectApiName: 'product',
              isDeleted: false,
            })
          : null;

        return {
          ...li.toDataObject(),
          product_name: product ? product.data.get('name') : 'Product',
        };
      })
    );

    return {
      id: invoice._id,
      ...invoice.toDataObject(),
      objectApiName: 'invoice',
      client: client ? client.toDataObject() : null,
      lineItems: lineItemsWithProducts,
      settings: tenant?.invoiceQuoteSettings || {},
    };
  } catch (error) {
    logger.error('Error generating invoice:', error);
    throw error;
  }
};

/**
 * Get quote details with related data for PDF rendering
 */
export const getQuoteDetails = async (tenantId, quoteId) => {
  try {
    const [quote, tenant] = await Promise.all([
      DynamicRecord.findOne({
        _id: quoteId,
        tenantId,
        objectApiName: 'quote',
        isDeleted: false,
      }),
      (async () => {
        const Tenant = (await import('../models/Tenant.js')).default;
        return Tenant.findById(tenantId);
      })(),
    ]);

    if (!quote) throw new Error('Quote not found');

    const dealId = quote.data.get('deal');
    const clientId = quote.data.get('client');

    const [deal, client, lineItems] = await Promise.all([
      dealId
        ? DynamicRecord.findOne({
            _id: dealId,
            tenantId,
            objectApiName: 'deal',
            isDeleted: false,
          })
        : null,
      clientId
        ? DynamicRecord.findOne({
            _id: clientId,
            tenantId,
            objectApiName: 'client',
            isDeleted: false,
          })
        : null,
      DynamicRecord.find({
        tenantId,
        objectApiName: 'deal_line_item',
        'data.deal': dealId,
        isDeleted: false,
      }),
    ]);

    const quoteObj = quote.toDataObject();
    const clientObj = client ? client.toDataObject() : null;
    const lineItemsArray = lineItems.map((li) => li.toDataObject());

    return {
      ...quoteObj,
      objectApiName: 'quote',
      client: clientObj,
      lineItems: lineItemsArray,
      settings: tenant?.invoiceQuoteSettings || {},
    };
  } catch (error) {
    logger.error('Error fetching quote details:', error);
    throw error;
  }
};

/**
 * Get invoice details with related data for PDF rendering
 */
export const getInvoiceDetails = async (tenantId, invoiceId) => {
  try {
    const [invoice, tenant] = await Promise.all([
      DynamicRecord.findOne({
        _id: invoiceId,
        tenantId,
        objectApiName: 'invoice',
        isDeleted: false,
      }),
      (async () => {
        const Tenant = (await import('../models/Tenant.js')).default;
        return Tenant.findById(tenantId);
      })(),
    ]);

    if (!invoice) throw new Error('Invoice not found');

    const orderId = invoice.data.get('order');
    const clientId = invoice.data.get('client');

    const [order, client, lineItems] = await Promise.all([
      orderId
        ? DynamicRecord.findOne({
            _id: orderId,
            tenantId,
            objectApiName: 'order',
            isDeleted: false,
          })
        : null,
      clientId
        ? DynamicRecord.findOne({
            _id: clientId,
            tenantId,
            objectApiName: 'client',
            isDeleted: false,
          })
        : null,
      DynamicRecord.find({
        tenantId,
        objectApiName: 'order_line_item',
        'data.order': orderId,
        isDeleted: false,
      }),
    ]);

    const invoiceObj = invoice.toDataObject();
    const clientObj = client ? client.toDataObject() : null;
    const lineItemsArray = lineItems.map((li) => li.toDataObject());

    return {
      ...invoiceObj,
      objectApiName: 'invoice',
      client: clientObj,
      lineItems: lineItemsArray,
      settings: tenant?.invoiceQuoteSettings || {},
    };
  } catch (error) {
    logger.error('Error fetching invoice details:', error);
    throw error;
  }
};

export default {
  generateQuote,
  generateInvoice,
  getQuoteDetails,
  getInvoiceDetails,
};
