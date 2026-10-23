'use client';

import React, { useState, memo } from 'react';

// ── Registry Rule Badge ────────────────────────────────────────────────────
// Rendered for flags with type === 'REGISTRY_RULE'. Visually distinct from
// pipeline flags (purple/indigo palette) and collapsible to show full message.

interface RegistryFlag {
  type: 'REGISTRY_RULE';
  ruleId: string;
  canonicalColumn?: string;
  severity: 'error' | 'warning';
  message: string;
}

function RegistryRuleBadge({ flag }: { flag: RegistryFlag }) {
  const [expanded, setExpanded] = useState(false);
  const isError = flag.severity === 'error';

  return (
    <span
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: '2px',
        cursor: 'pointer',
        userSelect: 'none',
      }}
      onClick={() => setExpanded((p) => !p)}
      title="Click to expand registry rule detail"
    >
      <span
        style={{
          fontSize: '11px',
          fontWeight: 700,
          background: isError ? 'rgba(139, 92, 246, 0.2)' : 'rgba(251, 191, 36, 0.15)',
          color: isError ? '#c4b5fd' : '#fde68a',
          border: `1px solid ${isError ? '#7c3aed' : '#d97706'}`,
          padding: '2px 8px',
          borderRadius: '4px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
        }}
      >
        <span style={{ opacity: 0.7 }}>🔬</span>
        <code style={{ fontSize: '10px', fontFamily: 'monospace', letterSpacing: '0.02em' }}>
          {flag.ruleId}
        </code>
        {flag.canonicalColumn && (
          <span
            style={{
              fontSize: '10px',
              background: isError ? 'rgba(109, 40, 217, 0.4)' : 'rgba(180, 83, 9, 0.3)',
              padding: '0 4px',
              borderRadius: '3px',
            }}
          >
            {flag.canonicalColumn}
          </span>
        )}
        <span
          style={{
            fontSize: '9px',
            fontWeight: 800,
            padding: '0 4px',
            borderRadius: '3px',
            background: isError ? '#7c3aed' : '#d97706',
            color: '#fff',
            textTransform: 'uppercase',
          }}
        >
          {flag.severity}
        </span>
        <span style={{ fontSize: '10px', opacity: 0.6 }}>{expanded ? '▲' : '▼'}</span>
      </span>
      {expanded && (
        <span
          style={{
            fontSize: '11px',
            color: isError ? '#ddd6fe' : '#fde68a',
            background: isError ? 'rgba(109, 40, 217, 0.12)' : 'rgba(217, 119, 6, 0.12)',
            border: `1px solid ${isError ? '#6d28d9' : '#b45309'}`,
            borderRadius: '4px',
            padding: '4px 8px',
            maxWidth: '400px',
            lineHeight: 1.4,
          }}
        >
          {flag.message}
        </span>
      )}
    </span>
  );
}

export interface FolderBRowProps {
  row: any;
  onAcceptAI: (row: any) => void;
  onEditCode: (row: any, newCode: string) => void;
  onDiscard: (row: any) => void;
}


function FolderBRowComponent({
  row,
  onAcceptAI,
  onEditCode,
  onDiscard,
}: FolderBRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedCode, setEditedCode] = useState(
    row.normalizedData?.accountCode || row.aiSuggestion?.suggestedAccountCode || '5010'
  );

  const txGroupId =
    row?.normalizedData?.transactionGroupId ||
    row?.normalizedData?.transaction_group_id ||
    row?.normalizedData?.transaction_external_id ||
    row?.normalizedData?.transactionId ||
    row?.rawInput?.transaction_external_id ||
    row?.rawInput?.transaction_group_id ||
    row?.transactionGroupId ||
    row?.transaction_group_id ||
    '';

  function handleSaveEdit() {
    if (!editedCode.trim()) return;
    onEditCode(row, editedCode.trim());
    setIsEditing(false);
  }

  function handleCancelEdit() {
    setEditedCode(row.normalizedData?.accountCode || row.aiSuggestion?.suggestedAccountCode || '5010');
    setIsEditing(false);
  }

  const amountPKR = ((Number(row.normalizedData?.amountPaisa) || 0) / 100).toLocaleString();
  const debitPKR = Number(row.normalizedData?.debitPaisa) ? ((Number(row.normalizedData?.debitPaisa) || 0) / 100).toLocaleString() : null;
  const creditPKR = Number(row.normalizedData?.creditPaisa) ? ((Number(row.normalizedData?.creditPaisa) || 0) / 100).toLocaleString() : null;

  return (
    <div
      style={{
        padding: '16px',
        borderRadius: '8px',
        border: '1px solid #d97706',
        background: 'rgba(30, 41, 59, 0.6)',
        transition: 'all 0.2s ease',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        {/* Transaction Detail */}
        <div style={{ flex: 1, minWidth: '280px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, background: '#334155', color: '#cbd5e1', padding: '2px 6px', borderRadius: '4px' }}>
              Row #{row.rowIndex}
            </span>
            {txGroupId && (
              <span style={{ fontSize: '11px', fontWeight: 700, background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: '1px solid #0284c7', padding: '2px 6px', borderRadius: '4px' }}>
                Group: {txGroupId}
              </span>
            )}
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>
              {row.normalizedData?.date || row.normalizedData?.entry_date || 'No Date'}
            </span>
            <strong style={{ fontSize: '15px', color: '#f8fafc' }}>
              {row.normalizedData?.description || row.normalizedData?.line_description || 'Unlabeled Transaction'}
            </strong>
            <span style={{ fontSize: '14px', fontWeight: 800, color: '#38bdf8', marginLeft: 'auto' }}>
              {debitPKR ? `DR PKR ${debitPKR}` : creditPKR ? `CR PKR ${creditPKR}` : `PKR ${amountPKR}`}
            </span>
          </div>

          {/* Plain-English Flags */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
            {row.flags && row.flags.map((f: any, fIdx: number) =>
              f.type === 'REGISTRY_RULE' ? (
                <RegistryRuleBadge key={fIdx} flag={f} />
              ) : (
                <span
                  key={fIdx}
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    background: 'rgba(239, 68, 68, 0.2)',
                    color: '#fca5a5',
                    border: '1px solid #dc2626',
                    padding: '2px 8px',
                    borderRadius: '4px',
                  }}
                >
                  {f.message}
                </span>
              )
            )}
          </div>

          {/* TreeSHAP Explanation if present */}
          {row.shapExplanations && row.shapExplanations.length > 0 && (
            <div style={{ marginTop: '6px', fontSize: '12px', color: '#94a3b8', background: 'rgba(0,0,0,0.2)', padding: '4px 8px', borderRadius: '4px' }}>
              🔬 <strong>TreeSHAP Outlier Driver:</strong> {row.shapExplanations.map((s: any) => `${s.feature} (${s.contributionPercentage}%)`).join(', ')}
            </div>
          )}

          {/* AI Suggestion Box */}
          {row.aiSuggestion && (
            row.aiSuggestion.suggestedAccountCode ? (
              <div style={{ marginTop: '8px', background: 'rgba(37, 99, 255, 0.15)', border: '1px solid #2563eb', padding: '8px 12px', borderRadius: '6px', fontSize: '13px', color: '#bfdbfe' }}>
                💡 <strong>AI Suggestion:</strong> Code <strong>{row.aiSuggestion.suggestedAccountCode}</strong> ({row.aiSuggestion.suggestedAccountName})
                <div style={{ fontSize: '12px', color: '#93c5fd', marginTop: '2px' }}>
                  Reasoning: {row.aiSuggestion.reasoning} (Confidence: {row.aiSuggestion.confidenceScore}%)
                </div>
              </div>
            ) : (
              <div style={{ marginTop: '8px', background: 'rgba(245, 158, 11, 0.15)', border: '1px solid #f59e0b', padding: '8px 12px', borderRadius: '6px', fontSize: '13px', color: '#fde68a' }}>
                ⚠️ <strong>Manual review required:</strong> No automated account match found. Please assign an account code.
              </div>
            )
          )}

          {/* Non-Blocking Inline Edit Interface */}
          {isEditing && (
            <div
              style={{
                marginTop: '10px',
                background: 'rgba(15, 23, 42, 0.9)',
                border: '1px solid #38bdf8',
                borderRadius: '6px',
                padding: '10px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontSize: '12px', color: '#38bdf8', fontWeight: 600 }}>Assign Account Code:</span>
              <input
                type="text"
                value={editedCode}
                onChange={e => setEditedCode(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSaveEdit();
                  if (e.key === 'Escape') handleCancelEdit();
                }}
                autoFocus
                placeholder="e.g. 5010"
                style={{
                  background: '#0a0f1d',
                  border: '1px solid #475569',
                  borderRadius: '4px',
                  color: '#f8fafc',
                  padding: '4px 8px',
                  fontSize: '13px',
                  fontFamily: 'monospace',
                  width: '120px',
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={handleSaveEdit}
                style={{
                  background: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '5px 12px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ✓ Apply
              </button>
              <button
                type="button"
                onClick={handleCancelEdit}
                style={{
                  background: 'transparent',
                  color: '#94a3b8',
                  border: '1px solid #475569',
                  borderRadius: '4px',
                  padding: '5px 10px',
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Instant Action Buttons */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          {row.aiSuggestion?.suggestedAccountCode && !isEditing && (
            <button
              type="button"
              onClick={() => onAcceptAI(row)}
              style={{
                background: '#10b981',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                padding: '7px 12px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 2px 4px rgba(16,185,129,0.3)',
              }}
            >
              ✓ Accept AI ({row.aiSuggestion.suggestedAccountCode})
            </button>
          )}
          {!isEditing && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              style={{
                background: '#1e293b',
                color: '#f8fafc',
                border: '1px solid #475569',
                borderRadius: '6px',
                padding: '7px 10px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              ✎ Edit Code
            </button>
          )}
          <button
            type="button"
            onClick={() => onDiscard(row)}
            style={{
              background: 'transparent',
              color: '#ef4444',
              border: '1px solid #7f1d1d',
              borderRadius: '6px',
              padding: '7px 10px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ✕ Discard
          </button>
        </div>
      </div>
    </div>
  );
}

// React.memo prevents re-rendering when sibling rows change:
export const FolderBRow = memo(FolderBRowComponent, (prevProps, nextProps) => {
  return (
    prevProps.row === nextProps.row &&
    prevProps.onAcceptAI === nextProps.onAcceptAI &&
    prevProps.onEditCode === nextProps.onEditCode &&
    prevProps.onDiscard === nextProps.onDiscard
  );
});
