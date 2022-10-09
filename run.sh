#!/bin/sh 
  
 JS_FILE="bestin_rs485.js" 
 CONFIG_PATH=/data/options.json 
 RESET=$(jq --raw-output ".reset" $CONFIG_PATH) 
 SHARE_DIR=/share/bestin
  
 if [ ! -f $SHARE_DIR/$JS_FILE -o "$RESET" = true ]; then 
         echo "[Info] Initializing "$JS_FILE 
   else 
         mkdir $SHARE_DIR 
   fi 
         mv /$JS_FILE $SHARE_DIR 
 else 
         echo "[Info] Skip initializing "$JS_FILE 
 fi 
  
 JS_FILE=$SHARE_DIR/$JS_FILE 
  
 # start server 
 echo "[Info] Bestin Wallpad stand by... " 
  
 node $JS_FILE 
  
 #while true; do echo "still live"; sleep 1800; done
