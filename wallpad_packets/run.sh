#!/bin/bash

share_dir="/share/packet"

if [ ! -f "$share_dir/data.js" ]; then
    if ! mkdir -p "$share_dir"; then
        echo "ERROR: Failed to create directory $share_dir"
        exit 1
    fi

    if ! mv /data.js "$share_dir"; then
        echo "ERROR: Failed to move data.js to $share_dir"
        exit 1
    fi
fi

echo "INFO: Running wallpad packets Addon..."
cd "$share_dir"
if ! node data.js; then
    echo "ERROR: Failed to run data.js"
    exit 1
fi

# For dev
# while true; do echo "still live"; sleep 100; done
