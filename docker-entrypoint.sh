#!/bin/sh

set -e

# use "exec" to replace currently executing process with "node"
# node process must be the root process (PID=1) inside container
# to properly receive OS signals from Docker engine

# add support for debugging inside Docker container
if [ "$DEBUG" = "1" ]; then
  exec node --inspect=0.0.0.0 "$@"
else
  exec node "$@"
fi
