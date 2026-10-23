'use client';

import React, { useMemo } from 'react';

export interface FolderBBatchActionBarProps {
  flaggedRows: any[];
  readyRows: any[];
  threshold: number;
  onThresholdChange: (newThreshold: number) => void;
  onOpenPreview: (eligibleRows: any[], heldBackRows: Array<{ row: any; reason: string }>) => void;
}

function getRowGroupId(r: any): string {
  return (
    r?.normalizedData?.transactionGroupId ||
    r?.normalizedData?.transaction_group_id ||
    r?.normalizedData?.transaction_external_id ||
    r?.normalizedData?.transactionId ||
    r?.rawInput?.transaction_external_id ||
    r?.rawInput?.transaction_group_id ||
    r?.rawInput?.transactionGroupId ||
    r?.transactionGroupId ||
    r?.transaction_group_id ||
    r?.transaction_external_id ||
    ''
  ).toString().trim();
}

export function FolderBBatchActionBar({
  flaggedRows,
  readyRows,
  threshold,
  onThresholdChange,
  onOpenPreview,
}: FolderBBatchActionBarProps) {
  // Partition flaggedRows into eligible vs heldBack
  const { eligibleRows, heldBackRows } = useMemo(() => {
    const eligible: any[] = [];
    const heldBack: Array<{ row: any; reason: string }> = [];

    // Group rows by txGroupId
    const groups: Record<string, any[]> = {};
    const singleRows: any[] = [];

    for (const row of flaggedRows) {
      const gid = getRowGroupId(row);
      if (gid) {
        if (!groups[gid]) groups[gid] = [];
        groups[gid].push(row);
      } else {
        singleRows.push(row);
      }
    }

    // Process single-line rows
    for (const row of singleRows) {
      const code = row.aiSuggestion?.suggestedAccountCode;
      const conf = Number(row.aiSuggestion?.confidenceScore) || 0;

      if (!code) {
        heldBack.push({ row, reason: 'Ambiguity guard — manual account assignment required' });
      } else if (conf < threshold) {
        heldBack.push({ row, reason: `Confidence score (${conf}%) is below the ${threshold}% threshold` });
      } else {
        eligible.push(row);
      }
    }

    // Process multi-line groups atomically
    for (const [gid, gRows] of Object.entries(groups)) {
      const allInReady = readyRows.filter(r => getRowGroupId(r) === gid);
      const allRows = [...gRows, ...allInReady];

      const allHaveCodes = allRows.every(r => Boolean(r.normalizedData?.accountCode || r.aiSuggestion?.suggestedAccountCode));
      const allAboveThreshold = gRows.every(r => (Number(r.aiSuggestion?.confidenceScore) || 0) >= threshold);
      const totalDebits = allRows.reduce((sum, r) => sum + (Number(r.normalizedData?.debitPaisa) || 0), 0);
      const totalCredits = allRows.reduce((sum, r) => sum + (Number(r.normalizedData?.creditPaisa) || 0), 0);
      const isBalanced = totalDebits === totalCredits && allRows.length >= 2;

      if (!allHaveCodes) {
        for (const r of gRows) {
          heldBack.push({ row: r, reason: `Multi-line group "${gid}": missing suggested account code on one or more lines` });
        }
      } else if (!allAboveThreshold) {
        for (const r of gRows) {
          const conf = Number(r.aiSuggestion?.confidenceScore) || 0;
          heldBack.push({
            row: r,
            reason: `Multi-line group "${gid}": line confidence (${conf}%) below ${threshold}% threshold`,
          });
        }
      } else if (!isBalanced) {
        const diffPKR = Math.abs(totalDebits - totalCredits) / 100;
        for (const r of gRows) {
          heldBack.push({
            row: r,
            reason: `Multi-line group "${gid}" unbalanced: Debit PKR ${(totalDebits / 100).toLocaleString()} ≠ Credit PKR ${(totalCredits / 100).toLocaleString()} (Δ PKR ${diffPKR.toLocaleString()})`,
          });
        }
      } else {
        for (const r of gRows) {
          eligible.push(r);
        }
      }
    }

    return { eligibleRows: eligible, heldBackRows: heldBack };
  }, [flaggedRows, readyRows, threshold]);

  const eligibleCount = eligibleRows.length;
  const totalCount = flaggedRows.length;

  if (totalCount === 0) return null;

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.85), rgba(15, 23, 42, 0.95))',
        border: '1px solid #3b82f6',
        borderRadius: '10px',
        padding: '14px 18px',
        marginBottom: '16px',
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '14px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
      }}
    >
      {/* Left: Title & Confidence Slider */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '18px' }}>⚡</span>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 800, color: '#f8fafc', letterSpacing: '0.3px' }}>
              Batch Action: Accept High Confidence
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>
              Transfers qualifying items from Folder B into Folder A (Ready to Post)
            </div>
          </div>
        </div>

        {/* Threshold Slider & Value */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            background: '#0f172a',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '4px 12px',
          }}
        >
          <label style={{ fontSize: '12px', fontWeight: 700, color: '#cbd5e1' }}>
            Min Confidence:
          </label>
          <input
            type="range"
            min={75}
            max={100}
            step={1}
            value={threshold}
            onChange={(e) => onThresholdChange(Math.max(75, Math.min(100, Number(e.target.value))))}
            style={{ width: '90px', accentColor: '#38bdf8', cursor: 'pointer' }}
          />
          <span
            style={{
              fontSize: '13px',
              fontWeight: 800,
              color: '#38bdf8',
              minWidth: '40px',
              textAlign: 'right',
            }}
          >
            ≥ {threshold}%
          </span>
        </div>
      </div>

      {/* Right: Match Stats Badge & Action Button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div
          style={{
            fontSize: '12px',
            fontWeight: 700,
            padding: '4px 10px',
            borderRadius: '6px',
            background: eligibleCount > 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
            color: eligibleCount > 0 ? '#34d399' : '#f87171',
            border: `1px solid ${eligibleCount > 0 ? '#059669' : '#b91c1c'}`,
          }}
        >
          {eligibleCount} of {totalCount} items eligible
        </div>

        <button
          type="button"
          disabled={eligibleCount === 0}
          onClick={() => onOpenPreview(eligibleRows, heldBackRows)}
          style={{
            background: eligibleCount > 0 ? 'linear-gradient(135deg, #2563eb, #1d4ed8)' : '#334155',
            color: eligibleCount > 0 ? '#ffffff' : '#64748b',
            border: 'none',
            borderRadius: '6px',
            padding: '8px 16px',
            fontSize: '12px',
            fontWeight: 700,
            cursor: eligibleCount > 0 ? 'pointer' : 'not-allowed',
            boxShadow: eligibleCount > 0 ? '0 2px 8px rgba(37, 99, 235, 0.4)' : 'none',
            transition: 'all 0.15s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span>Review & Batch Accept ({eligibleCount})</span>
          <span>→</span>
        </button>
      </div>
    </div>
  );
}
