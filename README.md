<div align="center">
  
# 🌅 Horizon
**Your Forward-Looking Financial Co-Pilot**

[![Local Privacy](https://img.shields.io/badge/Privacy-100%25_Local-success?style=for-the-badge)](https://github.com/yourusername/horizon)
[![Stack](https://img.shields.io/badge/Stack-Python_%7C_JS_%7C_Bootstrap-blue?style=for-the-badge)](https://github.com/yourusername/horizon)

*Stop looking backwards at what you've already spent. Start looking over the horizon.*

</div>

---

**Horizon** is a privacy-first, locally-hosted personal finance dashboard. It projects your cash flow months into the future and uses zero-based envelope budgeting to tell you exactly how much money is **safe to spend today** without jeopardizing next week's bills.

<br>

## ✨ Why Horizon?

Unlike standard budget trackers that act like rearview mirrors, Horizon predicts the future. By locking in your recurring bills and emergency targets, it calculates a guilt-free **Daily Allowance**. If you overspend today, it gracefully lowers tomorrow's budget. If you underspend, it rewards you by rolling the cash forward!

### Core Features

* 🧮 **Date-Adjustable Daily Budget Calculator**  
  An interactive sandbox that lets you tweak your income horizon, emergency reserves, and safe-spending percentage to instantly calculate your daily allowance and potential savings.
  
* 📈 **60-Day Forward Cash Projections**  
  Visualizes your cash flow over the next two months using Chart.js. Get automatically warned when your cash might dip into *Warning*, *Critical*, or *Zero* levels.

* 📅 **Interactive Financial Calendar**  
  A dynamic monthly view plotting your paydays and bill due dates, showing your exact projected cash balance at the end of each day.

* 💼 **Business Plan & Goal Tracking**  
  Specialized modules for tracking capital expenditures (like investing in PC equipment) and long-term savings goals.

---

## 🛠️ Technology Stack

| Component | Technology | Description |
| :--- | :--- | :--- |
| **Backend** | `Python` | A lightweight server (`server.py`) acting as the local API. |
| **Frontend** | `Vanilla JS` | Fast, reactive DOM manipulation without heavy frameworks. |
| **Styling** | `Bootstrap 5` | Sleek, dark-mode native, and perfectly responsive. |
| **Charts** | `Chart.js` | For rendering beautiful, interactive financial projections. |
| **Database** | `JSON Files` | `finance.json` acting as a secure, local-only datastore. |

<br>

## 🚀 Getting Started

### 1. Requirements
* Python 3.x

### 2. Installation & Running
Clone this repository to your local machine:
```bash
git clone https://github.com/yourusername/horizon.git
cd horizon
```

Run the backend server:
```bash
python server.py
```
*(Windows users can simply double-click the `run_dashboard.bat` script).*

Finally, open your web browser and navigate to `http://localhost:5000` (or the port provided in your terminal).

---

## 🤖 AI Agent Integration (Grok / Hermes)

Horizon was built to be highly compatible with AI coding and analysis agents. You can give an AI agent access to this local workspace to act as your personalized, automated financial advisor!

To get started, copy and paste this **System Prompt** to your AI agent:

> **System Prompt for Financial AI Agent:**
> 
> "You are my personal financial advisor and planner. I am using the 'Horizon' local web dashboard in this workspace. Your first task is to help me set up my financial profile.
> 
> Please conduct an interactive interview with me. Ask me questions step-by-step to gather my financial data (current cash across different accounts, my upcoming recurring bills, my debts, and my target emergency fund). Do not overwhelm me; ask me one or two things at a time.
> 
> As you gather this data, format it and save it directly into the `finance.json` file to automatically populate my dashboard.
> 
> Going forward, you must use `finance.json` as your absolute reference data for any financial planning, projections, or advice you give me. When you suggest financial strategies or run simulations, use the Horizon dashboard as your visual interface to communicate with me. Direct me to look at the 'Date-Adjustable Daily Budget Calculator' or the Cash Projection charts in the UI so I can see the exact impact of your advice."

---

## 🔒 Security & Privacy
Because this app handles your most sensitive personal financial data, **do not** commit your local database files to a public repository. 

The included `.gitignore` file is strictly configured to ignore all data files (`finance.json`, `notes.json`, `changes.json`) and environment variables (`.env`). Your data never leaves your machine.

---
<div align="center">
  <i>Built for privacy. Built for peace of mind.</i>
</div>
