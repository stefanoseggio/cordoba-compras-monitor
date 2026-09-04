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

# webecommerce.cba.gov.ar's TLS chain leads to a relatively new Sectigo root
# (issued 2021) not present in this container's Node CA trust - verified
# live 2026-09-04 (UNABLE_TO_VERIFY_FIRST_CERTIFICATE, reproduced with two
# independent HTTP clients and unaffected by --use-system-ca). certs/cordoba-sectigo-root-r46.pem
# was extracted directly from the server's own presented chain.
# NODE_EXTRA_CA_CERTS additively extends Node's default trust store with it
# (unlike passing a custom `ca` option to an Agent, which REPLACES the
# default store - tls.rootCertificates is not a usable substitute for that
# default, confirmed live: using it alone broke validation that omitting
# `ca` entirely does not).
ENV NODE_EXTRA_CA_CERTS=/usr/src/app/certs/cordoba-sectigo-root-r46.pem

CMD ["node", "dist/main.js"]
