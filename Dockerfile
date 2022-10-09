FROM alpine

# Copy data for add-on
COPY run.sh bestin.py

# Install requirements for add-on
RUN npm install mqtt 
RUN npm install serialport

WORKDIR /share

RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
