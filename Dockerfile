FROM apify/actor-node:24 AS builder

RUN npm ls @crawlee/core apify puppeteer playwright

COPY --chown=myuser:myuser package*.json ./

RUN npm install --include=dev --audit=false

COPY --chown=myuser:myuser . ./

RUN npm run build

FROM apify/actor-node:24

RUN npm ls @crawlee/core apify puppeteer playwright

COPY --chown=myuser:myuser package*.json ./

RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true) \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version \
    && rm -r ~/.npm

COPY --from=builder --chown=myuser:myuser /usr/src/app/dist ./dist

COPY --chown=myuser:myuser . ./

# webecommerce.cba.gov.ar is misconfigured: it serves ONLY its leaf
# certificate, not the required intermediate ("Sectigo Public Server
# Authentication CA OV R36") - confirmed with `openssl s_client -showcerts`
# (1 cert on the wire, not the full chain). A Windows dev machine "just
# works" because Windows silently completes the chain from its own cached
# intermediate; Node in the Linux container has no such fallback and fails
# UNABLE_TO_VERIFY_FIRST_CERTIFICATE / UNABLE_TO_VERIFY_LEAF_SIGNATURE.
# certs/cordoba-sectigo-chain.pem holds the missing intermediate + its root,
# extracted directly from a live TLS session and chain-verified with
# `openssl verify -CAfile root.pem -untrusted intermediate.pem leaf.pem`
# (result: OK) before being embedded. NODE_EXTRA_CA_CERTS additively
# extends Node's default trust store with both, letting it complete the
# chain the server itself fails to send. Verified live 2026-09-04.
ENV NODE_EXTRA_CA_CERTS=/usr/src/app/certs/cordoba-sectigo-chain.pem

CMD ["node", "dist/main.js"]
