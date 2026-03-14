#!/bin/sh
set -e

echo "Starting SearXNG..."

sudo -H -u searxng bash -c "cd /usr/local/searxng/searxng-src && export SEARXNG_SETTINGS_PATH='/etc/searxng/settings.yml' && export FLASK_APP=searx/webapp.py && /usr/local/searxng/searx-pyenv/bin/python -m flask run --host=0.0.0.0 --port=8080" &
SEARXNG_PID=$!

echo "Waiting for SearXNG to be ready..."
sleep 5

COUNTER=0
MAX_TRIES=30
until curl -s http://localhost:8080 > /dev/null 2>&1; do
  COUNTER=$((COUNTER+1))
  if [ $COUNTER -ge $MAX_TRIES ]; then
    echo "Warning: SearXNG health check timeout, but continuing..."
    break
  fi
  sleep 1
done

if curl -s http://localhost:8080 > /dev/null 2>&1; then
  echo "SearXNG started successfully (PID: $SEARXNG_PID)"
else
  echo "SearXNG may not be fully ready, but continuing (PID: $SEARXNG_PID)"
fi

cd /home/vane
echo "Starting Vane..."

# Load AUTH_SECRET from persistent file if not already set.
# This ensures Edge Runtime middleware can read the secret on restarts.
if [ -z "$AUTH_SECRET" ] && [ -f "data/auth_secret" ]; then
  AUTH_SECRET=$(cat data/auth_secret)
  # Validate the secret is a non-empty hex string of at least 32 characters
  if echo "$AUTH_SECRET" | grep -qE '^[0-9a-fA-F]{32,}$'; then
    export AUTH_SECRET
    echo "Loaded AUTH_SECRET from data/auth_secret"
  else
    echo "Warning: data/auth_secret has invalid format, skipping"
    unset AUTH_SECRET
  fi
fi

exec node server.js