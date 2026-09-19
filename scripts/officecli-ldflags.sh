#!/usr/bin/env bash
# The ldflags an OfficeDex build has to give OfficeCLI, beyond version stamping.
#
# OfficeCLI verifies the commit token the hosted licence service signs, using
# `internal/license.EmbeddedLicenseProofPublicKey`. That variable has a *dev*
# default compiled in, and the release overrides it at link time — the key lives
# in OfficeCLI's own Makefile as `CLI_LICENSE_PROOF_PUBLIC_KEY`. A public key,
# not a secret.
#
# OfficeDex's three build scripts each built OfficeCLI with their own ldflags
# and none of them passed it, so every locally built app shipped a CLI that
# verified hosted signatures against the dev key. Every generation then failed
# with "license proof validation failed: license proof signature mismatch" —
# including in the real-E2E suite, which stages its CLI into the same directory.
#
# There is an escape hatch in OfficeCLI for exactly this
# (`allowLocalDevLicenseProofSignatureMismatch`) but it only applies to a build
# stamped `Version=dev` with `BuildDate=unknown`, and these scripts stamp a real
# version so the packaged app reports one. So the key has to be passed.
#
# Read from the Makefile rather than copied here: two spellings of the same key
# in two repositories is a drift waiting to happen, and the failure it produces
# is this one, which costs an afternoon to find.

officecli_license_proof_public_key() {
  local officecli_dir="$1"
  local makefile="${officecli_dir}/Makefile"
  if [[ -n "${CLI_LICENSE_PROOF_PUBLIC_KEY:-}" ]]; then
    printf '%s' "${CLI_LICENSE_PROOF_PUBLIC_KEY}"
    return 0
  fi
  if [[ ! -f "${makefile}" ]]; then
    echo "[officecli-ldflags] no Makefile at ${makefile}; cannot resolve the licence proof key" >&2
    return 1
  fi
  local key
  key="$(sed -n 's/^CLI_LICENSE_PROOF_PUBLIC_KEY[[:space:]]*?*=[[:space:]]*//p' "${makefile}" | head -1 | tr -d '[:space:]')"
  if [[ -z "${key}" ]]; then
    echo "[officecli-ldflags] ${makefile} no longer defines CLI_LICENSE_PROOF_PUBLIC_KEY" >&2
    return 1
  fi
  printf '%s' "${key}"
}

# Everything a build must stamp, as one string. `version`, `commit` and the
# build date are the caller's; the licence key is not negotiable.
officecli_ldflags() {
  local officecli_dir="$1" version="$2" commit="$3" build_date="$4"
  local key
  key="$(officecli_license_proof_public_key "${officecli_dir}")" || return 1
  printf '%s' \
    "-s -w \
-X github.com/officecli/officecli/internal/cli.Version=${version} \
-X github.com/officecli/officecli/internal/cli.Commit=${commit} \
-X github.com/officecli/officecli/internal/cli.BuildDate=${build_date} \
-X github.com/officecli/officecli/internal/license.EmbeddedLicenseProofPublicKey=${key}"
}
