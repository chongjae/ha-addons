FROM node:14-alpine

RUN apk upgrade --no-cache \
    && apk add --no-cache make gcc g++ python3 linux-headers udev \
    && apk add --no-cache git

COPY package.json /
COPY easyroll_blind.js /share/easyroll/

RUN npm install --silent

WORKDIR /share/easyroll/
COPY . .

CMD ["node", "/share/easyroll/easyroll_blind.js"]
