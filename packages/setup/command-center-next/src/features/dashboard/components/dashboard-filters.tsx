import type { WorkItemType } from "@/lib/command-center/types";

interface DashboardFiltersProps {
  workItemType: "all" | WorkItemType;
  onWorkItemTypeChange: (value: "all" | WorkItemType) => void;
  taskQuery: string;
  onTaskQueryChange: (value: string) => void;
  department: string;
  onDepartmentChange: (value: string) => void;
  vp: string;
  onVpChange: (value: string) => void;
  director: string;
  onDirectorChange: (value: string) => void;
  manager: string;
  onManagerChange: (value: string) => void;
  departments: string[];
  vps: string[];
  directors: string[];
  managers: string[];
  onReset: () => void;
}

const WORK_ITEM_OPTIONS: Array<"all" | WorkItemType> = ["all", "epic", "feature", "story", "task"];

export function DashboardFilters({
  workItemType,
  onWorkItemTypeChange,
  taskQuery,
  onTaskQueryChange,
  department,
  onDepartmentChange,
  vp,
  onVpChange,
  director,
  onDirectorChange,
  manager,
  onManagerChange,
  departments,
  vps,
  directors,
  managers,
  onReset,
}: DashboardFiltersProps) {
  return (
    <div className="cc-filters cc-filters-horizontal">
      <label className="cc-filter-inline-field cc-filter-inline-field--search">
        <span>Search</span>
        <input
          type="search"
          placeholder="title, description, DoD, comments"
          value={taskQuery}
          onChange={(event) => onTaskQueryChange(event.target.value)}
        />
      </label>

      <label className="cc-filter-inline-field">
        <span>Work Item</span>
        <select value={workItemType} onChange={(event) => onWorkItemTypeChange(event.target.value as "all" | WorkItemType)}>
          {WORK_ITEM_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option === "all" ? "All" : option}
            </option>
          ))}
        </select>
      </label>

      <label className="cc-filter-inline-field">
        <span>Department</span>
        <select value={department} onChange={(event) => onDepartmentChange(event.target.value)}>
          <option value="">All</option>
          {departments.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>

      <label className="cc-filter-inline-field">
        <span>VP</span>
        <select value={vp} onChange={(event) => onVpChange(event.target.value)}>
          <option value="">All</option>
          {vps.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>

      <label className="cc-filter-inline-field">
        <span>Director</span>
        <select value={director} onChange={(event) => onDirectorChange(event.target.value)}>
          <option value="">All</option>
          {directors.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>

      <label className="cc-filter-inline-field">
        <span>Manager</span>
        <select value={manager} onChange={(event) => onManagerChange(event.target.value)}>
          <option value="">All</option>
          {managers.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>

      <button type="button" onClick={onReset} className="cc-button is-secondary cc-filter-reset">
        Reset
      </button>
    </div>
  );
}
