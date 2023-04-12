#!/bin/sh

SHARE_DIR=/share/packet

if [ ! -f $SHARE_DIR/data.py ]; then
    mkdir -p $SHARE_DIR
    mv /data.py $SHARE_DIR
fi

echo "INFO: Running Wallpad RS485 Packet Raw Addon..."
cd $SHARE_DIR
python3 data.py
