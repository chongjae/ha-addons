#!/bin/sh

SHARE_DIR=/share/bestin

if [ ! -f $SHARE_DIR/bestin.js ]; then
	mkdir $SHARE_DIR
	mv /bestin.js $SHARE_DIR
fi
/makeconf.sh

# start server
echo "[Info] Run Bestin Wallpad with RS485"
cd $SHARE_DIR
node $SHARE_DIR/bestin.js

#while true; do echo "still live"; sleep 1800; done
