FROM alpine:latest

ENV LANG=C.UTF-8

COPY run.sh bestin_wallpad.js const.js logger.js package.json /

RUN apk update && apk upgrade --no-cache \
    && apk add --no-cache jq npm make gcc g++ python3 linux-headers udev

WORKDIR /share

RUN npm install
RUN chmod a+x /run.sh

CMD ["/run.sh"]
