import styles from './RecordForm.module.css';
import { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { getFormBundle } from '../../../services/api/objects';
import {
  getRecord,
  updateRecord,
  createRecord,
} from '../../../services/api/records';
import { checkDuplicates } from '../../../services/api/duplicateRules';
import DuplicateWarningModal from '../../../components/records/DuplicateWarningModal/DuplicateWarningModal';
import ValidationSummary from '../../../components/records/ValidationSummary/ValidationSummary';
import { MAX_MERGE_RECORDS } from '../RecordMerge/mergeConstants';
import { useTenantContext } from '../../../context/TenantContext';
import { useAuthContext } from '../../../context/AuthContext';
import { useObjectPermissions } from '../../../hooks/useObjectPermissions';
import notFoundStyles from '../../NotFound.module.css';
import Layout from '../../../layout/Layout';
import RecordFormHeader from './RecordFormHeader/RecordFormHeader';
import RecordFormContent from './RecordFormContent/RecordFormContent';
import { buildFormSections } from './utils/buildFormSections';
import {
  initializeFormData,
  cloneableValues,
  validateFormData,
  clearFieldError,
  extractServerErrors,
  convertDatetimeToUTC,
} from './utils/formHelpers';

const RecordForm = () => {
  const queryClient = useQueryClient();
  const { objectApiName, id } = useParams();
  const navigate = useNavigate();
  const { getObject } = useTenantContext();
  const { user } = useAuthContext();
  const objMeta = getObject(objectApiName);
  const perms = useObjectPermissions(objectApiName);
  const isEdit = !!id;
  // "Clone" action: /o/:object/new?cloneFrom=<id> starts from a copy.
  const [searchParams] = useSearchParams();
  const cloneFrom = !isEdit ? searchParams.get('cloneFrom') : null;

  const [errors, setErrors] = useState({});
  // Every problem from the last failed save, listed above the form (BRD 6.2)
  const [saveIssues, setSaveIssues] = useState([]);
  const [saving, setSaving] = useState(false);
  // { action: 'warn'|'block', matches, data } while the duplicate dialog is open
  const [duplicates, setDuplicates] = useState(null);

  // Fetch form bundle (fields and layout)
  const { data: bundle, isLoading: bundleLoading } = useQuery({
    queryKey: ['form-bundle', objectApiName, id || 'new'],
    queryFn: () => getFormBundle(objectApiName, id),
    enabled: !!objectApiName,
  });

  const fields = useMemo(() => bundle?.fields || [], [bundle]);
  const layout = bundle?.layout;

  // Fetch record data if editing
  const { data: record, isLoading: recordLoading } = useQuery({
    queryKey: ['record', objectApiName, id],
    queryFn: () => getRecord(objectApiName, id),
    enabled: !!objectApiName && !!id && isEdit,
  });

  const { data: cloneSource, isLoading: cloneLoading } = useQuery({
    queryKey: ['record', objectApiName, cloneFrom],
    queryFn: () => getRecord(objectApiName, cloneFrom),
    enabled: !!objectApiName && !!cloneFrom,
  });

  // Compute initial form data
  const initialFormData = useMemo(() => {
    if (!bundle || (isEdit && !record)) return {};
    if (cloneFrom && !cloneSource) return {};
    const base = initializeFormData(fields, record, user, isEdit);
    return cloneFrom ? { ...base, ...cloneableValues(fields, cloneSource) } : base;
  }, [bundle, record, isEdit, fields, user, cloneFrom, cloneSource]);

  const [formData, setFormData] = useState(initialFormData);
  const isInitialMount = useRef(true);

  // Sync formData when initialFormData changes (on component mount or data reload)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    setFormData(initialFormData);
  }, [initialFormData]);

  const loading = bundleLoading || (isEdit && recordLoading) || (!!cloneFrom && cloneLoading);

  const handleFieldChange = (apiName, value) => {
    setFormData((prev) => ({ ...prev, [apiName]: value }));
    setErrors((prev) => clearFieldError(prev, apiName));
  };

  /**
   * Scroll to and focus the first flagged input. Walks the rendered fields in
   * document order so the user lands on the first problem on the form rather
   * than whichever key happened to come first in the response.
   */
  const focusFirstError = (fieldErrors) => {
    requestAnimationFrame(() => {
      const nodes = document.querySelectorAll('#record-form [data-field]');
      for (const node of nodes) {
        if (!fieldErrors[node.dataset.field]) continue;
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        node
          .querySelector('input, select, textarea')
          ?.focus({ preventScroll: true });
        break;
      }
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const errs = validateFormData(formData, fields);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      const errorList = Object.values(errs).join(', ');
      toast.error(`Please complete required fields: ${errorList}`);
      return;
    }

    // Convert datetime values from local time to UTC before submitting
    const dataToSubmit = convertDatetimeToUTC(formData, fields);

    setSaving(true);
    // Check the tenant's duplicate rules before saving so the user sees the
    // matching records and decides. If the check itself fails, save anyway:
    // the server still enforces blocking rules on create and update.
    let duplicateCheck = null;
    try {
      duplicateCheck = await checkDuplicates(
        objectApiName,
        dataToSubmit,
        isEdit ? id : undefined,
      );
    } catch {
      duplicateCheck = null;
    }
    const CLIENT_SIDE_ACTIONS = new Set(['warn', 'block', 'present_matches']);
    if (duplicateCheck?.matches?.length && CLIENT_SIDE_ACTIONS.has(duplicateCheck.action)) {
      setDuplicates({ ...duplicateCheck, data: dataToSubmit });
      setSaving(false);
      return;
    }

    await saveRecord(dataToSubmit);
  };

  const saveRecord = async (dataToSubmit) => {
    setSaving(true);
    setSaveIssues([]);
    try {
      if (isEdit) {
        const updatedRecord = await updateRecord(objectApiName, id, dataToSubmit);
        toast.success('Record updated.');
        queryClient.invalidateQueries({
          queryKey: ['record', objectApiName, id],
        });
        queryClient.invalidateQueries({
          queryKey: ['record-detail', objectApiName, id],
        });
        // A changed value may now match a different conditional layout.
        queryClient.invalidateQueries({
          queryKey: ['form-bundle', objectApiName, id],
        });
        queryClient.invalidateQueries({ queryKey: ['records', objectApiName] });
        navigate(`/o/${objectApiName}/${updatedRecord.id}`);
      } else {
        const createdRecord = await createRecord(objectApiName, dataToSubmit);
        toast.success('Record created.');
        queryClient.invalidateQueries({ queryKey: ['records', objectApiName] });
        navigate(`/o/${objectApiName}/${createdRecord.id}`);
      }
    } catch (err) {
      // A blocking duplicate rule the pre-save check didn't catch (e.g. a
      // record created in the meantime) comes back as a 409 with the matches.
      const serverDuplicates = err?.response?.data?.duplicates;
      if (err?.response?.status === 409 && serverDuplicates?.length) {
        setDuplicates({ action: 'block', matches: serverDuplicates, data: dataToSubmit });
        return;
      }
      setDuplicates(null);
      // Anything the server could pin to a specific input (a duplicate value on
      // a unique field, a bad email, a failed regex) is highlighted on that
      // field, the same as a client-side validation failure.
      const { fieldErrors, message, issues } = extractServerErrors(err, fields);
      if (Object.keys(fieldErrors).length > 0) {
        setErrors(fieldErrors);
        focusFirstError(fieldErrors);
      }
      setSaveIssues(issues);
      toast.error(issues.length > 1 ? `${issues.length} problems need fixing — see the list above the form.` : message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    const pageTitle = isEdit
      ? `Edit ${objMeta?.label || objectApiName}`
      : `New ${objMeta?.label || objectApiName}`;

    return (
      <Layout title={pageTitle} description="Edit record details">
        <div className={styles.loading}>
          <div className={styles.spinner} />
        </div>
      </Layout>
    );
  }

  // Guard: block access to the form when the user lacks the required permission
  const lacksPermission = isEdit ? !perms.canUpdate : !perms.canCreate;
  if (lacksPermission && !perms.loading) {
    return (
      <Layout title="Access denied" description="You don't have permission to access this page.">
        <div className={notFoundStyles.container}>
          <div className={notFoundStyles.content}>
            <h1 className={notFoundStyles.code}>403</h1>
            <h2 className={notFoundStyles.title}>Access denied</h2>
            <p className={notFoundStyles.message}>
              You don't have permission to {isEdit ? 'edit' : 'create'} records for this object.
            </p>
            <button type="button" className={notFoundStyles.homeLink} onClick={() => navigate(-1)}>
              Go back
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  const sections = buildFormSections(layout, fields, formData, isEdit);
  const pageTitle = isEdit
    ? `Edit ${objMeta?.label || objectApiName}`
    : `New ${objMeta?.label || objectApiName}`;

  return (
    <Layout title={pageTitle} description="Edit record details">
      <div className={styles.page}>
        <RecordFormHeader
          objMeta={objMeta}
          objectApiName={objectApiName}
          id={id}
          isEdit={isEdit}
          saving={saving}
          onCancel={() => navigate(-1)}
        />

        <ValidationSummary issues={saveIssues} fields={fields} />

        <RecordFormContent
          sections={sections}
          fields={fields}
          formData={formData}
          errors={errors}
          perms={perms}
          onFieldChange={handleFieldChange}
          onSubmit={handleSubmit}
        />
      </div>

      <DuplicateWarningModal
        isOpen={!!duplicates}
        action={duplicates?.action}
        matches={duplicates?.matches}
        fields={fields}
        objectApiName={objectApiName}
        objectLabel={objMeta?.label?.toLowerCase()}
        saving={saving}
        onSaveAnyway={() => saveRecord(duplicates.data)}
        onSelectMatch={(recordId) => navigate(`/o/${objectApiName}/${recordId}`)}
        onMerge={
          isEdit && perms.canDelete && perms.canUpdate && duplicates?.matches?.length <= MAX_MERGE_RECORDS - 1
            ? () => {
                if (
                  window.confirm(
                    "Unsaved changes on this form will be discarded. You can pick each field's value on the merge screen.",
                  )
                ) {
                  const ids = [id, ...duplicates.matches.map((m) => m.recordId)];
                  navigate(`/o/${objectApiName}/merge?ids=${ids.join(',')}`);
                }
              }
            : undefined
        }
        onClose={() => setDuplicates(null)}
      />
    </Layout>
  );
};

export default RecordForm;
