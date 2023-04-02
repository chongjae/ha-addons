#!/bin/bash

share_dir="/share/packet"

if [ ! -d "$share_dir" ]; then
    mkdir -p "$share_dir" || exit 1
fi

if [ ! -f "$share_dir/data.js" ]; then
    mv /data.js "$share_dir" || exit 1
fi

echo "INFO: Running WallPad Packets Addon..."
cd "$share_dir"
if ! node data.js; then
    echo "ERROR: Failed to run data.js"
    exit 1
fi

# For dev
# while true; do echo "still live"; sleep 100; done
