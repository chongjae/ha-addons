#!/bin/bash

share_dir="/share/kocom"

if [ ! -f "$share_dir/kocom.js" ]; then
    if ! mkdir -p "$share_dir"; then
        echo "ERROR: Failed to create directory $share_dir"
        exit 1
    fi

    if ! mv /kocom.js "$share_dir"; then
        echo "ERROR: Failed to move kocom.js to $share_dir"
        exit 1
    fi
fi

echo "INFO: Running Daelim Kocom Wallpad Addon..."
cd "$share_dir"
if ! node kocom.js; then
    echo "ERROR: Failed to run kocom.js"
    exit 1
fi

# For dev
# while true; do echo "still live"; sleep 100; done
