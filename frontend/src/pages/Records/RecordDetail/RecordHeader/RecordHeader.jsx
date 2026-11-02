import { useNavigate, Link } from 'react-router-dom';
import * as LucideIcons from 'lucide-react';
import { ArrowLeft, Edit2, Trash2, Lock } from 'lucide-react';
import Button from '../../../../components/common/Button/Button';
import ApprovalStatusBadge from '../../../../components/records/ApprovalStatusBadge';
import ApprovalActionsButtons from '../../../../components/records/ApprovalActionsButtons';
import RecordActionButtons from '../../../../components/records/RecordActionButtons';
import styles from '../RecordDetail.module.css';

const RecordHeader = ({
  objectApiName,
  objMeta,
  id,
  title,
  record,
  fields,
  generatingQuote,
  generatingInvoice,
  approvalInfo,
  leadApprovalSettings,
  isApprovalLocked,
  perms,
  onGenerateQuote,
  onGenerateInvoice,
  onDelete,
  onActionFlowDone,
}) => {
  const navigate = useNavigate();

  return (
    <div className={styles.header}>
      <Button
        variant="ghost"
        size="sm"
        icon={<ArrowLeft size={16} />}
        onClick={() => navigate(-1)}
        className={styles.backBtn}
      >
        Back
      </Button>
      <div className={styles.titleRow}>
        {(() => {
          const ObjIcon = LucideIcons[objMeta?.icon] || LucideIcons.Box;
          return (
            <div
              className={styles.objectIcon}
              style={{
                background: `${objMeta?.color || '#6366f1'}20`,
                color: objMeta?.color || '#6366f1',
              }}
            >
              <ObjIcon size={20} />
            </div>
          );
        })()}
        <div className={styles.titleWithStatus}>
          <h1 className={styles.title}>{title}</h1>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {objectApiName === 'lead' && approvalInfo && (
              <ApprovalStatusBadge status={approvalInfo.approvalStatus} />
            )}
            {objectApiName === 'lead' && record?.is_converted && (
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 12px',
                background: '#d1fae5',
                color: '#065f46',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: '500',
              }}>
                <span>✓ Converted to Deal</span>
                {record?.related_deal_id && (
                  <Link
                    to={`/o/deal/${record.related_deal_id}`}
                    style={{ color: '#065f46', marginLeft: '4px', textDecoration: 'underline' }}
                  >
                    View Deal →
                  </Link>
                )}
              </div>
            )}
            {objectApiName === 'deal' && record?.is_converted && (
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 12px',
                background: '#dbeafe',
                color: '#0c4a6e',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: '500',
              }}>
                <span>✓ Converted to Order</span>
                {record?.converted_order && (
                  <Link
                    to={`/o/order/${record.converted_order}`}
                    style={{ color: '#0c4a6e', marginLeft: '4px', textDecoration: 'underline' }}
                  >
                    View Order →
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className={styles.actions}>
        {/* Configured action buttons (BRD 4.4): Flows, screen flows and
            platform actions such as Convert to Deal or Generate Quote,
            each optionally shown only when the record matches conditions. */}
        <RecordActionButtons
          objectApiName={objectApiName}
          objMeta={objMeta}
          id={id}
          record={record}
          fields={fields}
          perms={perms}
          approvalInfo={approvalInfo}
          leadApprovalSettings={leadApprovalSettings}
          generatingQuote={generatingQuote}
          generatingInvoice={generatingInvoice}
          onGenerateQuote={onGenerateQuote}
          onGenerateInvoice={onGenerateInvoice}
          onDone={onActionFlowDone}
        />
        {/* Approve / Reject for the lead's approver — approval controls, not
            configurable actions. */}
        {objectApiName === 'lead' && approvalInfo && leadApprovalSettings?.leadApprovalsRequired && (
          <ApprovalActionsButtons
            leadId={id}
            lead={record}
            approvalStatus={approvalInfo.approvalStatus}
            isCurrentUserApprover={approvalInfo.isCurrentUserApprover}
            onSuccess={onActionFlowDone}
          />
        )}
        {perms.canUpdate && (
          isApprovalLocked ? (
            <Button
              variant="secondary"
              size="sm"
              icon={<Lock size={14} />}
              disabled
              title="This record is locked while an approval is pending"
            >
              Locked
            </Button>
          ) : (
            <Link to={`/o/${objectApiName}/${id}/edit`}>
              <Button
                variant="secondary"
                size="sm"
                icon={<Edit2 size={14} />}
              >
                Edit
              </Button>
            </Link>
          )
        )}
        {perms.canDelete && (
          <Button
            variant="danger"
            size="sm"
            icon={<Trash2 size={14} />}
            onClick={onDelete}
            disabled={isApprovalLocked}
            title={isApprovalLocked ? 'Cannot delete while an approval is pending' : undefined}
          >
            Delete
          </Button>
        )}
      </div>
    </div>
  );
};

export default RecordHeader;
