#!/bin/sh

SHARE_DIR=/share/easyroll

if [ ! -f $SHARE_DIR/easyroll_blind.py ]; then
	mkdir $SHARE_DIR
	mv /easyroll_blind.py $SHARE_DIR
fi

echo "INFO: Easyroll Blind Add-on ..."
cd $SHARE_DIR
python3 $SHARE_DIR/easyroll_blind.py
