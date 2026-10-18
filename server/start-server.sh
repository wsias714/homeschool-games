#!/bin/bash
# Start the homeschool games server

cd "$(dirname "$0")"
exec python3 server.py
