'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav style={{
      background: 'rgba(13, 19, 34, 0.95)',
      borderBottom: '1px solid #23304c',
      padding: '14px 24px',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      backdropFilter: 'blur(10px)',
    }}>
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '12px',
      }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '22px' }}>⚡</span>
            <span style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.5px' }}>
              I-FINT <span style={{ color: '#f59e0b' }}>DEN</span>
            </span>
          </Link>
          <span style={{
            fontSize: '11px',
            fontWeight: 700,
            background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
            color: '#ffffff',
            padding: '3px 8px',
            borderRadius: '4px',
            letterSpacing: '0.5px',
          }}>
            BY INDUS TECH
          </span>
        </div>

        {/* Navigation Links */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Link
            href="/"
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              textDecoration: 'none',
              fontSize: '14px',
              fontWeight: 600,
              background: pathname === '/' ? '#2563eb' : 'transparent',
              color: pathname === '/' ? '#ffffff' : '#94a3b8',
              transition: 'all 0.2s ease',
            }}
          >
            ⚡ Data Cleaning Pipeline
          </Link>
          <Link
            href="/reports"
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              textDecoration: 'none',
              fontSize: '14px',
              fontWeight: 600,
              background: pathname === '/reports' ? '#2563eb' : 'transparent',
              color: pathname === '/reports' ? '#ffffff' : '#94a3b8',
              transition: 'all 0.2s ease',
            }}
          >
            📊 Financial Reports
          </Link>
        </div>

        {/* System Badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '12px',
            color: '#34d399',
            background: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid #059669',
            padding: '4px 10px',
            borderRadius: '6px',
            fontWeight: 700,
          }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#34d399', display: 'inline-block' }}></span>
            Double-Entry Engine
          </span>
          <span style={{
            fontSize: '12px',
            color: '#94a3b8',
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid #23304c',
            padding: '4px 10px',
            borderRadius: '6px',
          }}>
            Client 1
          </span>
        </div>
      </div>
    </nav>
  );
}
