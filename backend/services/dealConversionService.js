import DynamicRecord from '../models/DynamicRecord.js';
import FieldMeta from '../models/FieldMeta.js';
import AutoNumberCounter from '../models/AutoNumberCounter.js';
import ObjectMeta from '../models/ObjectMeta.js';
import { buildSearchText } from './searchService.js';
import { applyAutoNumbers } from './autoNumberService.js';
import { computeAndSetFormulaValues } from './formulaService.js';
import { setRollupValuesOnRecord } from './rollupService.js';
import dealConversionEmailService from './dealConversionEmailService.js';
import logger from '../utils/logger.js';

/**
 * Convert a Deal to an Order. Runs from the "Convert to Order" action (BRD
 * 4.4); which deals qualify (e.g. Stage = Closed Won) is that action's
 * configured condition, checked before this is called.
 * - Creates a new Order record with mapped fields from the deal
 * - Copies all Deal Line Items to Order Line Items
 * - Sets the deal's is_converted and converted_date fields
 */
export const convertDealToOrder = async (
  dealRecord,
  tenantId,
  userId,
  session,
) => {
  try {
    // Check if deal is already converted
    if (dealRecord.getField('is_converted')) {
      logger.warn(
        `Deal ${dealRecord._id} is already converted, skipping conversion`,
      );
      return null;
    }

    // ── Fetch Order object metadata ──────────────────────────────────────────
    const orderObj = await ObjectMeta.findOne({
      tenantId,
      apiName: 'order',
    }).session(session);

    if (!orderObj) {
      throw new Error('Order object not found');
    }

    // Fetch all fields for Order and Deal Line Item objects
    const [orderFields, dealLineItemFields, orderLineItemFields] =
      await Promise.all([
        FieldMeta.find({ tenantId, objectApiName: 'order' }).session(session),
        FieldMeta.find({ tenantId, objectApiName: 'deal_line_item' }).session(
          session,
        ),
        FieldMeta.find({ tenantId, objectApiName: 'order_line_item' }).session(
          session,
        ),
      ]);

    // ── Create the Order ─────────────────────────────────────────────────────
    const order = new DynamicRecord({
      tenantId,
      objectId: orderObj._id,
      objectApiName: 'order',
      ownerId: dealRecord.ownerId,
      createdBy: userId,
      lastModifiedBy: userId,
    });

    // Map deal fields to order fields.
    //
    // `order_value` (Selling Price) is deliberately not mapped: on the Order it
    // is a formula over the order line items' rollup, so it is derived from the
    // line items copied below rather than carried across from the deal.
    const fieldMapping = {
      name: 'name', // Use deal name as order name
      project_code: 'project_code',
      end_user: 'end_user',
      product_name: 'product_name',
      client: 'client',
      sales_rep: 'sales_rep',
    };

    Object.entries(fieldMapping).forEach(([dealField, orderField]) => {
      const value = dealRecord.getField(dealField);
      if (value !== undefined && value !== null) {
        order.setField(orderField, value);
      }
    });

    // Link back to the source deal (store as string for consistency with lookup fields)
    order.setField('converted_deal', dealRecord._id.toString());

    // Set order date to today
    order.setField('order_date', new Date());

    // Set default payment status if not provided
    if (!order.getField('payment_status')) {
      order.setField('payment_status', 'pending');
    }

    // Generate auto-number fields (order_number and any others on the object)
    await applyAutoNumbers(order, orderFields, tenantId, 'order');

    // Compute formula fields
    await computeAndSetFormulaValues(order, orderFields);

    // Build search text
    order._searchText = await buildSearchText(order, orderFields);

    // Save the order
    await order.save({ session });

    // ── Copy Deal Line Items to Order Line Items ─────────────────────────────
    const dealLineItems = await DynamicRecord.find({
      tenantId,
      objectApiName: 'deal_line_item',
      isDeleted: false,
      $or: [
        { 'data.deal': dealRecord._id },
        { 'data.deal': dealRecord._id.toString() },
      ],
    }).session(session);

    logger.info(
      `Converting ${dealLineItems.length} deal line items to order line items`,
    );

    // Get order line item object
    const orderLineItemObj = await ObjectMeta.findOne({
      tenantId,
      apiName: 'order_line_item',
    }).session(session);

    for (const dealLineItem of dealLineItems) {
      const orderLineItem = new DynamicRecord({
        tenantId,
        objectId: orderLineItemObj._id,
        objectApiName: 'order_line_item',
        ownerId: dealLineItem.ownerId,
        createdBy: userId,
        lastModifiedBy: userId,
      });

      // Map deal line item fields to order line item
      const lineItemFieldMapping = {
        product: 'product',
        quantity: 'quantity',
        unit_price: 'unit_price',
        markup_percent: 'markup_percent',
      };

      Object.entries(lineItemFieldMapping).forEach(([fromField, toField]) => {
        const value = dealLineItem.getField(fromField);
        if (value !== undefined && value !== null) {
          orderLineItem.setField(toField, value);
        }
      });

      // Link to the newly created order (store as string for consistency with lookup fields)
      orderLineItem.setField('order', order._id.toString());

      // Compute formula fields for order line item
      await computeAndSetFormulaValues(orderLineItem, orderLineItemFields);

      // Build search text
      orderLineItem._searchText = await buildSearchText(
        orderLineItem,
        orderLineItemFields,
      );

      await orderLineItem.save({ session });
    }

    // ── Roll the copied line items up onto the Order ──────────────────────────
    // The line items above are written straight to the collection, so the
    // record API's rollup trigger never fires for them. Recompute here (inside
    // the transaction) or the Order's Selling Price would stay at zero until
    // something else touched a line item.
    if (dealLineItems.length > 0) {
      await setRollupValuesOnRecord(tenantId, order, orderFields, { session });
      await computeAndSetFormulaValues(order, orderFields);
      order._searchText = await buildSearchText(order, orderFields);
      await order.save({ session });
    }

    // ── Update Deal with conversion info ─────────────────────────────────────
    dealRecord.setField('is_converted', true);
    dealRecord.setField('converted_date', new Date());
    dealRecord.setField('converted_order', order._id.toString()); // Store as string for consistency with lookup fields
    dealRecord.lastModifiedBy = userId;

    // Fetch deal fields for search text
    const dealFields = await FieldMeta.find({
      tenantId,
      objectApiName: 'deal',
    }).session(session);

    dealRecord._searchText = await buildSearchText(dealRecord, dealFields);

    await dealRecord.save({ session });

    logger.info(
      `Successfully converted deal ${dealRecord._id} to order ${order._id}`,
    );

    // Send notifications (non-blocking — don't let email failures block the conversion)
    dealConversionEmailService
      .sendDealConversionEmails(dealRecord, order, tenantId)
      .catch((err) => {
        logger.error('Error sending deal conversion emails:', err);
      });

    return order;
  } catch (error) {
    logger.error('Error converting deal to order:', error);
    throw error;
  }
};
