#!/bin/bash

share_dir="/share/Inoshade"

if [ ! -f "$share_dir/easyroll_blind.js" ]; then
    if ! mkdir -p "$share_dir"; then
        echo "ERROR: Failed to create directory $share_dir"
        exit 1
    fi

    if ! mv /easyroll_blind.js "$share_dir"; then
        echo "ERROR: Failed to move easyroll_blind.js to $share_dir"
        exit 1
    fi
fi

echo "INFO: Running easyroll_blind Addon..."
cd "$share_dir"
if ! node easyroll_blind.js; then
    echo "ERROR: Failed to run easyroll_blind.js"
    exit 1
fi
