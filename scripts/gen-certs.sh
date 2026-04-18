#!/usr/bin/env bash
set -euo pipefail

TLS_DIR="${TLS_DIR:-/opt/mcp-mac/tls}"

usage() {
  echo "Usage:"
  echo "  $0 ca                          — generate internal CA"
  echo "  $0 server <hostname> <wg_ip>   — generate server cert signed by CA"
  exit 1
}

case "${1:-}" in
  ca)
    mkdir -p "$TLS_DIR"
    openssl ecparam -genkey -name prime256v1 -out "$TLS_DIR/ca.key" 2>/dev/null
    openssl req -new -x509 -days 3650 -sha256 -key "$TLS_DIR/ca.key" \
      -subj "/CN=mcp-mac Internal CA" -out "$TLS_DIR/ca.crt"
    chmod 600 "$TLS_DIR/ca.key"
    echo "CA created:"
    echo "  $TLS_DIR/ca.crt"
    echo "  $TLS_DIR/ca.key"
    ;;

  server)
    HOST="${2:-}"
    WG_IP="${3:-}"
    [[ -z "$HOST" || -z "$WG_IP" ]] && usage

    [[ -f "$TLS_DIR/ca.crt" && -f "$TLS_DIR/ca.key" ]] || {
      echo "Error: CA not found in $TLS_DIR — run '$0 ca' first" >&2
      exit 1
    }

    mkdir -p "$TLS_DIR"
    openssl ecparam -genkey -name prime256v1 -out "$TLS_DIR/$HOST.key" 2>/dev/null
    openssl req -new -key "$TLS_DIR/$HOST.key" \
      -subj "/CN=$HOST" -out "$TLS_DIR/$HOST.csr"

    openssl x509 -req -days 3650 -sha256 -in "$TLS_DIR/$HOST.csr" \
      -CA "$TLS_DIR/ca.crt" -CAkey "$TLS_DIR/ca.key" -CAcreateserial \
      -extfile <(printf "subjectAltName=DNS:%s,IP:%s" "$HOST" "$WG_IP") \
      -out "$TLS_DIR/$HOST.crt" 2>/dev/null

    rm -f "$TLS_DIR/$HOST.csr"
    chmod 600 "$TLS_DIR/$HOST.key"

    echo "Server cert created:"
    echo "  $TLS_DIR/$HOST.crt"
    echo "  $TLS_DIR/$HOST.key"
    echo "SAN: DNS:$HOST, IP:$WG_IP"
    ;;

  *) usage ;;
esac
