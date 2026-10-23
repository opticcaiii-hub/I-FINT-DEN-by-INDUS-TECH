# ⚡ I-FINT DEN by INDUS TECH
### *Autonomous AI Financial Ingestion Pipeline & Real-Time Statutory Accounting Engine*

[![Next.js 16](https://img.shields.io/badge/Next.js-16.3-black?logo=next.js)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19.2-blue?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL%20%2F%20Neon-336791?logo=postgresql)](https://neon.tech/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## 📌 Executive Summary

**I-FINT DEN by INDUS TECH** is an end-to-end autonomous financial intelligence platform built to eliminate the single most painful bottleneck in accounting: **converting messy, disorganized raw transaction data into clean, compliant, double-entry General Ledger records and instant financial statements.**

By unifying high-precision column normalization, machine-learning outlier detection (Isolation Forest & TreeSHAP), large language model categorizations, and automated Chart of Accounts resolution, **I-FINT DEN** cuts accounting ingestion cycles from hours to seconds.

---

## 🛑 The Problem: The Spreadsheet Chaos

Every business, accounting firm, and finance professional faces the same daily struggle:

1. **Unformatted, Inconsistent Data**: Raw exports from banks, POS terminals, payment gateways, and vendors arrive in chaotic formats with conflicting headers, mixed date conventions, and unstructured narrations.
2. **Exhausting Manual Categorization**: Accountants spend hours manually deciphering descriptions, guessing account codes, and keying in journal entries line by line.
3. **Hidden Anomalies & Outliers**: Dangerous typos, accidental duplicate charges, unusual weekend spikes, and unbalanced debits/credits slip past human reviewers and contaminate financial ledgers.
4. **Delayed Reporting**: Generating a Trial Balance, Balance Sheet, or Profit & Loss statement often requires days or weeks of manual reconciliation across disparate spreadsheets.

---

## 💡 The Solution: I-FINT DEN 4-Step Pipeline

**I-FINT DEN by INDUS TECH** automates this entire pipeline into a fast, intuitive, 4-step workflow:

```
[ Raw CSV / Bank Statement / Clipboard ]
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

## 🧪 Ready-to-Use Quick Test Data

Want to test the platform instantly? Copy the standardized bank statement dataset below and paste it directly into the Studio:

```csv
Date,Description,Debit,Credit,Balance
3/3/2026,Fund Transfer - Karachi Mart Distributors,,215000,1140000
3/3/2026,Utility Bill - K-Electric,18500,,1121500
3/5/2026,Fund Transfer - Sindh Electronics House,,98000,1199500
3/7/2026,Fund Transfer - Bilal General Store,,54000,1186000
3/8/2026,Salary Disbursement - Payroll March,542000,,644000
3/10/2026,Fund Transfer - Al-Rehman Traders,,133000,820000
3/12/2026,Fund Transfer - Noor Textiles,,88000,906800
3/13/2026,Cheque Payment - Metro Fuel Station,21000,,885800
3/14/2026,Fund Transfer - Hyderabad Wholesale Co,,176000,1061800
3/15/2026,Rent Payment - Warehouse,60000,,1001800
3/17/2026,Cheque Payment - Al-Noor Stationery,8500,,1038300
3/18/2026,Fund Transfer - Shan Enterprises,,102000,1140300
3/20/2026,Fund Transfer - Metro Cash & Carry Hyderabad,,64000,1175300
3/22/2026,Fund Transfer - Zainab Traders,,91000,1251300
3/26/2026,Fund Transfer - Karachi Mart Distributors,,145000,1389800
3/28/2026,Fund Transfer - Sindh Electronics House,,72000,1452000
3/30/2026,Fund Transfer - Bilal General Store,,58000,1472000
```

> **Direct file access**: This dataset is also stored in the repository at [`test-data/sample-bank-statement.csv`](./test-data/sample-bank-statement.csv).

---

## 🌟 Key Capabilities & Features

### 1. Universal Clipboard & File Ingestion
- **Paste & Go**: Copy messy unformatted rows directly from your clipboard or upload any CSV/Excel (`.xlsx`, `.xls`) file.
- **Smart Header Detection**: Automatically identifies where table headers start, discarding noisy header banners, empty rows, or multi-line metadata.
- **Broad Alias Dictionary**: Intelligently auto-maps columns (dates, narrations, voucher IDs, debit/credit/withdrawal/deposit amounts) to standardized accounting fields.

### 2. The Two-Folder Intelligent Partitioning
Every transaction batch is automatically partitioned into two clear buckets:
- **Folder A (Ready to Post)**: Zero-defect transactions that are balanced, properly categorized with Chart of Accounts codes, and fully validated.
- **Folder B (Review Required)**: Transactions that have missing Chart of Accounts codes, unusual statistical outliers, or ambiguous fields that require accountant confirmation.

### 3. Machine Learning Anomaly Detection & AI Suggestions
- **In-Process Isolation Forest**: Calculates statistical anomaly scores based on tree depth and historical volume patterns.
- **TreeSHAP Explanations**: Human-readable explanations for why a transaction was flagged (e.g., *"Amount is 6x larger than account median"*).
- **1-Click AI Categorization**: Real-time AI recommendations with confidence ratings (e.g., *"Suggest Account 5040 - Utilities (93% confidence)"*).
- **Batch Acceptance**: 1-click batch accept all high-confidence suggestions ($\ge 85\%$) to immediately clear Folder B into Folder A.

### 4. Zero-Leak Atomic Ledger Posting
- **Atomic Transactions**: When you click **Post to Ledger**, all entries are written into PostgreSQL within a single ACID transaction. If a single line fails validation, the entire batch rolls back cleanly.
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
Run the self-contained database setup script:
```bash
npm run init-db
```
This automatically creates the core tables (`firms`, `clients`, `account_types`, `chart_of_accounts`, `accounting_periods`, `journal_entries`, `journal_lines`, `ai_feedback`, `audit_log`) and seeds the standard general ledger Chart of Accounts.

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
