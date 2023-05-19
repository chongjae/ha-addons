FROM alpine:latest

ENV LANG=C.UTF-8

COPY . .

RUN apk update && apk upgrade --no-cache \
    && apk add --no-cache jq npm make gcc g++ python3 linux-headers udev \
    && npm install \
    && chmod a+x /run.sh

WORKDIR /share

CMD ["/run.sh"]
