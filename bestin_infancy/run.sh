#!/bin/bash

share_dir="/share/bestin"

if [ ! -f "$share_dir/bestin_infancy.js" ]; then
    if ! mkdir -p "$share_dir"; then
        echo "ERROR: Failed to create directory $share_dir"
        exit 1
    fi

    if ! mv /bestin_infancy.js "$share_dir"; then
        echo "ERROR: Failed to move bestin_infancy.js to $share_dir"
        exit 1
    fi
fi

echo "INFO: Running bestin Addon..."
cd "$share_dir"
if ! node bestin_infancy.js; then
    echo "ERROR: Failed to run bestin_infancy.js"
    exit 1
fi

# For dev
# while true; do echo "still live"; sleep 100; done
