import { Zap } from 'lucide-react';
import ScreenRenderer from '../../../../components/screens/ScreenRenderer';
import ScreenFlowRunner from '../../../../components/records/ScreenFlowRunner';
import RecordFields from '../RecordFields/RecordFields';
import ActivityTimeline from '../../../../components/records/ActivityTimeline/ActivityTimeline';
import styles from '../RecordDetail.module.css';

const RecordContent = ({
  activeTab,
  customScreens,
  embeddedFlows,
  record,
  fields,
  sections,
  lookupLabels,
  perms,
  objectApiName,
}) => {
  return (
    <>
      {activeTab === 'activity' && (
        <ActivityTimeline objectApiName={objectApiName} recordId={record?.id || record?._id} />
      )}

      {/* Custom screen content */}
      {activeTab !== 'details' && customScreens.some((s) => s._id === activeTab) && (
        <ScreenRenderer screenId={activeTab} record={record} fields={fields} />
      )}
      {activeTab !== 'details' && activeTab.startsWith('flow_') && (
        <ScreenFlowRunner
          automationId={activeTab.replace('flow_', '')}
          record={record}
          fields={fields}
          objectApiName={objectApiName}
        />
      )}

      {/* Details tab content */}
      <div
        className={styles.body}
        style={{ display: activeTab === 'details' ? undefined : 'none' }}
      >
        <RecordFields
          sections={sections}
          fields={fields}
          record={record}
          lookupLabels={lookupLabels}
          perms={perms}
        />
      </div>

      {/* Embedded flows in details */}
      {activeTab === 'details' && sections.map((section) => {
        if (section.type === 'flow' && section.flowId) {
          return (
            <div key={section.id} className={styles.section} style={{ marginTop: '24px' }}>
              <h3 className={styles.sectionTitle}>
                <Zap
                  size={14}
                  style={{
                    marginRight: 6,
                    color: 'var(--color-primary)',
                  }}
                />
                {section.label}
              </h3>
              <ScreenFlowRunner
                automationId={section.flowId}
                record={record}
                fields={fields}
                objectApiName={objectApiName}
              />
            </div>
          );
        }
        return null;
      })}
    </>
  );
};

export default RecordContent;
