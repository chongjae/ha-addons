#!/bin/sh

SHARE_DIR=/share/bestin

if [ ! -f $SHARE_DIR/bestin.js ]; then
    mkdir -p $SHARE_DIR
    mv /bestin_wallpad.js $SHARE_DIR
fi

echo "INFO: Running HDC BESTIN WallPad RS485 Addon..."
cd $SHARE_DIR
node bestin_wallpad.js

