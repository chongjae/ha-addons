FROM alpine:latest

ENV LANG C.UTF-8

# Copy data for add-on
COPY run.sh easyroll_blind.js /

# Install requirements for add-on
RUN apk update && apk add --no-cache jq npm make gcc g++ python3 linux-headers udev \
 && chmod +x /run.sh \
 && npm install

WORKDIR /share

CMD ["/run.sh"]
