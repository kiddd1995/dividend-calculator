import AllocationEditor from './AllocationEditor.jsx'
import Field from './Field.jsx'

export default function ProjectConfigurator({
  label,
  selectedProjectId,
  allocationRows,
  totalAllocation,
  isAllocationValid,
  fixedPlans,
  customProjectId,
  assetData,
  enabledAssets,
  onProjectChange,
  onAssetChange,
  onPercentageChange,
  onAddAsset,
  onRemoveAsset,
}) {
  return (
    <div className="project-configurator">
      <div className="project-label">
        <span>{label}</span>
        <small>專案與實際配置</small>
      </div>
      <Field label="選擇專案">
        <select
          value={selectedProjectId}
          onChange={(event) => onProjectChange(event.target.value)}
        >
          {fixedPlans.map((plan) => (
            <option value={plan.id} key={plan.id}>
              {plan.name}
            </option>
          ))}
          <option value={customProjectId}>自訂專案</option>
        </select>
      </Field>
      <AllocationEditor
        rows={allocationRows}
        total={totalAllocation}
        isValid={isAllocationValid}
        assetData={assetData}
        enabledAssets={enabledAssets}
        onAssetChange={onAssetChange}
        onPercentageChange={onPercentageChange}
        onAdd={onAddAsset}
        onRemove={onRemoveAsset}
      />
    </div>
  )
}
