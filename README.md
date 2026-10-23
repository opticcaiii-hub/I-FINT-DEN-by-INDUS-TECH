# ⚡ I-FINT DEN by INDUS TECH
### *Autonomous AI Financial Ingestion Pipeline & Real-Time Statutory Accounting Engine*

[![Next.js 16](https://img.shields.io/badge/Next.js-16.3-black?logo=next.js)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19.2-blue?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL%20%2F%20Neon-336791?logo=postgresql)](https://neon.tech/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## 📌 Executive Summary

**I-FINT DEN by INDUS TECH** is an end-to-end financial intelligence platform designed to eliminate the single most painful bottleneck in accounting: **converting messy, disorganized raw transaction data into clean, compliant, double-entry General Ledger records and instant financial statements.**

---

## 🛑 The Problem: The Spreadsheet Nightmare

Every business, accounting firm, and finance professional faces the same daily struggle:

1. **Unformatted, Chaotic Data**: Transaction exports from banks, POS systems, payment gateways, and vendors arrive in completely different, inconsistent formats (messy CSVs, poorly aligned Excel sheets, unformatted text).
2. **Exhausting Manual Categorization**: Accountants spend hours manually guessing account codes, verifying dates, formatting amounts, and correcting typos.
3. **Hidden Anomalies & Outliers**: High-risk outliers, accidental duplicate transactions, and unbalanced debits/credits slip past human reviewers and contaminate financial records.
4. **Delayed Financial Reporting**: Generating a Trial Balance, Balance Sheet, or Profit & Loss statement often takes days or weeks of manual reconciliation.

---

## 💡 The Solution: I-FINT DEN

**I-FINT DEN by INDUS TECH** automates this entire pipeline into a fast, intuitive, 4-step workflow:

```
[ Messy Data / CSV / Clipboard ]
              │
              ▼
   ⚡ Intelligent Column Auto-Mapper & Header Detector
              │
              ▼
  ┌────────────────────────────────────────────────────────┐
  │         📂 THE TWO-FOLDER PARTITIONING PIPELINE        │
  │                                                        │
  │  📁 Folder A: Ready to Post     📁 Folder B: Review    │
  │     (Clean, 0 errors, auto-        (Flagged with ML    │
  │      validated transactions)        TreeSHAP anomalies │
  │                                     & 1-Click AI Fixes)│
  └──────────────────────────┬─────────────────────────────┘
                             │
                  [ 🚀 1-Click POST Button ]
                             │
                             ▼
               🏛️ Core Double-Entry General Ledger
                 (Atomic PostgreSQL Transaction)
                             │
                             ▼
  ┌────────────────────────────────────────────────────────┐
  │         📊 REAL-TIME STATUTORY FINANCIAL REPORTS       │
  │                                                        │
  │  • Trial Balance (Debits == Credits to the exact cent) │
  │  • Profit & Loss Statement (Income & Expense summary)  │
  │  • Balance Sheet (Assets = Liabilities + Equity)       │
  │  • Cash Flow Statement (IAS-7 Direct/Indirect flows)   │
  │  • Aged Accounts Receivable (AR Customer aging)        │
  │  • Aged Accounts Payable (AP Supplier aging)           │
  └────────────────────────────────────────────────────────┘
```

---

## 🌟 Key Capabilities & Features

### 1. Universal Clipboard & File Ingestion
- **Paste & Go**: Copy messy unformatted rows directly from your clipboard or upload any CSV/Excel (`.xlsx`, `.xls`) file.
- **Smart Header Detection**: Automatically identifies where the table headers start, discarding noisy header banners or empty rows.
- **Canonical Column Mapping**: Intelligently auto-maps columns (dates, narrations, voucher IDs, debit/credit amounts) to standardized accounting fields.

### 2. The Two-Folder Intelligent Partitioning
Every transaction batch is automatically partitioned into two clear buckets:
- **Folder A (Ready to Post)**: Zero-defect transactions that are balanced, properly categorized, and fully validated.
- **Folder B (Review Required)**: Transactions that have missing Chart of Accounts codes, unbalanced debits/credits, or suspicious outlier flags.

### 3. Machine Learning Anomaly Detection & AI Suggestions
- **In-Process Isolation Forest**: Calculates anomaly scores based on statistical path-depths and interquartile deviation.
- **TreeSHAP Explanations**: Human-readable explanations for why a transaction was flagged (e.g., *"Amount is 4.8x larger than account median"*).
- **1-Click AI Categorization**: Real-time AI recommendations with confidence ratings (e.g., *"Suggest Account 5040 - Utilities (94% confidence)"*).
- **Batch Acceptance**: 1-click batch accept all high-confidence suggestions (>85%) to immediately clear Folder B into Folder A.

### 4. Zero-Leak Atomic Ledger Posting
- **Atomic Transactions**: When you click **Post to Ledger**, all entries are written into PostgreSQL within a single ACID transaction. If a single line fails validation or violates a locked accounting period, the entire batch rolls back cleanly.
- **Integer Paisa Precision**: All amounts are computed in integer paisa/cents ($1.00 = 100 paisa) to eliminate JavaScript floating-point rounding errors.
- **SHA-256 Cryptographic Audit Chain**: Every transaction is cryptographically linked with its prior hash to guarantee SOC2/IFRS auditability.

### 5. Instant Real-Time Financial Statements
The moment you post, your financial reports update automatically:
- **Trial Balance**: Instant verification of debit and credit equality across the Chart of Accounts.
- **Profit & Loss (P&L)**: Real-time calculation of gross revenue, operational expenses, and net profit.
- **Balance Sheet**: Dynamically calculates assets, liabilities, owner equity, and current period retained earnings.
- **Cash Flow Statement**: Compliant with IAS-7 guidelines, categorizing operating, investing, and financing flows.
- **Aging Reports**: Granular age bucket breakdown (0-30, 31-60, 61-90, 90+ days) for receivables and payables.

---

## 🛠️ Technology Stack

| Component | Technology |
| :--- | :--- |
| **Framework** | Next.js 16 (App Router) |
| **Frontend UI** | React 19, Custom Dark Metallic Finance Design System |
| **Language** | TypeScript 5 (Strict Mode) |
| **Database** | PostgreSQL / Neon Serverless with Connection Pooling |
| **Machine Learning** | In-Process Isolation Forest, TreeSHAP & Jaro-Winkler Matching |
| **AI Integration** | Google Gemini 2.5 Flash / Groq / OpenAI Fallback Engine |
| **Spreadsheet Engine**| XLSX SheetJS Parser |
| **Security & Auth** | JOSE JWT Session Authentication, BCrypt Password Hashing |

---

## 🚀 Getting Started

### Prerequisites
- Node.js 20+ installed
- PostgreSQL connection string (e.g. free serverless database from [Neon.tech](https://neon.tech))

### 1. Clone the Repository
```bash
git clone https://github.com/opticcaiii-hub/I-FINT-DEN-by-INDUS-TECH.git
cd I-FINT-DEN-by-INDUS-TECH
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Create a `.env.local` file in the root directory:
```env
# Database Connection (Neon Serverless PostgreSQL)
DATABASE_URL=postgresql://user:password@ep-sample-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require

# Authentication Key
JWT_SECRET=super-secret-jwt-token-key-indus-tech-2026

# AI Engine Configuration
AI_FEATURES_ENABLED=true
GEMINI_API_KEY=your-gemini-api-key
```

### 4. Initialize Database Schema & Seed Data
Run the self-contained database migration script with one command:
```bash
npm run init-db
```
This automatically creates the core tables (`firms`, `clients`, `account_types`, `chart_of_accounts`, `accounting_periods`, `journal_entries`, `journal_lines`, `ai_feedback`) and seeds the standard general ledger Chart of Accounts.

### 5. Launch Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## ☁️ Deploying to Vercel

1. Push your repository to GitHub:
   ```bash
   git add .
   git commit -m "feat: complete I-FINT DEN standalone engine"
   git push origin main
   ```
2. Go to [Vercel](https://vercel.com) and click **"Add New Project"**.
3. Import the `I-FINT-DEN-by-INDUS-TECH` repository.
4. In the **Environment Variables** section, add:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `AI_FEATURES_ENABLED=true`
   - `GEMINI_API_KEY`
5. Click **Deploy**. Your application is live within 60 seconds!

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for details.

Developed with pride by **INDUS TECH**.
