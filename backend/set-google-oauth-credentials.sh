#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="/etc/bloom-api.env"
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "${ENV_FILE} does not exist." >&2
  exit 1
fi

IFS= read -r -p "Paste the Google client ID, then press Enter: " client_id
if [[ "${client_id}" != *.apps.googleusercontent.com ]]; then
  unset client_id
  echo "That does not look like a Google web client ID. Nothing was saved." >&2
  exit 1
fi

IFS= read -r -s -p "Paste the Google client secret, then press Enter: " client_secret
printf '\n'
if (( ${#client_secret} < 20 )); then
  unset client_id client_secret
  echo "The secret was too short and nothing was saved." >&2
  exit 1
fi

temporary="$(mktemp)"
trap 'rm -f "${temporary}"' EXIT
found_id=false
found_secret=false
while IFS= read -r line || [[ -n "${line}" ]]; do
  case "${line}" in
    BLOOM_GOOGLE_CLIENT_ID=*)
      printf 'BLOOM_GOOGLE_CLIENT_ID=%s\n' "${client_id}" >>"${temporary}"
      found_id=true
      ;;
    BLOOM_GOOGLE_CLIENT_SECRET=*)
      printf 'BLOOM_GOOGLE_CLIENT_SECRET=%s\n' "${client_secret}" >>"${temporary}"
      found_secret=true
      ;;
    *)
      printf '%s\n' "${line}" >>"${temporary}"
      ;;
  esac
done <"${ENV_FILE}"

[[ "${found_id}" == true ]] || printf 'BLOOM_GOOGLE_CLIENT_ID=%s\n' "${client_id}" >>"${temporary}"
[[ "${found_secret}" == true ]] || printf 'BLOOM_GOOGLE_CLIENT_SECRET=%s\n' "${client_secret}" >>"${temporary}"
unset client_id client_secret
install -o root -g root -m 0600 "${temporary}" "${ENV_FILE}"
echo "Google OAuth credentials saved privately."
