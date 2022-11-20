#!/bin/sh

CONFIG_PATH=/data/options.json
SHARE_DIR=/share

OPTION_FILE="$(jq --raw-output '.custom_file' $CONFIG_PATH)"
JS_DIR=/js
JS_FILE="bestin.js"

# start server
echo "[Info] Start Wallpad Controller.."

node $JS_DIR/$JS_FILE
