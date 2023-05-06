FROM node:14-alpine

COPY package.json /
COPY easyroll_blind.js /

RUN apk upgrade --no-cache \
    && apk add --no-cache make gcc g++ python3 linux-headers udev \
    && apk add --no-cache git
    
WORKDIR /share

RUN npm install --silent
RUN chmod a+x /run.sh

CMD ["/run.sh"]

