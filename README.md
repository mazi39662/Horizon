# Boss Finance

Boss Finance is a privacy-first, locally-hosted personal finance tracking and projection application. Instead of just looking backwards at what you've already spent, Boss Finance looks **forward**. It acts as your financial co-pilot, accurately projecting your cash flow months into the future so you know exactly how much you can safely spend today.

## 🚀 Features

- **Dynamic Daily Budget Calculator**: A highly interactive envelope-budgeting system. Input your current cash, upcoming bills, and emergency reserves to calculate exactly how much money is *safe to spend* per day until your next payday without going broke.
- **Forward-Looking Cash Projections**: Visualizes your cash flow over the next 60–90 days using Chart.js. It automatically warns you in advance of critical dates (e.g., when your cash might dip below safe levels or hit zero).
- **Bill & Debt Management**: Track all recurring subscriptions, bills, and debt payments. The system automatically reserves cash for these items *before* giving you your daily free-spending allowance.
- **Accounts & Income Tracking**: Manage multiple wallets and bank accounts. Track pending vs. confirmed income sources.
- **Interactive Calendar**: A dynamic monthly view that plots out your paydays, bill due dates, daily expenses, and projects your exact cash balance at the end of each day.
- **Business Plan & Goal Tracking**: Specialized modules for tracking savings goals or plotting out capital expenditures (like investing in equipment or a business build-out).
- **100% Local & Private**: All your data is saved locally on your machine in `.json` files. No cloud syncs, no data selling, no privacy risks.

## 🛠️ Technology Stack

- **Backend**: Python (`server.py`) acting as a lightweight API and server.
- **Frontend**: Vanilla JavaScript (`app.js`), HTML5, and CSS3.
- **Styling**: Bootstrap 5 for a clean, responsive, and mobile-friendly dark-mode UI.
- **Charts**: Chart.js for data visualization and financial projections.
- **Data Storage**: Local JSON files (`finance.json`, `notes.json`, etc.) acting as a local database.

## 📦 Getting Started

### Prerequisites
- Python 3.x installed on your machine.

### Installation & Running
1. Clone this repository to your local machine.
2. Open a terminal or command prompt in the project directory.
3. Run the backend server:
   ```bash
   python server.py
   ```
   *(Alternatively, use the provided `run_dashboard.bat` script on Windows).*
4. Open your web browser and navigate to the local address provided by the server (typically `http://localhost:5000` or `http://127.0.0.1:8000`).

## 🔒 Security Note
Because this app handles your personal financial data, **do not** commit your local database files to a public repository. The included `.gitignore` file is pre-configured to ignore all sensitive data files (`finance.json`, `notes.json`, `changes.json`) and environment variables (`.env`).

## 🤖 AI Agent Integration (Grok / Hermes)

Boss Finance is designed to work seamlessly with AI coding and analysis agents like **Grok Bot** or **Hermes Agent**. You can give an AI agent access to this local workspace to act as your personalized, automated financial advisor.

To get started, copy and paste the following prompt to your AI agent:

> **Starter Prompt for your AI Agent:**
> "You are my personal financial advisor and planner. I am using the 'Boss Finance' local web dashboard in this workspace. Your first task is to help me set up my financial profile.
> 
> Please conduct an interactive interview with me. Ask me questions step-by-step to gather my financial data (current cash across different accounts, my upcoming recurring bills, my debts, and my target emergency fund). Do not overwhelm me; ask me one or two things at a time.
> 
> As you gather this data, format it and save it directly into the `finance.json` file to automatically populate my dashboard.
> 
> Going forward, you must use `finance.json` as your absolute reference data for any financial planning, projections, or advice you give me. When you suggest financial strategies or run simulations, use the Boss Finance dashboard as your visual interface to communicate with me. Direct me to look at the 'Date-Adjustable Daily Budget Calculator' or the Cash Projection charts in the UI so I can see the exact impact of your advice."

## 🤝 Contributing
Feel free to fork the repository and submit pull requests. For major changes, please open an issue first to discuss what you would like to change.
