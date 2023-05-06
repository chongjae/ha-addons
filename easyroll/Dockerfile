FROM node:14-alpine

RUN apk upgrade --no-cache \
    && apk add --no-cache make gcc g++ python3 linux-headers udev \
    && apk add --no-cache git

WORKDIR /easyroll

COPY package*.json ./

RUN npm install

COPY . .

# 애플리케이션을 실행합니다.
CMD ["node", "/easyroll/blind.js"]
