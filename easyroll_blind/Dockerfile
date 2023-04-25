FROM python:3.9-slim-buster

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        build-essential \
        git && \
    rm -rf /var/lib/apt/lists/*

RUN pip install requests paho-mqtt

RUN mkdir /app
WORKDIR /app

COPY easyroll_blind.py /app
COPY run.sh /app
RUN chmod +x /app/run.sh

CMD ["./run.sh"]
