#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="/etc/bloom-api.env"
provider="${1:-}"

case "${provider}" in
  github)
    variable="BLOOM_GITHUB_CLIENT_SECRET"
    label="GitHub"
    ;;
  google)
    variable="BLOOM_GOOGLE_CLIENT_SECRET"
    label="Google"
    ;;
  *)
    echo "Usage: $0 github|google" >&2
    exit 2
    ;;
esac

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "${ENV_FILE} does not exist." >&2
  exit 1
fi

IFS= read -r -s -p "Paste the ${label} client secret, then press Enter: " secret
printf '\n'
if (( ${#secret} < 20 )); then
  unset secret
  echo "The secret was too short and was not saved." >&2
  exit 1
fi

temporary="$(mktemp)"
trap 'rm -f "${temporary}"' EXIT
found=false
while IFS= read -r line || [[ -n "${line}" ]]; do
  if [[ "${line}" == "${variable}="* ]]; then
    printf '%s=%s\n' "${variable}" "${secret}" >>"${temporary}"
    found=true
  else
    printf '%s\n' "${line}" >>"${temporary}"
  fi
done <"${ENV_FILE}"

if [[ "${found}" != true ]]; then
  printf '%s=%s\n' "${variable}" "${secret}" >>"${temporary}"
fi
unset secret
install -o root -g root -m 0600 "${temporary}" "${ENV_FILE}"
echo "${label} client secret saved privately."
