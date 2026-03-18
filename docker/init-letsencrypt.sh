#!/bin/bash
# Init script: request Let's Encrypt certificate for noteflow.jotoai.com
# Run once on the server: cd /opt/noteflow && sudo bash docker/init-letsencrypt.sh

set -e

DOMAIN="noteflow.jotoai.com"
EMAIL="test@noteflow.dev"
COMPOSE="docker compose"

echo "==> Step 1: Stop Nginx to free port 80..."
$COMPOSE stop nginx 2>/dev/null || true

echo "==> Step 2: Request certificate (standalone mode)..."
docker run --rm -p 80:80 \
  -v noteflow_certbot-certs:/etc/letsencrypt \
  certbot/certbot certonly \
  --standalone \
  -d $DOMAIN \
  --email $EMAIL \
  --agree-tos \
  --no-eff-email \
  --force-renewal

echo "==> Step 3: Start all services..."
$COMPOSE up -d

echo ""
echo "==> Done! SSL certificate installed for $DOMAIN"
echo "    Auto-renewal: certbot checks every 12h, Nginx reloads every 6h"
echo "    Certificate expires in 90 days, auto-renews at 60 days"
