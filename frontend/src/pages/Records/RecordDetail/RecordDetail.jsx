import styles from './RecordDetail.module.css';
import { useEffect, useState } from 'react';
import { evaluateVisibilityRule } from '../../../utils/evaluateVisibilityRule';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../../../services/api';
import { useTenantContext } from '../../../context/TenantContext';
import Layout from '../../../layout/Layout';
import { useObjectPermissions } from '../../../hooks/useObjectPermissions';
import { generateInvoicePDF } from '../../../utils/generateInvoicePDF';
import {
  getRecordDetailBundle,
  getCustomScreens,
  getScreenFlows,
  getRelatedObjects,
} from '../../../services/api/objects';
import { getRecords } from '../../../services/api/records';
import { getApprovalState } from '../../../services/api/approvals';
import RecordHeader from './RecordHeader/RecordHeader';
import RecordTabs from './RecordTabs/RecordTabs';
import ApprovalPanel from '../../../components/records/ApprovalPanel/ApprovalPanel';
import PolicyServicingPanel from '../../../components/insurance/PolicyServicingPanel/PolicyServicingPanel';
import RecordContent from './RecordContent/RecordContent';
import RecordSystemInfo from './RecordSystemInfo/RecordSystemInfo';
import RecordModals from './RecordModals/RecordModals';
import RecordDetailSkeleton from './RecordDetailSkeleton';
import RelatedList from '../../../components/records/RelatedList/RelatedList';
import AttachmentsPanel from '../../../components/records/AttachmentsPanel';
import CommunicationPanel from '../../../components/records/CommunicationPanel';
import FieldHistoryTab from './FieldHistoryTab/FieldHistoryTab';
import resolveLookupLabel from '../utils/resolveLookupLabel';
import { withoutHelperFields } from '../../../utils/fieldVisibility';

const RecordDetail = () => {
  const queryClient = useQueryClient();
  const { objectApiName, id } = useParams();
  const navigate = useNavigate();
  const { getObject } = useTenantContext();
  // Use context for nav/label convenience, but fetch fresh for flag checks
  // (enableHistory etc.) so stale context doesn't hide newly-enabled features.
  const objMetaCtx = getObject(objectApiName);
  const { data: objMetaFresh } = useQuery({
    queryKey: ['object', objectApiName],
    queryFn: async () => {
      const res = await api.get(`/objects/${objectApiName}`);
      return res.data.data;
    },
    enabled: !!objectApiName,
    staleTime: 30_000,
  });
  const objMeta = objMetaFresh || objMetaCtx;
  const perms = useObjectPermissions(objectApiName);

  const [lookupLabels, setLookupLabels] = useState({});
  const [activeTab, setActiveTab] = useState('details');
  const [runningFlow, setRunningFlow] = useState(null);
  const [generatingQuote, setGeneratingQuote] = useState(false);
  const [generatingInvoice, setGeneratingInvoice] = useState(false);
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfFileName, setPdfFileName] = useState('document');
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [quoteConfirmOpen, setQuoteConfirmOpen] = useState(false);
  const [invoiceConfirmOpen, setInvoiceConfirmOpen] = useState(false);
  const [quoteNoLineItemsOpen, setQuoteNoLineItemsOpen] = useState(false);
  const [invoiceNoLineItemsOpen, setInvoiceNoLineItemsOpen] = useState(false);
  const [quoteValidationErrors, setQuoteValidationErrors] = useState([]);
  const [invoiceValidationErrors, setInvoiceValidationErrors] = useState([]);

  const { data: bundle, isLoading: loading } = useQuery({
    queryKey: ['record-detail', objectApiName, id],
    queryFn: () => getRecordDetailBundle(objectApiName, id),
    enabled: !!objectApiName && !!id,
  });

  const { data: approvalState } = useQuery({
    queryKey: ['approval-state', objectApiName, id],
    queryFn: () => getApprovalState(objectApiName, id),
    enabled: !!objectApiName && !!id,
    staleTime: 0,
  });
  const isApprovalLocked = approvalState?.request?.status === 'pending' && approvalState?.request?.locked === true;

  const { data: approvalInfo } = useQuery({
    queryKey: ['lead-approval-info', objectApiName, id],
    queryFn: async () => {
      if (objectApiName === 'lead') {
        return api.get(`/leads/${id}/approval-info`).then(res => res.data?.data);
      }
      return null;
    },
    enabled: !!objectApiName && !!id && objectApiName === 'lead',
  });

  const { data: leadApprovalSettings } = useQuery({
    queryKey: ['lead-approval-settings'],
    queryFn: async () => {
      return api.get('/admin/settings/lead-approval-settings').then(res => res.data?.data);
    },
    enabled: objectApiName === 'lead',
    staleTime: 1000 * 60 * 5,
  });

  const record = bundle?.record;
  const fields = bundle?.fields || [];
  const layout = bundle?.layout;

  const { data: customScreens = [] } = useQuery({
    queryKey: ['custom-screens', objectApiName],
    queryFn: () => getCustomScreens(objectApiName),
    enabled: !!objectApiName,
  });

  const { data: embeddedFlows = [] } = useQuery({
    queryKey: ['screen-flows', objectApiName],
    queryFn: () => getScreenFlows(objectApiName),
    enabled: !!objectApiName,
  });

  const { data: relatedObjects = [] } = useQuery({
    queryKey: ['related-objects', objectApiName],
    queryFn: () => getRelatedObjects(objectApiName),
    enabled: !!objectApiName,
  });

  useEffect(() => {
    const resolveLookups = async () => {
      if (!record || !fields.length) return;

      const lookupFields = fields.filter(
        (f) =>
          (f.type === 'lookup' || f.type === 'master_detail') &&
          record[f.apiName],
      );

      if (lookupFields.length === 0) return;

      const resolved = await Promise.all(
        lookupFields.map(async (f) => ({
          apiName: f.apiName,
          resolved: await resolveLookupLabel(f, record[f.apiName]),
        })),
      );

      const map = {};
      resolved.forEach(({ apiName, resolved }) => {
        if (resolved) map[apiName] = resolved;
      });

      setLookupLabels(map);
    };

    resolveLookups();
  }, [record, fields]);

  const handleDelete = () => {
    setDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/records/${objectApiName}/${id}`);
      toast.success('Record deleted.');
      setDeleteModalOpen(false);
      // The list only refetches on an invalidation, so the deleted row would
      // otherwise still be there when we land back on it.
      queryClient.invalidateQueries({ queryKey: ['records', objectApiName] });
      queryClient.removeQueries({
        queryKey: ['record-detail', objectApiName, id],
      });
      navigate(`/o/${objectApiName}`);
    } catch (err) {
      const errMessage =
        err.response?.data?.message ||
        err.message ||
        'Failed to delete record.';
      toast.error(errMessage);
      setDeleting(false);
    }
  };

  const checkDealLineItems = async () => {
    try {
      const lineItems = await getRecords('deal_line_item', { filter: JSON.stringify({ deal: id }), limit: 1 });
      return lineItems && lineItems.length > 0;
    } catch {
      return false;
    }
  };

  const checkOrderLineItems = async () => {
    try {
      const lineItems = await getRecords('order_line_item', { filter: JSON.stringify({ order: id }), limit: 1 });
      return lineItems && lineItems.length > 0;
    } catch {
      return false;
    }
  };

  const handleGenerateQuote = async () => {
    const hasLineItems = await checkDealLineItems();
    if (!hasLineItems) {
      setQuoteNoLineItemsOpen(true);
      return;
    }
    setQuoteConfirmOpen(true);
  };

  const confirmGenerateQuote = async () => {
    setGeneratingQuote(true);
    try {
      const response = await api.post('/documents/generate-quote', { dealId: id });
      const quoteData = response.data?.data;

      const url = await generateInvoicePDF(quoteData, true);
      setPdfUrl(url);
      setPdfFileName(`Quote-${quoteData.quote_number || quoteData.id?.slice(-4)}`);
      setPdfModalOpen(true);

      toast.success('Quote generated successfully');
      queryClient.invalidateQueries({
        queryKey: ['record-detail', objectApiName, id],
      });
      setQuoteConfirmOpen(false);
    } catch (err) {
      const validationErrors = err.response?.data?.validationErrors;
      if (validationErrors && validationErrors.length > 0) {
        setQuoteValidationErrors(validationErrors);
      } else {
        const errMessage =
          err.response?.data?.message ||
          err.message ||
          'Failed to generate quote.';
        toast.error(errMessage);
        setQuoteConfirmOpen(false);
      }
    } finally {
      setGeneratingQuote(false);
    }
  };

  const handleGenerateInvoice = async () => {
    const hasLineItems = await checkOrderLineItems();
    if (!hasLineItems) {
      setInvoiceNoLineItemsOpen(true);
      return;
    }
    setInvoiceConfirmOpen(true);
  };

  const confirmGenerateInvoice = async () => {
    setGeneratingInvoice(true);
    try {
      const response = await api.post('/documents/generate-invoice', { orderId: id });
      const invoiceData = response.data?.data;

      const url = await generateInvoicePDF(invoiceData, true);
      setPdfUrl(url);
      setPdfFileName(`Invoice-${invoiceData.invoice_number || invoiceData.id?.slice(-4)}`);
      setPdfModalOpen(true);

      toast.success('Invoice generated successfully');
      queryClient.invalidateQueries({
        queryKey: ['record-detail', objectApiName, id],
      });
      setInvoiceConfirmOpen(false);
    } catch (err) {
      const validationErrors = err.response?.data?.validationErrors;
      if (validationErrors && validationErrors.length > 0) {
        setInvoiceValidationErrors(validationErrors);
      } else {
        const errMessage =
          err.response?.data?.message ||
          err.message ||
          'Failed to generate invoice.';
        toast.error(errMessage);
        setInvoiceConfirmOpen(false);
      }
    } finally {
      setGeneratingInvoice(false);
    }
  };

  const handleViewQuotePDF = async () => {
    setGeneratingQuote(true);
    try {
      const response = await api.get(`/documents/quotes/${id}`);
      const quoteData = response.data?.data;

      const url = await generateInvoicePDF(quoteData, true);
      setPdfUrl(url);
      setPdfFileName(`Quote-${quoteData.quote_number || quoteData.id?.slice(-4)}`);
      setPdfModalOpen(true);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to load quote PDF.');
    } finally {
      setGeneratingQuote(false);
    }
  };

  const handleViewInvoicePDF = async () => {
    setGeneratingInvoice(true);
    try {
      const response = await api.get(`/documents/invoices/${id}`);
      const invoiceData = response.data?.data;

      const url = await generateInvoicePDF(invoiceData, true);
      setPdfUrl(url);
      setPdfFileName(`Invoice-${invoiceData.invoice_number || invoiceData.id?.slice(-4)}`);
      setPdfModalOpen(true);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to load invoice PDF.');
    } finally {
      setGeneratingInvoice(false);
    }
  };

  const buildSections = () => {
    if (layout?.sections?.length > 0) {
      const visibleFieldApiNames = new Set(withoutHelperFields(fields).map((f) => f.apiName));
      const layoutSections = layout.sections
        .filter((sec) => evaluateVisibilityRule(sec.visibilityRule, record))
        .map((sec) => ({
          id: sec.id,
          label: sec.label,
          columns: sec.columns || 2,
          columnData: (sec.columnData || []).map((col) => ({
            fields: (col.fields || []).filter((fi) =>
              evaluateVisibilityRule(fi.visibilityRule, record)
            ),
          })),
        }));

      // Find fields that exist on the object but aren't placed in any layout section.
      const inLayout = new Set(
        layout.sections.flatMap((sec) =>
          (sec.columnData || []).flatMap((col) => (col.fields || []).map((f) => f.fieldApiName))
        )
      );
      const missing = withoutHelperFields(fields).filter(
        (f) => !inLayout.has(f.apiName) && visibleFieldApiNames.has(f.apiName)
      );

      if (missing.length > 0 && layoutSections.length > 0) {
        const first = layoutSections[0];
        const col0 = [...(first.columnData?.[0]?.fields || [])];
        const col1 = [...(first.columnData?.[1]?.fields || [])];
        missing.forEach((f, idx) => {
          const entry = { fieldApiName: f.apiName, label: f.label };
          if (idx % 2 === 0) col0.push(entry);
          else col1.push(entry);
        });
        layoutSections[0] = { ...first, columnData: [{ fields: col0 }, { fields: col1 }] };
      }

      return layoutSections;
    }

    // Helper fields only exist to feed formulas / rollups — keep them off the
    // auto-generated layout.
    const grouped = {};
    withoutHelperFields(fields).forEach((f) => {
      const sec = f.section || 'Information';
      if (!grouped[sec]) grouped[sec] = [];
      grouped[sec].push(f);
    });

    return Object.entries(grouped).map(([label, sFields], i) => ({
      id: `fallback_${i}`,
      label,
      columns: 2,
      columnData: [
        {
          fields: sFields
            .filter((_, idx) => idx % 2 === 0)
            .map((f) => ({ fieldApiName: f.apiName, label: f.label })),
        },
        {
          fields: sFields
            .filter((_, idx) => idx % 2 !== 0)
            .map((f) => ({ fieldApiName: f.apiName, label: f.label })),
        },
      ],
    }));
  };

  if (loading) return <Layout title="Loading..." description="Loading record details"><RecordDetailSkeleton /></Layout>;
  if (!record) return null;

  const titleField = fields.find(
    (f) => f.apiName === (objMeta?.nameFieldApiName || 'name'),
  );
  const rawTitle =
    record[titleField?.apiName || 'name'] ||
    (record.first_name
      ? `${record.first_name || ''} ${record.last_name || ''}`.trim()
      : null);
  const title = rawTitle || `${objMeta?.label || 'Record'} #${id.slice(-8)}`;

  const sections = buildSections();

  return (
    <Layout title={title} description="View and edit record details">
      <div className={styles.page}>
        <RecordHeader
          objectApiName={objectApiName}
          objMeta={objMeta}
          id={id}
          title={title}
          record={record}
          fields={fields}
          generatingQuote={generatingQuote}
          generatingInvoice={generatingInvoice}
          approvalInfo={approvalInfo}
          leadApprovalSettings={leadApprovalSettings}
          isApprovalLocked={isApprovalLocked}
          perms={perms}
          onGenerateQuote={objectApiName === 'quote' ? handleViewQuotePDF : objectApiName === 'invoice' ? handleViewInvoicePDF : (objectApiName === 'deal' ? handleGenerateQuote : handleGenerateInvoice)}
          onGenerateInvoice={objectApiName === 'invoice' ? handleViewInvoicePDF : handleGenerateInvoice}
          onDelete={handleDelete}
          onActionFlowDone={() =>
            queryClient.invalidateQueries({
              queryKey: ['record-detail', objectApiName, id],
            })
          }
        />

        {runningFlow && (
          <div className={styles.flowPanel}>
            <div className={styles.flowPanelHeader}>
              <span>{runningFlow.label}</span>
              <button
                className={styles.flowClose}
                onClick={() => setRunningFlow(null)}
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {objectApiName === 'policy' && (
          <PolicyServicingPanel policyId={id} fields={fields} canUpdate={perms.canUpdate} />
        )}

        <ApprovalPanel objectApiName={objectApiName} recordId={id} />

        <RecordTabs
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          customScreens={customScreens}
          embeddedFlows={embeddedFlows}
          showHistory={!!objMeta?.enableHistory}
        />

        <RecordContent
          activeTab={activeTab}
          customScreens={customScreens}
          embeddedFlows={embeddedFlows}
          record={record}
          fields={fields}
          sections={sections}
          lookupLabels={lookupLabels}
          perms={perms}
          objectApiName={objectApiName}
        />

        {activeTab === 'field_history' && objMeta?.enableHistory && (
          <FieldHistoryTab
            objectApiName={objectApiName}
            recordId={id}
            fields={fields}
          />
        )}

        <RecordSystemInfo record={record} />

        <AttachmentsPanel objectApiName={objectApiName} recordId={id} />

        <CommunicationPanel objectApiName={objectApiName} recordId={id} />

        {relatedObjects?.length > 0 && (
          <div className={styles.relatedSection}>
            <h3 className={styles.relatedSectionTitle}>Related</h3>
            <div className={styles.relatedLists}>
              {relatedObjects?.map(
                ({ objectMeta, relatedField, fields: relFields, isThrough, junctionObjectMeta, junctionRelatedField }) => (
                  <RelatedList
                    key={`${objectMeta.apiName}-${relatedField.apiName}${isThrough ? '-through' : ''}`}
                    parentObjectApiName={objectApiName}
                    parentId={id}
                    relatedField={relatedField}
                    relatedObjectMeta={objectMeta}
                    allRelatedFields={relFields}
                    isThrough={isThrough}
                    junctionObjectMeta={junctionObjectMeta}
                    junctionRelatedField={junctionRelatedField}
                  />
                ),
              )}
            </div>
          </div>
        )}

        <RecordModals
          deleteModalOpen={deleteModalOpen}
          setDeleteModalOpen={setDeleteModalOpen}
          deleting={deleting}
          onConfirmDelete={confirmDelete}
          pdfModalOpen={pdfModalOpen}
          setPdfModalOpen={setPdfModalOpen}
          pdfUrl={pdfUrl}
          pdfFileName={pdfFileName}
          quoteConfirmOpen={quoteConfirmOpen}
          setQuoteConfirmOpen={setQuoteConfirmOpen}
          generatingQuote={generatingQuote}
          onConfirmGenerateQuote={confirmGenerateQuote}
          quoteValidationErrors={quoteValidationErrors}
          setQuoteValidationErrors={setQuoteValidationErrors}
          quoteNoLineItemsOpen={quoteNoLineItemsOpen}
          setQuoteNoLineItemsOpen={setQuoteNoLineItemsOpen}
          invoiceConfirmOpen={invoiceConfirmOpen}
          setInvoiceConfirmOpen={setInvoiceConfirmOpen}
          generatingInvoice={generatingInvoice}
          onConfirmGenerateInvoice={confirmGenerateInvoice}
          invoiceValidationErrors={invoiceValidationErrors}
          setInvoiceValidationErrors={setInvoiceValidationErrors}
          invoiceNoLineItemsOpen={invoiceNoLineItemsOpen}
          setInvoiceNoLineItemsOpen={setInvoiceNoLineItemsOpen}
        />
      </div>
    </Layout>
  );
};

export default RecordDetail;
