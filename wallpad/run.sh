#!/bin/sh
 
CONFIG_PATH=/data/options.json 
RESET=$(jq --raw-output ".reset" $CONFIG_PATH) 
SHARE_DIR=/share/bestin
  
if [ ! -f $SHARE_DIR/ipark.js -o "$RESET" = true ]; then 
         echo "[Info] Initializing ipark.js"

if [ -f $SHARE_DIR/$JS_FILE ]; then 
       mv $SHARE_DIR/ipark.js $SHARE_DIR/ipark.js 
else 
       mkdir $SHARE_DIR 
   fi 
       mv /ipark.js $SHARE_DIR 
 else 
         echo "[Info] Skip initializing ipark.js"
 fi 
  
 # start server 
 echo "[Info] Run Bestin Wallpad with RS485 stand by..." 
  
 node ipark.js 
  
 #while true; do echo "still live"; sleep 1800; done
