#!/bin/sh

JS_FILE="bestin_rs485.js"
CONFIG_PATH=/data/options.json
SHARE_DIR=/share

if [ ! -f $SHARE_DIR/$JS_FILE -o "$RESET" = true ]; then
	echo "[Info] Initializing "$JS_FILE
else
  if [ -f $SHARE_DIR/$JS_FILE ]; then
	mv $SHARE_DIR/$JS_FILE $SHARE_DIR/$JS_FILE
  else
	mkdir $SHARE_DIR
  fi
        mv /$JS_FILE $SHARE_DIR
else
	echo "[Info] Skip initializing "$JS_FILE
fi

# start server
echo "[Info] Wallpad Controller stand by... : "$JS_FILE

JS_FILE=/$SHARE_DIR/$JS_FILE
node $JS_FILE

#while true; do echo "still live"; sleep 1800; done
