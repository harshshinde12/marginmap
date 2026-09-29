# MarginMap — Profitability & Cost-to-Serve Analytics

**In one line:** MarginMap shows where a retail business actually makes or loses money, after discounts, shipping, support, and returns.

Built on 51,290 orders from 2011-2014 (Global Superstore dataset).

**Live totals:**
- Sales: **$11,823,482**
- Gross Profit: **$1,349,557 (11.4%)**
- Net Profit: **-$659,784 (-5.6%)** — overall loss-making

### 1. What is this?

Sales alone is misleading. A product can sell a lot but still lose money.

MarginMap calculates true profit for every order by product, customer, channel (Consumer / Corporate / Home Office), and region, and shows it in a dashboard.

### 2. What data was used?

File: `data/superstore.xlsx`

- Orders sheet: 51,290 rows — used for all calculations
- Returns sheet: 1,173 returned orders — sale is cancelled, $8 return fee added
- People sheet: not used

### 3. How is profit calculated?

Simple logic, same for all 51k orders:

1. `Gross Profit = Price Paid - Product Cost`
   Returned orders = 0 sales, 0 gross.

2. `Net Profit = Gross Profit - Shipping - Support Share - Return Fee`
   - Shipping = actual freight from data
   - Support Share = 5% of total sales, split by sales value
   - Return Fee = $8 only if returned

Percentages are always calculated from total dollars, not by averaging.

### 4. What can you see in the dashboard?

6 simple pages:

1. **Overview:** Totals, trends, profit by category & region
2. **Drill-Down:** Category -> Sub-Category -> Product -> Customer
3. **Cohorts:** Who buys often vs who costs a lot to serve
4. **Loss-Makers:** Worst loss products with reason like High Discount / High Freight
5. **Simulator:** What-if sliders: what if discount -5%, price +2%?
6. **Variance:** This month vs last month vs last year

### 5. Key findings

1. 30%+ discounts = 20% of orders, destroy margin (-57% to -70%) with no extra volume. Cap discount at 20%.
2. 5,934 of 10,292 products lose money. Worst 50 are freight-led, e.g. Cubify 3D Printer -$10.1k loss.
3. Freight ($1.35M) alone eats all gross profit. Fix shipping on heavy Tech items first.
4. Home Office is best channel (-4.9%). Copy its discount discipline.

### 6. Minimum tech info

- Backend: Python (FastAPI + Pandas)
- Frontend: React + TypeScript + Vite
- Database: SQLite file auto-created from Excel

**Run locally:**

```powershell
# Backend
cd backend
pip install -r requirements.txt
python -m app.ingest
python -m uvicorn app.main:app --port 8000

# Frontend (second terminal)
cd frontend
npm install
npm run dev
Backend: http://127.0.0.1:8000 , Frontend: http://127.0.0.1:5173
Files:
data/superstore.xlsx -> backend (calculations) -> frontend (dashboard)
backend/app/allocation.py = profit formulas
backend/app/ingest.py = Excel to database
frontend/src = 6 dashboard pages
7. Notes
- 5% support cost is an assumption.
- Simulator is directional only, test price changes in one region first.
- All amounts in USD. No budget data, so no Budget vs Actual.
- College business-analytics project.

**Short description to keep on GitHub:**
> Profitability dashboard for 51k retail orders — finds true margin by product, customer & region.
