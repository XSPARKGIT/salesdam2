import nodemailer from 'nodemailer';
import mongoose from 'mongoose';
import logger from '../utils/logger.js';
import DynamicRecord from '../models/DynamicRecord.js';
import User from '../models/User.js';
import ObjectMeta from '../models/ObjectMeta.js';
import FieldMeta from '../models/FieldMeta.js';

class LeadApprovalService {
  async getSmtpTransporter() {
    if (
      process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.SMTP_SERVICE
    ) {
      return nodemailer.createTransport({
        service: process.env.SMTP_SERVICE,
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT || 587,
        secure: true,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    }

    if (process.env.NODE_ENV === 'development') {
      try {
        const testAccount = await nodemailer.createTestAccount();
        return nodemailer.createTransport({
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
          auth: {
            user: testAccount.user,
            pass: testAccount.pass,
          },
          tls: {
            rejectUnauthorized: false,
          },
        });
      } catch (err) {
        logger.warn(
          'Ethereal Email unavailable, emails will be logged to console',
        );
        return null;
      }
    }

    throw new Error('SMTP not configured');
  }

  async sendEmail(to, subject, htmlContent) {
    try {
      const transporter = await this.getSmtpTransporter();
      if (!transporter) {
        logger.info(`Email (dev console): To: ${to}, Subject: ${subject}`);
        logger.info(htmlContent);
        return;
      }

      const info = await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_FROM_EMAIL || 'noreply@salesdam.com',
        to,
        subject,
        html: htmlContent,
      });

      logger.info(`Email sent: ${info.messageId}`);
    } catch (error) {
      logger.error('Failed to send email:', error.message);
      throw error;
    }
  }

  async submitForApproval(tenantId, leadId, userId) {
    // Get the lead
    const lead = await DynamicRecord.findOne({
      _id: leadId,
      tenantId,
      objectApiName: 'lead',
      isDeleted: false,
    }).populate('ownerId', 'firstName lastName email manager');

    if (!lead) {
      throw new Error('Lead not found');
    }

    // Get the submitter (current user)
    const submitter = await User.findById(userId).populate(
      'manager',
      'firstName lastName email',
    );
    if (!submitter) {
      throw new Error('User not found');
    }

    if (!submitter.manager) {
      throw new Error(
        'You do not have a manager assigned. Please contact your administrator to assign a manager to your account before submitting leads for approval.',
      );
    }

    const manager = submitter.manager;
    const leadTitle =
      lead.getField('title') || lead.getField('first_name') || 'Lead';

    // Update lead with approval status and assigned approver
    lead.setField('approval_status', 'Submitted for Approval');
    lead.setField('assigned_approver', manager._id);
    await lead.save();

    // Send email to manager
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const leadUrl = `${appUrl}/o/lead/${leadId}`;

    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #244c64 0%, #2d5a7b 100%); color: #fff; padding: 20px; border-radius: 8px; text-align: center; }
            .content { padding: 20px 0; }
            .button {
              display: inline-block;
              background: linear-gradient(135deg, #244c64 0%, #2d5a7b 100%);
              color: #fff !important;
              padding: 14px 32px;
              border-radius: 6px;
              text-decoration: none;
              font-weight: bold;
              margin-top: 15px;
            }
            .footer { color: #666; font-size: 12px; margin-top: 20px; border-top: 1px solid #eee; padding-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>Lead Approval Request</h2>
            </div>
            <div class="content">
              <p>Hello ${manager.firstName},</p>
              <p>${submitter.firstName} ${submitter.lastName} has submitted the following lead for your approval:</p>
              <p><strong>${leadTitle}</strong></p>
              <p>Please review the lead details and approve or reject it.</p>
              <a href="${leadUrl}" class="button">Review Lead</a>
            </div>
            <div class="footer">
              <p>This is an automated message from Salesdam. Please do not reply to this email.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail(
      manager.email,
      `Lead Approval Request: ${leadTitle}`,
      emailHtml,
    );

    return lead;
  }

  async approveLead(tenantId, leadId, userId, clientId = null) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const lead = await DynamicRecord.findOne({
        _id: leadId,
        tenantId,
        objectApiName: 'lead',
        isDeleted: false,
      })
        .populate('ownerId', 'firstName lastName email')
        .session(session);

      if (!lead) {
        throw new Error('Lead not found');
      }

      const approver = await User.findById(
        userId,
        'firstName lastName email',
      ).session(session);
      const leadOwner = lead.ownerId;
      const leadTitle =
        lead.getField('title') || lead.getField('first_name') || 'Lead';

      // Convert lead to deal within transaction
      const deal = await this.convertLeadToDeal(
        tenantId,
        lead,
        approver,
        clientId,
        session,
      );

      // Update lead
      lead.setField('approval_status', 'Approved');
      lead.setField('is_converted', true);
      lead.setField('related_deal_id', deal._id);
      await lead.save({ session });

      // Send email to lead owner
      const appUrl = process.env.APP_URL || 'http://localhost:3000';
      const dealUrl = `${appUrl}/o/deal/${deal._id}`;

      const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #27ae60 0%, #229954 100%); color: #fff; padding: 20px; border-radius: 8px; text-align: center; }
            .content { padding: 20px 0; }
            .button {
              display: inline-block;
              background: linear-gradient(135deg, #27ae60 0%, #229954 100%);
              color: #fff !important;
              padding: 14px 32px;
              border-radius: 6px;
              text-decoration: none;
              font-weight: bold;
              margin-top: 15px;
            }
            .footer { color: #666; font-size: 12px; margin-top: 20px; border-top: 1px solid #eee; padding-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>Lead Approved</h2>
            </div>
            <div class="content">
              <p>Hello ${leadOwner.firstName},</p>
              <p>Your lead <strong>"${leadTitle}"</strong> has been approved and converted to a deal by ${approver.firstName} ${approver.lastName}.</p>
              <p>You can now view and manage the deal.</p>
              <a href="${dealUrl}" class="button">View Deal</a>
            </div>
            <div class="footer">
              <p>This is an automated message from Salesdam. Please do not reply to this email.</p>
            </div>
          </div>
        </body>
      </html>
    `;

      // Commit transaction
      await session.commitTransaction();

      // Send email after transaction commits
      await this.sendEmail(
        leadOwner.email,
        `Lead Approved: ${leadTitle}`,
        emailHtml,
      );

      return { lead, deal };
    } catch (err) {
      // Abort transaction on any error
      await session.abortTransaction();
      throw err;
    } finally {
      // End the session
      session.endSession();
    }
  }

  async rejectLead(tenantId, leadId, userId, reason = '') {
    const lead = await DynamicRecord.findOne({
      _id: leadId,
      tenantId,
      objectApiName: 'lead',
      isDeleted: false,
    }).populate('ownerId', 'firstName lastName email');

    if (!lead) {
      throw new Error('Lead not found');
    }

    const approver = await User.findById(userId, 'firstName lastName email');
    const leadOwner = lead.ownerId;
    const leadTitle =
      lead.getField('title') || lead.getField('first_name') || 'Lead';

    // Update lead
    lead.setField('approval_status', 'Rejected');
    lead.setField('rejection_reason', reason);
    await lead.save();

    // Send email to lead owner
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const leadUrl = `${appUrl}/o/lead/${leadId}`;

    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%); color: #fff; padding: 20px; border-radius: 8px; text-align: center; }
            .content { padding: 20px 0; }
            .button {
              display: inline-block;
              background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
              color: #fff !important;
              padding: 14px 32px;
              border-radius: 6px;
              text-decoration: none;
              font-weight: bold;
              margin-top: 15px;
            }
            .footer { color: #666; font-size: 12px; margin-top: 20px; border-top: 1px solid #eee; padding-top: 20px; }
            .reason { background: #f5f5f5; padding: 15px; border-left: 4px solid #e74c3c; margin-top: 15px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>Lead Rejected</h2>
            </div>
            <div class="content">
              <p>Hello ${leadOwner.firstName},</p>
              <p>Your lead <strong>"${leadTitle}"</strong> has been rejected by ${approver.firstName} ${approver.lastName}.</p>
              ${reason ? `<div class="reason"><strong>Reason:</strong> ${reason}</div>` : ''}
              <p>You can view the lead details and make updates if needed.</p>
              <a href="${leadUrl}" class="button">View Lead</a>
            </div>
            <div class="footer">
              <p>This is an automated message from Salesdam. Please do not reply to this email.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail(
      leadOwner.email,
      `Lead Rejected: ${leadTitle}`,
      emailHtml,
    );

    return lead;
  }

  async convertLeadToDeal(
    tenantId,
    lead,
    approver,
    clientId = null,
    session = null,
  ) {
    // Get deal object metadata
    const dealObjMeta = await ObjectMeta.findOne({
      tenantId,
      apiName: 'deal',
    }).session(session);
    if (!dealObjMeta) {
      throw new Error('Deal object not configured');
    }

    // Manually map lead fields to deal fields
    const dealData = {
      // Deal Information
      name:
        `${lead.getField('client') || ''}${lead.getField('product_name') ? ` - ${lead.getField('product_name')}` : ''}`.trim() ||
        `${lead.getField('first_name') || ''} ${lead.getField('last_name') || ''}`.trim(),
      sales_rep: lead.getField('sales_rep'),
      currency: 'ZAR',
      stage: 'work_in_progress',

      // RFQ Details
      rfq_number: lead.getField('rfq_number'),
      project_code: lead.getField('rfq_number'),
      cidb_number: lead.getField('cidb_number'),
      product_type: lead.getField('product_type'),
      technical_scope: lead.getField('technical_scope'),
      end_user: lead.getField('end_user'),
      closing_date: lead.getField('closing_date'),
      quote_validity: lead.getField('quote_validity_period'),
      quote_submission_location: lead.getField('quote_submission_location'),
      compulsory_briefing: lead.getField('compulsory_briefing'),
      briefing_date_time: lead.getField('briefing_date_time'),
      briefing_address: lead.getField('briefing_address'),

      // Product Details
      product_name: lead.getField('product_name'),
      product_description: lead.getField('product_description'),

      // Associated Contact
      first_name: lead.getField('first_name'),
      last_name: lead.getField('last_name'),
      industry: lead.getField('industry'),
      email: lead.getField('email'),
      phone: lead.getField('phone'),
      website: lead.getField('website'),
    };

    // Remove undefined/null values
    Object.keys(dealData).forEach((key) => {
      if (
        dealData[key] === null ||
        dealData[key] === undefined ||
        dealData[key] === ''
      ) {
        delete dealData[key];
      }
    });

    // Link to account if provided
    if (clientId) {
      dealData.client = clientId;
    }

    // Link to lead
    dealData.converted_lead = lead._id;

    const deal = new DynamicRecord({
      tenantId,
      objectId: dealObjMeta._id,
      objectApiName: 'deal',
      ownerId: lead.ownerId,
      createdBy: approver._id,
      lastModifiedBy: approver._id,
    });

    // Set all deal fields
    Object.entries(dealData).forEach(([key, value]) => {
      deal.setField(key, value);
    });

    await deal.save({ session });

    // Copy support documents from lead to deal
    await this.copySupportDocuments(
      tenantId,
      lead._id,
      deal._id,
      approver._id,
      session,
    );

    return deal;
  }

  async convertTenderToDeal(
    tenantId,
    tender,
    user,
    clientId,
    supportDocuments = [],
    session = null,
  ) {
    // Get deal object metadata
    const dealObjMeta = await ObjectMeta.findOne({
      tenantId,
      apiName: 'deal',
    }).session(session);
    if (!dealObjMeta) {
      throw new Error('Deal object not configured');
    }

    const contactName = tender.contactPerson || '';
    const nameParts = contactName.split(' ').filter(Boolean);
    const firstName = nameParts[0] || 'Tender';
    const lastName =
      nameParts.length > 1
        ? nameParts.slice(1).join(' ')
        : tender.tenderNumber || 'Deal';

    // Map tender fields directly to deal fields (mirrors saveTenderAsLead + convertLeadToDeal combined)
    const dealData = {
      name:
        `${tender.client || tender.department || ''}${tender.title ? ` - ${tender.title}` : ''}`.trim() ||
        `${firstName} ${lastName}`.trim(),
      sales_rep: user._id,
      currency: 'ZAR',
      stage: 'work_in_progress',

      rfq_number: tender.tenderNumber,
      project_code: tender.tenderNumber,
      technical_scope: tender.description || tender.conditions,
      closing_date: tender.closingDate,
      quote_validity: tender.validity ? parseInt(tender.validity) : undefined,

      product_description: tender.title,

      first_name: firstName,
      last_name: lastName,
      email: tender.email,
      phone: tender.telephone,
    };

    if (
      tender.briefingCompulsory !== undefined &&
      tender.briefingCompulsory !== null
    ) {
      dealData.compulsory_briefing = tender.briefingCompulsory ? 'yes' : 'no';
    }

    if (tender.briefingDate) {
      dealData.briefing_date_time = tender.briefingDate;
    }

    const briefingAddressParts = [
      tender.briefingVenue,
      tender.streetName,
      tender.suburb,
      tender.town,
      tender.code,
    ].filter(Boolean);
    if (briefingAddressParts.length > 0) {
      dealData.briefing_address = briefingAddressParts.join(', ');
    }

    // Remove undefined/null/empty values
    Object.keys(dealData).forEach((key) => {
      if (
        dealData[key] === null ||
        dealData[key] === undefined ||
        dealData[key] === ''
      ) {
        delete dealData[key];
      }
    });

    if (clientId) {
      dealData.client = clientId;
    }

    const deal = new DynamicRecord({
      tenantId,
      objectId: dealObjMeta._id,
      objectApiName: 'deal',
      ownerId: user._id,
      createdBy: user._id,
      lastModifiedBy: user._id,
    });

    Object.entries(dealData).forEach(([key, value]) => {
      deal.setField(key, value);
    });

    await deal.save({ session });

    // Save support documents directly against the deal (no lead to copy from)
    if (supportDocuments && supportDocuments.length > 0) {
      const supportDocObjMeta = await ObjectMeta.findOne({
        tenantId,
        apiName: 'support_document',
      }).session(session);

      if (supportDocObjMeta) {
        const dealId = deal._id.toString();

        const docSavePromises = supportDocuments.map((doc) =>
          DynamicRecord.create(
            [
              {
                tenantId,
                objectId: supportDocObjMeta._id,
                objectApiName: 'support_document',
                ownerId: user._id,
                createdBy: user._id,
                lastModifiedBy: user._id,
              },
            ],
            { session },
          ).then((docRecords) => {
            const docRecord = docRecords[0];
            docRecord.setField('document_name', doc.fileName || '');
            docRecord.setField('document_type', doc.extension || '');
            docRecord.setField('document_url', doc.url || '');
            docRecord.setField('file_format', doc.extension || '');
            docRecord.setField(
              'date_published',
              doc.datePublished || new Date().toISOString(),
            );
            docRecord.setField(
              'date_modified',
              doc.dateModified || new Date().toISOString(),
            );
            docRecord.setField('deal_id', dealId);
            return docRecord.save({ session });
          }),
        );

        await Promise.all(docSavePromises);
      } else {
        logger.warn('Support Document object not configured');
      }
    }

    return deal;
  }

  async copySupportDocuments(tenantId, leadId, dealId, userId, session = null) {
    try {
      // Get support document object metadata
      const supportDocObjMeta = await ObjectMeta.findOne({
        tenantId,
        apiName: 'support_document',
      }).session(session);
      if (!supportDocObjMeta) {
        logger.warn('Support Document object not configured');
        return;
      }

      // Find all support documents linked to the lead (check both ObjectId and string representation)
      const leadDocs = await DynamicRecord.find({
        tenantId,
        objectApiName: 'support_document',
        isDeleted: false,
        $or: [
          { 'data.lead_id': leadId },
          { 'data.lead_id': leadId.toString() },
        ],
      }).session(session);

      logger.info(
        `Found ${leadDocs.length} support documents for lead ${leadId}`,
      );

      // Copy each support document to the deal
      for (const leadDoc of leadDocs) {
        const newDoc = new DynamicRecord({
          tenantId,
          objectId: supportDocObjMeta._id,
          objectApiName: 'support_document',
          ownerId: userId,
          createdBy: userId,
          lastModifiedBy: userId,
        });

        // Copy all fields from lead document
        const docData = leadDoc.toDataObject();
        const fieldsToSkip = [
          'lead_id',
          'deal_id',
          'id',
          'createdAt',
          'updatedAt',
          'createdBy',
          'ownerId',
          'objectApiName',
          'objectId',
        ];

        Object.entries(docData).forEach(([key, value]) => {
          if (
            !fieldsToSkip.includes(key) &&
            value !== null &&
            value !== undefined
          ) {
            newDoc.setField(key, value);
          }
        });

        // Link to the deal
        newDoc.setField('deal_id', dealId.toString());
        // Explicitly set lead_id to null
        newDoc.setField('lead_id', null);

        await newDoc.save({ session });
        logger.info(`Copied support document ${leadDoc._id} to deal ${dealId}`);
      }

      logger.info(
        `Successfully copied ${leadDocs.length} support documents from lead ${leadId} to deal ${dealId}`,
      );
    } catch (error) {
      logger.error(`Error copying support documents: ${error.message}`);
      throw error;
    }
  }
}

export default new LeadApprovalService();
