#!/bin/bash

init_homebrew() {
  if command -v brew >/dev/null 2>&1; then
    return
  fi

  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

brew_install_with_retry() {
  local formula="$1"
  local max_attempts=3
  local attempt=1

  until brew install "$formula"; do
    if ((attempt == max_attempts)); then
      echo "Error: brew install $formula failed after $max_attempts attempts." >&2
      return 1
    fi

    local retry_delay=$((attempt * 5))
    echo "Warning: brew install $formula failed (attempt $attempt/$max_attempts); retrying in $retry_delay seconds." >&2
    sleep "$retry_delay"
    ((attempt += 1))
  done
}
