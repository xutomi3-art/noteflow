#!/bin/bash
# Init script: request Let's Encrypt certificate for noteflow.jotoai.com
# Run once on the server: bash docker/init-letsencrypt.sh

set -e

DOMAIN="noteflow.jotoai.com"
EMAIL="test@noteflow.dev"  # Let's Encrypt notifications
COMPOSE="docker compose"

echo "==> Step 1: Create dummy cert so Nginx can start..."
$COMPOSE run --rm --entrypoint "\
  mkdir -p /etc/letsencrypt/live/$DOMAIN && \
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /etc/letsencrypt/live/$DOMAIN/privkey.pem \
    -out /etc/letsencrypt/live/$DOMAIN/fullchain.pem \
    -subj '/CN=$DOMAIN'" certbot

echo "==> Step 2: Start Nginx with dummy cert..."
$COMPOSE up -d nginx

echo "==> Step 3: Remove dummy cert..."
$COMPOSE run --rm --entrypoint "\
  rm -rf /etc/letsencrypt/live/$DOMAIN && \
  rm -rf /etc/letsencrypt/archive/$DOMAIN && \
  rm -rf /etc/letsencrypt/renewal/$DOMAIN.conf" certbot

echo "==> Step 4: Request real certificate..."
$COMPOSE run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d $DOMAIN \
  --email $EMAIL \
  --agree-tos \
  --no-eff-email \
  --force-renewal

echo "==> Step 5: Reload Nginx with real cert..."
$COMPOSE exec nginx nginx -s reload

echo "==> Done! SSL certificate installed for $DOMAIN"
echo "    Auto-renewal is handled by the certbot container (checks every 12h)"
echo "    Certificate expires in 90 days and will auto-renew at 60 days"
