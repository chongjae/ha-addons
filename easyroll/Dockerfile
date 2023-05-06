FROM node:14-alpine

RUN apk upgrade --no-cache \
    && apk add --no-cache make gcc g++ python3 linux-headers udev \
    && apk add --no-cache git

COPY package.json /

RUN npm install

RUN mkdir -p /share/easyroll
WORKDIR /share/easyroll

COPY easyroll_blind.js /share/easyroll

CMD ["node", "/share/easyroll/easyroll_blind.js"]
