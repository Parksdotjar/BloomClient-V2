#!/usr/bin/env bash
set -Eeuo pipefail

API_HOST="api.north.bloomclient.org"
API_ROOT="/opt/bloom-api"
CAPE_DATA="/var/lib/bloom/capes"
ACCOUNT_DATA="/var/lib/bloom/accounts"
AUTH_ENV="/etc/bloom-api.env"
OWNER_UUID="2790c9887660460491068944f4ea2dcb"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi

if [[ ! -f "${API_ROOT}/server.mjs" || ! -d "${API_ROOT}/auth" || ! -d "${API_ROOT}/cosmetics" || ! -d "${API_ROOT}/sharing" || ! -d "${API_ROOT}/social" ]]; then
  echo "Bloom API files are missing from ${API_ROOT}." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl docker.io caddy

install -d -m 0755 "${API_ROOT}"
install -d -m 0700 "${CAPE_DATA}"
install -d -m 0700 "${ACCOUNT_DATA}"
# The image runs as the unprivileged Node user (uid/gid 1000).
chown -R 1000:1000 "${CAPE_DATA}"
chown -R 1000:1000 "${ACCOUNT_DATA}"

if [[ ! -f "${AUTH_ENV}" ]]; then
  umask 077
  cat >"${AUTH_ENV}" <<EOF
BLOOM_SITE_URL=https://bloomclient.org
BLOOM_AUTH_SECRET=$(openssl rand -base64 48)
BLOOM_AUTH_DATA_DIR=${ACCOUNT_DATA}
BLOOM_GOOGLE_CLIENT_ID=
BLOOM_GOOGLE_CLIENT_SECRET=
BLOOM_GITHUB_CLIENT_ID=
BLOOM_GITHUB_CLIENT_SECRET=
EOF
  echo "Created ${AUTH_ENV}. Add the Google and GitHub OAuth client credentials before enabling website sign-in."
fi

systemctl enable --now docker
docker build --pull -t bloom-minecraft-api:local "${API_ROOT}"

cat >/etc/systemd/system/bloom-api.service <<EOF
[Unit]
Description=Bloom Minecraft API
After=docker.service network-online.target
Requires=docker.service
Wants=network-online.target

[Service]
Type=simple
Restart=always
RestartSec=4
ExecStartPre=-/usr/bin/docker rm -f bloom-minecraft-api
ExecStart=/usr/bin/docker run --name bloom-minecraft-api --read-only --tmpfs /tmp:rw,noexec,nosuid,size=32m -p 127.0.0.1:8110:8110 -v ${CAPE_DATA}:${CAPE_DATA} -v ${ACCOUNT_DATA}:${ACCOUNT_DATA} --env-file ${AUTH_ENV} --env PORT=8110 --env BLOOM_COSMETICS_ENABLED=true --env BLOOM_CAPE_STORAGE=sqlite --env BLOOM_CAPE_DATA_DIR=${CAPE_DATA} --env BLOOM_CAPE_PUBLIC_URL=https://${API_HOST}/minecraft --env BLOOM_CAPE_OWNER_UUIDS=${OWNER_UUID} --env BLOOM_SHARE_DATA_DIR=${CAPE_DATA} --env BLOOM_SHARE_PUBLIC_URL=https://${API_HOST}/minecraft bloom-minecraft-api:local
ExecStop=/usr/bin/docker stop -t 20 bloom-minecraft-api

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/caddy/Caddyfile <<EOF
${API_HOST} {
  encode zstd gzip
  reverse_proxy 127.0.0.1:8110
}
EOF

systemctl daemon-reload
systemctl enable bloom-api
systemctl restart bloom-api
systemctl enable --now caddy

for attempt in {1..30}; do
  if curl --fail --silent --show-error http://127.0.0.1:8110/health >/tmp/bloom-health.json; then
    break
  fi
  if [[ "${attempt}" -eq 30 ]]; then
    journalctl -u bloom-api --no-pager -n 80
    exit 1
  fi
  sleep 1
done

docker run --rm \
  -v "${CAPE_DATA}:${CAPE_DATA}" \
  --env BLOOM_COSMETICS_ENABLED=true \
  --env BLOOM_CAPE_STORAGE=sqlite \
  --env BLOOM_CAPE_DATA_DIR="${CAPE_DATA}" \
  --env BLOOM_CAPE_PUBLIC_URL="https://${API_HOST}/minecraft" \
  --env BLOOM_CAPE_OWNER_UUIDS="${OWNER_UUID}" \
  --entrypoint node \
  bloom-minecraft-api:local \
  /app/cosmetics/preflight.mjs

echo
echo "Bloom API is healthy locally:"
cat /tmp/bloom-health.json
echo
echo "Caddy is configured for https://${API_HOST}."
echo "Point the Cloudflare DNS record to this VPS to complete public TLS activation."
