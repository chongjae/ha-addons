#!/bin/sh

CONFIG_PATH=/data/options.json
SHARE_DIR=/share

CUSTOM_FILE=$(jq --raw-output ".customfile" $CONFIG_PATH)
JS_FILE="bestin.js"

if [ -f $SHARE_DIR/$CUSTOM_FILE ]; then
	echo "[Info] Initializing with Custom file: "$CUSTOM_FILE
	JS_FILE=$CUSTOM_FILE
else
  	if [ ! -f $SHARE_DIR/$JS_FILE ]; then
		LS_RESULT=`ls $SHARE_DIR | grep wallpad`
		if [ $? -eq 0 ]; then
			rm $SHARE_DIR/bestin.js
		fi
        cp /js/bestin.js" $SHARE_DIR/$JS_FILE
	fi
fi

# start server
echo "[Info] Start Wallpad Controller.."

JS_FILE=/$SHARE_DIR/$JS_FILE
node $JS_FILE
