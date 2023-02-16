FROM alpine:3.15.0 AS base

RUN apk add --no-cache jq nodejs npm make gcc g++ python3 linux-headers udev \
  && adduser -D -u 1000 appuser \
  && mkdir /app && chown appuser /app
WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

# Copy the application files
COPY run.sh bestin.js ./

USER appuser
RUN chmod +x run.sh

HEALTHCHECK --interval=5s --timeout=3s \
  CMD wget -qO- http://localhost:3000 || exit 1

CMD ["./run.sh"]
