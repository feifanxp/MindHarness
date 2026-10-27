#!/usr/bin/env sh
set -eu

BASE_PATH="${APP_BASE_PATH:-/}"
RAW_ENABLE_SERVICE_WORKER="${APP_ENABLE_SERVICE_WORKER:-true}"
case "${RAW_ENABLE_SERVICE_WORKER}" in
  1|true|TRUE|yes|YES|on|ON)
    ENABLE_SERVICE_WORKER="true"
    ;;
  *)
    ENABLE_SERVICE_WORKER="false"
    ;;
esac

cat > /usr/share/nginx/html/runtime-config.js <<EOF
window.__APP_BASE_PATH__ = "${BASE_PATH}";
window.__ENABLE_SERVICE_WORKER__ = ${ENABLE_SERVICE_WORKER};
EOF

# Serialize deployment URLs as data, including quotes, backslashes and control characters.
awk '
function quoted(value, output, i, char) {
  output = "\""
  for (i = 1; i <= length(value); i++) {
    char = substr(value, i, 1)
    if (char == "\\") output = output "\\\\"
    else if (char == "\"") output = output "\\\""
    else if (char == "\n") output = output "\\n"
    else if (char == "\r") output = output "\\r"
    else if (char == "\t") output = output "\\t"
    else output = output char
  }
  return output "\""
}
BEGIN {
  probe = ENVIRON["APP_AUTHENTICATION_RECOVERY_PROBE_URL"]
  navigation = ENVIRON["APP_AUTHENTICATION_RECOVERY_NAVIGATION_URL"]
  if (probe != "")
    print "window.__AUTHENTICATION_RECOVERY_CONFIG__ = {probeUrl:" quoted(probe) ",navigationUrl:" quoted(navigation) "};"
  else print "window.__AUTHENTICATION_RECOVERY_CONFIG__ = null;"
}' >> /usr/share/nginx/html/runtime-config.js

# Use the same bootstrap as static and development deployments.
cat /opt/mindroom/runtime-config.js >> /usr/share/nginx/html/runtime-config.js
