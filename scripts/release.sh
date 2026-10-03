#!/usr/bin/env bash

set -Eeuo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

cd "${REPO_ROOT}"

die() {
    echo "::error::$1"
    exit 1
}

require_command() {
    local command="$1"

    if ! command -v "${command}" >/dev/null 2>&1; then
        echo "::error::Benötigtes Kommando nicht gefunden: ${command}"
        exit 1
    fi
}

find_extensions() {
    find "${REPO_ROOT}" \
        -mindepth 2 \
        -maxdepth 2 \
        -type f \
        -name "package.json" \
        -not -path "*/node_modules/*" \
        -print \
        | while read -r package_json; do
            dirname "${package_json}"
        done \
        | sort
}

get_extension_name() {
    local extension_dir="$1"

    node -p "
        require('${extension_dir}/package.json').name
    "
}

get_extension_version() {
    local extension_dir="$1"

    node -p "
        require('${extension_dir}/package.json').version
    "
}

validate_extension() { 
    local extension_dir="$1" 
    if [[ ! -f "${extension_dir}/package.json" ]]; then 
        die "Keine package.json gefunden: ${extension_dir}" 
    fi 
    
    if [[ ! -f "${extension_dir}/tsconfig.json" ]]; then 
        die "Keine tsconfig.json gefunden: ${extension_dir}" 
    fi 
    
    local main 
    main="$( 
        cd "${extension_dir}" 
        node -p "require('./package.json').main || ''" 
    )" 
    
    if [[ "${main}" != "./dist/extension.js" ]]; then 
        die "Ungültiger Extension-Entrypoint in ${extension_dir}: ${main}" 
    fi 
}

install_dependencies() {
    local extension_dir="$1"

    cd "${extension_dir}"

    npm install \
        --no-audit \
        --no-fund \
        --no-package-lock
}

stage_license() {
    local extension_dir="$1"

    if [[ ! -s "${REPO_ROOT}/LICENSE" ]]; then
        die "Zentrale LICENSE wurde nicht gefunden."
    fi

    cp "${REPO_ROOT}/LICENSE" "${extension_dir}/LICENSE"
}

cleanup_license() {
    local extension_dir="$1"

    rm -f "${extension_dir}/LICENSE"
}

test_extension() {
    local extension_dir="$1"

    local name
    name="$(get_extension_name "${extension_dir}")"

    echo ""
    echo "========================================"
    echo "Tests: ${name}"
    echo "Pfad:  ${extension_dir}"
    echo "========================================"

    install_dependencies "${extension_dir}"

    cd "${extension_dir}"

    npm test
}

package_extension() {
    local extension_dir="$1"

    local name
    local version

    name="$(get_extension_name "${extension_dir}")"
    version="$(get_extension_version "${extension_dir}")"

    echo ""
    echo "========================================"
    echo "Packaging: ${name}"
    echo "Version:   ${version}"
    echo "Pfad:      ${extension_dir}"
    echo "========================================"

    validate_extension "${extension_dir}"

    install_dependencies "${extension_dir}"

    cd "${extension_dir}"

    rm -f ./*.vsix

    stage_license "${extension_dir}"

    # Immer aufräumen – auch wenn npm/vsce fehlschlägt.
    trap 'cleanup_license "${extension_dir}"' RETURN

    npm run package

    local vsix
    vsix="$(find "${extension_dir}" \
        -maxdepth 1 \
        -type f \
        -name "*.vsix" \
        -print \
        -quit
    )"

    if [[ -z "${vsix}" ]]; then
        die "Keine VSIX-Datei für ${name} erzeugt."
    fi

    echo "VSIX erzeugt: ${vsix}"
}

test_all() {
    local extensions=()

    mapfile -t extensions < <(find_extensions)

    if [[ "${#extensions[@]}" -eq 0 ]]; then
        die "Keine VS Code Extensions gefunden."
    fi

    echo "Gefundene Extensions: ${#extensions[@]}"

    for extension_dir in "${extensions[@]}"; do
        test_extension "${extension_dir}"
    done
}

package_all() {
    local extensions=()

    mapfile -t extensions < <(find_extensions)

    if [[ "${#extensions[@]}" -eq 0 ]]; then
        die "Keine VS Code Extensions gefunden."
    fi

    echo "Gefundene Extensions: ${#extensions[@]}"

    for extension_dir in "${extensions[@]}"; do
        package_extension "${extension_dir}"
    done
}

release_all() {
    require_command gh
    require_command python

    local vsix_files=()

    mapfile -t vsix_files < <(
        find "${REPO_ROOT}/artifacts" \
            -type f \
            -name "*.vsix" \
            | sort
    )

    if [[ "${#vsix_files[@]}" -eq 0 ]]; then
        die "Keine VSIX-Dateien im Artifact gefunden."
    fi

    echo "Gefundene VSIX-Dateien: ${#vsix_files[@]}"

    for vsix in "${vsix_files[@]}"; do
        release_vsix "${vsix}"
    done
}

release_vsix() {
    local vsix="$1"

    local metadata

    metadata="$(
        python - "${vsix}" <<'PY'
import json
import pathlib
import sys
import zipfile

vsix = pathlib.Path(sys.argv[1])

with zipfile.ZipFile(vsix) as archive:
    manifest = json.loads(
        archive.read("extension/package.json")
    )

name = manifest["name"]
version = manifest["version"]

print(name)
print(version)
PY
    )"

    local name
    local version

    name="$(echo "${metadata}" | sed -n '1p')"
    version="$(echo "${metadata}" | sed -n '2p')"

    local tag="${name}-v${version}"

    echo ""
    echo "========================================"
    echo "Release: ${name}"
    echo "Version: ${version}"
    echo "Tag:     ${tag}"
    echo "VSIX:    ${vsix}"
    echo "========================================"

    if gh release view "${tag}" >/dev/null 2>&1; then
        echo "Release ${tag} existiert bereits."
        echo "Überspringe ${name}."
        return 0
    fi

    gh release create \
        "${tag}" \
        "${vsix}" \
        --title "${name} v${version}" \
        --generate-notes

    echo "Release ${tag} erfolgreich erstellt."
}

case "${1:-}" in
    test)
        require_command npm
        require_command node
        test_all
        ;;

    package)
        require_command npm
        require_command node
        package_all
        ;;

    release)
        require_command gh
        require_command python
        release_all
        ;;

    *)
        echo "Verwendung:"
        echo "  $0 test"
        echo "  $0 package"
        echo "  $0 release"
        exit 2
        ;;
esac