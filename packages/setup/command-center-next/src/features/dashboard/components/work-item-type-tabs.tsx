"use client";

import type { WorkItemType } from "@/lib/command-center/types";

const WORK_ITEM_TYPE_OPTIONS: WorkItemType[] = ["task", "story", "feature", "epic"];

interface WorkItemTypeTabsProps {
  value: WorkItemType;
  disabled?: boolean;
  onChange: (value: WorkItemType) => void;
}

export function WorkItemTypeTabs({ value, disabled, onChange }: WorkItemTypeTabsProps) {
  return (
    <div className="cc-work-item-tabs" role="tablist" aria-label="Task type">
      {WORK_ITEM_TYPE_OPTIONS.map((entry) => {
        const active = value === entry;
        return (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={active}
            className={active ? "cc-work-item-tab is-active" : "cc-work-item-tab"}
            disabled={disabled}
            onClick={() => onChange(entry)}
          >
            {entry}
          </button>
        );
      })}
    </div>
  );
}
