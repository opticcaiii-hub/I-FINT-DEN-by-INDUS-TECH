import type { Metadata } from 'next';
import './globals.css';
import Navbar from './components/Navbar';

export const metadata: Metadata = {
  title: 'I-FINT DEN by INDUS TECH — AI Financial Intelligence & Reporting Engine',
  description: 'Intelligent Two-Folder Financial Ingestion Pipeline, Machine Learning Outlier Detection & Instant Double-Entry Statutory Financial Reports.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: '#070a11', color: '#f8fafc', minHeight: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}>
        <Navbar />
        <main>{children}</main>
      </body>
    </html>
  );
}
