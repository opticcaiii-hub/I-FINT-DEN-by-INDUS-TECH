'use client';

import React, { useState, useMemo, useEffect } from 'react';

export interface HeldBackItem {
  row: any;
  reason: string;
}

export interface BatchAcceptPreviewModalProps {
  isOpen: boolean;
  eligibleRows: any[];
  heldBackRows: HeldBackItem[];
  onClose: () => void;
  onConfirm: (selectedRows: any[]) => void;
}

export function BatchAcceptPreviewModal({
  isOpen,
  eligibleRows,
  heldBackRows,
  onClose,
  onConfirm,
}: BatchAcceptPreviewModalProps) {
  // Set of selected row indices (default all eligible selected)
  const [selectedRowIndices, setSelectedRowIndices] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState<'eligible' | 'heldback'>('eligible');

  useEffect(() => {
    if (isOpen) {
      setSelectedRowIndices(new Set(eligibleRows.map((r) => r.rowIndex)));
      setActiveTab('eligible');
    }
  }, [isOpen, eligibleRows]);

  // Toggle selection for a row
  function toggleRow(rowIndex: number) {
    setSelectedRowIndices((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  }

  function toggleAll() {
    if (selectedRowIndices.size === eligibleRows.length) {
      setSelectedRowIndices(new Set());
    } else {
      setSelectedRowIndices(new Set(eligibleRows.map((r) => r.rowIndex)));
    }
  }

  // Filter currently selected rows
  const selectedRows = useMemo(
    () => eligibleRows.filter((r) => selectedRowIndices.has(r.rowIndex)),
    [eligibleRows, selectedRowIndices]
  );

  // Financial calculations for selected rows
  const totalDebitPKR = useMemo(
    () =>
      selectedRows.reduce(
        (sum, r) => sum + (Number(r.normalizedData?.debitPaisa || (r.rawInput?.Debit ? Number(r.rawInput.Debit) * 100 : 0)) || 0),
        0
      ) / 100,
    [selectedRows]
  );

  const totalCreditPKR = useMemo(
    () =>
      selectedRows.reduce(
        (sum, r) => sum + (Number(r.normalizedData?.creditPaisa || (r.rawInput?.Credit ? Number(r.rawInput.Credit) * 100 : 0)) || 0),
        0
      ) / 100,
    [selectedRows]
  );

  // Account distribution aggregation
  const accountDistribution = useMemo(() => {
    const dist: Record<string, { code: string; name: string; count: number; totalPKR: number }> = {};
    for (const r of selectedRows) {
      const code = r.aiSuggestion?.suggestedAccountCode || 'Unknown';
      const name = r.aiSuggestion?.suggestedAccountName || 'Unassigned';
      const amount = (Number(r.normalizedData?.amountPaisa) || 0) / 100;

      if (!dist[code]) {
        dist[code] = { code, name, count: 0, totalPKR: 0 };
      }
      dist[code].count += 1;
      dist[code].totalPKR += amount;
    }
    return Object.values(dist).sort((a, b) => b.count - a.count);
  }, [selectedRows]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(3, 7, 18, 0.85)',
        backdropFilter: 'blur(6px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        className="glass-card"
        style={{
          background: '#0b1329',
          border: '1px solid #3b82f6',
          borderRadius: '14px',
          width: '100%',
          maxWidth: '920px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
          overflow: 'hidden',
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid #1e293b',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'rgba(15, 23, 42, 0.6)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '22px' }}>⚡</span>
              <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                Batch Accept AI Suggestions
              </h2>
            </div>
            <p style={{ fontSize: '12px', color: '#94a3b8', margin: '4px 0 0 32px' }}>
              Review the destination account mapping and confirm transfer to Folder A (Ready to Post).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: '20px',
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '6px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Body (Scrollable) */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* Summary Metric Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            <div style={{ background: 'rgba(30, 41, 59, 0.5)', border: '1px solid #334155', borderRadius: '8px', padding: '12px 16px' }}>
              <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>
                Items to Transfer
              </div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: '#38bdf8', marginTop: '4px' }}>
                {selectedRows.length} <span style={{ fontSize: '12px', color: '#64748b' }}>of {eligibleRows.length} eligible</span>
              </div>
            </div>

            <div style={{ background: 'rgba(30, 41, 59, 0.5)', border: '1px solid #334155', borderRadius: '8px', padding: '12px 16px' }}>
              <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>
                Total Monetary Impact
              </div>
              <div style={{ fontSize: '16px', fontWeight: 800, color: '#34d399', marginTop: '6px' }}>
                PKR {(totalDebitPKR + totalCreditPKR).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>

            <div style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid #d97706', borderRadius: '8px', padding: '12px 16px' }}>
              <div style={{ fontSize: '11px', color: '#fbbf24', textTransform: 'uppercase', fontWeight: 700 }}>
                Remaining in Folder B
              </div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: '#fbbf24', marginTop: '4px' }}>
                {heldBackRows.length + (eligibleRows.length - selectedRows.length)} items
              </div>
            </div>
          </div>

          {/* Account Category Distribution Breakdown */}
          {accountDistribution.length > 0 && (
            <div style={{ background: '#070d19', border: '1px solid #1e293b', borderRadius: '8px', padding: '14px 16px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#cbd5e1', marginBottom: '10px' }}>
                📊 Destination Account Distribution ({accountDistribution.length} accounts):
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {accountDistribution.map((acc) => (
                  <div
                    key={acc.code}
                    style={{
                      background: '#0f172a',
                      border: '1px solid #334155',
                      borderRadius: '6px',
                      padding: '6px 10px',
                      fontSize: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <span style={{ fontWeight: 800, color: '#38bdf8' }}>{acc.code}</span>
                    <span style={{ color: '#e2e8f0' }}>{acc.name}</span>
                    <span style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', padding: '1px 6px', borderRadius: '4px', fontWeight: 700, fontSize: '11px' }}>
                      {acc.count} rows
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tab Navigation: Eligible vs Held-Back */}
          <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #1e293b', paddingBottom: '8px' }}>
            <button
              type="button"
              onClick={() => setActiveTab('eligible')}
              style={{
                background: activeTab === 'eligible' ? 'rgba(37, 99, 235, 0.2)' : 'transparent',
                border: activeTab === 'eligible' ? '1px solid #2563eb' : '1px solid transparent',
                color: activeTab === 'eligible' ? '#60a5fa' : '#94a3b8',
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Eligible Items ({eligibleRows.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('heldback')}
              style={{
                background: activeTab === 'heldback' ? 'rgba(245, 158, 11, 0.2)' : 'transparent',
                border: activeTab === 'heldback' ? '1px solid #d97706' : '1px solid transparent',
                color: activeTab === 'heldback' ? '#fbbf24' : '#94a3b8',
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Held-Back Items ({heldBackRows.length})
            </button>
          </div>

          {/* TAB 1: Eligible Items Table with Checkboxes */}
          {activeTab === 'eligible' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                  Uncheck any row you want to keep in Folder B for manual double-checking:
                </span>
                <button
                  type="button"
                  onClick={toggleAll}
                  style={{
                    background: 'transparent',
                    border: '1px solid #334155',
                    color: '#cbd5e1',
                    borderRadius: '4px',
                    padding: '3px 8px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {selectedRowIndices.size === eligibleRows.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>

              <div style={{ maxHeight: '340px', overflowY: 'auto', border: '1px solid #1e293b', borderRadius: '8px', background: '#070d19' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: '#0f172a', borderBottom: '1px solid #334155', color: '#94a3b8', position: 'sticky', top: 0, zIndex: 1 }}>
                      <th style={{ padding: '8px 10px', textAlign: 'center', width: '40px' }}>
                        <input
                          type="checkbox"
                          checked={selectedRowIndices.size === eligibleRows.length && eligibleRows.length > 0}
                          onChange={toggleAll}
                          style={{ cursor: 'pointer' }}
                        />
                      </th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', width: '60px' }}>Row #</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left' }}>Description</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', width: '110px' }}>Amount (PKR)</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', width: '220px' }}>Suggested Account</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center', width: '70px' }}>Conf.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eligibleRows.map((r) => {
                      const isSelected = selectedRowIndices.has(r.rowIndex);
                      const amountPKR = ((Number(r.normalizedData?.amountPaisa) || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 });
                      return (
                        <tr
                          key={r.rowIndex}
                          onClick={() => toggleRow(r.rowIndex)}
                          style={{
                            cursor: 'pointer',
                            background: isSelected ? 'rgba(30, 41, 59, 0.4)' : 'transparent',
                            borderBottom: '1px solid #1e293b',
                            opacity: isSelected ? 1 : 0.45,
                          }}
                        >
                          <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleRow(r.rowIndex)}
                              onClick={(e) => e.stopPropagation()}
                              style={{ cursor: 'pointer' }}
                            />
                          </td>
                          <td style={{ padding: '8px 10px', fontWeight: 700, color: '#94a3b8' }}>
                            #{r.rowIndex}
                          </td>
                          <td style={{ padding: '8px 10px', color: '#e2e8f0', fontWeight: 500 }}>
                            {r.normalizedData?.description || r.rawInput?.Description || 'Transaction'}
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: '#38bdf8', fontFamily: 'monospace' }}>
                            {amountPKR}
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            <span style={{ fontWeight: 700, color: '#34d399', marginRight: '6px' }}>
                              {r.aiSuggestion?.suggestedAccountCode}
                            </span>
                            <span style={{ color: '#cbd5e1', fontSize: '11px' }}>
                              {r.aiSuggestion?.suggestedAccountName}
                            </span>
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                            <span style={{ background: 'rgba(16, 185, 129, 0.2)', color: '#34d399', padding: '2px 6px', borderRadius: '4px', fontWeight: 800, fontSize: '11px' }}>
                              {r.aiSuggestion?.confidenceScore}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: Held-Back / Excluded Items with Explicit Reasons */}
          {activeTab === 'heldback' && (
            <div>
              <div style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid #d97706', borderRadius: '8px', padding: '12px 16px', marginBottom: '10px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>⚠️</span>
                  <span>Explicit Warning: These {heldBackRows.length} items will NOT be moved and remain in Folder B:</span>
                </div>
              </div>

              {heldBackRows.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                  ✓ No items are held back — all Folder B items met the threshold and criteria!
                </div>
              ) : (
                <div style={{ maxHeight: '340px', overflowY: 'auto', border: '1px solid #1e293b', borderRadius: '8px', background: '#070d19' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ background: '#0f172a', borderBottom: '1px solid #334155', color: '#94a3b8', position: 'sticky', top: 0, zIndex: 1 }}>
                        <th style={{ padding: '8px 10px', textAlign: 'left', width: '60px' }}>Row #</th>
                        <th style={{ padding: '8px 10px', textAlign: 'left' }}>Description</th>
                        <th style={{ padding: '8px 10px', textAlign: 'right', width: '110px' }}>Amount (PKR)</th>
                        <th style={{ padding: '8px 10px', textAlign: 'left' }}>Reason Held Back</th>
                      </tr>
                    </thead>
                    <tbody>
                      {heldBackRows.map(({ row, reason }, idx) => {
                        const amountPKR = ((Number(row.normalizedData?.amountPaisa) || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 });
                        return (
                          <tr key={idx} style={{ borderBottom: '1px solid #1e293b', background: 'rgba(15, 23, 42, 0.3)' }}>
                            <td style={{ padding: '8px 10px', fontWeight: 700, color: '#fbbf24' }}>
                              #{row.rowIndex}
                            </td>
                            <td style={{ padding: '8px 10px', color: '#cbd5e1' }}>
                              {row.normalizedData?.description || row.rawInput?.Description || 'Transaction'}
                            </td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: '#94a3b8', fontFamily: 'monospace' }}>
                              {amountPKR}
                            </td>
                            <td style={{ padding: '8px 10px', color: '#f87171', fontSize: '11px', fontWeight: 600 }}>
                              {reason}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid #1e293b',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'rgba(15, 23, 42, 0.6)',
          }}
        >
          <div style={{ fontSize: '12px', color: '#94a3b8' }}>
            🔒 <strong style={{ color: '#cbd5e1' }}>Maker-Checker Notice:</strong> Rows move to Folder A for final review before General Ledger commit.
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'transparent',
                border: '1px solid #334155',
                color: '#cbd5e1',
                padding: '8px 16px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>

            <button
              type="button"
              disabled={selectedRows.length === 0}
              onClick={() => onConfirm(selectedRows)}
              style={{
                background: selectedRows.length > 0 ? 'linear-gradient(135deg, #059669, #10b981)' : '#334155',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                padding: '8px 20px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: selectedRows.length > 0 ? 'pointer' : 'not-allowed',
                boxShadow: selectedRows.length > 0 ? '0 2px 10px rgba(16, 185, 129, 0.4)' : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span>Confirm & Transfer {selectedRows.length} Rows to Folder A</span>
              <span>✓</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
