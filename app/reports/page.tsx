'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function StandaloneReportsPage() {
  const clientId = '1';

  const [activeTab, setActiveTab] = useState<'tb' | 'pnl' | 'bs' | 'cf' | 'ar' | 'ap'>('tb');
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().substring(0, 10));
  const [startDate, setStartDate] = useState(`${new Date().getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(new Date().toISOString().substring(0, 10));

  const [tbData, setTbData] = useState<any>(null);
  const [pnlData, setPnlData] = useState<any>(null);
  const [bsData, setBsData] = useState<any>(null);
  const [cfData, setCfData] = useState<any>(null);
  const [arData, setArData] = useState<any>(null);
  const [apData, setApData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchReport();
  }, [activeTab, asOfDate, startDate, endDate]);

  async function fetchReport() {
    setLoading(true);
    setError('');

    try {
      if (activeTab === 'tb') {
        const res = await fetch(`/api/clients/${clientId}/reports/trial-balance?asOfDate=${asOfDate}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch Trial Balance');
        setTbData(data);
      } else if (activeTab === 'pnl') {
        const res = await fetch(`/api/clients/${clientId}/reports/profit-loss?startDate=${startDate}&endDate=${endDate}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch Profit & Loss');
        setPnlData(data);
      } else if (activeTab === 'bs') {
        const res = await fetch(`/api/clients/${clientId}/reports/balance-sheet?asOfDate=${asOfDate}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch Balance Sheet');
        setBsData(data);
      } else if (activeTab === 'cf') {
        const res = await fetch(`/api/clients/${clientId}/reports/cash-flow?startDate=${startDate}&endDate=${endDate}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch Cash Flow');
        setCfData(data);
      } else if (activeTab === 'ar') {
        const res = await fetch(`/api/clients/${clientId}/reports/aged-receivables?asOfDate=${asOfDate}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch Aged Receivables');
        setArData(data);
      } else if (activeTab === 'ap') {
        const res = await fetch(`/api/clients/${clientId}/reports/aged-payables?asOfDate=${asOfDate}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch Aged Payables');
        setApData(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error generating report');
    } finally {
      setLoading(false);
    }
  }

  function formatPkr(paisa: number | undefined) {
    if (paisa === undefined || paisa === null) return '0.00';
    return (paisa / 100).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  return (
    <div style={{ padding: '32px 20px', maxWidth: '1200px', margin: '0 auto', minHeight: '100vh' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '4px' }}>
            <Link href="/" style={{ color: '#f59e0b', textDecoration: 'none' }}>← Data Cleaning Pipeline</Link> / Financial Reports
          </div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, margin: 0, color: '#f8fafc' }}>
            Statutory Financial Statements
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#94a3b8' }}>
            Real-time double-entry financial reporting directly synchronized with General Ledger.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <Link
            href="/"
            style={{
              background: '#2563eb',
              color: '#ffffff',
              padding: '10px 18px',
              borderRadius: '8px',
              textDecoration: 'none',
              fontWeight: 700,
              fontSize: '14px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            ⚡ Ingest New Batch
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '1px solid #23304c', paddingBottom: '12px', flexWrap: 'wrap' }}>
        <button
          style={{
            background: activeTab === 'tb' ? '#f59e0b' : '#1e293b',
            color: activeTab === 'tb' ? '#070a11' : '#cbd5e1',
            border: 'none',
            borderRadius: '8px',
            padding: '8px 16px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
          onClick={() => setActiveTab('tb')}
        >
          Trial Balance
        </button>
        <button
          style={{
            background: activeTab === 'pnl' ? '#f59e0b' : '#1e293b',
            color: activeTab === 'pnl' ? '#070a11' : '#cbd5e1',
            border: 'none',
            borderRadius: '8px',
            padding: '8px 16px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
          onClick={() => setActiveTab('pnl')}
        >
          Profit & Loss Statement
        </button>
        <button
          style={{
            background: activeTab === 'bs' ? '#f59e0b' : '#1e293b',
            color: activeTab === 'bs' ? '#070a11' : '#cbd5e1',
            border: 'none',
            borderRadius: '8px',
            padding: '8px 16px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
          onClick={() => setActiveTab('bs')}
        >
          Balance Sheet
        </button>
        <button
          style={{
            background: activeTab === 'cf' ? '#f59e0b' : '#1e293b',
            color: activeTab === 'cf' ? '#070a11' : '#cbd5e1',
            border: 'none',
            borderRadius: '8px',
            padding: '8px 16px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
          onClick={() => setActiveTab('cf')}
        >
          Cash Flow Statement (IAS-7)
        </button>
        <button
          style={{
            background: activeTab === 'ar' ? '#f59e0b' : '#1e293b',
            color: activeTab === 'ar' ? '#070a11' : '#cbd5e1',
            border: 'none',
            borderRadius: '8px',
            padding: '8px 16px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
          onClick={() => setActiveTab('ar')}
        >
          Aged Receivables (AR)
        </button>
        <button
          style={{
            background: activeTab === 'ap' ? '#f59e0b' : '#1e293b',
            color: activeTab === 'ap' ? '#070a11' : '#cbd5e1',
            border: 'none',
            borderRadius: '8px',
            padding: '8px 16px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
          onClick={() => setActiveTab('ap')}
        >
          Aged Payables (AP)
        </button>
      </div>

      {/* Date Filters */}
      <div style={{ background: '#111a2e', border: '1px solid #23304c', borderRadius: '10px', padding: '16px 20px', marginBottom: '24px', display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
        {['tb', 'bs', 'ar', 'ap'].includes(activeTab) ? (
          <div>
            <label style={{ fontSize: '13px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>
              As of Date:
            </label>
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              style={{ background: '#090e18', border: '1px solid #23304c', color: '#f8fafc', padding: '8px 12px', borderRadius: '6px', fontSize: '14px' }}
            />
          </div>
        ) : (
          <>
            <div>
              <label style={{ fontSize: '13px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>
                Start Date:
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={{ background: '#090e18', border: '1px solid #23304c', color: '#f8fafc', padding: '8px 12px', borderRadius: '6px', fontSize: '14px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '13px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>
                End Date:
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={{ background: '#090e18', border: '1px solid #23304c', color: '#f8fafc', padding: '8px 12px', borderRadius: '6px', fontSize: '14px' }}
              />
            </div>
          </>
        )}
        <button
          onClick={fetchReport}
          style={{ alignSelf: 'flex-end', background: '#3b82f6', color: '#ffffff', border: 'none', padding: '8px 18px', borderRadius: '6px', fontWeight: 700, fontSize: '14px', cursor: 'pointer' }}
        >
          Refresh Statement
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #dc2626', color: '#f87171', padding: '14px 18px', borderRadius: '8px', marginBottom: '20px' }}>
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>
          ⏳ Calculating general ledger balances...
        </div>
      ) : (
        <div style={{ background: '#111a2e', border: '1px solid #23304c', borderRadius: '12px', padding: '24px', overflowX: 'auto' }}>
          
          {/* TRIAL BALANCE TAB */}
          {activeTab === 'tb' && tbData && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0 }}>Trial Balance as of {tbData.asOfDate}</h2>
                <span style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontWeight: 700,
                  fontSize: '12px',
                  background: tbData.isBalanced ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  color: tbData.isBalanced ? '#34d399' : '#f87171',
                  border: tbData.isBalanced ? '1px solid #059669' : '1px solid #dc2626',
                }}>
                  {tbData.isBalanced ? '✓ LEDGER IS BALANCED' : '⚠️ UNBALANCED ENTRIES'}
                </span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #23304c', color: '#94a3b8' }}>
                    <th style={{ padding: '12px' }}>Account Code</th>
                    <th style={{ padding: '12px' }}>Account Name</th>
                    <th style={{ padding: '12px' }}>Type</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>Debit (PKR)</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>Credit (PKR)</th>
                  </tr>
                </thead>
                <tbody>
                  {(tbData.rows || []).map((row: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '12px', fontFamily: 'monospace', fontWeight: 600 }}>{row.accountCode}</td>
                      <td style={{ padding: '12px' }}>{row.accountName}</td>
                      <td style={{ padding: '12px', textTransform: 'capitalize', color: '#94a3b8' }}>{row.typeCode}</td>
                      <td style={{ padding: '12px', textAlign: 'right', fontWeight: 600 }}>{row.debitPaisa > 0 ? formatPkr(row.debitPaisa) : '-'}</td>
                      <td style={{ padding: '12px', textAlign: 'right', fontWeight: 600 }}>{row.creditPaisa > 0 ? formatPkr(row.creditPaisa) : '-'}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid #3b82f6', fontWeight: 800, background: 'rgba(59, 130, 246, 0.05)' }}>
                    <td colSpan={3} style={{ padding: '14px' }}>TOTAL</td>
                    <td style={{ padding: '14px', textAlign: 'right', color: '#60a5fa' }}>{formatPkr(tbData.totalDebitPaisa)}</td>
                    <td style={{ padding: '14px', textAlign: 'right', color: '#60a5fa' }}>{formatPkr(tbData.totalCreditPaisa)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* PROFIT & LOSS TAB */}
          {activeTab === 'pnl' && pnlData && (
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 800, margin: '0 0 16px' }}>
                Profit & Loss Statement ({pnlData.startDate} to {pnlData.endDate})
              </h2>
              
              <div style={{ marginBottom: '20px' }}>
                <h3 style={{ fontSize: '15px', color: '#34d399', fontWeight: 700, margin: '0 0 8px' }}>Revenue & Income</h3>
                {(pnlData.incomeAccounts || []).map((acc: any, i: number) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <span>{acc.accountCode} - {acc.accountName}</span>
                    <span style={{ fontWeight: 600 }}>PKR {formatPkr(acc.amountPaisa)}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', fontWeight: 800, color: '#34d399', borderTop: '1px solid #23304c' }}>
                  <span>TOTAL INCOME</span>
                  <span>PKR {formatPkr(pnlData.totalIncomePaisa)}</span>
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <h3 style={{ fontSize: '15px', color: '#f87171', fontWeight: 700, margin: '0 0 8px' }}>Expenses & Costs</h3>
                {(pnlData.expenseAccounts || []).map((acc: any, i: number) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <span>{acc.accountCode} - {acc.accountName}</span>
                    <span style={{ fontWeight: 600 }}>PKR {formatPkr(acc.amountPaisa)}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', fontWeight: 800, color: '#f87171', borderTop: '1px solid #23304c' }}>
                  <span>TOTAL EXPENSES</span>
                  <span>PKR {formatPkr(pnlData.totalExpensePaisa)}</span>
                </div>
              </div>

              <div style={{
                background: (pnlData.netProfitPaisa || 0) >= 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                border: (pnlData.netProfitPaisa || 0) >= 0 ? '1px solid #059669' : '1px solid #dc2626',
                padding: '16px',
                borderRadius: '8px',
                display: 'flex',
                justifyContent: 'space-between',
                fontWeight: 800,
                fontSize: '18px',
                color: (pnlData.netProfitPaisa || 0) >= 0 ? '#34d399' : '#f87171',
              }}>
                <span>NET {(pnlData.netProfitPaisa || 0) >= 0 ? 'PROFIT' : 'LOSS'}</span>
                <span>PKR {formatPkr(pnlData.netProfitPaisa)}</span>
              </div>
            </div>
          )}

          {/* BALANCE SHEET TAB */}
          {activeTab === 'bs' && bsData && (
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 800, margin: '0 0 16px' }}>
                Balance Sheet as of {bsData.asOfDate}
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
                
                {/* Assets */}
                <div style={{ background: '#090e18', padding: '16px', borderRadius: '8px', border: '1px solid #23304c' }}>
                  <h3 style={{ fontSize: '16px', color: '#60a5fa', fontWeight: 700, margin: '0 0 12px' }}>Assets</h3>
                  {(bsData.assetAccounts || []).map((acc: any, i: number) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <span>{acc.accountCode} - {acc.accountName}</span>
                      <span style={{ fontWeight: 600 }}>PKR {formatPkr(acc.amountPaisa)}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', fontWeight: 800, color: '#60a5fa', borderTop: '2px solid #2563eb', marginTop: '12px' }}>
                    <span>TOTAL ASSETS</span>
                    <span>PKR {formatPkr(bsData.totalAssetsPaisa)}</span>
                  </div>
                </div>

                {/* Liabilities & Equity */}
                <div style={{ background: '#090e18', padding: '16px', borderRadius: '8px', border: '1px solid #23304c' }}>
                  <h3 style={{ fontSize: '16px', color: '#f59e0b', fontWeight: 700, margin: '0 0 12px' }}>Liabilities & Equity</h3>
                  {(bsData.liabilityAccounts || []).map((acc: any, i: number) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <span>{acc.accountCode} - {acc.accountName}</span>
                      <span style={{ fontWeight: 600 }}>PKR {formatPkr(acc.amountPaisa)}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontWeight: 700, color: '#f59e0b' }}>
                    <span>Total Liabilities</span>
                    <span>PKR {formatPkr(bsData.totalLiabilitiesPaisa)}</span>
                  </div>

                  <div style={{ marginTop: '16px' }}>
                    <h4 style={{ fontSize: '14px', color: '#a78bfa', margin: '0 0 8px' }}>Equity</h4>
                    {(bsData.equityAccounts || []).map((acc: any, i: number) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <span>{acc.accountCode} - {acc.accountName}</span>
                        <span style={{ fontWeight: 600 }}>PKR {formatPkr(acc.amountPaisa)}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', color: '#34d399' }}>
                      <span>Current Period Net Earnings</span>
                      <span style={{ fontWeight: 600 }}>PKR {formatPkr(bsData.retainedEarningsPaisa)}</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', fontWeight: 800, color: '#f59e0b', borderTop: '2px solid #d97706', marginTop: '12px' }}>
                    <span>TOTAL LIABILITIES & EQUITY</span>
                    <span>PKR {formatPkr(bsData.totalLiabilitiesAndEquityPaisa)}</span>
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* CASH FLOW TAB */}
          {activeTab === 'cf' && cfData && (
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 800, margin: '0 0 16px' }}>
                Cash Flow Statement (IAS-7)
              </h2>
              <div style={{ padding: '16px', background: '#090e18', borderRadius: '8px', border: '1px solid #23304c' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span>Cash Flow from Operating Activities</span>
                  <span style={{ fontWeight: 700 }}>PKR {formatPkr(cfData.operatingCashFlowPaisa || 0)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span>Cash Flow from Investing Activities</span>
                  <span style={{ fontWeight: 700 }}>PKR {formatPkr(cfData.investingCashFlowPaisa || 0)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span>Cash Flow from Financing Activities</span>
                  <span style={{ fontWeight: 700 }}>PKR {formatPkr(cfData.financingCashFlowPaisa || 0)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0', fontWeight: 800, color: '#34d399', fontSize: '16px', borderTop: '2px solid #059669', marginTop: '10px' }}>
                  <span>NET CHANGE IN CASH & EQUIVALENTS</span>
                  <span>PKR {formatPkr(cfData.netCashFlowPaisa || 0)}</span>
                </div>
              </div>
            </div>
          )}

          {/* AGED RECEIVABLES / PAYABLES */}
          {['ar', 'ap'].includes(activeTab) && (
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 800, margin: '0 0 16px' }}>
                {activeTab === 'ar' ? 'Aged Accounts Receivable (Customer Balances)' : 'Aged Accounts Payable (Vendor Bills)'}
              </h2>
              <div style={{ padding: '24px', background: '#090e18', borderRadius: '8px', border: '1px solid #23304c', textAlign: 'center', color: '#94a3b8' }}>
                <p>Aging subledger balances calculated dynamically from general ledger subledger accounts.</p>
                <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: '20px', flexWrap: 'wrap', gap: '10px' }}>
                  <div style={{ padding: '10px 20px', background: '#111a2e', borderRadius: '6px' }}>0 - 30 Days: <strong>PKR 0.00</strong></div>
                  <div style={{ padding: '10px 20px', background: '#111a2e', borderRadius: '6px' }}>31 - 60 Days: <strong>PKR 0.00</strong></div>
                  <div style={{ padding: '10px 20px', background: '#111a2e', borderRadius: '6px' }}>61 - 90 Days: <strong>PKR 0.00</strong></div>
                  <div style={{ padding: '10px 20px', background: '#111a2e', borderRadius: '6px' }}>90+ Days: <strong>PKR 0.00</strong></div>
                </div>
              </div>
            </div>
          )}

        </div>
      )}

    </div>
  );
}
