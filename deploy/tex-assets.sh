#!/bin/sh
# Runs from the nginx image's /docker-entrypoint.d/ before nginx starts (Dockerfile). It writes
# /etc/nginx/tex-assets.conf, which deploy/nginx.conf includes for /tex/ (Compile PDF engine files):
#
# - TEX_ASSETS_UPSTREAM unset or empty: serve the image's own tex/ folder (tex-assets.local.conf),
#   the same as static hosting.
# - TEX_ASSETS_UPSTREAM=http://minio:9000/tex-assets (scheme, host[:port], bucket[/prefix]): a
#   caching proxy to that bucket (tex-assets.proxy.conf.template), with its disk cache in
#   conf.d/tex-assets-cache.conf. See docs/deployment.md, "Compile PDF engine on MinIO".
#
# Optional: TEX_ASSETS_CACHE_MAX (default 20g) caps the disk cache; TEX_ASSETS_RESOLVER (default
# 127.0.0.11, Docker's DNS) is the resolver for the MinIO host name.
set -eu

out=/etc/nginx/tex-assets.conf
cache_conf=/etc/nginx/conf.d/tex-assets-cache.conf
upstream="${TEX_ASSETS_UPSTREAM:-}"

# A bad setting must not take the whole site down: warn loudly and serve the image's tex/ instead.
serve_local() {
  cp /etc/nginx/tex-assets.local.conf "$out"
  rm -f "$cache_conf"
  echo "tex-assets: serving tex/ from this image"
  exit 0
}
refuse() {
  echo "tex-assets: WARNING: $1. Compile PDF falls back to this image's tex/ folder." >&2
  serve_local
}

[ -n "$upstream" ] || serve_local

# scheme://host[:port]/path, with a conservative character set: it goes into nginx's config.
if ! printf '%s' "$upstream" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9._-]+)+/?$'; then
  refuse "TEX_ASSETS_UPSTREAM must look like http://minio:9000/tex-assets"
fi
upstream="${upstream%/}"
rest="${upstream#*://}"
TEX_ASSETS_HOST="${rest%%/*}"
TEX_ASSETS_ORIGIN="${upstream%%://*}://$TEX_ASSETS_HOST"
TEX_ASSETS_PREFIX="/${rest#*/}"
TEX_ASSETS_RESOLVER="${TEX_ASSETS_RESOLVER:-127.0.0.11}"
cache_max="${TEX_ASSETS_CACHE_MAX:-20g}"

if ! printf '%s' "$TEX_ASSETS_RESOLVER" | grep -Eq '^[A-Za-z0-9.:-]+$'; then
  refuse "TEX_ASSETS_RESOLVER must be a host or IP address"
fi
if ! printf '%s' "$cache_max" | grep -Eq '^[0-9]+[kmgKMG]?$'; then
  refuse "TEX_ASSETS_CACHE_MAX must be a size like 20g"
fi

export TEX_ASSETS_HOST TEX_ASSETS_ORIGIN TEX_ASSETS_PREFIX TEX_ASSETS_RESOLVER
# Only our variables, so nginx's own $variables in the template stay as they are.
envsubst '${TEX_ASSETS_HOST} ${TEX_ASSETS_ORIGIN} ${TEX_ASSETS_PREFIX} ${TEX_ASSETS_RESOLVER}' \
  < /etc/nginx/tex-assets.proxy.conf.template > "$out"

mkdir -p /var/cache/nginx/tex-assets
cat > "$cache_conf" <<EOF
# Written by tex-assets.sh. Entries unused for 90 days are dropped; the cache never passes $cache_max.
proxy_cache_path /var/cache/nginx/tex-assets levels=1:2 keys_zone=tex_assets:20m max_size=$cache_max inactive=90d use_temp_path=off;
EOF
echo "tex-assets: proxying tex/ to $TEX_ASSETS_ORIGIN$TEX_ASSETS_PREFIX with a $cache_max cache"
