FROM python:3.12-slim

WORKDIR /srv
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# App code + prebuilt SQLite DB (rebuild inside the image to be safe).
# At runtime, setting DATABASE_URL switches the API to Supabase Postgres
# (same queries via the app.database compat shim); the baked-in SQLite
# remains as the fallback when DATABASE_URL is unset.
COPY backend ./backend
COPY data ./data
RUN cd backend && python -m app.ingest

ENV MARGINMAP_SUPPORT_RATE_PCT=0.05
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--app-dir", "backend"]
