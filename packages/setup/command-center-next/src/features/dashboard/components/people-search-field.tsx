"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DirectoryPerson } from "@/lib/command-center/types";

interface PeopleSearchFieldProps {
  label: string;
  value: string;
  selectedMatrixId: string | null;
  placeholder?: string;
  disabled?: boolean;
  onValueChange: (value: string) => void;
  onSelectedMatrixIdChange: (matrixId: string | null) => void;
  onSearchPeople: (query: string) => Promise<DirectoryPerson[]>;
  onStatus?: (message: string) => void;
}

function looksLikeMatrixId(value: string): boolean {
  return value.trim().startsWith("@");
}

export function PeopleSearchField({
  label,
  value,
  selectedMatrixId,
  placeholder = "Search by name or paste @matrix:id",
  disabled,
  onValueChange,
  onSelectedMatrixIdChange,
  onSearchPeople,
  onStatus,
}: PeopleSearchFieldProps) {
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<DirectoryPerson[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const requestIdRef = useRef(0);

  const displayResults = useMemo(() => panelOpen && results.length > 0, [panelOpen, results]);
  useEffect(() => {
    const query = value.trim();
    if (disabled || !query || looksLikeMatrixId(query) || query.length < 2) {
      setSearching(false);
      setResults([]);
      setPanelOpen(false);
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    const timeout = window.setTimeout(async () => {
      setSearching(true);
      try {
        const matches = await onSearchPeople(query);
        if (requestIdRef.current !== currentRequestId) {
          return;
        }
        setResults(matches);
        setPanelOpen(matches.length > 0);
      } catch (error) {
        if (requestIdRef.current !== currentRequestId) {
          return;
        }
        onStatus?.(error instanceof Error ? error.message : "People search failed");
        setResults([]);
        setPanelOpen(false);
      } finally {
        if (requestIdRef.current === currentRequestId) {
          setSearching(false);
        }
      }
    }, 220);

    return () => window.clearTimeout(timeout);
  }, [value, disabled, onSearchPeople, onStatus]);

  return (
    <div className="cc-field">
      <span>{label}</span>
      <div className="cc-inline-input">
        <input
          value={value}
          onChange={(event) => {
            onValueChange(event.target.value);
            onSelectedMatrixIdChange(null);
            setPanelOpen(false);
          }}
          placeholder={placeholder}
          disabled={disabled}
        />
      </div>

      {displayResults ? (
        <div className="cc-search-results">
          {results.map((person) => {
            const selected = selectedMatrixId === person.matrixId;
            return (
              <button
                key={person.matrixId}
                type="button"
                className={selected ? "cc-search-result is-selected" : "cc-search-result"}
                onClick={() => {
                  onSelectedMatrixIdChange(person.matrixId);
                  onValueChange(person.matrixId);
                  onStatus?.(`Selected ${person.matrixId}`);
                  setPanelOpen(false);
                }}
              >
                <strong>{person.name}</strong>
                <span>
                  {person.title} · {person.department}
                </span>
                <small>{person.matrixId}</small>
              </button>
            );
          })}
        </div>
      ) : null}
      {searching ? <p className="cc-status-text">Searching people...</p> : null}
    </div>
  );
}
