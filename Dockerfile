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
# (issued 2021) not present in every bundled Node CA list - verified live
# 2026-09-04 (UNABLE_TO_VERIFY_FIRST_CERTIFICATE through Apify Proxy in the
# cloud, while the same chain validates fine on a Windows dev machine via
# OS-level cert bridging). --use-system-ca makes Node also consult the
# container OS's own ca-certificates store, which is more current.
ENV NODE_OPTIONS=--use-system-ca

CMD ["node", "dist/main.js"]
