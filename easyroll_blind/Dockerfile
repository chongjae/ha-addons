ARG BUILD_FROM
FROM $BUILD_FROM

ENV LANG C.UTF-8

# Copy data for add-on
COPY run.sh easyroll_blind.js /

# Install requirements for add-on
RUN apk --no-cache add \
    jq \
    npm \
    make \
    gcc \
    g++ \
    python3 \
    linux-headers \
    udev

WORKDIR /share
COPY package.json .
RUN npm install
RUN chmod a+x /run.sh

CMD ["/run.sh"]
