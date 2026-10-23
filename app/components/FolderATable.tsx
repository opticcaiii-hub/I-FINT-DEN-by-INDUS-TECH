'use client';

import React, { memo } from 'react';

export interface FolderATableProps {
  readyRows: any[];
  expanded: boolean;
  onToggleExpanded: () => void;
  blockers?: string[];
}

function FolderATableComponent({ readyRows, expanded, onToggleExpanded, blockers = [] }: FolderATableProps) {
  const hasBlockers = blockers.length > 0;

  return (
    <div
      className="glass-card"
      style={{
        background: 'rgba(18, 26, 44, 0.85)',
        border: hasBlockers ? '1px solid #ef4444' : '1px solid #059669',
        borderRadius: '12px',
        padding: '20px',
        marginBottom: '32px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '20px', color: hasBlockers ? '#f87171' : '#34d399' }}>
            {hasBlockers ? '⚠️' : '✅'}
          </span>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 800, color: hasBlockers ? '#f87171' : '#34d399', margin: 0 }}>
              Folder A: Ready to Post ({readyRows.length} transactions)
            </h2>
            <div style={{ fontSize: '12px', marginTop: '2px' }}>
              {hasBlockers ? (
                <span style={{ color: '#f87171', fontWeight: 700 }}>
                  ⚠️ {blockers.length} Blocker{blockers.length > 1 ? 's' : ''} Detected ({blockers.join(' • ')})
                </span>
              ) : readyRows.length > 0 ? (
                <span style={{ color: '#34d399', fontWeight: 600 }}>
                  Balanced Entries | Valid Chart of Accounts | Zero Blockers
                </span>
              ) : (
                <span style={{ color: '#94a3b8' }}>
                  Awaiting validated transactions from Folder B
                </span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onToggleExpanded}
          style={{
            background: 'transparent',
            border: '1px solid #334155',
            color: '#94a3b8',
            padding: '6px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            cursor: 'pointer',
          }}
        >
          {expanded ? 'Collapse Preview ▲' : 'Expand Preview ▼'}
        </button>
      </div>

      {readyRows.length === 0 ? (
        <div style={{ color: '#94a3b8', fontSize: '14px', textAlign: 'center', padding: '24px 0' }}>
          No transactions ready yet. Resolve items in Folder B above to move them here.
        </div>
      ) : expanded ? (
        <div style={{ maxHeight: '340px', overflowY: 'auto', border: '1px solid #1e293b', borderRadius: '8px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: 'rgba(0,0,0,0.4)', borderBottom: '1px solid #334155', color: '#94a3b8', textAlign: 'left' }}>
                <th style={{ padding: '8px 10px' }}>Row</th>
                <th style={{ padding: '8px 10px' }}>Group / Ref</th>
                <th style={{ padding: '8px 10px' }}>Date</th>
                <th style={{ padding: '8px 10px' }}>Description</th>
                <th style={{ padding: '8px 10px' }}>Account Code</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Debit (PKR)</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Credit (PKR)</th>
                <th style={{ padding: '8px 10px', textAlign: 'center' }}>Audit Status</th>
              </tr>
            </thead>
            <tbody>
              {readyRows.map(r => {
                const txGroupId =
                  r?.normalizedData?.transactionGroupId ||
                  r?.normalizedData?.transaction_group_id ||
                  r?.normalizedData?.transaction_external_id ||
                  r?.normalizedData?.transactionId ||
                  r?.rawInput?.transaction_external_id ||
                  '';
                const debit = Number(r.normalizedData?.debitPaisa) || 0;
                const credit = Number(r.normalizedData?.creditPaisa) || 0;
                const amount = Number(r.normalizedData?.amountPaisa) || 0;

                return (
                  <tr key={r.rowIndex} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: '8px 10px', color: '#64748b' }}>#{r.rowIndex}</td>
                    <td style={{ padding: '8px 10px', color: '#38bdf8', fontSize: '12px' }}>
                      {txGroupId ? `${txGroupId}` : r.normalizedData?.referenceNumber || '-'}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#cbd5e1' }}>
                      {r.normalizedData?.date || r.normalizedData?.entry_date || '-'}
                    </td>
                    <td style={{ padding: '8px 10px', fontWeight: 600, color: '#f8fafc' }}>
                      {r.normalizedData?.description || r.normalizedData?.line_description || '-'}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#38bdf8', fontWeight: 700 }}>
                      {r.normalizedData?.accountCode}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: debit ? '#34d399' : '#64748b' }}>
                      {debit ? (debit / 100).toLocaleString() : amount && !credit ? (amount / 100).toLocaleString() : '-'}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: credit ? '#38bdf8' : '#64748b' }}>
                      {credit ? (credit / 100).toLocaleString() : '-'}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                      <span style={{ background: 'rgba(16, 185, 129, 0.2)', color: '#34d399', padding: '2px 6px', borderRadius: '4px', fontSize: '11px' }}>
                        Verified
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export const FolderATable = memo(FolderATableComponent, (prev, next) => {
  return (
    prev.readyRows === next.readyRows &&
    prev.expanded === next.expanded &&
    JSON.stringify(prev.blockers) === JSON.stringify(next.blockers)
  );
});
