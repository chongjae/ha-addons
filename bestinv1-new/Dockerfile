# Use a specific version of Alpine as the base image
FROM alpine:3.15.0 AS base

# Install required packages and set the working directory
RUN apk add --no-cache jq nodejs npm make gcc g++ python3 linux-headers udev \
  && adduser -D -u 1000 appuser \
  && mkdir /app && chown appuser /app
WORKDIR /app

# Copy the package.json and package-lock.json files and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy the application files
COPY run.sh bestin.js ./

# Switch to the non-root user and make the run script executable
USER appuser
RUN chmod +x run.sh

# Add a health check to ensure that the container is running properly
HEALTHCHECK --interval=5s --timeout=3s \
  CMD wget -qO- http://localhost:3000 || exit 1

# Specify the command to run when the container starts
CMD ["./run.sh"]
