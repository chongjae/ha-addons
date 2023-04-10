#!/bin/sh

SHARE_DIR=/share/inoshade

if [ ! -f $SHARE_DIR/easyroll_blind.py ]; then
    mkdir -p $SHARE_DIR
    mv /easyroll_blind.py $SHARE_DIR
fi

echo "INFO: Running Easyroll Blind Addon..."
cd $SHARE_DIR
python3 $SHARE_DIR/easyroll_blind.py
