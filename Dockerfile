# Stage 1: Build React frontend
FROM node:18-alpine AS frontend-build

WORKDIR /app/frontend

COPY frontend/package*.json ./

RUN npm install

COPY frontend/ ./

RUN npm run build

# Stage 2: Install Python deps
FROM python:3.10-slim AS python-deps

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
RUN python -c "import nltk; nltk.download('stopwords', download_dir='/usr/local/nltk_data')"

# Stage 3: Final runtime image
FROM python:3.10-slim

ENV CONTAINER_HOME=/var/www
ENV NLTK_DATA=/usr/local/nltk_data

WORKDIR $CONTAINER_HOME

COPY --from=python-deps /usr/local/lib/python3.10/site-packages /usr/local/lib/python3.10/site-packages
COPY --from=python-deps /usr/local/nltk_data /usr/local/nltk_data
COPY src/ $CONTAINER_HOME/src/
COPY scripts/ $CONTAINER_HOME/scripts/
COPY --from=frontend-build /app/frontend/dist $CONTAINER_HOME/frontend/dist

RUN python /var/www/scripts/build_db.py --db /var/www/src/db/gamescope.db --svd-k 96

CMD ["python", "-m", "gunicorn", "--chdir", "src", "app:app", "--bind", "0.0.0.0:5000", "--log-level", "debug", "--timeout", "120"]
