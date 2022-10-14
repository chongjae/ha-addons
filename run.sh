#!/bin/sh

CONFIG_PATH=/data/options.json
SHARE_DIR=/share/bestin

if [ ! -f $SHARE_DIR/ipark.js ]; then
	mkdir $SHARE_DIR
	mv ipark.js $SHARE_DIR
fi

# start server
echo "[Info] Bestin Wallpad with RS485 stand by... "

cd $SHARE_DIR
node $SHARE_DIR/ipark.js

#while true; do echo "still live"; sleep 1800; done
