#!/bin/sh

SHARE_DIR=/share/packet

if [ ! -f $SHARE_DIR/data.py ]; then
    mkdir -p $SHARE_DIR
    mv /data.py $SHARE_DIR
fi

echo "INFO: Running wallpad packets Addon..."
cd $SHARE_DIR
python3 $SHARE_DIR/data.py
