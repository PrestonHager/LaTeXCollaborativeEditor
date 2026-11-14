# Builds the app and the docs into one nginx image.
# Coolify uses this for the staging site (the staging branch).
# Production still deploys to GitHub Pages from a release, see docs/deployment.md.

FROM node:22-alpine AS app
WORKDIR /src/frontend
# Coolify passes these as build args when they're marked as build variables.
ARG VITE_DEPLOY_ENV=staging
ARG VITE_P2P_APP_ID
ARG VITE_P2P_RENDEZVOUS
ARG VITE_STUN_URL
ARG VITE_TURN_URL
ARG VITE_TURN_USERNAME
ARG VITE_TURN_CREDENTIAL
ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_GOOGLE_API_KEY
ARG VITE_GOOGLE_APP_ID
ARG VITE_DOCS_BASE_URL
ARG VITE_DISABLE_CSP
# There's no .git in the build context, so the version's commit comes from Coolify instead.
ARG SOURCE_COMMIT
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY CHANGELOG.md /src/
COPY frontend/ ./
# Coolify can pass unset build args as empty strings, which would beat the
# `??` defaults in bootstrapConfig.ts, so we drop the empty ones first.
RUN for v in $(env | grep -o '^VITE_[A-Z0-9_]*='); do \
      v="${v%=}"; eval "[ -n \"\$$v\" ] || unset $v"; \
    done && GITHUB_SHA="$SOURCE_COMMIT" npm run build

FROM python:3.12-alpine AS docs
WORKDIR /src
ARG DOCS_SITE_URL
COPY requirements-docs.txt ./
RUN pip install --no-cache-dir -r requirements-docs.txt
COPY mkdocs.yml mkdocs_fuse_search_index.py ./
COPY scripts/ scripts/
COPY docs/ docs/
RUN python3 scripts/set_mkdocs_site_url.py && mkdocs build --site-dir /out/docs

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=app /src/frontend/dist /usr/share/nginx/html
COPY --from=docs /out/docs /usr/share/nginx/html/docs
EXPOSE 80
