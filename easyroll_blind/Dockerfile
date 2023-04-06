FROM alpine:latest

ENV LANG C.UTF-8

# Copy data for add-on
COPY run.sh easyroll_blind.js /

# Install requirements for add-on
RUN apk update
RUN apk add --no-cache jq npm make gcc g++ python3 linux-headers udev
RUN mkdir -p /share/Inoshade
WORKDIR /share/Inoshade
COPY package.json .
RUN npm install

RUN chmod +x /run.sh

CMD [ "/run.sh" ]
