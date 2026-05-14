FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt ./
RUN python -m venv /opt/venv \
  && /opt/venv/bin/pip install --upgrade pip \
  && /opt/venv/bin/pip install -r requirements.txt

COPY . .

ENV PATH="/opt/venv/bin:${PATH}"
ENV VORLIQ_HOST=0.0.0.0
ENV VORLIQ_PORT=5001
ENV VORLIQ_DATA_DIR=/app/data

EXPOSE 5001

CMD ["python", "app.py"]
