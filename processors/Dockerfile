# Build from the repository root: docker build -f processors/Dockerfile -t createcanyon-processor:local .
# Local processor image. Promote a reviewed, vulnerability-scanned digest for production.
FROM node:24-bookworm-slim AS dependencies
WORKDIR /opt/processor
COPY processors/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts=false --no-audit --no-fund
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 ffmpeg libreoffice-writer libreoffice-calc libreoffice-impress qpdf poppler-utils ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/processor
COPY --from=dependencies /opt/processor/node_modules ./node_modules
COPY processors/safe-runner.mjs processors/archive_guard.py ./
COPY processors/rules ./rules
ENV NODE_ENV=production HOME=/tmp LANG=C.UTF-8
USER 1000:1000
ENTRYPOINT ["node", "/opt/processor/safe-runner.mjs"]
# Gitleaks, Trivy with a pre-populated offline vulnerability DB, Semgrep and Syft
# are NOT silently downloaded into this development image. Supply a reviewed
# derivative image with all four pinned binaries/databases for production CODE
# assets. The worker refuses production code publication without their results.
