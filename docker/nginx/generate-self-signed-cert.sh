#!/bin/bash
# Generate self-signed SSL certificate for internal IP access
# Run this on the server: bash docker/nginx/generate-self-signed-cert.sh

CERT_DIR="$(dirname "$0")/ssl"
mkdir -p "$CERT_DIR"

openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout "$CERT_DIR/selfsigned.key" \
  -out "$CERT_DIR/selfsigned.crt" \
  -subj "/CN=10.200.0.112" \
  -addext "subjectAltName=IP:10.200.0.112,DNS:cloud.jototech.cn,DNS:noteflow.jotoai.com"

echo "Self-signed certificate generated in $CERT_DIR/"
echo "  - selfsigned.crt"
echo "  - selfsigned.key"
