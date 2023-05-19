#!/bin/sh

share_dir=/share/kocom

copy_file() {
    if [ ! -f "$share_dir/$1" ]; then
        mkdir -p "$share_dir"
        mv "/$1" "$share_dir"
    fi
}

run_node() {
    echo "INFO: Running KOCOM WallPad RS485 Addon.."
    cd "$share_dir"
    node kocom.js
}

copy_file "kocom.js"
copy_file "logger.js"

if [ -f "$share_dir/kocom.js" ]; then
    run_node
else
    echo "ERROR: Failed to copy 'kocom.js' to $share_dir"
    exit 1
fi