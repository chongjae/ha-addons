# Use a specific version of Alpine
FROM alpine:3.15.0 AS base

ENV LANG C.UTF-8

# Install build dependencies
RUN apk add --no-cache make gcc g++ python3 linux-headers udev

# Create a directory for the application
WORKDIR /app

# Copy the package.json file and install dependencies
COPY package.json .
RUN npm install --production

# Copy the application code
COPY easyroll_blind.js .

# Use a smaller image for the final stage
FROM alpine:3.15.0

# Copy the built application and script from the previous stage
COPY --from=base /app /app
COPY run.sh /

# Make the script executable
RUN chmod a+x /run.sh

# Set the working directory to /share
WORKDIR /share

# Run the script when the container starts
CMD ["/run.sh"]
