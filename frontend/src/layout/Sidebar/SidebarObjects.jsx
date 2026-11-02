import * as LucideIcons from 'lucide-react';
import { Building2 } from 'lucide-react';
import SidebarNavItem from './SidebarNavItem';
import SidebarNavGroup from './SidebarNavGroup';
import { SkeletonNavGroup } from './SidebarSkeletons';

const getIcon = (iconName, size = 18) => {
  const Icon = LucideIcons[iconName] || LucideIcons.Box;
  return <Icon size={size} />;
};

const SidebarObjects = ({
  navObjects,
  loadingObjects,
  objectGroups,
  sidebarCollapsed,
  onNavigate,
}) => {
  if (loadingObjects && navObjects?.length === 0) {
    return (
      <>
        <SkeletonNavGroup collapsed={sidebarCollapsed} />
        <SkeletonNavGroup collapsed={sidebarCollapsed} />
      </>
    );
  }

  if (navObjects?.length === 0) {
    if (sidebarCollapsed) return null;
    return (
      <p
        style={{ padding: '10px 16px', margin: 0, fontSize: 12, color: 'var(--color-gray-500)' }}
        data-testid="workspace-no-objects"
      >
        No objects available in this workspace.
      </p>
    );
  }

  const hasObjectGroups = objectGroups && objectGroups.length > 0;

  if (hasObjectGroups) {
    return (
      <>
        {objectGroups.map((group) => {
          const groupObjectsMap = new Map(navObjects.map(obj => [obj.apiName, obj]));
          const groupObjects = group.objectApiNames
            .map(apiName => groupObjectsMap.get(apiName))
            .filter(obj => obj !== undefined);

          if (groupObjects.length === 0) return null;

          return (
            <SidebarNavGroup
              key={group.name}
              label={group.name}
              icon={<Building2 size={14} />}
              collapsed={sidebarCollapsed}
              defaultOpen={true}
            >
              {groupObjects.map((obj) => (
                <SidebarNavItem
                  key={obj._id.toString()}
                  to={`/o/${obj.apiName}`}
                  icon={getIcon(obj.icon, 16)}
                  label={obj.pluralLabel}
                  collapsed={sidebarCollapsed}
                  iconColor={obj.color || undefined}
                  onNavigate={onNavigate}
                />
              ))}
            </SidebarNavGroup>
          );
        })}

        {(() => {
          const groupedObjectApiNames = new Set(
            objectGroups.flatMap((g) => g.objectApiNames),
          );
          const ungroupedObjects = navObjects.filter(
            (obj) => !groupedObjectApiNames.has(obj.apiName),
          );

          if (ungroupedObjects.length === 0) return null;

          return (
            <SidebarNavGroup
              label="Other"
              icon={<Building2 size={14} />}
              collapsed={sidebarCollapsed}
              defaultOpen={true}
            >
              {ungroupedObjects.map((obj) => (
                <SidebarNavItem
                  key={obj._id.toString()}
                  to={`/o/${obj.apiName}`}
                  icon={getIcon(obj.icon, 16)}
                  label={obj.pluralLabel}
                  collapsed={sidebarCollapsed}
                  iconColor={obj.color || undefined}
                  onNavigate={onNavigate}
                />
              ))}
            </SidebarNavGroup>
          );
        })()}
      </>
    );
  }

  return (
    <SidebarNavGroup
      label="CRM"
      icon={<Building2 size={14} />}
      collapsed={sidebarCollapsed}
      defaultOpen={true}
    >
      {navObjects.map((obj) => (
        <SidebarNavItem
          key={obj._id.toString()}
          to={`/o/${obj.apiName}`}
          icon={getIcon(obj.icon, 16)}
          label={obj.pluralLabel}
          collapsed={sidebarCollapsed}
          iconColor={obj.color || undefined}
          onNavigate={onNavigate}
        />
      ))}
    </SidebarNavGroup>
  );
};

export default SidebarObjects;
