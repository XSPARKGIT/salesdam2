/**
 * RecordActionButtons — the configured buttons on a record page (BRD 4.4).
 *
 * Each button comes from ObjectMeta.actionButtons and runs a Flow, a screen
 * flow or a platform action. A button with conditions only shows when the
 * record matches all of them (e.g. Convert to Order when Stage = closed_won).
 * Platform actions keep the built-in rules they always had (e.g. Submit for
 * Approval only when lead approvals are switched on).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as LucideIcons from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import Button from '../common/Button/Button';
import ActionFlowRunner from './ActionFlowRunner';
import useConfirm from './useConfirm';
import ConvertToDealButton from './ConvertToDealButton';
import SubmitForApprovalButton from './SubmitForApprovalButton';
import NewPolicyButton from '../insurance/NewPolicyButton';
import { actionTypeOf, conditionsMatch } from '../../utils/recordActions';

const iconFor = (name) => {
  const Icon = LucideIcons[name] || LucideIcons.Zap;
  return <Icon size={14} />;
};

const colorStyle = (button) =>
  typeof button.color === 'string' && button.color.trim()
    ? { background: button.color, borderColor: button.color, color: '#fff' }
    : undefined;

// Convert to Order and any other action the server runs.
function ServerActionButton({ button, objectApiName, recordId, onDone }) {
  const [running, setRunning] = useState(false);
  const { confirm, ConfirmDialog } = useConfirm();
  const navigate = useNavigate();

  const run = async () => {
    if (!(await confirm(button.confirmMessage))) return;
    setRunning(true);
    try {
      const res = await api.post(`/action-buttons/${objectApiName}/${button._id}/run`, { recordId });
      const data = res.data?.data || {};
      toast.success(data.message || res.data?.message || 'Done.');
      onDone?.(data);
      if (data.navigate?.objectApiName && data.navigate?.recordId) {
        navigate(`/o/${data.navigate.objectApiName}/${data.navigate.recordId}`);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Action failed.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <Button
        variant={button.variant || 'secondary'}
        size="sm"
        icon={iconFor(button.icon)}
        loading={running}
        onClick={run}
        style={colorStyle(button)}
      >
        {button.label}
      </Button>
      {ConfirmDialog}
    </>
  );
}

function NativeActionButton({ button, ctx }) {
  const navigate = useNavigate();
  const {
    objectApiName, id, record, perms, approvalInfo, leadApprovalSettings,
    generatingQuote, generatingInvoice, onGenerateQuote, onGenerateInvoice, onDone,
  } = ctx;
  const look = {
    label: button.label,
    variant: button.variant || 'secondary',
    icon: iconFor(button.icon),
  };
  const simple = (onClick, loading) => (
    <Button size="sm" variant={look.variant} icon={look.icon} loading={loading} onClick={onClick} style={colorStyle(button)}>
      {look.label}
    </Button>
  );

  switch (button.nativeAction) {
    case 'clone_record':
      if (!perms?.canCreate) return null;
      return simple(() => navigate(`/o/${objectApiName}/new?cloneFrom=${id}`));

    case 'convert_lead_to_deal':
      // As before: when lead approvals are on, approvers convert from the
      // approval controls instead.
      if (!leadApprovalSettings || leadApprovalSettings.leadApprovalsRequired) return null;
      return <ConvertToDealButton leadId={id} lead={record} onSuccess={onDone} {...look} />;

    case 'submit_lead_for_approval':
      if (!leadApprovalSettings?.leadApprovalsRequired || !approvalInfo?.canSubmitForApproval) return null;
      return (
        <SubmitForApprovalButton
          leadId={id}
          approvalStatus={approvalInfo.approvalStatus}
          onSuccess={onDone}
          {...look}
        />
      );

    case 'convert_deal_to_order':
      if (!perms?.canUpdate) return null;
      return <ServerActionButton button={button} objectApiName={objectApiName} recordId={id} onDone={onDone} />;

    case 'generate_quote':
      return simple(onGenerateQuote, generatingQuote);

    case 'generate_invoice':
      return simple(onGenerateInvoice, generatingInvoice);

    case 'view_pdf':
      return objectApiName === 'invoice'
        ? simple(onGenerateInvoice, generatingInvoice)
        : simple(onGenerateQuote, generatingQuote);

    case 'new_policy':
      return (
        <NewPolicyButton
          params={objectApiName === 'client' ? { client: id } : { lead: id }}
          {...look}
        />
      );

    default:
      return null;
  }
}

export default function RecordActionButtons(props) {
  const { objMeta, record, fields, objectApiName, onDone } = props;
  const buttons = (objMeta?.actionButtons || [])
    .filter((b) => !b.location || b.location === 'record_detail' || b.location === 'both')
    .filter((b) => conditionsMatch(b.conditions, record || {}))
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  return buttons.map((button) => {
    const key = button._id || button.id || button.label;
    if (actionTypeOf(button) === 'native') {
      return <NativeActionButton key={key} button={button} ctx={props} />;
    }
    if (!button.automationId) return null;
    return (
      <ActionFlowRunner
        key={key}
        button={button}
        record={record}
        objectApiName={objectApiName}
        fields={fields}
        onDone={onDone}
      />
    );
  });
}
