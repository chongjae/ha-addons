#!/bin/sh

CONFIG_PATH=/data/options.json
SHARE_DIR=/share

OPTION_FILE="$(jq --raw-output '.custom_file' $CONFIG_PATH)"
JS_DIR=/js
JS_FILE="bestin.js"

if [ ! -f $SHARE_DIR/$DEV_FILE ]; then
  cp $JS_DIR/$JS_FILE $SHARE_DIR/$JS_FILE
fi
if [ -f $SHARE_DIR/$OPTION_FILE ]; then
  echo "[Info] Initializing with Custom file: "$OPTION_FILE
  if [ "$DEV_FILE" != "$OPTION_FILE" ]; then
    rm $SHARE_DIR/$DEV_FILE
    cp $SHARE_DIR/$OPTION_FILE $SHARE_DIR/$DEV_FILE
  fi
fi

# start server
echo "[Info] Start Wallpad Controller.."

node $JS_DIR/$JS_FILE
