#ARG BUILD_FROM="alpine:latest"
FROM python:3

ENV LANG C.UTF-8

# Copy data for add-on
COPY run.sh easyroll_blind.py /

# Install requirements for add-on
RUN apt-get update && apt-get -y install jq
RUN python3 -m pip install requests

WORKDIR /share

RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
