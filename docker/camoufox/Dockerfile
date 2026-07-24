ARG PLAYWRIGHT_VERSION=1.59.1
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble

ARG PLAYWRIGHT_VERSION=1.59.1
ARG CAMOUFOX_JS_VERSION=0.7.0
ENV CAMOUFOX_INSTALL_DIR=/opt/camoufox

USER root
WORKDIR /srv/camoufox
RUN npm init -y \
  && npm install --save-exact "camoufox-js@${CAMOUFOX_JS_VERSION}" "playwright@${PLAYWRIGHT_VERSION}" \
  && ./node_modules/.bin/camoufox-js fetch \
  && chmod -R a+rX /opt/camoufox

COPY options.mjs /srv/camoufox/options.mjs
RUN chown -R pwuser:pwuser /srv/camoufox

USER pwuser
WORKDIR /home/pwuser
CMD ["/srv/camoufox/node_modules/.bin/playwright", "run-server", "--port", "3000", "--host", "0.0.0.0", "--unsafe"]
