# LocalRun community server — zero dependencies, so this is tiny.
FROM node:20-alpine
WORKDIR /app
COPY index.mjs .
ENV PORT=8787
ENV DATA_FILE=/data/localrun.json
VOLUME /data
EXPOSE 8787
CMD ["node", "index.mjs"]
