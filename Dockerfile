#ARG BUILD_FROM="alpine:latest"
ARG BUILD_FROM
FROM $BUILD_FROM

ENV LANG C.UTF-8

# Copy data for add-on
COPY run.sh /share/bestin/run.sh
COPY bestin_rs485.js /share/bestin/bestin_rs485.js 

# Install requirements for add-on
RUN apk add --no-cache jq npm make gcc g++ python3 linux-headers udev

WORKDIR /
COPY package.json /
RUN npm install

WORKDIR /share

RUN chmod a+x /share/bestin/run.sh

CMD [ "/run.sh" ]
